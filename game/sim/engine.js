/* newGame, the fixed-step pipeline (step), hourly events and day boundary. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {SC, canyonParams, chokePoints} from './terrain.js';
import {addJob, makeClassicSite, makeProcSite, stepJobs, tileRC} from './construction.js';
import {QUESTS, checkQuests} from './quests.js';
import {climateHour, emergActive, genContracts} from './market.js';
import {addAlert} from './state.js';
import {applyAction} from './actions.js';
import {godHour, godPlan} from './god.js';
import {climateAt, stepWeather} from './climate.js';
import {endCall, startCall, stepAccumulate, stepPlant, stepRenewables, stepWear} from './plant.js';
import {resLevel, stepReservoirs} from './reservoirs.js';
import {settleHour} from './economy.js';
import {clamp, iint, rnd} from './rng.js';

function newGame(opts){
  opts=opts||{};const seed=(opts.seed>>>0)||12345;const kind=opts.kind==='proc'?'proc':'classic';const bias=CONFIG.proc.bias[opts.bias]?opts.bias:'balanced';
  const river=CONFIG.proc.riverW[opts.river]?opts.river:'medium';const demo=!!opts.demo;
  let station=opts.station;if(kind==='proc'&&(typeof station!=='number')){station=chokePoints(canyonParams(seed,bias,river))[0].z;}
  const init={seed,kind,bias,river,station:kind==='proc'?station:0,demo};
  if(opts.sculpt)init.sculpt=SC.norm(opts.sculpt);
  const T=CONFIG.time;
  const st={schema:'hydro-state',version:1,init,seed,demo,started:false,paused:true,speed:2,turnMode:false,turnPending:false,tick:0,t:0,secInHour:0,
    hour:T.startHour,day:0,doy:T.startDoy,year:1,H:T.startDoy*24+T.startHour,
    rng:{events:(seed^0x2545F491)|0||7,storm:(seed^0x68E31DA4)|0||11,market:(seed^0x1B56C4E9)|0||13,contracts:(seed^0x7FEB352D)|0||17},
    cash:demo?CONFIG.fin.demoCash:CONFIG.fin.startCash,loans:0,emergencyUsed:false,sandbox:false,bankrupt:false,won:false,
    fin:{subsidy:0,revenue:0,costs:0,profitToday:0,profitYesterday:0,lifetime:0,dayHist:[],lastHour:0,yearBonus:0,opHours:0},
    market:{price:0,base:0,forecast:[],cheap:0,peak:0,trend:0,prev:0,emergency:null,req:CONFIG.reserve.reqBase},
    climate:null,reserve:{score:1,fines:0,revenue:0,calls:0,ok:0},
    contracts:{offers:[],active:[],nextId:1,fulfilledHours:0},
    god:{enabled:false,dispatch:true,flowTarget:CONFIG.god.flowTarget,cashReserve:CONFIG.god.cashReserve,cheapHours:CONFIG.god.cheapHours,peakHours:CONFIG.god.peakHours,curtailNeg:true,protect:true,planner:true,stale:false,planProfit:0,planH:-1},
    settings:{cashReserve:40000},permits:{gravity:false,arch:false},shop:CONFIG.shop.map((x,i)=>({bought:false,permit:false,seed:(seed^Math.imul(x.seed,0x9E3779B1))>>>0})),
    sites:[],active:0,jobs:[],nextJob:1,quests:{},stats:{genMWh:0,pumpedM3:0,cleaned:0,windBuilt:0,battBuilt:0,reserveOffered:0,callsOk:0,rulesSet:0,contractsSigned:0,raised:0,excavated:0,sitesBought:0,permits:0,renDayMWh:0,renDayMax:0,profitDays:0,t2t:false,t2p:false},
    alerts:[],alertSeq:0,queue:[],lastReject:''};
  let s0;if(kind==='classic')s0=makeClassicSite(seed);else{s0=makeProcSite(0,'Home Canyon',seed,bias,river,station,0);s0.dam.crestLen=0;} // canyon start: the choke point is reserved, the player places (and pays for) the dam; basin starts empty
  if(init.sculpt)SC.apply(s0,SC.norm(init.sculpt));
  st.sites.push(s0);
  s0.tiles[0].solar={tier:1,soil:0,curtail:0,health:100}; // starter Tier-2 array on parcel 1, tile 0
  for(const q of QUESTS)st.quests[q.id]={done:false,claimed:false};
  climateHour(st);genContracts(st);
  addAlert(st,'info','Welcome to the field station. Press Start when you are ready.');
  return st;
}

function step(st){
  if(!st.started||st.bankrupt)return 0;
  while(st.queue.length)applyAction(st,st.queue.shift());
  if(st.god.stale){st.god.stale=false;if(st.god.enabled&&st.god.planner)godPlan(st);}
  let dt=CONFIG.time.dtBySpeed[st.speed];const rem=3600-st.secInHour;if(dt>rem)dt=rem; // never cross an hour boundary
  for(let i=0;i<st.sites.length;i++){const s=st.sites[i];stepWeather(st,s,dt);stepRenewables(st,s,dt);stepPlant(st,s,dt);stepReservoirs(st,s,dt);stepWear(st,s,dt);stepAccumulate(st,s,dt);}
  stepJobs(st,dt);
  for(const s of st.sites){if(s.call&&s.call.el>=CONFIG.reserve.callDur)endCall(st,s);}
  st.secInHour+=dt;st.t+=dt;st.tick++;
  if(st.secInHour>=3600){st.secInHour=0;settleHour(st);st.hour++;st.H++;if(st.hour>=24){st.hour=0;dayBoundary(st);}climateHour(st);hourEvents(st);godHour(st);checkQuests(st);if(st.turnMode)st.turnPending=false;}
  return dt;
}

function hourEvents(st){
  const R=CONFIG.reserve,W=CONFIG.wind;const emerg=emergActive(st.market.emergency,st.day,st.hour);
  for(const s of st.sites){
    if(s.reserveOffer>0&&!s.call){const p=emerg?R.callPEmerg:R.callP;if(rnd(st,'events')<p)startCall(st,s,s.reserveOffer);}
    for(let i=0;i<48;i++){const w=s.tiles[i].wind;if(!w||w.building)continue;
      if(st.climate.storm&&!w.damaged&&(w.v||0)>W.cutOut*0.9&&rnd(st,'storm')<W.dmgP){w.damaged=true;addAlert(st,'warn',s.name+': storm damaged wind turbine on tile '+(i-16*tileRC(i).p+1)+'.',s.id);}
      if(w.damaged&&!w.repairing){const cost=W.tiers[w.tier].kW*W.tiers[w.tier].costKW*W.repairFrac;
        if(st.cash-cost>=st.settings.cashReserve){st.cash-=cost;w.repairing=true;addJob(st,s.id,'repair',W.repairHours,{target:'wind',tile:i});}}}
  }
  if(emerg&&st.hour===st.market.emergency.start)addAlert(st,'crit','Grid emergency for '+st.market.emergency.dur+' h: prices and reserve pay are elevated.');
}
function dayBoundary(st){
  st.day++;st.doy++;if(st.doy>=360){st.doy=0;}
  st.fin.profitYesterday=st.fin.profitToday;if(st.fin.profitToday>0)st.stats.profitDays++;st.fin.dayHist.push(st.fin.profitToday);if(st.fin.dayHist.length>60)st.fin.dayHist.shift();st.fin.profitToday=0;
  st.stats.renDayMax=Math.max(st.stats.renDayMax,st.stats.renDayMWh);st.stats.renDayMWh=0;
  const cl=climateAt(st.seed,st.H);const R=CONFIG.reserve;
  for(const s of st.sites){
    const meanT=s.dayTn>0?s.dayTsum/s.dayTn:10;s.coldDays=meanT<CONFIG.res.iceT?s.coldDays+1:0;s.ice=s.coldDays>=CONFIG.res.iceDays?1:(meanT>1?0:s.ice);
    for(const t of s.tiles){if(t.solar){t.solar.soil=s.dayRain>=CONFIG.solar.washMM?t.solar.soil*0.5:Math.min(0.3,t.solar.soil+CONFIG.solar.soilDay);}}
    // dam damage §9.4
    const D=CONFIG.dam,dm=s.dam;const stormDay=cl.storm===1;
    if(dm.built&&!dm.crack&&dm.stormSpill&&dm.height>D.crackThresh*D.classes[dm.cls].max){if(rnd(st,'events')<D.crackP){dm.crack={elev:dm.height*(1-D.crackZone*rnd(st,'events')),damage:0};addAlert(st,'crit',s.name+': crack found in the upper dam wall. Drain below '+dm.crack.elev.toFixed(1)+' m and order a repair.',s.id);}}
    if(dm.crack){const hU=resLevel(s.upper,s.upper.V);if(hU>dm.crack.elev)dm.crack.damage=Math.min(100,dm.crack.damage+(dm.storm?D.crackWearStorm:D.crackWearDay));
      if(dm.crack.damage>=50&&!dm.crack.w50){dm.crack.w50=true;addAlert(st,'crit',s.name+': dam crack damage at '+iint(dm.crack.damage)+'. Repair urgently.',s.id);}}
    dm.stormSpill=false;dm.storm=stormDay;s.dayTsum=0;s.dayTn=0;s.dayRain=0;
  }
  // emergency scheduling: random eligible start so the 2–4 h event ends the same day
  if(rnd(st,'events')<R.emergP){const dur=R.emergMin+iint(rnd(st,'events')*(R.emergMax-R.emergMin+1));const last=24-dur;const start=6+iint(rnd(st,'events')*(last-6+1));st.market.emergency={day:st.day,start:Math.min(start,last),dur};}
  if(st.day-15*iint(st.day/15)===0)genContracts(st);
  for(let i=st.contracts.active.length-1;i>=0;i--){if(st.day>=st.contracts.active[i].end){addAlert(st,'info','Contract "'+st.contracts.active[i].name+'" ended.');st.contracts.active.splice(i,1);}}
  if(st.day===CONFIG.time.daysPerYear){let bonus=0;for(const s of st.sites){const cap=s.yr.capH;if(cap>0)bonus+=100*clamp(s.yr.eRen/cap,0,1);}st.cash+=bonus;st.fin.yearBonus=bonus;st.year=2;addAlert(st,'info','Year-end renewable bonus: $'+bonus.toFixed(0)+'.');}
}

export {newGame, step};
