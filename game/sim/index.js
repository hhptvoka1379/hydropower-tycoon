/* Public entry: re-exports the Sim object (same public names as the legacy createSimModule return) and createGame. */
import {createGame} from './game.js';
import {CONFIG} from './config.js';
import {QUESTS} from './quests.js';
import {newGame, step} from './engine.js';
import {applyAction} from './actions.js';
import {buildCost, netWorth, omPerHour, quote} from './economy.js';
import {clsFor, crestLen, damCost, damQuote, makeProcSite, maxClassH, planDam, storageMWh, surveyInfo, tileRC} from './construction.js';
import {cBed, cW, cX, canyonParams, chokePoints, penstockRoute, riverW, terrainH} from './terrain.js';
import {bowlR, capL, capU, loPct, resArea, resLevel, resVol, upPct} from './reservoirs.js';
import {genPower, grossHead, hydraulics, pumpPower, reserveCap} from './hydraulics.js';
import {clone, hashState, makeSave, replay, validateSave} from './saveload.js';
import {forceCall, socAvg} from './plant.js';
import {climateAt, sunAt} from './climate.js';
import {godCtx, godPlan, godSiteProfit, renForecastMW} from './god.js';

const Sim={CONFIG,QUESTS,newGame,step,applyAction,quote,planDam,surveyInfo,chokePoints,canyonParams,terrainH,cX,cW,cBed,riverW,resVol,resLevel,resArea,bowlR,capU,capL,grossHead,genPower,pumpPower,hydraulics,reserveCap,hashState,clone,makeSave,validateSave,replay,forceCall,climateAt,sunAt,storageMWh,damCost,crestLen,tileRC,buildCost,netWorth,makeProcSite,damQuote,maxClassH,clsFor,penstockRoute,upPct,loPct,socAvg,omPerHour,godPlan,godCtx,godSiteProfit,renForecastMW};

export {Sim, createGame};
export default Sim;
