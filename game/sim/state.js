/* Shared state helpers (alert log). Extracted verbatim from legacy/v2.index.html createSimModule. */
import {CONFIG} from './config.js';

function addAlert(st,sev,msg,site){st.alertSeq++;st.alerts.unshift({id:st.alertSeq,day:st.day,hour:st.hour,sev,msg,site:site===undefined?-1:site});if(st.alerts.length>CONFIG.alertsMax)st.alerts.length=CONFIG.alertsMax;}

export {addAlert};
