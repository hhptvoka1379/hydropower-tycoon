/* Hourly settlement, running costs, equipment/build costs, 20-year NPV quotes and net worth. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {emergActive} from './market.js';
import {loPct, upPct} from './reservoirs.js';
import {addAlert} from './state.js';
import {reserveCap} from './hydraulics.js';

function omPerHour(s){let om=0;if(s.dam.built){om+=CONFIG.turbine[s.turbine.tier].om+CONFIG.pump[s.pump.tier].om;}
  for(const t of s.tiles){if(t.solar)om+=CONFIG.solar.tiers[t.solar.tier].kWp*CONFIG.solar.omKWyr/CONFIG.time.hoursPerYear;if(t.wind)om+=CONFIG.wind.tiers[t.wind.tier].kW*CONFIG.wind.omKWyr/CONFIG.time.hoursPerYear;if(t.battery)om+=CONFIG.battery.tiers[t.battery.tier].om;}return om;}
function renCapMW(s){let c=0;for(const t of s.tiles){if(t.solar&&!t.solar.building)c+=CONFIG.solar.tiers[t.solar.tier].kWp/1000;if(t.wind&&!t.wind.building)c+=CONFIG.wind.tiers[t.wind.tier].kW/1000;}return c;}
function settleHour(st){
  const M=CONFIG.market,R=CONFIG.reserve;const emerg=emergActive(st.market.emergency,st.day,st.hour);let total=0,totNetMW=0,yearRev=0;
  for(const s of st.sites){const a=s.acc;const avgMW=a.eNet;totNetMW+=avgMW;}
  const effP=st.market.base-M.impact*totNetMW; // own dispatch moves the price
  st.market.eff=effP;
  for(const s of st.sites){const a=s.acc;const rev=a.eNet*effP+a.callE*effP*R.energyPremium+(emerg&&a.eNet>0?a.eNet*M.emergBonus:0);const om=omPerHour(s);
    const avail=(s.reserveOffer>0&&reserveCap(s)/1e6>=s.reserveOffer-1e-9)?s.reserveOffer*R.availPay*(emerg?2:1):0; // A2: paid only in hours where the plant can still deliver the offer
    const revPos=Math.max(0,rev)+avail;yearRev+=revPos;const env=a.envUnmet*CONFIG.envCharge;const fine=a.fine||0;
    const net=rev+avail-om-env;total+=net;st.reserve.revenue+=avail;
    st.stats.genMWh+=a.eGen;st.stats.pumpedM3+=a.qPumpV;st.stats.renDayMWh+=a.eRen;
    s.yr.eRen+=a.eRen;s.yr.capH+=renCapMW(s);
    s.hist.push({day:st.day,hour:st.hour,price:effP,gen:a.eGen,pump:a.ePump,ren:a.eRen,net:a.eNet,rev,om,env,avail,fine,vu:s.upper.V,vl:s.lower.V,pu:upPct(s),pl:loPct(s)});
    if(s.hist.length>CONFIG.histHours)s.hist.shift();
    s.lastEnv=env;s.acc={eGen:0,ePump:0,eRen:0,eRenAvail:0,eBin:0,eBout:0,eNet:0,envUnmet:0,callE:0,qGenV:0,qPumpV:0,fine:0};}
  // contracts
  let cNet=0,inWin=0,allOk=true;for(const c of st.contracts.active){if(st.hour>=c.h0&&st.hour<c.h1){const d=Math.max(0,totNetMW);const short=Math.max(0,c.mw-d);cNet+=Math.min(d,c.mw)*c.premium-short*c.penalty;inWin++;if(short>0)allOk=false;}}
  if(inWin>0&&allOk)st.contracts.fulfilledHours++; // A15c: one clock hour counts once, however many contracts overlap in it
  total+=cNet;yearRev+=Math.max(0,cNet);st.fin.yearRevenue+=yearRev;
  const interest=st.loans*st.loanRate/CONFIG.time.hoursPerYear;total-=interest;
  st.cash+=total;st.fin.lifetime+=total;st.fin.profitToday+=total;st.fin.lastHour=total;st.fin.opHours++;
  if(st.god.enabled&&st.god.protect&&total<CONFIG.profitFloor){const sub=CONFIG.profitFloor-total;st.cash+=sub;st.fin.subsidy+=sub;} // A1: assisted mode, its own ledger line; never part of profit, net worth, quests or the win check
  if(st.demo&&st.cash<CONFIG.fin.demoCash*0.5)st.cash=CONFIG.fin.demoCash;
  if(!st.demo&&!st.sandbox&&st.cash<CONFIG.fin.bankrupt&&!st.bankrupt){st.bankrupt=true;st.paused=true;addAlert(st,'crit','Bankrupt: cash fell below the $'+(-CONFIG.fin.bankrupt)+' overdraft. Restructure your debts: refinance, or sell tiles.');}
}

function realCash(st){return st.cash-st.fin.subsidy;} // cash without the assisted-mode subsidy
function netWorth(st){let v=realCash(st)-st.loans;for(const s of st.sites){v+=s.dam.value*0.5+CONFIG.turbine[s.turbine.tier].cost*s.turbine.health/100+CONFIG.pump[s.pump.tier].cost*s.pump.health/100;
  for(const t of s.tiles){if(t.solar)v+=CONFIG.solar.tiers[t.solar.tier].kWp*CONFIG.solar.tiers[t.solar.tier].costKW*0.6;if(t.wind)v+=CONFIG.wind.tiers[t.wind.tier].kW*CONFIG.wind.tiers[t.wind.tier].costKW*0.6;if(t.battery)v+=CONFIG.battery.tiers[t.battery.tier].cost*0.5*(1-t.battery.fade);}}return v;}

/* ---------- loans, restructuring (A13, decisions D6) ---------- */
function creditLimit(st){return st.day<st.creditCutUntil?CONFIG.fin.maxLoan*CONFIG.fin.creditCutFrac:CONFIG.fin.maxLoan;}
function sumBook(st){let t=0;for(const x of st.loanBook)t+=x.amt;st.loans=t<1e-6?0:t;if(st.loans===0){st.loanBook.length=0;st.loanRate=CONFIG.fin.loanRate;}}
function borrow(st,amt){st.loanBook.push({amt,due:st.day+CONFIG.fin.termDays});st.cash+=amt;sumBook(st);}
function repayDebt(st,amt){let left=amt;while(left>1e-9&&st.loanBook.length){const t=st.loanBook[0];const x=Math.min(left,t.amt);t.amt-=x;left-=x;if(t.amt<=1e-6)st.loanBook.shift();}sumBook(st);}
function settleMaturity(st){ // a tranche past its term is paid down from cash above the operating reserve; what cannot be paid is extended for a year
  for(const t of st.loanBook){if(st.day<t.due)continue;const pay=Math.min(t.amt,Math.max(0,st.cash-st.settings.cashReserve));
    if(pay>0){st.cash-=pay;t.amt-=pay;}
    if(t.amt>1e-6){t.due=st.day+CONFIG.fin.extendDays;addAlert(st,'warn','A loan reached its term: $'+Math.round(pay)+' repaid, $'+Math.round(t.amt)+' extended for '+CONFIG.fin.extendDays+' days.');}
    else addAlert(st,'info','A loan reached its term and was repaid in full ($'+Math.round(pay)+').');}
  st.loanBook=st.loanBook.filter(t=>t.amt>1e-6);sumBook(st);}
function sellValue(t){let eq=0;for(const k of ['solar','wind','battery'])if(t[k])eq+=equipCost(k,t[k].tier);return CONFIG.fin.sellFrac*(eq+CONFIG.land.tileCost);}
function sellableTiles(st){const out=[];for(const s of st.sites)for(let i=0;i<48;i++){const t=s.tiles[i];if(!t||!(t.solar||t.wind||t.battery))continue;if((t.solar&&t.solar.building)||(t.wind&&t.wind.building)||(t.battery&&t.battery.building))continue;out.push({site:s.id,tile:i,value:sellValue(t)});}return out;}
function restructureOptions(st){ // read-only: what each way out of bankruptcy would do
  const F=CONFIG.fin;const top=Math.max(0,F.refiCash-st.cash);const sell=sellableTiles(st);let total=0;for(const x of sell)total+=x.value;
  return {bankrupt:st.bankrupt,refinance:{cashAfter:st.cash+top,loansAfter:st.loans+top,rate:F.refiRate,creditCutDays:F.creditCutDays,termDays:F.termDays},sell:{tiles:sell,total,needed:Math.max(0,-st.cash)}};}

function repairCost(unit,tier,health){return CONFIG[unit][tier].cost*(CONFIG.jobs.repairBase+CONFIG.jobs.repairSpan*(1-health/100));} // unit cost × (0.02 + 0.30 × damage): the price REPAIR charges for a turbine or pump
function penstockCost(s,D,mat){return CONFIG.penstock.materials[mat].cost*s.penstock.L*D+CONFIG.penstock.mobilisation;}
function cleanCost(so){return CONFIG.solar.cleanBase+CONFIG.solar.cleanKW*CONFIG.solar.tiers[so.tier].kWp;}
function equipCost(kind,tier){if(kind==='solar')return CONFIG.solar.tiers[tier].kWp*CONFIG.solar.tiers[tier].costKW;if(kind==='wind')return CONFIG.wind.tiers[tier].kW*CONFIG.wind.tiers[tier].costKW;if(kind==='battery')return CONFIG.battery.tiers[tier].cost;return 0;}
function buildCost(st,si,tile,kind,tier){const s=st.sites[si];const t=s.tiles[tile];const eq=equipCost(kind,tier);const empty=!t.solar&&!t.wind&&!t.battery;
  const land=empty?CONFIG.land.tileCost:0;const coloc=(kind==='solar'&&!!t.wind)||(kind==='wind'&&!!t.solar);const disc=coloc?eq*CONFIG.coloc:0;
  return {equip:eq,land,discount:disc,coloc,cost:eq-disc+land};}
export {borrow, buildCost, cleanCost, creditLimit, equipCost, netWorth, omPerHour, penstockCost, realCash, repairCost, repayDebt, restructureOptions, sellValue, settleHour, settleMaturity, sumBook};
