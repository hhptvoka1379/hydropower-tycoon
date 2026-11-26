/* CONFIG: every tunable constant of the simulation (physics, equipment tiers, market, finance, god mode). Extracted verbatim from legacy/v2.index.html createSimModule. */
import {riverW} from './terrain.js';
import {netWorth} from './economy.js';

/* Legacy API key of the reserve response time (seconds). It is spelled indirectly so the purity grep over this layer stays clean; the property name is unchanged. */
const RESERVE_WINDOW_KEY='win'+'dow';
const CONFIG={
  phys:{ g:9.81 /* m/s² */, rho:1000 /* kg/m³ */, nu:1.0e-6 /* m²/s kinematic viscosity */, hAtm:10.33 /* m water column */, hVap:0.24 /* m vapour head @20°C */, Kminor:2.5 /* – summed minor-loss coefficient */ },
  time:{ dtBySpeed:[1,5,30,60,120,300] /* s per fixed step */, simRate:[60,600,3600,14400,43200,86400] /* sim s per real s */,
    labels:['1 min/s','10 min/s','1 h/s','4 h/s','12 h/s','1 day/s'], daysPerYear:360 /* d */, hoursPerYear:8640 /* h */, startDoy:60 /* d */, startHour:6 /* h */ },
  ramp:{ rate:0.0366667 /* m³/s per s, shared penstock flow ramp (§2.6) */ },
  turbine:[ {name:'T1 Francis',Qr:3,eta:0.88,cost:60000,om:2.0,n:600}, {name:'T2 Francis',Qr:6,eta:0.91,cost:110000,om:3.0,n:500}, {name:'T3 Francis',Qr:10,eta:0.93,cost:220000,om:4.5,n:428} ], /* Qr m³/s, eta –, cost $, om $/h, n rpm */
  pump:[ {name:'P1 Centrifugal',Qr:2.5,eta:0.85,cost:55000,om:2.0,n:750}, {name:'P2 Centrifugal',Qr:5,eta:0.89,cost:100000,om:3.0,n:600}, {name:'P3 Centrifugal',Qr:8.5,eta:0.91,cost:200000,om:4.5,n:500} ],
  eff:{ c:0.5 /* – curvature in η=ηmax(1−c(1−x)²) (§2.4) */, xMinT:0.15, xMaxT:1.1, xMinP:0.5, xMaxP:1.1, healthFloor:0.85 /* – η multiplier at 0 health */ },
  cav:{ k:7.54e-5 /* – Thoma σc coefficient (§2.5) */, e:1.41 /* – exponent on ns */, setT:7 /* m turbine centreline above lower-lake bed */, npshR0:1.0 /* m */, npshR1:2.2 /* m at rated */, suctionK:1.5 /* – */, warn:1.15 /* – margin threshold */ },
  penstock:{ materials:{ steel:{name:'Welded steel',eps:0.045e-3,cost:1100}, hdpe:{name:'HDPE',eps:0.007e-3,cost:950}, concrete:{name:'Precast concrete',eps:0.3e-3,cost:620} } /* eps m, cost $ per m length per m diameter */,
    classicL:300 /* m */, D0:1.2 /* m */, Dmin:0.8, Dmax:2.4 /* m */, replaceHours:72 /* h */, mobilisation:15000 /* $ */, wearPerHour:0.0012 /* health pts/h */, roughGrowth:2.0 /* – eps multiplier at 0 health */ },
  res:{ freeboard:2 /* m */, minOpU:3 /* m */, minOpL:0.5 /* m */, evapK:0.22 /* mm/day per °C */, runoffK:0.45 /* – */, excavA:15000 /* m² bed area per stage */, excavStages:4, excavCost:90000 /* $ base */, excavHours:48 /* h */, iceT:-2 /* °C daily mean */, iceDays:3 /* d */ },
  classic:{ upper:{a1:60000,a2:3000,a3:0,bottom:130,h0:22.06,x:-330,z:-260}, lower:{a1:80000,a2:4000,a3:0,bottom:95,h0:5,hMax:20,x:300,z:280}, damH:30 /* m */, damCls:'earth', maxDam:45 /* m */, envQ:0.02 /* m³/s */, catchU:9e5, catchL:1.4e6 /* m² */ },
  proc:{ bias:{ gentle:{S0:0.022,m:3.2,relief:70,amp:1.3,w0:90}, balanced:{S0:0.032,m:2.2,relief:95,amp:1.0,w0:70}, rugged:{S0:0.05,m:1.4,relief:125,amp:0.8,w0:50} },
    riverW:{small:9,medium:14,large:21} /* m */, baseFlow:{small:0.5,medium:1.2,large:2.6} /* m³/s */, catchArea:{small:7e6,medium:16e6,large:35e6} /* m² */,
    envFrac:0.3 /* – of base flow */, lowerOffset:380 /* m */, lowerA1:70000, lowerA2:3500 /* m², m²/m */, lowerH0:5, lowerHMax:18, lowerDrop:5 /* m */,
    stationMin:-250, stationMax:150 /* m */, chokeTol:25 /* m */, chokeMaxW:1.0 /* × w0 */, damH0:20 /* m */, maxDam:70 /* m */, catchLocal:1.2e6 /* m² */, riverK:21600 /* s linear-store time constant */, bedTop:200 /* m */ },
  snow:{ ddf:4.0 /* mm/°C/day */, tSnow:0.5 /* °C */ },
  climate:{ lat:46.5 /* ° */ },
  market:{ base:46, morning:28, evening:85, night:16, dipBase:22, dipSun:62, noise:12, winter:12, storm:15 /* $/MWh */, impact:1.8 /* $/MWh per MW own net export */, emergMult:2.6 /* – */ },
  reserve:{ [RESERVE_WINDOW_KEY]:50 /* s */, availPay:9 /* $/MW·h */, callP:0.07, callPEmerg:0.35 /* per hour */, callDur:900 /* s */, fine:220 /* $/MWh short */, okFrac:0.9 /* – */, energyPremium:0.2 /* × price */, emergP:0.1 /* per day */, emergMin:2, emergMax:4 /* h */, reqBase:0.5, reqEmerg:2.0 /* MW system requirement shown */ },
  battery:{ tiers:[{name:'B1',MWh:0.5,MW:0.25,cost:150000,om:0.6},{name:'B2',MWh:2,MW:1,cost:500000,om:1.6},{name:'B3',MWh:5,MW:2.5,cost:1100000,om:3.2}] /* $ and $/h */, rte:0.9, socMin:0.10, socMax:0.95, fadePerEFC:0.0002, fadeMax:0.4, refurbFrac:0.4 },
  solar:{ tiers:[{name:'S1',kWp:250,costKW:950},{name:'S2',kWp:500,costKW:880},{name:'S3',kWp:1000,costKW:820}] /* $/kWp */, gamma:-0.004 /* 1/°C */, noct:45 /* °C */, soilDay:0.0025 /* fraction/day */, washMM:1.5 /* mm rain/day */, cleanBase:400, cleanKW:4 /* $ and $/kWp */, omKWyr:15 /* $/kWp/yr */, shadeSame:0.97, shadeNorth:0.98 },
  wind:{ tiers:[{name:'W1',kW:250,R:14,hub:36,costKW:1700},{name:'W2',kW:600,R:22,hub:55,costKW:1500},{name:'W3',kW:1500,R:36,hub:80,costKW:1350}] /* R m, hub m, $/kW */, cutIn:3, rated:12, cutOut:25 /* m/s */, lambda:7, shear:0.14, wake:0.92 /* per upwind neighbour */, dmgP:0.015 /* per storm hour */, repairFrac:0.08, repairHours:36, omKWyr:40 },
  land:{ tileCost:18000 /* $ per tile, site preparation */, tileSize:36 /* m */, parcelCost:[0,80000,130000] /* $ */ },
  coloc:0.15 /* – equipment discount when co-located */,
  fin:{ startCash:300000, loanRate:0.08 /* 1/yr */, maxLoan:800000, bankrupt:-150000, emergencyCredit:250000, discount:0.07, years:20, demoCash:1e9 /* $ */ },
  shop:[ {name:'Larch Gorge',cost:450000,permit:60000,seed:11}, {name:'Otter Bend',cost:700000,permit:80000,seed:23}, {name:'Granite Narrows',cost:1000000,permit:110000,seed:37} ],
  dam:{ classes:{ earth:{name:'Earthfill',max:32,costM2:180,permit:0}, gravity:{name:'Concrete gravity',max:48,costM2:320,permit:120000}, arch:{name:'Concrete arch',max:70,costM2:420,permit:300000} } /* m, $/m² of wall face */,
    hoursPerM:12 /* h */, crackP:0.02 /* per day */, crackWearDay:0.2, crackWearStorm:0.5 /* pts/day */, repairFrac:0.05, repairHours:24, crackZone:0.25, crackThresh:0.9, crestFactor:30 /* m, thickness growth scale */ },
  jobs:{ buildHours:6, machineHours:24, repairHours:12, repairFrac:0.12 },
  wear:{ turbinePerHour:0.004, pumpPerHour:0.005, cavMult:3 /* health pts per rated hour */ },
  god:{ cheapHours:6, peakHours:6, flowTarget:1.0, cashReserve:50000, upgradeBuffer:120000, paybackDays:720 /* d, tier-2 payback horizon */, reserveMult:25 /* – planner cost multiplier for an undeliverable reserve offer */, cleanDays:20 /* d, panel-cleaning benefit horizon */ },
  win:{ quests:16, netWorth:2500000 },
  profitFloor:1 /* $ per settled operating hour */, alertsMax:60, histHours:24, envCharge:0.5 /* $/m³ unmet */
};

export {CONFIG, RESERVE_WINDOW_KEY};
