/* Reservoir volume/level geometry, capacities, fill percentages and the per-step water mass balance. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {PI, TAU, clamp} from './rng.js';

/* ---------- reservoir geometry §3.1: V(h)=a1·h + a2·h² + a3·h³, or (procedural upper lake, A7) a table ----------
   `r.tab` = volume in m³ at the integer levels 0..N above the bed, calibrated against the drawn terrain when the site is made (construction.js:calibrateLake).
   Between the nodes V is a cubic Hermite curve whose node slopes (the lake areas) are central differences, clamped so V stays monotone; above level N the area is held. */
function tabArea(t,k){const n=t.length-1;let a;
  if(k<=0)a=(-3*t[0]+4*t[1]-t[2])/2;else if(k>=n)a=(3*t[n]-4*t[n-1]+t[n-2])/2;else a=(t[k+1]-t[k-1])/2;
  const dl=k>0?t[k]-t[k-1]:Infinity,dr=k<n?t[k+1]-t[k]:Infinity;const cap=3*Math.min(dl,dr);return Math.max(0.05*Math.min(dl,dr),Math.min(a,cap));}
function tabVol(t,h){if(h<=0)return 0;const n=t.length-1;if(h>=n)return t[n]+tabArea(t,n)*(h-n);
  const k=Math.floor(h),u=h-k,u2=u*u,u3=u2*u;return (2*u3-3*u2+1)*t[k]+(u3-2*u2+u)*tabArea(t,k)+(3*u2-2*u3)*t[k+1]+(u3-u2)*tabArea(t,k+1);}
function tabAreaAt(t,h){const n=t.length-1;if(h<=0)h=0;if(h>=n)return tabArea(t,n);
  const k=Math.floor(h),u=h-k,u2=u*u;return (6*u2-6*u)*t[k]+(3*u2-4*u+1)*tabArea(t,k)+(6*u-6*u2)*t[k+1]+(3*u2-2*u)*tabArea(t,k+1);}
function tabLevel(t,V){const n=t.length-1;if(V<=0)return 0;if(V>=t[n])return n+(V-t[n])/tabArea(t,n);
  let lo=0,hi=n;while(hi-lo>1){const m=(lo+hi)>>1;if(t[m]<=V)lo=m;else hi=m;}
  let a=lo,b=lo+1,h=lo+(V-t[lo])/(t[lo+1]-t[lo]);
  for(let i=0;i<60;i++){const f=tabVol(t,h)-V;if(f>0)b=h;else a=h;if(Math.abs(f)<=1e-9*Math.max(1,V))break;
    const d=tabAreaAt(t,h);let nh=d>1e-9?h-f/d:(a+b)/2;if(!(nh>a&&nh<b))nh=(a+b)/2;if(Math.abs(nh-h)<1e-13)break;h=nh;}
  return h;}
function resVol(r,h){if(r.tab)return tabVol(r.tab,h);return r.a1*h+r.a2*h*h+r.a3*h*h*h;}
function resArea(r,h){if(r.tab)return tabAreaAt(r.tab,h);return r.a1+2*r.a2*h+3*r.a3*h*h;}
function resLevel(r,V){if(V<=0)return 0;if(r.tab)return tabLevel(r.tab,V);if(r.a3===0){if(r.a2===0)return V/r.a1;return (-r.a1+Math.sqrt(r.a1*r.a1+4*r.a2*V))/(2*r.a2);}
  let h=Math.min(Math.sqrt(V/Math.max(r.a2,1e-9)),Math.pow(V/r.a3,1/3));for(let i=0;i<40;i++){h=Math.max(0,h-(resVol(r,h)-V)/Math.max(1e-6,resArea(r,h)));}return h;}
function crackDerate(s){const c=s.dam.crack;return c?CONFIG.dam.crackDerate*(0.25+0.75*clamp(c.damage/100,0,1)):0;} // A13c: a cracked wall holds less (max level -20% at full damage) until repaired
function capU(s){return s.dam.built?resVol(s.upper,Math.max(0,s.dam.height-CONFIG.res.freeboard)*(1-crackDerate(s))):0;}
function capL(s){return resVol(s.lower,s.lower.hMax);}

function bowlR(r,h){return Math.sqrt(resArea(r,h)/PI);}

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
  if(s.kind==='proc'){const P=CONFIG.proc,hl=resLevel(s.lower,s.lower.V);if(hl>P.lowerWeirH){const wv=Math.min(P.lowerWeirK*Math.pow(hl-P.lowerWeirH,1.5)*dt,s.lower.V-resVol(s.lower,P.lowerWeirH));if(wv>0){s.lower.V-=wv;spL+=wv;}}} // A6: the river leaves the lower lake over an outlet weir, so the lake settles a little above its crest instead of brimming
  s.riverIn=qIn;s.spillU=spU/dt;s.spillL=spL/dt;s.envDel=envDel/dt;s.riverOut=(envDel+spL)/dt;s.acc.envUnmet+=unmet;
  if(spU>0&&cl.storm&&cl.rain>0&&s.dam.height>CONFIG.dam.crackThresh*CONFIG.dam.classes[s.dam.cls].max)s.dam.stormSpill=true;
  lg.riverIn+=inU;lg.rainU+=rainU;lg.rainL+=rainL;lg.evapU+=evU;lg.evapL+=evL;lg.spillU+=spU;lg.spillL+=spL;lg.env+=envDel;lg.runoffU+=roU;lg.runoffL+=roL+passL;
  s.tel.hU=resLevel(s.upper,s.upper.V);s.tel.hL=resLevel(s.lower,s.lower.V);s.tel.evap=(evU+evL)/dt;
}

export {bowlR, capL, capU, crackDerate, loPct, resArea, resLevel, resVol, stepReservoirs, upPct};
