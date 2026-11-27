/* God mode: forecast-driven dynamic-programming planner, heuristic dispatch and automated upkeep. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG, RESERVE_WINDOW_KEY} from './config.js';
import {tileRC} from './construction.js';
import {climateAt, irradiance, sunAt} from './climate.js';
import {hu} from './rng.js';
import {capL, capU, resArea, resLevel, resVol, upPct} from './reservoirs.js';
import {cavitation, genPower, grossHead, pumpPower, solveQ} from './hydraulics.js';
import {buildCost, cleanCost, penstockCost, realCash, repairCost} from './economy.js';
import {priceAt} from './market.js';
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
const GOD_REPAIR_AT=55; // health at which automation repairs a turbine or pump; the planner values a health point of wear at the (damage-scaled) repair price at that health spread over the points lost
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
function godCtx(st,s){ // per-hour planning inputs for a site: forecast price, contracts, curtailment permission, renewable forecast, net natural inflow of both lakes
  const ctx={price:st.market.forecast.slice(0,24),hr:[],day:[],curt:[],con:[],R:[],fr:Math.max(0.02,(3600-st.secInHour)/3600),natInU:0,natInL:0};
  let d=st.day,hh=st.hour;
  const nat=natInflow(st,s);ctx.natInU=nat.u;ctx.natInL=nat.l;
  for(let k=0;k<24;k++){const cl=climateAt(st.seed,st.H+k);
    ctx.hr.push(hh);ctx.day.push(d);ctx.R.push(renForecastMW(st,s,cl,hh,-1));
    const cs=[];for(const c of st.contracts.active)if(d<c.end&&hh>=c.h0&&hh<c.h1)cs.push(c);ctx.con.push(cs);ctx.curt.push(st.god.curtailNeg&&cs.length===0);
    hh++;if(hh>=24){hh=0;d++;}}
  return ctx;}
function natInflow(st,s){ // mean natural net inflow (m³/s) over the next 24 h with the plant idle, upper lake (u) and lower lake (l) separately, mirroring reservoirs.stepReservoirs:
  // rain, valley runoff and snow melt, evaporation, the procedural river's linear store (to the upper lake behind a dam, else the lower), environmental release and spill over the lower lake's rim.
  const out={u:0,l:0};if(st.isolate)return out;
  const RS=CONFIG.res,P=CONFIG.proc,built=s.dam.built,proc=s.kind==='proc';
  const catchU=s.kind==='classic'?CONFIG.classic.catchU:P.catchLocal*0.4,catchL=s.kind==='classic'?CONFIG.classic.catchL:P.catchLocal*0.6;
  let Vu=s.upper.V,Vl=s.lower.V;const cU=capU(s),cL=capL(s);
  const aU=built?resArea(s.upper,resLevel(s.upper,Vu)):0,aL=resArea(s.lower,resLevel(s.lower,Vl));
  let store=s.riverStore||0,snow=s.snowpack||0,vsnow=s.valleySnow||0;const decay=Math.exp(-3600/P.riverK);
  let sumU=0,sumL=0,spill=0;
  for(let k=0;k<24;k++){const cl=climateAt(st.seed,st.H+k),T=cl.T,melting=T>=CONFIG.snow.tSnow,rainMM=melting?cl.rain:0,rainMS=rainMM/1000/3600;
    const ev=s.ice>0.5?0:RS.evapK*Math.max(0,T)*(1+0.5*cl.heat)*(1-0.6*cl.cloud)/1000/86400; // m/s
    if(T<CONFIG.snow.tSnow){if(proc)snow+=cl.rain;vsnow+=cl.rain;}
    let vmelt=0;if(T>0&&vsnow>0){vmelt=Math.min(vsnow,CONFIG.snow.ddf*T/24);vsnow-=vmelt;}
    const runMM=rainMM*RS.runoffK+vmelt;const roU=built?runMM/1000*catchU:0,roL=runMM/1000*catchL+(built?0:runMM/1000*catchU);
    let qOut=0; // river volume delivered this hour (m³)
    if(proc){let melt=0;if(T>0&&snow>0){melt=Math.min(snow,CONFIG.snow.ddf*T/24);snow-=melt;}
      const seaF=1+0.35*Math.sin(2*Math.PI*(cl.doy-20)/360);const f=(P.baseFlow[s.river]*seaF*3600+(rainMM*RS.runoffK+melt)/1000*P.catchArea[s.river])/3600; // m³/s into the linear store
      const S1=f*P.riverK+(store-f*P.riverK)*decay;qOut=f*3600-(S1-store);store=S1;}
    const inU=built?qOut:0,passL=built?0:qOut;
    const gU=rainMS*aU*3600+roU+inU-ev*aU*3600,gL=rainMS*aL*3600+roL+passL-ev*aL*3600-s.envQ*3600;
    sumU+=gU;Vu+=gU;let spU=0;if(built&&Vu>cU){spU=Vu-cU;Vu=cU;}
    Vl+=gL+spU;if(Vl>cL){spill+=Vl-cL;Vl=cL;}else if(Vl<0)Vl=0; // the lake's own rim spills; what spills over the upper dam is internal
    if(proc){const hl=resLevel(s.lower,Vl);if(hl>P.lowerWeirH){const wv=Math.min(P.lowerWeirK*Math.pow(hl-P.lowerWeirH,1.5)*3600,Vl-resVol(s.lower,P.lowerWeirH));if(wv>0){Vl-=wv;spill+=wv;}}} // outlet weir of the river (A6)
    sumL+=gL;}
  out.u=sumU/86400;out.l=(sumL-spill)/86400;return out;}
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
  const Vu0=s.upper.V,Vtot0=Vu0+s.lower.V,ub=s.upper.bottom,lb=s.lower.bottom,qinU=ctx.natInU,qinL=ctx.natInL,rr=C.ramp.rate;
  const Vtot=Vtot0+(qinU+qinL)*43200; // total water at the middle of the horizon: the lower lake holds Vtot minus the upper volume (its own inflow, env release and spill are in natInL)
  const offer=s.reserveOffer>0?s.reserveOffer:0,Hg0=grossHead(s);
  const kRes=C.god.reserveMult*C.reserve.callP*C.reserve.fine*C.reserve.callDur/3600; // $ per MW of undeliverable offer per hour: reserveMult × the expected under-delivery fine (call probability × fine × call length); 25 keeps every call deliverable
  let lo=resVol(s.upper,C.res.minOpU)+50,hi=Math.min(capU(s),Vtot-resVol(s.lower,C.res.minOpL));lo=Math.max(lo,Vtot-capL(s));
  let qNeed=0;if(offer>0){qNeed=solveQ(genPower,s,Hg0,offer*1e6,Tb.Qr*E.xMaxT);lo+=qNeed*C.reserve.callDur*1.1;} // keep enough water to answer a reserve call
  lo=Math.min(lo,Vu0);hi=Math.max(hi,Vu0);if(hi-lo<1)hi=lo+1;
  const dV=(hi-lo)/(N-1);
  let vOff=0;const Hgf=Vm=>(ub+resLevel(s.upper,Vm))-(lb+resLevel(s.lower,Math.max(0,Vtot+vOff-Vm))); // vOff: hour 0 uses the real lower volume, the tables the mid-horizon one
  const pc=penstockCost(s,s.penstock.D,s.penstock.mat);
  const kT=C.wear.turbinePerHour*repairCost('turbine',s.turbine.tier,GOD_REPAIR_AT)/(100-GOD_REPAIR_AT)/Tb.Qr,kP=C.wear.pumpPerHour*repairCost('pump',s.pump.tier,GOD_REPAIR_AT)/(100-GOD_REPAIR_AT)/Pm.Qr,kS=C.penstock.wearPerHour*pc/55/4; // $ per m³/s·h of wear, valued at the repair/replace cost per health point
  const A=[0];if(canG)for(const x of GODP.genX)A.push(Tb.Qr*x);if(canP)for(const x of GODP.pumpX)A.push(-Pm.Qr*x);const nA=A.length;
  const sc={Vend:0,P:0,W:0};
  const ev=(V,qs,dd)=>{ // exact one-step physics at volume V: end volume, mean power (MW, + export), wear/penalty $ per hour
    const Vend=V-qs*dd+qinU*dd;sc.Vend=Vend;sc.P=0;sc.W=0;
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
  if(qc!==0){vOff=-(qinU+qinL)*43200;ev(Vu0,qc,3600);vOff=0;Pc=sc.P;}
  const out={q:new Float64Array(K),P:new Float64Array(K),W:new Float64Array(K),V:new Float64Array(K)};
  const stage0=(q,Jn)=>{ // exact first hour: actual volume, ramp from the present flow, remaining fraction of the hour
    vOff=-(qinU+qinL)*43200;const okv=ev(Vu0,q,dd0);vOff=0;if(!okv)return -1e18;const tr=Math.min(dd0,Math.abs(q-qc)/rr);const Veff=q*(dd0-tr)+0.5*(q+qc)*tr;let Ve=Vu0-Veff+qinU*dd0;
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
function godSiteProfit(st,s,mods,ctx0){const s2=Object.assign({},s,mods);const ctx=ctx0||godCtx(st,s2);return planSite(st,s2,ctx,new Float64Array(24),true).profit;}
/* Value of a tier-2 turbine / pump to the planner: the mean planned profit gain per day over a seasonal sample (the same sample days the NPV quotes use: SAMPLE_DAYS of the QDAYS-day grid,
   one per season), not today's plan times 720. Prices and renewables come from the climate model of each sample day, the lakes and inflows from now. Memoised per equipment signature. */
const SAMPLE_DAYS=[0,6,12,18],gainCache=new Map();
function seasonCtx(st,base,m){const H0=(m*QDAYS+QOFF)*24;const c=Object.assign({},base,{price:[],hr:[],day:[],curt:[],con:[],R:[],fr:1});
  for(let k=0;k<24;k++){const cl=climateAt(st.seed,H0+k);c.price.push(priceAt(st.seed,H0+k,cl,false));c.hr.push(cl.hour);c.day.push(0);c.curt.push(!!st.god.curtailNeg);c.con.push([]);c.R.push(0);}
  return c;}
function seasonGains(st,s,variants){const tot=variants.map(()=>0),base0=godCtx(st,s);
  for(const m of SAMPLE_DAYS){const c=seasonCtx(st,base0,m);for(let k=0;k<24;k++)c.R[k]=renForecastMW(st,s,climateAt(st.seed,(m*QDAYS+QOFF)*24+k),k,-1);
    const b=godSiteProfit(st,s,{},c);for(let i=0;i<variants.length;i++)tot[i]+=godSiteProfit(st,s,variants[i],c)-b;}
  return tot.map(x=>x/SAMPLE_DAYS.length);}
function upgradeGains(st,s,needT,needP){let tiles='';for(const t of s.tiles)tiles+=(t.solar?'s'+t.solar.tier:'-')+(t.wind?'w'+t.wind.tier:'-')+(t.battery?'b'+t.battery.tier:'-');
  const key=[st.seed,s.id,s.dam.height,s.turbine.tier,s.pump.tier,s.penstock.D,s.penstock.mat,s.reserveOffer,tiles].join('|');let e=gainCache.get(key);if(!e){if(gainCache.size>200)gainCache.clear();e={};gainCache.set(key,e);}
  const t1={turbine:{tier:1,health:100,busy:false}},p1={pump:{tier:1,health:100,busy:false}};
  const want=[];if(needT&&e.T===undefined)want.push(['T',t1]);if(needP&&e.P===undefined)want.push(['P',p1]);if(needT&&needP&&e.B===undefined)want.push(['B',Object.assign({},t1,p1)]);
  if(want.length){const g=seasonGains(st,s,want.map(x=>x[1]));want.forEach((x,i)=>{e[x[0]]=g[i];});}
  return {T:needT?e.T:0,P:needP?e.P:0,B:(needT&&needP)?e.B:0};}
/* ---------- 20-year NPV quotes (§6.5), annualised over a deterministic seasonal sample ---------- */
/* One representative day every QDAYS days of the climate year (the same sample hours whatever day it is asked and whichever year the game is in),
   priced with the spot-price model, replaces the old "next 24 h forecast x 360" extrapolation, so a quote does not swing with today's weather and
   does not need the forecast at all. Climate and price per sample hour are tabulated once per seed; a quote is then a pass over the table, cached per asset and site signature. */
const QDAYS=15,QOFF=7,QN=360/QDAYS*24; // sample days per year x 24 h
const qTabs=new Map(),qCache=new Map();
function quoteTable(seed){ // per sample hour: price, solar output per kWp-equivalent (W per kWp), hub-height-10 m wind speed
  let t=qTabs.get(seed);if(t)return t;
  const S=CONFIG.solar;t={price:new Float64Array(QN),sol:new Float64Array(QN),wind:new Float64Array(QN)};
  for(let m=0;m<QN/24;m++)for(let h=0;h<24;h++){const i=m*24+h,H=((m*QDAYS+QOFF)*24)+h,cl=climateAt(seed,H);
    const G=irradiance(cl,sunAt(cl.doy,cl.hour+0.5));t.price[i]=priceAt(seed,H,cl,false);t.sol[i]=G*Math.max(0,1+S.gamma*(cl.T+(S.noct-20)/800*G-25));t.wind[i]=cl.wind;}
  if(qTabs.size>16)qTabs.clear();qTabs.set(seed,t);return t;}
function batteryDay(prices,B,usable,rte){ // $/day of the best arbitrage under the MWh, MW, RTE and cycles limits: i-th cheapest hour pairs with i-th dearest, while it pays
  const a=prices.slice().sort((x,y)=>x-y),n=a.length;let left=usable*CONFIG.god.quoteCycles,v=0,mwh=0;
  for(let i=0;i<n/2&&left>1e-9;i++){const pb=a[i],ps=a[n-1-i];if(!(ps-pb/rte>0))break;const e=Math.min(left,B.MW*rte);v+=e*(ps-pb/rte);mwh+=e;left-=e;}
  return {v,mwh};}
function quoteSig(st,s,tile,kind,tier){ // everything the quote reads from the site besides the tier tables
  const rc=tileRC(tile),row=rc.p*16+rc.r*4;let g=st.seed+'|'+s.seed+'|'+kind+tier+'|'+tile;
  if(kind==='solar'){const t=s.tiles[tile],n=rc.r<3?s.tiles[tile+4]:null;g+='|'+(t.wind?1:0)+(n&&n.wind?1:0);}
  else if(kind==='wind'){for(let c=0;c<4;c++){const o=s.tiles[row+c].wind;g+=','+(o?o.tier:'-');}const sl=s.tiles[tile].solar,sn=rc.r>0?s.tiles[tile-4].solar:null;g+='|'+(sl?sl.tier:'-')+(sn?sn.tier:'-');}
  return g;}
function quote(st,si,tile,kind,tier){ // §6.5 20-year NPV, annualised over the seasonal sample; does not mutate state
  const s=st.sites[si];if(!s)return {ok:false,reason:'No such site'};const t=s.tiles[tile];if(!t)return {ok:false,reason:'No such tile'};
  const rc=tileRC(tile);if(!s.parcels[rc.p])return {ok:false,reason:'Parcel not owned'};
  if(kind==='battery'?(t.battery||t.wind):(t[kind]||t.battery))return {ok:false,reason:'Tile slot occupied'};
  const bc=buildCost(st,si,tile,kind,tier);const key=quoteSig(st,s,tile,kind,tier);let q=qCache.get(key);
  if(!q){q=quoteCompute(st,s,tile,kind,tier,rc,t);if(qCache.size>2000)qCache.clear();qCache.set(key,q);}
  const r=CONFIG.fin.discount,n=CONFIG.fin.years;const af=(1-Math.pow(1+r,-n))/r;
  const pv=kind==='battery'?q.pv:q.annual*af;
  return {ok:true,cost:bc.cost,equip:bc.equip,land:bc.land,discount:bc.discount,coloc:bc.coloc,dayMWh:q.dayMWh,dayRev:q.dayRev,annual:q.annual,npv:-bc.cost+pv,payback:q.annual>0?bc.cost/q.annual:Infinity,omYr:q.om};}
function quoteCompute(st,s,tile,kind,tier,rc,t){
  const S=CONFIG.solar,W=CONFIG.wind,tb=quoteTable(st.seed),D=CONFIG.time.daysPerYear,days=QN/24;
  let rev=0,loss=0,energy=0;
  if(kind==='solar'){const tr=S.tiers[tier];let sh=1;if(t.wind)sh*=S.shadeSame;if(rc.r<3&&s.tiles[tile+4].wind)sh*=S.shadeNorth;
    for(let i=0;i<QN;i++){const p=tr.kWp*tb.sol[i]*sh/1e6;energy+=p;rev+=p*tb.price[i];}}
  else if(kind==='wind'){const tr=W.tiers[tier];let up=0;for(let c=0;c<rc.c;c++)if(s.tiles[rc.p*16+rc.r*4+c].wind)up++;
    const pw=v=>(v>=W.cutIn&&v<W.cutOut)?(v>=W.rated?1:(v*v*v-W.cutIn*W.cutIn*W.cutIn)/(W.rated*W.rated*W.rated-W.cutIn*W.cutIn*W.cutIn)):0;
    const mul=0.9+0.25*hu(s.seed,5,1),hubF=Math.pow(tr.hub/10,W.shear),wk=Math.pow(W.wake,up);
    const dn=[];for(let c=rc.c+1;c<4;c++){const o=s.tiles[rc.p*16+rc.r*4+c].wind;if(o){let u2=0;for(let cc=0;cc<c;cc++)if(s.tiles[rc.p*16+rc.r*4+cc].wind)u2++;dn.push({kW:W.tiers[o.tier].kW,hub:Math.pow(W.tiers[o.tier].hub/10,W.shear),u2});}}
    const sl=t.solar?S.tiers[t.solar.tier].kWp*(1-S.shadeSame):0,sn=rc.r>0&&s.tiles[tile-4].solar?S.tiers[s.tiles[tile-4].solar.tier].kWp*(1-S.shadeNorth):0; // output the new turbine takes away from solar on its own tile and from the tile to its north
    for(let i=0;i<QN;i++){const w=tb.wind[i]*mul,p=tr.kW*1000*pw(w*hubF*wk)/1e6;energy+=p;rev+=p*tb.price[i];let lo=0;
      for(const o of dn){const v1=w*o.hub;lo+=o.kW*1000*(pw(v1*Math.pow(W.wake,o.u2))-pw(v1*Math.pow(W.wake,o.u2+1)))/1e6;}
      loss+=(lo+(sl+sn)*tb.sol[i]/1e6)*tb.price[i];}} // shade loss on the neighbouring solar arrays is deducted at the same price
  const B=CONFIG.battery,Bt=B.tiers[tier],r=CONFIG.fin.discount,n=CONFIG.fin.years;
  if(kind==='battery'){ // arbitrage per sample day, capacity fading with throughput (full-cycle fade per year, floor fadeMax)
    const usable=(B.socMax-B.socMin)*Bt.MWh;let v=0,e=0;
    for(let m=0;m<days;m++){const d=batteryDay(tb.price.subarray(m*24,m*24+24),Bt,usable,B.rte);v+=d.v;e+=d.mwh;}
    v/=days;e/=days;const perYear=B.fadePerEFC*e*(1+1/B.rte)/(2*Bt.MWh)*D; // fade += fadePerEFC x throughput/(2 MWh); a day's throughput is e/rte in plus e out
    const om=Bt.om*CONFIG.time.hoursPerYear;let pv=0;
    for(let y=1;y<=n;y++){const fade=Math.min(B.fadeMax,perYear*(y-0.5));pv+=(v*(1-fade)*D-om)/Math.pow(1+r,y);}
    return {dayMWh:e,dayRev:v,annual:v*D-om,om,pv};}
  const om=kind==='solar'?S.tiers[tier].kWp*S.omKWyr:W.tiers[tier].kW*W.omKWyr;
  const dayRev=(rev-loss)/days;return {dayMWh:energy/days,dayRev,annual:dayRev*D-om,om,pv:0};}
function godHour(st){const g=st.god;if(!g.enabled)return;
  if(g.planner)godPlan(st);
  for(const s of st.sites){
    if(!g.planner)godHeuristicDispatch(st,s);
    const res=g.cashReserve;const cash=realCash(st);/* automation spends only cash it earned, never the assisted-mode top-up (A1) */const act=(a)=>{a.god=true;return applyAction(st,a);};
    if(s.turbine.health<GOD_REPAIR_AT&&!s.turbine.busy&&cash-repairCost('turbine',s.turbine.tier,s.turbine.health)>res)act({type:'REPAIR',site:s.id,target:'turbine'});
    if(s.pump.health<GOD_REPAIR_AT&&!s.pump.busy&&cash-repairCost('pump',s.pump.tier,s.pump.health)>res)act({type:'REPAIR',site:s.id,target:'pump'});
    if(s.penstock.health<45&&!s.penstock.busy&&cash-penstockCost(s,s.penstock.D,s.penstock.mat)>res)act({type:'REPLACE_PENSTOCK',site:s.id,D:s.penstock.D,mat:s.penstock.mat});
    if(s.dam.crack&&!s.dam.repairing&&cash-s.dam.value*CONFIG.dam.repairFrac>res)act({type:'REPAIR',site:s.id,target:'dam'});
    for(let i=0;i<48;i++){const so=s.tiles[i].solar;if(!so||so.building||so.soil<=0.06&&!g.planner)continue;
      if(g.planner){ // clean when the forecast value of the lost output over the typical days until rain washes the panels exceeds the cost
        if(so.soil<0.01)continue;let day=0;for(let k=0;k<24;k++){const cl=climateAt(st.seed,st.H+k);day+=renForecastMW(st,s,cl,(st.hour+k)%24,i)*st.market.forecast[k];}
        if(so.soil*day*CONFIG.god.cleanDays>cleanCost(so)&&cash-cleanCost(so)>res)act({type:'CLEAN_ARRAY',site:s.id,tile:i});}
      else if(cash-cleanCost(so)>res)act({type:'CLEAN_ARRAY',site:s.id,tile:i});}
    const canUpT=s.turbine.tier===0&&!s.turbine.busy&&cash-CONFIG.turbine[1].cost>res+CONFIG.god.upgradeBuffer,canUpP=s.pump.tier===0&&!s.pump.busy&&cash-CONFIG.pump[1].cost>res+CONFIG.god.upgradeBuffer;
    if(!g.planner){if(canUpT)act({type:'BUILD',site:s.id,kind:'turbine',tier:1});if(canUpP)act({type:'BUILD',site:s.id,kind:'pump',tier:1});}
    else if(st.hour===12&&s.dam.built&&(canUpT||canUpP)){ // tier-2 upgrade when the planner's 24 h profit gain pays the machine back within paybackDays
      const gn=upgradeGains(st,s,canUpT,canUpP);const gT=gn.T,gP=gn.P,gB=gn.B;
      const cT=CONFIG.turbine[1].cost,cP=CONFIG.pump[1].cost,pb=CONFIG.god.paybackDays;
      if(canUpT&&canUpP&&gB>0&&(cT+cP)<=gB*pb&&gB>Math.max(gT,gP)){act({type:'BUILD',site:s.id,kind:'turbine',tier:1});act({type:'BUILD',site:s.id,kind:'pump',tier:1});}
      else{if(canUpT&&gT>0&&cT<=gT*pb)act({type:'BUILD',site:s.id,kind:'turbine',tier:1});if(canUpP&&gP>0&&cP<=gP*pb)act({type:'BUILD',site:s.id,kind:'pump',tier:1});}}
    if(st.hour===12){let best=null;for(let i=0;i<48;i++){if(!s.parcels[tileRC(i).p])continue;for(const k of ['solar','wind']){if(s.tiles[i][k]||s.tiles[i].battery)continue;for(let tr=0;tr<3;tr++){const qq=quote(st,s.id,i,k,tr);if(qq.ok&&qq.npv>0&&cash-qq.cost>res*2&&(!best||qq.npv>best.npv))best={npv:qq.npv,tile:i,kind:k,tier:tr};}}}
      if(best)act({type:'BUILD',site:s.id,tile:best.tile,kind:best.kind,tier:best.tier});}
  }}

export {godCtx, godHeuristicDispatch, godHour, godPlan, godSiteProfit, quote, renForecastMW};
