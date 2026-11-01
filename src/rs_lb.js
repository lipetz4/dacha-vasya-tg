// Public leaderboard for the Android (RuStore) build — NO Telegram: the player is an anonymous device id (did) generated in the app,
// the nickname is chosen in the game (checked by ./nick.js). Separate tables (rs_*), so the Telegram rating is not touched.
// Routes (all under /api/rs/, CORS *, no cookies):
//   POST /rs/nick  {did,nick}            -> {ok,nick} | {ok:false,error:'short'|'long'|'chars'|'bad'|'taken'}
//   POST /rs/score {did,game,score}      -> {ok,best}            game: 'mini' («Васин урожай») | 'm3' («Три в ряд»)
//   GET  /rs/top?game=mini&scope=week|all&did=...  -> {ok,list:[{rank,name,score,me}],me,endsAt}
const {checkNick}=require('./nick');
const LIM={mini:150,m3:30000},PER_HOUR=60,DID=/^[A-Za-z0-9_-]{16,64}$/;
function ensure(db){db.exec(`
CREATE TABLE IF NOT EXISTS rs_players(did TEXT PRIMARY KEY,nick TEXT,nick_lc TEXT,created INTEGER,last_seen INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS rs_players_nick ON rs_players(nick_lc);
CREATE TABLE IF NOT EXISTS rs_scores(did TEXT,game TEXT,period TEXT,score INTEGER,updated INTEGER,PRIMARY KEY(did,game,period));
CREATE INDEX IF NOT EXISTS rs_scores_top ON rs_scores(game,period,score);
CREATE TABLE IF NOT EXISTS rs_hits(did TEXT,t INTEGER);
CREATE INDEX IF NOT EXISTS rs_hits_did ON rs_hits(did,t);`)}
function makeRsLb(db,{now,weekKey,weekStart,limited,log}){ensure(db);
 const q={pl:db.prepare('SELECT * FROM rs_players WHERE did=?'),
  ins:db.prepare('INSERT OR IGNORE INTO rs_players(did,created,last_seen) VALUES(?,?,?)'),
  seen:db.prepare('UPDATE rs_players SET last_seen=? WHERE did=?'),
  byNick:db.prepare('SELECT did FROM rs_players WHERE nick_lc=?'),
  setNick:db.prepare('UPDATE rs_players SET nick=?,nick_lc=? WHERE did=?'),
  up:db.prepare('INSERT INTO rs_scores(did,game,period,score,updated) VALUES(?,?,?,?,?) ON CONFLICT(did,game,period) DO UPDATE SET score=excluded.score,updated=excluded.updated WHERE excluded.score>rs_scores.score'),
  best:db.prepare('SELECT score FROM rs_scores WHERE did=? AND game=? AND period=?'),
  hits:db.prepare('SELECT COUNT(*) n FROM rs_hits WHERE did=? AND t>?'),hit:db.prepare('INSERT INTO rs_hits(did,t) VALUES(?,?)'),
  gc:db.prepare('DELETE FROM rs_hits WHERE t<?'),
  top:db.prepare("SELECT s.did,COALESCE(p.nick,'') nick,s.score FROM rs_scores s LEFT JOIN rs_players p ON p.did=s.did WHERE s.game=? AND s.period=? ORDER BY s.score DESC,s.updated LIMIT 50"),
  rank:db.prepare('SELECT COUNT(*)+1 r FROM rs_scores WHERE game=? AND period=? AND score>?')};
 const touch=did=>{const t=now();q.ins.run(did,t,t);q.seen.run(t,did)};
 const anon=did=>'Игрок '+did.slice(-4).toUpperCase();
 function nick(b){const did=String(b.did||'');if(!DID.test(did))return[400,{ok:false,error:'did'}];touch(did);const c=checkNick(b.nick);if(!c.ok)return[200,c];
  const o=q.byNick.get(c.nick.toLowerCase());if(o&&o.did!==did)return[200,{ok:false,error:'taken'}];q.setNick.run(c.nick,c.nick.toLowerCase(),did);return[200,{ok:true,nick:c.nick}]}
 function score(b){const did=String(b.did||''),game=String(b.game||'');if(!DID.test(did))return[400,{ok:false,error:'did'}];if(!LIM[game])return[400,{ok:false,error:'game'}];
  const s=Math.floor(+b.score);if(!Number.isFinite(s)||s<0||s>LIM[game])return[200,{ok:false,error:'score_range'}];
  const t=now();if(q.hits.get(did,t-3600e3).n>=PER_HOUR)return[429,{ok:false,error:'rate'}];q.hit.run(did,t);if(Math.random()<.01)q.gc.run(t-7200e3);
  touch(did);db.transaction(()=>{q.up.run(did,game,'w'+weekKey(t),s,t);q.up.run(did,game,'all',s,t)})();
  return[200,{ok:true,best:(q.best.get(did,game,'all')||{}).score||s}]}
 function top(u){const game=LIM[u.searchParams.get('game')]?u.searchParams.get('game'):'mini',scope=u.searchParams.get('scope')==='all'?'all':'week',did=String(u.searchParams.get('did')||'');
  const t=now(),period=scope==='all'?'all':'w'+weekKey(t);
  const list=q.top.all(game,period).map((r,i)=>({rank:i+1,name:r.nick||anon(r.did),score:r.score,me:r.did===did}));let me=list.find(x=>x.me)||null;
  if(!me&&DID.test(did)){const b=q.best.get(did,game,period);if(b)me={rank:q.rank.get(game,period,b.score).r,score:b.score,me:true}}
  const p=DID.test(did)&&q.pl.get(did);return[200,{ok:true,game,scope,list,me,nick:p&&p.nick||null,endsAt:weekStart(t)+7*864e5}]}
 const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'};
 // returns true when the request was handled
 async function handle(req,res,p,u,ip,send,body){if(!p.startsWith('/rs/'))return false;
  if(req.method==='OPTIONS'){res.writeHead(204,CORS);res.end();return true}
  if(limited('rsip:'+ip,120,40)){send(res,429,{ok:false,error:'rate'},CORS);return true}
  let r;try{const B=req.method==='POST'?await body(req):{};
   switch(req.method+' '+p){case'POST /rs/nick':r=nick(B);break;case'POST /rs/score':r=score(B);break;case'GET /rs/top':r=top(u);break;default:r=[404,{ok:false,error:'not_found'}]}}
  catch(e){log('rs_err',p,e.message);r=[400,{ok:false,error:'bad_request'}]}
  send(res,r[0],r[1],CORS);return true}
 return{handle}}
module.exports={makeRsLb,ensure};
