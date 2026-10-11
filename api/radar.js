// RadarBomber BSD integration. Scores are comparative indexes, not calibrated probabilities.
const BASE = 'https://sports.bzzoiro.com/api/v2';
const allowed = [
  ['premier league', ['premier league']],
  ['fa cup', ['fa cup']],
  ['efl cup', ['efl cup', 'league cup']],
  ['la liga', ['la liga', 'primera division']],
  ['copa del rey', ['copa del rey']],
  ['bundesliga', ['bundesliga']],
  ['dfb-pokal', ['dfb-pokal', 'dfb pokal']],
  ['ligue 1', ['ligue 1']],
  ['coupe de france', ['coupe de france']],
  ['serie a', ['serie a']],
  ['coppa italia', ['coppa italia']],
  ['champions league', ['champions league']],
  ['europa league', ['europa league']],
  ['conference league', ['conference league']],
  ['nations league', ['nations league']],
  ['world cup', ['world cup', 'fifa world cup']],
  ['european championship', ['european championship', 'uefa euro']],
  ['world cup qualifiers', ['world cup qualification', 'world cup qualifiers', 'wc qualification']],
  ['copa libertadores', ['copa libertadores']],
  ['copa america', ['copa america']]
];
const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function selectedLeague(name) {
  const n = norm(name);
  return allowed.some(([_, aliases]) => aliases.some(a => n === norm(a) || n.includes(norm(a))));
}
async function bsd(path) {
  const key = process.env.BSD_API_KEY;
  if (!key) { const e = new Error('Manca BSD_API_KEY nelle Environment Variables di Vercel.'); e.status = 503; throw e; }
  const r = await fetch(BASE + path, {
    headers: { Authorization: 'Token ' + key },
    signal: AbortSignal.timeout(12000)
  });
  const body = await r.json();
  if (!r.ok) {
    const detail = body && (body.detail || body.error || body.message);
    const e = new Error('BSD HTTP ' + r.status + (detail ? ': ' + String(detail).slice(0, 180) : ''));
    e.status = r.status;
    throw e;
  }
  return Array.isArray(body) ? body : (Array.isArray(body.results) ? body.results : []);
}
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function pick(obj, ...keys) { for (const k of keys) if (obj && obj[k] != null) return obj[k]; return null; }
function eventShape(e) {
  const homeObj = e.home_team || e.homeTeam || {};
  const awayObj = e.away_team || e.awayTeam || {};
  const leagueObj = e.league || e.competition || {};
  const date = pick(e, 'event_date', 'date', 'kickoff', 'start_time');
  return {
    id: pick(e, 'id', 'event_id'),
    date,
    status: norm(pick(e, 'status', 'status_name') || 'upcoming'),
    homeId: pick(e, 'home_team_id') ?? pick(homeObj, 'id', 'team_id'),
    awayId: pick(e, 'away_team_id') ?? pick(awayObj, 'id', 'team_id'),
    home: pick(e, 'home_team_name', 'home', 'home_name') ?? pick(homeObj, 'name', 'team_name') ?? (typeof e.home_team === 'string' ? e.home_team : null),
    away: pick(e, 'away_team_name', 'away', 'away_name') ?? pick(awayObj, 'name', 'team_name') ?? (typeof e.away_team === 'string' ? e.away_team : null),
    leagueId: pick(e, 'league_id', 'competition_id') ?? pick(leagueObj, 'id', 'league_id'),
    league: pick(e, 'league_name', 'competition_name') ?? pick(leagueObj, 'name', 'league_name') ?? (typeof e.league === 'string' ? e.league : null)
  };
}
function toRomeTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit', timeZone:'Europe/Rome'});
}
function leaderboardRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const id = String(pick(r, 'player_id', 'id') ?? '');
    if (!id) continue;
    const prev = map.get(id) || {
      id, name: pick(r, 'player_name', 'name') || 'Giocatore',
      position: pick(r, 'position', 'position_name') || '',
      teamId: pick(r, 'team_id') ?? pick(r.team, 'id'),
      team: pick(r, 'team_name') ?? pick(r.team, 'name') ?? '',
      goals: 0, assists: 0, goalMatches: 0, assistMatches: 0
    };
    map.set(id, prev);
  }
  return map;
}
async function leagueLeaders(leagueId) {
  const [scorers, assists] = await Promise.all([
    bsd('/leagues/' + encodeURIComponent(leagueId) + '/top/scorers/?limit=50'),
    bsd('/leagues/' + encodeURIComponent(leagueId) + '/top/assists/?limit=50')
  ]);
  const map = leaderboardRows(scorers);
  for (const [id, p] of leaderboardRows(assists)) if (!map.has(id)) map.set(id, p);
  for (const r of scorers) {
    const id = String(pick(r, 'player_id', 'id') ?? ''), p = map.get(id);
    if (p) { p.goals = num(r.value ?? r.goals); p.goalMatches = num(r.matches ?? r.appearances); p.position = p.position || pick(r, 'position') || ''; p.teamId = p.teamId ?? r.team_id; p.team = p.team || r.team_name || ''; }
  }
  for (const r of assists) {
    const id = String(pick(r, 'player_id', 'id') ?? ''), p = map.get(id);
    if (p) { p.assists = num(r.value ?? r.assists); p.assistMatches = num(r.matches ?? r.appearances); p.position = p.position || pick(r, 'position') || ''; p.teamId = p.teamId ?? r.team_id; p.team = p.team || r.team_name || ''; }
  }
  return [...map.values()];
}
function scorePlayer(p, fixture) {
  const position = String(p.position || '').toLowerCase();
  if (/goalkeeper|\bkeeper\b|^g$|defender|\bdefence\b|^d$/.test(position)) return null;
  const apps = Math.max(p.goalMatches, p.assistMatches);
  if (!p.name || apps < 3) return null;
  const goalsPerApp = p.goals / Math.max(p.goalMatches || apps, 1);
  const assistsPerApp = p.assists / Math.max(p.assistMatches || apps, 1);
  const gaPerApp = (p.goals + p.assists) / apps;
  const goalIndex = clamp(Math.round(100 * (1 - Math.exp(-goalsPerApp * 1.25))), 0, 99);
  const gaIndex = clamp(Math.round(100 * (1 - Math.exp(-gaPerApp * 0.85))), 0, 99);
  return {
    id: String(p.id), name: p.name, position: p.position || 'Ruolo non specificato',
    goals: p.goals, assists: p.assists, minutes: 0, appearances: apps, starts: 0,
    avgMinutes: 0, startRate: 0, goalsPer90: +goalsPerApp.toFixed(2),
    assistsPer90: +assistsPerApp.toFixed(2), goalsPerAppearance: +goalsPerApp.toFixed(2),
    goalIndex, gaIndex, shots: 0, shotsOnTarget: 0,
    team: fixture.teamName, teamId: fixture.teamId, fixtureId: fixture.id,
    fixture: fixture.home + ' - ' + fixture.away, league: fixture.league,
    time: fixture.time, starter: false, lineupKnown: false,
    opponentConceded: null, teamGoals: null,
    statsSource: 'BSD leaderboard', statsLimited: true
  };
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');
  try {
    const date = String(req.query.date || new Date().toLocaleDateString('en-CA', {timeZone:'Europe/Rome'}));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({error:'Data non valida'}); return; }
    let events = await bsd('/events/?date_from=' + date + '&date_to=' + date + '&limit=200');
    let fallbackUsed = false;
    // Fallback: if the provider's date-filtered endpoint returns no rows, retrieve upcoming
    // events and filter by the requested calendar date in Rome locally.
    if (events.length === 0) {
      const fallbackRows = await bsd('/events/?status=upcoming&limit=200');
      const romeDate = value => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
        const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
        const part = k => parts.find(p => p.type === k)?.value || '';
        return part('year') + '-' + part('month') + '-' + part('day');
      };
      events = fallbackRows.filter(e => romeDate(pick(e, 'event_date', 'date', 'kickoff', 'start_time', 'match_date')) === date);
      fallbackUsed = true;
    }
    const shaped = events.map(eventShape);
    // BSD football event status values may be `notstarted` rather than the generic `upcoming`.
    const upcomingStatuses = new Set(['upcoming', 'notstarted', 'not started', 'scheduled', 'ns', 'tbd', 'fixture']);
    const selected = shaped.filter(e => e.id && e.home && e.away && e.league && selectedLeague(e.league) && upcomingStatuses.has(e.status));
    const fixtures = selected.map(e => ({
      id:e.id, home:e.home, away:e.away, league:e.league, leagueId:e.leagueId,
      time:toRomeTime(e.date), date:e.date, homeId:e.homeId, awayId:e.awayId
    }));
    if (req.query.mode !== 'auto') { res.status(200).json({date,count:fixtures.length,fixtures}); return; }
    const uniqueLeagues = [...new Map(selected.map(e => [String(e.leagueId), e])).values()].filter(e => e.leagueId != null);
    const errors = [];
    const leadersByLeague = new Map();
    await Promise.all(uniqueLeagues.map(async e => {
      try { leadersByLeague.set(String(e.leagueId), await leagueLeaders(e.leagueId)); }
      catch (err) { errors.push({fixture:e.league, error:err.message}); }
    }));
    const players = [];
    for (const e of selected.slice(0, 30)) {
      const leaders = leadersByLeague.get(String(e.leagueId)) || [];
      const teams = [
        {teamId:e.homeId, teamName:e.home},
        {teamId:e.awayId, teamName:e.away}
      ];
      for (const team of teams) {
        if (team.teamId == null) continue;
        const candidates = leaders.filter(p => String(p.teamId) === String(team.teamId));
        for (const p of candidates) {
          const scored = scorePlayer(p, {...e, ...team, time:toRomeTime(e.date)});
          if (scored) players.push(scored);
        }
      }
    }
    players.sort((a,b) => Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
    const failedCount = errors.length;
    const message = failedCount
      ? 'Analisi BSD parziale: non è stato possibile caricare le classifiche di alcune competizioni. I dati non disponibili non sono stati inventati.'
      : 'Radar BSD caricato. Gli indici sono comparativi, non probabilità reali; la fonte disponibile fornisce classifiche stagionali, non minuti/tiri o titolari ufficiali.';
    res.status(200).json({
      date, provider:'BSD', providerEventCount:events.length, fixtureCount:fixtures.length, analyzedCount:Math.min(selected.length,30),
      diagnostics: fixtures.length === 0 ? {fallbackUsed, rawEventKeys: events[0] ? Object.keys(events[0]).slice(0,40) : [], sampleLeagues: [...new Set(shaped.slice(0,20).map(e => e.league).filter(Boolean))], sampleStatuses: [...new Set(shaped.map(e => e.status).filter(Boolean))], sampleEvents: shaped.slice(0,3).map(e => ({id:e.id,home:e.home,away:e.away,league:e.league,status:e.status,date:e.date}))} : undefined,
      failedCount, errors:errors.slice(0,5), players, fixtures, message
    });
  } catch (e) {
    res.status(e.status || 502).json({error:e.message || 'Errore temporaneo BSD'});
  }
};
