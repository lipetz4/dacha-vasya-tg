// Dacha Vasya — Telegram Mini App game server (Node 20, no framework: node:http + better-sqlite3).
// Every /api request (except public card images and the bot webhook) must carry X-Tg-Init-Data = Telegram.WebApp.initData (HMAC-checked).
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const C=require('./config'),{verifyInitData,bot}=require('./tg'),CAT=require('./catalog'),{cardFile}=require('./card');
const NEWS=require('./news');
const {makeRsLb}=require('./rs_lb'); // anonymous leaderboard of the Android build (/api/rs/*)
const MSK=3*3600e3,now=()=>Date.now()+(+process.env.TEST_NOW_OFFSET||0);
const dayKey=t=>new Date(t+MSK).toISOString().slice(0,10);
function weekStart(t){const d=new Date(t+MSK),wd=(d.getUTCDay()+6)%7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-wd)-MSK} // Monday 00:00 MSK
const weekKey=t=>dayKey(weekStart(t));
// ---- game rules (server side)
const MINI={ROUND:40,MIN_S:36,MAX_S:900,MAX_SCORE:150,MAX_PER_S:4,PER_HOUR:40};
const M3={MOVES:25,MIN_S_PER_MOVE:0.4,MAX_S:1800,MAX_SCORE:30000,MAX_PER_MOVE:2500,PER_HOUR:40}; // «Три в ряд» sanity limits
const TOUR=[100,70,50,30,30,20,20,20,20,20];                     // weekly top-10 gems; badge/frame for all of them
const STREAK=[10,15,20,25,30,40,60];                             // day 1..7+, gems
const REF={JOIN_NEW:30,JOIN_INVITER:30,LVL5:50,LADDER:[[1,20,null],[3,50,'frame_friend'],[5,80,'badge_host'],[10,150,'frame_gold']]};
const SAVE={MAX_BYTES:300e3,GEMS_BASE:60,GEMS_PER_H:40,COINS_BASE:6000,COINS_PER_H:20000,LVL_BASE:2,LVL_PER_H:3};

function makeApp(db){NEWS.ensure(db);
 const q={
  user:db.prepare('SELECT * FROM users WHERE id=?'),
  insUser:db.prepare('INSERT INTO users(id,name,username,created,last_seen) VALUES(?,?,?,?,?)'),
  seen:db.prepare('UPDATE users SET name=?,username=?,last_seen=? WHERE id=?'),
  grant:db.prepare('INSERT OR IGNORE INTO grants(uid,ukey,kind,gems,coins,vip_days,badge,note,created) VALUES(@uid,@ukey,@kind,@gems,@coins,@vip_days,@badge,@note,@created)'),
  pending:db.prepare('SELECT id,kind,gems,coins,vip_days,badge,note FROM grants WHERE uid=? AND acked IS NULL ORDER BY id'),
  ack:db.prepare('UPDATE grants SET acked=? WHERE uid=? AND id=? AND acked IS NULL'),
  friend:db.prepare('INSERT OR IGNORE INTO friends(a,b,src,created) VALUES(?,?,?,?)'),
  refCount:db.prepare('SELECT COUNT(*) n FROM users WHERE ref_by=?'),
 };
 const grant=(uid,ukey,o)=>q.grant.run({uid,ukey:uid+':'+ukey,kind:o.kind,gems:o.gems|0,coins:o.coins|0,vip_days:o.vip_days|0,badge:o.badge||null,note:o.note||null,created:now()}).changes>0;
 const link=(a,b,src)=>{if(a===b)return;q.friend.run(a,b,src,now());q.friend.run(b,a,src,now())};
 const addBadge=(uid,b)=>{const u=q.user.get(uid);const L=JSON.parse(u.badges||'[]');if(!L.includes(b)){L.push(b);db.prepare('UPDATE users SET badges=? WHERE id=?').run(JSON.stringify(L),uid)}};
 // ---- rate limit (token bucket per key)
 const RL=new Map();function limited(key,per=60,burst=30){const t=now(),b=RL.get(key)||{n:burst,t};b.n=Math.min(burst,b.n+Math.max(0,t-b.t)/1000*per/60);b.t=t;if(b.n<1){RL.set(key,b);return true}b.n--;RL.set(key,b);if(RL.size>50000)RL.clear();return false}
 const nameOf=u=>String(u.first_name||u.username||'Игрок').slice(0,32);

 function ladder(uid){const n=q.refCount.get(uid).n;REF.LADDER.forEach(([k,g,b])=>{if(n>=k&&grant(uid,'ladder:'+k,{kind:'ref_ladder',gems:g,badge:b,note:'Друзей: '+k})&&b)addBadge(uid,b)});return n}
 function tourRewards(uid){ // previous week's top-10 -> paid at next login (idempotent by ukey)
  const wk=weekKey(weekStart(now())-1);const rows=db.prepare('SELECT uid,MAX(score) s,MIN(finished) f FROM rounds WHERE week=? AND valid=1 GROUP BY uid ORDER BY s DESC,f ASC LIMIT 10').all(wk);
  const i=rows.findIndex(r=>r.uid===uid);if(i<0)return null;const badge=i===0?'tour_gold':i<3?'tour_silver':'tour_top10';
  if(grant(uid,'tour:'+wk,{kind:'tour',gems:TOUR[i],badge,note:'Турнир недели '+wk+': '+(i+1)+' место'}))addBadge(uid,badge);return i+1}
 function me(auth){const u=auth.user,t=now();let row=q.user.get(u.id),isNew=false;
  db.transaction(()=>{
   if(!row){q.insUser.run(u.id,nameOf(u),u.username||null,t,t);isNew=true;row=q.user.get(u.id)}else q.seen.run(nameOf(u),u.username||null,t,u.id);
   const sp=auth.start_param||'';let m;
   if(isNew&&(m=/^ref_(\d{1,15})$/.exec(sp))){const inv=+m[1];const ir=q.user.get(inv);
    if(inv!==u.id&&ir&&ir.created<t){db.prepare('UPDATE users SET ref_by=? WHERE id=?').run(inv,u.id);link(u.id,inv,'ref');
     grant(u.id,'ref_join',{kind:'ref_join',gems:REF.JOIN_NEW,note:'Бонус за приглашение'});grant(inv,'ref_join:'+u.id,{kind:'ref_friend',gems:REF.JOIN_INVITER,note:'Друг пришёл: '+nameOf(u)});ladder(inv)}}
   else if(!isNew&&(m=/^ref_(\d{1,15})$/.exec(sp))){const inv=+m[1];if(inv!==u.id&&q.user.get(inv))link(u.id,inv,'friend')}
   if((m=/^ch_([A-Za-z0-9_-]{4,61})$/.exec(sp))){try{const s=Buffer.from(m[1],'base64url').toString('utf8').split('~');if(s.length===4&&/^\d{1,15}$/.test(s[2])){const o=+s[2];if(q.user.get(o))link(u.id,o,'challenge')}}catch(e){}}
  })();
  const tour=tourRewards(u.id);ladder(u.id);row=q.user.get(u.id);
  return{user:{id:u.id,name:row.name,streak:row.streak,streakDay:row.streak_day,today:dayKey(t),badges:JSON.parse(row.badges||'[]'),refs:q.refCount.get(u.id).n,isNew},
   grants:q.pending.all(u.id),week:{key:weekKey(t),endsAt:weekStart(t)+7*864e5},tourRank:tour,
   shop:Object.entries(CAT).map(([id,p])=>({id,title:p.title,stars:p.stars,gems:p.gems||0,vip:p.vip||0})),refLink:'https://t.me/'+C.BOT_USERNAME+'/'+C.APP_NAME+'?startapp=ref_'+u.id}}

 function daily(uid){const t=now(),d=dayKey(t),row=q.user.get(uid);if(row.streak_day===d)return{ok:false,already:true,streak:row.streak};
  const y=dayKey(t-864e5),s=row.streak_day===y?row.streak+1:1;db.prepare('UPDATE users SET streak=?,streak_day=? WHERE id=?').run(s,d,uid);
  const gems=STREAK[Math.min(s,STREAK.length)-1];grant(uid,'daily:'+d,{kind:'daily',gems,note:'Серия входов: день '+s});return{ok:true,streak:s,gems,table:STREAK}}

 function putSave(uid,body){const raw=JSON.stringify(body.data||null);if(raw.length>SAVE.MAX_BYTES)return[413,{ok:false,error:'too_big'}];const d=body.data;if(!d||typeof d!=='object')return[400,{ok:false,error:'bad'}];
  const gems=+d.gems||0,coins=+d.coins||0,level=+d.level||1,t=now(),prev=db.prepare('SELECT * FROM saves WHERE uid=?').get(uid);
  if(prev){const h=Math.max(0,(t-prev.server_ts)/3600e3),gr=db.prepare('SELECT COALESCE(SUM(gems),0) g,COALESCE(SUM(coins),0) c FROM grants WHERE uid=? AND created>?').get(uid,prev.server_ts);
   const bad=[];if(gems-prev.gems>SAVE.GEMS_BASE+SAVE.GEMS_PER_H*h+gr.g)bad.push('gems');if(coins-prev.coins>SAVE.COINS_BASE+SAVE.COINS_PER_H*h+gr.c)bad.push('coins');if(level-prev.level>SAVE.LVL_BASE+SAVE.LVL_PER_H*h)bad.push('level');
   if(bad.length){db.prepare('UPDATE users SET flags=flags+1 WHERE id=?').run(uid);log('anticheat',uid,bad.join(','));return[409,{ok:false,error:'suspicious',fields:bad,save:{data:JSON.parse(prev.data),updatedAt:prev.updated}}]}
   if((+body.updatedAt||0)<prev.updated)return[409,{ok:false,error:'stale',save:{data:JSON.parse(prev.data),updatedAt:prev.updated}}]}
  db.prepare('INSERT INTO saves(uid,data,updated,server_ts,gems,coins,level) VALUES(?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET data=excluded.data,updated=excluded.updated,server_ts=excluded.server_ts,gems=excluded.gems,coins=excluded.coins,level=excluded.level')
   .run(uid,raw,+body.updatedAt||t,t,gems,coins,level);
  db.prepare('UPDATE users SET level=? WHERE id=?').run(level,uid);
  const u=q.user.get(uid);if(level>=5&&u.ref_by&&!u.lvl5_paid){db.prepare('UPDATE users SET lvl5_paid=1 WHERE id=?').run(uid);grant(u.ref_by,'ref_lvl5:'+uid,{kind:'ref_lvl5',gems:REF.LVL5,note:u.name+' дошёл до 5 уровня!'})}
  return[200,{ok:true}]}

 function miniStart(uid){const t=now(),n=db.prepare('SELECT COUNT(*) n FROM rounds WHERE uid=? AND started>?').get(uid,t-3600e3).n;if(n>=MINI.PER_HOUR)return[429,{ok:false,error:'too_many_rounds'}];
  const id=crypto.randomBytes(12).toString('base64url'),seed=crypto.randomInt(1,2**31);db.prepare('INSERT INTO rounds(id,uid,seed,started) VALUES(?,?,?,?)').run(id,uid,seed,t);return[200,{ok:true,roundId:id,seed,round:MINI.ROUND}]}
 function miniFinish(uid,b){const r=db.prepare('SELECT * FROM rounds WHERE id=? AND uid=?').get(String(b.roundId||''),uid);if(!r)return[404,{ok:false,error:'no_round'}];if(r.finished)return[409,{ok:false,error:'already'}];
  const t=now(),el=(t-r.started)/1000,score=b.score|0;let reason=null;
  if(score<0||score>MINI.MAX_SCORE)reason='score_range';else if(el<MINI.MIN_S)reason='too_fast';else if(el>MINI.MAX_S)reason='too_slow';else if(score>MINI.MAX_PER_S*MINI.ROUND)reason='rate';
  const wk=weekKey(r.started);const prevBest=(db.prepare('SELECT MAX(score) m FROM rounds WHERE uid=? AND valid=1 AND week=?').get(uid,wk).m)||0;db.prepare('UPDATE rounds SET finished=?,score=?,week=?,valid=?,reason=? WHERE id=?').run(t,score,wk,reason?0:1,reason,r.id);
  if(!reason&&C.BEAT_ENABLED)try{NEWS.queueBeaten(db,'rounds','mini',uid,(q.user.get(uid)||{}).name,prevBest,score,wk)}catch(e){log('beat_q err',e.message)}
  if(reason)log('mini_reject',uid,reason,score,el.toFixed(1));return[200,{ok:!reason,valid:!reason,reason,week:wk}]}

 // ---- «Три в ряд» rounds + rating (mirror of /mini/*; separate table, no weekly prizes)
 function m3Start(uid){const t=now(),n=db.prepare('SELECT COUNT(*) n FROM m3rounds WHERE uid=? AND started>?').get(uid,t-3600e3).n;if(n>=M3.PER_HOUR)return[429,{ok:false,error:'too_many_rounds'}];
  const id=crypto.randomBytes(12).toString('base64url');db.prepare('INSERT INTO m3rounds(id,uid,started) VALUES(?,?,?)').run(id,uid,t);return[200,{ok:true,roundId:id,moves:M3.MOVES}]}
 function m3Finish(uid,b){const r=db.prepare('SELECT * FROM m3rounds WHERE id=? AND uid=?').get(String(b.roundId||''),uid);if(!r)return[404,{ok:false,error:'no_round'}];if(r.finished)return[409,{ok:false,error:'already'}];
  const t=now(),el=(t-r.started)/1000,score=Math.floor(+b.score||0),mv=Math.floor(+b.moves||0);let reason=null;
  if(!Number.isFinite(score)||score<0||score>M3.MAX_SCORE)reason='score_range';else if(mv<1||mv>M3.MOVES)reason='moves';else if(score>mv*M3.MAX_PER_MOVE)reason='rate';
  else if(el<mv*M3.MIN_S_PER_MOVE)reason='too_fast';else if(el>M3.MAX_S)reason='too_slow';
  const wk=weekKey(r.started);const prevBest=(db.prepare('SELECT MAX(score) m FROM m3rounds WHERE uid=? AND valid=1 AND week=?').get(uid,wk).m)||0;db.prepare('UPDATE m3rounds SET finished=?,score=?,moves=?,week=?,day=?,valid=?,reason=? WHERE id=?').run(t,score,mv,wk,dayKey(r.started),reason?0:1,reason,r.id);
  if(!reason&&C.BEAT_ENABLED)try{NEWS.queueBeaten(db,'m3rounds','m3',uid,(q.user.get(uid)||{}).name,prevBest,score,wk)}catch(e){log('beat_q err',e.message)}
  if(reason)log('m3_reject',uid,reason,score,mv,el.toFixed(1));return[200,{ok:!reason,valid:!reason,reason,week:wk}]}
 function m3Top(uid,scope){const t=now(),wk=weekKey(t);let rows;const base='SELECT r.uid,u.name,MAX(r.score) score FROM m3rounds r JOIN users u ON u.id=r.uid WHERE r.valid=1 ';
  if(scope==='week')rows=db.prepare(base+'AND r.week=? GROUP BY r.uid ORDER BY score DESC,MIN(r.finished) LIMIT 50').all(wk);
  else if(scope==='day')rows=db.prepare(base+'AND r.day=? GROUP BY r.uid ORDER BY score DESC,MIN(r.finished) LIMIT 50').all(dayKey(t));
  else if(scope==='friends')rows=db.prepare(base+'AND (r.uid=? OR r.uid IN (SELECT b FROM friends WHERE a=?)) GROUP BY r.uid ORDER BY score DESC LIMIT 50').all(uid,uid);
  else{scope='all';rows=db.prepare(base+'GROUP BY r.uid ORDER BY score DESC,MIN(r.finished) LIMIT 50').all()}
  const list=rows.map((r,i)=>({rank:i+1,name:r.name,score:r.score,me:r.uid===uid}));return{scope,week:wk,list,me:list.find(x=>x.me)||null}}
 function top(uid,scope){const t=now(),wk=weekKey(t);let rows;
  const base='SELECT r.uid,u.name,MAX(r.score) score FROM rounds r JOIN users u ON u.id=r.uid WHERE r.valid=1 ';
  if(scope==='week')rows=db.prepare(base+'AND r.week=? GROUP BY r.uid ORDER BY score DESC,MIN(r.finished) LIMIT 50').all(wk);
  else if(scope==='friends')rows=db.prepare(base+'AND (r.uid=? OR r.uid IN (SELECT b FROM friends WHERE a=?)) GROUP BY r.uid ORDER BY score DESC LIMIT 50').all(uid,uid);
  else rows=db.prepare(base+'GROUP BY r.uid ORDER BY score DESC,MIN(r.finished) LIMIT 50').all();
  const list=rows.map((r,i)=>({rank:i+1,name:r.name,score:r.score,me:r.uid===uid}));
  return{scope,week:wk,endsAt:weekStart(t)+7*864e5,list,me:list.find(x=>x.me)||null,prizes:scope==='week'?TOUR:undefined}}
 function refInfo(uid){const n=q.refCount.get(uid).n,fr=db.prepare('SELECT u.name,u.username,u.level FROM friends f JOIN users u ON u.id=f.b WHERE f.a=? GROUP BY u.id ORDER BY MIN(f.created) DESC LIMIT 50').all(uid).map(r=>({name:(r.username?String(r.name).slice(0,12)+' @'+r.username:r.name),level:r.level}));
  return{link:'https://t.me/'+C.BOT_USERNAME+'/'+C.APP_NAME+'?startapp=ref_'+uid,count:n,friends:fr,ladder:REF.LADDER.map(([k,g,b])=>({n:k,gems:g,badge:b,done:n>=k})),bonus:{join:REF.JOIN_NEW,inviter:REF.JOIN_INVITER,lvl5:REF.LVL5}}}
 async function invoice(uid,b){const p=CAT[b.productId];if(!p)return[400,{ok:false,error:'no_product'}];const id='o_'+crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO orders(id,uid,product,stars,status,created) VALUES(?,?,?,?,?,?)').run(id,uid,b.productId,p.stars,'new',now());
  const link=await bot('createInvoiceLink',{title:p.title,description:'Дача Мурлыки Васи: '+p.title,payload:id,currency:'XTR',prices:[{label:p.title,amount:p.stars}]});return[200,{ok:true,link,orderId:id}]}
 // ---- bot webhook
 async function onUpdate(u){
  if(u.pre_checkout_query){const pq=u.pre_checkout_query,o=db.prepare('SELECT * FROM orders WHERE id=?').get(pq.invoice_payload);
   const ok=!!o&&o.uid===pq.from.id&&pq.currency==='XTR'&&pq.total_amount===o.stars&&o.status!=='paid';
   await bot('answerPreCheckoutQuery',ok?{pre_checkout_query_id:pq.id,ok:true}:{pre_checkout_query_id:pq.id,ok:false,error_message:'Заказ не найден или уже оплачен'});return}
  const msg=u.message;if(!msg)return;
  if(msg.successful_payment){const sp=msg.successful_payment;paid(sp.invoice_payload,sp.telegram_payment_charge_id,sp.total_amount,msg.from.id);return}
  if(msg.from&&msg.chat&&msg.chat.type==='private')try{NEWS.touch(db,msg.from.id)}catch(e){}
  if(typeof msg.text==='string'&&/^\/news\b/.test(msg.text)&&C.ADMIN_ID&&msg.from&&msg.from.id===C.ADMIN_ID){const f=NEWS.latestNews();
   if(!f){await bot('sendMessage',{chat_id:msg.chat.id,text:'Нет файлов в '+C.NEWS_DIR});return}
   let j;try{j=await NEWS.sendNewsTo(msg.chat.id,NEWS.readNews(f))}catch(e){j={ok:false,description:e.message}}
   await bot('sendMessage',{chat_id:msg.chat.id,text:(j.ok?'👆 Предпросмотр: ':'❌ Ошибка: '+(j.description||'')+'\n')+path.basename(f)+'\nПолучателей: '+NEWS.recipients(db).length+'\nРазослать: sudo dacha-vasya news '+f});return}
  if(typeof msg.text==='string'&&/^\/start\b/.test(msg.text)){const arg=msg.text.split(/\s+/)[1]||'';const url=C.GAME_URL+(/^[A-Za-z0-9_-]{1,64}$/.test(arg)?'?tgWebAppStartParam='+arg:'');
   await bot('sendMessage',{chat_id:msg.chat.id,text:'🐱 Привет! Это Мурлыка Вася и его дача.\nСоединяй урожай, наряжай Васю и лови овощи в «Васином урожае» 🥕',
    reply_markup:{inline_keyboard:[[{text:'▶️ Играть',url:'https://t.me/'+C.BOT_USERNAME+'/'+C.APP_NAME+(arg?'?startapp='+arg:'')}]]}});return}
  if(typeof msg.text==='string'&&/^\/paysupport\b/.test(msg.text))await bot('sendMessage',{chat_id:msg.chat.id,text:'По вопросам оплаты напишите сюда, укажите дату покупки — разберёмся и при необходимости вернём Stars.'})}
 function paid(orderId,charge,amount,from){return db.transaction(()=>{const o=db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);if(!o){log('pay_unknown',orderId);return false}
  if(db.prepare('SELECT 1 FROM orders WHERE charge_id=?').get(charge))return false; // idempotent: same payment delivered twice
  if(o.status==='paid')return false;db.prepare('UPDATE orders SET status=?,charge_id=?,paid=? WHERE id=?').run('paid',charge,now(),o.id);const p=CAT[o.product];
  grant(o.uid,'order:'+o.id,{kind:'purchase',gems:p.gems||0,vip_days:p.vip||0,note:p.title});log('paid',o.uid,o.product,amount,from);return true})()}

 const rsLb=makeRsLb(db,{now,weekKey,weekStart,limited,log});
 // ---- http
 const send=(res,code,obj,h={})=>{const b=Buffer.from(JSON.stringify(obj));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':b.length,'Cache-Control':'no-store',...h});res.end(b)};
 const body=req=>new Promise((ok,no)=>{let n=0,a=[];req.on('data',c=>{n+=c.length;if(n>400e3){no(new Error('big'));req.destroy()}else a.push(c)});req.on('end',()=>{try{ok(a.length?JSON.parse(Buffer.concat(a)):{})}catch(e){no(e)}});req.on('error',no)});
 async function handle(req,res){const u=new URL(req.url,'http://x'),p=u.pathname.replace(/^\/api/,''),ip=(C.RELAY_KEY&&req.headers['x-relay-key']===C.RELAY_KEY&&req.headers['x-client-ip'])||req.headers['x-real-ip']||req.socket.remoteAddress;
  const cors=req.headers.origin===C.ORIGIN?{'Access-Control-Allow-Origin':C.ORIGIN,Vary:'Origin'}:{};
  if(await rsLb.handle(req,res,p,u,ip,send,body))return;
  if(req.method==='OPTIONS'){res.writeHead(cors['Access-Control-Allow-Origin']?204:403,{...cors,'Access-Control-Allow-Methods':'GET,POST,PUT','Access-Control-Allow-Headers':'Content-Type,X-Tg-Init-Data','Access-Control-Max-Age':'86400'});return res.end()}
  if(p==='/health')return send(res,200,{ok:true,bot:!!C.BOT_TOKEN},cors);
  let m;if(req.method==='GET'&&(m=/^\/card\/([0-9a-f]{32})\.jpg$/.exec(p))){const f=path.join(C.CARDS,m[1]+'.jpg');if(!fs.existsSync(f)){res.writeHead(404);return res.end()}
   res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*'});return fs.createReadStream(f).pipe(res)}
  if(req.method==='POST'&&(m=/^\/tg\/webhook\/([A-Za-z0-9_-]{16,})$/.exec(p))){
   if(!C.WEBHOOK_SECRET||m[1]!==C.WEBHOOK_SECRET||req.headers['x-telegram-bot-api-secret-token']!==C.WEBHOOK_SECRET){res.writeHead(403);return res.end()}
   const upd=await body(req);try{await onUpdate(upd)}catch(e){log('webhook_err',e.message)}return send(res,200,{ok:true})}
  if(limited('ip:'+ip,C.IP_RPM,C.IP_RPM/3))return send(res,429,{ok:false,error:'rate'},cors);
  const auth=verifyInitData(req.headers['x-tg-init-data']);if(!auth)return send(res,401,{ok:false,error:'auth'},cors);const uid=auth.user.id;
  if(limited('u:'+uid,120,40))return send(res,429,{ok:false,error:'rate'},cors);
  if(!q.user.get(uid)&&p!=='/me')me(auth);
  const B=req.method==='GET'?{}:await body(req);let r;
  switch(req.method+' '+p){
   case'POST /me':r=[200,{ok:true,...me(auth)}];break;
   case'POST /grants/ack':(Array.isArray(B.ids)?B.ids:[]).slice(0,100).forEach(id=>q.ack.run(now(),uid,id|0));r=[200,{ok:true}];break;
   case'GET /save':{const s=db.prepare('SELECT data,updated FROM saves WHERE uid=?').get(uid);r=[200,{ok:true,save:s?{data:JSON.parse(s.data),updatedAt:s.updated}:null}];break}
   case'PUT /save':if(limited('save:'+uid,30,10)){r=[429,{ok:false,error:'rate'}];break}r=putSave(uid,B);break;
   case'POST /daily':r=[200,daily(uid)];break;
   case'POST /mini/start':r=miniStart(uid);break;
   case'POST /mini/finish':r=miniFinish(uid,B);break;
   case'POST /m3/start':r=m3Start(uid);break;
   case'POST /m3/finish':r=m3Finish(uid,B);break;
   case'GET /m3/top':r=[200,{ok:true,...m3Top(uid,u.searchParams.get('scope')||'all')}];break;
   case'GET /top':r=[200,{ok:true,...top(uid,u.searchParams.get('scope')||'all')}];break;
   case'GET /ref':r=[200,{ok:true,...refInfo(uid)}];break;
   case'POST /card':{if(limited('card:'+uid,20,10)){r=[429,{ok:false,error:'rate'}];break}const f=await cardFile(C.CARDS,B.score,auth.user.first_name,C.BOT_TOKEN.slice(-12)+'card');r=[200,{ok:true,url:C.PUBLIC_URL+'/api/card/'+f}];break}
   case'POST /payments/telegram/invoice':r=await invoice(uid,B);break;
   default:r=[404,{ok:false,error:'not_found'}]}
  send(res,r[0],r[1],cors)}
 const server=http.createServer((req,res)=>handle(req,res).catch(e=>{log('err',req.url,e.message);if(!res.headersSent)send(res,500,{ok:false,error:'server'})}));
 return{server,paid,weekKey,dayKey,weekStart,MINI,M3}}
function log(...a){console.log(new Date().toISOString(),...a)}
module.exports={makeApp};
if(require.main===module){if(!C.BOT_TOKEN)console.warn('WARNING: BOT_TOKEN is empty — fill /opt/dacha-vasya/.env and restart: sudo systemctl restart dacha-vasya');
 const db=require('./db').open(C.DB);const {server}=makeApp(db);server.listen(C.PORT,C.HOST,()=>log('dacha-vasya listening on',C.HOST+':'+C.PORT));
 if(C.BOT_TOKEN&&(C.NEWS_AUTO||C.REMIND_ENABLED||C.BEAT_ENABLED)){log('auto news:',C.NEWS_AUTO,'reminders:',C.REMIND_ENABLED);let busy=false;const tick=async()=>{if(busy)return;busy=true;try{if(C.NEWS_AUTO){const r=await NEWS.autoNewsRun(db,(...a)=>log(...a));if(r&&r.length)log('news',JSON.stringify(r))}
   if(C.BEAT_ENABLED){const st=await NEWS.beatRun(db,(...a)=>log(...a));if(st)log('beat',JSON.stringify(st))}
   if(C.REMIND_ENABLED){const st=await NEWS.remindRun(db,(...a)=>log(...a));if(st)log('remind',JSON.stringify(st))}}catch(e){log('auto err',e.message)}busy=false};
  setTimeout(tick,60e3).unref();setInterval(tick,10*60e3).unref()}
 const stop=()=>{server.close();db.close();process.exit(0)};process.on('SIGTERM',stop);process.on('SIGINT',stop)}
