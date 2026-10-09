// RadarBomber — primary data source: PitchAPI (free plan, current fixtures and match player stats).
const BASE = 'https://api.pitchapi.dev/v1';
// Competizioni richieste dall'utente. I nomi sono normalizzati per tollerare
// differenze di accenti e punteggiatura restituite dal provider.
const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Alias comuni restituiti dai cataloghi calcistici. La selezione si basa sul
// catalogo ufficiale delle leghe, non sui metadati parziali dell'evento giornaliero.
const LEAGUE_ALIASES = {
  'serie a':'serie a','italian serie a':'serie a',
  'premier league':'premier league','english premier league':'premier league',
  'la liga':'la liga','laliga':'la liga','spanish la liga':'la liga',
  'bundesliga':'bundesliga','german bundesliga':'bundesliga',
  'ligue 1':'ligue 1','french ligue 1':'ligue 1',
  'eredivisie':'eredivisie','dutch eredivisie':'eredivisie',
  'primeira liga':'primeira liga','liga portugal':'primeira liga','portuguese primeira liga':'primeira liga',
  'super lig':'super lig','turkish super lig':'super lig','super lig turkey':'super lig',
  'belgian pro league':'belgian pro league','pro league':'belgian pro league','jupiler pro league':'belgian pro league',
  'saudi pro league':'saudi pro league','saudi professional league':'saudi pro league',
  'scottish premiership':'scottish premiership','scotland premiership':'scottish premiership',
  'mls':'mls','major league soccer':'mls','usa major league soccer':'mls',
  'brasileirao serie a':'brasileirao serie a','serie a brazil':'brasileirao serie a','campeonato brasileiro serie a':'brasileirao serie a',
  'liga profesional':'liga profesional','argentina primera division':'liga profesional','primera division argentina':'liga profesional',
  'greek super league':'greek super league','super league greece':'greek super league',
  'austrian bundesliga':'austrian bundesliga','austria bundesliga':'austrian bundesliga',
  'swiss super league':'swiss super league','super league switzerland':'swiss super league',
  'danish superliga':'danish superliga','superliga denmark':'danish superliga',
  'allsvenskan':'allsvenskan','swedish allsvenskan':'allsvenskan',
  'eliteserien':'eliteserien','norwegian eliteserien':'eliteserien',
  'ekstraklasa':'ekstraklasa','polish ekstraklasa':'ekstraklasa',
  'czech first league':'czech first league','first league czech republic':'czech first league',
  'croatian hnl':'croatian hnl','hnl':'croatian hnl',
  'romanian liga i':'romanian liga i','liga i':'romanian liga i',
  'j league':'j league','j1 league':'j league','japan j1 league':'j league',
  'k league 1':'k league 1','k league 1 south korea':'k league 1',
  'uefa champions league':'uefa champions league','champions league':'uefa champions league',
  'uefa europa league':'uefa europa league','europa league':'uefa europa league',
  'uefa conference league':'uefa conference league','conference league':'uefa conference league',
  'uefa nations league':'uefa nations league','nations league':'uefa nations league',
  'european championship':'european championship','uefa euro':'european championship','europei':'european championship',
  'fifa world cup':'fifa world cup','world cup':'fifa world cup','mondiali':'fifa world cup',
  'uefa european qualifiers':'uefa european qualifiers','european qualifiers':'uefa european qualifiers',
  'world cup qualification europe':'world cup qualification europe','uefa world cup qualifiers':'world cup qualification europe'
};
const LEAGUE_PRIORITY = [
  'Serie A','Premier League','La Liga','Bundesliga','Ligue 1',
  'Eredivisie','Primeira Liga','Süper Lig','Belgian Pro League','Saudi Pro League',
  'UEFA Champions League','UEFA Europa League','UEFA Conference League',
  'UEFA Nations League','European Championship','FIFA World Cup',
  'UEFA European Qualifiers','World Cup Qualification Europe'
];
const EXCLUDED_LEAGUE_NAMES = new Set([
  'serie b','ligue 2','championship','segunda division','2 bundesliga',
  'segunda division portuguesa','liga portugal 2','serie b brasil',
  'brasileirao serie b','segunda division argentina','eerste divisie'
].map(normalize));
const isExcludedLeague = n => !n ||
  EXCLUDED_LEAGUE_NAMES.has(n) ||
  /^(serie b|ligue 2|championship|segunda division|2 bundesliga|liga portugal 2|eerste divisie)( |$)/.test(n) ||
  /\\b(women|womens|ladies|feminine|femenina|femenino|u ?(17|18|19|20|21|23)|youth|reserve|reserves|primavera|development league)\\b/.test(n);
const isRecognizedCup = n =>
  /\\b(cup|copa|coppa|coupe|pokal|beker|taça|taca|supercup|super cup|league cup|fa cup|knvb|dfb pokal|copa del rey|copa do brasil|coppa italia|coupe de france|copa argentina|scottish cup)\\b/.test(n) &&
  !isExcludedLeague(n);
const canonicalLeague = name => {
  const n = normalize(name);
  if (isExcludedLeague(n)) return null;
  if (LEAGUE_ALIASES[n]) return LEAGUE_ALIASES[n];
  // Accetta le principali coppe nazionali non elencate singolarmente nel catalogo,
  // evitando competizioni femminili, giovanili e squadre riserve.
  if (isRecognizedCup(n)) return n;
  return null;
};
const allowed = name => canonicalLeague(name) !== null;
const DOMESTIC_COUNTRY = {
  'serie a': { names:['italy','italia'], codes:['ita','it'] },
  'premier league': { names:['england','inghilterra'], codes:['eng','gb-eng'] },
  'la liga': { names:['spain','spagna'], codes:['esp','es'] },
  'bundesliga': { names:['germany','germania'], codes:['ger','de'] },
  'ligue 1': { names:['france','francia'], codes:['fra','fr'] },
  'eredivisie': { names:['netherlands','the netherlands','paesi bassi','holland'], codes:['ned','nld','nl'] },
  'primeira liga': { names:['portugal'], codes:['por','pt'] },
  'super lig': { names:['turkey','türkiye','turkiye'], codes:['tur','tr'] },
  'belgian pro league': { names:['belgium','belgië','belgie'], codes:['bel','be'] },
  'saudi pro league': { names:['saudi arabia'], codes:['ksa','sa'] },
  'scottish premiership': { names:['scotland'], codes:['sco','sct'] },
  'mls': { names:['usa','united states'], codes:['usa','us'] },
  'brasileirao serie a': { names:['brazil','brasil'], codes:['bra','br'] },
  'liga profesional': { names:['argentina'], codes:['arg','ar'] },
  'greek super league': { names:['greece'], codes:['gre','gr'] },
  'austrian bundesliga': { names:['austria'], codes:['aut','at'] },
  'swiss super league': { names:['switzerland'], codes:['sui','ch'] },
  'danish superliga': { names:['denmark'], codes:['den','dk'] },
  'allsvenskan': { names:['sweden'], codes:['swe','se'] },
  'eliteserien': { names:['norway'], codes:['nor','no'] },
  'ekstraklasa': { names:['poland'], codes:['pol','pl'] },
  'czech first league': { names:['czech republic','czechia'], codes:['cze','cz'] },
  'croatian hnl': { names:['croatia'], codes:['cro','hr'] },
  'romanian liga i': { names:['romania'], codes:['rou','ro'] },
  'j league': { names:['japan'], codes:['jpn','jp'] },
  'k league 1': { names:['south korea','korea republic'], codes:['kor','kr'] }
};
const allowedLeague = league => {
  if (!league) return false;
  const canonical = canonicalLeague(league.name);
  if (!canonical) return false;
  const expected = DOMESTIC_COUNTRY[canonical];
  if (!expected) return true;
  const country = normalize(league.country || '');
  const code = normalize(league.country_code || '');
  if (!country && !code) return true;
  return expected.names.some(c => normalize(c) === country) ||
    expected.codes.some(c => normalize(c) === code);
};
const indexFromRecent = (goals, assists, games, kind) => {
  if (!games) return 0;
  const perMatch = (kind === 'goal' ? goals : goals + assists) / games;
  const score = 100 * (1 - Math.exp(-perMatch * (kind === 'goal' ? 1.35 : 1.0)));
  return Math.max(0, Math.min(99, Math.round(score)));
};
const ODDS_SPORT_BY_LEAGUE = {
  'serie a':'soccer_italy_serie_a',
  'premier league':'soccer_epl',
  'la liga':'soccer_spain_la_liga',
  'bundesliga':'soccer_germany_bundesliga',
  'ligue 1':'soccer_france_ligue_one',
  'eredivisie':'soccer_netherlands_eredivisie',
  'primeira liga':'soccer_portugal_primeira_liga',
  'liga portugal':'soccer_portugal_primeira_liga',
  'uefa champions league':'soccer_uefa_champs_league',
  'uefa europa league':'soccer_uefa_europa_league'
};
const oddsCache = new Map();
const oddsSportForLeague = name => ODDS_SPORT_BY_LEAGUE[normalize(name)];
const teamKey = name => normalize(name)
  .replace(/\b(fc|cf|ac|sc|ssc|as|us|afc|cfc|calcio|club|de|the)\b/g,' ')
  .replace(/\s+/g,' ').trim();
const sameTeam = (a,b) => {
  const x=teamKey(a), y=teamKey(b);
  return !!x && !!y && (x===y || (Math.min(x.length,y.length)>=5 && (x.includes(y)||y.includes(x))));
};
async function oddsEvents(sportKey) {
  const key=(process.env.ODDS_API_KEY||'').trim();
  if(!key) {
    const e=new Error('Per applicare il filtro quote configura ODDS_API_KEY nelle Environment Variables di Vercel.'); e.status=503; throw e;
  }
  const cached=oddsCache.get(sportKey);
  if(cached && Date.now()-cached.at<60000) return cached.events;
  const url='https://api.the-odds-api.com/v4/sports/'+encodeURIComponent(sportKey)+'/odds/?regions=eu&markets=h2h&oddsFormat=decimal&apiKey='+encodeURIComponent(key);
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
  let json=[];
  try{json=await response.json()}catch{}
  if(!response.ok || !Array.isArray(json)) {
    const e=new Error('The Odds API non disponibile per '+sportKey+' (HTTP '+response.status+'). Verifica piano e chiave ODDS_API_KEY.'); e.status=response.status===401||response.status===403?503:502; throw e;
  }
  oddsCache.set(sportKey,{at:Date.now(),events:json});
  return json;
}
function median(values) {
  const v=values.filter(n=>Number.isFinite(n)&&n>1).sort((a,b)=>a-b);
  if(!v.length)return null;
  const m=Math.floor(v.length/2);
  return Number((v.length%2?v[m]:(v[m-1]+v[m])/2).toFixed(2));
}
function getEventPrices(event) {
  const home=[],away=[];
  for(const book of event.bookmakers||[]) {
    const market=(book.markets||[]).find(m=>m.key==='h2h');
    if(!market)continue;
    const h=(market.outcomes||[]).find(o=>sameTeam(o.name,event.home_team));
    const a=(market.outcomes||[]).find(o=>sameTeam(o.name,event.away_team));
    if(h)home.push(Number(h.price));
    if(a)away.push(Number(a.price));
  }
  const homeOdds=median(home),awayOdds=median(away);
  let favorite=null;
  if(homeOdds!=null && awayOdds!=null) {
    if(homeOdds<awayOdds && homeOdds<=2.00)favorite='home';
    else if(awayOdds<homeOdds && awayOdds<=2.00)favorite='away';
  }
  return {homeOdds,awayOdds,favorite,bookmakersCount:Math.min(home.length,away.length)};
}
function matchOddsForFixture(fixture, events) {
  const event=(events||[]).find(e=>sameTeam(e.home_team,fixture.home_team&&fixture.home_team.name)&&sameTeam(e.away_team,fixture.away_team&&fixture.away_team.name));
  if(!event)return null;
  const prices=getEventPrices(event);
  const fixtureTime=Date.parse(fixture.time_utc||fixture.date||'');
  const eventTime=Date.parse(event.commence_time||'');
  if(Number.isFinite(fixtureTime)&&Number.isFinite(eventTime)&&Math.abs(fixtureTime-eventTime)>36*60*60*1000)return null;
  return {...prices,eventId:event.id,updatedAt:event.bookmakers?.[0]?.last_update||null};
}
async function oddsForFixture(fixture) {
  const sportKey=oddsSportForLeague(fixture.league&&fixture.league.name);
  if(!sportKey)return null;
  const events=await oddsEvents(sportKey);
  return matchOddsForFixture(fixture,events);
}
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
      // Convalidiamo le competizioni con il catalogo ufficiale: il solo nome
      // non basta e può includere campionati omonimi o non pertinenti.
      const leagueCatalog = await pitch('/leagues');
      const catalogLeagues = Array.isArray(leagueCatalog.leagues) ? leagueCatalog.leagues : [];
      const catalogById = new Map(catalogLeagues.filter(l=>l.id!=null).map(l=>[String(l.id),l]));
      const supportedLeagueIds = new Set(
        catalogLeagues.filter(allowedLeague).filter(l=>l.id!=null).map(l=>String(l.id))
      );
      // L'endpoint /date può restituire una league con soli id e name. Per non
      // scartare Premier League, La Liga ecc. usiamo country_code e nome completi
      // dal catalogo /leagues associato allo stesso ID.
      const eligibleMatches = matches
        .map(m=>{
          const id=m.league && m.league.id!=null ? String(m.league.id) : '';
          const catalogLeague=catalogById.get(id);
          return catalogLeague ? {...m,league:catalogLeague} : m;
        })
        .filter(m => m.league && m.league.id != null &&
          supportedLeagueIds.has(String(m.league.id)) && allowedLeague(m.league));
      const fixtures = eligibleMatches
        .map(m=>({
          id:String(m.id),
          home:m.home_team&&m.home_team.name||'Squadra casa',
          away:m.away_team&&m.away_team.name||'Squadra ospite',
          league:m.league&&m.league.name||'Competizione',
          time:m.time_utc?new Date(m.time_utc).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}):date,
          status:m.status||'In programma'
        }))
        .sort((a,b)=>{
          const pa=LEAGUE_PRIORITY.findIndex(x=>canonicalLeague(x)===canonicalLeague(a.league));
          const pb=LEAGUE_PRIORITY.findIndex(x=>canonicalLeague(x)===canonicalLeague(b.league));
          return (pa<0?999:pa)-(pb<0?999:pb);
        })
        .slice(0,60);
      const leagueCounts={};
      for(const m of matches){const n=m.league&&m.league.name||'Senza competizione';leagueCounts[n]=(leagueCounts[n]||0)+1;}
      const eligibleLeagueCounts={};
      for(const m of eligibleMatches){const n=m.league&&m.league.name||'Senza competizione';eligibleLeagueCounts[n]=(eligibleLeagueCounts[n]||0)+1;}
      const diagnostics={date,providerFixtures:matches.length,catalogLeagues:catalogLeagues.length,eligibleFixtures:eligibleMatches.length,qualifyingFixtures:fixtures.length,providerLeagueCounts:leagueCounts,eligibleLeagueCounts};
      const message=fixtures.length
        ? 'Partite filtrate per competizioni ammesse. Le quote delle squadre non vengono utilizzate: saranno analizzati i giocatori di entrambe le squadre.'
        : 'Nessuna partita delle competizioni selezionate risulta disponibile su PitchAPI per questa data. Prova un altro giorno.';
      res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=60');
      return res.status(200).json({date,mode:'pitchapi',message,totalFixturesFromProvider:matches.length,filteredFixtures:fixtures.length,diagnostics,fixtures});
    }

    const fixtureId = String(req.query.fixture || '');
    if (!/^m_[A-Za-z0-9]{6}$/.test(fixtureId)) return res.status(400).json({error:'ID partita PitchAPI non valido. Aggiorna il calendario e seleziona una partita della lista.'});
    const fixture = await pitch('/matches/' + encodeURIComponent(fixtureId));
    if (!fixture || !fixture.id) return res.status(404).json({error:'Partita non trovata su PitchAPI.'});
    if (!allowedLeague(fixture.league)) return res.status(403).json({error:'Competizione esclusa: sono ammesse solo le competizioni principali selezionate.'});
    const home = fixture.home_team || {};
    const away = fixture.away_team || {};
    const homeId = String(home.id || '');
    const awayId = String(away.id || '');
    if (!homeId || !awayId) return res.status(502).json({error:'PitchAPI non ha restituito gli identificativi delle due squadre.'});

    // Usiamo la formazione aggiornata della partita: prima quella probabile,
    // poi la stessa risposta passa a confirmed=true quando vengono pubblicati
    // gli undici ufficiali. In entrambi i casi consideriamo SOLO gli starter,
    // mai panchinari o giocatori ricavati da vecchie statistiche.
    let lineupPlayerIds = new Set();
    const lineupPlayersById = new Map();
    let lineupAvailable = false;
    let lineupConfirmed = false;
    let lineupType = '';
    try {
      const lineupData = await pitch('/matches/' + encodeURIComponent(fixtureId) + '/lineups');
      const lineupTeamsMatch =
        String(lineupData.home_team && lineupData.home_team.id || '') === homeId &&
        String(lineupData.away_team && lineupData.away_team.id || '') === awayId;
      const homeStarters = lineupData.home && Array.isArray(lineupData.home.starters) ? lineupData.home.starters : [];
      const awayStarters = lineupData.away && Array.isArray(lineupData.away.starters) ? lineupData.away.starters : [];
      const homeConfirmed = lineupData.home && lineupData.home.confirmed === true;
      const awayConfirmed = lineupData.away && lineupData.away.confirmed === true;
      const homeType = normalize(lineupData.home && lineupData.home.lineup_type || '');
      const awayType = normalize(lineupData.away && lineupData.away.lineup_type || '');
      // "lastStarting11" è l'ultimo undici noto, non una previsione della partita.
      // Reject the whole lineup if either side is only the provider's last known XI.
      // Mixing a current prediction for one team with a historical XI for the other is unsafe.
      const onlyLastKnownXI = (!homeConfirmed && homeType === 'laststarting11') ||
        (!awayConfirmed && awayType === 'laststarting11');
      if (lineupTeamsMatch && homeStarters.length && awayStarters.length && !onlyLastKnownXI) {
        for (const [side, teamId] of [[homeStarters, homeId], [awayStarters, awayId]]) {
          for (const p of side) {
            if (p && p.player_id) {
              const playerId = String(p.player_id);
              lineupPlayerIds.add(playerId);
              lineupPlayersById.set(playerId, {
                name: p.name || '',
                teamId,
                shirtNumber: p.shirt_number || ''
              });
            }
          }
        }
        lineupAvailable = lineupPlayerIds.size > 0;
        lineupConfirmed = lineupData.home.confirmed === true && lineupData.away.confirmed === true;
        lineupType = lineupConfirmed ? 'ufficiale' : 'probabile';
      }
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
          statsSeason:'ultime 3 partite concluse',source:'PitchAPI player match stats',starter:false,lineupKnown:false,lineupConfirmed:false,lineupType:'',injured:false
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
      .map(p=>{
        const officialSource = lineupPlayersById.get(String(p.id));
        return {...p,
        name: officialSource && officialSource.name || p.name,
        team: p.teamId===homeId?home.name:away.name,
        shirtNumber: officialSource && officialSource.shirtNumber || '',
        starter:true,lineupKnown:true,lineupConfirmed,lineupType,
        goalIndex:indexFromRecent(p.goals,p.assists,Math.max(1,p.recentMatches),'goal'),
        gaIndex:indexFromRecent(p.goals,p.assists,Math.max(1,p.recentMatches),'ga')
      };})
      .sort((a,b)=>Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
    const diagnostics = [];
    if (homeRecent.length<3 || awayRecent.length<3) diagnostics.push('Campione recente incompleto: ultime gare trovate casa='+homeRecent.length+', ospite='+awayRecent.length+'.');
    if (!uniqueMatches.length) diagnostics.push('Non sono state trovate partite concluse recenti per entrambe le squadre nei campionati coperti.');
    diagnostics.push('Fonte: PitchAPI. Indici comparativi derivati da gol e assist nelle partite recenti; non sono probabilità calibrate. La formazione viene aggiornata dal provider e può cambiare fino alla pubblicazione ufficiale.');
    const message = players.length
      ? 'Quote delle squadre ignorate. Giocatori selezionati da entrambe le squadre. '+(lineupConfirmed
          ? 'Formazione ufficiale pubblicata: elenco limitato ai titolari ufficiali.'
          : 'Formazione probabile: elenco provvisorio dei titolari previsti, aggiornabile quando PitchAPI pubblica gli undici ufficiali.') + ' ' + diagnostics.join(' | ')
      : !lineupAvailable
        ? 'PitchAPI non ha ancora fornito una formazione attuale utilizzabile per questa partita. Se il provider restituisce solo l’ultimo undici noto, i nomi vengono esclusi per evitare giocatori vecchi; riprova quando pubblica una formazione aggiornata.'
        : (lineupConfirmed
          ? 'Nessun titolare ufficiale ha gol o assist rilevati nelle partite recenti disponibili. '
          : 'Nessun titolare probabile ha gol o assist rilevati nelle partite recenti disponibili. ') + diagnostics.join(' | ');
    // L'analisi non va memorizzata a lungo: rose e formazioni possono cambiare.
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).json({message,diagnostics,odds:null,players:players.slice(0,24)});
  } catch (error) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    const status = error.status || 502;
    return res.status(status).json({error:error.message || 'Errore temporaneo del provider'});
  }
};
