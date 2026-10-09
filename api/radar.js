// RadarBomber API proxy for API-Football. Keep API_FOOTBALL_KEY in Vercel Environment Variables.
const BASE = 'https://v3.football.api-sports.io';
// Keep the radar focused on major European leagues and continental competitions.
const ALLOWED_LEAGUES = new Set([39, 140, 135, 78, 61, 2, 3, 848, 45, 143, 94, 88]);
const EUROPEAN_CUPS = new Set([2, 3, 848]);
const MAIN_TEAMS = new Set([
  'arsenal','aston villa','chelsea','liverpool','manchester city','manchester united','newcastle united','tottenham hotspur',
  'real madrid','barcelona','atletico madrid','athletic club','real sociedad','villarreal','sevilla',
  'inter','internazionale','juventus','milan','napoli','roma','lazio','atalanta','fiorentina',
  'bayern munich','borussia dortmund','bayer leverkusen','rb leipzig','eintracht frankfurt','vfb stuttgart',
  'paris saint germain','psg','marseille','monaco','lyon','lille','nice',
  'benfica','porto','sporting cp','ajax','psv','feyenoord'
]);
const normalizeTeam = value => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\\s+/g, ' ').trim();

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
      const preferred = fixtures.filter(f => {
        const leagueId = Number(f.league && f.league.id);
        if (!ALLOWED_LEAGUES.has(leagueId)) return false;
        // Continental cups are relevant by competition; domestic leagues/cups are curated around major clubs.
        if (EUROPEAN_CUPS.has(leagueId)) return true;
        return MAIN_TEAMS.has(normalizeTeam(f.teams && f.teams.home && f.teams.home.name)) ||
          MAIN_TEAMS.has(normalizeTeam(f.teams && f.teams.away && f.teams.away.name));
      });
      const visible = preferred.slice(0, 60);
      const message = visible.length
        ? 'Radar selettivo: campionati principali e partite con almeno una squadra di primo piano. Le partite secondarie senza dati recenti verificabili vengono escluse.'
        : 'Nessuna partita principale trovata per questa data. Non mostriamo competizioni o squadre fuori dai filtri selettivi.';
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
      res.status(200).json({
        date,
        mode: lookupMode,
        message,
        totalFixturesFromProvider: fixtures.length,
        filteredFixtures: preferred.length,
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
    // Never substitute old-season rosters for current matches: stale players are misleading.
    // Make one current-season request per team to preserve the Free plan quota.
    const loadTeamPlayers = async (teamId, leagueId, requestedSeason) => {
      const result = await optional('/players?team=' + teamId + '&season=' + requestedSeason + '&league=' + leagueId + '&page=1');
      return { ...result, season: result.error ? null : requestedSeason };
    };
    // Current-season player statistics only. Do not spend extra calls on optional lineups/injuries.
    const lineupResult = { data: [], error: '' };
    const injuryResult = { data: [], error: '' };
    const [homeResult, awayResult] = await Promise.all([
      loadTeamPlayers(fixture.teams.home.id, fixture.league.id, season),
      loadTeamPlayers(fixture.teams.away.id, fixture.league.id, season)
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
    diagnostics.push('Formazioni e infortuni non verificati: per rispettare il limite API gratuito, questa versione non li scarica automaticamente.');
    const injuries = [];
    const lineupKnown = false;
    const starters = new Set();
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
      ? 'Giocatori con statistiche della stagione corrente. Indici statistici comparativi, non probabilità calibrate.' +
        (diagnostics.length ? ' Avviso: ' + diagnostics.join(' | ') : '')
      : 'Nessun giocatore mostrato: mancano statistiche accessibili della stagione corrente. Per evitare nomi e rendimento obsoleti, RadarBomber non usa più rose/statistiche storiche.' +
        (diagnostics.length ? ' Dettagli: ' + diagnostics.join(' | ') : ' Verifica la disponibilità della stagione corrente nel piano API-Football.');
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
