/* Hourly climate model, solar geometry, irradiance and the per-step weather update. Extracted verbatim from legacy/v2.index.html createSimModule. */
import {DEG, TAU, clamp, hu, iint, snoise} from './rng.js';
import {CONFIG} from './config.js';

function climateAt(seed,H){
  const day=iint(H/24),hour=H-day*24,doy=day-360*iint(day/360);
  const sea=Math.sin(TAU*(doy-45)/360);const aut=Math.max(0,Math.sin(TAU*(doy-135)/360));
  const heat=(sea>0.5&&snoise(seed,31,day/4)>0.68)?1:0;
  const storm=hu(seed,32,day)<0.045+0.05*aut?1:0;
  const T=10+11*sea+5*Math.sin(TAU*(hour-9)/24)+(snoise(seed,33,H/30)-0.5)*6+heat*7-storm*3;
  const cloud=clamp(snoise(seed,34,H/7)*0.9+0.08*(1-sea)+storm*0.6-heat*0.3,0,1);
  const rain=cloud>0.62?(cloud-0.62)*7*(1+storm*2.5):0;
  const wind=Math.max(0,2.2+6*snoise(seed,35,H/5)+0.75*(1-sea)+storm*13+(snoise(seed,37,H/1.5)-0.5)*2);
  const wdir=TAU*snoise(seed,36,H/20);
  return {day,hour,doy,sea,T,cloud,rain,wind,wdir,storm,heat};
}
function sunAt(doy,hr){ // §5.1 solar geometry; vector in world frame (x east, y up, z south)
  const lat=CONFIG.climate.lat*DEG;const dec=23.44*DEG*Math.sin(TAU*(doy-45)/360);const w=(hr-12)*15*DEG;
  const se=Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(w);
  const east=-Math.cos(dec)*Math.sin(w),north=Math.cos(lat)*Math.sin(dec)-Math.sin(lat)*Math.cos(dec)*Math.cos(w);
  return {se,x:east,y:se,z:-north,Gc:se>0?1050*Math.pow(se,1.15):0};
}
function irradiance(cl,sun){return sun.Gc*(1-0.72*Math.pow(cl.cloud,2.2))*(cl.storm?0.6:1);} // §5.2

function stepWeather(st,s,dt){ // weather → per-site derived quantities (§5)
  const cl=st.climate;const hr=st.hour+st.secInHour/3600;const sun=sunAt(st.doy,hr);
  const T=cl.T;const G=irradiance(cl,sun);s.tel.G=G;s.tel.Tamb=T;s.tel.Tc=T+(CONFIG.solar.noct-20)/800*G;s.tel.sun=sun;
  s.tel.windMul=0.9+0.25*hu(s.seed,5,1);s.tel.rain=cl.rain;
  // snow & snowpack (per site; river snowpack only on procedural sites)
  const rainMM=cl.rain*dt/3600;
  if(T<CONFIG.snow.tSnow){if(s.kind==='proc')s.snowpack+=rainMM;s.valleySnow+=rainMM;s.tel.snowing=cl.rain>0?1:0;}else s.tel.snowing=0;
  s.dayTsum+=T*dt;s.dayTn+=dt;s.dayRain+=rainMM;
}

export {climateAt, irradiance, stepWeather, sunAt};
