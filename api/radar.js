// RadarBomber: API-Football proxy with broad competition coverage and season-stat ranking.
const BASE = 'https://v3.football.api-sports.io';
const LEAGUES = new Set([
  39,40,140,141,78,79,61,62,135,136,94,88,2,3,848,45,143,137,81,
  5,4,1,32,34,13,9,531,528,667,666,567,569,570,29,30
]);
const api = async path => {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) { const e = new Error('Chiave API non configurata'); e.status = 503; throw e; }
  const r = await fetch(BASE + path, {headers:{'x-apisports-key':key}, signal:AbortSignal.timeout(12000)});
  const j = await r.json();
  if (!r.ok || (j.errors && Object.keys(j.errors).length)) {
    const e = new Error('Provider API-Football: ' + JSON.stringify(j.errors || r.status)); e.status = r.status || 502; throw e;
  }
  return j.response || [];
};
const n = v => Number(v || 0);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function rank(row, oppConceded, teamScored) {
  const p=row.player||{}, s=(row.statistics||[])[0]||{}, g=s.goals||{}, games=s.games||{}, shots=s.shots||{}, pen=s.penalty||{};
  const goals=n(g.total), assists=n(g.assists), mins=n(games.minutes), apps=n(games.appearences), starts=n(games.lineups), subs=n(games.substitutes);
  const position=String(games.position||'').toLowerCase();
  if (!p.name || mins < 180 || apps < 3 || /goalkeeper|defender/.test(position)) return null;
  const startRate=starts/Math.max(apps,1), avgMins=mins/Math.max(apps,1);
  // Avoid goalkeepers/defenders and players mostly used as late substitutes.
  if (avgMins < 45 || startRate < 0.35) return null;
  const per90Goals=goals/(mins/90), per90Assists=assists/(mins/90), perAppGoals=goals/apps, perAppGA=(goals+assists)/apps;
  const shotRate=n(shots.total)/(mins/90), targetRate=n(shots.on)/(mins/90);
  const penGoals=n(pen.scored);
  const attackingContext=clamp(0.88 + teamScored/Math.max(apps,1)*0.055,0.82,1.12);
  const opponentContext=clamp(1.12 - oppConceded*0.025,0.78,1.12);
  const startContext=clamp(0.72 + startRate*0.28,0.72,1);
  // Scores are comparative indices, not bookmaker-calibrated probabilities.
  const goalScore=clamp(Math.round(100*(1-Math.exp(-((per90Goals*0.68)+(perAppGoals*0.52)+(targetRate*0.035)+(penGoals/Math.max(apps,1)*0.12))*attackingContext*opponentContext*startContext))),0,99);
  const gaScore=clamp(Math.round(100*(1-Math.exp(-((per90Goals*0.42)+(per90Assists*0.52)+(perAppGA*0.58)+(shotRate*0.018))*attackingContext*opponentContext*startContext))),0,99);
  return {id:p.id,name:p.name,position:games.position||'',goals,assists,minutes:mins,appearances:apps,starts,avgMinutes:Math.round(avgMins),startRate:Math.round(startRate*100),goalsPer90:+per90Goals.toFixed(2),assistsPer90:+per90Assists.toFixed(2),goalsPerAppearance:+perAppGoals.toFixed(2),goalIndex:goalScore,gaIndex:gaScore,shots:n(shots.total),shotsOnTarget:n(shots.on),penaltyGoals:penGoals};
}
module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=300');
  try {
    const date=String(req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'}));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){res.status(400).json({error:'Data non valida'});return;}
    if(!req.query.fixture){
      const fixtures=await api('/fixtures?date='+date+'&timezone=Europe%2FRome');
      const selected=fixtures.filter(f=>LEAGUES.has(Number(f.league&&f.league.id)) && ['NS','TBD'].includes(String(f.fixture?.status?.short||'NS')));
      res.status(200).json({date,count:selected.length,fixtures:selected.slice(0,60).map(f=>({id:f.fixture.id,home:f.teams.home.name,away:f.teams.away.name,homeId:f.teams.home.id,awayId:f.teams.away.id,league:f.league.name,leagueId:f.league.id,season:f.league.season,time:f.fixture.date?new Date(f.fixture.date).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}):'',status:f.fixture.status.short}))});
      return;
    }
    const fixtureId=Number(req.query.fixture);
    if(!Number.isInteger(fixtureId)||fixtureId<1){res.status(400).json({error:'Partita non valida'});return;}
    const fs=await api('/fixtures?id='+fixtureId), f=fs[0];
    if(!f){res.status(404).json({error:'Partita non trovata'});return;}
    const season=Number(f.league?.season||String(f.fixture.date).slice(0,4));
    const [lineups,injuries,homeStats,awayStats,homeTeamStats,awayTeamStats]=await Promise.all([
      api('/fixtures/lineups?fixture='+fixtureId),
      api('/injuries?fixture='+fixtureId),
      api('/players?team='+f.teams.home.id+'&season='+season+'&league='+f.league.id+'&page=1'),
      api('/players?team='+f.teams.away.id+'&season='+season+'&league='+f.league.id+'&page=1'),
      api('/teams/statistics?league='+f.league.id+'&season='+season+'&team='+f.teams.home.id),
      api('/teams/statistics?league='+f.league.id+'&season='+season+'&team='+f.teams.away.id)
    ]);
    const lineupKnown=lineups.length>0;
    const starters=new Set(lineups.flatMap(t=>(t.startXI||[]).map(x=>String(x.player?.id))));
    const injured=new Set(injuries.map(x=>String(x.player?.id)));
    const homeScored=n(homeTeamStats.goals?.for?.total?.total), awayScored=n(awayTeamStats.goals?.for?.total?.total);
    const homeConceded=n(homeTeamStats.goals?.against?.total?.total), awayConceded=n(awayTeamStats.goals?.against?.total?.total);
    const all=[];
    for(const side of [
      {team:f.teams.home.name,teamId:f.teams.home.id,rows:homeStats,oppConceded:awayConceded,teamScored:homeScored},
      {team:f.teams.away.name,teamId:f.teams.away.id,rows:awayStats,oppConceded:homeConceded,teamScored:awayScored}
    ]){
      for(const row of side.rows){
        const id=String(row.player?.id||'');
        if(injured.has(id))continue;
        if(lineupKnown && !starters.has(id))continue;
        const p=rank(row,side.oppConceded,side.teamScored);
        if(!p)continue;
        all.push({...p,team:side.team,teamId:side.teamId,starter:lineupKnown?starters.has(id):p.startRate>=65,lineupKnown,opponentConceded:side.oppConceded,teamGoals:side.teamScored});
      }
    }
    all.sort((a,b)=>Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
    res.status(200).json({fixture:{id:fixtureId,home:f.teams.home.name,away:f.teams.away.name,league:f.league.name,time:f.fixture.date},lineupKnown,message:lineupKnown?'Formazioni ufficiali: inclusi solo titolari, esclusi indisponibili.':'Formazioni non ancora ufficiali: candidati stimati da presenze, minuti e titolarità stagionale; gli indisponibili noti sono esclusi.',players:all.slice(0,60)});
  }catch(e){res.status(e.status||502).json({error:e.status===503?'Manca API_FOOTBALL_KEY nelle Environment Variables Vercel.':e.message||'Errore temporaneo del provider'});}
};