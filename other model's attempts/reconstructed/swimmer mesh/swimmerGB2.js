/* ---------- swimmer / slide rider v2: body-shape variants (build-time geometry + per-instance tint) ----------
   Drop-in replacement for swimmerGB.js (defines the same names; do not paste both).
   Depends only on the game's GB class: new GB(), g.tri(a,b,c,col,wa,wb,wc), g.p (positions, read for bounds).
   Axes: y up, metres, the swimmer FACES +Z, arms along +/-X. Origin: the PELVIS (midpoint of the hip joints), all poses.
   swimmerGB(pose, body)  body = descriptor (see SWIM_BODY_DEFAULT / BODIES); omitted = the v1 reference figure.
     Returned GB also carries g.seat (lowest y; rest a rider on a surface at h by placing it at y = h - g.seat),
     g.tris, g.top (highest y) and g.body (the resolved descriptor).
   Poses: 0 T-pose, 1 slide sitting (feet-first +Z, arms up), 2 slide lying back (hands behind head), 3 dive (belly -Y, head +Z).
   Tint mask in the vertex-colour ALPHA (use uMat 5, see README):
     0.000 skin   0.125 hair   0.25 cap   0.50 stripe B   0.75 straps   1.00 stripe A
   Per instance icol (4 floats): rgb = stripe A colour, a = packed integer (< 2^24, exact in float32):
     bits 0-17 stripe B rgb (6 bits/channel) | bits 18-19 cap source (0 A, 1 B, 2 white) | bit 20 strap source (0 A, 1 B)
     bits 21-23 LOOK index 0..7 into SWIM_LOOK = [skin tone, hair colour] (indices 0-2 = v1 skin tones 0-2).
*/
const SWIM_SKIN=[[0.95,0.87,0.63],[0.87,0.70,0.52],[0.58,0.41,0.30]];                 // cream (reference), tan, brown
const SWIM_HAIR=[[0.40,0.27,0.15],[0.24,0.16,0.10],[0.11,0.10,0.10],[0.88,0.72,0.40],[0.62,0.29,0.14]]; // lt brown, dk brown, black, blonde, auburn
const SWIM_LOOK=[[0,0],[1,1],[2,2],[0,3],[0,4],[1,2],[2,1],[1,0]];                    // [skin, hair]; keep in sync with the shader
const PALETTES=[
  {name:'red',   a:[0.88,0.24,0.24],b:[0.94,0.94,0.96],cap:[0.88,0.24,0.24],strap:[0.88,0.24,0.24]},
  {name:'blue',  a:[0.20,0.42,0.85],b:[0.94,0.94,0.96],cap:[0.20,0.42,0.85],strap:[0.20,0.42,0.85]},
  {name:'yellow',a:[0.98,0.78,0.16],b:[0.94,0.94,0.96],cap:[0.98,0.78,0.16],strap:[0.98,0.78,0.16]},
  {name:'teal',  a:[0.08,0.60,0.58],b:[0.94,0.94,0.96],cap:[0.08,0.60,0.58],strap:[0.08,0.60,0.58]},
  {name:'pink',  a:[0.95,0.45,0.66],b:[0.94,0.94,0.96],cap:[0.95,0.45,0.66],strap:[0.95,0.45,0.66]},
  {name:'navy',  a:[0.13,0.17,0.40],b:[0.13,0.17,0.40],cap:[1,1,1],          strap:[0.13,0.17,0.40]} // solid suit, white cap
];
function swimPack(b,capSrc,strapSrc,look){const q=v=>Math.max(0,Math.min(63,Math.round(v*63)));
  return q(b[0])*4096+q(b[1])*64+q(b[2])+capSrc*262144+strapSrc*1048576+(look&7)*2097152;}
function swimSrc(c,p){const eq=(u,v)=>Math.abs(u[0]-v[0])+Math.abs(u[1]-v[1])+Math.abs(u[2]-v[2])<1e-3;return eq(c,p.a)?0:eq(c,p.b)?1:2;}
// rnd: function returning [0,1). pal: optional palette index, look: optional SWIM_LOOK index.
// Returns {pal, a, b, look, skin, icol:[r,g,b,packed]} -> swimmerTint(icol, i, v).
function pickVariant(rnd,pal,look){const P=PALETTES[pal===undefined?Math.floor(rnd()*PALETTES.length)%PALETTES.length:pal];
  const k=1+(rnd()-0.5)*0.08,h=(rnd()-0.5)*0.05;
  const jit=c=>[Math.min(1,c[0]*k*(1+h)),Math.min(1,c[1]*k),Math.min(1,c[2]*k*(1-h))];
  const a=jit(P.a),b=P.b===P.a||swimSrc(P.b,P)===0?a:jit(P.b);
  if(look===undefined){const W=[25,15,12,15,8,10,8,7];let r=rnd()*100;look=0;while(look<7&&r>=W[look]){r-=W[look];look++;}}
  return {pal:PALETTES.indexOf(P),a,b,look,skin:SWIM_LOOK[look][0],icol:[a[0],a[1],a[2],swimPack(b,swimSrc(P.cap,P),Math.min(1,swimSrc(P.strap,P)),look)]};}
function swimmerTint(icol,i,v){icol.set(v.icol,i*4);}

/* ---- body descriptor ----
   height    total standing height in metres (sole to crown), ~1.20-1.95. The figure is built in unit proportions
             and uniformly scaled so the T-pose is exactly this tall.
   build     0 slim .. 0.5 average .. 1 stocky/heavy: torso width + depth, limb thickness, slight belly above 0.6
   shoulders shoulder width multiplier (1 = reference)          bust   0 flat .. 0.5 reference .. 1 full (front-only bulge)
   waist     waist width multiplier                             hips   hip/seat width multiplier
   legs      leg length multiplier (leg:torso ratio)            arms   arm length multiplier
   head      head size multiplier                               neck   neck length multiplier
   child     0..1 child proportions on top of the above (bigger head, shorter neck/limbs, softer waist, no bust)
   hair      'cap' (swim cap) | 'short' | 'bun' | 'ponytail'    (bare hair uses the hair mask / SWIM_LOOK colour)
   suit      'striped' one-piece | 'plain' one-piece | 'twopiece' (sporty crop top + bottoms) | 'trunks' (bare torso, swim trunks)
*/
const SWIM_BODY_DEFAULT={name:'reference',height:1.704,build:0.5,shoulders:1,bust:0.5,waist:1,hips:1,legs:1,arms:1,head:1,neck:1,child:0,hair:'cap',suit:'striped'};
const BODIES=[
  {name:'average',   height:1.68,build:0.55,shoulders:1.00,bust:0.50,waist:1.00,hips:1.04,legs:1.00,arms:1.00,head:1.00,neck:1.00,hair:'cap',     suit:'striped'},
  {name:'slim_tall', height:1.84,build:0.15,shoulders:1.00,bust:0.30,waist:0.92,hips:0.94,legs:1.07,arms:1.05,head:0.96,neck:1.12,hair:'ponytail',suit:'striped'},
  {name:'curvy',     height:1.66,build:0.62,shoulders:1.00,bust:0.80,waist:0.88,hips:1.22,legs:0.98,arms:1.00,head:1.00,neck:0.98,hair:'bun',     suit:'plain'},
  {name:'stocky',    height:1.60,build:0.85,shoulders:1.10,bust:0.55,waist:1.18,hips:1.08,legs:0.91,arms:0.96,head:1.02,neck:0.82,hair:'cap',     suit:'plain'},
  {name:'athletic',  height:1.76,build:0.55,shoulders:1.24,bust:0.35,waist:0.92,hips:0.96,legs:1.04,arms:1.04,head:0.98,neck:1.00,hair:'ponytail',suit:'twopiece'},
  {name:'petite',    height:1.52,build:0.35,shoulders:0.94,bust:0.45,waist:0.95,hips:1.00,legs:0.97,arms:0.98,head:1.05,neck:0.95,hair:'bun',     suit:'striped'},
  {name:'plus_size', height:1.65,build:1.00,shoulders:1.06,bust:0.85,waist:1.28,hips:1.22,legs:0.95,arms:0.98,head:1.02,neck:0.82,hair:'short',   suit:'plain'},
  {name:'masc_average',height:1.77,build:0.50,shoulders:1.20,bust:0.12,waist:1.10,hips:0.88,legs:1.00,arms:1.04,head:1.00,neck:1.00,hair:'short', suit:'trunks'},
  {name:'masc_broad',height:1.87,build:0.85,shoulders:1.36,bust:0.18,waist:1.16,hips:0.94,legs:0.98,arms:0.97,head:1.00,neck:0.92,hair:'short',   suit:'trunks'},
  {name:'child',     height:1.25,build:0.45,shoulders:0.92,bust:0.00,waist:1.00,hips:0.95,legs:0.96,arms:0.97,head:1.04,neck:1.00,child:1,hair:'ponytail',suit:'striped'}
];
// Picks a preset (uniform, or weights[] if given) and jitters a few parameters a little.
// Returns {id, name, body, scale}. For instanced rendering use the cached mesh of BODIES[id] and multiply the
// instance matrix (and the seat offset) by `scale` (the height jitter); `body` is the fully jittered descriptor for
// one-off meshes (it would be a new mesh per rider if built directly).
function pickBody(rnd,weights){let id=0;
  if(weights){let t=0;for(const w of weights)t+=w;let r=rnd()*t;while(id<BODIES.length-1&&r>=weights[id]){r-=weights[id];id++;}}
  else id=Math.min(BODIES.length-1,Math.floor(rnd()*BODIES.length));
  const B=BODIES[id],j=a=>(rnd()*2-1)*a,cl=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const scale=1+j(0.03);
  const body=Object.assign({},B,{height:B.height*scale,build:cl(B.build+j(0.06),0,1),shoulders:B.shoulders*(1+j(0.03)),
    hips:B.hips*(1+j(0.03)),waist:B.waist*(1+j(0.03)),bust:B.bust>0.15?cl(B.bust+j(0.06),0,1):B.bust,legs:B.legs*(1+j(0.02))});
  return {id,name:B.name,body,scale};}

function swimmerGB(pose,body){
  pose=(pose|0)%4;const g=new GB();
  const Bd=Object.assign({},SWIM_BODY_DEFAULT,body||{});
  const SK=SWIM_SKIN[0],RED=PALETTES[0].a,WHT=PALETTES[0].b,HAIRC=SWIM_HAIR[0];
  const M_SKIN=0,M_HAIR=0.125,M_CAP=0.25,M_B=0.5,M_STRAP=0.75,M_A=1;
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const nrm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l];};
  const lerp=(a,b,t)=>a+(b-a)*t;
  /* ---- derived proportions (unit space = the 1.70 m reference; uniform scale SC applied at emission) ---- */
  const ch=Math.max(0,Math.min(1,Bd.child||0));
  const bld=Math.max(0,Math.min(1,Bd.build));
  const bw=1+(bld-0.5)*0.5;                  // torso width
  const bdp=1+(bld-0.5)*0.55;                // torso depth
  const lr=1+(bld-0.5)*0.6;                  // limb radius
  const belly=Math.max(0,bld-0.6)*0.05;      // forward belly at the waist
  const hsz=Bd.head*(1+0.55*ch);             // head scale
  const legL=Bd.legs*(1-0.12*ch),armL=Bd.arms*(1-0.08*ch),neckL=Bd.neck*(1-0.35*ch);
  const shW=Bd.shoulders*(1-0.06*ch),hipW=Bd.hips,waistW=lerp(Bd.waist,(Bd.hips+Bd.waist)*0.55,ch);
  const bust=Bd.bust*(1-ch);
  const chestW=bw*(0.55+0.45*shW);
  const suit=Bd.suit,hair=Bd.hair;
  const fsz=(1+(lr-1)*0.4)*(1-0.06*ch);      // feet / hands
  const pivY=0.50+0.08*neckL;                // head pivot (top of neck), torso-local
  const legRaw=0.79*legL+0.075*fsz,headTop=pivY+0.26*hsz;
  const SC=Bd.height/(legRaw+headTop);       // uniform scale to the requested height
  // outward-facing triangle (winding flipped so the normal points away from interior point ref), scaled at emission
  const T=(a,b,c,col,m,ref)=>{const n=cross(sub(b,a),sub(c,a));const cen=mul(add(add(a,b),c),1/3);if(dot(n,sub(cen,ref))<0){const t=b;b=c;c=t;}
    g.tri(mul(a,SC),mul(b,SC),mul(c,SC),col,m,m,m);};
  const Q=(a,b,c,d,col,m,ref)=>{T(a,b,c,col,m,ref);T(a,c,d,col,m,ref);};
  const PS=[
    {lean:0,head:0,thigh:[-0.03,-1,0.02],shin:[-0.03,-1,-0.03],ff:[0.05,0,1],fu:[0,1,0],
     ua:[1,-0.08,0],fa:[1,-0.06,0],hu:[0,1,0],pony:[0,-1,-0.12]},
    {lean:0.32,head:-0.1,thigh:[0.13,-0.06,1],shin:[0.08,-0.03,1],ff:[0.1,1,0.3],fu:[0,0,-1],
     ua:[0.42,1,0.12],fa:[0.22,1,0.2],hu:[0,0,-1],pony:[0,-1,-0.35]},
    {lean:1.38,head:0.55,thigh:[0.07,-0.04,1],shin:[0.03,0.02,1],ff:[0.12,1,0.2],fu:[0,0,-1],
     ua:[0.75,0.55,0.18],tgt:true,hu:[0,0,-1],pony:[0,-0.6,-1]},
    {lean:-Math.PI/2,head:-0.15,thigh:[-0.02,0,-1],shin:[-0.01,0.02,-1],ff:[0,-0.12,-1],fu:[0,-1,0],
     ua:[0.12,1,0.04],fa:[0.03,1,0.04],hu:[0,0,-1],pony:[0,0.06,-1]}
  ][pose];
  const cl=Math.cos(PS.lean),sl=Math.sin(PS.lean);
  const W=p=>[p[0],p[1]*cl+p[2]*sl,-p[1]*sl+p[2]*cl];       // torso-local -> pelvis space
  const Wd=W;
  // tube through pts with radii (radius 0 at the end = pointed tip), seg sides; frame from hint
  const tube=(pts,rad,seg,colf,m,hint)=>{let rings=[];for(let i=0;i<pts.length;i++){
      const t=nrm(sub(pts[Math.min(i+1,pts.length-1)],pts[Math.max(i-1,0)]));let u=sub(hint,mul(t,dot(hint,t)));u=nrm(u);const v=cross(t,u);
      const r=[];for(let k=0;k<seg;k++){const a=(k+0.5)/seg*Math.PI*2;r.push(add(pts[i],add(mul(u,Math.cos(a)*rad[i]),mul(v,Math.sin(a)*rad[i]))));}rings.push(r);}
    for(let i=0;i+1<rings.length;i++){const c=typeof colf==='function'?colf(i):[colf,m];
      for(let k=0;k<seg;k++){const k1=(k+1)%seg;const ref=mul(add(pts[i],pts[i+1]),0.5);
        if(rad[i+1]===0)T(rings[i][k],rings[i][k1],pts[i+1],c[0],c[1],ref);
        else Q(rings[i][k],rings[i][k1],rings[i+1][k1],rings[i+1][k],c[0],c[1],ref);}}};
  const wedge=(o,f,u,len,w0,w1,h0,h1,mid,col)=>{f=nrm(f);u=nrm(sub(u,mul(f,dot(u,f))));const s=cross(f,u);const P=[];
    for(let e=0;e<2;e++){const w=e?w1:w0,h=e?h1:h0,c=add(o,mul(f,e*len));for(let j=0;j<4;j++){const sx=(j&1)?1:-1,top=(j&2)?1:0;
      P.push(add(c,add(mul(s,sx*w/2),mul(u,mid?(top?h/2:-h/2):top*h))));}}
    const ref=add(o,add(mul(f,len*0.4),mul(u,mid?0:h0*0.3)));
    const F=[[0,1,3,2],[4,5,7,6],[0,1,5,4],[2,3,7,6],[0,2,6,4],[1,3,7,5]];for(const q of F)Q(P[q[0]],P[q[1]],P[q[2]],P[q[3]],col,0,ref);};

  /* ---- torso profile (torso-local: y up the spine, z = belly). rows [y, half-width, half-depth, z offset] ---- */
  const hipR=hipW*bw,waR=waistW*bw,shR=shW*(0.8+0.2*bw);
  const KEY=[[-0.05,0.125*hipR,0.085*bdp,0],[0,0.155*Math.pow(hipR,0.9),0.10*bdp,-0.012],[0.07,0.15*hipR,0.094*bdp,-0.006],
    [0.13,0.124*lerp(hipR,waR,0.45),0.08*bdp+belly*0.6,belly*0.4],[0.20,0.104*waR,0.072*bdp+belly,belly*0.8],
    [0.27,0.122*lerp(waR,chestW,0.5),0.08*bdp+belly*0.5,0.006+belly*0.4],[0.33,0.134*chestW,0.088*bdp,0.004],[0.38,0.138*chestW,0.09*bdp,0.008],
    [0.42,0.142*chestW,0.082*bdp,0.008],[0.465,0.168*shR,0.07*bdp,0],[0.50,0.10*(0.85+0.15*bw)*(1+0.1*ch),0.055*(0.85+0.15*bdp),0]];
  const prof=y=>{for(let i=0;i+1<KEY.length;i++){const A=KEY[i],B=KEY[i+1];if(y<=B[0]||i+2===KEY.length){const t=Math.max(0,Math.min(1,(y-A[0])/(B[0]-A[0])));
      return [A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t,A[3]+(B[3]-A[3])*t];}}};
  // bust / chest: front-only bulge around y 0.345, a bit more at the 45-degree vertices than at the centre line
  const bump=y=>Math.max(0,1-Math.abs(y-0.345)/0.075);
  const bulge=(y,ca)=>ca<0.3?0:bust*0.05*bump(y)*(ca>0.9?0.8:1);
  const NS=8;const ring=(y,cut)=>{const r=[];for(let k=0;k<NS;k++){const a=k/NS*Math.PI*2,sa=Math.sin(a),ca=Math.cos(a);
      const yy=y+(cut?cut*Math.abs(sa):0);const p=prof(yy);let z=p[1]*ca+p[2]+bulge(yy,ca);r.push([p[0]*sa,yy,z]);}return r;};
  const BND=[0.07,0.11,0.15,0.19,0.23,0.27,0.31,0.35,0.42];
  const cut=suit==='trunks'?0.02:suit==='twopiece'?0.06:0.085;
  const rings=[ring(-0.045,cut)];for(const y of BND)rings.push(ring(y));rings.push(ring(0.465));rings.push(ring(0.50));
  const axis=y=>[0,y,prof(y)[2]];
  const band=i=>{const A=[RED,M_A],Bc=[WHT,M_B],S=[SK,M_SKIN];
    if(suit==='trunks')return i===0?A:i===1?Bc:S;
    if(suit==='twopiece')return i===0?A:i===1?Bc:i===6||i===8?A:i===7?Bc:S;
    if(i>=BND.length)return S;return suit==='plain'?A:(i%2?Bc:A);};
  for(let i=0;i+1<rings.length;i++){const [col,m]=band(i);
    for(let k=0;k<NS;k++){const k1=(k+1)%NS;const yc=(rings[i][k][1]+rings[i+1][k][1])*0.5;
      Q(W(rings[i][k]),W(rings[i][k1]),W(rings[i+1][k1]),W(rings[i+1][k]),col,m,W(axis(yc)));}}
  const crotch=suit==='trunks'?[0,-0.058,0]:[0,-0.08,0.005],top=[0,0.515,0];
  for(let k=0;k<NS;k++){const k1=(k+1)%NS;T(W(rings[0][k]),W(rings[0][k1]),W(crotch),RED,M_A,W([0,0.02,0]));
    T(W(rings[rings.length-1][k]),W(rings[rings.length-1][k1]),W(top),SK,M_SKIN,W([0,0.44,0]));}
  // straps (raised a few mm off the skin): front top edge -> over the shoulder -> back top edge
  if(suit!=='trunks'){
    const surf=(x,y,back)=>{const p=prof(y);const a=Math.asin(Math.max(-1,Math.min(1,x/p[0])));const ca=Math.cos(a);
      const z=back?-p[1]*ca+p[2]:p[1]*ca+p[2]+bulge(y,0.7);return [x,y,z+(back?-0.006:0.006)];};
    const ytop=suit==='twopiece'?0.42:0.40;
    for(const s of [-1,1]){const xc=s*0.082*chestW,hw=0.014;const path=[[ytop,0],[0.465,0],[0.505,0],[0.505,1],[0.465,1],[ytop,1]];
      const pts=path.map(([y,b],i)=>{const q=surf(xc,y,b);if(i===2||i===3){q[1]=0.512;q[2]=b?-0.02:0.02;}return q;});
      for(let i=0;i+1<pts.length;i++){const a=pts[i],b=pts[i+1];const ref=W([xc,(a[1]+b[1])/2-0.06,(a[2]+b[2])*0.3]);
        Q(W([a[0]-hw,a[1],a[2]]),W([a[0]+hw,a[1],a[2]]),W([b[0]+hw,b[1],b[2]]),W([b[0]-hw,b[1],b[2]]),RED,M_STRAP,ref);}}}
  /* ---- neck + head (head-local, scaled by hsz) ---- */
  const hp=PS.head,chh=Math.cos(hp),shh=Math.sin(hp),piv=[0,pivY,0.0];
  const HW=p=>{p=mul(p,hsz);const y=p[1],z=p[2];return W(add(piv,[p[0],y*chh-z*shh,y*shh+z*chh]));};
  const nr=(0.85+0.15*bw)*(1+1.2*Math.max(0,shW-1));
  tube([W([0,0.47,-0.005]),HW([0,0.06,0.0])],[0.04*nr,0.034*nr],5,SK,M_SKIN,Wd([0,0,1]));
  const HC=[0,0.125,0.012];
  const HR=[[0.10,0.062,0.072,-0.006],[0.05,0.08,0.096,-0.002],[-0.02,0.074,0.09,0.002],[-0.08,0.052,0.066,0.008]];
  const hr=HR.map(([y,rx,rz,zo],j)=>{const r=[];for(let k=0;k<8;k++){const a=k/8*Math.PI*2,sa=Math.sin(a),ca=Math.cos(a);
      let z=rz*ca+zo;if(ca>0.5&&k!==0)z-=0.012;
      if(k===0){if(j===2)z+=0.014;if(j===3)z+=0.004;}
      r.push([rx*sa*(j===3&&ca>0.5?0.8:1)*(1+0.04*ch),y,z]);}return r;});
  const htop=[0,0.135,-0.01],hchin=[0,-0.125+0.02*ch,0.03];
  const capCol=hair==='cap'?[RED,M_CAP]:[HAIRC,M_HAIR];
  const low=hair==='short'?0.012:0;  // short hair reaches a little lower at the back/sides
  const hcol=(a,b,c)=>{const cy=(a[1]+b[1]+c[1])/3,cz=(a[2]+b[2]+c[2])/3;const t=Math.max(0,Math.min(1,(0.09-cz)/0.18));return cy>0.065-0.13*t-low*t;};
  const HT=(a,b,c)=>{const cp=hcol(a,b,c);T(HW(add(HC,a)),HW(add(HC,b)),HW(add(HC,c)),cp?capCol[0]:SK,cp?capCol[1]:M_SKIN,HW(HC));};
  for(let k=0;k<8;k++){const k1=(k+1)%8;HT(hr[0][k],hr[0][k1],htop);HT(hr[3][k1],hr[3][k],hchin);
    for(let j=0;j<3;j++){HT(hr[j][k],hr[j][k1],hr[j+1][k1]);HT(hr[j][k],hr[j+1][k1],hr[j+1][k]);}}
  /* ---- legs (pelvis space); extra ring at 35% of the thigh = trunk-leg hem / thigh shaping ---- */
  const thR=lerp(1,lr,0.6)*(0.6+0.4*hipR);
  for(const s of [-1,1]){const mir=v=>[v[0]*s,v[1],v[2]];const H=[s*0.074*lerp(1,hipR,0.6),0,-0.006];
    const td=nrm(mir(PS.thigh)),sd=nrm(mir(PS.shin));const K=add(H,mul(td,0.40*legL)),A=add(K,mul(sd,0.39*legL)),C=add(K,mul(sd,0.11*legL)),Mt=add(H,mul(td,0.14*legL));
    tube([add(H,mul(td,-0.05)),Mt,K,C,A],[0.09*thR,0.076*thR,0.047*lr,0.053*lr,0.03*lr],5,
      i=>i===0&&suit==='trunks'?[RED,M_A]:[SK,M_SKIN],0,[-s,0,0]);
    const ff=nrm(mir(PS.ff)),fu=nrm(mir(PS.fu));const fuo=nrm(sub(fu,mul(ff,dot(fu,ff))));
    wedge(add(add(A,mul(fuo,-0.075*fsz)),mul(ff,-0.055*fsz)),ff,fu,0.21*fsz,0.06*fsz,0.07*fsz,0.095*fsz,0.026*fsz,false,SK);}
  /* ---- arms (torso-local, then W) ---- */
  const ar=lr*(0.5+0.5*shW);
  for(const s of [-1,1]){const mir=v=>[v[0]*s,v[1],v[2]];const S=[s*0.155*shR,0.455,-0.005];
    const ua=nrm(mir(PS.ua));const E=add(S,mul(ua,0.28*armL));
    const tg=PS.tgt?mir([0.02,pivY+0.14*hsz,-0.11*hsz]):null;
    const fa=tg?nrm(sub(tg,E)):nrm(mir(PS.fa));const Wr=add(E,mul(fa,0.25*armL));
    const hu=mir(PS.hu);
    tube([W(add(S,mul(ua,-0.02))),W(E),W(Wr)],[0.056*ar,0.036*ar,0.025*lr*(0.6+0.4*ar)],5,SK,M_SKIN,Wd(cross(ua,hu)));
    wedge(W(add(Wr,mul(fa,-0.02))),Wd(fa),Wd(hu),0.15*fsz*armL,0.055*fsz,0.045*fsz,0.026*fsz,0.014*fsz,true,SK);}
  /* ---- hair extras (bun / ponytail), kept above the lowest body point so g.seat stays the body's ---- */
  let mnB=1e9;for(let i=1;i<g.p.length;i+=3)if(g.p[i]<mnB)mnB=g.p[i];mnB/=SC;
  if(hair==='bun'){const ax=nrm([0,0.55,-0.85]),c0=add(HC,mul(ax,0.105));let c=HW(c0);const r=0.05*hsz;
    const axW=nrm(sub(HW(add(c0,ax)),c));if(c[1]-r<mnB)c=[c[0],mnB+r,c[2]];
    let u=nrm(cross(axW,[1,0,0]));if(!isFinite(u[0]))u=[0,1,0];const v=cross(axW,u);const n=6,pa=add(c,mul(axW,r*0.85)),pb=add(c,mul(axW,-r*0.6));
    const eq=[];for(let k=0;k<n;k++){const a=k/n*Math.PI*2;eq.push(add(c,add(mul(u,Math.cos(a)*r),mul(v,Math.sin(a)*r))));}
    for(let k=0;k<n;k++){const k1=(k+1)%n;T(eq[k],eq[k1],pa,HAIRC,M_HAIR,c);T(eq[k],eq[k1],pb,HAIRC,M_HAIR,c);}}
  if(hair==='ponytail'){const p0=HW(add(HC,[0,0.06,-0.05])),p1=HW(add(HC,[0,0.06,-0.105]));const d=nrm(PS.pony);
    const back=nrm(sub(p1,p0)),L=0.17*hsz*(1-0.2*ch);
    const p2=add(p1,mul(nrm(add(d,mul(back,0.3))),L*0.5)),p3=add(p2,mul(nrm(add(d,mul(back,0.05))),L*0.6));
    const rr=[0.026*hsz,0.034*hsz,0.03*hsz,0];const P=[p0,p1,p2,p3].map((p,i)=>p[1]-rr[i]<mnB+0.005?[p[0],mnB+0.005+rr[i],p[2]]:p);
    tube(P,rr,5,HAIRC,M_HAIR,[1,0,0]);}
  let mn=1e9,mx=-1e9;for(let i=1;i<g.p.length;i+=3){if(g.p[i]<mn)mn=g.p[i];if(g.p[i]>mx)mx=g.p[i];}
  g.seat=mn;g.top=mx;g.tris=g.p.length/9;g.body=Bd;
  return g;}
