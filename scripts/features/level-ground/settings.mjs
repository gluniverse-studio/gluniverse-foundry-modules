/**
 * Level Ground — settings.
 *
 * Every key begins with `lvg.`, the adapter's `settingPrefix`, so the catalog
 * routes each toggle into the feature's Control Center group. All toggles are
 * world-scoped and GM-only (`restricted`), on by default: a table that turns
 * the feature on plays the rules, and switches off what it does by hand.
 */

import { SETTINGS, SUITE_ID, TOGGLES } from "./constants.mjs";

/** Read a setting without throwing when it is not registered (a check tool, an early hook). */
export function get(key, fallback = undefined) {
  try {
    return game.settings.get(SUITE_ID, SETTINGS[key] ?? key);
  } catch {
    return fallback;
  }
}

export async function set(key, value) {
  try {
    return await game.settings.set(SUITE_ID, SETTINGS[key] ?? key, value);
  } catch (error) {
    console.warn("GLUniverse Suite | level-ground: could not write", key, error);
    return undefined;
  }
}

/** A toggle is on unless it was switched off (and reads as on when unregistered). */
export const on = (key) => get(key, true) !== false;

/** The registrations, as data: the check tool walks this list. */
export function settingDefinitions() {
  const defs = TOGGLES.map((name) => [
    SETTINGS[name],
    {
      name: `GLLVG.settings.${name}.name`,
      hint: `GLLVG.settings.${name}.hint`,
      scope: "world",
      config: true,
      restricted: true,
      type: Boolean,
      default: true,
    },
  ]);
  defs.push([
    SETTINGS.worksheet,
    { scope: "client", config: false, type: Object, default: {} },
  ]);
  return defs;
}

export function registerSettings() {
  for (const [key, def] of settingDefinitions()) {
    if (key === SETTINGS.threatStrip) {
      def.onChange = () => {
        try {
          ui.combat?.render?.();
        } catch {
          /* no tracker yet */
        }
      };
    }
    game.settings.register(SUITE_ID, key, def);
  }
}
