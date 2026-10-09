// RadarBomber API proxy for API-Football. Keep API_FOOTBALL_KEY in Vercel Environment Variables.
const BASE = 'https://v3.football.api-sports.io';
const ALLOWED_LEAGUES = new Set([39, 140, 135, 78, 61, 2, 3, 848, 45, 143, 94, 88]);

async function api(path) {
  const key = (process.env.API_FOOTBALL_KEY || '').trim();
  if (!key) {
    const e = new Error('Chiave API non configurata');
    e.status = 503;
    throw e;
  }
  const response = await fetch(BASE + path, {
    headers: { 'x-apisports-key': key },
    signal: AbortSignal.timeout(12000)
  });
  const json = await response.json();
  if (!response.ok || (json.errors && Object.keys(json.errors).length)) {
    const detail = json.errors ? JSON.stringify(json.errors) : 'Errore provider';
    const e = new Error('API-Football: ' + detail);
    e.status = response.status || 502;
    throw e;
  }
  return json.response || [];
}

const num = v => Number(v || 0);

function indexFor(goals, assists, minutes, apps, kind) {
  if (!apps || !minutes) return 0;
  const per90Goal = goals / Math.max(minutes / 90, 1);
  const per90GA = (goals + assists) / Math.max(minutes / 90, 1);
  const base = kind === 'goal' ? per90Goal : per90GA;
  const score = 100 * (1 - Math.exp(-base * (kind === 'goal' ? 1.35 : 1.0))) * Math.min(1, apps / 4);
  return Math.max(0, Math.min(99, Math.round(score)));
}

module.exports = async function handler(req, res) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const localDate = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}`;
    const date = String(req.query.date || localDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Data non valida' });
      return;
    }

    if (!req.query.fixture) {
      let fixtures = [];
      let lookupMode = req.query.date ? 'date' : 'upcoming';
      // API-Football may reject date-range/timezone filters on some subscriptions.
      // Use the broadly supported single-date filter for both default and date-picker requests.
      // The UI can request another date explicitly; avoid unsupported "next", "from", "to" and "timezone".
      fixtures = await api('/fixtures?date=' + encodeURIComponent(date)); 
      lookupMode = 'date';
      const preferred = fixtures.filter(f => ALLOWED_LEAGUES.has(Number(f.league && f.league.id)));
      // If today's matches use competitions outside our preferred list, show the real fixtures anyway
      // instead of making the dashboard look broken or empty.
      const useFallback = preferred.length === 0 && fixtures.length > 0;
      const visible = (useFallback ? fixtures : preferred).slice(0, 100);
      const message = fixtures.length === 0
        ? 'API-Football non ha restituito partite per questa data. La chiave è stata accettata, ma il piano/copertura API potrebbe non includere queste competizioni o date.'
        : useFallback
          ? 'Nessuna competizione preferita trovata: mostro le prossime partite reali disponibili.'
          : 'Prossime partite reali aggiornate. Seleziona “Analizza giocatori” per consultare le statistiche.';
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
      res.status(200).json({
        date,
        mode: lookupMode,
        message,
        totalFixturesFromProvider: fixtures.length,
        usedFallback: useFallback,
        fixtures: visible.map(f => ({
          id: f.fixture.id,
          home: f.teams.home.name,
          away: f.teams.away.name,
          league: f.league.name,
          time: f.fixture.date ? new Date(f.fixture.date).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }) : '',
          status: f.fixture.status.short
        }))
      });
      return;
    }

    const fixtureId = Number(req.query.fixture);
    if (!Number.isInteger(fixtureId) || fixtureId < 1) {
      res.status(400).json({ error: 'Partita non valida' });
      return;
    }
    const fixtures = await api('/fixtures?id=' + fixtureId);
    const fixture = fixtures[0];
    if (!fixture) {
      res.status(404).json({ error: 'Partita non trovata' });
      return;
    }
    const fixtureDate = String(fixture.fixture.date || date);
    const season = Number(fixtureDate.slice(0, 4)) - (Number(fixtureDate.slice(5, 7)) < 7 ? 1 : 0);
    // Treat lineups and injuries as optional: a restricted endpoint must not cancel player analysis.
    const optional = async path => {
      try { return { data: await api(path), error: '' }; }
      catch (e) { return { data: [], error: e.message || 'Errore provider' }; }
    };
    // Player statistics may be limited to older seasons on the Free plan.
    // Try the fixture season first, then explicitly fall back only to seasons the provider says are accessible.
    const loadTeamPlayers = async (teamId, leagueId, requestedSeason) => {
      const seasonsToTry = [requestedSeason, 2024, 2023, 2022].filter((v, i, a) => a.indexOf(v) === i);
      let lastError = '';
      for (const statsSeason of seasonsToTry) {
        let result = await optional('/players?team=' + teamId + '&season=' + statsSeason + '&league=' + leagueId + '&page=1');
        if (!result.error && result.data.length) return { ...result, season: statsSeason };
        if (result.error) {
          lastError = result.error;
          if (!/Free plans do not have access to this season|do not have access to this season/i.test(result.error)) {
            return { ...result, season: statsSeason };
          }
        }
        // If the league-filtered query is empty, try team+season without league.
        if (!result.error && !result.data.length) {
          const broad = await optional('/players?team=' + teamId + '&season=' + statsSeason + '&page=1');
          if (!broad.error && broad.data.length) return { ...broad, season: statsSeason };
          if (broad.error) lastError = broad.error;
        }
      }
      return { data: [], error: lastError || 'Nessuna statistica disponibile nelle stagioni accessibili', season: null };
    };
    const [lineupResult, homeResult, awayResult, injuryResult] = await Promise.all([
      optional('/fixtures/lineups?fixture=' + fixtureId),
      loadTeamPlayers(fixture.teams.home.id, fixture.league.id, season),
      loadTeamPlayers(fixture.teams.away.id, fixture.league.id, season),
      optional('/injuries?fixture=' + fixtureId)
    ]);
    const lineups = lineupResult.data;
    const homePlayers = homeResult.data;
    const awayPlayers = awayResult.data;
    const diagnostics = [];
    const usedSeasons = [homeResult.season, awayResult.season].filter(Boolean);
    if (homeResult.error) diagnostics.push('Statistiche ' + fixture.teams.home.name + ': ' + homeResult.error);
    if (awayResult.error) diagnostics.push('Statistiche ' + fixture.teams.away.name + ': ' + awayResult.error);
    if (usedSeasons.some(y => y !== season)) {
      diagnostics.push('ATTENZIONE: piano gratuito; statistiche storiche stagione ' + [...new Set(usedSeasons)].join(' e ') + ', non dati aggiornati della stagione corrente.');
    }
    if (lineupResult.error) diagnostics.push('Formazioni non disponibili: ' + lineupResult.error);
    if (injuryResult.error) diagnostics.push('Infortuni non disponibili: ' + injuryResult.error);
    const injuries = injuryResult.data;
    const lineupKnown = lineups.length > 0;
    const starters = new Set(lineups.flatMap(t => (t.startXI || []).map(p => String(p.player && p.player.id))));
    const injured = new Set(injuries.map(i => String(i.player && i.player.id)));
    const players = [];

    for (const group of [
      { team: fixture.teams.home.name, data: homePlayers },
      { team: fixture.teams.away.name, data: awayPlayers }
    ]) {
      for (const row of group.data) {
        const p = row.player || {};
        const st = (row.statistics || [])[0] || {};
        const id = String(p.id || '');
        const goals = num(st.goals && st.goals.total);
        const assists = num(st.goals && st.goals.assists);
        const minutes = num(st.games && st.games.minutes);
        const apps = num(st.games && st.games.appearences);
        if (!p.name || minutes < 90 || (lineupKnown && starters.size > 0 && !starters.has(id)) || injured.has(id)) continue;
        players.push({
          name: p.name, team: group.team, position: st.games && st.games.position || '',
          goals, assists, minutes, statsSeason: (group.team === fixture.teams.home.name ? homeResult.season : awayResult.season), starter: starters.has(id), lineupKnown,
          injured: injured.has(id),
          goalIndex: indexFor(goals, assists, minutes, apps, 'goal'),
          gaIndex: indexFor(goals, assists, minutes, apps, 'ga')
        });
      }
    }
    players.sort((a, b) => Math.max(b.goalIndex, b.gaIndex) - Math.max(a.goalIndex, a.gaIndex));
    const message = players.length
      ? (lineupKnown ? 'Formazioni pubblicate dal provider.' : 'Formazioni non ancora pubblicate: elenco provvisorio.') +
        ' Indici basati su statistiche stagionali; non sono probabilità calibrate.' +
        (diagnostics.length ? ' Avviso provider: ' + diagnostics.join(' | ') : '')
      : 'Il provider non ha restituito giocatori con statistiche stagionali sufficienti per questa partita.' +
        (diagnostics.length ? ' Dettagli: ' + diagnostics.join(' | ') : ' Verifica che il piano API-Football includa le statistiche di questa competizione/stagione.');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    res.status(200).json({
      message,
      diagnostics,
      players: players.slice(0, 24)
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(error.status || 502).json({
      error: error.status === 503
        ? 'Chiave API mancante: aggiungi API_FOOTBALL_KEY nelle Environment Variables del progetto Vercel.'
        : (error.message || 'Errore temporaneo del provider')
    });
  }
};
