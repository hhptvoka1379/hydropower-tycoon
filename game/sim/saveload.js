/* State hashing, deep clone, save objects, save validation and deterministic replay. Extracted from legacy/v2.index.html createSimModule, then fixed (A8a, A9, A14d). */
import {newGame, step} from './engine.js';
import {applyAction} from './actions.js';
import {makeClassicSite, makeProcSite} from './construction.js';
import {canyonParams, chokePoints} from './terrain.js';
import {CONFIG} from './config.js';
import {SAVE_VERSION} from './state.js';

/* `lastReject` is the reason string of the last refused action. Refusals are not logged, so it must not take part in the hash (A8a): replay == live.
   Floats are quantised to 10 significant digits before hashing (A14e): sin, cos, exp, pow and log differ in the last bits between JS engines, and the hash
   must not (the state itself is never rounded, only what is hashed). Integers are hashed as they are. */
function hashState(st){const s=JSON.stringify(st,function(k,v){if(typeof v==='number')return Number.isInteger(v)?v:+v.toPrecision(10);return (k==='lastReject'&&this===st)?undefined:v;});let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return ('00000000'+(h>>>0).toString(16)).slice(-8);}
function clone(o){return JSON.parse(JSON.stringify(o));}
function makeSave(st,log){return {schema:'hydropower-tycoon-save',version:SAVE_VERSION,init:st.init,day:st.day,state:clone(st),log:log?clone(log):[]};}

/* ---------- validateSave (A14d): every field the sim reads must exist with the right type, and every number must be finite. ----------
   The reference is a fresh game built from the save's own `init` (so the shape can never drift from newGame); a reference value of
   null means "null or an object" (crack, call, plan, climate, emergency ...), an empty reference array means "array whose entries are checked by kind". */
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
function shape(ref,v,path,out){
  if(out.length)return;
  if(ref===null){if(v!==null&&!isObj(v))out.push(path+' must be null or an object');return;}
  if(typeof ref==='number'){if(!isNum(v))out.push(path+' must be a finite number');return;}
  if(typeof ref==='string'){if(typeof v!=='string')out.push(path+' must be text');return;}
  if(typeof ref==='boolean'){if(typeof v!=='boolean')out.push(path+' must be true or false');return;}
  if(Array.isArray(ref)){if(!Array.isArray(v)){out.push(path+' must be a list');return;}
    if(ref.length&&typeof ref[0]!=='undefined')for(let i=0;i<v.length&&!out.length;i++)shape(ref[0],v[i],path+'['+i+']',out);return;}
  if(!isObj(v)){out.push(path+' is missing or not an object');return;}
  for(const k of Object.keys(ref)){if(k==='crestLen'||k==='damPlan'||k==='sculpt')continue;shape(ref[k],v[k],path+'.'+k,out);if(out.length)return;}
}
function refSite(i,x){ // a fresh site of the same kind, used as the shape reference
  if(x.kind==='classic')return makeClassicSite(x.seed|0);
  const cp=canyonParams(x.seed|0,x.bias,x.river);const st0=chokePoints(cp)[0].z;const s=makeProcSite(i,'ref',x.seed|0,x.bias,x.river,st0,0);s.dam.crestLen=0;return s;}
function validateSave(o){
  if(!o||typeof o!=='object')return 'Not a save object';if(o.schema!=='hydropower-tycoon-save')return 'Wrong schema';if(typeof o.version!=='number')return 'Unsupported save version';if(o.version<SAVE_VERSION)return 'This save is from an earlier version and cannot be loaded';if(o.version>SAVE_VERSION)return 'This save is from a newer version of the game and cannot be loaded';
  const s=o.state;if(!s||typeof s!=='object'||!Array.isArray(s.sites)||!s.sites.length)return 'Missing sites';if(typeof s.cash!=='number'||typeof s.tick!=='number'||!s.rng||!s.init)return 'Corrupt state';
  const init=s.init;if(!isObj(init)||!isNum(init.seed)||(init.kind!=='proc'&&init.kind!=='classic'))return 'Corrupt state: init';
  const out=[];
  try{
    const ref=newGame(init);
    const rest=Object.assign({},ref);delete rest.sites;delete rest.jobs;delete rest.alerts;delete rest.queue;delete rest.shop;delete rest.contracts;delete rest.init;
    shape(rest,s,'state',out);if(out.length)return 'Corrupt state: '+out[0];
    if(!isObj(s.init))return 'Corrupt state: init';
    shape(ref.shop,s.shop,'state.shop',out);if(out.length)return 'Corrupt state: '+out[0];if(!Array.isArray(s.shop)||s.shop.length!==ref.shop.length)return 'Corrupt state: shop';
    // contracts: offers and active blocks share one shape (active ones also carry `end`)
    {const c=s.contracts;if(!isObj(c)||!isNum(c.nextId)||!isNum(c.fulfilledHours)||!Array.isArray(c.offers)||!Array.isArray(c.active))return 'Corrupt state: contracts';
      const cref=ref.contracts.offers[0];for(const list of [c.offers,c.active])for(const x of list){shape(cref,x,'state.contracts',out);if(out.length)return 'Corrupt state: '+out[0];}
      for(const x of c.active)if(!isNum(x.end))return 'Corrupt state: contract end';}
    if(!Array.isArray(s.alerts))return 'Corrupt state: alerts';for(const a of s.alerts){shape(ref.alerts[0],a,'state.alerts',out);if(out.length)return 'Corrupt state: '+out[0];}
    if(!Array.isArray(s.queue)||s.queue.some(a=>!isObj(a)))return 'Corrupt state: queue';
    if(!Array.isArray(s.jobs))return 'Corrupt state: jobs';for(const j of s.jobs){if(!isObj(j)||typeof j.kind!=='string'||!isNum(j.rem)||!isNum(j.total)||!isNum(j.id)||!Number.isInteger(j.site)||!s.sites[j.site]||!isObj(j.p))return 'Corrupt state: job';}
    for(const x of s.loanBook)if(!isObj(x)||!isNum(x.amt)||!isNum(x.due))return 'Corrupt state: loan book';
    if(!Number.isInteger(s.speed)||s.speed<0||s.speed>5||!Number.isInteger(s.active)||!s.sites[s.active])return 'Corrupt state: speed or active site';
    if(!Number.isInteger(s.tick)||s.tick<0||!Number.isInteger(s.day)||s.day<0)return 'Corrupt state: clock';
    for(let i=0;i<s.sites.length;i++){const x=s.sites[i];if(!isObj(x))return 'Corrupt site';if(x.kind!=='classic'&&x.kind!=='proc')return 'Corrupt site';
      const sr=refSite(i,x);shape(sr,x,'state.sites['+i+']',out);if(out.length)return 'Corrupt site: '+out[0];
      if(x.tiles.length!==48||x.parcels.length!==3||x.auto.rules.length!==8||x.upper.V<0||x.lower.V<0)return 'Corrupt site';
      for(let t=0;t<48;t++){const q=x.tiles[t];if(!isObj(q))return 'Corrupt site: tile '+t;for(const k of ['solar','wind','battery']){const e=q[k];if(e===undefined)return 'Corrupt site: tile '+t;if(e!==null){if(!isObj(e)||!Number.isInteger(e.tier)||e.tier<0||e.tier>2)return 'Corrupt site: tile '+t+' '+k;}}}
      for(const u of [x.turbine,x.pump])if(!Number.isInteger(u.tier)||u.tier<0||u.tier>2||u.health<0||u.health>100)return 'Corrupt site: equipment';
      if(x.dam.crestLen!==undefined&&!isNum(x.dam.crestLen))return 'Corrupt site: dam';
      if(!Array.isArray(x.hist)||x.hist.some(h=>!isObj(h)))return 'Corrupt site: history';
      for(const v of x.route||[])if(!isObj(v)||!isNum(v.x)||!isNum(v.y)||!isNum(v.z))return 'Corrupt site: route';}
  }catch(e){return 'Corrupt state';}
  return null;
}

/* Replay stops when the sim cannot advance (bankrupt, not started) and no log entry is left (A9). */
function replay(init,log,untilTick){const st=newGame(init);let i=0;while(true){while(i<log.length&&log[i].tick===st.tick){applyAction(st,log[i].a);i++;}if(st.tick>=untilTick)break;
  if(!st.started){if(i>=log.length)break;st.tick=log[i].tick;continue;}
  if(step(st)===0){if(i>=log.length||log[i].tick!==st.tick)break;}}return st;}

export {SAVE_VERSION, clone, hashState, makeSave, replay, validateSave};
