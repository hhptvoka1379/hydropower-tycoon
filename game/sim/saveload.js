/* State hashing, deep clone, save objects, save validation and deterministic replay. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {newGame, step} from './engine.js';
import {applyAction} from './actions.js';

function hashState(st){const s=JSON.stringify(st);let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);}return ('00000000'+(h>>>0).toString(16)).slice(-8);}
function clone(o){return JSON.parse(JSON.stringify(o));}
function makeSave(st,log){return {schema:'hydropower-tycoon-save',version:1,init:st.init,day:st.day,state:clone(st),log:log?clone(log):[]};}
function validateSave(o){if(!o||typeof o!=='object')return 'Not a save object';if(o.schema!=='hydropower-tycoon-save')return 'Wrong schema';if(o.version!==1)return 'Unsupported version '+o.version;
  const s=o.state;if(!s||!Array.isArray(s.sites)||!s.sites.length)return 'Missing sites';if(typeof s.cash!=='number'||typeof s.tick!=='number'||!s.rng||!s.init)return 'Corrupt state';
  for(const x of s.sites){if(!x.upper||!x.lower||!x.dam||!Array.isArray(x.tiles)||x.tiles.length!==48)return 'Corrupt site';}return null;}
function replay(init,log,untilTick){const st=newGame(init);let i=0;while(true){while(i<log.length&&log[i].tick===st.tick){applyAction(st,log[i].a);i++;}if(st.tick>=untilTick)break;if(!st.started){if(i>=log.length)break;st.tick=log[i].tick;continue;}step(st);}return st;}

export {clone, hashState, makeSave, replay, validateSave};
