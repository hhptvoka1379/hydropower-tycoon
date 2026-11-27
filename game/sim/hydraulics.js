/* Penstock hydraulics, turbine/pump power, efficiency curves, flow solving, reserve capability and cavitation. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {LN10, PI} from './rng.js';
import {resLevel} from './reservoirs.js';

/* ---------- hydraulics §2 ---------- */
const RE_LAM=2000,RE_TURB=4000; // transition band of the friction factor (Reynolds number)
function hydraulics(s,Q){ // §2.2 Darcy–Weisbach with Swamee–Jain friction factor + minor losses
  const P=CONFIG.phys,pen=s.penstock;const D=pen.D;const A=PI*D*D/4;const v=Q/A;const Re=v*D/P.nu;
  const eps=CONFIG.penstock.materials[pen.mat].eps*(1+(CONFIG.penstock.roughGrowth-1)*(1-pen.health/100));
  let f=0;if(Re>1){const fl=Re<RE_TURB?64/Re:0; // laminar 64/Re, Swamee–Jain turbulent, smoothstep blend over RE_LAM..RE_TURB so f has no step at the transition
    if(Re>RE_LAM){const t=Math.log(eps/(3.7*D)+5.74/Math.pow(Re,0.9))/LN10;const ft=0.25/(t*t);if(Re>=RE_TURB)f=ft;else{const x=(Re-RE_LAM)/(RE_TURB-RE_LAM),w=x*x*(3-2*x);f=fl*(1-w)+ft*w;}}else f=64/Re;}
  const hv=v*v/(2*P.g);return {v,Re,f,hf:(f*pen.L/D+P.Kminor)*hv,hv};
}
function etaCurve(emax,x){const d=1-x;return Math.max(0,emax*(1-CONFIG.eff.c*d*d));} // §2.4
function healthF(h){const f=CONFIG.eff.healthFloor;return f+(1-f)*h/100;}
function grossHead(s){return (s.upper.bottom+resLevel(s.upper,s.upper.V))-(s.lower.bottom+resLevel(s.lower,s.lower.V));} // §2.1
function genPower(s,Q,Hg){const T=CONFIG.turbine[s.turbine.tier];const h=hydraulics(s,Q);const Hn=Hg-h.hf;const eta=etaCurve(T.eta,Q/T.Qr)*healthF(s.turbine.health);
  return {P:Math.max(0,CONFIG.phys.rho*CONFIG.phys.g*Q*Hn*eta),Hn,eta,h};} // §2.3 P=ρgQHnη
function pumpPower(s,Q,Hg){const Pm=CONFIG.pump[s.pump.tier];const h=hydraulics(s,Q);const H=Hg+h.hf;const eta=Math.max(0.2,etaCurve(Pm.eta,Q/Pm.Qr)*healthF(s.pump.health));
  return {P:CONFIG.phys.rho*CONFIG.phys.g*Q*H/eta,H,eta,h};} // §2.3 P=ρgQH/η
function solveQ(fn,s,Hg,Pt,qmax){ // flow in [0,qmax] whose power equals Pt; P(Q) is not monotone for a turbine (head loss eats the head at large Q)
  let lo=0,hi=qmax;if(fn(s,hi,Hg).P>=Pt){for(let i=0;i<30;i++){const m=(lo+hi)/2;if(fn(s,m,Hg).P<Pt)lo=m;else hi=m;}return (lo+hi)/2;} // power still rising (or already above target) at qmax: unchanged bisection
  // P(qmax) < Pt: the target is unreachable at qmax, but the curve may have peaked earlier and fallen (then qmax gives less than the maximum, even 0 W)
  const Pm=fn(s,qmax,Hg).P;if(Pm>0&&Pm>=fn(s,0.9*qmax,Hg).P)return qmax; // still rising at the top of the range (pumps, small turbines): the maximum is at qmax
  const gr=0.6180339887;let a=0,b=qmax,c=b-gr*(b-a),d=a+gr*(b-a),fc=fn(s,c,Hg).P,fd=fn(s,d,Hg).P;
  for(let i=0;i<26;i++){if(fc>=fd){b=d;d=c;fd=fc;c=b-gr*(b-a);fc=fn(s,c,Hg).P;}else{a=c;c=d;fc=fd;d=a+gr*(b-a);fd=fn(s,d,Hg).P;}} // ties (both 0 on the dead plateau) shrink to the left, where the peak is
  const qp=(a+b)/2,Pp=fn(s,qp,Hg).P;if(Pp<=Pm)return qmax;
  if(Pp<=Pt)return qp; // the target is above the maximum power: run at the maximum-power flow, not at a flow that yields less
  hi=qp;for(let i=0;i<30;i++){const m=(lo+hi)/2;if(fn(s,m,Hg).P<Pt)lo=m;else hi=m;}return (lo+hi)/2;}
function reserveCap(s){ // §7.2 power reachable within the response time at the shared ramp rate
  if(!s.dam.built||s.turbine.busy||s.penstock.busy||s.turbine.health<=0)return 0;
  const T=CONFIG.turbine[s.turbine.tier];const Hg=grossHead(s);if(s.q<0)return pumpPower(s,-s.q,Hg).P;
  const q0=Math.max(0,s.q);const q1=Math.min(T.Qr*CONFIG.eff.xMaxT,q0+CONFIG.ramp.rate*CONFIG.reserve[RESERVE_WINDOW_KEY]);
  return Math.max(0,genPower(s,q1,Hg).P-(q0>0?genPower(s,q0,Hg).P:0));
}
function cavitation(s,Q,Hn,P,mode){ // §2.5 Thoma σ for turbine, NPSH for pump
  const C=CONFIG.cav,ph=CONFIG.phys;const hL=resLevel(s.lower,s.lower.V);const Hs=C.setT-hL;const out={sigma:0,sigmaC:0,cavT:9,npshA:0,npshR:0,cavP:9};
  if(mode>0&&Q>0){const T=CONFIG.turbine[s.turbine.tier];const Hc=Math.max(Hn,1),Pr=ph.rho*ph.g*T.Qr*Hc*T.eta; // rated power at this head (rated flow, best efficiency), not the current load: sigmaC is a machine property
    const ns=T.n*Math.sqrt(Math.max(Pr/1000,1))/Math.pow(Hc,1.25);
    out.sigmaC=C.k*Math.pow(ns,C.e);out.sigma=(ph.hAtm-ph.hVap-Hs)/Math.max(Hn,1);out.cavT=out.sigma/Math.max(out.sigmaC,1e-6);}
  if(mode<0&&Q>0){const Pm=CONFIG.pump[s.pump.tier];const h=hydraulics(s,Q);out.npshA=ph.hAtm-ph.hVap-Hs-C.suctionK*h.hv;const x=Q/Pm.Qr;out.npshR=C.npshR0+C.npshR1*x*x;out.cavP=out.npshA/out.npshR;}
  return out;
}

export {cavitation, genPower, grossHead, hydraulics, pumpPower, reserveCap, solveQ};
