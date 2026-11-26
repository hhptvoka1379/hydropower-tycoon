/* God mode: forecast-driven dynamic-programming planner, heuristic dispatch and automated upkeep. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {tileRC} from './construction.js';
import {climateAt, irradiance, sunAt} from './climate.js';
import {hu} from './rng.js';
import {capL, capU, resArea, resLevel, resVol, upPct} from './reservoirs.js';
import {cavitation, genPower, grossHead, pumpPower, solveQ} from './hydraulics.js';
import {cleanCost, penstockCost, quote} from './economy.js';
import {firmActive} from './rules.js';
import {applyAction} from './actions.js';

/* ---------- god mode §10: forecast-driven exact planner ---------- */
/* The 24 h market.forecast is priceAt() at the settled hours (the same function the sim settles with), so it is exact
   except for a grid emergency that is not yet scheduled (a new one is drawn at each midnight, p = 0.1/day). The planner is a
   finite-horizon dynamic program over the discretised upper-lake volume (linear interpolation between nodes, continuous
   refinement of the executed flow) for the hydro unit, plus a second DP over state of charge for every battery, coordinated by
   two alternating sweeps. A shadow price of stored water (terminal value) is bisected so the plan returns to its starting
   volume (periodic steady state), which stops it dumping the lake at hour 24. */
const GODP={nodes:48,genX:[0.15,0.3,0.45,0.6,0.75,0.9,1.0,1.1],pumpX:[0.5,0.65,0.8,0.95,1.1],iters:9,bNodes:25,bFrac:[-1,-0.75,-0.5,-0.25,0,0.25,0.5,0.75,1]};
let revN=0; // side output of the hourly revenue function: planned total net MW after optimal curtailment
function renForecastMW(st,s,cl,hour,onlyTile){ // mean renewable output over an hour (MW) from the climate model; 3 sub-samples of the sun path
  const S=CONFIG.solar,W=CONFIG.wind;let tot=0;
  for(let i=0;i<48;i++){const t=s.tiles[i];if(onlyTile>=0&&i!==onlyTile)continue;if((!t.solar||t.solar.building)&&(!t.wind||t.wind.building))continue;const rc=tileRC(i);
    if(t.solar&&!t.solar.building){const tier=S.tiers[t.solar.tier];let sh=1;if(t.wind)sh*=S.shadeSame;if(rc.r<3){const n=s.tiles[i+4];if(n&&n.wind)sh*=S.shadeNorth;}
      let acc=0;for(let j=0;j<3;j++){const G=irradiance(cl,sunAt(cl.doy,hour+(2*j+1)/6));const Tc=cl.T+(S.noct-20)/800*G;acc+=tier.kWp*1000*(G/1000)*Math.max(0,1+S.gamma*(Tc-25))*sh;}
      tot+=acc/3*(onlyTile>=0?1:(1-t.solar.soil)*(1-s.curtailSolar));}
    if(onlyTile<0&&t.wind&&!t.wind.building&&!t.wind.damaged){const tier=W.tiers[t.wind.tier];let up=0;for(let c=0;c<rc.c;c++){const o=s.tiles[rc.p*16+rc.r*4+c];if(o.wind)up++;}
      const v=cl.wind*(0.9+0.25*hu(s.seed,5,1))*Math.pow(tier.hub/10,W.shear)*Math.pow(W.wake,up);let p=0;
      if(v>=W.cutIn&&v<W.cutOut)p=v>=W.rated?tier.kW*1000:tier.kW*1000*(v*v*v-W.cutIn*W.cutIn*W.cutIn)/(W.rated*W.rated*W.rated-W.cutIn*W.cutIn*W.cutIn);
      tot+=p*(1-t.wind.curtail);}}
  return tot/1e6;}
function godCtx(st,s){ // per-hour planning inputs for a site: forecast price, contracts, curtailment permission, renewable forecast
  const ctx={price:st.market.forecast.slice(0,24),hr:[],day:[],curt:[],con:[],R:[],fr:Math.max(0.02,(3600-st.secInHour)/3600),natIn:0};
  let d=st.day,hh=st.hour,nat=0;
  const aU=s.dam.built?resArea(s.upper,resLevel(s.upper,s.upper.V)):0,catchU=s.kind==='classic'?CONFIG.classic.catchU:CONFIG.proc.catchLocal*0.4,RS=CONFIG.res;
  for(let k=0;k<24;k++){const cl=climateAt(st.seed,st.H+k);
    if(aU>0){const melting=cl.T>=CONFIG.snow.tSnow,rainMS=melting?cl.rain/1000/3600:0,ev=s.ice>0.5?0:RS.evapK*Math.max(0,cl.T)*(1+0.5*cl.heat)*(1-0.6*cl.cloud)/1000/86400;nat+=rainMS*aU+rainMS*RS.runoffK*catchU-ev*aU;} // exact rain, runoff and evaporation of the forecast climate
    ctx.hr.push(hh);ctx.day.push(d);ctx.R.push(renForecastMW(st,s,cl,hh,-1));
    const cs=[];for(const c of st.contracts.active)if(d<c.end&&hh>=c.h0&&hh<c.h1)cs.push(c);ctx.con.push(cs);ctx.curt.push(st.god.curtailNeg&&cs.length===0);
    hh++;if(hh>=24){hh=0;d++;}}
  ctx.natIn=nat/24+(s.dam.built?Math.max(0,s.riverIn||0):0);
  return ctx;}
function godRevFn(ctx,R){ // hourly settlement value of a total net export T0 (MW) plus curtailable renewables R[k]: price impact, curtailment optimum, contracts
  const imp=CONFIG.market.impact;
  return function(k,T0){const p=ctx.price[k];const r=R[k];let n=T0+r;
    if(r>0&&ctx.curt[k]){const ns=p/(2*imp);n=ns<T0?T0:(ns>n?n:ns);} // argmax of n(p-imp·n) clipped to what curtailment can reach
    let v=n*(p-imp*n);const cs=ctx.con[k];
    if(cs.length){const dd=n>0?n:0;for(const c of cs)v+=(dd<c.mw?dd:c.mw)*c.premium-(dd<c.mw?c.mw-dd:0)*c.penalty;}
    revN=n;return v;};}
function godSolveLam(fun,target,lamMax,hint,tol,maxIt){ // monotone root find (Illinois regula falsi) for the shadow price whose plan ends at the target state; warm-started by the previous hour's price
  let a=0,b=lamMax,fa,fb;
  if(hint>0&&hint<lamMax){const fh=fun(hint);if(Math.abs(fh-target)<=tol)return hint;
    if(fh<target){a=hint;fa=fh;b=Math.min(lamMax,hint*1.5);fb=fun(b);while(fb<target&&b<lamMax){a=b;fa=fb;b=Math.min(lamMax,b*1.5);fb=fun(b);}if(fb<target)return lamMax;}
    else{b=hint;fb=fh;a=hint/1.5;fa=fun(a);while(fa>=target&&a>lamMax*1e-6){b=a;fb=fa;a=a/1.5;fa=fun(a);}if(fa>=target){fa=fun(0);if(fa>=target)return 0;a=0;}}}
  else{fa=fun(0);if(fa>=target)return 0;fb=fun(lamMax);if(fb<target)return lamMax;}
  let x=fa-target,y=fb-target,side=0,c=b;
  for(let it=0;it<maxIt;it++){c=(a*y-b*x)/(y-x);const fc=fun(c)-target;if(Math.abs(fc)<=tol)break;
    if(fc<0){a=c;x=fc;if(side===-1)y/=2;side=-1;}else{b=c;y=fc;if(side===1)x/=2;side=1;}}
  return c;}
function lerpJ(J,x,N){if(x<=0)return J[0];if(x>=N-1)return J[N-1];const j=x|0;const w=x-j;return J[j]*(1-w)+J[j+1]*w;}
function hydroPlan(st,s,ctx,Xo,R,rev,hint){ // DP over upper-lake volume for the pump/turbine unit; null when there is no dam
  if(!s.dam.built)return null;
  const C=CONFIG,E=C.eff,K=24,N=GODP.nodes;const Tb=C.turbine[s.turbine.tier],Pm=C.pump[s.pump.tier];
  const canG=!s.turbine.busy&&!s.penstock.busy&&s.turbine.health>0,canP=!s.pump.busy&&!s.penstock.busy&&s.pump.health>0;
  const Vu0=s.upper.V,Vtot=Vu0+s.lower.V,ub=s.upper.bottom,lb=s.lower.bottom,qin=ctx.natIn,rr=C.ramp.rate;
  const offer=s.reserveOffer>0?s.reserveOffer:0,Hg0=grossHead(s);
  const kRes=C.god.reserveMult*C.reserve.callP*C.reserve.fine*C.reserve.callDur/3600; // $ per MW of undeliverable offer per hour: reserveMult × the expected under-delivery fine (call probability × fine × call length); 25 keeps every call deliverable
  let lo=resVol(s.upper,C.res.minOpU)+50,hi=Math.min(capU(s),Vtot-resVol(s.lower,C.res.minOpL));lo=Math.max(lo,Vtot-capL(s));
  let qNeed=0;if(offer>0){qNeed=solveQ(genPower,s,Hg0,offer*1e6,Tb.Qr*E.xMaxT);lo+=qNeed*C.reserve.callDur*1.1;} // keep enough water to answer a reserve call
  lo=Math.min(lo,Vu0);hi=Math.max(hi,Vu0);if(hi-lo<1)hi=lo+1;
  const dV=(hi-lo)/(N-1);
  const Hgf=Vm=>(ub+resLevel(s.upper,Vm))-(lb+resLevel(s.lower,Math.max(0,Vtot-Vm)));
  const pc=penstockCost(s,s.penstock.D,s.penstock.mat);
  const kT=C.wear.turbinePerHour*Tb.cost*C.jobs.repairFrac/45/Tb.Qr,kP=C.wear.pumpPerHour*Pm.cost*C.jobs.repairFrac/45/Pm.Qr,kS=C.penstock.wearPerHour*pc/55/4; // $ per m³/s·h of wear, valued at the repair/replace cost per health point
  const A=[0];if(canG)for(const x of GODP.genX)A.push(Tb.Qr*x);if(canP)for(const x of GODP.pumpX)A.push(-Pm.Qr*x);const nA=A.length;
  const sc={Vend:0,P:0,W:0};
  const ev=(V,qs,dd)=>{ // exact one-step physics at volume V: end volume, mean power (MW, + export), wear/penalty $ per hour
    const Vend=V-qs*dd+qin*dd;sc.Vend=Vend;sc.P=0;sc.W=0;
    if(qs===0){if(offer>0){const c0=genPower(s,Math.min(Tb.Qr*E.xMaxT,rr*C.reserve[RESERVE_WINDOW_KEY]),Hgf(V)).P/1e6;if(c0<offer)sc.W+=kRes*(offer-c0);}return true;}
    const Hg=Hgf((V+Vend)/2);
    if(qs>0){const r=genPower(s,qs,Hg);if(!(r.Hn>0)||!(r.P>0))return false;const cav=cavitation(s,qs,r.Hn,r.P,1);sc.P=r.P/1e6;sc.W=kT*qs*(cav.cavT<1?C.wear.cavMult:1)+kS*r.h.v;
      if(offer>0){const q1=Math.min(Tb.Qr*E.xMaxT,qs+rr*C.reserve[RESERVE_WINDOW_KEY]);const c0=(genPower(s,q1,Hg).P-r.P)/1e6;if(c0<offer)sc.W+=kRes*(offer-c0);}return true;}
    const q=-qs;const r=pumpPower(s,q,Hg);const cav=cavitation(s,q,Hg+r.h.hf,r.P,-1);sc.P=-r.P/1e6;sc.W=kP*q*(cav.cavP<1?C.wear.cavMult:1)+kS*r.h.v;
    if(offer>0){const t=(q+qNeed)/rr;if(t>110)sc.W+=kRes*offer*(1-110/t);}return true;};
  const posT=new Float64Array(N*nA),PT=new Float64Array(N*nA),WT=new Float64Array(N*nA),okT=new Uint8Array(N*nA),jT=new Int32Array(N*nA),wT=new Float64Array(N*nA);
  for(let i=0;i<N;i++){const V=lo+i*dV;for(let a=0;a<nA;a++){const ix=i*nA+a;if(!ev(V,A[a],3600))continue;let Ve=sc.Vend;if(A[a]>=0&&Ve>hi)Ve=hi;if(A[a]===0&&Ve<lo)Ve=lo;if(Ve<lo-1e-6||Ve>hi+1e-6)continue;
    let ps=(Ve-lo)/dV;if(ps<0)ps=0;if(ps>N-1)ps=N-1;let j=ps|0;if(j>N-2)j=N-2;okT[ix]=1;PT[ix]=sc.P;WT[ix]=sc.W;jT[ix]=j;wT[ix]=ps-j;}}
  const Js=[];for(let k=0;k<=K;k++)Js.push(new Float64Array(N));
  const bw=lam=>{const JT=Js[K];for(let i=0;i<N;i++)JT[i]=lam*(i*dV);
    for(let k=K-1;k>=1;k--){const Jn=Js[k+1],Jc=Js[k];for(let i=0;i<N;i++){let best=-1e18;const b0=i*nA;for(let a=0;a<nA;a++){const ix=b0+a;if(!okT[ix])continue;const j=jT[ix];const w=wT[ix];
      const val=rev(k,Xo[k]+PT[ix])-WT[ix]+Jn[j]*(1-w)+Jn[j+1]*w;if(val>best)best=val;}Jc[i]=best;}}};
  const fr=ctx.fr,dd0=3600*fr,qc=s.q,Pb=(s.tel.pGen-s.tel.pPump)/1e6;let Pc=0;
  if(qc!==0){ev(Vu0,qc,3600);Pc=sc.P;}
  const out={q:new Float64Array(K),P:new Float64Array(K),W:new Float64Array(K),V:new Float64Array(K)};
  const stage0=(q,Jn)=>{ // exact first hour: actual volume, ramp from the present flow, remaining fraction of the hour
    if(!ev(Vu0,q,dd0))return -1e18;const tr=Math.min(dd0,Math.abs(q-qc)/rr);const Veff=q*(dd0-tr)+0.5*(q+qc)*tr;let Ve=Vu0-Veff+qin*dd0;
    if(q>=0&&Ve>hi)Ve=hi;if(q===0&&Ve<lo)Ve=lo;if(Ve<lo-1e-6||Ve>hi+1e-6)return -1e18;
    const Pavg=(sc.P*(dd0-tr)+0.5*(sc.P+Pc)*tr)/dd0*fr+Pb*(1-fr);out.q0=q;out.P0=Pavg;out.W0=sc.W*fr;out.V0=Ve;
    return rev(0,Xo[0]+Pavg)-sc.W*fr+lerpJ(Jn,(Ve-lo)/dV,N);};
  const fw=(lam,refine)=>{bw(lam);const J1=Js[1];let bestV=-1e18,bq=0;
    for(let a=0;a<nA;a++){const v=stage0(A[a],J1);if(v>bestV){bestV=v;bq=A[a];}}
    if(refine&&bq!==0){const gen=bq>0;const xs=gen?GODP.genX:GODP.pumpX,Q=gen?Tb.Qr:Pm.Qr;let x=Math.abs(bq)/Q,ix=xs.indexOf(x);if(ix<0)ix=xs.findIndex(v=>Math.abs(v-x)<1e-9);
      let xl=ix>0?xs[ix-1]:xs[0],xh=ix<xs.length-1?xs[ix+1]:xs[ix];const sg=gen?1:-1;let a=xl*Q,b=xh*Q;const gr=0.6180339887;let c=b-gr*(b-a),d=a+gr*(b-a);let fc=stage0(sg*c,J1),fd=stage0(sg*d,J1);
      for(let it=0;it<18;it++){if(fc>fd){b=d;d=c;fd=fc;c=b-gr*(b-a);fc=stage0(sg*c,J1);}else{a=c;c=d;fc=fd;d=a+gr*(b-a);fd=stage0(sg*d,J1);}}
      const qm=sg*(a+b)/2;const vm=stage0(qm,J1);if(vm>bestV){bestV=vm;bq=qm;}}
    const v0=stage0(bq,J1);out.q[0]=bq;out.P[0]=out.P0;out.W[0]=out.W0;let V=out.V0;out.V[0]=V;let tot=v0-lerpJ(J1,(V-lo)/dV,N); // tot = realised profit of the plan
    for(let k=1;k<K;k++){const Jn=Js[k+1];let bv=-1e18,bqq=0,bP=0,bW=0,bVe=V;
      for(let a=0;a<nA;a++){if(!ev(V,A[a],3600))continue;let Ve=sc.Vend;if(A[a]>=0&&Ve>hi)Ve=hi;if(A[a]===0&&Ve<lo)Ve=lo;if(Ve<lo-1e-6||Ve>hi+1e-6)continue;const val=rev(k,Xo[k]+sc.P)-sc.W+lerpJ(Jn,(Ve-lo)/dV,N);if(val>bv){bv=val;bqq=A[a];bP=sc.P;bW=sc.W;bVe=Ve;}}
      out.q[k]=bqq;out.P[k]=bP;out.W[k]=bW;V=bVe;out.V[k]=V;tot+=bv-lerpJ(Jn,(V-lo)/dV,N);}
    out.V24=V;out.profit=tot;return out;};
  let maxP=1;for(const p of ctx.price)if(p>maxP)maxP=p;
  const Vt=Math.min(lo+0.8*(hi-lo),Math.max(lo+0.2*(hi-lo),Vu0));let lam=0;
  if(hi-lo>2){const lamMax=2.5*maxP*(C.phys.rho*C.phys.g*Math.max(Hg0,5)/3.6e9)/0.6;lam=godSolveLam(l=>fw(l,false).V24,Vt,lamMax,hint,0.001*(hi-lo),GODP.iters);}
  fw(lam,true);out.lam=lam;out.lo=lo;out.hi=hi;out.Vt=Vt;out.V0=Vu0;return out;}
function batteryPlan(st,ctx,b,T0,R,rev,hint){ // DP over state of charge for one battery given everyone else's net (T0) — exact buy-cheap / sell-dear arbitrage with RTE, SOC range, fade cost
  const B=CONFIG.battery,Bt=B.tiers[b.tier],K=24,M=GODP.bNodes,F=GODP.bFrac,nF=F.length;
  const cap=Bt.MWh*(1-b.fade),Emin=B.socMin*cap,Emax=B.socMax*cap;if(Emax-Emin<1e-9)return null;
  const E0=Math.min(Emax,Math.max(Emin,b.soc*cap)),ec=Math.sqrt(B.rte),ed=ec,fr=ctx.fr,dE=(Emax-Emin)/(M-1);
  const degr=Bt.cost*0.5*B.fadePerEFC/(2*Bt.MWh); // $ per MWh of throughput (capacity lost × half the battery's book value)
  const m=new Float64Array(nF),den=new Float64Array(nF),dg=new Float64Array(nF);for(let a=0;a<nF;a++){m[a]=F[a]*Bt.MW;den[a]=m[a]<0?-m[a]*ec:-m[a]/ed;dg[a]=degr*Math.abs(m[a]);}
  const Js=[];for(let k=0;k<=K;k++)Js.push(new Float64Array(M));
  const bw=lam=>{for(let i=0;i<M;i++)Js[K][i]=lam*(i*dE);
    for(let k=K-1;k>=1;k--){const Jn=Js[k+1],Jc=Js[k];for(let i=0;i<M;i++){const E=Emin+i*dE;let best=-1e18;for(let a=0;a<nF;a++){const E1=E+den[a];if(E1<Emin-1e-9||E1>Emax+1e-9)continue;
      const v=rev(k,T0[k]+m[a])-dg[a]+lerpJ(Jn,(E1-Emin)/dE,M);if(v>best)best=v;}Jc[i]=best;}}};
  const out={m:new Float64Array(K),soc:new Float64Array(K),W:new Float64Array(K)};
  const fw=lam=>{bw(lam);let bv=-1e18,ba=-1;
    for(let a=0;a<nF;a++){const E1=E0+den[a]*fr;if(E1<Emin-1e-9||E1>Emax+1e-9)continue;const v=rev(0,T0[0]+m[a]*fr)-dg[a]*fr+lerpJ(Js[1],(E1-Emin)/dE,M);if(v>bv){bv=v;ba=a;}}
    if(ba<0)ba=F.indexOf(0);let E=E0+den[ba]*fr;out.m[0]=m[ba];out.W[0]=dg[ba]*fr;out.soc[0]=E/cap;
    for(let k=1;k<K;k++){let bk=-1,bvk=-1e18;for(let a=0;a<nF;a++){const E1=E+den[a];if(E1<Emin-1e-9||E1>Emax+1e-9)continue;const v=rev(k,T0[k]+m[a])-dg[a]+lerpJ(Js[k+1],(E1-Emin)/dE,M);if(v>bvk){bvk=v;bk=a;}}
      if(bk<0)bk=F.indexOf(0);E+=den[bk];out.m[k]=m[bk];out.W[k]=dg[bk];out.soc[k]=E/cap;}
    out.E24=E;return out;};
  let maxP=1;for(const p of ctx.price)if(p>maxP)maxP=p;const Et=E0;let lam=0;
  lam=godSolveLam(l=>fw(l).E24,Et,1.5*maxP,hint,0.01*(Emax-Emin),GODP.iters);
  fw(lam);out.lam=lam;return out;}
function planSite(st,s,ctx,O,dry){ // one site: hydro DP ↔ battery DPs, then (unless dry) execute hour 0 and publish the plan
  const K=24,R=ctx.R,rev=godRevFn(ctx,R);const Xo=new Float64Array(K);for(let k=0;k<K;k++)Xo[k]=O[k];
  const bats=[];for(let i=0;i<48;i++){const t=s.tiles[i];if(t.battery&&!t.battery.building)bats.push(i);}
  const bm=bats.map(()=>new Float64Array(K));const bp=bats.map(()=>null);
  const sumB=(skip)=>{const x=new Float64Array(K);for(let c=0;c<bm.length;c++)if(c!==skip)for(let k=0;k<K;k++)x[k]+=bm[c][k];return x;};
  const lamH=s.plan&&s.plan.lambda||0,bLamPrev=s.plan&&s.plan.bLam||{};const bLam={};
  let hy=hydroPlan(st,s,ctx,Xo,R,rev,lamH);
  if(bats.length){ // hydro → batteries (sequential) → hydro re-planned around the batteries' nets
    for(let c=0;c<bats.length;c++){const o=sumB(c),T0=new Float64Array(K);for(let k=0;k<K;k++)T0[k]=Xo[k]+(hy?hy.P[k]:0)+o[k];
      const r=batteryPlan(st,ctx,s.tiles[bats[c]].battery,T0,R,rev,bLamPrev[bats[c]]||0);bp[c]=r;if(r){bm[c].set(r.m);bLam[bats[c]]=r.lam;}}
    if(hy){const X2=new Float64Array(K),o=sumB(-1);for(let k=0;k<K;k++)X2[k]=Xo[k]+o[k];hy=hydroPlan(st,s,ctx,X2,R,rev,hy.lam);}}
  const bs=sumB(-1);const net=new Float64Array(K),prof=new Float64Array(K);let profit=0,idle=0,wear=0;
  for(let k=0;k<K;k++){const T0=Xo[k]+(hy?hy.P[k]:0)+bs[k];const v=rev(k,T0);net[k]=revN-O[k];
    let w=hy?hy.W[k]:0;for(let c=0;c<bats.length;c++)if(bp[c])w+=bp[c].W[k];wear+=w;prof[k]=v-w;profit+=v-w;idle+=rev(k,Xo[k]);}
  const res={profit,idle,net,hy,bp,bats,bm,R};
  if(dry)return res;
  // execute hour 0
  if(hy){const q=hy.q[0];s.godMode=q>0?'gen':q<0?'pump':'idle';s.godFlow=Math.abs(q);}else{s.godMode='idle';s.godFlow=0;}
  for(let c=0;c<bats.length;c++){const b=s.tiles[bats[c]].battery,Bt=CONFIG.battery.tiers[b.tier];const m0=bp[c]?bp[c].m[0]:0;
    b.mode=m0<-1e-9?'charge':m0>1e-9?'discharge':'idle';b.pf=Math.min(1,Math.abs(m0)/Bt.MW);}
  {const T0=Xo[0]+(hy?hy.P[0]:0)+bs[0];rev(0,T0);s.godCurtail=(R[0]>1e-12&&ctx.curt[0])?Math.max(0,Math.min(1,1-(revN-T0)/R[0])):0;}
  const rd=(x,n)=>Math.round(x*n)/n;const cu=capU(s);
  s.plan={H:st.H,day:st.day,hour:st.hour,frac:rd(ctx.fr,1e4),hours:ctx.hr.slice(),price:ctx.price.map(x=>rd(x,1e4)),
    act:hy?Array.from(hy.q,x=>x>0?'gen':x<0?'pump':'idle'):new Array(K).fill('idle'),q:hy?Array.from(hy.q,x=>rd(x,1e5)):new Array(K).fill(0),
    hydroMW:hy?Array.from(hy.P,x=>rd(x,1e5)):new Array(K).fill(0),upperVol:hy?Array.from(hy.V,x=>rd(x,10)):new Array(K).fill(s.upper.V),
    upperPct:hy&&cu>0?Array.from(hy.V,x=>rd(100*x/cu,1e3)):new Array(K).fill(0),battMW:Array.from(bs,x=>rd(x,1e5)),
    renMW:Array.from(R,x=>rd(x,1e5)),netMW:Array.from(net,x=>rd(x,1e5)),
    profit:rd(profit,100),idleProfit:rd(idle,100),gain:rd(profit-idle,100),wearCost:rd(wear,100),
    lambda:hy?hy.lam:0,bLam,volLo:hy?rd(hy.lo,10):0,volHi:hy?rd(hy.hi,10):0,reserveOffer:s.reserveOffer,
    contractHours:ctx.con.map(c=>c.length?Math.max.apply(null,c.map(x=>x.mw)):0)};
  return res;}
function godPlan(st){ // plan every site (sequentially so the market price impact of one site is seen by the next) and execute hour 0
  if(!st.market.forecast.length)return 0;const ctxs=st.sites.map(s=>godCtx(st,s));const net=ctxs.map(c=>Float64Array.from(c.R));let tot=0;
  for(let j=0;j<st.sites.length;j++){const O=new Float64Array(24);for(let q=0;q<st.sites.length;q++)if(q!==j)for(let k=0;k<24;k++)O[k]+=net[q][k];
    const r=planSite(st,st.sites[j],ctxs[j],O,false);net[j]=r.net;tot+=r.profit;}
  st.god.planProfit=Math.round(tot*100)/100;st.god.planH=st.H;return tot;}
function godHeuristicDispatch(st,s){ // the original loose heuristic (cheap/peak hour counts, fixed flow fraction); kept as the baseline for the self-test
  const g=st.god,m=st.market,T=CONFIG.turbine[s.turbine.tier],Pm=CONFIG.pump[s.pump.tier];
  if(m.price<=m.cheap&&upPct(s)<95){s.godMode='pump';s.godFlow=g.flowTarget*Pm.Qr;}else if(m.price>=m.peak&&upPct(s)>8){s.godMode='gen';s.godFlow=g.flowTarget*T.Qr;}else{s.godMode='idle';s.godFlow=0;}
  for(const t of s.tiles)if(t.battery){t.battery.mode='auto';t.battery.pf=1;}
  s.godCurtail=(m.price<0&&!firmActive(st))?1:0;s.plan=null;}
function godSiteProfit(st,s,mods){const s2=Object.assign({},s,mods);const ctx=godCtx(st,s2);return planSite(st,s2,ctx,new Float64Array(24),true).profit;}
function godHour(st){const g=st.god;if(!g.enabled)return;
  if(g.planner)godPlan(st);
  for(const s of st.sites){
    if(!g.planner)godHeuristicDispatch(st,s);
    const res=g.cashReserve;const act=(a)=>{a.god=true;return applyAction(st,a);};
    if(s.turbine.health<55&&!s.turbine.busy&&st.cash-CONFIG.turbine[s.turbine.tier].cost*CONFIG.jobs.repairFrac>res)act({type:'REPAIR',site:s.id,target:'turbine'});
    if(s.pump.health<55&&!s.pump.busy&&st.cash-CONFIG.pump[s.pump.tier].cost*CONFIG.jobs.repairFrac>res)act({type:'REPAIR',site:s.id,target:'pump'});
    if(s.penstock.health<45&&!s.penstock.busy&&st.cash-penstockCost(s,s.penstock.D,s.penstock.mat)>res)act({type:'REPLACE_PENSTOCK',site:s.id,D:s.penstock.D,mat:s.penstock.mat});
    if(s.dam.crack&&!s.dam.repairing&&st.cash-s.dam.value*CONFIG.dam.repairFrac>res)act({type:'REPAIR',site:s.id,target:'dam'});
    for(let i=0;i<48;i++){const so=s.tiles[i].solar;if(!so||so.building||so.soil<=0.06&&!g.planner)continue;
      if(g.planner){ // clean when the forecast value of the lost output over the typical days until rain washes the panels exceeds the cost
        if(so.soil<0.01)continue;let day=0;for(let k=0;k<24;k++){const cl=climateAt(st.seed,st.H+k);day+=renForecastMW(st,s,cl,(st.hour+k)%24,i)*st.market.forecast[k];}
        if(so.soil*day*CONFIG.god.cleanDays>cleanCost(so)&&st.cash-cleanCost(so)>res)act({type:'CLEAN_ARRAY',site:s.id,tile:i});}
      else if(st.cash-cleanCost(so)>res)act({type:'CLEAN_ARRAY',site:s.id,tile:i});}
    const canUpT=s.turbine.tier===0&&!s.turbine.busy&&st.cash-CONFIG.turbine[1].cost>res+CONFIG.god.upgradeBuffer,canUpP=s.pump.tier===0&&!s.pump.busy&&st.cash-CONFIG.pump[1].cost>res+CONFIG.god.upgradeBuffer;
    if(!g.planner){if(canUpT)act({type:'BUILD',site:s.id,kind:'turbine',tier:1});if(canUpP)act({type:'BUILD',site:s.id,kind:'pump',tier:1});}
    else if(st.hour===12&&s.dam.built&&(canUpT||canUpP)){ // tier-2 upgrade when the planner's 24 h profit gain pays the machine back within paybackDays
      const t1={turbine:{tier:1,health:100,busy:false}},p1={pump:{tier:1,health:100,busy:false}};const base=godSiteProfit(st,s,{});
      const gT=canUpT?godSiteProfit(st,s,t1)-base:0,gP=canUpP?godSiteProfit(st,s,p1)-base:0,gB=(canUpT&&canUpP)?godSiteProfit(st,s,Object.assign({},t1,p1))-base:0;
      const cT=CONFIG.turbine[1].cost,cP=CONFIG.pump[1].cost,pb=CONFIG.god.paybackDays;
      if(canUpT&&canUpP&&gB>0&&(cT+cP)<=gB*pb&&gB>Math.max(gT,gP)){act({type:'BUILD',site:s.id,kind:'turbine',tier:1});act({type:'BUILD',site:s.id,kind:'pump',tier:1});}
      else{if(canUpT&&gT>0&&cT<=gT*pb)act({type:'BUILD',site:s.id,kind:'turbine',tier:1});if(canUpP&&gP>0&&cP<=gP*pb)act({type:'BUILD',site:s.id,kind:'pump',tier:1});}}
    if(st.hour===12){let best=null;for(let i=0;i<48;i++){if(!s.parcels[tileRC(i).p])continue;for(const k of ['solar','wind']){if(s.tiles[i][k]||s.tiles[i].battery)continue;for(let tr=0;tr<3;tr++){const qq=quote(st,s.id,i,k,tr);if(qq.ok&&qq.npv>0&&st.cash-qq.cost>res*2&&(!best||qq.npv>best.npv))best={npv:qq.npv,tile:i,kind:k,tier:tr};}}}
      if(best)act({type:'BUILD',site:s.id,tile:best.tile,kind:best.kind,tier:best.tier});}
  }}

export {godCtx, godHeuristicDispatch, godHour, godPlan, godSiteProfit, renForecastMW};
