/* Automation rules engine: default rule slots, condition evaluation and rule selection. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {loPct, upPct} from './reservoirs.js';
import {socAvg} from './plant.js';

function defaultRules(){
  const r=[{on:true,pri:5,cond:'price_lt',val:35,cond2:'upper_lt',val2:95,act:'pump',flow:2.5},
    {on:true,pri:6,cond:'price_gt',val:85,cond2:'upper_gt',val2:8,act:'gen',flow:3},
    {on:false,pri:4,cond:'ren_gt',val:0.3,cond2:'upper_lt',val2:95,act:'pump_local',flow:2.5}];
  for(let i=r.length;i<8;i++)r.push({on:false,pri:1,cond:'always',val:0,cond2:'none',val2:0,act:'idle',flow:0});return r;}

function firmActive(st){for(const c of st.contracts.active)if(c.firm)return true;return false;}
function condOK(st,s,c,v){switch(c){case 'none':case 'always':return true;case 'price_lt':return st.market.price<v;case 'price_gt':return st.market.price>v;
  case 'upper_lt':return upPct(s)<v;case 'upper_gt':return upPct(s)>v;case 'lower_lt':return loPct(s)<v;case 'lower_gt':return loPct(s)>v;
  case 'hour_ge':return st.hour>=v;case 'hour_lt':return st.hour<v;case 'ren_gt':return s.tel.pRen/1e6>v;case 'soc_lt':return socAvg(s)*100<v;case 'soc_gt':return socAvg(s)*100>v;}return false;}
function evalRules(st,s){let best=null;for(const r of s.auto.rules){if(!r.on)continue;if(condOK(st,s,r.cond,r.val)&&condOK(st,s,r.cond2,r.val2)){if(!best||r.pri>best.pri)best=r;}}return best;}

export {defaultRules, evalRules, firmActive};
