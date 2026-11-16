/**
 * Breath and Blood — settings. Registered unconditionally (the contract), read
 * at call time so a change applies on the next roll without a reload.
 *
 * Importable under plain Node: `game` is only reached inside functions.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { CHOICES, SETTINGS } from "./constants.mjs";

export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, key);
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  try {
    return await game.settings.set(SUITE_ID, key, value);
  } catch (error) {
    warn(`breath-and-blood | could not write ${key}`, error);
    return undefined;
  }
}

const label = (key) => {
  const k = key.slice("bab.".length);
  return { name: `GLBAB.settings.${k}.name`, hint: `GLBAB.settings.${k}.hint` };
};

/** Every setting, as data: the check tool walks this to prove keys, labels and choices. */
export function settingDefs() {
  const world = { scope: "world", config: true, restricted: true };
  const choices = (k, list) => Object.fromEntries(list.map((v) => [v, `GLBAB.settings.${k}.choice.${v}`]));
  return [
    [SETTINGS.maxResolve, { ...world, ...label(SETTINGS.maxResolve), type: Number, default: 4, range: { min: 2, max: 6, step: 1 } }],
    [SETTINGS.resolveByLevel, { ...world, ...label(SETTINGS.resolveByLevel), type: Boolean, default: false }],
    [SETTINGS.havens, { ...world, ...label(SETTINGS.havens), type: Boolean, default: false }],
    [SETTINGS.grimWounds, { ...world, ...label(SETTINGS.grimWounds), type: Boolean, default: false }],
    [SETTINGS.generousSupplies, { ...world, ...label(SETTINGS.generousSupplies), type: Boolean, default: false }],
    [SETTINGS.recurringRivals, { ...world, ...label(SETTINGS.recurringRivals), type: Boolean, default: false }],
    [SETTINGS.lingeringWounds, { ...world, ...label(SETTINGS.lingeringWounds), type: Boolean, default: false }],
    [SETTINGS.levelGroundDCs, { ...world, ...label(SETTINGS.levelGroundDCs), type: String, default: "auto", choices: choices("levelGroundDCs", CHOICES.levelGroundDCs) }],
    [SETTINGS.healingPrompt, { ...world, ...label(SETTINGS.healingPrompt), type: String, default: "unsure", choices: choices("healingPrompt", CHOICES.healingPrompt) }],
    [SETTINGS.redirectSystemActions, { ...world, ...label(SETTINGS.redirectSystemActions), type: Boolean, default: true }],
  ];
}

export function registerSettings(onChange = null) {
  for (const [key, def] of settingDefs()) {
    game.settings.register(SUITE_ID, key, onChange ? { ...def, onChange: () => onChange(key) } : def);
  }
}

/** The world's dials, read once per call. `suiteEnabled` answers for Level Ground. */
export function dials(suiteEnabled = () => false) {
  const lg = get(SETTINGS.levelGroundDCs, "auto");
  return {
    maxResolve: Number(get(SETTINGS.maxResolve, 4)) || 4,
    resolveByLevel: !!get(SETTINGS.resolveByLevel, false),
    havens: !!get(SETTINGS.havens, false),
    grimWounds: !!get(SETTINGS.grimWounds, false),
    generousSupplies: !!get(SETTINGS.generousSupplies, false),
    recurringRivals: !!get(SETTINGS.recurringRivals, false),
    lingeringWounds: !!get(SETTINGS.lingeringWounds, false),
    levelGround: lg === "on" || (lg === "auto" && !!suiteEnabled("level-ground")),
    healingPrompt: get(SETTINGS.healingPrompt, "unsure"),
    redirect: get(SETTINGS.redirectSystemActions, true) !== false,
  };
}
