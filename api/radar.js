// RadarBomber automatic daily radar: only requested major competitions, all qualifying fixtures.
const BASE='https://v3.football.api-sports.io';
const LEAGUES=new Set([
  39,45,48, // Premier League, FA Cup, EFL Cup
  140,143, // La Liga, Copa del Rey
  78,81, // Bundesliga, DFB-Pokal
  61,66, // Ligue 1, Coupe de France
  135,137, // Serie A, Coppa Italia
  2,3,848, // Champions, Europa, Conference League
  5,1,4,32,13 // Nations League, World Cup, Euro, European WC qualifiers, Copa Libertadores
]);
const api=async path=>{
 const key=process.env.API_FOOTBALL_KEY;
 if(!key){const e=new Error('Chiave API non configurata');e.status=503;throw e;}
 const r=await fetch(BASE+path,{headers:{'x-apisports-key':key},signal:AbortSignal.timeout(10000)});
 const j=await r.json();
 if(!r.ok||(j.errors&&Object.keys(j.errors).length)){const e=new Error('API-Football: '+JSON.stringify(j.errors||r.status));e.status=r.status||502;throw e;}
 return j.response||[];
};
const safe=async(path,fallback)=>{try{return await api(path)}catch(_){return fallback}};
const n=v=>Number(v||0), clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rank(row,oppConceded,teamScored){
 const p=row.player||{},s=(row.statistics||[])[0]||{},g=s.goals||{},gm=s.games||{},shots=s.shots||{},pen=s.penalty||{};
 const goals=n(g.total),assists=n(g.assists),minutes=n(gm.minutes),apps=n(gm.appearences),starts=n(gm.lineups),position=String(gm.position||'').toLowerCase();
 if(!p.name||minutes<180||apps<3||/goalkeeper|defender/.test(position))return null;
 const startRate=starts/Math.max(apps,1),avgMinutes=minutes/Math.max(apps,1);
 if(avgMinutes<45||startRate<0.35)return null;
 const g90=goals/(minutes/90),a90=assists/(minutes/90),gApp=goals/apps,gaApp=(goals+assists)/apps;
 const shotRate=n(shots.total)/(minutes/90),onTargetRate=n(shots.on)/(minutes/90),penRate=n(pen.scored)/apps;
 const attack=clamp(0.9+teamScored/Math.max(apps,1)*0.06,0.82,1.12);
 const defense=clamp(1.12-Math.max(0,oppConceded)*0.025,0.78,1.12);
 const startsFactor=clamp(0.7+startRate*0.3,0.7,1);
 // Comparative 0-100 indexes, not calibrated real-world probabilities.
 const goalIndex=clamp(Math.round(100*(1-Math.exp(-((g90*2.1)+(gApp*1.35)+(onTargetRate*0.07)+(penRate*0.25))*attack*defense*startsFactor))),0,99);
 const gaIndex=clamp(Math.round(100*(1-Math.exp(-((g90*1.2)+(a90*1.7)+(gaApp*1.05)+(shotRate*0.035))*attack*defense*startsFactor))),0,99);
 return {id:p.id,name:p.name,position:gm.position||'',goals,assists,minutes,appearances:apps,starts,avgMinutes:Math.round(avgMinutes),startRate:Math.round(startRate*100),goalsPer90:+g90.toFixed(2),assistsPer90:+a90.toFixed(2),goalsPerAppearance:+gApp.toFixed(2),goalIndex,gaIndex,shots:n(shots.total),shotsOnTarget:n(shots.on)};
}
async function analyzeFixture(f){
 const id=f.fixture.id,season=Number(f.league?.season||String(f.fixture.date).slice(0,4));
 const [lineups,injuries,homeRows,awayRows,homeStats,awayStats]=await Promise.all([
  safe('/fixtures/lineups?fixture='+id,[]),safe('/injuries?fixture='+id,[]),
  api('/players?team='+f.teams.home.id+'&season='+season+'&league='+f.league.id+'&page=1'),
  api('/players?team='+f.teams.away.id+'&season='+season+'&league='+f.league.id+'&page=1'),
  safe('/teams/statistics?league='+f.league.id+'&season='+season+'&team='+f.teams.home.id,{}),
  safe('/teams/statistics?league='+f.league.id+'&season='+season+'&team='+f.teams.away.id,{})
 ]);
 const lineupKnown=lineups.length>=2&&lineups.every(t=>Array.isArray(t.startXI)&&t.startXI.length>0);
 const starters=new Set(lineups.flatMap(t=>(t.startXI||[]).map(x=>String(x.player?.id))));
 const injured=new Set(injuries.map(x=>String(x.player?.id)));
 const homeScored=n(homeStats.goals?.for?.total?.total),awayScored=n(awayStats.goals?.for?.total?.total);
 const homeConceded=n(homeStats.goals?.against?.total?.total),awayConceded=n(awayStats.goals?.against?.total?.total);
 const fixture={id,home:f.teams.home.name,away:f.teams.away.name,league:f.league.name,leagueId:f.league.id,time:f.fixture.date?new Date(f.fixture.date).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}):''};
 const players=[];
 for(const side of [
  {name:f.teams.home.name,teamId:f.teams.home.id,rows:homeRows,oppConceded:awayConceded,teamScored:homeScored},
  {name:f.teams.away.name,teamId:f.teams.away.id,rows:awayRows,oppConceded:homeConceded,teamScored:awayScored}
 ]){
  for(const row of side.rows){
   const pid=String(row.player?.id||'');
   if(injured.has(pid)||(lineupKnown&&!starters.has(pid)))continue;
   const p=rank(row,side.oppConceded,side.teamScored);if(!p)continue;
   players.push({...p,team:side.name,teamId:side.teamId,fixtureId:id,fixture:fixture.home+' - '+fixture.away,league:fixture.league,time:fixture.time,starter:lineupKnown?starters.has(pid):p.startRate>=65,lineupKnown,opponentConceded:side.oppConceded,teamGoals:side.teamScored});
  }
 }
 return {fixture,lineupKnown,players};
}
async function pool(items,limit,fn){
 const out=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={error:e.message,fixture:{id:items[i].fixture.id,home:items[i].teams.home.name,away:items[i].teams.away.name,league:items[i].league.name},players:[]}}}}));
 return out;
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=300');
 try{
  const date=String(req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Rome'}));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){res.status(400).json({error:'Data non valida'});return;}
  const fixtures=await api('/fixtures?date='+date+'&timezone=Europe%2FRome');
  const selected=fixtures.filter(f=>LEAGUES.has(Number(f.league?.id))&&['NS','TBD'].includes(String(f.fixture?.status?.short||'NS')));
  const brief=selected.map(f=>({id:f.fixture.id,home:f.teams.home.name,away:f.teams.away.name,league:f.league.name,leagueId:f.league.id,time:f.fixture.date?new Date(f.fixture.date).toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Rome'}):''}));
  if(req.query.mode!=='auto'){
   res.status(200).json({date,count:selected.length,fixtures:brief});return;
  }
  // Automatic analysis of all qualifying fixtures; aim for up to 30 matches per day.
  const batch=selected.slice(0,30);
  const analyzed=await pool(batch,3,analyzeFixture);
  const players=analyzed.flatMap(x=>x?.players||[]);
  players.sort((a,b)=>Math.max(b.goalIndex,b.gaIndex)-Math.max(a.goalIndex,a.gaIndex));
  res.status(200).json({date,fixtureCount:selected.length,analyzedCount:batch.length,failedCount:analyzed.filter(x=>x?.error).length,players,fixtures:brief,message:'Analisi automatica completata per tutte le partite selezionate (fino a 30), con classifica gol e gol+assist. Formazioni ufficiali applicate quando disponibili; altrimenti filtro su minuti e titolarità stagionale.'});
 }catch(e){res.status(e.status||502).json({error:e.status===503?'Manca API_FOOTBALL_KEY nelle Environment Variables di Vercel.':e.message||'Errore temporaneo del provider'});}
};