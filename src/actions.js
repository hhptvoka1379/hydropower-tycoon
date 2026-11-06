// Action types (§11.2). The engine validates and applies them at the start of the next step.
export const ACTION_TYPES = Object.freeze([
  'SET_SPEED', 'PAUSE', 'TURN_STEP', 'SET_FLOW', 'SET_MODE', 'SET_CURTAIL',
  'PLACE_DAM', 'RAISE_DAM', 'EXCAVATE', 'BUILD', 'REPLACE_PENSTOCK', 'CLEAN_ARRAY',
  'REPAIR', 'BUY_PERMIT', 'BUY_SITE', 'TAKE_LOAN', 'REPAY_LOAN', 'SIGN_CONTRACT',
  'SET_RESERVE_OFFER', 'SET_RULES', 'CLAIM_QUEST',
]);
export const A = Object.freeze(Object.fromEntries(ACTION_TYPES.map(t => [t, t])));

// Shape check only: the engine does the game validation (cash, credit, prerequisites).
export function validateActionShape(action) {
  if (!action || typeof action !== 'object') return { ok: false, reason: 'action must be an object' };
  if (!ACTION_TYPES.includes(action.type)) return { ok: false, reason: 'unknown action type: ' + action.type };
  return { ok: true };
}
