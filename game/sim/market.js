/* Spot price model, grid emergencies, the hourly climate+market refresh and supply-contract offers. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';
import {climateAt, sunAt} from './climate.js';
import {hgauss, iint, rnd, snoise} from './rng.js';

function priceAt(seed,H,cl,emerg){ // §6.1 duck-curve spot price before own-dispatch impact
  const M=CONFIG.market;const h=cl.hour;const sun=sunAt(cl.doy,h+0.5);const sunF=(sun.Gc/1050)*(1-cl.cloud*0.8);
  const seaSun=0.5+0.5*cl.sea;
  let p=M.base+M.morning*hgauss(h,7.5,1.6)+M.evening*hgauss(h,19,2.0)-M.night*hgauss(h,3,2.5)-(M.dipBase+M.dipSun*seaSun)*sunF
    +M.noise*(snoise(seed,41,H/3)-0.5)*2+M.winter*Math.max(0,-cl.sea)+M.storm*cl.storm+8*cl.heat*hgauss(h,16,3);
  if(emerg)p*=M.emergMult;return p;
}
function emergActive(em,day,hour){return !!em&&em.day===day&&hour>=em.start&&hour<em.start+em.dur;}

function climateHour(st){
  const em=st.market.emergency;st.climate=climateAt(st.seed,st.H);
  const emerg=emergActive(em,st.day,st.hour);
  st.market.prev=st.market.price;st.market.base=priceAt(st.seed,st.H,st.climate,emerg);st.market.price=st.market.base;
  st.market.trend=st.market.price-st.market.prev;st.market.req=emerg?CONFIG.reserve.reqEmerg:CONFIG.reserve.reqBase;
  const fc=[];let d=st.day,hh=st.hour;for(let k=0;k<24;k++){const H=st.H+k;const cl=climateAt(st.seed,H);fc.push(priceAt(st.seed,H,cl,emergActive(em,d,hh)));hh++;if(hh>=24){hh=0;d++;}}
  st.market.forecast=fc;const sorted=fc.slice().sort((a,b)=>a-b);
  st.market.cheap=sorted[Math.max(0,Math.min(23,st.god.cheapHours-1))];st.market.peak=sorted[Math.max(0,Math.min(23,24-st.god.peakHours))];
}

function genContracts(st){const c=st.contracts;c.offers=[];
  const a=0.4+iint(rnd(st,'contracts')*10)/10;c.offers.push({id:'c'+c.nextId++,name:'Evening peak block',mw:a,h0:18,h1:21,days:20,premium:25,penalty:120,firm:true});
  const b=0.3+iint(rnd(st,'contracts')*8)/10;c.offers.push({id:'c'+c.nextId++,name:'Morning ramp support',mw:b,h0:6,h1:9,days:15,premium:18,penalty:100,firm:true});}

export {climateHour, emergActive, genContracts, priceAt};
