/**
 * Breath and Blood — damage and healing, through pf2e's own `applyDamage`.
 *
 * pf2e 8.7.0, `ActorPF2e#applyDamage({ damage, token, item, rollOptions, skipIWR,
 * shieldBlockRequest, breakdown, notes, outcome, final })`: a chat card's
 * apply button reaches it through `applyDamageFromMessage`, on a contextual
 * clone of the target, with healing as a NEGATIVE number (`multiplier -1`),
 * `skipIWR: true` and `item` = the message's item. It computes the split in
 * `calculateHealthDelta({ hp, sp, delta })` (temp, then `hp.sp` for characters
 * when the variant is on, then HP; healing touches HP only), writes one actor
 * update, posts the "damage taken" card and handles defeated. No hook runs
 * before any of it, so this file wraps both methods:
 *
 *   calculateHealthDelta  direct damage skips SP; NPC and familiar companions
 *                         take SP from their flag (an `updates` path pf2e's
 *                         undo restores like any other).
 *   applyDamage           healing on a two-pool actor is classified, decided,
 *                         run through the pure procedure, and applied by
 *                         calling the wrapped method with `damage: -toHP` and
 *                         `final: true`, so pf2e writes HP, posts its message
 *                         and handles defeated; SP, RP and flags follow in one
 *                         update. An eidolon's damage goes to its summoner.
 *
 * `final: true` skips pf2e's `healing-received` modifiers and dice, so they are
 * folded in here first (`healingReceivedBonus`), before the minimum is
 * compared: "added Hit Points are part of what the treatment gives".
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import { bab, commitState, flagPath, isTwoPool, poolActor, poolValues, readState, spPath, tokenOf, usesFlagPools, PREP, inEncounter } from "./actor.mjs";
import { describeSource, isRepeatingMessage } from "./classify.mjs";
import { FLAG, OPTION } from "./constants.mjs";
import { postCard, t } from "./chat.mjs";
import {
  FRACTION, KIND, applyHealing, classifyHealing, decide, fallbackKind, installmentKind, minimum, shouldPrompt, startCover, unpaidReason,
} from "./rules.mjs";
import { healDialogHTML } from "./views.mjs";

/** Actors whose current damage is direct (temp, then HP). */
export const DIRECT = new WeakSet();
/** Actors inside our own call to the wrapped applyDamage. */
const REENTRANT = new WeakSet();
/** Actor uuids whose HP rise must not set mended (unpaid 1 HP, waking). */
export const NO_MEND = new Set();

let _active = () => false;
let _dials = () => ({});

/* ── Which chat card did the user just press? ────────────────────────────── */

let LAST = null;
const CLICK_WINDOW_MS = 4000;

/** Capture-phase listener: remember the message under a click or a context menu. */
export function noteClick(event) {
  const li = event?.target?.closest?.("[data-message-id]");
  if (li?.dataset?.messageId) LAST = { messageId: li.dataset.messageId, at: Date.now() };
}

function recentMessage() {
  if (!LAST || Date.now() - LAST.at > CLICK_WINDOW_MS) return null;
  return game.messages?.get(LAST.messageId) ?? null;
}

const RECEIVED = [
  "PF2E.Encounter.Broadcast.FastHealing.fast-healing.ReceivedMessage",
  "PF2E.Encounter.Broadcast.FastHealing.regeneration.ReceivedMessage",
];
const receivedTexts = () => RECEIVED.map((k) => game.i18n.localize(k)).filter((s) => s && !RECEIVED.includes(s));

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const isRoll = (d) => d && typeof d === "object" && typeof d.total === "number";

export function isHealing(damage) {
  if (typeof damage === "number") return damage < 0;
  if (isRoll(damage)) {
    const kinds = damage.kinds;
    return !!kinds?.has?.("healing") && !kinds.has("damage");
  }
  return false;
}

const healingAmount = (damage) => (typeof damage === "number" ? Math.max(0, -Math.trunc(damage)) : Math.max(0, Math.trunc(damage.total)));

const optionSet = (o) => (o instanceof Set ? o : new Set(Array.isArray(o) ? o : []));

/** pf2e's `healing-received` modifiers, which `final: true` would skip. */
export function healingReceivedBonus(actor, rollOptions, item) {
  try {
    const opts = optionSet(rollOptions);
    const fns = actor?.synthetics?.modifiers?.["healing-received"] ?? [];
    if (!fns.length) return 0;
    const resolvables = item?.isOfType?.("spell") ? { spell: item } : item?.isOfType?.("weapon") ? { weapon: item } : {};
    const mods = fns
      .flatMap((fn) => fn({ resolvables, test: opts }) ?? [])
      .filter((m) => m && (m.predicate?.test?.(opts) ?? true));
    if (!mods.length) return 0;
    return Math.trunc(new game.pf2e.StatisticModifier("healing-received", mods, opts).totalModifier ?? 0);
  } catch (error) {
    warn("breath-and-blood | could not fold in healing-received modifiers", error);
    return 0;
  }
}

/** Is this damage direct (temporary HP, then HP)? Grim Wounds, Risky Surgery, or our command. */
function directFor(actor, args) {
  if (DIRECT.has(actor)) return true;
  const opts = optionSet(args.rollOptions);
  if (opts.has("risky-surgery")) return true;
  if (!_dials().grimWounds) return false;
  if (actor.hasCondition?.("unconscious")) return true;
  const item = args.item;
  return item?.type === "condition" && (item.slug === "persistent-damage" || item.system?.slug === "persistent-damage") && item.system?.persistent?.damageType === "bleed";
}

/* ── calculateHealthDelta ────────────────────────────────────────────────── */

function calcWrapper(wrapped, args) {
  try {
    const actor = this;
    if (!_active() || !args || !(args.delta > 0) || !PREP.get(actor)?.twoPool) return wrapped(args);
    const direct = DIRECT.has(actor);
    if (!usesFlagPools(actor) && !direct) return wrapped(args);
    const { hp, delta } = args;
    const updates = {};
    if (!hp || hp.max === 0) return { updates, totalApplied: 0 };
    const temp = hp.temp > 0 ? Math.min(hp.temp, delta) : 0;
    if (temp > 0) updates["system.attributes.hp.temp"] = Math.max(hp.temp - temp, 0);
    let toSP = 0;
    if (!direct) {
      const sp = poolValues(actor).sp;
      toSP = Math.min(sp, delta - temp);
      updates[spPath(actor)] = Math.max(sp - toSP, 0);
    }
    const rest = delta - temp - toSP;
    updates["system.attributes.hp.value"] = Math.max(0, Math.min(hp.max, hp.value - rest));
    return { updates, totalApplied: temp + toSP + rest };
  } catch (error) {
    warn("breath-and-blood | calculateHealthDelta fell back to pf2e", error);
    return wrapped(args);
  }
}

/* ── applyDamage ─────────────────────────────────────────────────────────── */

async function applyWrapper(wrapped, args = {}) {
  const actor = this;
  if (!_active() || REENTRANT.has(actor)) return wrapped(args);
  try {
    const holder = poolActor(actor);
    if (holder !== actor) {
      if (!isTwoPool(holder)) return wrapped(args);
      return holder.applyDamage({ ...args, token: tokenOf(holder) ?? args.token });
    }
    if (!isTwoPool(actor)) return wrapped(args);
    if (isHealing(args.damage)) {
      // A token bar edited by hand arrives as `final` with no item and no options: not healing.
      if (args.final && !args.item && optionSet(args.rollOptions).size === 0) return wrapped(args);
      return await healTwoPool(actor, wrapped, args);
    }
    if (!directFor(actor, args)) return wrapped(args);
  } catch (error) {
    warn("breath-and-blood | applyDamage fell back to pf2e", error);
    return wrapped(args);
  }
  DIRECT.add(actor);
  try {
    return await wrapped(args);
  } finally {
    DIRECT.delete(actor);
  }
}

/** The source of a fast-healing or regeneration installment. */
function repeatingSource(actor) {
  const rule = (actor.rules ?? []).find((r) => r.key === "FastHealing" && !r.ignored);
  const item = rule?.item ?? null;
  const key = item?.id ?? "fast-healing";
  const isEffect = item?.type === "effect";
  const permanent = !isEffect || item.system?.duration?.unit === "unlimited";
  let desc = { source: "none" };
  if (isEffect) {
    const originUuid = item.system?.context?.origin?.item ?? null;
    let origin = null;
    try {
      origin = originUuid ? fromUuidSync(originUuid) : null;
    } catch {
      origin = null;
    }
    desc = origin ? describeSource({ item: origin }) : { source: "none" };
  } else if (item) {
    desc = describeSource({ item });
  }
  return { key, item, permanent, desc };
}

/** Ask the applying user: the kind (changeable) and the patient's pay or decline. Null = cancelled. */
async function askHealing(actor, { amount, classification, state, declines, repeating }) {
  const model = {
    name: actor.name,
    amount,
    kind: classification.kind === "ask" ? "paid" : classification.kind,
    why: classification.reason,
    declines,
    minimum: minimum(state, FRACTION.quarter),
    rp: state.rp,
    unpaidReason: unpaidReason(state),
    repeating,
  };
  try {
    return await foundry.applications.api.DialogV2.wait({
      window: { title: t("GLBAB.heal.title", { name: actor.name }), icon: "fa-solid fa-lungs" },
      classes: ["glbab-dialog-frame"],
      content: healDialogHTML(model, t),
      rejectClose: false,
      buttons: [
        {
          action: "apply",
          label: t("GLBAB.heal.apply"),
          default: true,
          callback: (_event, button) => {
            const form = button.form;
            return {
              kind: form?.elements?.kind?.value === "spent" ? "spent" : "paid",
              declines: form?.elements?.choice?.value === "decline",
            };
          },
        },
        { action: "cancel", label: t("GLBAB.heal.cancel"), callback: () => null },
      ],
    });
  } catch (error) {
    warn("breath-and-blood | the healing dialog failed; the default stands", error);
    return { kind: model.kind, declines };
  }
}

async function healTwoPool(actor, wrapped, args) {
  const d = _dials();
  const rolled = Math.max(0, healingAmount(args.damage) + (args.final ? 0 : healingReceivedBonus(actor, args.rollOptions, args.item)));
  const message = recentMessage();
  const repeating =
    !args.item && !!message && isRepeatingMessage(message, receivedTexts()) && (message.speaker?.actor === actor.id || message.speaker?.token === actor.token?.id);
  const before = readState(actor);
  let state = before;
  let kind;
  let why;
  let reason = null;
  const extra = {};
  const declinesFlag = !!bab(actor)[FLAG.declines];

  if (repeating) {
    const src = repeatingSource(actor);
    const now = Number(game.time?.worldTime ?? 0);
    const covers = { ...(bab(actor)[FLAG.covers] ?? {}) };
    const covered = installmentKind(covers[src.key], now);
    if (covered) {
      kind = covered;
      why = "covered";
    } else {
      const c = classifyHealing(src.desc, d);
      let chosen = { kind: fallbackKind(c), declines: declinesFlag };
      if (c.kind !== "spent" && shouldPrompt({ sure: false }, d.healingPrompt)) {
        chosen = await askHealing(actor, { amount: rolled, classification: c, state, declines: declinesFlag, repeating: true });
        if (!chosen) return actor;
      }
      if (chosen.kind === "spent") kind = KIND.spent;
      else {
        const dd = decide(state, { declines: chosen.declines });
        state = dd.state;
        kind = dd.kind;
        reason = dd.reason;
      }
      covers[src.key] = startCover({ kind, permanent: src.permanent, now, source: src.key, effectId: src.item?.id ?? null });
      extra[flagPath(FLAG.covers)] = covers;
      why = "repeating";
    }
  } else {
    const desc = describeSource({ item: args.item, message, rollOptions: args.rollOptions });
    const c = classifyHealing(desc, d);
    let chosen = { kind: fallbackKind(c), declines: declinesFlag };
    if (shouldPrompt(c, d.healingPrompt)) {
      chosen = await askHealing(actor, { amount: rolled, classification: c, state, declines: declinesFlag, repeating: false });
      if (!chosen) return actor;
    }
    if (chosen.kind === "spent") kind = KIND.spent;
    else {
      const dd = decide(state, { declines: chosen.declines });
      state = dd.state;
      kind = dd.kind;
      reason = dd.reason;
    }
    why = c.reason;
  }

  const heal = applyHealing(state, rolled, kind, FRACTION.quarter);
  await commitHealing(actor, wrapped, args, before, heal, { kind, extra });
  await postCard(healCard(actor, { kind, why, reason, rolled, heal, rpSpent: before.rp - heal.state.rp }), { actor });
  return actor;
}

/**
 * Write one healing: HP through pf2e's own applyDamage (its message, its
 * defeated handling), then SP, RP, flags and conditions in one update.
 */
export async function commitHealing(actor, wrapped, args, before, heal, { kind, extra = {} } = {}) {
  if (heal.toHP > 0) {
    REENTRANT.add(actor);
    if (kind === KIND.unpaid) NO_MEND.add(actor.uuid);
    try {
      await wrapped({ ...args, damage: -heal.toHP, final: true, skipIWR: true });
    } finally {
      REENTRANT.delete(actor);
      NO_MEND.delete(actor.uuid);
    }
  }
  await commitState(actor, before, heal.state, { extra, tag: "heal", hp: false });
}

/** The one short chat line after a healing. */
export function healCard(actor, { kind, why, reason, rolled, heal, rpSpent }) {
  const lines = [];
  if (kind === KIND.unpaid) {
    lines.push({ k: `GLBAB.unpaid.${reason ?? "declined"}` });
    if (heal.toHP > 0) lines.push({ k: "GLBAB.card.oneHP" });
  } else {
    lines.push({ k: `GLBAB.card.kind.${kind}`, d: { rolled } });
    lines.push({ k: "GLBAB.card.restored", d: { hp: heal.toHP, sp: heal.toSP } });
    if (heal.minimumApplied) lines.push({ k: "GLBAB.card.minimum", d: { minimum: heal.minimum } });
    if (heal.lost > 0) lines.push({ k: "GLBAB.card.lost", d: { lost: heal.lost } });
  }
  if (rpSpent > 0) lines.push({ k: "GLBAB.card.rpSpent", d: { rp: rpSpent } });
  if (heal.endedDying) lines.push({ k: "GLBAB.card.endedDying" });
  if (why) lines.push({ k: `GLBAB.why.${why}` });
  return { title: { k: "GLBAB.card.heal", d: { name: actor.name } }, tone: kind === KIND.unpaid ? "warn" : "good", rows: [{ lines }] };
}

/* ── Mended: HP rising outside a started combat ──────────────────────────── */

function preUpdateActor(actor, changes, options, userId) {
  if (userId !== game.user.id || !_active()) return;
  const next = foundry.utils.getProperty(changes, "system.attributes.hp.value");
  if (typeof next !== "number") return;
  options[`${OPTION}HpBefore`] = Number(actor._source?.system?.attributes?.hp?.value ?? 0);
}

async function updateActor(actor, changes, options, userId) {
  if (userId !== game.user.id || !_active()) return;
  const beforeHP = options?.[`${OPTION}HpBefore`];
  if (typeof beforeHP !== "number") return;
  const now = Number(actor._source?.system?.attributes?.hp?.value ?? 0);
  if (now <= beforeHP) return;
  // Every write this feature makes is tagged and sets mended from the rules' own state; the
  // 1 HP from unpaid healing (pf2e's own write, inside NO_MEND) and from waking never count.
  if (options?.[OPTION] || NO_MEND.has(actor.uuid)) return;
  if (!isTwoPool(actor) || inEncounter(actor) || bab(actor)[FLAG.mended]) return;
  try {
    await actor.update({ [flagPath(FLAG.mended)]: true }, { [OPTION]: "mended" });
  } catch (error) {
    warn("breath-and-blood | could not set mended", error);
  }
}

/** Clear mended for every combatant when a combat starts, and for a combatant joining one. */
async function clearMended(actors) {
  if (game.users?.activeGM !== game.user) return;
  for (const actor of actors) {
    if (!actor || !bab(actor)[FLAG.mended]) continue;
    try {
      await actor.update({ [flagPath(FLAG.mended)]: false }, { [OPTION]: "mended" });
    } catch {
      /* an unwritable actor keeps its mark */
    }
  }
}

/** Covers end with their effect. */
async function onDeleteItem(item, _options, userId) {
  if (userId !== game.user.id || !_active()) return;
  const actor = item?.parent;
  const covers = bab(actor)?.[FLAG.covers];
  if (!covers) return;
  const kept = Object.fromEntries(Object.entries(covers).filter(([, c]) => c?.effectId !== item.id));
  if (Object.keys(kept).length === Object.keys(covers).length) return;
  await actor.update({ [flagPath(FLAG.covers)]: kept }, { [OPTION]: "covers" });
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

export const DAMAGE_TARGETS = ["character", "npc", "familiar"].flatMap((type) => [
  `CONFIG.PF2E.Actor.documentClasses.${type}.prototype.calculateHealthDelta`,
  `CONFIG.PF2E.Actor.documentClasses.${type}.prototype.applyDamage`,
]);

export function installDamage({ active, dials }) {
  _active = active;
  _dials = dials;
  for (const target of DAMAGE_TARGETS) {
    try {
      registerWrapper(target, target.endsWith("calculateHealthDelta") ? calcWrapper : applyWrapper, MIXED);
    } catch (error) {
      warn(`breath-and-blood | could not wrap ${target}; that path keeps pf2e's behaviour`, error);
    }
  }
  Hooks.on("preUpdateActor", preUpdateActor);
  Hooks.on("updateActor", updateActor);
  Hooks.on("deleteItem", onDeleteItem);
  Hooks.on("combatStart", (combat) => clearMended(combat.combatants.map((c) => c.actor)));
  Hooks.on("createCombatant", (combatant) => {
    if (combatant.parent?.started) clearMended([combatant.actor]);
  });
}

export function readyDamage() {
  document.addEventListener("click", noteClick, true);
  document.addEventListener("contextmenu", noteClick, true);
}

export { SUITE_ID };
