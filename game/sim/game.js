/* Headless Game wrapper: newGame/dispatch/getSnapshot/makeSave/loadSave/runHeadless/hash with the same behaviour as the legacy
   `Game` object (legacy/v2.index.html), minus everything that touched the DOM, renderer, UI, toast or the wall clock.
   The legacy snapshot was throttled to once per 50 ms using the wall clock; here a snapshot is rebuilt whenever the state is dirty. */
import {applyAction} from './actions.js';
import {newGame as simNewGame, step} from './engine.js';
import {clone, hashState, makeSave, validateSave} from './saveload.js';

function deepFreeze(o){Object.freeze(o);for(const k in o){const v=o[k];if(v&&typeof v==='object'&&!Object.isFrozen(v))deepFreeze(v);}return o;}

export function createGame(){
  const Engine={state:null,log:[],snap:null,dirty:true,error:null};
  const Game={
    getSnapshot(){if(!Engine.state)return null;if(!Engine.snap||Engine.dirty){Engine.snap=deepFreeze(clone(Engine.state));Engine.dirty=false;}return Engine.snap;},
    dispatch(a){if(!Engine.state)return {ok:false,reason:'No game loaded'};let r;try{r=applyAction(Engine.state,a);}catch(e){Engine.error=e;return {ok:false,reason:'Internal error'};}
      if(r.ok){Engine.log.push({tick:Engine.state.tick,a:JSON.parse(JSON.stringify(a))});}
      Engine.dirty=true;return r;},
    newGame(o){Engine.state=simNewGame(o);Engine.log=[];Engine.error=null;Engine.dirty=true;this.dispatch({type:'SET_RULES',enabled:true});
      return Engine.state.init;},
    makeSave(){return makeSave(Engine.state,Engine.log);},
    loadSave(obj){const err=validateSave(obj);if(err)return {ok:false,reason:err};Engine.state=clone(obj.state);Engine.state.paused=true;Engine.log=Array.isArray(obj.log)?obj.log:[];Engine.error=null;Engine.dirty=true;return {ok:true};},
    runHeadless(steps){for(let i=0;i<steps;i++)step(Engine.state);Engine.dirty=true;return hashState(Engine.state);},
    hash(){return Engine.state?hashState(Engine.state):null;},
    /* headless extras (not in the legacy object): live state and action log for tests and tools */
    get state(){return Engine.state;},
    get log(){return Engine.log;},
    get error(){return Engine.error;}
  };
  return Game;
}
