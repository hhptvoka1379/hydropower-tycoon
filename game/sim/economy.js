/* Hourly settlement, running costs, equipment/build costs, 20-year NPV quotes and net worth. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {emergActive} from './market.js';
import {loPct, upPct} from './reservoirs.js';
import {addAlert} from './state.js';
import {tileRC} from './construction.js';
import {climateAt, irradiance, sunAt} from './climate.js';
import {hu} from './rng.js';

function omPerHour(s){let om=0;if(s.dam.built){om+=CONFIG.turbine[s.turbine.tier].om+CONFIG.pump[s.pump.tier].om;}
  for(const t of s.tiles){if(t.solar)om+=CONFIG.solar.tiers[t.solar.tier].kWp*CONFIG.solar.omKWyr/CONFIG.time.hoursPerYear;if(t.wind)om+=CONFIG.wind.tiers[t.wind.tier].kW*CONFIG.wind.omKWyr/CONFIG.time.hoursPerYear;if(t.battery)om+=CONFIG.battery.tiers[t.battery.tier].om;}return om;}
function renCapMW(s){let c=0;for(const t of s.tiles){if(t.solar&&!t.solar.building)c+=CONFIG.solar.tiers[t.solar.tier].kWp/1000;if(t.wind&&!t.wind.building)c+=CONFIG.wind.tiers[t.wind.tier].kW/1000;}return c;}
function settleHour(st){
  const M=CONFIG.market,R=CONFIG.reserve;const emerg=emergActive(st.market.emergency,st.day,st.hour);let total=0,totNetMW=0;
  for(const s of st.sites){const a=s.acc;const avgMW=a.eNet;totNetMW+=avgMW;}
  const effP=st.market.base-M.impact*totNetMW; // own dispatch moves the price
  st.market.eff=effP;
  for(const s of st.sites){const a=s.acc;const rev=a.eNet*effP+a.callE*effP*R.energyPremium;const om=omPerHour(s);
    const avail=s.reserveOffer*R.availPay*(emerg?2:1);const env=a.envUnmet*CONFIG.envCharge;const fine=a.fine||0;
    const net=rev+avail-om-env;total+=net;st.reserve.revenue+=avail;
    st.stats.genMWh+=a.eGen;st.stats.pumpedM3+=a.qPumpV;st.stats.renDayMWh+=a.eRen;
    s.yr.eRen+=a.eRen;s.yr.capH+=renCapMW(s);
    s.hist.push({day:st.day,hour:st.hour,price:effP,gen:a.eGen,pump:a.ePump,ren:a.eRen,net:a.eNet,rev,om,env,avail,fine,vu:s.upper.V,vl:s.lower.V,pu:upPct(s),pl:loPct(s)});
    if(s.hist.length>CONFIG.histHours)s.hist.shift();
    s.lastEnv=env;s.acc={eGen:0,ePump:0,eRen:0,eRenAvail:0,eBin:0,eBout:0,eNet:0,envUnmet:0,callE:0,qGenV:0,qPumpV:0,fine:0};}
  // contracts
  let cNet=0;for(const c of st.contracts.active){if(st.hour>=c.h0&&st.hour<c.h1){const d=Math.max(0,totNetMW);const short=Math.max(0,c.mw-d);cNet+=Math.min(d,c.mw)*c.premium-short*c.penalty;if(short<=0)st.contracts.fulfilledHours++;}}
  total+=cNet;
  const interest=st.loans*CONFIG.fin.loanRate/CONFIG.time.hoursPerYear;total-=interest;
  st.cash+=total;st.fin.lifetime+=total;st.fin.profitToday+=total;st.fin.lastHour=total;st.fin.opHours++;
  if(st.god.enabled&&st.god.protect&&total<CONFIG.profitFloor){const sub=CONFIG.profitFloor-total;st.cash+=sub;st.fin.subsidy+=sub;st.fin.profitToday+=sub;}
  if(st.demo&&st.cash<CONFIG.fin.demoCash*0.5)st.cash=CONFIG.fin.demoCash;
  if(!st.demo&&!st.sandbox&&st.cash<CONFIG.fin.bankrupt&&!st.bankrupt){st.bankrupt=true;st.paused=true;addAlert(st,'crit','Bankrupt: cash fell below $'+(-CONFIG.fin.bankrupt)+' overdraft. Choose emergency credit or sandbox.');}
}

function netWorth(st){let v=st.cash-st.loans;for(const s of st.sites){v+=s.dam.value*0.5+CONFIG.turbine[s.turbine.tier].cost*s.turbine.health/100+CONFIG.pump[s.pump.tier].cost*s.pump.health/100;
  for(const t of s.tiles){if(t.solar)v+=CONFIG.solar.tiers[t.solar.tier].kWp*CONFIG.solar.tiers[t.solar.tier].costKW*0.6;if(t.wind)v+=CONFIG.wind.tiers[t.wind.tier].kW*CONFIG.wind.tiers[t.wind.tier].costKW*0.6;if(t.battery)v+=CONFIG.battery.tiers[t.battery.tier].cost*0.5*(1-t.battery.fade);}}return v;}

function penstockCost(s,D,mat){return CONFIG.penstock.materials[mat].cost*s.penstock.L*D+CONFIG.penstock.mobilisation;}
function cleanCost(so){return CONFIG.solar.cleanBase+CONFIG.solar.cleanKW*CONFIG.solar.tiers[so.tier].kWp;}
function equipCost(kind,tier){if(kind==='solar')return CONFIG.solar.tiers[tier].kWp*CONFIG.solar.tiers[tier].costKW;if(kind==='wind')return CONFIG.wind.tiers[tier].kW*CONFIG.wind.tiers[tier].costKW;if(kind==='battery')return CONFIG.battery.tiers[tier].cost;return 0;}
function buildCost(st,si,tile,kind,tier){const s=st.sites[si];const t=s.tiles[tile];const eq=equipCost(kind,tier);const empty=!t.solar&&!t.wind&&!t.battery;
  const land=empty?CONFIG.land.tileCost:0;const coloc=(kind==='solar'&&!!t.wind)||(kind==='wind'&&!!t.solar);const disc=coloc?eq*CONFIG.coloc:0;
  return {equip:eq,land,discount:disc,coloc,cost:eq-disc+land};}
function quote(st,si,tile,kind,tier){ // §6.5 20-year NPV from 24 h forecast; does not mutate state
  const s=st.sites[si];if(!s)return {ok:false,reason:'No such site'};const t=s.tiles[tile];if(!t)return {ok:false,reason:'No such tile'};
  const rc=tileRC(tile);if(!s.parcels[rc.p])return {ok:false,reason:'Parcel not owned'};
  if(kind==='battery'?(t.battery||t.wind):(t[kind]||t.battery))return {ok:false,reason:'Tile slot occupied'};
  const bc=buildCost(st,si,tile,kind,tier);const S=CONFIG.solar,W=CONFIG.wind;let rev=0,loss=0,energy=0;
  const fc=st.market.forecast;
  for(let k=0;k<24;k++){const H=st.H+k;const cl=climateAt(st.seed,H);const price=fc[k];let p=0,lo=0;
    if(kind==='solar'){const sun=sunAt(cl.doy,cl.hour+0.5);const G=irradiance(cl,sun);const Tc=cl.T+(S.noct-20)/800*G;let sh=1;if(t.wind)sh*=S.shadeSame;if(rc.r<3&&s.tiles[tile+4].wind)sh*=S.shadeNorth;
      p=S.tiers[tier].kWp*1000*G/1000*Math.max(0,1+S.gamma*(Tc-25))*sh;}
    else if(kind==='wind'){const tr=W.tiers[tier];let up=0;for(let c=0;c<rc.c;c++)if(s.tiles[rc.p*16+rc.r*4+c].wind)up++;
      const pw=v=>(v>=W.cutIn&&v<W.cutOut)?(v>=W.rated?1:(v*v*v-W.cutIn*W.cutIn*W.cutIn)/(W.rated*W.rated*W.rated-W.cutIn*W.cutIn*W.cutIn)):0;
      const mul=0.9+0.25*hu(s.seed,5,1);const v=cl.wind*mul*Math.pow(tr.hub/10,W.shear)*Math.pow(W.wake,up);p=tr.kW*1000*pw(v);
      for(let c=rc.c+1;c<4;c++){const o=s.tiles[rc.p*16+rc.r*4+c].wind;if(o){const to=W.tiers[o.tier];let u2=0;for(let cc=0;cc<c;cc++)if(s.tiles[rc.p*16+rc.r*4+cc].wind)u2++;
        const v1=cl.wind*mul*Math.pow(to.hub/10,W.shear);lo+=to.kW*1000*(pw(v1*Math.pow(W.wake,u2))-pw(v1*Math.pow(W.wake,u2+1)));}}
      if(t.solar)lo+=0;} // shade loss on own-tile solar counted below
    else{const B=CONFIG.battery.tiers[tier];if(price>=st.market.peak)p=B.MW*1e6*0.9;else if(price<=st.market.cheap)p=-B.MW*1e6;}
    energy+=p/1e6;rev+=p/1e6*price;loss+=lo/1e6*price;}
  if(kind==='wind'&&t.solar){rev-=0.03*energy*0;loss+=0;}
  const om=kind==='solar'?S.tiers[tier].kWp*S.omKWyr:kind==='wind'?W.tiers[tier].kW*W.omKWyr:CONFIG.battery.tiers[tier].om*CONFIG.time.hoursPerYear;
  const annual=(rev-loss)*CONFIG.time.daysPerYear-om;const r=CONFIG.fin.discount,n=CONFIG.fin.years;const af=(1-Math.pow(1+r,-n))/r;
  const npv=-bc.cost+annual*af;return {ok:true,cost:bc.cost,equip:bc.equip,land:bc.land,discount:bc.discount,coloc:bc.coloc,dayMWh:energy,dayRev:rev-loss,annual,npv,payback:annual>0?bc.cost/annual:Infinity,omYr:om};}

export {buildCost, cleanCost, netWorth, omPerHour, penstockCost, quote, settleHour};
