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
  /^(serie b|ligue 2|championship|segunda division|2 bundesliga|liga portugal 2|eerste divisie|ecuador)( |$)/.test(n) ||
  /\b(women|womens|ladies|feminine|femenina|femenino|u ?(17|18|19|20|21|23)|youth|reserve|reserves|primavera|development league|serie b|liga pro ecuador|liga pro|liga ecuabet)\b/.test(n);
const isRecognizedCup = n =>
  /\b(cup|copa|coppa|coupe|pokal|beker|taça|taca|supercup|super cup|league cup|fa cup|knvb|dfb pokal|copa del rey|copa do brasil|coppa italia|coupe de france|copa argentina|scottish cup)\b/.test(n) &&
  !isExcludedLeague(n) && !/ecuador|liga pro/.test(n);
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
  const leagueName = normalize(league.name || '');
  const leagueCountry = normalize(league.country || '');
  const leagueCountryCode = normalize(league.country_code || '');
  // Esclusione esplicita: niente campionati/coppe dell'Ecuador né seconde divisioni.
  if (leagueCountry === 'ecuador' || leagueCountryCode === 'ecu' ||
      /\b(ecuador|liga pro|serie b|segunda division|ligue 2|2 bundesliga|championship|eerste divisie)\b/.test(leagueName)) return false;
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
const clamp = n => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
const poissonPercent = rate => Math.round(clamp((1 - Math.exp(-Math.max(0, rate))) * 100));
const contextMultiplier = (attack, defense) => {
  const a = Number.isFinite(attack) && attack > 0 ? attack / 1.45 : 1;
  const d = Number.isFinite(defense) && defense > 0 ? defense / 1.35 : 1;
  return Math.max(0.72, Math.min(1.28, Math.sqrt(a * d)));
};
const rateScore = (value, ceiling) => clamp((Math.max(0, value || 0) / ceiling) * 100);
// Accettiamo il ruolo di rigorista soltanto quando il provider espone un campo esplicito.
// Non deduciamo il rigorista dal solo numero di rigori trasformati.
function designatedPenaltyTaker(player) {
  const values=[
    player?.penalty_taker,player?.penaltyTaker,player?.is_penalty_taker,
    player?.isPenaltyTaker,player?.designated_penalty_taker,player?.designatedPenaltyTaker,
    player?.penalties?.taker,player?.penalties?.is_taker,player?.penalty_order,player?.penaltyOrder
  ];
  for(const value of values){
    if(typeof value==='boolean') return value;
    if(typeof value==='number' && Number.isFinite(value)) return value>0;
    if(typeof value==='string'){
      const v=normalize(value);
      if(['true','yes','si','designated','first','primary','1'].includes(v)) return true;
      if(['false','no','not designated','0','none'].includes(v)) return false;
    }
  }
  return null;
}
const statAny = (player, keys) => {
  for (const key of keys) {
    const value = getStat(player, key);
    if (value > 0) return value;
  }
  return 0;
};
const weighted = parts => Math.round(parts.reduce((sum, [value, weight]) => sum + clamp(value) * weight, 0) / 100);
const ODDS_SPORT_BY_LEAGUE = {
  'serie a':'soccer_italy_serie_a','italian serie a':'soccer_italy_serie_a',
  'premier league':'soccer_epl','english premier league':'soccer_epl',
  'la liga':'soccer_spain_la_liga','laliga':'soccer_spain_la_liga','spanish la liga':'soccer_spain_la_liga',
  'bundesliga':'soccer_germany_bundesliga','german bundesliga':'soccer_germany_bundesliga',
  'ligue 1':'soccer_france_ligue_one','french ligue 1':'soccer_france_ligue_one',
  'eredivisie':'soccer_netherlands_eredivisie','dutch eredivisie':'soccer_netherlands_eredivisie',
  'primeira liga':'soccer_portugal_primeira_liga','liga portugal':'soccer_portugal_primeira_liga','portuguese primeira liga':'soccer_portugal_primeira_liga',
  'uefa champions league':'soccer_uefa_champs_league','champions league':'soccer_uefa_champs_league',
  'uefa europa league':'soccer_uefa_europa_league','europa league':'soccer_uefa_europa_league',
  'uefa conference league':'soccer_uefa_europa_conference_league','conference league':'soccer_uefa_europa_conference_league',
  'super lig':'soccer_turkey_super_league','turkish super lig':'soccer_turkey_super_league',
  'belgian pro league':'soccer_belgium_first_div','pro league':'soccer_belgium_first_div','jupiler pro league':'soccer_belgium_first_div',
  'saudi pro league':'soccer_saudi_arabia_pro_league','saudi professional league':'soccer_saudi_arabia_pro_league',
  'scottish premiership':'soccer_spl','scotland premiership':'soccer_spl',
  'mls':'soccer_usa_mls','major league soccer':'soccer_usa_mls',
  'brasileirao serie a':'soccer_brazil_campeonato','serie a brazil':'soccer_brazil_campeonato','campeonato brasileiro serie a':'soccer_brazil_campeonato',
  'liga profesional':'soccer_argentina_primera_division','argentina primera division':'soccer_argentina_primera_division',
  'greek super league':'soccer_greece_super_league','super league greece':'soccer_greece_super_league',
  'austrian bundesliga':'soccer_austria_bundesliga','austria bundesliga':'soccer_austria_bundesliga',
  'danish superliga':'soccer_denmark_superliga','superliga denmark':'soccer_denmark_superliga',
  'allsvenskan':'soccer_sweden_allsvenskan','swedish allsvenskan':'soccer_sweden_allsvenskan',
  'eliteserien':'soccer_norway_eliteserien','norwegian eliteserien':'soccer_norway_eliteserien',
  'ekstraklasa':'soccer_poland_ekstraklasa','polish ekstraklasa':'soccer_poland_ekstraklasa',
  'j league':'soccer_japan_j_league','j1 league':'soccer_japan_j_league',
  'k league 1':'soccer_korea_kleague1',
  'coppa italia':'soccer_italy_coppa_italia','italy coppa italia':'soccer_italy_coppa_italia',
  'fa cup':'soccer_fa_cup','english fa cup':'soccer_fa_cup',
  'efl cup':'soccer_england_efl_cup','league cup':'soccer_england_efl_cup',
  'copa del rey':'soccer_spain_copa_del_rey',
  'dfb pokal':'soccer_germany_dfb_pokal','german cup':'soccer_germany_dfb_pokal',
  'coupe de france':'soccer_france_coupe_de_france',
  'uefa nations league':'soccer_uefa_nations_league','nations league':'soccer_uefa_nations_league',
  'european championship':'soccer_uefa_european_championship','uefa euro':'soccer_uefa_european_championship',
  'fifa world cup':'soccer_fifa_world_cup','world cup':'soccer_fifa_world_cup',
  'uefa european qualifiers':'soccer_fifa_world_cup_qualifiers_europe',
  'world cup qualification europe':'soccer_fifa_world_cup_qualifiers_europe',
  'copa libertadores':'soccer_conmebol_copa_libertadores',
  'copa sudamericana':'soccer_conmebol_copa_sudamericana'
};
const oddsCache = new Map();
// Deduplica le richieste simultanee alla stessa competizione: senza questa
// cache in-flight ogni partita della stessa lega avviava una chiamata quote
// separata e poteva esaurire il limite API, facendo scartare tutte le gare.
const oddsInFlight = new Map();
const providerCache = new Map();
const h2hCache = new Map();
const h2hPlayerCache = new Map();
const historicalLeagueCache = new Map();
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
  if(oddsInFlight.has(sportKey)) return oddsInFlight.get(sportKey);
  const request=(async()=>{
    const url='https://api.the-odds-api.com/v4/sports/'+encodeURIComponent(sportKey)+'/odds/?regions=eu&markets=h2h&oddsFormat=decimal&apiKey='+encodeURIComponent(key);
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    let json=[];
    try{json=await response.json()}catch{}
    if(!response.ok || !Array.isArray(json)) {
      const detail=json&&typeof json.message==='string'?': '+json.message:'';
      const e=new Error('The Odds API non disponibile per '+sportKey+' (HTTP '+response.status+')'+detail+'. Verifica piano e chiave ODDS_API_KEY.');
      e.status=response.status===401||response.status===403?503:502; throw e;
    }
    oddsCache.set(sportKey,{at:Date.now(),events:json});
    return json;
  })();
  oddsInFlight.set(sportKey,request);
  try{return await request;}
  finally{oddsInFlight.delete(sportKey);}
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
  const homeName=fixture.home_team&&fixture.home_team.name||'';
  const awayName=fixture.away_team&&fixture.away_team.name||'';
  const fixtureTime=Date.parse(fixture.time_utc||fixture.date||'');
  // Non agganciamo quote di una gara diversa: stesso ordine casa/trasferta,
  // squadre compatibili e calcio d'inizio entro 8 ore quando entrambi gli orari esistono.
  const candidates=(events||[]).filter(e=>{
    if(!sameTeam(e.home_team,homeName)||!sameTeam(e.away_team,awayName))return false;
    const eventTime=Date.parse(e.commence_time||'');
    if(Number.isFinite(fixtureTime)&&Number.isFinite(eventTime)&&Math.abs(fixtureTime-eventTime)>8*60*60*1000)return false;
    return true;
  });
  if(!candidates.length)return null;
  candidates.sort((a,b)=>{
    const exactA=normalize(a.home_team)===normalize(homeName)&&normalize(a.away_team)===normalize(awayName)?0:1;
    const exactB=normalize(b.home_team)===normalize(homeName)&&normalize(b.away_team)===normalize(awayName)?0:1;
    if(exactA!==exactB)return exactA-exactB;
    const ta=Date.parse(a.commence_time||''),tb=Date.parse(b.commence_time||'');
    if(Number.isFinite(fixtureTime)&&Number.isFinite(ta)&&Number.isFinite(tb))return Math.abs(ta-fixtureTime)-Math.abs(tb-fixtureTime);
    return 0;
  });
  const event=candidates[0];
  const prices=getEventPrices(event);
  return {...prices,eventId:event.id,updatedAt:event.bookmakers?.[0]?.last_update||null,oddsSource:'The Odds API'};
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
async function pitchCached(path, ttlMs=10*60*1000) {
  const cached=providerCache.get(path);
  if(cached && Date.now()-cached.at<ttlMs) return cached.data;
  const data=await pitch(path);
  providerCache.set(path,{at:Date.now(),data});
  return data;
}
const dateOnly = d => d.toISOString().slice(0, 10);
const seasonBefore = (season, offset) => {
  const s=String(season||'');
  const range=s.match(/^(\d{4})\/(\d{4})$/);
  if(range) return (Number(range[1])-offset)+'/'+(Number(range[2])-offset);
  const year=Number(s);
  return Number.isFinite(year) ? String(year-offset) : '';
};
async function cachedH2H(fixtureId) {
  const cached=h2hCache.get(fixtureId);
  if(cached && Date.now()-cached.at<6*60*60*1000) return cached.data;
  const data=await pitchCached('/matches/'+encodeURIComponent(fixtureId)+'/h2h',6*60*60*1000);
  h2hCache.set(fixtureId,{at:Date.now(),data});
  return data;
}
async function cachedMatchPlayers(matchId) {
  const cached=h2hPlayerCache.get(matchId);
  if(cached && Date.now()-cached.at<24*60*60*1000) return cached.players;
  const players=await pitch('/matches/'+encodeURIComponent(matchId)+'/players');
  const list=Array.isArray(players)?players:[];
  h2hPlayerCache.set(matchId,{at:Date.now(),players:list});
  return list;
}
async function historicalMatchesForLeague(leagueId, season) {
  if(!leagueId) return [];
  if(!season) {
    try { const meta=await pitchCached('/leagues/'+encodeURIComponent(leagueId),6*60*60*1000); season=meta.season||''; } catch {}
  }
  if(!season) return [];
  const seasons=[1,2,3].map(offset=>seasonBefore(season,offset)).filter(Boolean);
  const key=String(leagueId)+':'+seasons.join(',');
  const cached=historicalLeagueCache.get(key);
  if(cached && Date.now()-cached.at<12*60*60*1000) return cached.matches;
  const results=await Promise.all(seasons.map(async s=>{
    try {
      const data=await pitchCached('/leagues/'+encodeURIComponent(leagueId)+'/matches?season='+encodeURIComponent(s)+'&status=all',12*60*60*1000);
      return (data.matches||[]).map(m=>({...m,leagueName:data.league&&data.league.name||'',_season:s}));
    } catch { return []; }
  }));
  const matches=[...new Map(results.flat().filter(m=>m&&m.id).map(m=>[String(m.id),m])).values()];
  historicalLeagueCache.set(key,{at:Date.now(),matches});
  return matches;
}
function matchDateKey(m) {
  const value=m && (m.date || m.time_utc || m.kickoff || '');
  if(!value) return '';
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)?new Date(parsed).toISOString().slice(0,10):String(value).slice(0,10);
}
function matchTeams(m) {
  return {
    home:String(m && (m.home_team&&m.home_team.id || m.home&&m.home.id) || ''),
    away:String(m && (m.away_team&&m.away_team.id || m.away&&m.away.id) || '')
  };
}
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
      const leagueCatalog = await pitchCached('/leagues',6*60*60*1000);
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
      // Le quote 1X2 sono un filtro obbligatorio PRIMA dell'analisi dei giocatori.
      // Casa: favorita e quota <= 1,65. Trasferta: favorita e quota <= 1,55.
      // Verifichiamo prima le partite dei campionati ammessi; la cache quote evita
      // richieste ripetute alla stessa competizione.
      const orderedEligibleMatches = eligibleMatches.slice().sort((a,b)=>{
        const la=a.league&&a.league.name||'', lb=b.league&&b.league.name||'';
        const pa=LEAGUE_PRIORITY.findIndex(x=>canonicalLeague(x)===canonicalLeague(la));
        const pb=LEAGUE_PRIORITY.findIndex(x=>canonicalLeague(x)===canonicalLeague(lb));
        return (pa<0?999:pa)-(pb<0?999:pb);
      });
      const oddsChecks = await Promise.all(orderedEligibleMatches.map(async m=>{
        try {
          const prices=await oddsForFixture(m);
          if(!prices || prices.homeOdds==null || prices.awayOdds==null) return null;
          const homeFavorite=prices.homeOdds<prices.awayOdds && prices.homeOdds<=1.65;
          const awayFavorite=prices.awayOdds<prices.homeOdds && prices.awayOdds<=1.55;
          if(!homeFavorite && !awayFavorite) return null;
          return {m,prices,favorite:homeFavorite?'home':'away'};
        } catch { return null; }
      }));
      const qualifiedMatches=oddsChecks.filter(Boolean);
      const fixtures = qualifiedMatches.slice(0,60).map(({m,prices,favorite})=>({
        id:String(m.id),
        home:m.home_team&&m.home_team.name||'Squadra casa',
        away:m.away_team&&m.away_team.name||'Squadra ospite',
        league:m.league&&m.league.name||'Competizione',
        time:m.time_utc?new Date(m.time_utc).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}):date,
        status:m.status||'In programma',
        homeOdds:prices.homeOdds,
        awayOdds:prices.awayOdds,
        favorite,
        favoriteTeam:favorite==='home'?(m.home_team&&m.home_team.name||'Squadra casa'):(m.away_team&&m.away_team.name||'Squadra ospite'),
        oddsFilter:favorite==='home'?'Casa ≤ 1,65':'Trasferta ≤ 1,55',
        bookmakersCount:prices.bookmakersCount||0
      }));
      const leagueCounts={};
      for(const m of matches){const n=m.league&&m.league.name||'Senza competizione';leagueCounts[n]=(leagueCounts[n]||0)+1;}
      const eligibleLeagueCounts={};
      for(const m of eligibleMatches){const n=m.league&&m.league.name||'Senza competizione';eligibleLeagueCounts[n]=(eligibleLeagueCounts[n]||0)+1;}
      const diagnostics={date,providerFixtures:matches.length,catalogLeagues:catalogLeagues.length,eligibleFixtures:eligibleMatches.length,qualifyingFixtures:fixtures.length,providerLeagueCounts:leagueCounts,eligibleLeagueCounts};
      const message=fixtures.length
        ? 'Filtro obbligatorio applicato: favorita in casa ≤ 1,65 oppure favorita in trasferta ≤ 1,55. Sono incluse solo partite con quote 1X2 disponibili; nell’analisi saranno valutati i giocatori della sola squadra favorita.'
        : 'Nessuna partita delle competizioni ammesse supera il filtro quote: favorita in casa ≤ 1,65 oppure favorita in trasferta ≤ 1,55. Le partite senza quote disponibili sono escluse.';
      res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=60');
      return res.status(200).json({date,mode:'pitchapi',message,totalFixturesFromProvider:matches.length,eligibleFixtures:eligibleMatches.length,qualifiedByOdds:qualifiedMatches.length,filteredFixtures:fixtures.length,oddsRules:{homeFavoriteMax:1.65,awayFavoriteMax:1.55,missingOdds:'exclude'},diagnostics,fixtures});
    }

    const fixtureId = String(req.query.fixture || '');
    if (!/^m_[A-Za-z0-9]{6}$/.test(fixtureId)) return res.status(400).json({error:'ID partita PitchAPI non valido. Aggiorna il calendario e seleziona una partita della lista.'});
    const fixture = await pitch('/matches/' + encodeURIComponent(fixtureId));
    if (!fixture || !fixture.id) return res.status(404).json({error:'Partita non trovata su PitchAPI.'});
    if (!allowedLeague(fixture.league)) return res.status(403).json({error:'Competizione esclusa: sono ammesse solo le competizioni principali selezionate.'});
    // Il filtro quote è vincolante anche aprendo direttamente una partita:
    // nessuna analisi se mancano le quote o se la favorita supera la soglia prevista.
    let matchOdds = null;
    try { matchOdds = await oddsForFixture(fixture); } catch {}
    const homeOdds = matchOdds && Number.isFinite(Number(matchOdds.homeOdds)) ? Number(matchOdds.homeOdds) : null;
    const awayOdds = matchOdds && Number.isFinite(Number(matchOdds.awayOdds)) ? Number(matchOdds.awayOdds) : null;
    const oddsAvailable = homeOdds !== null && awayOdds !== null;
    const homeIsQualifiedFavorite = oddsAvailable && homeOdds < awayOdds && homeOdds <= 1.65;
    const awayIsQualifiedFavorite = oddsAvailable && awayOdds < homeOdds && awayOdds <= 1.55;
    if (!homeIsQualifiedFavorite && !awayIsQualifiedFavorite) {
      return res.status(422).json({error:!oddsAvailable
        ? 'Partita esclusa: quote 1X2 non disponibili. Il filtro quote è obbligatorio.'
        : 'Partita esclusa dal filtro quote: favorita in casa ≤ 1,65 oppure favorita in trasferta ≤ 1,55.',
        odds:{home:homeOdds,away:awayOdds},rules:{homeFavoriteMax:1.65,awayFavoriteMax:1.55}});
    }
    const favoriteSide = homeIsQualifiedFavorite ? 'home' : 'away';
    const favoriteTeamId = homeIsQualifiedFavorite ? String(fixture.home_team&&fixture.home_team.id||'') : String(fixture.away_team&&fixture.away_team.id||'');
    const oddsSideScore = odds => odds == null ? 0 : odds <= 1.50 ? 92 : odds <= 1.75 ? 82 : odds <= 2.00 ? 72 : odds <= 2.50 ? 60 : odds <= 3.25 ? 45 : 30;
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
                shirtNumber: p.shirt_number || '',
                positionId: p.position_id
              });
            }
          }
        }
        lineupAvailable = lineupPlayerIds.size > 0;
        lineupConfirmed = lineupData.home.confirmed === true && lineupData.away.confirmed === true;
        lineupType = lineupConfirmed ? 'ufficiale' : 'probabile';
      }
    } catch {}

    // Costruiamo un quadro multi-fattoriale: rendimento individuale, volume/qualità
    // dei tiri, forza offensiva della squadra, vulnerabilità difensiva avversaria,
    // minuti e contesto casa/trasferta. I punteggi sono indici comparativi, non probabilità.
    const leagueData = await pitchCached('/leagues',6*60*60*1000);
    const leagues = (leagueData.leagues || []).filter(l => allowed(l.name) && l.id);
    const leagueResults = await Promise.all(leagues.map(async league => {
      try {
        const current = await pitchCached('/leagues/' + encodeURIComponent(league.id),6*60*60*1000);
        const currentSeason = current.season;
        if (!currentSeason) return [];
        const data = await pitchCached('/leagues/' + encodeURIComponent(league.id) + '/matches?season=' + encodeURIComponent(currentSeason) + '&status=all',20*60*1000);
        return (data.matches || []).map(m => ({...m, leagueName:(data.league && data.league.name)||league.name, _season:currentSeason}));
      } catch { return []; }
    }));
    const allMatches = [...new Map(leagueResults.flat().map(m => [m.id,m])).values()];
    const targetDate = String(fixture.date || date);
    // Head-to-head reale: storico dei confronti diretti e statistiche individuali recuperabili.
    let h2hMatches=[], h2hPlayerResults=[];
    try {
      const h2hData=await cachedH2H(fixtureId);
      const rawH2H=(Array.isArray(h2hData.recent_matches)?h2hData.recent_matches:[])
        .filter(m=>m && (m.finished===true || (m.score_home!=null && m.score_away!=null)))
        .sort((a,b)=>matchDateKey(b).localeCompare(matchDateKey(a)))
        .slice(0,5);
      const leagueSeason=leagues.find(l=>String(l.id)===String(fixture.league&&fixture.league.id));
      const seasonMatches=await historicalMatchesForLeague(
        fixture.league&&fixture.league.id,
        leagueSeason&&leagueSeason.season
      );
      const matchPool=[...new Map([...allMatches,...seasonMatches].filter(m=>m&&m.id).map(m=>[String(m.id),m])).values()];
      h2hMatches=rawH2H.map(h=>{
        const ht=String(h.home&&h.home.id || h.home_team&&h.home_team.id || '');
        const at=String(h.away&&h.away.id || h.away_team&&h.away_team.id || '');
        const dateKey=matchDateKey(h);
        const directId=String(h.id||h.match_id||h.fixture_id||'');
        let found=directId?matchPool.find(m=>String(m.id)===directId):null;
        if(!found && ht && at && dateKey) {
          found=matchPool.find(m=>{
            const teams=matchTeams(m);
            return ((teams.home===ht&&teams.away===at)||(teams.home===at&&teams.away===ht)) &&
              matchDateKey(m)===dateKey;
          });
        }
        return {...h,_resolvedMatch:found||null,_matchId:directId||(found&&String(found.id))||''};
      });
      const resolved=h2hMatches.filter(m=>m._matchId);
      h2hPlayerResults=await Promise.all(resolved.map(async m=>{
        try { return {match:m,players:await cachedMatchPlayers(m._matchId)}; }
        catch { return {match:m,players:[]}; }
      }));
    } catch {}
    const h2hByPlayerId=new Map(), h2hByPlayerName=new Map();
    for(const result of h2hPlayerResults) {
      const seen=new Set();
      for(const row of result.players||[]) {
        const pl=row.player||{}, tid=String(row.team_id||'');
        if(!pl.name || (tid!==homeId&&tid!==awayId)) continue;
        const idKey=tid+':'+String(pl.id||'');
        const nameKey=tid+':'+normalize(pl.name);
        const uniqueKey=idKey+':'+nameKey;
        if(seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);
        const goals=getStat(row,'goals'), assists=getStat(row,'assists');
        const add=(map,key)=>{
          if(!key || key.endsWith(':')) return;
          if(!map.has(key))map.set(key,{appearances:0,goalMatches:0,gaMatches:0,goals:0,assists:0});
          const entry=map.get(key);
          entry.appearances++;
          entry.goals+=goals; entry.assists+=assists;
          if(goals>0)entry.goalMatches++;
          if(goals+assists>0)entry.gaMatches++;
        };
        add(h2hByPlayerId,idKey); add(h2hByPlayerName,nameKey);
      }
    }
    const targetMs = Date.parse(targetDate + 'T23:59:59Z');
    const earliestMs = targetMs - 65 * 24 * 60 * 60 * 1000;
    const recentFor = teamId => allMatches
      .filter(m => {
        const ids = [String(m.home_team && m.home_team.id || ''),String(m.away_team && m.away_team.id || '')];
        const status = normalize(m.status);
        const matchMs = Date.parse(String(m.date || '') + 'T12:00:00Z');
        const finished = status === 'finished' || status === 'complete' || status === 'completed' || (m.score_home != null && m.score_away != null);
        return ids.includes(teamId) && m.id !== fixtureId && Number.isFinite(matchMs) && matchMs >= earliestMs && matchMs < targetMs && finished;
      })
      .sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0,8);
    const homeRecent = recentFor(homeId);
    const awayRecent = recentFor(awayId);
    const gamesByTeam = new Map([[homeId,homeRecent.length],[awayId,awayRecent.length]]);
    const uniqueMatches = [...new Map([...homeRecent,...awayRecent].map(m=>[m.id,m])).values()];
    const playerResults = await Promise.all(uniqueMatches.map(async m => {
      const [playerResponse, shotResponse] = await Promise.all([
        pitchCached('/matches/' + encodeURIComponent(m.id) + '/players',24*60*60*1000).then(players => ({players:Array.isArray(players)?players:[]})).catch(error => ({players:[],error:error.message})),
        pitchCached('/matches/' + encodeURIComponent(m.id) + '/shots',24*60*60*1000).then(shots => ({shots:Array.isArray(shots.periods)?shots.periods.flatMap(period=>Array.isArray(period.shots)?period.shots:[]):[]})).catch(error => ({shots:[],shotError:error.message}))
      ]);
      return {match:m,players:playerResponse.players,error:playerResponse.error,shots:shotResponse.shots,shotError:shotResponse.shotError};
    }));

    const teamForm = new Map([[homeId,{games:0,goalsFor:0,goalsAgainst:0,shotsFor:0,shotsAgainst:0,xgFor:0,xgAgainst:0,shotMatches:0,xgMatches:0}],
      [awayId,{games:0,goalsFor:0,goalsAgainst:0,shotsFor:0,shotsAgainst:0,xgFor:0,xgAgainst:0,shotMatches:0,xgMatches:0}]]);
    const playersByKey = new Map();
    for (const result of playerResults) {
      const match = result.match;
      const mh = String(match.home_team && match.home_team.id || '');
      const ma = String(match.away_team && match.away_team.id || '');
      const shotsByTeam = new Map();
      for (const shot of result.shots || []) {
        const tid=String(shot.team_id||'');
        if(!shotsByTeam.has(tid))shotsByTeam.set(tid,{shots:0,onTarget:0,xg:0});
        const agg=shotsByTeam.get(tid);agg.shots++;if(shot.is_on_target)agg.onTarget++;agg.xg+=Number(shot.expected_goals)||0;
      }
      for (const tid of [mh,ma]) {
        const tf=teamForm.get(tid);
        if(!tf)continue;
        tf.games++;
        const isHome=tid===mh;
        const gf=Number(isHome?match.score_home:match.score_away);
        const ga=Number(isHome?match.score_away:match.score_home);
        if(Number.isFinite(gf))tf.goalsFor+=gf;
        if(Number.isFinite(ga))tf.goalsAgainst+=ga;
        const own=shotsByTeam.get(tid),opp=shotsByTeam.get(tid===mh?ma:mh);
        if(own){tf.shotsFor+=own.shots;tf.xgFor+=own.xg;tf.shotMatches++;tf.xgMatches++;}
        if(opp){tf.shotsAgainst+=opp.shots;tf.xgAgainst+=opp.xg;}
      }
      for (const p of result.players || []) {
        const teamId=String(p.team_id||'');
        if(teamId!==homeId&&teamId!==awayId)continue;
        const player=p.player||{};
        if(!player.id||!player.name)continue;
        const key=teamId+':'+String(player.id);
        if(!playersByKey.has(key))playersByKey.set(key,{
          id:String(player.id),name:player.name,team:teamId===homeId?home.name:away.name,teamId,
          position:positionName(player.position_id),goals:0,assists:0,appearances:0,minutes:0,
          statsShots:0,statsShotsOnTarget:0,statsXg:0,shots:0,shotsOnTarget:0,xg:0,keyPasses:0,statsSeason:'ultime 5 partite concluse',
          source:'PitchAPI player stats + shots/xG',starter:false,lineupKnown:false,lineupConfirmed:false,lineupType:'',injured:false,
          _appearanceMatches:new Set(),_shotMatches:new Set()
        });
        const entry=playersByKey.get(key);
        if(!entry._appearanceMatches.has(String(match.id))){
          entry._appearanceMatches.add(String(match.id));entry.appearances++;
          entry.goals+=getStat(p,'goals');entry.assists+=getStat(p,'assists');
          entry.minutes+=statAny(p,['minutes_played','minutes']);
          entry.statsShots+=statAny(p,['total_shots','shots']);
          entry.statsShotsOnTarget+=statAny(p,['shots_on_target']);
          entry.statsXg+=statAny(p,['expected_goals','xg']);
          entry.keyPasses+=statAny(p,['key_passes','chances_created']);
        }
      }
      for (const shot of result.shots || []) {
        const teamId=String(shot.team_id||''),player=shot.player||{};
        if((teamId!==homeId&&teamId!==awayId)||!player.id)continue;
        const key=teamId+':'+String(player.id);
        if(!playersByKey.has(key))playersByKey.set(key,{
          id:String(player.id),name:player.name||'Giocatore',team:teamId===homeId?home.name:away.name,teamId,
          position:positionName(player.position_id),goals:0,assists:0,appearances:0,minutes:0,
          statsShots:0,statsShotsOnTarget:0,statsXg:0,shots:0,shotsOnTarget:0,xg:0,keyPasses:0,statsSeason:'ultime 5 partite concluse',
          source:'PitchAPI shots + xG',starter:false,lineupKnown:false,lineupConfirmed:false,lineupType:'',injured:false,
          _appearanceMatches:new Set(),_shotMatches:new Set()
        });
        const entry=playersByKey.get(key);
        if(!entry._shotMatches.has(String(match.id))){entry._shotMatches.add(String(match.id));}
        entry.shots++;
        entry.xg+=Number(shot.expected_goals)||0;
        if(shot.is_on_target)entry.shotsOnTarget++;
        if(!entry._appearanceMatches.has(String(match.id))){entry._appearanceMatches.add(String(match.id));entry.appearances++;}
        if(shot.event_type==='Goal' && !shot.is_own_goal)entry.goals=Math.max(entry.goals,0);
      }
    }

    // Aggiungiamo i titolari della formazione corrente anche quando non compaiono
    // nei dati offensivi delle ultime gare: non devono sparire solo perché hanno
    // avuto poche occasioni o sono rientrati da un infortunio.
    for (const [playerId, official] of lineupPlayersById) {
      const key=official.teamId+':'+String(playerId);
      if (playersByKey.has(key) || positionName(official.positionId)==='Portiere') continue;
      playersByKey.set(key,{
        id:String(playerId),name:official.name||'Giocatore',team:official.teamId===homeId?home.name:away.name,
        teamId:official.teamId,position:positionName(official.positionId),goals:0,assists:0,appearances:0,minutes:0,
        statsShots:0,statsShotsOnTarget:0,statsXg:0,shots:0,shotsOnTarget:0,xg:0,keyPasses:0,
        statsSeason:'nessuna statistica recente disponibile',source:'PitchAPI lineup; statistiche recenti non disponibili',
        starter:true,lineupKnown:true,lineupConfirmed,lineupType,injured:false,
        _appearanceMatches:new Set(),_shotMatches:new Set()
      });
    }
    const samePlayerName=(a,b)=>{
      const x=normalize(a),y=normalize(b);
      if(!x||!y)return false;
      if(x===y||x.includes(y)||y.includes(x))return true;
      const xt=x.split(' ').filter(Boolean),yt=y.split(' ').filter(Boolean);
      return xt.length>0&&yt.length>0&&xt[xt.length-1]===yt[yt.length-1]&&xt[xt.length-1].length>=4;
    };
    const players = [...playersByKey.values()]
      .filter(p=>p.teamId===favoriteTeamId && p.position!=='Portiere')
      .map(p=>{
        const officialSource=lineupPlayersById.get(String(p.id)) || [...lineupPlayersById.values()].find(o=>o.teamId===p.teamId&&samePlayerName(o.name,p.name));
        const isCurrentStarter=Boolean(officialSource);
        const shotDataAvailable=p.shots>0;
        const shots=shotDataAvailable?p.shots:p.statsShots;
        const shotsOnTarget=shotDataAvailable?p.shotsOnTarget:p.statsShotsOnTarget;
        const xg=shotDataAvailable?p.xg:p.statsXg;
        const minutes=p.minutes>0?p.minutes:Math.max(1,p.appearances*70);
        const goalsPer90=p.goals/minutes*90;
        const gaPer90=(p.goals+p.assists)/minutes*90;
        const assistsPer90=p.assists/minutes*90;
        const xgPer90=xg/minutes*90;
        const shotsPer90=shots/minutes*90;
        const onTargetPer90=shotsOnTarget/minutes*90;
        const conversion=shots>0?p.goals/shots:0;
        const h2hStats=h2hByPlayerId.get(p.teamId+':'+String(p.id)) ||
          h2hByPlayerName.get(p.teamId+':'+normalize(p.name)) ||
          {appearances:0,goalMatches:0,gaMatches:0,goals:0,assists:0};
        const h2hGoalScore=h2hStats.appearances
          ? rateScore(h2hStats.goalMatches/h2hStats.appearances,1)
          : 50;
        const h2hGaScore=h2hStats.appearances
          ? rateScore(h2hStats.gaMatches/h2hStats.appearances,1)
          : 50;
        const ownForm=teamForm.get(p.teamId)||{games:0,goalsFor:0,goalsAgainst:0,xgFor:0,xgAgainst:0,xgMatches:0};
        const opponentId=p.teamId===homeId?awayId:homeId;
        const oppForm=teamForm.get(opponentId)||{games:0,goalsFor:0,goalsAgainst:0,xgFor:0,xgAgainst:0,xgMatches:0};
        const attackMetric=ownForm.xgMatches?ownForm.xgFor/ownForm.xgMatches:ownForm.goalsFor/Math.max(1,ownForm.games);
        const defenseMetric=oppForm.xgMatches?oppForm.xgAgainst/Math.max(1,oppForm.games):oppForm.goalsAgainst/Math.max(1,oppForm.games);
        const goalComponents={
          recentGoals:rateScore(goalsPer90,0.75),
          expectedGoals:rateScore(xgPer90,0.75),
          shotVolume:rateScore(shotsPer90,5),
          shotsOnTarget:rateScore(onTargetPer90,2.5),
          finishing:rateScore(conversion,0.35),
          teamAttack:rateScore(attackMetric,2.5),
          opponentDefense:rateScore(defenseMetric,2.2),
          homeAdvantage:p.teamId===homeId?100:35,
          minutes:rateScore(minutes/Math.max(1,p.appearances),90)
        };
        const gaComponents={
          goalContributions:rateScore(gaPer90,1.1),
          expectedGoals:rateScore(xgPer90,0.75),
          shotVolume:rateScore(shotsPer90,5),
          shotsOnTarget:rateScore(onTargetPer90,2.5),
          assists:rateScore(assistsPer90,0.4),
          chanceCreation:rateScore(p.keyPasses/Math.max(1,p.appearances),2.5),
          teamAttack:rateScore(attackMetric,2.5),
          opponentDefense:rateScore(defenseMetric,2.2),
          homeAdvantage:p.teamId===homeId?100:0,
          minutes:rateScore(minutes/Math.max(1,p.appearances),90)
        };
        const teamOdds = p.teamId===homeId ? homeOdds : awayOdds;
        // Se mancano quote, usiamo un valore neutro: l'assenza del dato non penalizza il candidato.
        const matchOddsScore = oddsAvailable ? oddsSideScore(teamOdds) : 50;
        const penaltyTaker=designatedPenaltyTaker(p);
        const penaltyTakerScore=penaltyTaker===true?100:penaltyTaker===false?0:50;
        const goalIndex=weighted([
          [goalComponents.recentGoals,14],[goalComponents.expectedGoals,18],[goalComponents.shotVolume,13],
          [goalComponents.shotsOnTarget,8],[goalComponents.finishing,5],[goalComponents.teamAttack,6],
          [goalComponents.opponentDefense,6],[goalComponents.homeAdvantage,8],[goalComponents.minutes,3],
          [matchOddsScore,5],[h2hGoalScore,10],[penaltyTakerScore,4]
        ]);
        const gaIndex=weighted([
          [gaComponents.goalContributions,13],[gaComponents.expectedGoals,16],[gaComponents.shotVolume,11],
          [gaComponents.shotsOnTarget,8],[gaComponents.assists,12],[gaComponents.chanceCreation,7],
          [gaComponents.teamAttack,5],[gaComponents.opponentDefense,6],[gaComponents.homeAdvantage,8],[gaComponents.minutes,2],
          [matchOddsScore,4],[h2hGaScore,8]
        ]);
        // Probabilità evento: conversione Poisson da tassi individuali regolarizzati.
        // La regolarizzazione riduce l'effetto di campioni piccoli; non sostituisce una calibrazione storica.
        const appearances=Math.max(0,p.appearances);
        const shrunkGoalRate=(goalsPer90*appearances+0.12*3)/(appearances+3);
        const shrunkXgRate=(xgPer90*appearances+0.12*2)/(appearances+2);
        const shrunkGaRate=(gaPer90*appearances+0.20*3)/(appearances+3);
        const shrunkAssistRate=(assistsPer90*appearances+0.08*3)/(appearances+3);
        const goalBaseRate=shotDataAvailable||p.statsXg>0
          ? 0.62*shrunkXgRate+0.38*shrunkGoalRate
          : 0.70*shrunkGoalRate+0.30*(shotsOnTarget>0?Math.min(0.45,onTargetPer90*0.18):0.08);
        const gaBaseRate=0.65*shrunkGaRate+0.22*shrunkXgRate+0.13*shrunkAssistRate;
        const contextFactor=contextMultiplier(attackMetric,defenseMetric);
        // Bonus modéré des cotes 1X2 : le favori à domicile reçoit un poids supplémentaire,
        // sans transformer une cote d'équipe en probabilité individuelle de marquer.
        const oddsFactor = !oddsAvailable ? 1 : teamOdds<=1.50 ? (p.teamId===homeId?1.12:1.06) : teamOdds<=1.75 ? (p.teamId===homeId?1.10:1.05) : teamOdds<=2.00 ? (p.teamId===homeId?1.08:1.04) : teamOdds<=2.50 ? 1.04 : 1.00;
        const venueFactor=p.teamId===homeId?1.14:1.04;
        const h2hGoalRate=h2hStats.appearances?h2hStats.goalMatches/h2hStats.appearances:0;
        const h2hGaRate=h2hStats.appearances?h2hStats.gaMatches/h2hStats.appearances:0;
        const h2hGoalFactor=1+Math.min(0.12,h2hGoalRate*0.12);
        const h2hGaFactor=1+Math.min(0.10,h2hGaRate*0.10);
        // Un rigorista designato riceve un bonus moderato, solo se il provider lo dichiara esplicitamente.
        const penaltyTakerFactor=penaltyTaker===true?1.12:1.00;
        const penaltyGaFactor=penaltyTaker===true?1.05:1.00;
        const combinedGoalFactor=Math.min(1.35,oddsFactor*venueFactor*h2hGoalFactor*penaltyTakerFactor);
        const combinedGaFactor=Math.min(1.30,oddsFactor*venueFactor*h2hGaFactor*penaltyGaFactor);
        const matchOddsContext = {homeOdds,awayOdds,teamOdds,favorite:matchOdds?.favorite||null,bookmakersCount:matchOdds?.bookmakersCount||0,score:matchOddsScore,factor:oddsFactor};
        const headToHeadContext = {matches:h2hMatches.length,playerMatches:h2hStats.appearances,goalMatches:h2hStats.goalMatches,gaMatches:h2hStats.gaMatches,goals:h2hStats.goals,assists:h2hStats.assists,goalRate:Number(h2hGoalRate.toFixed(2)),gaRate:Number(h2hGaRate.toFixed(2)),goalFactor:h2hGoalFactor,gaFactor:h2hGaFactor};
        const penaltyContext={designated:penaltyTaker,factor:penaltyTakerFactor,gaFactor:penaltyGaFactor,source:penaltyTaker===null?'dato non disponibile':'campo esplicito del provider'};
        const expectedMinutes=Math.max(0,Math.min(90,
          lineupConfirmed?Math.max(65,Math.min(85,minutes/Math.max(1,appearances))):
          lineupAvailable?Math.max(55,Math.min(78,minutes/Math.max(1,appearances))):
          Math.max(45,Math.min(72,minutes/Math.max(1,appearances)))
        ));
        const participationFactor=!lineupAvailable?1:(isCurrentStarter?1:0.45);
        const gaParticipationFactor=!lineupAvailable?1:(isCurrentStarter?1:0.55);
        const adjustedGoalProbability=poissonPercent(goalBaseRate*expectedMinutes/90*contextFactor*combinedGoalFactor*participationFactor);
        const adjustedGaProbability=poissonPercent(gaBaseRate*expectedMinutes/90*contextFactor*combinedGaFactor*gaParticipationFactor);
        const confidenceScore=Math.round(Math.min(100,
          20+Math.min(5,appearances)*8+(lineupAvailable&&isCurrentStarter?(lineupConfirmed?25:10):0)+
          (p.minutes>0?10:0)+(shotDataAvailable||p.statsXg>0?17:0)+(shotsOnTarget>0?8:0)
        ));
        const eligibleForBet=Boolean((lineupConfirmed||lineupAvailable) && (!lineupAvailable||isCurrentStarter) && appearances>=2 && confidenceScore>=55 && (shotDataAvailable||p.statsXg>0||p.statsShots>0));
        return {...p,
          name:officialSource&&officialSource.name||p.name,
          team:p.teamId===homeId?home.name:away.name,
          shirtNumber:officialSource&&officialSource.shirtNumber||'',
          starter:lineupAvailable&&isCurrentStarter,lineupKnown:lineupAvailable,lineupConfirmed,lineupType,
          recentMatches:p.appearances,
          goalsPer90:Number(goalsPer90.toFixed(2)),assistsPer90:Number(assistsPer90.toFixed(2)),
          shots:Number(shots.toFixed(1)),shotsOnTarget:Number(shotsOnTarget.toFixed(1)),xg:Number(xg.toFixed(2)),
          minutes:Number(minutes.toFixed(0)),minutesEstimated:!(p.minutes>0),
          teamXgPerMatch:Number(attackMetric.toFixed(2)),opponentXgaPerMatch:Number(defenseMetric.toFixed(2)),
          goalComponents,gaComponents,goalIndex,gaIndex,matchOddsContext,headToHeadContext,venueFactor,penaltyContext,
          goalProbability:adjustedGoalProbability,gaProbability:adjustedGaProbability,confidenceScore,eligibleForBet,expectedMinutes,
          probabilityModel:'poisson-shrunk-v4-expanded-candidates'
        };
      })
      .sort((a,b)=>Math.max(b.goalProbability||0,b.gaProbability||0)-Math.max(a.goalProbability||0,a.gaProbability||0) || Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
    const diagnostics = [];
    if (homeRecent.length<5 || awayRecent.length<5) diagnostics.push('Campione recente incompleto: ultime gare trovate casa='+homeRecent.length+', ospite='+awayRecent.length+'.');
    if (!uniqueMatches.length) diagnostics.push('Non sono state trovate partite concluse recenti per entrambe le squadre nei campionati coperti.');
    diagnostics.push('Precedenti diretti: '+h2hMatches.length+' partite trovate, '+h2hPlayerResults.filter(r=>(r.players||[]).length>0).length+' con statistiche individuali recuperabili.');
    diagnostics.push('Fonte: PitchAPI. Il modello combina rendimento recente, tiri/xG, attacco squadra, difesa avversaria, quote 1X2, vantaggio casa più marcato (coefficiente 1,14 contro 1,04 in trasferta) e precedenti diretti individuali. I bonus H2H sono limitati e applicati solo se i dati del giocatore sono disponibili; non sono probabilità calibrate. Quote 1X2 non sono quote del mercato marcatore. I valori mancanti non vengono inventati; minuti stimati solo se il provider non li riporta.');
    const message = players.length
      ? 'Analisi della sola squadra favorita ('+(favoriteSide==='home'?'casa':'trasferta')+', quota '+(favoriteSide==='home'?homeOdds:awayOdds)+'). '+(lineupConfirmed
          ? 'Formazione ufficiale pubblicata: sono mostrati i titolari ufficiali.'
          : lineupAvailable
            ? 'Formazione disponibile: i titolari previsti sono favoriti; gli altri restano monitorabili ma non sono proposte giocabili.'
            : 'Formazione non ancora disponibile: candidati individuati dalle statistiche recenti, ma non confermati titolari.') + ' ' + diagnostics.join(' | ')
      : 'Nessun giocatore con gol o assist rilevati nelle ultime partite concluse disponibili per questa gara. ' + diagnostics.join(' | ');
    // L'analisi non va memorizzata a lungo: rose e formazioni possono cambiare.
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).json({message,diagnostics,matchOdds:{available:oddsAvailable,homeOdds,awayOdds,favorite:favoriteSide, favoriteTeamId,homeThreshold:1.65,awayThreshold:1.55,bookmakersCount:matchOdds?.bookmakersCount||0},headToHead:{matches:h2hMatches.length,playerStatsMatches:h2hPlayerResults.filter(r=>(r.players||[]).length>0).length,results:h2hMatches.map(m=>{const result=h2hPlayerResults.find(r=>String(r.match._matchId)===String(m._matchId));const scorerRows=(result&&result.players||[]).map(row=>({row,goals:getStat(row,'goals'),assists:getStat(row,'assists')})).filter(x=>x.goals>0);return {date:matchDateKey(m),home:m.home&&m.home.name||m.home_team&&m.home_team.name||'',away:m.away&&m.away.name||m.away_team&&m.away_team.name||'',scoreHome:m.score_home,scoreAway:m.score_away,playerStatsAvailable:Boolean(result&&(result.players||[]).length),scorers:scorerRows.map(x=>({name:x.row.player&&x.row.player.name||'Giocatore',team:String(x.row.team_id)===homeId?home.name:away.name,goals:x.goals,assists:x.assists}))};})},model:'poisson-shrunk-v4-expanded-candidates',weights:{goal:{recentGoals:14,xG:18,shots:13,shotsOnTarget:8,finishing:5,teamAttack:6,opponentDefense:6,homeAdvantage:8,minutes:3,matchOdds:5,headToHead:10,designatedPenaltyTaker:4},goalAssist:{goalContributions:13,xG:16,shots:11,shotsOnTarget:8,assists:12,chanceCreation:7,teamAttack:5,opponentDefense:6,homeAdvantage:8,minutes:2,matchOdds:4,headToHead:8}},teamContext:{home:teamForm.get(homeId),away:teamForm.get(awayId)},players:players.slice(0,40)});
  } catch (error) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    const status = error.status || 502;
    return res.status(status).json({error:error.message || 'Errore temporaneo del provider'});
  }
};
