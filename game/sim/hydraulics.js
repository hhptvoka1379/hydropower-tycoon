/* Penstock hydraulics, turbine/pump power, efficiency curves, flow solving, reserve capability and cavitation. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {LN10, PI} from './rng.js';
import {resLevel} from './reservoirs.js';

/* ---------- hydraulics §2 ---------- */
function hydraulics(s,Q){ // §2.2 Darcy–Weisbach with Swamee–Jain friction factor + minor losses
  const P=CONFIG.phys,pen=s.penstock;const D=pen.D;const A=PI*D*D/4;const v=Q/A;const Re=v*D/P.nu;
  const eps=CONFIG.penstock.materials[pen.mat].eps*(1+(CONFIG.penstock.roughGrowth-1)*(1-pen.health/100));
  let f=0;if(Re>2300){const t=Math.log(eps/(3.7*D)+5.74/Math.pow(Re,0.9))/LN10;f=0.25/(t*t);}else if(Re>1)f=64/Re;
  const hv=v*v/(2*P.g);return {v,Re,f,hf:(f*pen.L/D+P.Kminor)*hv,hv};
}
function etaCurve(emax,x){const d=1-x;return Math.max(0,emax*(1-CONFIG.eff.c*d*d));} // §2.4
function healthF(h){const f=CONFIG.eff.healthFloor;return f+(1-f)*h/100;}
function grossHead(s){return (s.upper.bottom+resLevel(s.upper,s.upper.V))-(s.lower.bottom+resLevel(s.lower,s.lower.V));} // §2.1
function genPower(s,Q,Hg){const T=CONFIG.turbine[s.turbine.tier];const h=hydraulics(s,Q);const Hn=Hg-h.hf;const eta=etaCurve(T.eta,Q/T.Qr)*healthF(s.turbine.health);
  return {P:Math.max(0,CONFIG.phys.rho*CONFIG.phys.g*Q*Hn*eta),Hn,eta,h};} // §2.3 P=ρgQHnη
function pumpPower(s,Q,Hg){const Pm=CONFIG.pump[s.pump.tier];const h=hydraulics(s,Q);const H=Hg+h.hf;const eta=Math.max(0.2,etaCurve(Pm.eta,Q/Pm.Qr)*healthF(s.pump.health));
  return {P:CONFIG.phys.rho*CONFIG.phys.g*Q*H/eta,H,eta,h};} // §2.3 P=ρgQH/η
function solveQ(fn,s,Hg,Pt,qmax){let lo=0,hi=qmax;if(fn(s,hi,Hg).P<=Pt)return hi;for(let i=0;i<30;i++){const m=(lo+hi)/2;if(fn(s,m,Hg).P<Pt)lo=m;else hi=m;}return (lo+hi)/2;}
function reserveCap(s){ // §7.2 power reachable within the response time at the shared ramp rate
  if(!s.dam.built||s.turbine.busy||s.penstock.busy||s.turbine.health<=0)return 0;
  const T=CONFIG.turbine[s.turbine.tier];const Hg=grossHead(s);if(s.q<0)return pumpPower(s,-s.q,Hg).P;
  const q0=Math.max(0,s.q);const q1=Math.min(T.Qr*CONFIG.eff.xMaxT,q0+CONFIG.ramp.rate*CONFIG.reserve[RESERVE_WINDOW_KEY]);
  return Math.max(0,genPower(s,q1,Hg).P-(q0>0?genPower(s,q0,Hg).P:0));
}
function cavitation(s,Q,Hn,P,mode){ // §2.5 Thoma σ for turbine, NPSH for pump
  const C=CONFIG.cav,ph=CONFIG.phys;const hL=resLevel(s.lower,s.lower.V);const Hs=C.setT-hL;const out={sigma:0,sigmaC:0,cavT:9,npshA:0,npshR:0,cavP:9};
  if(mode>0&&Q>0){const T=CONFIG.turbine[s.turbine.tier];const ns=T.n*Math.sqrt(Math.max(P/1000,1))/Math.pow(Math.max(Hn,1),1.25);
    out.sigmaC=C.k*Math.pow(ns,C.e);out.sigma=(ph.hAtm-ph.hVap-Hs)/Math.max(Hn,1);out.cavT=out.sigma/Math.max(out.sigmaC,1e-6);}
  if(mode<0&&Q>0){const Pm=CONFIG.pump[s.pump.tier];const h=hydraulics(s,Q);out.npshA=ph.hAtm-ph.hVap-Hs-C.suctionK*h.hv;const x=Q/Pm.Qr;out.npshR=C.npshR0+C.npshR1*x*x;out.cavP=out.npshA/out.npshR;}
  return out;
}

export {cavitation, genPower, grossHead, hydraulics, pumpPower, reserveCap, solveQ};
