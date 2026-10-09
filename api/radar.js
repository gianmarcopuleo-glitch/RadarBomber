// RadarBomber: API-Football for fixtures, football-data.org for current-season player scorers. Keep both tokens in Vercel Environment Variables.
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

// football-data.org exposes current-season goals and assists for supported competitions.
// It is a separate free token, because API-Football Free blocks the current season (2026/27).
const FOOTBALL_DATA_COMPETITIONS = new Map([
  [39, 'PL'], [140, 'PD'], [135, 'SA'], [78, 'BL1'], [61, 'FL1'],
  [2, 'CL'], [3, 'EL'], [848, 'ECL'], [45, 'FAC'], [143, 'CDR'],
  [94, 'PPL'], [88, 'DED']
]);

async function footballData(path) {
  const token = (process.env.FOOTBALL_DATA_TOKEN || '').trim();
  if (!token) {
    const e = new Error('Manca FOOTBALL_DATA_TOKEN: configura il token gratuito di football-data.org in Vercel.');
    e.status = 503;
    throw e;
  }
  const response = await fetch('https://api.football-data.org/v4' + path, {
    headers: { 'X-Auth-Token': token },
    signal: AbortSignal.timeout(12000)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json.message || json.error || ('HTTP ' + response.status);
    const e = new Error('football-data.org: ' + detail);
    e.status = response.status;
    throw e;
  }
  return json;
}

function indexFromAppearances(goals, assists, apps, kind) {
  if (!apps) return 0;
  const perMatch = (kind === 'goal' ? goals : goals + assists) / apps;
  const score = 100 * (1 - Math.exp(-perMatch * (kind === 'goal' ? 1.35 : 1.0))) * Math.min(1, apps / 4);
  return Math.max(0, Math.min(99, Math.round(score)));
}

function sameTeam(a, b) {
  const x = normalizeTeam(a), y = normalizeTeam(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

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
    const homeName = fixture.teams.home.name;
    const awayName = fixture.teams.away.name;
    const leagueCode = FOOTBALL_DATA_COMPETITIONS.get(Number(fixture.league.id));
    const diagnostics = [];
    let players = [];

    // Do not show historic API-Football squads. Use current-season scorers/assists from football-data.org.
    if (!process.env.FOOTBALL_DATA_TOKEN) {
      diagnostics.push('Configura FOOTBALL_DATA_TOKEN con il token gratuito di football-data.org nelle Environment Variables di Vercel.');
    } else if (!leagueCode) {
      diagnostics.push('Competizione non ancora mappata alla copertura football-data.org: ' + fixture.league.name + '.');
    } else {
      try {
        const result = await footballData('/competitions/' + leagueCode + '/scorers?season=' + season + '&limit=50');
        const scorers = Array.isArray(result.scorers) ? result.scorers : [];
        players = scorers.filter(row => {
          const teamName = row.team && row.team.name;
          return sameTeam(teamName, homeName) || sameTeam(teamName, awayName);
        }).map(row => {
          const p = row.player || {};
          const teamName = row.team && row.team.name || '';
          const goals = num(row.goals);
          const assists = num(row.assists);
          const apps = num(row.playedMatches);
          return {
            name: p.name || '',
            team: teamName,
            position: p.position || '',
            goals,
            assists,
            apps,
            minutes: null,
            statsSeason: season,
            source: 'football-data.org',
            starter: false,
            lineupKnown: false,
            injured: false,
            goalIndex: indexFromAppearances(goals, assists, apps, 'goal'),
            gaIndex: indexFromAppearances(goals, assists, apps, 'ga')
          };
        }).filter(p => p.name && p.apps > 0);
        if (!players.length) {
          diagnostics.push('Nessun marcatore/assistman delle due squadre presente nella classifica disponibile per la stagione ' + season + '.');
        }
        diagnostics.push('Statistiche stagionali correnti da football-data.org; presenze e contributi totali, non rendimento delle ultime 5 partite. Formazioni e infortuni non verificati.');
      } catch (e) {
        diagnostics.push(e.message || 'Errore nel recupero delle statistiche da football-data.org.');
      }
    }

    players.sort((a, b) => Math.max(b.goalIndex, b.gaIndex) - Math.max(a.goalIndex, a.gaIndex));
    const message = players.length
      ? 'Statistiche della stagione corrente da football-data.org. Gli indici sono comparativi e basati su gol/assist per presenza; non sono probabilità calibrate. ' + diagnostics.join(' | ')
      : 'Nessun giocatore verificato mostrato: RadarBomber non usa dati storici come se fossero attuali. ' +
        (diagnostics.length ? 'Dettagli: ' + diagnostics.join(' | ') : 'Verifica la configurazione del provider dati.');
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
