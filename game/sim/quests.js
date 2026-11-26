/* Quest list, quest completion checks and the win condition. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {addAlert} from './state.js';
import {CONFIG} from './config.js';
import {netWorth} from './economy.js';

const QUESTS=[
 {id:'q1',title:'First light',desc:'Generate 1 MWh of hydro energy.',reward:5000,ok:st=>st.stats.genMWh>=1},
 {id:'q2',title:'Uphill',desc:'Pump 20 000 m³ to the upper lake.',reward:5000,ok:st=>st.stats.pumpedM3>=20000},
 {id:'q3',title:'A good day',desc:'Finish a day with positive profit.',reward:6000,ok:st=>st.stats.profitDays>=1},
 {id:'q4',title:'Spotless',desc:'Clean a solar array.',reward:3000,ok:st=>st.stats.cleaned>=1},
 {id:'q5',title:'Wind catcher',desc:'Build a wind turbine.',reward:15000,ok:st=>st.stats.windBuilt>=1},
 {id:'q6',title:'Pocket storage',desc:'Build a battery.',reward:15000,ok:st=>st.stats.battBuilt>=1},
 {id:'q7',title:'On standby',desc:'Offer reserve capacity.',reward:4000,ok:st=>st.stats.reserveOffered>=1},
 {id:'q8',title:'Answer the call',desc:'Deliver a reserve call in full.',reward:10000,ok:st=>st.stats.callsOk>=1},
 {id:'q9',title:'Clockwork',desc:'Enable automation with at least two rules.',reward:5000,ok:st=>st.stats.rulesSet>=1},
 {id:'q10',title:'Bigger runner',desc:'Commission a Tier-2 turbine.',reward:20000,ok:st=>st.stats.t2t},
 {id:'q11',title:'Stronger pump',desc:'Commission a Tier-2 pump.',reward:20000,ok:st=>st.stats.t2p},
 {id:'q12',title:'Higher wall',desc:'Raise a dam.',reward:25000,ok:st=>st.stats.raised>=1},
 {id:'q13',title:'Deeper basin',desc:'Excavate the lower reservoir.',reward:20000,ok:st=>st.stats.excavated>=1},
 {id:'q14',title:'Handshake',desc:'Sign a supply contract.',reward:5000,ok:st=>st.stats.contractsSigned>=1},
 {id:'q15',title:'Kept promise',desc:'Deliver 24 contract hours in full.',reward:15000,ok:st=>st.contracts.fulfilledHours>=24},
 {id:'q16',title:'New valley',desc:'Buy a second site.',reward:40000,ok:st=>st.stats.sitesBought>=1},
 {id:'q17',title:'Paperwork',desc:'Buy a permit.',reward:5000,ok:st=>st.stats.permits>=1},
 {id:'q18',title:'Green day',desc:'Deliver 10 MWh of renewables in one day.',reward:15000,ok:st=>st.stats.renDayMax>=10||st.stats.renDayMWh>=10},
 {id:'q19',title:'Nest egg',desc:'Hold $750 000 in cash.',reward:20000,ok:st=>st.cash>=750000&&!st.demo},
 {id:'q20',title:'Full year',desc:'Keep the station running for 360 days.',reward:50000,ok:st=>st.day>=360}];
function checkQuests(st){for(const q of QUESTS){const r=st.quests[q.id];if(!r.done&&q.ok(st)){r.done=true;addAlert(st,'info','Quest complete: '+q.title+' — claim your reward.');}}
  if(!st.won&&!st.sandbox&&!st.demo){let c=0;for(const q of QUESTS)if(st.quests[q.id].claimed)c++;if(c>=CONFIG.win.quests&&netWorth(st)>=CONFIG.win.netWorth){st.won=true;addAlert(st,'info','You won! The valley runs itself now. Keep playing as long as you like.');}}}

export {QUESTS, checkQuests};
