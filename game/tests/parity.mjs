/* Parity proof: the extracted ES modules (game/sim) must behave bit-for-bit like the legacy single-file sim.
   The legacy sim is loaded by slicing `function createSimModule(){...}` out of legacy/v2.index.html and evaluating it in a vm context.
   Identical scripted scenarios run on both implementations; the state hash, cash and lake levels are compared at every
   game day (and every 6 sim hours), plus the result of every action. Exit code is non-zero on any mismatch.
   Run: node game/tests/parity.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import NewSim, {createGame as newCreateGame} from '../sim/index.js';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const LEGACY=path.join(HERE,'..','legacy','v2.index.html');

/* ---------- load the legacy sim ---------- */
function loadLegacy(){
  const html=fs.readFileSync(LEGACY,'utf8');
  const a=html.indexOf('function createSimModule(){');
  if(a<0)throw new Error('createSimModule not found in legacy file');
  const b=html.indexOf('/* =====================================================================\n   RENDERER',a);
  if(b<0)throw new Error('end of createSimModule not found');
  const src=html.slice(a,b);
  return vm.runInNewContext('"use strict";'+src+';createSimModule()',{},{filename:'legacy-sim.js'});
}
const OldSim=loadLegacy();

/* legacy Game wrapper (lines ~2961-2973 of the legacy file) with the UI / renderer / clock lines removed, driven by the legacy Sim */
function legacyGame(Sim){
  const Engine={state:null,log:[],snap:null,dirty:true,force:true};
  function deepFreeze(o){Object.freeze(o);for(const k in o){const v=o[k];if(v&&typeof v==='object'&&!Object.isFrozen(v))deepFreeze(v);}return o;}
  return {
    getSnapshot(){if(!Engine.state)return null;if(!Engine.snap||(Engine.dirty&&Engine.force)){Engine.snap=deepFreeze(Sim.clone(Engine.state));Engine.dirty=false;Engine.force=false;}return Engine.snap;},
    dispatch(a){if(!Engine.state)return {ok:false,reason:'No game loaded'};let r;try{r=Sim.applyAction(Engine.state,a);}catch(e){return {ok:false,reason:'Internal error'};}
      if(r.ok){Engine.log.push({tick:Engine.state.tick,a:JSON.parse(JSON.stringify(a))});}Engine.dirty=true;Engine.force=true;return r;},
    newGame(o){Engine.state=Sim.newGame(o);Engine.log=[];Engine.dirty=true;Engine.force=true;this.dispatch({type:'SET_RULES',enabled:true});return Engine.state.init;},
    makeSave(){return Sim.makeSave(Engine.state,Engine.log);},
    loadSave(obj){const err=Sim.validateSave(obj);if(err)return {ok:false,reason:err};Engine.state=Sim.clone(obj.state);Engine.state.paused=true;Engine.log=Array.isArray(obj.log)?obj.log:[];Engine.dirty=true;Engine.force=true;return {ok:true};},
    runHeadless(steps){for(let i=0;i<steps;i++)Sim.step(Engine.state);Engine.dirty=true;return Sim.hashState(Engine.state);},
    hash(){return Engine.state?Sim.hashState(Engine.state):null;},
    get state(){return Engine.state;}
  };
}

/* ---------- scenarios ---------- */
const rules8=(()=>{const r=[
  {on:true,pri:5,cond:'price_lt',val:30,cond2:'upper_lt',val2:90,act:'pump',flow:3},
  {on:true,pri:6,cond:'price_gt',val:70,cond2:'upper_gt',val2:10,act:'gen',flow:4},
  {on:true,pri:4,cond:'ren_gt',val:0.1,cond2:'upper_lt',val2:90,act:'pump_local',flow:2.5},
  {on:true,pri:3,cond:'hour_ge',val:22,cond2:'soc_gt',val2:40,act:'idle',flow:0}];
  for(let i=r.length;i<8;i++)r.push({on:false,pri:1,cond:'always',val:0,cond2:'none',val2:0,act:'idle',flow:0});return r;})();

/* actions[day] = list of actions applied at the start of that game day (first step with st.day===day).
   queue[day] = actions pushed on st.queue instead (processed inside step). */
const classicActions={
  0:[{type:'START'},{type:'TAKE_LOAN',amount:700000},{type:'SET_SPEED',speed:2},{type:'SET_MODE',mode:'gen',q:3},{type:'SET_FLOW',q:4}],
  1:[{type:'BUILD',kind:'solar',tile:5,tier:0},{type:'BUILD',kind:'wind',tile:2,tier:0},{type:'BUILD',kind:'battery',tile:9,tier:0},{type:'SET_CURTAIL',frac:0.1}],
  2:[{type:'SET_RULES',rules:rules8,enabled:true},{type:'SET_RESERVE_OFFER',mw:0.3}],
  3:[{type:'SET_RESERVE_OFFER',mw:0.1},{type:'SIGN_CONTRACT',id:'c1'}],
  4:[{type:'SET_MODE',mode:'pump',q:2.5},{type:'RAISE_DAM',meters:2}],
  6:[{type:'SET_MODE',mode:'gen',q:5},{type:'SET_BATTERY',tile:9,mode:'charge'},{type:'CLEAN_ARRAY',tile:5}],
  7:[{type:'SET_RULES',enabled:true},{type:'TAKE_LOAN',amount:100000},{type:'BUY_PERMIT',kind:'parcel',parcel:1}],
  9:[{type:'EXCAVATE'},{type:'BUILD',kind:'turbine',tier:1},{type:'SET_OPTION',key:'cashReserve',value:20000}],
  12:[{type:'SET_MODE',mode:'idle'},{type:'SET_RESERVE_OFFER',mw:0.2},{type:'CLAIM_QUEST',id:'q1'},{type:'REPAIR',target:'turbine'}],
  15:[{type:'SET_MODE',mode:'pump',q:2},{type:'REPAY_LOAN',amount:50000},{type:'REPLACE_PENSTOCK',D:1.4,mat:'hdpe'}],
  20:[{type:'SET_RULES',rules:rules8,enabled:true},{type:'BUILD',kind:'solar',tile:20,tier:1},{type:'BUY_PERMIT',kind:'dam',cls:'gravity'}],
  25:[{type:'SET_MODE',mode:'gen',q:6},{type:'RAISE_DAM',meters:3},{type:'CLAIM_QUEST',id:'q3'},{type:'CLAIM_QUEST',id:'bogus'},{type:'NOPE'}]
};
const classicQueue={5:[{type:'SET_FLOW',q:3.5}],10:[{type:'SET_MODE',mode:'gen',q:4}]};
const godActions={
  0:[{type:'START'},{type:'TAKE_LOAN',amount:600000},{type:'SET_SPEED',speed:3},{type:'SET_GOD',enabled:true,planner:true}],
  1:[{type:'BUILD',kind:'battery',tile:9,tier:1},{type:'SET_RESERVE_OFFER',mw:0.2}],
  3:[{type:'SIGN_CONTRACT',id:'c2'},{type:'BUILD',kind:'wind',tile:1,tier:0}],
  8:[{type:'SET_GOD',planner:false}],
  14:[{type:'SET_GOD',planner:true,cashReserve:80000},{type:'SET_MODE',mode:'gen',q:3}],
  22:[{type:'SET_GOD',enabled:false}]
};
const procActions={
  0:[{type:'TAKE_LOAN',amount:700000},{type:'PLACE_DAM',height:8},{type:'START'},{type:'SET_SPEED',speed:3},{type:'SET_MODE',mode:'gen',q:2},{type:'SET_FLOW',q:3}],
  1:[{type:'BUILD',kind:'solar',tile:4,tier:0},{type:'BUILD',kind:'wind',tile:6,tier:0}],
  2:[{type:'SET_RULES',rules:rules8,enabled:true},{type:'SET_MODE',mode:'pump',q:2}],
  4:[{type:'RAISE_DAM',meters:2},{type:'SET_RESERVE_OFFER',mw:0.1}],
  8:[{type:'SET_MODE',mode:'gen',q:2.5},{type:'SET_CURTAIL',frac:0.2,tile:6}],
  11:[{type:'EXCAVATE'},{type:'SET_RULES',enabled:false},{type:'SET_MODE',mode:'idle'}],
  16:[{type:'RAISE_DAM',meters:1},{type:'TAKE_LOAN',amount:50000},{type:'SET_RESERVE_OFFER',mw:0}],
  21:[{type:'SET_MODE',mode:'pump',q:2},{type:'PLACE_DAM',height:9}],
  26:[{type:'BUY_PERMIT',kind:'water',id:0},{type:'BUY_SITE',id:0},{type:'SET_ACTIVE',site:1}]
};
const demoActions={
  0:[{type:'PLACE_DAM',height:20},{type:'START'},{type:'SET_SPEED',speed:3},{type:'SET_MODE',mode:'gen',q:3}],
  1:[{type:'BUILD',kind:'solar',tile:1,tier:2},{type:'BUILD',kind:'wind',tile:3,tier:1},{type:'BUILD',kind:'battery',tile:8,tier:2}],
  2:[{type:'SET_RULES',rules:rules8,enabled:true},{type:'SET_RESERVE_OFFER',mw:0.2}],
  3:[{type:'RAISE_DAM',meters:5},{type:'SIGN_CONTRACT',id:'c1'}],
  6:[{type:'SET_MODE',mode:'pump',q:4},{type:'BUILD',kind:'pump',tier:1}],
  9:[{type:'BUY_PERMIT',kind:'dam',cls:'gravity'},{type:'RAISE_DAM',meters:12},{type:'EXCAVATE'}],
  14:[{type:'SET_GOD',enabled:true,planner:true}],
  20:[{type:'SET_GOD',planner:false}],
  24:[{type:'SET_GOD',enabled:false},{type:'BUY_SITE',id:1},{type:'SET_ACTIVE',site:1},{type:'PLACE_DAM',height:10}]
};
const sculptGen={rug:70,hill:60,open:40,ridge:50,rang:45,ang:30,sp:95,forest:50,flower:50};

const SCENARIOS=[
  {name:'classic seed 14692 (manual+rules+reserve+build, 30 days)',opts:{seed:14692},actions:classicActions,queue:classicQueue,days:30},
  {name:'classic seed 14692 god mode planner/heuristic toggle, 30 days',opts:{seed:14692},actions:godActions,days:30},
  {name:'canyon seed 4242 balanced/medium start dam 8 m, 30 days',opts:{seed:4242,kind:'proc',bias:'balanced',river:'medium'},actions:procActions,days:30},
  {name:'canyon seed 99 rugged/large demo cash, dam 20 m + raise + god, 30 days',opts:{seed:99,kind:'proc',bias:'rugged',river:'large',demo:true},actions:demoActions,days:30},
  {name:'canyon seed 31337 gentle/small, 30 days',opts:{seed:31337,kind:'proc',bias:'gentle',river:'small'},actions:procActions,days:30},
  {name:'classic seed 1717 with sculpted land (rotated, spaced), 30 days',opts:{seed:1717,kind:'classic',sculpt:'SCULPT'},actions:classicActions,queue:classicQueue,days:30}
];

/* ---------- driver ---------- */
function sculptFor(Sim){const T=Sim.terrainH.sc;const g=new Int8Array(T.NG*T.NG);for(let i=0;i<g.length;i++)g[i]=((i*37)%41)-20;return {gen:sculptGen,d:T.enc(g)};}
function snap(Sim,st,label,res){const s=st.sites[st.active];return {label,hash:Sim.hashState(st),cash:st.cash,hU:Sim.resLevel(s.upper,s.upper.V),hL:Sim.resLevel(s.lower,s.lower.V),tick:st.tick,res:res===undefined?undefined:JSON.stringify(res)};}
function runScenario(Sim,sc){
  const opts=Object.assign({},sc.opts);if(opts.sculpt==='SCULPT')opts.sculpt=sculptFor(Sim);
  const st=Sim.newGame(opts);const trace=[snap(Sim,st,'init')];const doneDay={};let lastSix=-1;const t0=Date.now();
  let guard=0;
  while(st.day<sc.days&&!st.bankrupt){
    if(!doneDay[st.day]){doneDay[st.day]=true;
      for(const a of (sc.actions[st.day]||[])){const r=Sim.applyAction(st,JSON.parse(JSON.stringify(a)));trace.push(snap(Sim,st,'d'+st.day+' '+a.type,r));}
      for(const a of ((sc.queue&&sc.queue[st.day])||[]))st.queue.push(JSON.parse(JSON.stringify(a)));
      trace.push(snap(Sim,st,'day '+st.day+' start'));}
    const dt=Sim.step(st);
    if(dt===0){ if(!st.started){break;} }
    if(st.secInHour===0&&st.hour%6===0&&(st.day*24+st.hour)!==lastSix){lastSix=st.day*24+st.hour;trace.push(snap(Sim,st,'d'+st.day+' h'+st.hour));}
    if(++guard>3000000)throw new Error('runaway scenario');
  }
  trace.push(snap(Sim,st,'final'));
  return {trace,ms:Date.now()-t0,state:st};
}
function compareTraces(a,b){
  if(a.length!==b.length)return 'trace length '+a.length+' vs '+b.length;
  for(let i=0;i<a.length;i++){const x=a[i],y=b[i];
    for(const k of ['label','hash','cash','hU','hL','tick','res'])if(!Object.is(x[k],y[k]))return `at "${x.label}" (#${i}) field ${k}: legacy=${x[k]} extracted=${y[k]}`;}
  return null;
}

/* ---------- reporting ---------- */
let failures=0;const rows=[];
function report(name,err,detail){if(err){failures++;console.log('FAIL  '+name+'\n        '+err);}else console.log('PASS  '+name+(detail?'  '+detail:''));rows.push({name,ok:!err});}

/* 1. public surface */
{const ko=Object.keys(OldSim),kn=Object.keys(NewSim);
 let err=null;if(JSON.stringify(ko)!==JSON.stringify(kn))err='Sim keys differ: missing '+ko.filter(k=>!kn.includes(k)).join(',')+' extra '+kn.filter(k=>!ko.includes(k)).join(',');
 else if(JSON.stringify(OldSim.CONFIG)!==JSON.stringify(NewSim.CONFIG))err='CONFIG differs';
 else if(JSON.stringify(OldSim.QUESTS.map(q=>[q.id,q.title,q.desc,q.reward]))!==JSON.stringify(NewSim.QUESTS.map(q=>[q.id,q.title,q.desc,q.reward])))err='QUESTS differ';
 else if(typeof NewSim.terrainH.sc!=='object'||typeof NewSim.terrainH.shoreF!=='function')err='terrainH.sc/shoreF missing';
 report('public Sim API (names, order, CONFIG, QUESTS)',err,ko.length+' names');}

/* 2. pure functions on identical inputs */
{let err=null;const J=JSON.stringify;
 const eq=(label,f)=>{if(err)return;try{const a=J(f(OldSim)),b=J(f(NewSim));if(a!==b)err=label+' differs';}catch(e){err=label+' threw '+e.message;}};
 eq('climateAt',S=>{const o=[];for(let H=0;H<24*400;H+=37)o.push(S.climateAt(555,H));return o;});
 eq('sunAt',S=>{const o=[];for(let d=0;d<360;d+=20)for(let h=0;h<24;h+=2.5)o.push(S.sunAt(d,h));return o;});
 eq('terrainH classic',S=>{const st=S.newGame({seed:14692});const o=[];for(let x=-780;x<=780;x+=130)for(let z=-780;z<=780;z+=130)o.push(S.terrainH(st.sites[0],x,z));return o;});
 eq('terrainH canyon',S=>{const st=S.newGame({seed:4242,kind:'proc'});const o=[];for(let x=-780;x<=780;x+=130)for(let z=-780;z<=780;z+=130)o.push(S.terrainH(st.sites[0],x,z));return o;});
 eq('terrainH sculpt',S=>{const st=S.newGame({seed:1717,kind:'classic',sculpt:sculptFor(S)});const o=[];for(let x=-780;x<=780;x+=130)for(let z=-780;z<=780;z+=130)o.push(S.terrainH(st.sites[0],x,z),S.terrainH(st.sites[0],x,z,true));return o;});
 eq('survey/chokes/damQuote/planDam/quote',S=>{const st=S.newGame({seed:4242,kind:'proc',bias:'rugged',river:'large'});const si=S.surveyInfo(4242,'rugged','large',st.sites[0].station);
   const c=S.newGame({seed:14692});return [si,S.damQuote(st,0,undefined,15),S.planDam(c,0,{budget:2e6}),S.quote(c,0,3,'solar',1),S.quote(c,0,3,'wind',2),S.quote(c,0,7,'battery',1),S.chokePoints(S.canyonParams(9,'gentle','small'))];});
 eq('cavitation-adjacent hydraulics/genPower/pumpPower',S=>{const st=S.newGame({seed:14692});const s=st.sites[0];const Hg=S.grossHead(s);const o=[];for(let q=0.2;q<12;q+=0.7)o.push(S.hydraulics(s,q),S.genPower(s,q,Hg),S.pumpPower(s,q,Hg));o.push(S.reserveCap(s),S.storageMWh(s,30),S.damCost('arch',0,60,200));return o;});
 report('pure functions (climate, sun, terrain, survey, quotes, hydraulics)',err);}

/* 3. scenarios */
for(const sc of SCENARIOS){
  try{const o=runScenario(OldSim,sc),n=runScenario(NewSim,sc);const err=compareTraces(o.trace,n.trace);
    const days=Math.min(sc.days,o.state.day);
    if(process.env.PARITY_VERBOSE)console.log('        actions: '+o.trace.filter(t=>t.res!==undefined).map(t=>t.label.split(' ')[1]+(JSON.parse(t.res).ok?'+':'-'+(JSON.parse(t.res).reason||'').slice(0,22))).join(' '));
    report(sc.name,err,err?'':`${days} days, ${o.trace.length} checkpoints, final hash ${OldSim.hashState(o.state)}=${NewSim.hashState(n.state)}, cash ${o.state.cash.toFixed(2)}, ${o.ms}ms/${n.ms}ms`);
  }catch(e){report(sc.name,'threw '+(e&&e.stack||e));}
}

/* 4. Game wrapper (newGame/dispatch/getSnapshot/makeSave/loadSave/runHeadless/hash) + replay */
{let err=null,detail='';
 try{
  const O=legacyGame(OldSim),N=newCreateGame();
  const cmp=(label,a,b)=>{if(err)return;const x=JSON.stringify(a),y=JSON.stringify(b);if(x!==y)err=label+': legacy='+String(x).slice(0,120)+' extracted='+String(y).slice(0,120);};
  cmp('newGame init',O.newGame({seed:14692}),N.newGame({seed:14692}));
  cmp('hash after newGame',O.hash(),N.hash());
  for(const a of [{type:'START'},{type:'SET_SPEED',speed:3},{type:'SET_MODE',mode:'gen',q:3},{type:'BUILD',kind:'solar',tile:5,tier:0},{type:'NOPE'}])cmp('dispatch '+a.type,O.dispatch(a),N.dispatch(a));
  cmp('runHeadless 4000',O.runHeadless(4000),N.runHeadless(4000));
  cmp('snapshot',O.getSnapshot(),N.getSnapshot());
  if(!Object.isFrozen(N.getSnapshot()))err='snapshot not frozen';
  const so=O.makeSave(),sn=N.makeSave();cmp('makeSave',so,sn);
  O.runHeadless(3000);N.runHeadless(3000);
  cmp('loadSave result',O.loadSave(JSON.parse(JSON.stringify(so))),N.loadSave(JSON.parse(JSON.stringify(sn))));
  cmp('hash after loadSave',O.hash(),N.hash());
  cmp('dispatch after load',O.dispatch({type:'PAUSE',paused:false}),N.dispatch({type:'PAUSE',paused:false}));
  cmp('runHeadless after load',O.runHeadless(5000),N.runHeadless(5000));
  cmp('loadSave invalid',O.loadSave({schema:'x'}),N.loadSave({schema:'x'}));
  // deterministic replay of the action log (legacy Sim.replay vs extracted replay)
  const lo=O.makeSave(),ln=N.makeSave();
  const ro=OldSim.replay(lo.init,lo.log,lo.state.tick),rn=NewSim.replay(ln.init,ln.log,ln.state.tick);
  cmp('replay hash',OldSim.hashState(ro),NewSim.hashState(rn));
  detail='hash '+N.hash();
 }catch(e){err='threw '+(e&&e.stack||e);}
 report('Game wrapper: newGame/dispatch/getSnapshot/makeSave/loadSave/runHeadless/hash/replay',err,detail);}

const bad=rows.filter(r=>!r.ok).length;
console.log('\n'+(bad?'FAIL':'PASS')+': '+(rows.length-bad)+'/'+rows.length+' checks identical');
process.exit(failures?1:0);
