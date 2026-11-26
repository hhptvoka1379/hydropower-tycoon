/* ---------- swimmer / slide rider (build-time geometry + per-instance tint) ----------
   Depends only on the game's GB class: new GB(), g.tri(a,b,c,col,wa,wb,wc), g.p (positions array, read for bounds).
   Axes: y up, metres, the swimmer FACES +Z, her left/right arms along +/-X.
   Origin: the PELVIS = midpoint of the two hip joints (all poses). The returned GB also carries
     g.seat = lowest y of the pose (negative). To rest a rider on a surface at height h place the instance at y = h - g.seat.
   Poses: 0 reference T-pose (feet at y=-0.86, cap top at +0.86, ~1.72 m tall)
          1 slide sitting   : seated feet-first (+Z), legs forward, torso leaning back, arms up in a cheer
          2 slide lying back: reclined on the back, feet toward +Z, head toward -Z, hands behind the head
          3 splash dive     : streamlined, belly down (-Y), head and arms toward +Z, legs toward -Z
   Colours: rgb = the reference look (cream skin, red cap/straps/red stripes, white stripes), so the mesh already
   looks right with the stock shader and icol=(1,1,1,1).
   Tint mask in the vertex-colour ALPHA (the alpha is only read as sway weight when 1.5<uMat<3.5, so use uMat 5):
     0.00 skin   0.25 cap   0.50 stripe B (white)   0.75 straps   1.00 stripe A (red)
   Per instance (icol, 4 floats, no extra attribute):  rgb = stripe A colour,
     a = packed integer (exact in float32, < 2^24):
       bits 0-17  stripe B colour, 6 bits per channel (r<<12 | g<<6 | b)
       bits 18-19 cap source   (0 = A, 1 = B, 2 = white)
       bit  20    strap source (0 = A, 1 = B)
       bits 21-22 skin tone index (0..2, see SWIM_SKIN, mirrored in the shader)
     a <= 1.5 (meshFromGB's default fill) = "no packing": B white, cap A, straps A, skin 0.
*/
const SWIM_SKIN=[[0.95,0.87,0.63],[0.87,0.70,0.52],[0.58,0.41,0.30]]; // cream (reference), tan, brown
// Fixed palettes. cap and strap must equal a, b or white [1,1,1] (they are encoded as a source, not a colour).
const PALETTES=[
  {name:'red',   a:[0.88,0.24,0.24],b:[0.94,0.94,0.96],cap:[0.88,0.24,0.24],strap:[0.88,0.24,0.24]},
  {name:'blue',  a:[0.20,0.42,0.85],b:[0.94,0.94,0.96],cap:[0.20,0.42,0.85],strap:[0.20,0.42,0.85]},
  {name:'yellow',a:[0.98,0.78,0.16],b:[0.94,0.94,0.96],cap:[0.98,0.78,0.16],strap:[0.98,0.78,0.16]},
  {name:'teal',  a:[0.08,0.60,0.58],b:[0.94,0.94,0.96],cap:[0.08,0.60,0.58],strap:[0.08,0.60,0.58]},
  {name:'pink',  a:[0.95,0.45,0.66],b:[0.94,0.94,0.96],cap:[0.95,0.45,0.66],strap:[0.95,0.45,0.66]},
  {name:'navy',  a:[0.13,0.17,0.40],b:[0.13,0.17,0.40],cap:[1,1,1],          strap:[0.13,0.17,0.40]} // solid suit, white cap
];
function swimPack(b,capSrc,strapSrc,skin){const q=v=>Math.max(0,Math.min(63,Math.round(v*63)));
  return q(b[0])*4096+q(b[1])*64+q(b[2])+capSrc*262144+strapSrc*1048576+skin*2097152;}
function swimSrc(c,p){const eq=(u,v)=>Math.abs(u[0]-v[0])+Math.abs(u[1]-v[1])+Math.abs(u[2]-v[2])<1e-3;return eq(c,p.a)?0:eq(c,p.b)?1:2;}
// rnd: a function returning [0,1). Returns {pal, a, b, skin, icol:[r,g,b,packed]} -> icol.set(v.icol, i*4).
function pickVariant(rnd,pal){const P=PALETTES[pal===undefined?Math.floor(rnd()*PALETTES.length)%PALETTES.length:pal];
  const k=1+(rnd()-0.5)*0.08,h=(rnd()-0.5)*0.05; // ~±4% brightness, small hue-ish channel shift
  const jit=c=>[Math.min(1,c[0]*k*(1+h)),Math.min(1,c[1]*k),Math.min(1,c[2]*k*(1-h))];
  const a=jit(P.a),b=P.b===P.a||swimSrc(P.b,P)===0?a:jit(P.b);
  const r=rnd(),skin=r<0.6?0:r<0.85?1:2;
  return {pal:PALETTES.indexOf(P),a,b,skin,icol:[a[0],a[1],a[2],swimPack(b,swimSrc(P.cap,P),Math.min(1,swimSrc(P.strap,P)),skin)]};}

function swimmerGB(pose){
  pose=(pose|0)%4;const g=new GB();
  const SK=SWIM_SKIN[0],RED=PALETTES[0].a,WHT=PALETTES[0].b;
  const M_SKIN=0,M_CAP=0.25,M_B=0.5,M_STRAP=0.75,M_A=1;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const nrm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
  // outward-facing triangle: flips winding so the face normal points away from the interior point ref
  const T=(a,b,c,col,m,ref)=>{const n=cross(sub(b,a),sub(c,a));const cen=mul(add(add(a,b),c),1/3);if(dot(n,sub(cen,ref))<0){const t=b;b=c;c=t;}g.tri(a,b,c,col,m,m,m);};
  const Q=(a,b,c,d,col,m,ref)=>{T(a,b,c,col,m,ref);T(a,c,d,col,m,ref);};
  /* pose table. lean: torso pitch about X (+ = leans back). head: nod (+ = chin down). Legs are in pelvis (world)
     space for the right leg (x>0, mirrored for the left). Arms are in torso-local space. */
  const PS=[
    {lean:0,head:0,thigh:[-0.03,-1,0.02],shin:[-0.03,-1,-0.03],ff:[0.05,0,1],fu:[0,1,0],
     ua:[1,-0.08,0],fa:[1,-0.06,0],hu:[0,1,0]},
    {lean:0.32,head:-0.1,thigh:[0.13,-0.06,1],shin:[0.08,-0.03,1],ff:[0.1,1,0.3],fu:[0,0,-1],
     ua:[0.42,1,0.12],fa:[0.22,1,0.2],hu:[0,0,-1]},
    {lean:1.38,head:0.55,thigh:[0.07,-0.04,1],shin:[0.03,0.02,1],ff:[0.12,1,0.2],fu:[0,0,-1],
     ua:[0.75,0.55,0.18],tgt:[0.02,0.72,-0.11],hu:[0,0,-1]},
    {lean:-Math.PI/2,head:-0.15,thigh:[-0.02,0,-1],shin:[-0.01,0.02,-1],ff:[0,-0.12,-1],fu:[0,-1,0],
     ua:[0.12,1,0.04],fa:[0.03,1,0.04],hu:[0,0,-1]}
  ][pose];
  const cl=Math.cos(PS.lean),sl=Math.sin(PS.lean);
  const W=p=>[p[0],p[1]*cl+p[2]*sl,-p[1]*sl+p[2]*cl];       // torso-local -> pelvis space
  const Wd=W;                                                // same for directions
  // tube through chain pts (pelvis space) with radii, seg sides; frame from hint so twisting is stable
  const tube=(pts,rad,seg,col,m,hint)=>{let rings=[];for(let i=0;i<pts.length;i++){
      const t=nrm(sub(pts[Math.min(i+1,pts.length-1)],pts[Math.max(i-1,0)]));let u=sub(hint,mul(t,dot(hint,t)));u=nrm(u);const v=cross(t,u);
      const r=[];for(let k=0;k<seg;k++){const a=(k+0.5)/seg*Math.PI*2;r.push(add(pts[i],add(mul(u,Math.cos(a)*rad[i]),mul(v,Math.sin(a)*rad[i]))));}rings.push(r);}
    for(let i=0;i+1<rings.length;i++)for(let k=0;k<seg;k++){const k1=(k+1)%seg;const ref=mul(add(pts[i],pts[i+1]),0.5);
      Q(rings[i][k],rings[i][k1],rings[i+1][k1],rings[i+1][k],col,m,ref);}};
  // box-like wedge: o = centre of the back-bottom edge (or back centre if mid), f forward, u up
  const wedge=(o,f,u,len,w0,w1,h0,h1,mid,col)=>{f=nrm(f);u=nrm(sub(u,mul(f,dot(u,f))));const s=cross(f,u);const P=[];
    for(let e=0;e<2;e++){const w=e?w1:w0,h=e?h1:h0,c=add(o,mul(f,e*len));for(let j=0;j<4;j++){const sx=(j&1)?1:-1,top=(j&2)?1:0;
      P.push(add(c,add(mul(s,sx*w/2),mul(u,mid?(top?h/2:-h/2):top*h))));}}
    const ref=add(o,add(mul(f,len*0.4),mul(u,mid?0:h0*0.3)));
    const F=[[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]];for(const q of F)Q(P[q[0]],P[q[1]],P[q[2]],P[q[3]],col,0,ref);};

  /* ---- torso (torso-local: pelvis origin, y up the spine, z = belly) ---- */
  const KEY=[[-0.05,0.125,0.085,0],[0,0.155,0.10,-0.012],[0.07,0.15,0.094,-0.006],[0.13,0.124,0.08,0],[0.20,0.104,0.072,0],
    [0.27,0.122,0.08,0.006],[0.33,0.134,0.094,0.02],[0.38,0.138,0.10,0.026],[0.42,0.142,0.084,0.012],[0.465,0.168,0.07,0],[0.50,0.10,0.055,0]];
  const prof=y=>{for(let i=0;i+1<KEY.length;i++){const A=KEY[i],B=KEY[i+1];if(y<=B[0]||i+2===KEY.length){const t=Math.max(0,Math.min(1,(y-A[0])/(B[0]-A[0])));
      return [A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t,A[3]+(B[3]-A[3])*t];}}};
  const NS=8;const ring=(y,cut)=>{const r=[];for(let k=0;k<NS;k++){const a=k/NS*Math.PI*2,sa=Math.sin(a),ca=Math.cos(a);
      const yy=y+(cut?cut*Math.abs(sa):0);const p=prof(yy);let z=p[1]*ca+p[2];r.push([p[0]*sa,yy,z]);}return r;};
  const BND=[0.07,0.11,0.15,0.19,0.23,0.27,0.31,0.35,0.42];
  const rings=[ring(-0.045,0.085)];for(const y of BND)rings.push(ring(y));rings.push(ring(0.465));rings.push(ring(0.50));
  const axis=y=>[0,y,prof(y)[2]];
  for(let i=0;i+1<rings.length;i++){const suit=i<BND.length;const m=suit?(i%2?M_B:M_A):M_SKIN,col=suit?(i%2?WHT:RED):SK;
    for(let k=0;k<NS;k++){const k1=(k+1)%NS;const yc=(rings[i][k][1]+rings[i+1][k][1])*0.5;
      Q(W(rings[i][k]),W(rings[i][k1]),W(rings[i+1][k1]),W(rings[i+1][k]),col,m,W(axis(yc)));}}
  const crotch=[0,-0.08,0.005],top=[0,0.515,0];
  for(let k=0;k<NS;k++){const k1=(k+1)%NS;T(W(rings[0][k]),W(rings[0][k1]),W(crotch),RED,M_A,W([0,0.02,0]));
    T(W(rings[rings.length-1][k]),W(rings[rings.length-1][k1]),W(top),SK,M_SKIN,W([0,0.44,0]));}
  // straps (raised a few mm off the skin), front top edge -> over the shoulder -> back top edge
  const surf=(x,y,back)=>{const p=prof(y);const a=Math.asin(Math.max(-1,Math.min(1,x/p[0])));const z=p[1]*Math.cos(a)*(back?-1:1)+p[2];return [x,y,z+(back?-0.006:0.006)];};
  for(const s of [-1,1]){const xc=s*0.082,hw=0.014;const path=[[0.40,0],[0.465,0],[0.505,0],[0.505,1],[0.465,1],[0.40,1]];
    const pts=path.map(([y,b],i)=>{const q=surf(xc,y,b);if(i===2||i===3){q[1]=0.512;q[2]=b?-0.02:0.02;}return q;});
    for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1];const ref=W([xc,(a[1]+b[1])/2-0.06,(a[2]+b[2])*0.3]);
      Q(W([a[0]-hw,a[1],a[2]]),W([a[0]+hw,a[1],a[2]]),W([b[0]+hw,b[1],b[2]]),W([b[0]-hw,b[1],b[2]]),RED,M_STRAP,ref);}}
  /* ---- neck + head ---- */
  const hp=PS.head,ch=Math.cos(hp),shh=Math.sin(hp),piv=[0,0.58,0.0];
  const HW=p=>{const y=p[1],z=p[2];return W(add(piv,[p[0],y*ch-z*shh,y*shh+z*ch]));}; // head-local (rel. pivot) -> pelvis
  tube([W([0,0.47,-0.005]),HW([0,0.06,0.0])],[0.04,0.034],5,SK,M_SKIN,Wd([0,0,1]));
  const HC=[0,0.125,0.012]; // head centre relative to pivot
  const HR=[[0.10,0.062,0.072,-0.006],[0.05,0.08,0.096,-0.002],[-0.02,0.074,0.09,0.002],[-0.08,0.052,0.066,0.008]];
  const hr=HR.map(([y,rx,rz,zo],j)=>{const r=[];for(let k=0;k<8;k++){const a=k/8*Math.PI*2,sa=Math.sin(a),ca=Math.cos(a);
      let z=rz*ca+zo;if(ca>0.5&&k!==0)z-=0.012;            // flatten the face planes
      if(k===0){if(j===2)z+=0.014;if(j===3)z+=0.004;}       // nose ridge, chin line
      r.push([rx*sa*(j===3&&ca>0.5?0.8:1),y,z]);}return r;});
  const htop=[0,0.135,-0.01],hchin=[0,-0.125,0.03];
  const hcol=(a,b,c)=>{const cy=(a[1]+b[1]+c[1])/3,cz=(a[2]+b[2]+c[2])/3;const t=Math.max(0,Math.min(1,(0.09-cz)/0.18));return cy>0.065-0.13*t;};
  const HT=(a,b,c)=>{const cap=hcol(a,b,c);T(HW(add(HC,a)),HW(add(HC,b)),HW(add(HC,c)),cap?RED:SK,cap?M_CAP:M_SKIN,HW(HC));};
  for(let k=0;k<8;k++){const k1=(k+1)%8;HT(hr[0][k],hr[0][k1],htop);HT(hr[3][k1],hr[3][k],hchin);
    for(let j=0;j<3;j++){HT(hr[j][k],hr[j][k1],hr[j+1][k1]);HT(hr[j][k],hr[j+1][k1],hr[j+1][k]);}}
  /* ---- legs (pelvis space) ---- */
  for(const s of [-1,1]){const mir=v=>[v[0]*s,v[1],v[2]];const H=[s*0.074,0,-0.006];
    const td=nrm(mir(PS.thigh)),sd=nrm(mir(PS.shin));const K=add(H,mul(td,0.40)),A=add(K,mul(sd,0.39)),C=add(K,mul(sd,0.11));
        tube([add(H,mul(td,-0.01)),K,C,A],[0.08,0.047,0.053,0.03],5,SK,M_SKIN,[1,0,0]);
    const ff=nrm(mir(PS.ff)),fu=nrm(mir(PS.fu));const fuo=nrm(sub(fu,mul(ff,dot(fu,ff))));
    wedge(add(add(A,mul(fuo,-0.075)),mul(ff,-0.055)),ff,fu,0.21,0.06,0.07,0.095,0.026,false,SK);}
  /* ---- arms (torso-local, then W) ---- */
  for(const s of [-1,1]){const mir=v=>[v[0]*s,v[1],v[2]];const S=[s*0.155,0.455,-0.005];
    const ua=nrm(mir(PS.ua));const E=add(S,mul(ua,0.28));const fa=PS.tgt?nrm(sub(mir(PS.tgt),E)):nrm(mir(PS.fa));const Wr=add(E,mul(fa,0.25));
    const hu=mir(PS.hu);
    tube([W(add(S,mul(ua,-0.02))),W(E),W(Wr)],[0.056,0.034,0.025],5,SK,M_SKIN,Wd(cross(ua,hu)));
    wedge(W(add(Wr,mul(fa,-0.02))),Wd(fa),Wd(hu),0.15,0.055,0.045,0.026,0.014,true,SK);}
  let mn=1e9;for(let i=1;i<g.p.length;i+=3)if(g.p[i]<mn)mn=g.p[i];g.seat=mn;g.tris=g.p.length/9;
  return g;}

/* write one rider's variant into a mesh's icol array (variant from pickVariant) */
function swimmerTint(icol,i,v){icol.set(v.icol,i*4);}
