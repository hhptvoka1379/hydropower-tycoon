// Headless geometry check: node check.js
// Loads gb.js + swimmerGB3.js into one VM context and prints tri counts / seats / heights.
const fs=require('fs'),vm=require('vm'),path=require('path');
const code=[fs.readFileSync(path.join(__dirname,'gb.js'),'utf8'),
            fs.readFileSync(path.join(__dirname,'swimmerGB3.js'),'utf8'),
`const V2=[454,479,466,454,479,466,454,434,434];   // v2 tri counts for the same 9 adult presets
let bad=0;
const res=[];
function measure(pose,body){
  const g=swimmerGB(pose,body);
  let nan=0;for(const v of g.p)if(!isFinite(v))nan++;
  const lo=Math.min(...g.p), hi=Math.max(...g.p);
  return {tris:g.tris,seat:g.seat,top:g.top,nan,lo,hi};
}
for(let p=0;p<4;p++){const g=swimmerGB(p);res.push(['reference',p,g.tris,+g.seat.toFixed(3),+(g.top-g.seat).toFixed(3)]);}
BODIES.forEach((B,i)=>{
  for(let p=0;p<4;p++){
    const m=measure(p,B);
    res.push([B.name,p,m.tris,+m.seat.toFixed(3),+(m.top-m.seat).toFixed(3),m.nan]);
    if(m.nan)bad++;
  }
  const t=measure(0,B), h=t.top-t.seat, err=Math.abs(h-B.height);
  if(err>0.002){console.log('HEIGHT ERR',B.name,h.toFixed(4),B.height);bad++;}
  const a=measure(1,B), l=measure(2,B), d=measure(3,B);
  console.log(B.name.padEnd(13),'tris',String(t.tris).padStart(4),(t.tris/V2[i]).toFixed(2)+'x',
    ' h',h.toFixed(3),'err',(err*1000).toFixed(1)+'mm',' seat',[t.seat,a.seat,l.seat,d.seat].map(v=>v.toFixed(3)).join(' '),
    ' top',(t.top).toFixed(2));
});
let minR=9,maxR=0;for(let i=0;i<BODIES.length;i++){const r=measure(0,BODIES[i]).tris/V2[i];minR=Math.min(minR,r);maxR=Math.max(maxR,r);}
console.log('ratio range',minR.toFixed(2),'..',maxR.toFixed(2),' bad',bad);
if(bad)process.exitCode=1;
`].join('\n');
vm.runInNewContext(code,{console,Math,process});
