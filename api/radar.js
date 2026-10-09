// RadarBomber — primary data source: PitchAPI (free plan, current fixtures and match player stats).
const BASE = 'https://api.pitchapi.dev/v1';
// Competizioni richieste dall'utente. I nomi sono normalizzati per tollerare
// differenze di accenti e punteggiatura restituite dal provider.
const LEAGUE_PRIORITY = [
  // Campionati nazionali prioritari
  'Serie A','Premier League','La Liga','Bundesliga','Ligue 1',
  'Eredivisie','Primeira Liga','Liga Portugal','Saudi Pro League',
  'Saudi Pro League Roshn Saudi League','Super Lig','Süper Lig',
  'Belgian Pro League','Jupiler Pro League',
  // Coppe europee per club
  'UEFA Champions League','Champions League',
  'UEFA Europa League','Europa League',
  'UEFA Conference League','Conference League',
  // Nazionali: tornei e qualificazioni europee.
  // Escludiamo le competizioni sudamericane e le qualificazioni mondiali
  // senza indicazione geografica, che possono includere CONMEBOL.
  'UEFA Nations League','Nations League',
  'European Championship','UEFA Euro','Europei',
  'FIFA World Cup','World Cup','Mondiali',
  'UEFA European Qualifiers','European Qualifiers',
  'World Cup Qualification Europe','UEFA World Cup Qualifiers'
];
const ALLOWED_LEAGUES = LEAGUE_PRIORITY;
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const allowed = name => ALLOWED_LEAGUES.some(x => normalize(x) === normalize(name));
const indexFromRecent = (goals, assists, games, kind) => {
  if (!games) return 0;
  const perMatch = (kind === 'goal' ? goals : goals + assists) / games;
  const score = 100 * (1 - Math.exp(-perMatch * (kind === 'goal' ? 1.35 : 1.0)));
  return Math.max(0, Math.min(99, Math.round(score)));
};
async function pitch(path) {
  const key = (process.env.PITCHAPI_API_KEY || '').trim();
  if (!key) {
    const e = new Error('Per attivare i dati aggiornati serve PITCHAPI_API_KEY nelle Environment Variables di Vercel. Crea prima una chiave gratuita su https://pitchapi.dev/.');
    e.status = 503;
    throw e;
  }
  const response = await fetch(BASE + path, {
    headers: { 'X-API-KEY': key },
    signal: AbortSignal.timeout(15000)
  });
  let json;
  try { json = await response.json(); } catch { json = {}; }
  if (!response.ok || json.error) {
    const msg = json.error && (json.error.message || json.error.code) || ('HTTP ' + response.status);
    const e = new Error('PitchAPI: ' + msg);
    e.status = response.status || 502;
    throw e;
  }
  return json.data ?? {};
}
const dateOnly = d => d.toISOString().slice(0, 10);
function getStat(player, statKey) {
  for (const group of (player.stats || [])) {
    const stats = group.stats || {};
    for (const value of Object.values(stats)) {
      if (value && value.key === statKey && value.stat) return Number(value.stat.value || 0);
    }
  }
  return 0;
}
const positionName = id => ({0:'Portiere',1:'Difensore',2:'Centrocampista',3:'Attaccante',4:'Attaccante'})[Number(id)] || '';
module.exports = async function handler(req, res) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const today = `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}-${parts.find(p=>p.type==='day').value}`;
    const date = String(req.query.date || today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'Data non valida'});
    if (!req.query.fixture) {
      const result = await pitch('/date/' + encodeURIComponent(date) + '?status=upcoming');
      const matches = Array.isArray(result.matches) ? result.matches : [];
      const fixtures = matches
        .filter(m => allowed(m.league && m.league.name))
        .sort((a,b) => {
          const pa = LEAGUE_PRIORITY.findIndex(x => normalize(x) === normalize(a.league && a.league.name));
          const pb = LEAGUE_PRIORITY.findIndex(x => normalize(x) === normalize(b.league && b.league.name));
          return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb) ||
            String(a.time_utc || '').localeCompare(String(b.time_utc || ''));
        })
        .slice(0,24)
        .map(m => ({
          id: String(m.id),
          home: m.home_team && m.home_team.name || 'Squadra casa',
          away: m.away_team && m.away_team.name || 'Squadra ospite',
          league: m.league && m.league.name || 'Competizione',
          time: m.time_utc ? new Date(m.time_utc).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}) : date,
          status: m.status || 'In programma'
        }));
      const message = fixtures.length
        ? 'Calendario aggiornato da PitchAPI. Analisi giocatori basata sui dati delle partite recenti disponibili; copertura limitata alle competizioni elencate nei filtri.'
        : 'PitchAPI non restituisce partite in programma nelle competizioni selezionate per questa data. Prova un’altra data o verifica la copertura del campionato.';
      res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=60');
      return res.status(200).json({date,mode:'pitchapi',message,totalFixturesFromProvider:matches.length,filteredFixtures:fixtures.length,fixtures});
    }

    const fixtureId = String(req.query.fixture || '');
    if (!/^m_[A-Za-z0-9]{6}$/.test(fixtureId)) return res.status(400).json({error:'ID partita PitchAPI non valido. Aggiorna il calendario e seleziona una partita della lista.'});
    const fixture = await pitch('/matches/' + encodeURIComponent(fixtureId));
    if (!fixture || !fixture.id) return res.status(404).json({error:'Partita non trovata su PitchAPI.'});
    const home = fixture.home_team || {};
    const away = fixture.away_team || {};
    const homeId = String(home.id || '');
    const awayId = String(away.id || '');
    if (!homeId || !awayId) return res.status(502).json({error:'PitchAPI non ha restituito gli identificativi delle due squadre.'});

    // Per evitare giocatori rimasti associati a una vecchia squadra, accettiamo solo
    // gli ID presenti nella formazione prevista/confermata della partita selezionata.
    let lineupPlayerIds = new Set();
    let lineupAvailable = false;
    try {
      const lineupData = await pitch('/matches/' + encodeURIComponent(fixtureId) + '/lineups');
      // Le formazioni previste possono essere costruite dal provider usando
      // l'ultimo undici disponibile e contenere giocatori ormai trasferiti.
      // Accettiamo quindi solo formazioni CONFERMATE e riferite alle squadre
      // esatte della partita selezionata.
      const lineupTeamsMatch =
        String(lineupData.home_team && lineupData.home_team.id || '') === homeId &&
        String(lineupData.away_team && lineupData.away_team.id || '') === awayId;
      const lineupsConfirmed = lineupTeamsMatch &&
        lineupData.home && lineupData.home.confirmed === true &&
        lineupData.away && lineupData.away.confirmed === true;
      if (lineupsConfirmed) {
        for (const side of [lineupData.home, lineupData.away]) {
          for (const p of [...(side && side.starters || []), ...(side && side.bench || [])]) {
            if (p && p.player_id) lineupPlayerIds.add(String(p.player_id));
          }
        }
      }
      lineupAvailable = lineupsConfirmed && lineupPlayerIds.size > 0;
    } catch {}

    // Get the current seasons for the supported leagues and search the most recent completed
    // fixtures involving either team. No historic-season fallback is used.
    const leagueData = await pitch('/leagues');
    const leagues = (leagueData.leagues || []).filter(l => allowed(l.name) && l.id);
    const leagueResults = await Promise.all(leagues.map(async league => {
      try {
        // Ask the league resource for its declared current season. Never assume seasons[0]
        // is current: some provider responses may return seasons in an unexpected order.
        const current = await pitch('/leagues/' + encodeURIComponent(league.id));
        const currentSeason = current.season;
        if (!currentSeason) return [];
        const data = await pitch('/leagues/' + encodeURIComponent(league.id) + '/matches?season=' + encodeURIComponent(currentSeason) + '&status=all');
        return (data.matches || []).map(m => ({...m, leagueName: (data.league && data.league.name) || league.name, _season: currentSeason}));
      } catch { return []; }
    }));
    const allMatches = [...new Map(leagueResults.flat().map(m => [m.id,m])).values()];
    const targetDate = String(fixture.date || date);
    const targetMs = Date.parse(targetDate + 'T23:59:59Z');
    const earliestMs = targetMs - 50 * 24 * 60 * 60 * 1000;
    const recentFor = teamId => allMatches
      .filter(m => {
        const ids = [String(m.home_team && m.home_team.id || ''),String(m.away_team && m.away_team.id || '')];
        const status = normalize(m.status);
        const matchMs = Date.parse(String(m.date || '') + 'T12:00:00Z');
        const finished = status === 'finished' || status === 'complete' || status === 'completed' || (m.score_home != null && m.score_away != null);
        return ids.includes(teamId) && m.id !== fixtureId &&
          Number.isFinite(matchMs) && matchMs >= earliestMs && matchMs < targetMs && finished;
      })
      .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0,3);
    const homeRecent = recentFor(homeId);
    const awayRecent = recentFor(awayId);
    const gamesByTeam = new Map([[homeId,homeRecent.length],[awayId,awayRecent.length]]);
    const uniqueMatches = [...new Map([...homeRecent,...awayRecent].map(m=>[m.id,m])).values()];
    const playerResults = await Promise.all(uniqueMatches.map(async m => {
      try {
        const data = await pitch('/matches/' + encodeURIComponent(m.id) + '/players');
        return {match:m,players:Array.isArray(data) ? data : []};
      } catch (e) { return {match:m,players:[],error:e.message}; }
    }));
    const playersByKey = new Map();
    for (const result of playerResults) {
      if (result.error) continue;
      for (const p of result.players) {
        const teamId = String(p.team_id || '');
        if (teamId !== homeId && teamId !== awayId) continue;
        const player = p.player || {};
        if (!player.id || !player.name) continue;
        const key = teamId + ':' + player.id;
        if (!playersByKey.has(key)) playersByKey.set(key, {
          id:String(player.id),name:player.name,team:teamId===homeId?home.name:away.name,teamId,
          position:positionName(player.position_id),goals:0,assists:0,recentMatches:gamesByTeam.get(teamId)||0,
          statsSeason:'ultime 3 partite concluse',source:'PitchAPI player match stats',starter:false,lineupKnown:false,injured:false
        });
        const entry = playersByKey.get(key);
        entry.goals += getStat(p,'goals');
        entry.assists += getStat(p,'assists');
      }
    }
    const players = [...playersByKey.values()]
      // Se il provider non pubblica ancora una formazione, non mostriamo nomi che
      // potrebbero appartenere a rose precedenti. Quando è disponibile, la formazione
      // è l'unica lista autorizzata per questa partita.
      .filter(p=>lineupAvailable && lineupPlayerIds.has(String(p.id)) && (p.goals>0||p.assists>0))
      .map(p=>({...p,
        goalIndex:indexFromRecent(p.goals,p.assists,Math.max(1,p.recentMatches),'goal'),
        gaIndex:indexFromRecent(p.goals,p.assists,Math.max(1,p.recentMatches),'ga')
      }))
      .sort((a,b)=>Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
    const diagnostics = [];
    if (homeRecent.length<3 || awayRecent.length<3) diagnostics.push('Campione recente incompleto: ultime gare trovate casa='+homeRecent.length+', ospite='+awayRecent.length+'.');
    if (!uniqueMatches.length) diagnostics.push('Non sono state trovate partite concluse recenti per entrambe le squadre nei campionati coperti.');
    diagnostics.push('Fonte: PitchAPI. Indici comparativi derivati da gol e assist nelle partite recenti; non sono probabilità calibrate. Formazioni e infortuni non sono verificati.');
    const message = players.length
      ? 'Radar forma recente: giocatori con gol o assist nelle ultime gare, verificati anche nella formazione prevista/confermata della partita selezionata. ' + diagnostics.join(' | ')
      : !lineupAvailable
        ? 'Formazione confermata e verificata non ancora disponibile su PitchAPI. Le formazioni previste non vengono usate perché possono contenere giocatori di rose precedenti: la lista resta vuota finché la formazione ufficiale non è confermata.'
        : 'Nessun giocatore della formazione pubblicata ha gol o assist rilevati nelle partite recenti disponibili. ' + diagnostics.join(' | ');
    // L'analisi non va memorizzata a lungo: rose e formazioni possono cambiare.
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).json({message,diagnostics,players:players.slice(0,24)});
  } catch (error) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    const status = error.status || 502;
    return res.status(status).json({error:error.message || 'Errore temporaneo del provider'});
  }
};
