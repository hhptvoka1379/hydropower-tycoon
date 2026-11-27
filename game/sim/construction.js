/* Site construction (classic/canyon), dam cost, build jobs and their completion, dam planning and survey quotes. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {absf, clamp, iint} from './rng.js';
import {SC, cBed, cW, cX, canyonParams, chokePoints, classicLayout, makeTP, penstockRoute, procLayout, routeLen, terrainH} from './terrain.js';
import {CONFIG} from './config.js';
import {defaultRules} from './rules.js';
import {capU, resLevel, resVol} from './reservoirs.js';
import {addAlert} from './state.js';
import {grossHead} from './hydraulics.js';

function emptyTiles(){const t=[];for(let i=0;i<48;i++)t.push({solar:null,wind:null,battery:null});return t;}
function tileRC(i){const p=iint(i/16);const k=i-p*16;const r=iint(k/4);return {p,r,c:k-r*4};}
function baseSite(id,name,kind,seed){
  return {id,name,kind,seed,bias:'balanced',river:'medium',station:0,tp:makeTP(seed^0x51ed),cp:null,layout:null,
    upper:{a1:0,a2:0,a3:0,bottom:0,V:0},lower:{a1:0,a2:0,a3:0,bottom:0,V:0,hMax:20,excav:0},
    dam:{cls:'earth',height:0,built:false,value:0,crack:null,raising:null,storm:false,stormSpill:false},
    penstock:{D:CONFIG.penstock.D0,mat:'steel',L:300,health:100,busy:false},
    turbine:{tier:0,health:100,busy:false},pump:{tier:0,health:100,busy:false},
    q:0,reqMode:'idle',flowSet:3,mode:'idle',auto:{enabled:false,rules:defaultRules()},
    tiles:emptyTiles(),parcels:[true,false,false],
    snowpack:0,valleySnow:0,riverStore:0,riverIn:0,riverOut:0,spillU:0,spillL:0,envQ:0,envDel:0,ice:0,coldDays:0,dayTsum:0,dayTn:0,dayRain:0,
    reserveOffer:0,call:null,curtailSolar:0,godMode:'idle',godFlow:0,godCurtail:0,plan:null,damPlan:null,
    tel:{Hg:0,Hn:0,hf:0,Q:0,v:0,Re:0,f:0,P:0,eta:0,pGen:0,pPump:0,pRen:0,pRenAvail:0,pBatt:0,pNet:0,sigma:0,sigmaC:0,cavT:9,npshA:0,npshR:0,cavP:9,G:0,Tc:0,hU:0,hL:0,pctU:0,pctL:0,evap:0,rain:0,windHub:0},
    acc:{eGen:0,ePump:0,eRen:0,eRenAvail:0,eBin:0,eBout:0,eNet:0,envUnmet:0,callE:0,qGenV:0,qPumpV:0},
    hist:[],yr:{eRen:0,capH:0},ledger:{transfer:0,riverIn:0,rainU:0,rainL:0,evapU:0,evapL:0,spillU:0,spillL:0,env:0,runoffU:0,runoffL:0}};
}
function makeClassicSite(seed){
  const C=CONFIG.classic;const s=baseSite(0,'Twin Tarns (Classic)','classic',seed);
  Object.assign(s.upper,{a1:C.upper.a1,a2:C.upper.a2,a3:0,bottom:C.upper.bottom});
  Object.assign(s.lower,{a1:C.lower.a1,a2:C.lower.a2,a3:0,bottom:C.lower.bottom,hMax:C.lower.hMax,excav:0});
  s.upper.V=resVol(s.upper,C.upper.h0);s.lower.V=resVol(s.lower,C.lower.h0);
  s.dam={cls:C.damCls,height:C.damH,built:true,value:damIntegral(s,0,C.damH),crack:null,raising:null,storm:false,stormSpill:false,crestLen:120};
  s.layout=classicLayout(s);s.penstock.L=CONFIG.penstock.classicL;s.envQ=C.envQ;s.maxDam=C.maxDam;s.route=penstockRoute(s);
  return s;
}
/* Procedural upper lake volume curve (A7): the water volume above the drawn terrain inside the valley corridor, measured once per (seed, bias, river, station)
   on a 5 m grid and stored as a table of m³ at the integer levels 0..N above the bed at the dam. The old closed form (V = a2·h² + a3·h³ from the choke-point width)
   was 20-45% off the terrain on most seeds; the table is exact at the nodes. The channel cut below the bed at the dam is dropped (V(0) = 0). Memoised: a pure function of its key. */
const LAKE_CACHE=new Map();
function calibrateLake(s){const P=CONFIG.proc,key=s.seed+'|'+s.bias+'|'+s.river+'|'+s.station;let tab=LAKE_CACHE.get(key);
  if(!tab){const N=P.lakeTabN,ds=P.lakeStep,half=P.lakeCorridor,bed=s.upper.bottom;const cnt=new Float64Array(N+2),sum=new Float64Array(N+2);
    const stub={kind:'proc',tp:s.tp,cp:s.cp,layout:null,sculpt:null};
    for(let z=-800;z<=s.station;z+=ds){const xc=cX(s.cp,z);for(let x=xc-half;x<=xc+half;x+=ds){const d=terrainH(stub,x,z)-bed;if(d>=N)continue;const j=Math.max(-1,Math.floor(d))+1;cnt[j]++;sum[j]+=d;}}
    tab=[];let C=0,S=0;const v=[];for(let k=0;k<=N;k++){C+=cnt[k];S+=sum[k];v.push(ds*ds*(k*C-S));}
    for(let k=0;k<=N;k++)tab.push(Math.round(v[k]-v[0]));
    for(let k=1;k<=N;k++)if(tab[k]<=tab[k-1])tab[k]=tab[k-1]+1;
    if(LAKE_CACHE.size>64)LAKE_CACHE.clear();LAKE_CACHE.set(key,tab);}
  return tab.slice();}
function makeProcSite(id,name,seed,bias,river,station,height){
  const P=CONFIG.proc;const s=baseSite(id,name,'proc',seed);s.bias=bias;s.river=river;s.cp=canyonParams(seed,bias,river);
  s.station=clamp(station,P.stationMin,P.stationMax);const cp=s.cp;const w=cW(cp,s.station);
  Object.assign(s.upper,{a1:0,a2:0,a3:0,bottom:cBed(cp,s.station)});s.upper.tab=calibrateLake(s);
  const zL=s.station+P.lowerOffset;
  Object.assign(s.lower,{a1:P.lowerA1,a2:P.lowerA2,a3:0,bottom:cBed(cp,zL)-P.lowerDrop,hMax:P.lowerHMax,excav:0});
  s.lower.V=resVol(s.lower,P.lowerH0);s.maxDam=P.maxDam;
  s.envQ=P.envFrac*P.baseFlow[river];s.riverStore=P.baseFlow[river]*P.riverK;
  if(height>0){const h=iint(height);s.dam={cls:h>32?(h>48?'arch':'gravity'):'earth',height:h,built:true,value:0,crack:null,raising:null,storm:false,stormSpill:false,crestLen:w+2*cp.m*h};
    s.dam.value=damIntegral(s,0,h);s.upper.V=resVol(s.upper,Math.max(0,h-CONFIG.res.freeboard))*0.6;}
  s.layout=procLayout(s);s.route=penstockRoute(s);s.penstock.L=routeLen(s.route)+20;
  return s;
}
/* Dam price (A3, decisions D5). Route-independent core: the exact integral of the marginal layer cost c(h) = cls(h) · crest(h) · (1 + h / crestFactor) over the layers that are
   actually added, with the class and the crest length of each layer (not of the final height). Premium and planning discount are applied on top of it by damPrice. */
function damGeom(s){return s.kind==='classic'?{w:120,m:0}:{w:cW(s.cp,s.station),m:s.cp.m};}
function damIntegral(s,h0,h1){
  if(!(h1>h0))return 0;const D=CONFIG.dam,g=damGeom(s),F=D.crestFactor;const cl=D.classes;
  const bounds=[0,cl.earth.max,cl.gravity.max,Infinity],names=['earth','gravity','arch'];let cost=0;
  const prim=(c,h)=>c*(g.w*h+(2*g.m+g.w/F)*h*h/2+(2*g.m/F)*h*h*h/3);
  for(let i=0;i<3;i++){const a=Math.max(h0,bounds[i]),b=Math.min(h1,bounds[i+1]);if(b>a)cost+=prim(cl[names[i]].costM2,b)-prim(cl[names[i]].costM2,a);}
  return cost*D.priceScale;}
function damCost(cls,h0,h1,crest){ // legacy flat form (one class, one crest length); the game prices walls with damIntegral / damPrice
  const c=CONFIG.dam.classes[cls].costM2,F=CONFIG.dam.crestFactor;return c*crest*((h1-h0)+(h1*h1-h0*h0)/(2*F))*CONFIG.dam.priceScale;}
function damPrice(st,s,plan,h0,h1){ // what buying the wall from h0 to h1 in ONE purchase costs: integral × (1 + premium) × (1 − planning discount)
  const D=CONFIG.dam;const base=damIntegral(s,h0,h1);const premium=D.premiumMax*clamp((h1-h0-D.premiumStart)/D.premiumSpan,0,1);
  let discount=0,stage=-1;
  if(plan&&st.day>=plan.declared+D.planLeadDays){const i=plan.stages.findIndex(x=>!x.done&&x.h===h1);if(i>=0){stage=i;discount=Math.min(D.planDiscountMax,D.planDiscountPer*plan.stages.length);}}
  return {base,premium,discount,stage,cost:base*(1+premium)*(1-discount)};}
function raiseQuote(st,si,meters){ // read-only: what RAISE_DAM would charge (and why it would be refused)
  const s=st.sites[si===undefined?st.active:si];const o={ok:false,reason:'',to:0,cost:0,base:0,premium:0,discount:0,stage:-1};if(!s||!s.dam.built){o.reason='No dam';return o;}
  const m=iint(meters||1);if(m<1){o.reason='Raise by at least 1 m';return o;}o.to=s.dam.height+m;
  if(o.to>s.maxDam){o.reason='The valley rim limits this site to '+s.maxDam+' m';return o;}
  const p=damPrice(st,s,s.damPlan,s.dam.height,o.to);Object.assign(o,p);o.ok=true;return o;}
function crestLen(s,h){return s.kind==='classic'?120:cW(s.cp,s.station)+2*s.cp.m*h;}

function refreshLayout(s){s.layout=s.kind==='classic'?classicLayout(s):procLayout(s);s.route=penstockRoute(s);} // A14a: layout, zone cache key and drawn route follow the dam height and the lower basin
function stepJobs(st,dt){
  for(let i=st.jobs.length-1;i>=0;i--){const j=st.jobs[i];j.rem-=dt;const s=st.sites[j.site];
    if(j.kind==='raise'&&s.dam.raising)s.dam.raising.progress=clamp(1-j.rem/j.total,0,1);
    if(j.rem<=0){st.jobs.splice(i,1);completeJob(st,j);}}
}
function completeJob(st,j){const s=st.sites[j.site];const p=j.p;
  if(st.god.enabled&&st.god.planner)st.god.stale=true; // equipment changed: replan at the next step
  switch(j.kind){
    case 'raise':s.dam.height=p.to;s.dam.cls=p.cls;s.dam.value+=p.value;s.dam.raising=null;s.dam.crestLen=crestLen(s,p.to);s.dam.crack=null;refreshLayout(s);addAlert(st,'info',s.name+': dam raised to '+p.to+' m.',j.site);break;
    case 'excavate':{const V=s.lower.V;s.lower.a1+=CONFIG.res.excavA;s.lower.excav++;s.lower.V=V;refreshLayout(s);addAlert(st,'info',s.name+': lower basin stage '+s.lower.excav+' excavated.',j.site);break;}
    case 'machine':s[p.unit].tier=p.tier;s[p.unit].health=100;s[p.unit].busy=false;if(p.tier>=1){if(p.unit==='turbine')st.stats.t2t=true;else st.stats.t2p=true;}addAlert(st,'info',s.name+': new '+CONFIG[p.unit][p.tier].name+' commissioned.',j.site);break;
    case 'repair':if(p.target==='wind'){const w=s.tiles[p.tile].wind;if(w){w.damaged=false;w.repairing=false;}}else if(p.target==='dam'){s.dam.crack=null;s.dam.repairing=false;}else{s[p.target].health=100;s[p.target].busy=false;}addAlert(st,'info',s.name+': '+p.target+' repair finished.',j.site);break;
    case 'penstock':s.penstock.D=p.D;s.penstock.mat=p.mat;s.penstock.health=100;s.penstock.busy=false;addAlert(st,'info',s.name+': new penstock in service.',j.site);break;
    case 'build':{const t=s.tiles[p.tile];if(t[p.kind])t[p.kind].building=false;addAlert(st,'info',s.name+': '+p.kind+' on tile '+(p.tile-16*tileRC(p.tile).p+1)+' online.',j.site);break;}
  }
}
function addJob(st,site,kind,hours,p){const sec=st.demo&&(kind==='raise'||kind==='excavate'||kind==='build')?0:hours*3600;const j={id:st.nextJob++,site,kind,rem:sec,total:Math.max(1,sec),p};
  if(sec<=0){completeJob(st,j);return j;}st.jobs.push(j);return j;}

function storageMWh(s,h){const V=resVol(s.upper,Math.max(0,h-CONFIG.res.freeboard))-resVol(s.upper,CONFIG.res.minOpU);const Hg=Math.max(1,(s.upper.bottom+h-CONFIG.res.freeboard)-(s.lower.bottom+resLevel(s.lower,s.lower.V)));
  return Math.max(0,V)*CONFIG.phys.rho*CONFIG.phys.g*Hg*CONFIG.turbine[s.turbine.tier].eta/3.6e9;}
function planDam(st,si,opt){ // §9.3 budget-limited or target-energy planning
  const s=st.sites[si];const h0=s.dam.height;const lim=Math.min(s.maxDam,maxClassH(st));let h=h0,cost=0;
  for(let hh=h0+1;hh<=lim;hh++){const c=damIntegral(s,hh-1,hh);const priced=(cost+c)*(1+CONFIG.dam.premiumMax*clamp((hh-h0-CONFIG.dam.premiumStart)/CONFIG.dam.premiumSpan,0,1));if(opt.budget!==undefined&&priced>opt.budget)break;cost+=c;h=hh;if(opt.target!==undefined&&storageMWh(s,hh)>=opt.target)break;}
  return {height:h,cost:cost*(1+CONFIG.dam.premiumMax*clamp((h-h0-CONFIG.dam.premiumStart)/CONFIG.dam.premiumSpan,0,1)),storage:storageMWh(s,h),capacity:resVol(s.upper,Math.max(0,h-CONFIG.res.freeboard)),limit:lim};}
function clsFor(h){return h<=CONFIG.dam.classes.earth.max?'earth':h<=CONFIG.dam.classes.gravity.max?'gravity':'arch';}
function maxClassH(st){if(st.demo)return CONFIG.dam.classes.arch.max;return st.permits.arch?CONFIG.dam.classes.arch.max:st.permits.gravity?CONFIG.dam.classes.gravity.max:CONFIG.dam.classes.earth.max;}
function surveyInfo(seed,bias,river,station,sc){const s=makeProcSite(0,'Survey',seed,bias,river,station,CONFIG.proc.damH0);if(sc)SC.apply(s,SC.norm(sc));const ch=chokePoints(s.cp);let near=null;for(const c of ch)if(absf(c.z-station)<=CONFIG.proc.chokeTol)near=c;
  return {ok:!!near,station:near?near.z:station,width:near?near.w:0,damCost:s.dam.value,capacity:capU(s),head:grossHead(s),raiseCost:damIntegral(s,CONFIG.proc.damH0,CONFIG.proc.damH0+1),storageMWh:storageMWh(s,CONFIG.proc.damH0),site:s,chokes:ch};}

function damQuote(st,si,station,h){ // what placing a dam of height h at a choke point would cost and give (read-only; mirrors PLACE_DAM)
  const s=st.sites[si];const o={ok:false,reason:'',station:null,width:0,h:0,cls:'earth',cost:0,base:0,premium:0,discount:0,capacity:0,storageMWh:0,head:0,limit:0,needPermit:null,permitCost:0,sameStation:false,maxAfford:0};
  if(!s||s.kind!=='proc'){o.reason='Dams can only be placed on canyon sites';return o;}if(s.dam.built){o.reason='This site already has a dam';return o;}
  const stn=station===undefined?s.station:+station;let near=null;for(const c of chokePoints(s.cp))if(absf(c.z-stn)<=CONFIG.proc.chokeTol)near=c;if(!near){o.reason='Pick a permitted canyon choke point';return o;}
  o.limit=Math.min(s.maxDam,maxClassH(st));o.station=near.z;o.width=near.w;o.sameStation=near.z===s.station;
  {const g={kind:'proc',cp:s.cp,station:near.z};for(let k=5;k<=o.limit;k++){if(!st.demo&&damPrice(st,g,s.damPlan,0,k).cost>st.cash)break;o.maxAfford=k;}} // tallest wall the cash covers (cost rises with height)
  const hh=clamp(iint(h||CONFIG.proc.damH0),5,s.maxDam);o.h=hh;o.cls=clsFor(hh);
  const tmp=makeProcSite(s.id,s.name,s.seed,s.bias,s.river,near.z,hh);const pr=damPrice(st,tmp,s.damPlan,0,hh);o.cost=pr.cost;o.base=pr.base;o.premium=pr.premium;o.discount=pr.discount;o.capacity=capU(tmp);
  const low=o.sameStation?s.lower:tmp.lower;o.storageMWh=storageMWh({upper:tmp.upper,lower:low,turbine:s.turbine},hh);o.head=(tmp.upper.bottom+hh-CONFIG.res.freeboard)-(low.bottom+resLevel(low,low.V));
  if(hh>maxClassH(st)){o.needPermit=o.cls;o.permitCost=CONFIG.dam.classes[o.cls].permit;o.reason='Needs the '+CONFIG.dam.classes[o.cls].name+' permit';}else o.ok=true;
  return o;}

export {addJob, clsFor, crestLen, damCost, damIntegral, damPrice, damQuote, makeClassicSite, makeProcSite, maxClassH, planDam, raiseQuote, refreshLayout, stepJobs, storageMWh, surveyInfo, tileRC};
