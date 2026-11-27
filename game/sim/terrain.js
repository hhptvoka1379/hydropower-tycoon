/* Procedural terrain, canyon parameters, level shaping (SC), lake outline, terrain height, site layout and penstock route. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {DEG, PI, TAU, absf, clamp, hu, sstep} from './rng.js';
import {CONFIG} from './config.js';
import {bowlR} from './reservoirs.js';

/* ---------- terrain (shared by sim layout and the renderer) ---------- */
function makeTP(seed){const ph=[],rr=[];for(let i=0;i<24;i++){ph.push(hu(seed,900+i,7)*TAU);rr.push(0.7+hu(seed,950+i,3)*0.6);}return {ph,rr};}
function fbm(tp,o0,x,z){let s=0,a=1,f=1,t=0;for(let o=0;o<4;o++){const k=o0+o*2,p1=tp.ph[k],p2=tp.ph[k+1],r=tp.rr[k];
  s+=a*Math.sin(x*f*r+p1+0.8*Math.sin(z*f*0.73+p2))*Math.cos(z*f*r*0.91+p2*1.3+0.7*Math.sin(x*f*0.61+p1));t+=a;a*=0.5;f*=2.07;}return s/t;}
function canyonParams(seed,bias,river){const b=CONFIG.proc.bias[bias]||CONFIG.proc.bias.balanced;
  return {S0:b.S0,m:b.m,relief:b.relief,w0:b.w0,A:[95*b.amp,42*b.amp,14],L:[260,120,52],ph:[hu(seed,1,1)*TAU,hu(seed,1,2)*TAU,hu(seed,1,3)*TAU],wph:[hu(seed,2,1)*TAU,hu(seed,2,2)*TAU,hu(seed,2,3)*TAU],riverW:CONFIG.proc.riverW[river]||14,bedTop:CONFIG.proc.bedTop};}
function cX(cp,z){return cp.A[0]*Math.sin(z/cp.L[0]+cp.ph[0])+cp.A[1]*Math.sin(z/cp.L[1]+cp.ph[1])+cp.A[2]*Math.sin(z/cp.L[2]+cp.ph[2]);}
function cSlope(cp,z){return cp.A[0]/cp.L[0]*Math.cos(z/cp.L[0]+cp.ph[0])+cp.A[1]/cp.L[1]*Math.cos(z/cp.L[1]+cp.ph[1])+cp.A[2]/cp.L[2]*Math.cos(z/cp.L[2]+cp.ph[2]);}
function cW(cp,z){return cp.w0*(1+0.42*Math.sin(z/170+cp.wph[0])+0.22*Math.sin(z/63+cp.wph[1]));}
function cBed(cp,z){return cp.bedTop-cp.S0*(z+800);}
function riverW(cp,z){return cp.riverW*(1+0.35*Math.sin(z/90+cp.wph[2]));}
function bowlH(r,cx,cz,x,z,f){const dx=x-cx,dz=z-cz;const rr=(dx*dx+dz*dz)/((f||1)*(f||1));const A=PI*rr;if(A<=r.a1)return r.bottom;return r.bottom+(A-r.a1)/(2*r.a2);}
/* Display-only organic lake outline: radial scale f(theta) (area-normalised, 1 toward dam / powerhouse) so contours stay noisy
   polygons instead of circles. The analytic volume curve (resVol/resLevel/bowlR) is untouched; terrainH(raw=true) skips it. */
const SHN={};
function shoreF(s,which,x,z){const L=s.layout;if(!L)return 1;const cx=which?L.lo.x:L.up.x,cz=which?L.lo.z:L.up.z;const key=(s.seed|0)*2+which;let P=SHN[key];
  if(!P){const K=[2,3,5,7,11],A=[0.06,0.05,0.038,0.028,0.015],k0=0.85+0.3*hu(s.seed,1190+which,2);P={K,a:A.map((a,i)=>a*k0*(0.8+0.4*hu(s.seed,1170+which*7+i,4))),ph:K.map((k,i)=>hu(s.seed,1100+which*10+i,5)*TAU)};
    let q=0;for(const a of P.a)q+=a*a/2;P.nrm=1/Math.sqrt(1+q);SHN[key]=P;}
  const th=Math.atan2(z-cz,x-cx);let n=0;for(let i=0;i<5;i++)n+=P.a[i]*Math.cos(P.K[i]*th+P.ph[i]);
  const kd=which?Math.atan2(L.ph.z-L.lo.z,L.ph.x-L.lo.x):Math.atan2(L.dir.z,L.dir.x);let dd=Math.abs(th-kd);dd=dd>PI?TAU-dd:dd;
  return clamp((1+n*sstep(0.3,1.2,dd))*P.nrm,0.8,1.2);}

/* ---------- level shaping (opt-in "Shape your land" step). Everything here is inert unless a site carries .sculpt:
   generator parameters (gen) + a coarse 49x49 height-offset grid (d = base64 Int8, 0.75 m per unit). The offset is multiplied by a
   protection mask that is exactly 0 over the lake bowls, dam, powerhouse, tailrace, penstock corridor and the three parcels. ---------- */
const SC=(function(){
  const NG=49,CS=1600/(NG-1),Q=0.75,X0=-800,B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const DEF={rug:50,hill:50,open:50,ridge:35,rang:30,ang:0,sp:100,forest:50,flower:50};
  const LIM={rug:[0,100],hill:[0,100],open:[0,100],ridge:[0,100],rang:[0,179],ang:[-180,180],sp:[80,108],forest:[0,100],flower:[0,100]};
  const LEN=4*Math.ceil(NG*NG/3);const REV={};for(let i=0;i<64;i++)REV[B64.charAt(i)]=i;
  function enc(a){let o='';const n=a.length;for(let i=0;i<n;i+=3){const x=a[i]&255,y=i+1<n?a[i+1]&255:0,z=i+2<n?a[i+2]&255:0;const k=(x<<16)|(y<<8)|z;
    o+=B64.charAt((k>>18)&63)+B64.charAt((k>>12)&63)+(i+1<n?B64.charAt((k>>6)&63):'=')+(i+2<n?B64.charAt(k&63):'=');}return o;}
  function dec(s){const a=new Int8Array(NG*NG);if(!s)return a;const n=a.length;let o=0;
    for(let i=0;i+3<s.length&&o<n;i+=4){const k=(REV[s.charAt(i)]<<18)|(REV[s.charAt(i+1)]<<12)|((REV[s.charAt(i+2)]||0)<<6)|(REV[s.charAt(i+3)]||0);
      a[o++]=(k>>16)&255;if(o<n)a[o++]=(k>>8)&255;if(o<n)a[o++]=k&255;}return a;}
  function norm(o){const g={},og=(o&&o.gen)||{};for(const k in DEF){let v=+og[k];if(!(v===v))v=DEF[k];g[k]=clamp(Math.round(v),LIM[k][0],LIM[k][1]);}
    let d=o&&typeof o.d==='string'?o.d:'';if(d.length!==LEN||!/^[A-Za-z0-9+/]*={0,2}$/.test(d))d='';
    if(d){let z=true;const a=dec(d);for(let i=0;i<a.length;i++)if(a[i]!==0){z=false;break;}if(z)d='';}
    return {v:1,n:NG,gen:g,d};}
  const GC=new Map();
  function grid(d){if(!d)return null;let g=GC.get(d);if(!g){const a=dec(d);g=new Float32Array(NG*NG);for(let i=0;i<g.length;i++)g[i]=a[i]*Q;if(GC.size>24)GC.clear();GC.set(d,g);}return g;}
  function cr(u,k){const u2=u*u,u3=u2*u;return k===0?-0.5*u3+u2-0.5*u:k===1?1.5*u3-2.5*u2+1:k===2?-1.5*u3+2*u2+0.5*u:0.5*u3-0.5*u2;}
  function gridAt(g,x,z){let fx=(x-X0)/CS,fz=(z-X0)/CS;const mx=NG-1.0001;fx=fx<0?0:fx>mx?mx:fx;fz=fz<0?0:fz>mx?mx:fz;const i=fx|0,j=fz|0,u=fx-i,v=fz-j;let s=0;
    for(let b=0;b<4;b++){const jj=clamp(j+b-1,0,NG-1),wz=cr(v,b);let r=0;for(let a=0;a<4;a++){r+=cr(u,a)*g[jj*NG+clamp(i+a-1,0,NG-1)];}s+=wz*r;}return s;}
  /* protected zones (cached per site object + layout; never stored on the site so the state hash is unaffected) */
  const ZC=new WeakMap();
  function zones(s){const c=ZC.get(s);if(c&&c.L===s.layout)return c.z;const L=s.layout,z=[];const C=(x,y,r,f)=>z.push({t:0,x,z:y,r,f}),K=(x,y,x2,y2,r,f)=>z.push({t:1,x,z:y,x2,z2:y2,r,f}),B=(x,y,r,f)=>z.push({t:2,x,z:y,r,f});
    if(s.kind==='classic')C(L.up.x,L.up.z,L.dam.r*1.2+18,150);else z.push({t:3,r:130,f:110,cp:s.cp});
    C(L.lo.x,L.lo.z,bowlR(s.lower,s.lower.hMax)*1.2+34,150);C(L.dam.x,L.dam.z,(L.dam.span||60)+50,100);C(L.ph.x,L.ph.z,80,90);
    K(L.ph.x,L.ph.z,L.tail.x,L.tail.z,40,70);K(L.dam.x,L.dam.z,L.ph.x,L.ph.z,30,90);for(const p of L.parcels)B(p.x,p.z,84,90);
    ZC.set(s,{L:s.layout,z});return z;}
  function maskAt(s,x,zz){const Z=zones(s);let m=1;for(let k=0;k<Z.length;k++){const q=Z[k];let d;
      if(q.t===0){const dx=x-q.x,dz=zz-q.z;d=Math.sqrt(dx*dx+dz*dz)-q.r;}
      else if(q.t===1){const vx=q.x2-q.x,vz=q.z2-q.z;const l2=vx*vx+vz*vz||1;const t=clamp(((x-q.x)*vx+(zz-q.z)*vz)/l2,0,1);const dx=x-q.x-vx*t,dz=zz-q.z-vz*t;d=Math.sqrt(dx*dx+dz*dz)-q.r;}
      else if(q.t===2){d=Math.max(absf(x-q.x),absf(zz-q.z))-q.r;}
      else{d=absf(x-cX(q.cp,zz))-(cW(q.cp,zz)/2+q.r);}
      const t=sstep(0,q.f,d);if(t<m){m=t;if(m<=0)return 0;}}return m;}
  function genTerm(s,x,z){const g=s.sculpt.gen,tp=s.tp;let o=0;
    if(g.hill>0)o+=g.hill*0.5*fbm(tp,12,x/200,z/200);
    if(g.ridge>0){const a=g.rang*DEG,ca=Math.cos(a),sa=Math.sin(a);const u=x*ca+z*sa,v=-x*sa+z*ca;o+=g.ridge*0.65*fbm(tp,16,u/340,v/105);}
    if(g.rug!==50)o+=(g.rug-50)/50*(8*fbm(tp,8,x/130,z/130)+3*fbm(tp,16,x/45,z/45));return o;}
  function off(s,x,z){const m=maskAt(s,x,z);if(m<=0)return 0;let o=genTerm(s,x,z);const G=grid(s.sculpt.d);if(G)o+=gridAt(G,x,z);return o*m;}
  function openSig(s,along,Lp){const k=0.6+0.8*s.sculpt.gen.open/100;return 40*(1+(k-1)*sstep(0.2*Lp,0.6*Lp,along));}
  function xf(g){const a=g.ang*DEG,ca=Math.cos(a),sa=Math.sin(a),k=g.sp/100;return (p,sc)=>{const kk=sc?k:1;return {x:(p.x*ca-p.z*sa)*kk,z:(p.x*sa+p.z*ca)*kk};};}
  function apply(s,sc){s.sculpt=sc;s.layout=s.kind==='classic'?classicLayout(s):procLayout(s);s.route=penstockRoute(s);
    if(s.kind==='classic'){const t=Object.assign({},s,{sculpt:null});t.layout=classicLayout(t);s.penstock.L=Math.round((CONFIG.penstock.classicL+routeLen(s.route)-routeLen(penstockRoute(t)))*10)/10;} // keep the stock pipe length when the layout is merely rotated
    else s.penstock.L=routeLen(s.route)+20;return s;}
  return {NG,CS,Q,X0,DEF,LIM,enc,dec,norm,mask:maskAt,off,gridAt,grid,zones,genTerm,openSig,xf,apply};
})();

terrainH.sc=SC;
terrainH.shoreF=shoreF;
function terrainH(s,x,z,raw){ /* §8.1 terrain height in metres (simulation scale) */
  const tp=s.tp,L=s.layout;let h;
  if(s.kind==='classic'){
    h=118+22*fbm(tp,0,x/380,z/380)+8*fbm(tp,8,x/130,z/130)+3*fbm(tp,16,x/45,z/45);
    const dux=x-L.up.x,duz=z-L.up.z;h+=92*Math.exp(-(dux*dux+duz*duz)/(2*360*360));
    const dlx=x-L.lo.x,dlz=z-L.lo.z;h-=10*Math.exp(-(dlx*dlx+dlz*dlz)/(2*420*420));
    // notch through the rim toward the lower lake, closed by the dam
    const nx=x-L.dam.x,nz=z-L.dam.z;const along=nx*L.dir.x+nz*L.dir.z,across=-nx*L.dir.z+nz*L.dir.x;
    const Lp=L.phDist;const sg=s.sculpt?SC.openSig(s,along,Lp):40;let w=Math.exp(-across*across/(2*sg*sg));if(along>Lp)w*=Math.exp(-(along-Lp)*(along-Lp)/(2*30*30));if(along<-40)w*=Math.exp(-(along+40)*(along+40)/(2*50*50));
    const nv=(s.upper.bottom+1)+(L.padY-s.upper.bottom-1)*clamp(along/Lp,0,1);
    if(nv<h)h=h*(1-w)+nv*w;
    h=Math.min(h,bowlH(s.upper,L.up.x,L.up.z,x,z,raw?1:shoreF(s,0,x,z))+0.6*fbm(tp,4,x/30,z/30));
    h=Math.min(h,bowlH(s.lower,L.lo.x,L.lo.z,x,z,raw?1:shoreF(s,1,x,z))+0.5*fbm(tp,6,x/28,z/28));
  } else {
    const cp=s.cp;const xc=cX(cp,z),sl=cSlope(cp,z);const d=absf(x-xc)/Math.sqrt(1+sl*sl);const w=cW(cp,z),b=cBed(cp,z);
    const e=Math.max(0,d-w/2);const Hr=cp.relief;
    h=b+Hr*(1-Math.exp(-e/(cp.m*Hr)));
    const ha=sstep(0,160,e);
    h+=ha*(Hr*0.42*fbm(tp,0,x/420,z/420)+10*fbm(tp,8,x/150,z/150))+3*fbm(tp,16,x/48,z/48)*Math.min(1,e/30+0.25);
    const rw=riverW(cp,z);if(d<rw/2+5){const t=Math.min(1,d/(rw/2));const ch=b-1.8*Math.max(0,1-t*t)-0.25;const bl=sstep(rw/2+5,rw/2,d);h=h*(1-bl)+Math.min(h,ch)*bl;}
    if(L){h=Math.min(h,bowlH(s.lower,L.lo.x,L.lo.z,x,z,raw?1:shoreF(s,1,x,z))+0.5*fbm(tp,6,x/28,z/28));}
  }
  if(s.sculpt){const o=SC.off(s,x,z);if(o!==0){h+=o;if(h<62)h=62;}} // level shaping (zero in protected zones)
  if(L){ // powerhouse pad + tailrace cut
    const px=x-L.ph.x,pz=z-L.ph.z;const dp=Math.sqrt(px*px+pz*pz);
    if(dp<46){const bl=sstep(46,26,dp);h=h*(1-bl)+L.padY*bl;}
    const tx=L.tail.x-L.ph.x,tz=L.tail.z-L.ph.z;const tl=Math.sqrt(tx*tx+tz*tz)||1;const u=clamp((px*tx+pz*tz)/(tl*tl),0,1);
    const qx=px-u*tx,qz=pz-u*tz;const dq=Math.sqrt(qx*qx+qz*qz);if(dq<14){const bl=sstep(14,6,dq);const ty=L.padY-1.5;if(ty<h)h=h*(1-bl)+ty*bl;}
  }
  return h;
}

/* ---------- layout ---------- */

function classicLayout(s){
  const C=CONFIG.classic;let up={x:C.upper.x,z:C.upper.z},lo={x:C.lower.x,z:C.lower.z};
  if(s.sculpt){const T=SC.xf(s.sculpt.gen);up=T(up,true);lo=T(lo,true);}
  let dx=lo.x-up.x,dz=lo.z-up.z;const dl=Math.sqrt(dx*dx+dz*dz);dx/=dl;dz/=dl;
  /* ring follows the current wall (A14a) */const dH=s.dam&&s.dam.height>0?s.dam.height:C.damH;const rD=bowlR(s.upper,dH-CONFIG.res.freeboard)+15;const dam={x:up.x+dx*rD,z:up.z+dz*rD,dx:-dz,dz:dx,span:62,arc:true,cx:up.x,cz:up.z,r:rD};
  const rP=bowlR(s.lower,C.lower.hMax)+30;const ph={x:lo.x-dx*rP,z:lo.z-dz*rP,yaw:0};
  const rT=bowlR(s.lower,C.lower.h0)-10;const tail={x:lo.x-dx*rT,z:lo.z-dz*rT};
  const padY=s.lower.bottom+CONFIG.cav.setT-2;
  const phDist=Math.sqrt((ph.x-dam.x)*(ph.x-dam.x)+(ph.z-dam.z)*(ph.z-dam.z));
  let parcels=[{x:-430,z:330},{x:430,z:-400},{x:-120,z:600}];
  if(s.sculpt){const T=SC.xf(s.sculpt.gen);parcels=parcels.map(p=>T(p,false));}
  return {up,lo,dir:{x:dx,z:dz},dam,ph,tail,padY,phDist,parcels,size:1600};
}
function procLayout(s){
  const cp=s.cp,zd=s.station,P=CONFIG.proc;const zL=zd+P.lowerOffset;
  const lo={x:cX(cp,zL),z:zL};const Lres=Math.max(10,s.dam.height)/cp.S0;const zu=Math.max(-780,zd-Lres*0.5);
  const up={x:cX(cp,zu),z:zu};
  const sl=cSlope(cp,zd);const tl=Math.sqrt(1+sl*sl);const tx=sl/tl,tz=1/tl;
  const w=cW(cp,zd);const dam={x:cX(cp,zd),z:zd,dx:tz,dz:-tx,span:w/2+cp.m*P.maxDam*0.6+20,arc:false};
  const side=(cX(cp,zL)-cX(cp,zd))>0?-1:1;
  const rP=bowlR(s.lower,P.lowerHMax);
  const ph={x:lo.x+side*rP*0.55,z:lo.z-rP*0.82,yaw:0};
  const rT=bowlR(s.lower,P.lowerH0)-8;let tdx=lo.x-ph.x,tdz=lo.z-ph.z;const td=Math.sqrt(tdx*tdx+tdz*tdz)||1;
  const phd=Math.sqrt((lo.x-ph.x)*(lo.x-ph.x)+(lo.z-ph.z)*(lo.z-ph.z));
  const tail={x:ph.x+tdx/td*(phd-rT),z:ph.z+tdz/td*(phd-rT)};
  const padY=s.lower.bottom+CONFIG.cav.setT-2;
  let dx=ph.x-dam.x,dz=ph.z-dam.z;const dl=Math.sqrt(dx*dx+dz*dz)||1;
  const parcels=[];const zs=[zd+170,zd-160,zL+120];
  for(let i=0;i<3;i++){const z=clamp(zs[i],-700,700);const sd=i===1?-side:side;const x=clamp(cX(cp,z)+sd*310,-700,700);parcels.push({x,z});}
  return {up,lo,dir:{x:dx/dl,z:dz/dl},dam,ph,tail,padY,phDist:dl,parcels,size:1600,side};
}
function penstockRoute(s){ // polyline from the dam intake to the powerhouse, sampled on terrain (metres)
  const L=s.layout;const pts=[];const N=16;
  const sx=L.dam.x+L.dir.x*10,sz=L.dam.z+L.dir.z*10,ex=L.ph.x-L.dir.x*14,ez=L.ph.z-L.dir.z*14;
  pts.push({x:L.dam.x-L.dir.x*6,z:L.dam.z-L.dir.z*6,y:s.upper.bottom+2});
  for(let i=0;i<=N;i++){const t=i/N;const x=sx+(ex-sx)*t,z=sz+(ez-sz)*t;pts.push({x,z,y:terrainH(s,x,z,true)+0.9});}
  pts.push({x:L.ph.x,z:L.ph.z,y:L.padY+3});
  return pts;
}
function routeLen(pts){let l=0;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];l+=Math.sqrt((a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z));}return l;}
function chokePoints(cp){const P=CONFIG.proc;const out=[];let prev=cW(cp,P.stationMin-10),cur=cW(cp,P.stationMin);
  for(let z=P.stationMin;z<=P.stationMax;z+=5){const nxt=cW(cp,z+5);if(cur<=prev&&cur<=nxt&&cur<cp.w0*P.chokeMaxW)out.push({z,w:cur,x:cX(cp,z)});prev=cur;cur=nxt;}
  if(out.length===0){let best=P.stationMin,bw=1e9;for(let z=P.stationMin;z<=P.stationMax;z+=5){const w=cW(cp,z);if(w<bw){bw=w;best=z;}}out.push({z:best,w:bw,x:cX(cp,best)});}
  return out;}

export {SC, cBed, cW, cX, canyonParams, chokePoints, classicLayout, makeTP, penstockRoute, procLayout, riverW, routeLen, terrainH};
