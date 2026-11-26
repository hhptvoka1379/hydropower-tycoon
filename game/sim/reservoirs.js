/* Reservoir volume/level geometry, capacities, fill percentages and the per-step water mass balance. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {PI, TAU} from './rng.js';

/* ---------- reservoir geometry §3.1: V(h)=a1·h + a2·h² + a3·h³ ---------- */
function resVol(r,h){return r.a1*h+r.a2*h*h+r.a3*h*h*h;}
function resArea(r,h){return r.a1+2*r.a2*h+3*r.a3*h*h;}
function resLevel(r,V){if(V<=0)return 0;if(r.a3===0){if(r.a2===0)return V/r.a1;return (-r.a1+Math.sqrt(r.a1*r.a1+4*r.a2*V))/(2*r.a2);}
  let h=Math.min(Math.sqrt(V/Math.max(r.a2,1e-9)),Math.pow(V/r.a3,1/3));for(let i=0;i<40;i++){h=Math.max(0,h-(resVol(r,h)-V)/Math.max(1e-6,resArea(r,h)));}return h;}
function capU(s){return s.dam.built?resVol(s.upper,Math.max(0,s.dam.height-CONFIG.res.freeboard)):0;}
function capL(s){return resVol(s.lower,s.lower.hMax);}

function bowlR(r,h){return Math.sqrt((r.a1+2*r.a2*h+3*r.a3*h*h)/PI);}

function upPct(s){const c=capU(s);return c>0?100*s.upper.V/c:0;}
function loPct(s){return 100*s.lower.V/capL(s);}

function stepReservoirs(st,s,dt){ // §3.2 exact mass balance: ΔV = Σ Q·dt
  const R=CONFIG.res,cl=st.climate,lg=s.ledger;const iso=st.isolate;
  const transfer=s.q*dt;s.upper.V-=transfer;s.lower.V+=transfer;lg.transfer+=transfer;
  if(transfer>0)s.acc.qGenV+=transfer;else s.acc.qPumpV-=transfer;
  if(iso){s.tel.hU=resLevel(s.upper,s.upper.V);s.tel.hL=resLevel(s.lower,s.lower.V);return;}
  const hU=resLevel(s.upper,s.upper.V),hL=resLevel(s.lower,s.lower.V);
  const aU=s.dam.built?resArea(s.upper,hU):0,aL=resArea(s.lower,hL);
  const T=cl.T;const rainMS=cl.rain/1000/3600;const melting=T>=CONFIG.snow.tSnow;
  const rainU=melting?rainMS*aU*dt:0,rainL=melting?rainMS*aL*dt:0;
  const ev=s.ice>0.5?0:CONFIG.res.evapK*Math.max(0,T)*(1+0.5*cl.heat)*(1-0.6*cl.cloud)/1000/86400;
  const evU=Math.min(s.upper.V,ev*aU*dt),evL=Math.min(s.lower.V,ev*aL*dt);
  // valley runoff + valley snow melt (per site), split between basins
  const catchU=s.kind==='classic'?CONFIG.classic.catchU:CONFIG.proc.catchLocal*0.4,catchL=s.kind==='classic'?CONFIG.classic.catchL:CONFIG.proc.catchLocal*0.6;
  let vmelt=0;if(T>0&&s.valleySnow>0){vmelt=Math.min(s.valleySnow,CONFIG.snow.ddf*T*dt/86400);s.valleySnow-=vmelt;}
  const runMM=(melting?cl.rain*dt/3600:0)*R.runoffK+vmelt;const roU=s.dam.built?runMM/1000*catchU:0,roL=runMM/1000*catchL+(s.dam.built?0:runMM/1000*catchU);
  // river (procedural sites): linear store fed by base flow, rain runoff, snowpack melt (this site's only)
  let qIn=0;if(s.kind==='proc'){const P=CONFIG.proc;let melt=0;if(T>0&&s.snowpack>0){melt=Math.min(s.snowpack,CONFIG.snow.ddf*T*dt/86400);s.snowpack-=melt;}
    const seaF=1+0.35*Math.sin(TAU*(st.doy-20)/360);const inMM=(melting?cl.rain*dt/3600:0)*R.runoffK+melt;
    s.riverStore+=P.baseFlow[s.river]*seaF*dt+inMM/1000*P.catchArea[s.river];qIn=s.riverStore/P.riverK;s.riverStore-=qIn*dt;}
  const inU=s.dam.built?qIn*dt:0;const passL=s.dam.built?0:qIn*dt;
  s.upper.V+=rainU+roU+inU-evU;s.lower.V+=rainL+roL+passL-evL;
  let spU=0;const cU=capU(s);if(s.upper.V>cU){spU=s.upper.V-cU;s.upper.V=cU;}s.lower.V+=spU;
  let envDel=0,unmet=0;const need=s.envQ*dt;envDel=Math.min(need,Math.max(0,s.lower.V));unmet=need-envDel;s.lower.V-=envDel;
  let spL=0;const cL=capL(s);if(s.lower.V>cL){spL=s.lower.V-cL;s.lower.V=cL;}
  s.riverIn=qIn;s.spillU=spU/dt;s.spillL=spL/dt;s.envDel=envDel/dt;s.riverOut=(envDel+spL)/dt;s.acc.envUnmet+=unmet;
  if(spU>0&&cl.storm&&cl.rain>0&&s.dam.height>CONFIG.dam.crackThresh*CONFIG.dam.classes[s.dam.cls].max)s.dam.stormSpill=true;
  lg.riverIn+=inU;lg.rainU+=rainU;lg.rainL+=rainL;lg.evapU+=evU;lg.evapL+=evL;lg.spillU+=spU;lg.spillL+=spL;lg.env+=envDel;lg.runoffU+=roU;lg.runoffL+=roL+passL;
  s.tel.hU=resLevel(s.upper,s.upper.V);s.tel.hL=resLevel(s.lower,s.lower.V);s.tel.evap=(evU+evL)/dt;
}

export {bowlR, capL, capU, loPct, resArea, resLevel, resVol, stepReservoirs, upPct};
