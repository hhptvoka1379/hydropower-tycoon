/* Player action validation, charging and application (applyAction) with reject reasons. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {absf, clamp, iint} from './rng.js';
import {SC, canyonParams, chokePoints, penstockRoute, procLayout, routeLen} from './terrain.js';
import {addJob, clsFor, damPrice, makeProcSite, maxClassH, tileRC} from './construction.js';
import {addAlert} from './state.js';
import {borrow, buildCost, cleanCost, creditLimit, penstockCost, repairCost, repayDebt, sellValue} from './economy.js';
import {godHeuristicDispatch, godPlan} from './god.js';
import {reserveCap} from './hydraulics.js';
import {QUESTS, checkQuests} from './quests.js';

function rej(st,r){st.lastReject=r;return {ok:false,reason:r};}
function pay(st,c){if(st.demo)return true;if(st.cash<c)return false;st.cash-=c;return true;}
function getSite(st,a){const i=a.site===undefined?st.active:a.site;return st.sites[i];}
function applyAction(st,a){
  if(!a||typeof a.type!=='string')return rej(st,'Malformed action');
  const C=CONFIG;const s=getSite(st,a);
  switch(a.type){
    case 'START':st.started=true;st.paused=false;return {ok:true};
    case 'SET_SPEED':{const v=a.speed|0;if(v<0||v>5)return rej(st,'Speed must be 0–5');st.speed=v;st.turnMode=false;return {ok:true};}
    case 'PAUSE':st.paused=a.paused===undefined?!st.paused:!!a.paused;return {ok:true};
    case 'SET_TURN':st.turnMode=!!a.on;st.paused=false;return {ok:true};
    case 'TURN_STEP':if(!st.started)return rej(st,'Start the game first');st.turnMode=true;st.turnPending=true;return {ok:true};
    case 'SET_FLOW':{if(!s)return rej(st,'No site');const q=+a.q;if(!(q>=0&&q<=20))return rej(st,'Flow out of range');s.flowSet=q;return {ok:true};}
    case 'SET_MODE':{if(!s)return rej(st,'No site');if(['gen','pump','idle'].indexOf(a.mode)<0)return rej(st,'Unknown mode');if(!s.dam.built&&a.mode!=='idle')return rej(st,'No dam at this site yet');
      s.reqMode=a.mode;if(!a.god){s.auto.enabled=false;st.god.dispatch=false;}if(a.q!==undefined)s.flowSet=clamp(+a.q,0,20);return {ok:true};}
    case 'SET_CURTAIL':{if(!s)return rej(st,'No site');const f=clamp(+a.frac||0,0,1);if(a.tile===undefined||a.tile<0){s.curtailSolar=f;return {ok:true};}const w=s.tiles[a.tile]&&s.tiles[a.tile].wind;if(!w)return rej(st,'No wind turbine on that tile');w.curtail=f;return {ok:true};}
    case 'PLACE_DAM':{if(!s||s.kind!=='proc')return rej(st,'Dams can only be placed on canyon sites');if(s.dam.built)return rej(st,'This site already has a dam');
      const stn=a.station===undefined?s.station:+a.station;
      const ch=chokePoints(s.cp);let near=null;for(const c of ch)if(absf(c.z-stn)<=C.proc.chokeTol)near=c;if(!near)return rej(st,'Pick a permitted canyon choke point');
      const h=iint(a.height||C.proc.damH0);if(h<5)return rej(st,'A dam must be at least 5 m high');if(h>s.maxDam)return rej(st,'The valley rim limits this site to '+s.maxDam+' m');
      if(h>maxClassH(st)){const ck=clsFor(h);return rej(st,'A '+h+' m dam needs the '+C.dam.classes[ck].name+' permit (Build → Dam & basin → Dam permits)');}
      const same=near.z===s.station;if(!same){if(s.lower.excav>0)return rej(st,'The lower basin was already excavated at station '+s.station+' m; build the dam there');for(const j of st.jobs)if(j.site===s.id&&(j.kind==='excavate'||j.kind==='penstock'))return rej(st,'Finish the pending earthworks first');}
      const tmp=makeProcSite(s.id,s.name,s.seed,s.bias,s.river,near.z,h);if(s.sculpt)SC.apply(tmp,s.sculpt);const pr=damPrice(st,tmp,s.damPlan,0,h);const cost=pr.cost;if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');
      if(pr.stage>=0)for(const x of s.damPlan.stages)if(x.h<=h)x.done=true;
      // keep everything that is already built, bought or flowing (equipment, parcels, rules, the lower lake with its water, snow and river stores, ledgers)
      const keep={tiles:s.tiles,parcels:s.parcels,turbine:s.turbine,pump:s.pump,auto:s.auto,flowSet:s.flowSet,reqMode:s.reqMode,curtailSolar:s.curtailSolar,snowpack:s.snowpack,valleySnow:s.valleySnow,riverStore:s.riverStore,riverIn:s.riverIn,riverOut:s.riverOut,
        ice:s.ice,coldDays:s.coldDays,dayTsum:s.dayTsum,dayTn:s.dayTn,dayRain:s.dayRain,acc:s.acc,hist:s.hist,yr:s.yr,ledger:s.ledger,damPlan:s.damPlan};
      keep.penstock=Object.assign({},s.penstock,{L:tmp.penstock.L}); // A14b: the upgraded penstock (diameter, material, health) survives a new station; only its length follows the new route
      if(same)keep.lower=s.lower;
      Object.assign(s,tmp,keep);s.upper.V=0;if(s.sculpt)SC.apply(s,s.sculpt);else{s.layout=procLayout(s);s.route=penstockRoute(s);s.penstock.L=routeLen(s.route)+20;}
      addAlert(st,'info',s.name+': '+h+' m dam placed at station '+near.z+' m. The upper basin is empty and fills from the river.',s.id);return {ok:true,cost};}
    case 'RAISE_DAM':{if(!s||!s.dam.built)return rej(st,'No dam');if(s.dam.raising)return rej(st,'A raise is already in progress');const m=iint(a.meters||1);if(m<1)return rej(st,'Raise by at least 1 m');
      const to=s.dam.height+m;if(to>s.maxDam)return rej(st,'The valley rim limits this site to '+s.maxDam+' m');if(to>maxClassH(st))return rej(st,'Needs a permit for a taller dam class');
      if(s.dam.crack)return rej(st,'Repair the crack before raising');const cls=clsFor(Math.max(to,s.dam.height));const pr=damPrice(st,s,s.damPlan,s.dam.height,to);const cost=pr.cost;
      if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');s.dam.raising={from:s.dam.height,to,progress:0};st.stats.raised++;
      if(s.damPlan)for(const x of s.damPlan.stages)if(x.h<=to)x.done=true;
      addJob(st,s.id,'raise',C.dam.hoursPerM*m,{to,cls,cost,value:pr.base});return {ok:true,cost,base:pr.base,premium:pr.premium,discount:pr.discount};}
    case 'PLAN_DAM':{if(!s)return rej(st,'No site');if(s.kind!=='proc'&&s.kind!=='classic')return rej(st,'No site');const stg=a.stages;if(!Array.isArray(stg))return rej(st,'A programme is a list of stages {h, day}');
      if(stg.length===0){s.damPlan=null;return {ok:true,discount:0};}if(stg.length>8)return rej(st,'At most 8 stages');
      let ph=s.dam.built?s.dam.height:4,pd=st.day+C.dam.planLeadDays-1;const out=[];
      for(const x of stg){if(!x||typeof x!=='object')return rej(st,'Each stage needs {h, day}');const h=iint(x.h),d=iint(x.day);if(!(h>ph))return rej(st,'Stage heights must rise above '+ph+' m, one above the other');if(h>s.maxDam)return rej(st,'The valley rim limits this site to '+s.maxDam+' m');
        if(!(d>pd))return rej(st,'Stage days must be at least '+C.dam.planLeadDays+' days after today and in order');out.push({h,day:d,done:false});ph=h;pd=d;}
      s.damPlan={declared:st.day,stages:out};return {ok:true,discount:Math.min(C.dam.planDiscountMax,C.dam.planDiscountPer*out.length)};}
    case 'EXCAVATE':{if(!s)return rej(st,'No site');if(s.lower.excav>=C.res.excavStages)return rej(st,'All excavation stages done');for(const j of st.jobs)if(j.site===s.id&&j.kind==='excavate')return rej(st,'Excavation already under way');
      const cost=C.res.excavCost*(1+0.5*s.lower.excav);if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');st.stats.excavated++;addJob(st,s.id,'excavate',C.res.excavHours,{});return {ok:true,cost};}
    case 'BUILD':{if(!s)return rej(st,'No site');const tier=a.tier|0;if(tier<0||tier>2)return rej(st,'Tier must be 1–3');
      if(a.kind==='turbine'||a.kind==='pump'){const u=s[a.kind];if(u.busy)return rej(st,'Unit is busy');if(u.tier===tier&&u.health>99)return rej(st,'Already installed');if(tier<u.tier)return rej(st,'Downgrades are not allowed: the installed '+C[a.kind][u.tier].name+' is a higher tier');const cost=C[a.kind][tier].cost;if(!pay(st,cost))return rej(st,'Not enough cash ($'+cost+')');
        u.busy=true;addJob(st,s.id,'machine',C.jobs.machineHours,{unit:a.kind,tier});return {ok:true,cost};}
      if(['solar','wind','battery'].indexOf(a.kind)<0)return rej(st,'Unknown build kind');const tile=a.tile|0;const t=s.tiles[tile];if(!t)return rej(st,'No such tile');
      if(!s.parcels[tileRC(tile).p])return rej(st,'Parcel not owned');
      if(a.kind==='battery'){if(t.battery)return rej(st,'Tile already has a battery');if(t.wind)return rej(st,'Batteries cannot share a tile with wind');}
      else{if(t[a.kind])return rej(st,'Tile already has '+a.kind);if(t.battery&&a.kind==='wind')return rej(st,'Tile holds a battery');}
      const bc=buildCost(st,s.id,tile,a.kind,tier);if(!pay(st,bc.cost))return rej(st,'Not enough cash ($'+iint(bc.cost)+')');
      if(a.kind==='solar')t.solar={tier,soil:0,curtail:0,building:true,p:0};else if(a.kind==='wind'){t.wind={tier,curtail:0,damaged:false,building:true,rpm:0,p:0,v:0};st.stats.windBuilt++;}
      else{t.battery={tier,soc:0.5,fade:0,mode:'auto',thr:0,eIn:0,eOut:0,building:true,pin:0,pout:0,act:'idle'};st.stats.battBuilt++;}
      addJob(st,s.id,'build',C.jobs.buildHours,{tile,kind:a.kind});return {ok:true,cost:bc.cost};}
    case 'REPLACE_PENSTOCK':{if(!s)return rej(st,'No site');const D=+a.D,mat=a.mat;if(!C.penstock.materials[mat])return rej(st,'Unknown material');if(!(D>=C.penstock.Dmin&&D<=C.penstock.Dmax))return rej(st,'Diameter out of range');
      if(s.penstock.busy)return rej(st,'Penstock work already under way');const cost=penstockCost(s,D,mat);if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');
      s.penstock.busy=true;s.q=0;addJob(st,s.id,'penstock',C.penstock.replaceHours,{D,mat});return {ok:true,cost};}
    case 'CLEAN_ARRAY':{if(!s)return rej(st,'No site');const so=s.tiles[a.tile]&&s.tiles[a.tile].solar;if(!so)return rej(st,'No solar array on that tile');if(so.soil<0.001)return rej(st,'Already clean');
      const cost=cleanCost(so);if(!pay(st,cost))return rej(st,'Not enough cash ($'+cost+')');so.soil=0;st.stats.cleaned++;return {ok:true,cost};}
    case 'REPAIR':{if(!s)return rej(st,'No site');const tg=a.target;
      if(tg==='turbine'||tg==='pump'){const u=s[tg];if(u.busy)return rej(st,'Unit is busy');if(u.health>=99.9)return rej(st,'No repair needed');const cost=repairCost(tg,u.tier,u.health);if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');u.busy=true;addJob(st,s.id,'repair',C.jobs.repairHours,{target:tg});return {ok:true,cost};}
      if(tg==='dam'){if(!s.dam.crack)return rej(st,'No crack to repair');if(s.dam.repairing)return rej(st,'Repair under way');const cost=s.dam.value*C.dam.repairFrac;if(!pay(st,cost))return rej(st,'Not enough cash ($'+iint(cost)+')');s.dam.repairing=true;addJob(st,s.id,'repair',C.dam.repairHours,{target:'dam'});return {ok:true,cost};}
      if(tg==='wind'){const w=s.tiles[a.tile]&&s.tiles[a.tile].wind;if(!w||!w.damaged)return rej(st,'Turbine is not damaged');if(w.repairing)return rej(st,'Repair under way');const tr=C.wind.tiers[w.tier];const cost=tr.kW*tr.costKW*C.wind.repairFrac;if(!pay(st,cost))return rej(st,'Not enough cash');w.repairing=true;addJob(st,s.id,'repair',C.wind.repairHours,{target:'wind',tile:a.tile});return {ok:true,cost};}
      if(tg==='battery'){const b=s.tiles[a.tile]&&s.tiles[a.tile].battery;if(!b)return rej(st,'No battery');if(b.fade<0.001)return rej(st,'No fade to refurbish');const cost=C.battery.tiers[b.tier].cost*C.battery.refurbFrac;if(!pay(st,cost))return rej(st,'Not enough cash');b.fade=0;b.thr=0;return {ok:true,cost};}
      return rej(st,'Unknown repair target');}
    case 'SET_BATTERY':{const b=s&&s.tiles[a.tile]&&s.tiles[a.tile].battery;if(!b)return rej(st,'No battery');if(['auto','charge','discharge','idle'].indexOf(a.mode)<0)return rej(st,'Unknown mode');b.mode=a.mode;return {ok:true};}
    case 'TAKE_LOAN':{if(a.god)return rej(st,'Automation never borrows');const amt=+a.amount;if(!(amt>0))return rej(st,'Amount must be positive');const lim=creditLimit(st);if(st.loans+amt>lim)return rej(st,'Credit limit is $'+lim+(lim<C.fin.maxLoan?' (cut for '+(st.creditCutUntil-st.day)+' more days after a restructure)':''));borrow(st,amt);return {ok:true};}
    case 'REPAY_LOAN':{const amt=Math.min(+a.amount||0,st.loans);if(!(amt>0))return rej(st,'Nothing to repay');if(st.cash<amt&&!st.demo)return rej(st,'Not enough cash');st.cash-=amt;repayDebt(st,amt);return {ok:true};}
    case 'SIGN_CONTRACT':{const i=st.contracts.offers.findIndex(o=>o.id===a.id);if(i<0)return rej(st,'Offer not available');if(st.contracts.active.length>=2)return rej(st,'At most two active contracts');
      const o=st.contracts.offers.splice(i,1)[0];o.end=st.day+o.days;st.contracts.active.push(o);st.stats.contractsSigned++;if(st.god.enabled&&st.god.planner)godPlan(st);return {ok:true};}
    case 'BUY_PERMIT':{if(a.kind==='dam'){const cls=a.cls;if(cls!=='gravity'&&cls!=='arch')return rej(st,'Unknown class');if(st.permits[cls])return rej(st,'Already permitted');if(cls==='arch'&&!st.permits.gravity)return rej(st,'Gravity permit first');
        const cost=C.dam.classes[cls].permit;if(!pay(st,cost))return rej(st,'Not enough cash');st.permits[cls]=true;st.stats.permits++;return {ok:true,cost};}
      if(a.kind==='parcel'){const p=a.parcel|0;if(!s||p<1||p>2)return rej(st,'Unknown parcel');if(s.parcels[p])return rej(st,'Already owned');const cost=C.land.parcelCost[p];if(!pay(st,cost))return rej(st,'Not enough cash');s.parcels[p]=true;st.stats.permits++;return {ok:true,cost};}
      if(a.kind==='water'){const sh=st.shop[a.id|0];if(!sh)return rej(st,'Unknown site');if(sh.permit)return rej(st,'Already permitted');const cost=C.shop[a.id|0].permit;if(!pay(st,cost))return rej(st,'Not enough cash');sh.permit=true;st.stats.permits++;return {ok:true,cost};}
      return rej(st,'Unknown permit');}
    case 'BUY_SITE':{const i=a.id|0;const sh=st.shop[i];if(!sh)return rej(st,'Unknown site');if(sh.bought)return rej(st,'Already owned');if(!sh.permit&&!st.demo)return rej(st,'Buy the water-rights permit first');
      const cost=C.shop[i].cost;if(!pay(st,cost))return rej(st,'Not enough cash');sh.bought=true;const biases=['gentle','balanced','rugged'];
      const bi=['gentle','balanced','rugged'][i],rv=['medium','large','small'][i];
      const ns=makeProcSite(st.sites.length,C.shop[i].name,sh.seed,bi,rv,chokePoints(canyonParams(sh.seed,bi,rv))[0].z,0);
      ns.dam={cls:'earth',height:0,built:false,value:0,crack:null,raising:null,storm:false,stormSpill:false,crestLen:0};ns.upper.V=0;st.sites.push(ns);st.stats.sitesBought++;addAlert(st,'info','Bought '+ns.name+'. Place a dam at a canyon choke point.',ns.id);return {ok:true,cost};}
    case 'SET_RESERVE_OFFER':{if(!s)return rej(st,'No site');const mw=+a.mw;if(!(mw>=0))return rej(st,'Invalid MW');const cap=reserveCap(s)/1e6;if(mw>cap+1e-9)return rej(st,'Offer exceeds deliverable reserve ('+cap.toFixed(2)+' MW within '+C.reserve[RESERVE_WINDOW_KEY]+' s)');
      s.reserveOffer=mw;if(mw>0)st.stats.reserveOffered++;if(st.god.enabled&&st.god.planner)godPlan(st);return {ok:true,cap};}
    case 'SET_RULES':{if(!s)return rej(st,'No site');if(a.rules){if(!Array.isArray(a.rules)||a.rules.length!==8)return rej(st,'Exactly 8 rule slots');
        for(const r of a.rules){if(typeof r!=='object'||['gen','pump','pump_local','idle'].indexOf(r.act)<0)return rej(st,'Invalid rule action');}
        s.auto.rules=a.rules.map(r=>({on:!!r.on,pri:clamp(r.pri|0,1,8),cond:String(r.cond),val:+r.val||0,cond2:String(r.cond2||'none'),val2:+r.val2||0,act:r.act,flow:clamp(+r.flow||0,0,20)}));}
      if(a.enabled!==undefined)s.auto.enabled=!!a.enabled;if(st.started&&s.auto.enabled&&s.auto.rules.filter(r=>r.on).length>=2)st.stats.rulesSet++;return {ok:true};} // A15b: only a player action in a running game completes q9, not the default rules set at new game
    case 'CLAIM_QUEST':{const r=st.quests[a.id];const q=QUESTS.find(x=>x.id===a.id);if(!r||!q)return rej(st,'Unknown quest');if(!r.done)return rej(st,'Not complete yet');if(r.claimed)return rej(st,'Already claimed');r.claimed=true;st.cash+=q.reward;checkQuests(st);return {ok:true};}
    case 'SET_GOD':{const g=st.god;for(const k of ['enabled','dispatch','curtailNeg','protect'])if(a[k]!==undefined)g[k]=!!a[k];
      if(a.planner!==undefined)g.planner=!!a.planner;if(a.flowTarget!==undefined)g.flowTarget=clamp(+a.flowTarget,0.2,1.1);if(a.cashReserve!==undefined)g.cashReserve=Math.max(0,+a.cashReserve);
      if(a.cheapHours!==undefined)g.cheapHours=clamp(a.cheapHours|0,1,12);if(a.peakHours!==undefined)g.peakHours=clamp(a.peakHours|0,1,12);if(a.enabled)g.dispatch=a.dispatch===undefined?true:!!a.dispatch;if(g.enabled&&g.planner)godPlan(st);else if(g.enabled)for(const x of st.sites)godHeuristicDispatch(st,x);else if(a.enabled===false)for(const x of st.sites){x.plan=null;x.godCurtail=0;for(const t of x.tiles)if(t.battery){t.battery.mode='auto';t.battery.pf=1;}}return {ok:true};}
    case 'SET_OPTION':{if(a.key==='cashReserve'){st.settings.cashReserve=Math.max(0,+a.value||0);return {ok:true};}return rej(st,'Unknown option');}
    case 'EMERGENCY_CREDIT':{if(st.emergencyUsed)return rej(st,'Emergency credit already used');const room=Math.max(0,creditLimit(st)-st.loans);const amt=Math.min(C.fin.emergencyCredit,room);
      if(!(amt>0))return rej(st,'Credit limit reached ($'+creditLimit(st)+' of loans): restructure instead');
      if(st.bankrupt&&st.cash+amt<=C.fin.bankrupt)return rej(st,'Only $'+iint(amt)+' of credit is left, not enough to clear the overdraft: restructure instead');
      st.emergencyUsed=true;borrow(st,amt);st.bankrupt=false;addAlert(st,'warn','Emergency credit of $'+iint(amt)+' granted (one time).');return {ok:true,amount:amt};}
    case 'RESTRUCTURE':{if(!st.bankrupt)return rej(st,'Restructuring is only offered when the station is bankrupt');const F=C.fin;
      if(a.plan==='refinance'){const top=Math.max(0,F.refiCash-st.cash);st.cash+=top;st.loanBook=[{amt:st.loans+top,due:st.day+F.termDays}];st.loans=st.loanBook[0].amt;st.loanRate=F.refiRate;st.creditCutUntil=st.day+F.creditCutDays;
        st.bankrupt=false;st.paused=false;st.restructures++;addAlert(st,'warn','Debts refinanced into one loan of $'+iint(st.loans)+' at '+(F.refiRate*100).toFixed(0)+'%. New borrowing is limited for '+F.creditCutDays+' days.');return {ok:true,loans:st.loans,cash:st.cash};}
      if(a.plan==='sell'){if(!Array.isArray(a.tiles)||!a.tiles.length)return rej(st,'Choose at least one tile to sell');const seen={};let total=0;const picks=[];
        for(const x of a.tiles){const si=typeof x==='object'&&x!==null&&x.site!==undefined?x.site|0:(a.site===undefined?st.active:a.site|0);const ti=typeof x==='object'&&x!==null?x.tile|0:x|0;const ss=st.sites[si];const t=ss&&ss.tiles[ti];
          if(!t)return rej(st,'No such tile');if(seen[si+':'+ti])return rej(st,'Tile listed twice');seen[si+':'+ti]=1;if(!(t.solar||t.wind||t.battery))return rej(st,'Tile '+(ti+1)+' has nothing to sell');
          if((t.solar&&t.solar.building)||(t.wind&&t.wind.building)||(t.battery&&t.battery.building))return rej(st,'Tile '+(ti+1)+' is still under construction');total+=sellValue(t);picks.push(t);}
        if(st.cash+total<0)return rej(st,'These tiles raise $'+iint(total)+', not enough to clear the $'+iint(-st.cash)+' overdraft; choose more tiles or refinance');
        for(const t of picks){t.solar=null;t.wind=null;t.battery=null;}st.cash+=total;st.bankrupt=false;st.paused=false;st.restructures++;st.god.stale=true;
        addAlert(st,'warn','Sold '+picks.length+' tile'+(picks.length>1?'s':'')+' for $'+iint(total)+' to clear the overdraft.');return {ok:true,proceeds:total,cash:st.cash};}
      return rej(st,"Choose a plan: 'refinance' or 'sell'");}
    case 'CONTINUE_SANDBOX':st.sandbox=true;st.bankrupt=false;addAlert(st,'info','Sandbox continuation: bankruptcy and the win condition are disabled.');return {ok:true};
    case 'SET_ACTIVE':{const i=a.site|0;if(!st.sites[i])return rej(st,'No such site');st.active=i;return {ok:true};}
  }
  return rej(st,'Unknown action '+a.type);
}

export {applyAction};
