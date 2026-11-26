/* Seeded integer-hash streams and the small maths helpers used everywhere (no ambient randomness, no clock). Extracted verbatim from legacy/v2.index.html createSimModule. */
const PI=3.141592653589793, TAU=6.283185307179586, DEG=PI/180, LN10=2.302585092994046;
function clamp(x,a,b){return Math.min(b,Math.max(a,x));}
function absf(x){return Math.max(x,-x);}
function sstep(a,b,x){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
function hu(seed,a,b){let h=(seed|0)^Math.imul(a|0,0x27d4eb2d)^Math.imul((b|0)+0x165667b1,0x9e3779b1);h=Math.imul(h^(h>>>15),0x85ebca6b);h=Math.imul(h^(h>>>13),0xc2b2ae35);h^=h>>>16;return (h>>>0)/4294967296;}
function snoise(seed,salt,x){x+=100000;const i=x|0,f=x-i;const a=hu(seed,salt,i),b=hu(seed,salt,i+1);const w=(1-Math.cos(PI*f))*0.5;return a+(b-a)*w;}
function hgauss(h,m,s){let d=absf(h-m);d=Math.min(d,24-d);return Math.exp(-d*d/(2*s*s));}
function rnd(st,name){let x=st.rng[name]|0;if(x===0)x=0x6d2b79f5;x^=x<<13;x^=x>>>17;x^=x<<5;st.rng[name]=x|0;return (x>>>0)/4294967296;}
function iint(x){return x|0;}

export {DEG, LN10, PI, TAU, absf, clamp, hgauss, hu, iint, rnd, snoise, sstep};
