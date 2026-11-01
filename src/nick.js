// Nickname check for the anonymous (non-Telegram) leaderboard: 3..16 chars, letters/digits/space/_-. , no profanity.
// The same rules are in the game client (rustore/rs_lb.js) — the server is the authority.
const LAT={a:'а',b:'в',c:'с',e:'е',h:'н',k:'к',m:'м',o:'о',p:'р',t:'т',x:'х',y:'у','0':'о','1':'и','3':'з','6':'б','4':'ч','@':'а','$':'с'};
const BAD=[/ху[йеёияю]/,/пизд/,/(^|[^а-я])(у|за|по|на|от|вы|до|раз|при|об)?[её]б(а|у|л|и|ё|н|ы|о|ш|т)/,/бля/,/сук[аи]/,/мудак|мудил/,/пид[оа]р/,/гандон|гондон/,/залуп/,/шлюх/,/дроч/,/манд[аоу]/,/жоп/,/говн/,/хер(ня|ов)/,/чмо/,/даун/,/нацис|гитлер|hitler|nazi/,
 /fuck|shit|bitch|cunt|dick|pussy|nigg|fag|whore|porn|sex/];
function norm(s){return String(s||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim()}
function checkNick(raw){const n=norm(raw);if(n.length<3)return{ok:false,error:'short'};if(n.length>16)return{ok:false,error:'long'};
 if(!/^[A-Za-zА-Яа-яЁё0-9 _.\-]+$/.test(n))return{ok:false,error:'chars'};
 const low=n.toLowerCase(),lat=low.replace(/[a-z0-9@$]/g,c=>LAT[c]||c).replace(/[ _.\-]/g,''),raw2=low.replace(/[ _.\-]/g,''),lat2=lat.replace(/в/g,'б');
 if(BAD.some(r=>r.test(lat)||r.test(lat2)||r.test(raw2)||r.test(low)))return{ok:false,error:'bad'};return{ok:true,nick:n}}
module.exports={checkNick,norm};
