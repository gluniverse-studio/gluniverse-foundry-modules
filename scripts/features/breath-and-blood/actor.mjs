/**
 * Breath and Blood — an actor, read as the rules' state and written back.
 *
 * Where each pool lives:
 *   character  SP  system.attributes.hp.sp.value  (pf2e's Stamina variant)
 *              RP  system.resources.resolve.value
 *   npc,       SP  flags[SUITE_ID].bab.sp         (pf2e gives these one pool)
 *   familiar   RP  flags[SUITE_ID].bab.rp
 * Maxima are derived in preparation (`prepare.mjs`) and kept in `PREP`, never
 * in the document: a maximum written to an NPC's `system` would become an
 * editable token bar whose edits nothing reads.
 *
 * An eidolon (`bab.sharesWith`) stores nothing: `poolActor()` resolves every
 * read and write to its summoner.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAG, OPTION } from "./constants.mjs";
import { makePools } from "./rules.mjs";

export const FLAG_ROOT = `flags.${SUITE_ID}.bab.`;
export const flagPath = (key) => FLAG_ROOT + key;

/** Derived per prepared actor (clones included): { twoPool, role, maxSP, maxHP, maxRP, baseSP, baseHP, drainLoss }. */
export const PREP = new WeakMap();

export const staminaOn = () => !!globalThis.game?.pf2e?.settings?.variants?.stamina;

export function bab(actor) {
  return actor?.flags?.[SUITE_ID]?.bab ?? {};
}

export const isCharacter = (actor) => actor?.type === "character";
export const usesFlagPools = (actor) => !!actor && !isCharacter(actor);

/** The stored role, defaulted: a character has two pools, anything else one. */
export function roleOf(actor, { recurringRivals = false } = {}) {
  const stored = bab(actor)[FLAG.role];
  if (isCharacter(actor)) return ["twoPools", "companion", "rival", "onePool"].includes(stored) ? stored : "twoPools";
  if (!["npc", "familiar"].includes(actor?.type)) return "onePool";
  if (stored === "companion") return "companion";
  if (stored === "rival" && recurringRivals) return "rival";
  return "onePool";
}

/** The actor holding this actor's pools: the summoner for an eidolon, else itself. */
export function poolActor(actor) {
  const id = bab(actor)[FLAG.sharesWith];
  if (!id || id === actor?.id) return actor;
  const summoner = globalThis.game?.actors?.get?.(id);
  return summoner && summoner.id !== actor.id && !bab(summoner)[FLAG.sharesWith] ? summoner : actor;
}

/** Does this actor (or the actor it shares with) have two pools right now? */
export function isTwoPool(actor) {
  const target = poolActor(actor);
  return !!target && staminaOn() && !!PREP.get(target)?.twoPool;
}

export const spPath = (actor) => (usesFlagPools(actor) ? flagPath(FLAG.sp) : "system.attributes.hp.sp.value");
export const rpPath = (actor) => (usesFlagPools(actor) ? flagPath(FLAG.rp) : "system.resources.resolve.value");

const int = (v, d = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : d;
};

/** Current SP and RP, read where they live. */
export function poolValues(actor) {
  const prep = PREP.get(actor) ?? {};
  if (usesFlagPools(actor)) {
    const f = bab(actor);
    return {
      sp: Math.min(prep.maxSP ?? 0, Math.max(0, int(f[FLAG.sp] ?? prep.maxSP ?? 0))),
      rp: Math.min(prep.maxRP ?? 0, Math.max(0, int(f[FLAG.rp] ?? prep.maxRP ?? 0))),
    };
  }
  return {
    sp: Math.max(0, int(actor.system?.attributes?.hp?.sp?.value)),
    rp: Math.max(0, int(actor.system?.resources?.resolve?.value)),
  };
}

/** In an encounter: a combatant in a combat that has started. */
export function inEncounter(actor) {
  const uuid = actor?.uuid;
  for (const combat of globalThis.game?.combats ?? []) {
    if (!combat.started) continue;
    if (combat.combatants.some((c) => c.actor?.uuid === uuid || (c.actorId === actor?.id && !actor?.isToken))) return true;
  }
  return false;
}

const has = (actor, slug) => {
  try {
    return !!actor?.hasCondition?.(slug);
  } catch {
    return false;
  }
};

/** The rules' state for a two-pool actor (read through `poolActor`). */
export function readState(actor) {
  const a = poolActor(actor);
  const prep = PREP.get(a) ?? {};
  const hp = a.system?.attributes?.hp ?? {};
  const f = bab(a);
  const { sp, rp } = poolValues(a);
  const attrs = a.system?.attributes ?? {};
  return makePools({
    level: Math.max(0, int(a.level, 1)),
    con: int(a.system?.abilities?.con?.mod, 0),
    maxSP: prep.maxSP ?? 0,
    maxHP: prep.maxHP ?? int(hp.max),
    maxRP: prep.maxRP ?? 0,
    sp,
    hp: Math.max(0, int(hp.value)),
    temp: Math.max(0, int(hp.temp)),
    rp,
    wounded: int(attrs.wounded?.value, 0),
    dying: int(attrs.dying?.value, 0),
    unconscious: has(a, "unconscious"),
    dead: !!a.isDead,
    caughtBreath: !!f[FLAG.caughtBreath],
    strengthLent: !!f[FLAG.strengthLent],
    mended: !!f[FLAG.mended],
    ewImmune: !!f[FLAG.ewImmune],
    inEncounter: inEncounter(a),
    companion: (prep.role ?? "twoPools") === "companion",
    noHeal: false,
  });
}

/**
 * The update that takes `before` to `after` for this actor's pools and flags.
 * Conditions (dying, wounded, unconscious) are not data paths: `syncConditions`.
 */
export function updateFor(actor, before, after, { hp = true } = {}) {
  const a = poolActor(actor);
  const u = {};
  if (hp && after.hp !== before.hp) u["system.attributes.hp.value"] = after.hp;
  if (after.temp !== before.temp) u["system.attributes.hp.temp"] = after.temp;
  if (after.sp !== before.sp) u[spPath(a)] = after.sp;
  if (after.rp !== before.rp) u[rpPath(a)] = after.rp;
  for (const key of ["caughtBreath", "strengthLent", "mended", "ewImmune"]) {
    if (!!after[key] !== !!before[key]) u[flagPath(FLAG[key])] = !!after[key];
  }
  return u;
}

/** Write a state change: one actor update, then the condition changes. */
export async function commitState(actor, before, after, { extra = {}, tag = "state", hp = true } = {}) {
  const a = poolActor(actor);
  const u = { ...updateFor(a, before, after, { hp }), ...extra };
  if (Object.keys(u).length) await a.update(u, { [OPTION]: tag });
  await syncConditions(a, before, after);
  return a;
}

/** Bring dying, wounded and unconscious in line with the state. */
export async function syncConditions(actor, before, after) {
  const a = poolActor(actor);
  if (before.dying > 0 && after.dying !== before.dying) {
    const dying = a.getCondition?.("dying");
    if (dying) {
      if (after.dying <= 0) await a.decreaseCondition("dying", { forceRemove: true });
      else await globalThis.game.pf2e.ConditionManager.updateConditionValue(dying.id, a, after.dying);
    }
  }
  if (after.wounded !== before.wounded) {
    const wounded = a.getCondition?.("wounded");
    if (after.wounded <= 0) {
      if (wounded) await a.decreaseCondition("wounded", { forceRemove: true });
    } else if (wounded) {
      await globalThis.game.pf2e.ConditionManager.updateConditionValue(wounded.id, a, after.wounded);
    } else {
      await a.increaseCondition("wounded", { value: after.wounded });
    }
  }
  // Removing dying cascades to the unconscious it granted; put it back when the
  // creature is meant to stay unconscious (Hold On), and take it off when it woke.
  const uncNow = has(a, "unconscious");
  if (after.unconscious && !uncNow && after.hp === 0) await a.increaseCondition("unconscious");
  if (!after.unconscious && before.unconscious && uncNow && after.hp > 0) await a.decreaseCondition("unconscious", { forceRemove: true });
}

/** A clean blank for flags this feature sets on a night (and on returning from death). */
export function nightFlagUpdate() {
  return {
    [flagPath(FLAG.caughtBreath)]: false,
    [flagPath(FLAG.strengthLent)]: false,
    [flagPath(FLAG.ewImmune)]: false,
    [flagPath(FLAG.mended)]: false,
    [flagPath(FLAG.fieldSurgeonUsed)]: false,
    [flagPath(FLAG.steelUsed)]: false,
    [flagPath(FLAG.covers)]: {},
  };
}

/** Has the actor a feat with this slug? */
export function hasFeat(actor, slug) {
  try {
    return (actor?.itemTypes?.feat ?? []).some((f) => f.slug === slug || f.system?.slug === slug);
  } catch {
    return false;
  }
}

/** Medicine proficiency rank 0–4. */
export const medicineRank = (actor) => Math.max(0, Math.min(4, int(actor?.skills?.medicine?.rank ?? actor?.system?.skills?.medicine?.rank, 0)));

/** A TokenDocument for chat speakers and pf2e's applyDamage (which reads `token.name` and `token.combatant`). */
export const tokenOf = (actor) => actor?.token ?? actor?.getActiveTokens?.(false, true)?.[0] ?? null;

/** Is the user an owner of the actor's pool holder? */
export const canWrite = (actor, user = globalThis.game?.user) =>
  !!actor && (!!user?.isGM || !!poolActor(actor)?.testUserPermission?.(user, "OWNER"));
