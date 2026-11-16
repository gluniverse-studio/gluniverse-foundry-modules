/**
 * Breath and Blood — the pools, set during actor preparation, and drained.
 *
 * pf2e 8.7.0's Stamina variant already splits a character
 * (`CharacterPF2e#prepareDerivedData`): `hp.sp.max = (floor(classhp/2) + con) *
 * level`, half the class Hit Points into `hp.max`, and `resources.resolve.max =`
 * the key attribute modifier. After the wrapped `prepareData` returns we:
 *
 *   - raise `hp.sp.max` to at least the level (1 SP per level);
 *   - set `resources.resolve.max` to the rules' maximum, which pf2e's update
 *     clamp (`_preUpdate`) and its rest both read back;
 *   - re-split drained: pf2e's drained condition puts a status FlatModifier of
 *     `min(-level, -1) * value` on `hp`, so the maximum it removed is read off
 *     that modifier and moved to Stamina Points first;
 *   - split a companion or rival in half (floor(H / 2) to SP).
 *
 * NPCs and familiars marked as companions (or rivals) are split the same way;
 * their current SP and RP live in flags (`actor.mjs`).
 *
 * Drained's current values: its `LoseHitPoints` rule element takes the whole
 * loss from `hp.value`, in `onCreate` (inside the creating client's own actor
 * update, after `actor.reset()`) and in `preUpdate` (on the updating client,
 * before the hook runs). Both are wrapped, so the correction happens once, in
 * the same write pf2e makes, on the client that made the change.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import { PREP, bab, flagPath, isCharacter, poolActor, roleOf, spPath, staminaOn, usesFlagPools } from "./actor.mjs";
import { FLAG } from "./constants.mjs";
import { damage, drainedRise, drainedSplit, maxResolveFor, raiseStaminaToMinimum } from "./rules.mjs";

const int = (v, d = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : d;
};

/** Hit Points pf2e's drained modifier removed from `hp.max` (0 without drained). */
export function drainedLoss(hp) {
  const mods = hp?.modifiers ?? hp?._modifiers ?? [];
  let loss = 0;
  for (const m of mods) {
    if (m?.slug === "drained" && m.enabled !== false && !m.ignored && Number(m.modifier) < 0) loss += -Number(m.modifier);
  }
  return Math.trunc(loss);
}

/**
 * The pools of one prepared actor, or null when it has one pool. Pure over the
 * values it is given, so the check tool can drive it with fixtures.
 *   { type, role, level, hpMax, systemSP, drainLoss, dials }
 */
export function derivePools({ type, role, level, hpMax, systemSP, drainLoss, dials }) {
  if (role === "onePool") return null;
  const loss = Math.max(0, int(drainLoss));
  let baseSP;
  let baseHP;
  if (type === "character" && role === "twoPools") {
    baseSP = raiseStaminaToMinimum(systemSP, level);
    baseHP = int(hpMax) + loss;
  } else {
    const H = int(hpMax) + loss + (type === "character" ? Math.max(0, int(systemSP)) : 0);
    baseSP = Math.floor(H / 2);
    baseHP = H - baseSP;
  }
  const split = drainedSplit({ baseSP, baseHP, loss });
  return {
    twoPool: true,
    role,
    maxSP: split.maxSP,
    maxHP: split.maxHP,
    maxRP: maxResolveFor({ role, level, maxResolve: dials.maxResolve, resolveByLevel: dials.resolveByLevel }),
    baseSP,
    baseHP,
    drainLoss: loss,
  };
}

let _dials = () => ({ maxResolve: 4, resolveByLevel: false, recurringRivals: false });
let _active = () => false;

/** Apply the pools to a prepared actor's derived data. */
export function applyPools(actor) {
  if (!_active() || !staminaOn()) {
    PREP.delete(actor);
    return;
  }
  const dials = _dials();
  const role = roleOf(actor, dials);
  const hp = actor.system?.attributes?.hp;
  if (!hp || role === "onePool" || (isCharacter(actor) && !hp.sp)) {
    PREP.delete(actor);
    return;
  }
  const pools = derivePools({
    type: actor.type,
    role,
    level: int(actor.level, 1),
    hpMax: hp.max,
    systemSP: hp.sp?.max ?? 0,
    drainLoss: drainedLoss(hp),
    dials,
  });
  if (!pools) {
    PREP.delete(actor);
    return;
  }
  PREP.set(actor, pools);
  const srcHP = int(actor._source?.system?.attributes?.hp?.value, int(hp.value));
  hp.max = pools.maxHP;
  hp.value = Math.max(0, Math.min(srcHP, pools.maxHP));
  if (isCharacter(actor)) {
    hp.sp.max = pools.maxSP;
    hp.sp.value = Math.max(0, Math.min(int(hp.sp.value), pools.maxSP));
    const resolve = actor.system.resources?.resolve;
    if (resolve) {
      resolve.max = pools.maxRP;
      resolve.value = Math.max(0, Math.min(int(resolve.value), pools.maxRP));
    }
  }
}

/* ── LoseHitPoints: drained moves its loss to Stamina Points first ───────── */

const isDrained = (item) => item?.type === "condition" && (item.slug === "drained" || item.system?.slug === "drained");

function lossOf(rule, value) {
  return Math.trunc(Math.abs(Number(rule.resolveValue(value)) || 0));
}

/**
 * `onCreate(actorUpdates)`: pf2e writes `hp.value - loss` into the update it is
 * about to make. For a two-pool actor we write the rules' split there instead.
 * The actor has already been reset with the new item, so `PREP` holds the
 * maxima with this drained value.
 */
function onCreateWrapper(wrapped, actorUpdates, ...rest) {
  try {
    const actor = this.actor;
    const target = poolActor(actor);
    const prep = PREP.get(actor);
    if (!this.ignored && _active() && staminaOn() && prep?.twoPool && target === actor) {
      const loss = lossOf(this, this.value);
      const src = actor._source.system.attributes.hp;
      const sp = usesFlagPools(actor) ? int(bab(actor)[FLAG.sp] ?? prep.maxSP) : int(src.sp?.value);
      if (isDrained(this.item)) {
        const r = drainedRise({ sp, hp: src.value }, { baseSP: prep.baseSP, oldLoss: 0, newLoss: loss });
        actorUpdates["system.attributes.hp.value"] = r.hp;
        actorUpdates[spPath(actor)] = r.sp;
      } else {
        // Any other loss of Hit Points that isn't damage: temporary HP, then SP, then HP.
        // A loss that can't be recovered is direct.
        const r = damage({ temp: int(src.temp), sp, hp: int(src.value), maxSP: prep.maxSP, maxHP: prep.maxHP }, loss, { direct: this.recoverable === false });
        actorUpdates["system.attributes.hp.value"] = r.state.hp;
        if (r.toTemp) actorUpdates["system.attributes.hp.temp"] = r.state.temp;
        if (r.toSP) actorUpdates[spPath(actor)] = r.state.sp;
      }
      return undefined;
    }
  } catch (error) {
    warn("breath-and-blood | LoseHitPoints onCreate fell back to pf2e", error);
  }
  return wrapped(actorUpdates, ...rest);
}

/** `preUpdate(changes)`: a rise of drained takes the increase of each cut. */
async function preUpdateWrapper(wrapped, changes, ...rest) {
  try {
    const actor = this.actor;
    const prep = PREP.get(actor);
    if (this.reevaluateOnUpdate && !this.ignored && _active() && staminaOn() && prep?.twoPool && poolActor(actor) === actor) {
      const oldLoss = lossOf(this, this.value);
      const clone = this.item.clone(changes);
      const rule = clone.system.rules.find((r) => r.key === this.key);
      const newLoss = Math.trunc(Math.abs(Number(this.resolveValue(String(rule?.value), 0, { resolvables: { item: clone } })) || 0));
      if (newLoss <= oldLoss) return undefined;
      const src = actor._source.system.attributes.hp;
      const sp = usesFlagPools(actor) ? int(bab(actor)[FLAG.sp] ?? prep.maxSP) : int(src.sp?.value);
      const update = {};
      if (isDrained(this.item)) {
        const r = drainedRise({ sp, hp: src.value }, { baseSP: prep.baseSP, oldLoss, newLoss });
        update["system.attributes.hp.value"] = r.hp;
        update[spPath(actor)] = r.sp;
      } else {
        const r = damage({ temp: int(src.temp), sp, hp: int(src.value), maxSP: prep.maxSP, maxHP: prep.maxHP }, newLoss - oldLoss, { direct: this.recoverable === false });
        update["system.attributes.hp.value"] = r.state.hp;
        if (r.toTemp) update["system.attributes.hp.temp"] = r.state.temp;
        if (r.toSP) update[spPath(actor)] = r.state.sp;
      }
      await actor.update(update, { render: false });
      return undefined;
    }
  } catch (error) {
    warn("breath-and-blood | LoseHitPoints preUpdate fell back to pf2e", error);
  }
  return wrapped(changes, ...rest);
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

function prepareWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    applyPools(this);
  } catch (error) {
    warn("breath-and-blood | could not prepare pools", error);
  }
  return result;
}

export const PREPARE_TARGETS = ["character", "npc", "familiar"].map((t) => `CONFIG.PF2E.Actor.documentClasses.${t}.prototype.prepareData`);
export const LOSE_HP_TARGETS = {
  onCreate: "game.pf2e.RuleElements.builtin.LoseHitPoints.prototype.onCreate",
  preUpdate: "game.pf2e.RuleElements.builtin.LoseHitPoints.prototype.preUpdate",
};

export function installPrepare({ active, dials }) {
  _active = active;
  _dials = dials;
  for (const target of PREPARE_TARGETS) {
    try {
      registerWrapper(target, prepareWrapper, MIXED);
    } catch (error) {
      warn(`breath-and-blood | could not wrap ${target}; that actor type keeps one pool`, error);
    }
  }
}

export function installDrained() {
  try {
    registerWrapper(LOSE_HP_TARGETS.onCreate, onCreateWrapper, MIXED);
    registerWrapper(LOSE_HP_TARGETS.preUpdate, preUpdateWrapper, MIXED);
  } catch (error) {
    warn("breath-and-blood | could not wrap LoseHitPoints; drained takes Hit Points only", error);
  }
}

/** Re-prepare every actor whose pools can change (a setting moved, the variant was switched). */
export function resetPools() {
  for (const actor of globalThis.game?.actors ?? []) {
    if (["character", "npc", "familiar"].includes(actor.type)) {
      try {
        actor.reset();
        actor.render?.(false);
      } catch {
        /* one actor must not stop the rest */
      }
    }
  }
}

export { flagPath, SUITE_ID };
