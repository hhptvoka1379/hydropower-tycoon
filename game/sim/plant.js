/* Per-step plant pipeline: renewables, hydro unit dispatch/ramp, batteries, wear, energy accumulation, reserve calls. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {tileRC} from './construction.js';
import {TAU, absf, clamp, iint} from './rng.js';
import {cavitation, genPower, grossHead, hydraulics, pumpPower, solveQ} from './hydraulics.js';
import {evalRules} from './rules.js';
import {capU, loPct, resLevel, resVol, upPct} from './reservoirs.js';
import {addAlert} from './state.js';

function socAvg(s){let e=0,c=0;for(const t of s.tiles){if(t.battery){const B=CONFIG.battery.tiers[t.battery.tier];const cap=B.MWh*(1-t.battery.fade);e+=t.battery.soc*cap;c+=cap;}}return c>0?e/c:0;}

function stepRenewables(st,s,dt){ // §5.2–5.3 solar and wind with wake/shade, soiling, curtailment
  const S=CONFIG.solar,W=CONFIG.wind,cl=st.climate;let pRen=0,pAvail=0;
  const gcur=(st.god.enabled&&st.god.curtailNeg)?s.godCurtail:0; // god mode: curtailment fraction chosen by the planner (or the old negative-price rule)
  for(let i=0;i<48;i++){const t=s.tiles[i];if(!t.solar&&!t.wind)continue;const rc=tileRC(i);
    if(t.solar&&!t.solar.building){const tier=S.tiers[t.solar.tier];let sh=1;if(t.wind)sh*=S.shadeSame;
      if(rc.r<3){const n=s.tiles[i+4];if(n&&n.wind)sh*=S.shadeNorth;}
      const p=tier.kWp*1000*(s.tel.G/1000)*Math.max(0,1+S.gamma*(s.tel.Tc-25))*(1-t.solar.soil)*sh;
      const cur=Math.max(gcur,s.curtailSolar);t.solar.p=p*(1-cur);t.solar.avail=p;pRen+=t.solar.p;pAvail+=p;}
    if(t.wind&&!t.wind.building){const tier=W.tiers[t.wind.tier];let up=0;for(let c=0;c<rc.c;c++){const o=s.tiles[rc.p*16+rc.r*4+c];if(o.wind)up++;}
      const v=cl.wind*s.tel.windMul*Math.pow(tier.hub/10,W.shear)*Math.pow(W.wake,up);t.wind.v=v;
      let p=0;if(!t.wind.damaged&&v>=W.cutIn&&v<W.cutOut){p=v>=W.rated?tier.kW*1000:tier.kW*1000*(v*v*v-W.cutIn*W.cutIn*W.cutIn)/(W.rated*W.rated*W.rated-W.cutIn*W.cutIn*W.cutIn);}
      t.wind.rpm=(!t.wind.damaged&&v>=W.cutIn&&v<W.cutOut)?60*W.lambda*v/(TAU*tier.R):0; // §5.3 rpm = 60·λ·v/(2πR)
      t.wind.feathered=!t.wind.damaged&&v>=W.cutOut;
      const cur=Math.max(gcur,t.wind.curtail);t.wind.avail=p;t.wind.p=p*(1-cur);pRen+=t.wind.p;pAvail+=p;}
  }
  s.tel.pRen=pRen;s.tel.pRenAvail=pAvail;s.tel.windHub=cl.wind*s.tel.windMul;
}

function stepPlant(st,s,dt){ // §2.6 plant solve: request → ramp → limits → power, batteries
  const C=CONFIG,E=C.eff;const T=C.turbine[s.turbine.tier],Pm=C.pump[s.pump.tier];const tel=s.tel;
  const Hg=s.dam.built?grossHead(s):0;
  let req='idle',flow=0,local=false;
  if(s.call){req='gen';}
  else{let dec=false;
    if(st.god.enabled&&st.god.dispatch){req=s.godMode;flow=s.godFlow;dec=true;} // god dispatch outranks the rules engine
    if(!dec&&s.auto.enabled){const r=evalRules(st,s);if(r){req=r.act==='pump_local'?'pump':r.act;local=r.act==='pump_local';flow=r.flow;dec=true;}else{req='idle';dec=true;}}
    if(!dec){req=s.reqMode;flow=s.flowSet;}}
  s.mode=req;s.localPump=local;
  const canGen=s.dam.built&&!s.turbine.busy&&!s.penstock.busy&&s.turbine.health>0&&resLevel(s.upper,s.upper.V)>C.res.minOpU;
  const canPump=s.dam.built&&!s.pump.busy&&!s.penstock.busy&&s.pump.health>0&&resLevel(s.lower,s.lower.V)>C.res.minOpL&&s.upper.V<capU(s);
  let target=0;
  if(req==='gen'&&canGen){if(s.call){const base=s.call.base;target=solveQ(genPower,s,Hg,base+s.call.mw*1e6,T.Qr*E.xMaxT);}else target=clamp(flow,T.Qr*E.xMinT,T.Qr*E.xMaxT);}
  else if(req==='pump'&&canPump)target=-clamp(flow,Pm.Qr*E.xMinP,Pm.Qr*E.xMaxP);
  let q=s.q;const rr=C.ramp.rate*dt;
  if(target!==0&&q!==0&&(target>0)!==(q>0)){q=q>0?Math.max(0,q-rr):Math.min(0,q+rr);}
  else if(q<target)q=Math.min(target,q+rr);else q=Math.max(target,q-rr);
  if(q>0&&!canGen)q=0;if(q<0&&!canPump)q=0;
  // batteries (computed before local pump limit so stored energy can support the pump locally)
  let pBin=0,pBout=0;stepBatteries(st,s,dt,(a,b)=>{pBin+=a;pBout+=b;});
  if(q<0&&local){const surplus=Math.max(0,tel.pRen+pBout-pBin);const qmax=solveQ(pumpPower,s,Hg,surplus,Pm.Qr*E.xMaxP);
    if(-q>qmax)q=-qmax;if(-q<Pm.Qr*E.xMinP*0.999)q=0;} // close immediately: never import to sustain the pump
  if(q>0){const avail=s.upper.V-resVol(s.upper,C.res.minOpU);if(q*dt>avail)q=Math.max(0,avail/dt);}
  if(q<0){const avail=s.lower.V-resVol(s.lower,C.res.minOpL);if(-q*dt>avail)q=-Math.max(0,avail/dt);}
  s.q=q;
  let pGen=0,pPump=0;const aq=absf(q);const h=hydraulics(s,aq);let Hn=Hg,eta=0;
  if(q>0){const r=genPower(s,q,Hg);if(r.Hn<=0){s.q=0;}else{pGen=r.P;Hn=r.Hn;eta=r.eta;}}
  else if(q<0){const r=pumpPower(s,-q,Hg);pPump=r.P;Hn=r.H;eta=r.eta;}
  const cav=cavitation(s,aq,Hn,q>0?pGen:pPump,q>0?1:q<0?-1:0);
  Object.assign(tel,{Hg,Hn:q>0?Hn:(q<0?Hg+h.hf:Hg),hf:h.hf,Q:s.q,v:h.v,Re:h.Re,f:h.f,eta,pGen,pPump,pBin,pBout,pBatt:pBout-pBin,sigma:cav.sigma,sigmaC:cav.sigmaC,cavT:cav.cavT,npshA:cav.npshA,npshR:cav.npshR,cavP:cav.cavP});
  tel.pNet=pGen+tel.pRen+pBout-pPump-pBin; // §6.2 per-step energy netting
  s.actual=s.q>0?'gen':s.q<0?'pump':'idle';
  if(s.call){s.call.el+=dt;const del=pGen-s.call.base;if(s.call.el>CONFIG.reserve[RESERVE_WINDOW_KEY]){s.call.sum+=Math.max(0,del)*dt;s.call.t+=dt;}s.call.last=del;s.call.q=s.q;}
}

function stepBatteries(st,s,dt,cb){ // §7.4 batteries: RTE split evenly, SOC range, cycle fade
  const B=CONFIG.battery;const ec=Math.sqrt(B.rte),ed=Math.sqrt(B.rte);
  for(const t of s.tiles){const b=t.battery;if(!b||b.building)continue;const tier=B.tiers[b.tier];const cap=tier.MWh*(1-b.fade);let mode=b.mode;
    if(mode==='auto'){mode=(st.market.price<=st.market.cheap||st.market.price<0)?'charge':(st.market.price>=st.market.peak||(s.call&&s.call.last<s.call.mw*1e6))?'discharge':'idle';}
    let pin=0,pout=0;const E=b.soc*cap;const pw=tier.MW*(b.pf===undefined?1:b.pf); // pf: planner power fraction
    if(mode==='charge'){const room=Math.max(0,B.socMax*cap-E);pin=Math.min(pw,room/(ec*dt/3600));}
    else if(mode==='discharge'){const av=Math.max(0,E-B.socMin*cap);pout=Math.min(pw,av*ed/(dt/3600));}
    const dE=(pin*ec-pout/ed)*dt/3600;b.soc=cap>0?clamp((E+dE)/cap,0,1):0;
    const thr=(pin+pout)*dt/3600;b.thr+=thr;b.fade=Math.min(B.fadeMax,b.fade+B.fadePerEFC*thr/(2*tier.MWh));
    b.pin=pin;b.pout=pout;b.eIn+=pin*dt/3600;b.eOut+=pout*dt/3600;b.act=pin>0?'charging':pout>0?'discharging':'idle';
    cb(pin*1e6,pout*1e6);}
}

function stepWear(st,s,dt){ // §4 wear
  const W=CONFIG.wear;const h=dt/3600;
  if(s.q>0){const x=s.q/CONFIG.turbine[s.turbine.tier].Qr;s.turbine.health=clamp(s.turbine.health-W.turbinePerHour*x*h*(s.tel.cavT<1?W.cavMult:1),0,100);}
  if(s.q<0){const x=-s.q/CONFIG.pump[s.pump.tier].Qr;s.pump.health=clamp(s.pump.health-W.pumpPerHour*x*h*(s.tel.cavP<1?W.cavMult:1),0,100);}
  if(s.dam.built)s.penstock.health=clamp(s.penstock.health-CONFIG.penstock.wearPerHour*h*(1+s.tel.v/4),0,100);
}
function stepAccumulate(st,s,dt){ // §6.2 energy accumulation in MWh
  const k=dt/3.6e9,a=s.acc,t=s.tel;a.eGen+=t.pGen*k;a.ePump+=t.pPump*k;a.eRen+=t.pRen*k;a.eRenAvail+=t.pRenAvail*k;a.eBin+=t.pBin*k;a.eBout+=t.pBout*k;
  a.eNet+=t.pNet*k;if(s.call)a.callE+=Math.max(0,s.call.last)*k;
  const hU=s.tel.hU,hL=s.tel.hL;t.pctU=upPct(s);t.pctL=loPct(s);
}

function endCall(st,s){const c=s.call;const R=CONFIG.reserve;const avg=c.t>0?c.sum/c.t:0;const ok=avg>=R.okFrac*c.mw*1e6&&c.last>=R.okFrac*c.mw*1e6;
  st.reserve.calls++;if(ok){st.reserve.ok++;st.stats.callsOk++;}else{const short=Math.max(0,c.mw-avg/1e6)*(c.t/3600);const fine=short*R.fine;st.cash-=fine;st.reserve.fines+=fine;s.acc.fine=(s.acc.fine||0)+fine;addAlert(st,'warn',s.name+': reserve call under-delivered — fine $'+iint(fine),s.id);}
  st.reserve.score=0.85*st.reserve.score+0.15*(ok?1:0);s.call=null;}
function startCall(st,s,mw){const Hg=grossHead(s);s.call={mw,el:0,sum:0,t:0,last:0,base:s.q>0?genPower(s,s.q,Hg).P:0,q:s.q};addAlert(st,'warn',s.name+': reserve call — deliver +'+mw.toFixed(2)+' MW.',s.id);}

function forceCall(st,si,mw){startCall(st,st.sites[si],mw);} // audit hook

export {endCall, forceCall, socAvg, startCall, stepAccumulate, stepPlant, stepRenewables, stepWear};
