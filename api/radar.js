// RadarBomber uses API-Football fixtures and recent goal/assist events. Keep API_FOOTBALL_KEY in Vercel Environment Variables.
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
const normalizeTeam = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

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

function indexFromRecent(goals, assists, games, kind) {
  if (!games) return 0;
  const perMatch = (kind === 'goal' ? goals : goals + assists) / games;
  const score = 100 * (1 - Math.exp(-perMatch * (kind === 'goal' ? 1.35 : 1.0)));
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
    const homeName = fixture.teams.home.name;
    const awayName = fixture.teams.away.name;
    const homeId = Number(fixture.teams.home.id);
    const awayId = Number(fixture.teams.away.id);
    const diagnostics = [];
    const optional = async path => {
      try { return { data: await api(path), error: '' }; }
      catch (e) { return { data: [], error: e.message || 'Errore provider' }; }
    };

    // The Free plan rejects the "last" filter. Use a supported date window instead,
    // then select the three most recent completed fixtures in that window.
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 35 * 24 * 60 * 60 * 1000);
    const isoDate = d => d.toISOString().slice(0, 10);
    // API-Football requires season when the fixtures endpoint is filtered by team.
    // European domestic seasons start in July; before July, use the season that began the previous year.
    const seasonYear = endDate.getUTCMonth() >= 6
      ? endDate.getUTCFullYear()
      : endDate.getUTCFullYear() - 1;
    const recentMatches = async teamId => {
      const path = '/fixtures?team=' + teamId +
        '&season=' + seasonYear +
        '&from=' + isoDate(startDate) + '&to=' + isoDate(endDate);
      const result = await optional(path);
      if (result.error) diagnostics.push('Ultime partite squadra ' + teamId + ': ' + result.error);
      return result.data
        .filter(f =>
          Number(f.fixture && f.fixture.id) !== fixtureId &&
          ['FT', 'AET', 'PEN'].includes(String(f.fixture && f.fixture.status && f.fixture.status.short || '')) &&
          ALLOWED_LEAGUES.has(Number(f.league && f.league.id))
        )
        .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
        .slice(0, 3);
    };

    const [homeRecent, awayRecent] = await Promise.all([
      recentMatches(homeId),
      recentMatches(awayId)
    ]);
    const gamesByTeam = new Map([[homeId, homeRecent.length], [awayId, awayRecent.length]]);
    const uniqueRecent = [...new Map([...homeRecent, ...awayRecent].map(f => [Number(f.fixture.id), f])).values()];
    const eventResults = await Promise.all(uniqueRecent.map(f => optional('/fixtures/events?fixture=' + f.fixture.id)));
    const playersByKey = new Map();

    eventResults.forEach((result, index) => {
      const match = uniqueRecent[index];
      if (result.error) {
        diagnostics.push('Eventi partita ' + match.fixture.id + ': ' + result.error);
        return;
      }
      for (const event of result.data) {
        if (String(event.type || '').toLowerCase() !== 'goal') continue;
        const teamId = Number(event.team && event.team.id);
        if (teamId !== homeId && teamId !== awayId) continue;
        const detail = String(event.detail || '').toLowerCase();
        if (detail.includes('own goal') || detail.includes('autogol')) continue;
        const scorer = event.player || {};
        if (!scorer.id || !scorer.name) continue;
        const key = teamId + ':' + scorer.id;
        if (!playersByKey.has(key)) {
          playersByKey.set(key, {
            name: scorer.name,
            team: teamId === homeId ? homeName : awayName,
            teamId,
            position: '',
            goals: 0,
            assists: 0,
            recentMatches: gamesByTeam.get(teamId) || 0,
            minutes: null,
            apps: null,
            statsSeason: 'ultime 3 partite',
            source: 'API-Football events',
            starter: false,
            lineupKnown: false,
            injured: false
          });
        }
        playersByKey.get(key).goals += 1;
        const assist = event.assist || {};
        if (assist.id && Number(assist.id) > 0 && assist.name) {
          const assistKey = teamId + ':' + assist.id;
          if (!playersByKey.has(assistKey)) {
            playersByKey.set(assistKey, {
              name: assist.name,
              team: teamId === homeId ? homeName : awayName,
              teamId,
              position: '',
              goals: 0,
              assists: 0,
              recentMatches: gamesByTeam.get(teamId) || 0,
              minutes: null,
              apps: null,
              statsSeason: 'ultime 3 partite',
              source: 'API-Football events',
              starter: false,
              lineupKnown: false,
              injured: false
            });
          }
          playersByKey.get(assistKey).assists += 1;
        }
      }
    });

    let players = [...playersByKey.values()]
      .filter(p => p.goals > 0 || p.assists > 0)
      .map(p => ({
        ...p,
        goalIndex: indexFromRecent(p.goals, p.assists, Math.max(1, p.recentMatches), 'goal'),
        gaIndex: indexFromRecent(p.goals, p.assists, Math.max(1, p.recentMatches), 'ga')
      }));
    if (homeRecent.length < 3 || awayRecent.length < 3) {
      diagnostics.push('Campione recente incompleto: una o entrambe le squadre hanno meno di 3 partite concluse disponibili nei campionati selezionati.');
    }
    diagnostics.push('Indici basati su gol e assist nelle ultime partite concluse delle squadre, non su statistiche stagionali. Formazioni, titolarità e infortuni non verificati.');
    players.sort((a, b) => Math.max(b.goalIndex, b.gaIndex) - Math.max(a.goalIndex, a.gaIndex));
    const message = players.length
      ? 'Radar forma recente: giocatori che hanno segnato o fornito assist nelle ultime partite delle due squadre. Indici comparativi, non probabilità calibrate. ' + diagnostics.join(' | ')
      : 'Nessun giocatore con gol o assist rilevato nelle ultime partite disponibili. RadarBomber non usa nomi o statistiche di stagioni passate come se fossero attuali. ' +
        (diagnostics.length ? 'Dettagli: ' + diagnostics.join(' | ') : 'Riprova più tardi.');
    const providerLimitError = diagnostics.some(d => /429|rate.?limit|too many requests|API-Football:/i.test(d));
    res.setHeader('Cache-Control', providerLimitError ? 'no-store, max-age=0' : (players.length ? 's-maxage=21600, stale-while-revalidate=86400' : 's-maxage=900, stale-while-revalidate=1800'));
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
