/**
 * Level Ground — the seams with PF2e's rolls.
 *
 * One handler on `game.pf2e.Check.roll` (through core/wrapper.mjs, which chains
 * it with every other suite handler on the same target) applies, in order:
 *
 *   1. Outmatched in place of incapacitation: PF2e's degree step is removed
 *      from `context.dosAdjustments`; a save gains the untyped bonus and a
 *      critical failure reads as a failure; a check against the creature's DC
 *      raises that DC and a critical success reads as a success.
 *   2. Reach: a skill or Perception check carrying `level-ground:task-rank:N`
 *      takes −2 per rank below N (untrained counts as trained). Never on Break
 *      Away.
 *   3. Break Away: the GM's +2 to +4 circumstance bonus the card asked for.
 *   4. Treat Wounds and Administer First Aid: the printed DC is Converted
 *      (Treat Wounds is left to Breath and Blood when that feature is on).
 *
 * Modifiers go onto the CheckModifier with `push`, which recalculates the total.
 * The context's own `modifiers` are copied into `context.origin` as metadata and
 * never summed (CLAUDE.md, the pf2e-variant-rules seams).
 *
 * Massive damage is a wrapper on the character class's `applyDamage`, and
 * Assurance is read after the roll, from the message.
 */

import { Suite } from "../../core/registry.mjs";
import { registerWrapper, WRAPPER } from "../../core/wrapper.mjs";
import { SLUGS } from "./constants.mjs";
import {
  OPT,
  effectLevel,
  hasIncapacitation,
  isBreakAway,
  isMassive,
  isNativeIncapacitation,
  massiveDying,
  outmatchedBonus,
  outmatchedCheckAdjustment,
  outmatchedSaveAdjustment,
  readNumberOption,
  readProficiencyRank,
  readTaskRank,
  reachPenalty,
} from "./logic.mjs";
import { convertDC } from "./rules.mjs";
import { on } from "./settings.mjs";
import { isSolo, printedLevel } from "./world.mjs";

const L = (key) => game.i18n.localize(key);

function modifier({ slug, label, value, type = "untyped" }) {
  const Cls = game.pf2e?.Modifier;
  if (!Cls) return null;
  return new Cls({ slug, label, modifier: value, type });
}

function pushModifier(check, mod) {
  if (!mod) return false;
  if (typeof check?.push === "function") {
    check.push(mod);
    return true;
  }
  if (Array.isArray(check?.modifiers)) {
    check.modifiers.push(mod);
    check.calculateTotal?.(check.options ?? new Set());
    return true;
  }
  return false;
}

/* ── Outmatched ───────────────────────────────────────────────────────── */

/** The effect's level from a roll's context: 2 × rank, the item's level, else the origin creature's printed level. */
export function contextEffectLevel(context) {
  const item = context?.item ?? null;
  const origin = context?.origin?.actor ?? item?.actor ?? null;
  const isSpell = item?.isOfType?.("spell") ?? item?.type === "spell";
  const isPhysical = item?.isOfType?.("physical") ?? false;
  const rank = Number(item?.rank ?? item?.system?.location?.heightenedLevel ?? item?.system?.level?.value);
  return effectLevel({
    kind: isSpell ? "spell" : isPhysical ? "physical" : "other",
    rank: Number.isFinite(rank) ? rank : null,
    itemLevel: Number.isFinite(Number(item?.level)) ? Number(item.level) : null,
    originLevel: origin ? printedLevel(origin) : null,
  });
}

function applyOutmatched(check, context) {
  if (!on("outmatched")) return;
  const options = context?.options;
  if (!hasIncapacitation(options) || !context?.dc) return;
  const label = L("GLLVG.roll.outmatched");
  const save = context.type === "saving-throw";
  const target = save ? context.actor : context.target?.actor;
  if (!target) return;
  if (!save && !["attack-roll", "spell-attack-roll", "skill-check", "perception-check"].includes(context.type)) return;
  const reading = outmatchedBonus({
    targetLevel: printedLevel(target),
    effectLevel: contextEffectLevel(context),
    solo: isSolo(target),
  });
  // Outmatched REPLACES the trait's change to degrees, so PF2e's step goes
  // whenever the rule can be read, bonus or not.
  if (!reading) return;
  if (Array.isArray(context.dosAdjustments)) {
    context.dosAdjustments = context.dosAdjustments.filter((a) => !isNativeIncapacitation(a));
  }
  if (reading.bonus <= 0) return;
  context.dosAdjustments ??= [];
  if (save) {
    if (!pushModifier(check, modifier({ slug: SLUGS.outmatched, label, value: reading.bonus }))) return;
    context.dosAdjustments.push(outmatchedSaveAdjustment(label));
  } else {
    if (typeof context.dc.value !== "number") return;
    context.dc.value += reading.bonus;
    context.dc.label = `${context.dc.label ?? ""} (${label} +${reading.bonus})`.trim();
    context.dosAdjustments.push(outmatchedCheckAdjustment(label));
  }
}

/* ── Reach ────────────────────────────────────────────────────────────── */

function characterRank(check, context) {
  const fromOption = readProficiencyRank(context?.options);
  if (fromOption !== null) return fromOption;
  try {
    const stat = context?.actor?.getStatistic?.(check?.slug);
    if (Number.isFinite(stat?.rank)) return stat.rank;
  } catch {
    /* no statistic */
  }
  return 0;
}

function applyReach(check, context) {
  if (!on("reach")) return;
  if (!["skill-check", "perception-check"].includes(context?.type)) return;
  const options = context?.options;
  if (isBreakAway(options)) return;
  const task = readTaskRank(options);
  if (task === null) return;
  const penalty = reachPenalty(characterRank(check, context), task);
  if (penalty >= 0) return;
  pushModifier(check, modifier({ slug: SLUGS.reach, label: L("GLLVG.roll.reach"), value: penalty }));
}

/* ── Break Away bonus, fixed DCs ──────────────────────────────────────── */

function applyBreakAwayBonus(check, context) {
  const options = context?.options;
  if (!isBreakAway(options)) return;
  const bonus = readNumberOption(options, OPT.breakAwayBonus);
  if (!bonus) return;
  pushModifier(check, modifier({ slug: SLUGS.breakAwayBonus, label: L("GLLVG.roll.breakAwayBonus"), value: bonus, type: "circumstance" }));
}

/** Administer First Aid, Stop Bleeding (rules 0.13, Fixed DCs). */
export const STOP_BLEEDING_DC = 14;

const has = (options, value) => (options instanceof Set ? options.has(value) : Array.isArray(options) && options.includes(value));

function applyActionDCs(_check, context) {
  if (!on("convertActionDCs") || typeof context?.dc?.value !== "number" || context.lvgConverted) return;
  const options = context.options;
  const treat = has(options, "action:treat-wounds");
  const firstAid = has(options, "action:administer-first-aid");
  if (!treat && !firstAid) return;
  // Breath and Blood owns Treat Wounds (and reads Level Ground's rank DCs itself).
  if (treat && safeEnabled("breath-and-blood")) return;
  const printed = context.dc.value;
  // Stopping bleeding is DC 14 under Level Ground, whatever the bleed's own DC
  // (stabilizing is 5 + the recovery DC, Converted). PF2e marks the variant.
  const converted = firstAid && has(options, "action:administer-first-aid:stop-bleeding") ? STOP_BLEEDING_DC : convertDC(printed);
  if (converted === printed) return;
  context.dc.value = converted;
  context.lvgConverted = true;
}

const safeEnabled = (id) => {
  try {
    return Suite.enabled(id);
  } catch {
    return false;
  }
};

/** The one Check.roll handler. Every step is guarded: a PF2e change degrades the rule, never the roll. */
export function checkRollHandler(wrapped, check, context = {}, ...rest) {
  for (const step of [applyOutmatched, applyReach, applyBreakAwayBonus, applyActionDCs]) {
    try {
      step(check, context);
    } catch (error) {
      console.error(`GLUniverse Suite | level-ground: ${step.name} failed`, error);
    }
  }
  return wrapped(check, context, ...rest);
}

export function registerCheckWrapper() {
  if (!game.pf2e?.Check?.roll) {
    console.warn("GLUniverse Suite | level-ground: game.pf2e.Check.roll unavailable; Reach and Outmatched are off.");
    return false;
  }
  try {
    registerWrapper("game.pf2e.Check.roll", checkRollHandler, WRAPPER);
    return true;
  } catch (error) {
    console.error("GLUniverse Suite | level-ground: could not wrap Check.roll", error);
    return false;
  }
}

/* ── Massive damage ───────────────────────────────────────────────────── */

/** `applyDamage` writes its HP update with `{ damageTaken }` in the options; this catches it for the wrapper. */
const pending = new Map();

export function onPreUpdateActor(actor, _changes, options) {
  if (pending.has(actor) && typeof options?.damageTaken === "number") pending.set(actor, options.damageTaken);
}

async function massiveHandler(wrapped, ...args) {
  const actor = this;
  if (!on("massiveDamage") || actor?.type !== "character") return wrapped(...args);
  const params = args[0] ?? {};
  const combatant = params.token?.combatant ?? actor.combatant ?? null;
  const wasDefeated = !!combatant?.isDefeated;
  pending.set(actor, null);
  let result;
  try {
    result = await wrapped(...args);
  } finally {
    const damageTaken = pending.get(actor);
    pending.delete(actor);
    try {
      const hp = actor.system?.attributes?.hp ?? {};
      if (isMassive({ damageTaken, hpMax: hp.max, spMax: hp.sp?.max ?? 0, hpAfter: hp.value })) {
        await onMassive(actor, combatant, wasDefeated);
      }
    } catch (error) {
      console.error("GLUniverse Suite | level-ground: massive damage handling failed", error);
    }
  }
  return result;
}

/** Undo the death PF2e declared and tell the GM what Level Ground does instead. */
async function onMassive(actor, combatant, wasDefeated) {
  if (combatant && combatant.isDefeated && !wasDefeated) {
    // PF2e's toggleDefeated flips the combatant and toggles the dead overlay with it.
    await combatant.toggleDefeated({ to: false });
  }
  const { postMassiveCard } = await import("./chat.mjs");
  const wounded = Number(actor.getCondition?.("wounded")?.value ?? 0) || 0;
  await postMassiveCard({
    name: actor.name,
    actorUuid: actor.uuid,
    normal: massiveDying({ critical: false, wounded }),
    critical: massiveDying({ critical: true, wounded }),
    wounded,
  });
}

export function registerMassiveWrapper() {
  const cls = CONFIG.PF2E?.Actor?.documentClasses?.character;
  if (!cls?.prototype?.applyDamage) {
    console.warn("GLUniverse Suite | level-ground: CharacterPF2e#applyDamage not found; massive damage is manual.");
    return false;
  }
  try {
    registerWrapper("CONFIG.PF2E.Actor.documentClasses.character.prototype.applyDamage", massiveHandler, WRAPPER);
    return true;
  } catch (error) {
    console.error("GLUniverse Suite | level-ground: could not wrap applyDamage", error);
    return false;
  }
}

/* ── Assurance ────────────────────────────────────────────────────────── */

/**
 * Why a roll used Assurance where Level Ground forbids it, or null: to Break
 * Away, against a higher-level creature's statistic, or against a DC set by a
 * higher level (`level-ground:dc-level:N`, which the converter's level-based
 * checks carry). Assurance's own result needs nothing: with Proficiency
 * without Level it is already 10 + the proficiency bonus.
 */
export function assuranceProblem(message) {
  const ctx = message?.flags?.pf2e?.context;
  if (!ctx) return null;
  const options = ctx.options ?? [];
  const used = (ctx.substitutions ?? []).some((s) => s?.slug === "assurance" && s?.selected) || options.includes("substitute:assurance");
  if (!used) return null;
  if (isBreakAway(options)) return "breakAway";
  const roller = message.actor ?? (ctx.actor ? game.actors?.get(ctx.actor) : null);
  const rollerLevel = printedLevel(roller);
  const dcLevel = readNumberOption(options, OPT.dcLevel);
  if (dcLevel !== null && Number.isFinite(rollerLevel) && dcLevel > rollerLevel) return "levelDC";
  const targetUuid = ctx.target?.actor;
  if (ctx.dc?.slug && targetUuid && Number.isFinite(rollerLevel)) {
    let target = null;
    try {
      target = fromUuidSync(targetUuid);
    } catch {
      target = null;
    }
    const tl = printedLevel(target);
    if (Number.isFinite(tl) && tl > rollerLevel) return "creature";
  }
  return null;
}

