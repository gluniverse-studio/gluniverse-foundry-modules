/**
 * Level Ground — what happens in a running combat.
 *
 * Tempo and Unbowed for Solos, and the Threat strip at the top of the combat
 * tracker. Turn bookkeeping runs on the active GM only, from Foundry's
 * `combatTurnChange` (fired on every client after the Combat's update, with
 * the prior and current `{ round, turn, combatantId }`), and only when the
 * encounter moves forward: stepping back is the GM correcting a click, and
 * counting it would end an Unbowed effect early.
 *
 * Tempo state lives on the Solo's combatant (`lvg.tempo`); Unbowed's entries on
 * the Solo's actor (`lvg.unbowed`, which for an unlinked token is its delta).
 * The arithmetic is logic.mjs (`tempoLost`, `unbowed*`); this file reads the
 * world into it and keeps one card per Solo up to date.
 */

import { FLAGS, SUITE_ID } from "./constants.mjs";
import {
  reading,
  tempoLost,
  unbowedAdd,
  unbowedDrop,
  unbowedExempt,
  unbowedOnEnd,
  unbowedOnStart,
  unbowedSkip,
  unbowedWhen,
} from "./logic.mjs";
import { on } from "./settings.mjs";
import { trackerStripHTML } from "./view.mjs";
import { combatWorksheet, flagOf, isSolo } from "./world.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const isActiveGM = () => !!game.user?.isActiveGM || game.users?.activeGM?.id === game.user?.id;
const gmIds = () => (game.users?.filter((u) => u.isGM).map((u) => u.id) ?? []);

const forward = (prior, current) => {
  if (!prior || !current) return false;
  if ((current.round ?? 0) !== (prior.round ?? 0)) return (current.round ?? 0) > (prior.round ?? 0);
  return (current.turn ?? 0) > (prior.turn ?? 0);
};

const soloCombatants = (combat) => (combat?.combatants?.contents ?? []).filter((c) => c.actor && isSolo(c.actor));

/* ── Tempo ────────────────────────────────────────────────────────────── */

function conditionsOf(actor) {
  return (actor?.itemTypes?.condition ?? []).map((c) => ({
    slug: c.slug ?? c.system?.slug,
    value: c.value ?? c.system?.value?.value ?? null,
    unit: c.system?.duration?.unit ?? null,
    granted: !!(c.flags?.pf2e?.grantedBy || c.grantedBy),
  }));
}

const tempoState = (combatant) => flagOf(combatant, FLAGS.tempo) ?? { available: true, messageId: null };

async function promptTempo(combat, solo, endedName) {
  const state = tempoState(solo);
  if (state.available === false) return;
  if (tempoLost(conditionsOf(solo.actor))) return;
  const model = { name: solo.name, after: endedName, used: false, lost: false, combatId: combat.id, combatantId: solo.id };
  const { postCard, updateCard } = await import("./chat.mjs");
  const existing = state.messageId ? game.messages?.get(state.messageId) : null;
  if (existing) {
    await updateCard(existing, model);
    return;
  }
  const message = await postCard("tempo", model, { whisper: gmIds() });
  await solo.setFlag(SUITE_ID, FLAGS.tempo, { available: true, messageId: message?.id ?? null });
}

/** The card's "Used" button. */
export async function markTempoUsed(combatId, combatantId, message) {
  const combat = game.combats?.get(combatId);
  const solo = combat?.combatants?.get(combatantId);
  if (!solo) return;
  await solo.setFlag(SUITE_ID, FLAGS.tempo, { available: false, messageId: message?.id ?? null });
  if (message) {
    const { updateCard } = await import("./chat.mjs");
    const model = { ...(flagOf(message, FLAGS.card)?.model ?? {}), used: true };
    await updateCard(message, model);
  }
}

/* ── Unbowed ──────────────────────────────────────────────────────────── */

const unbowedState = (actor) => flagOf(actor, FLAGS.unbowed) ?? { entries: [], messageId: null };

const inTurnOf = (actor) => {
  const c = game.combat?.combatant;
  return !!c && c.actor === actor;
};

async function writeUnbowed(actor, entries, { ended = [] } = {}) {
  const state = unbowedState(actor);
  const inTurn = inTurnOf(actor);
  const model = {
    name: actor.name,
    actorUuid: actor.uuid,
    inTurn,
    ended,
    entries: entries.map((en) => ({ ...en, when: unbowedWhen(en, { inTurn }) })),
  };
  const { postCard, updateCard } = await import("./chat.mjs");
  let messageId = state.messageId;
  const existing = messageId ? game.messages?.get(messageId) : null;
  if (existing) await updateCard(existing, model);
  else if (entries.length || ended.length) messageId = (await postCard("unbowed", model, { whisper: gmIds() }))?.id ?? null;
  await actor.setFlag(SUITE_ID, FLAGS.unbowed, { entries, messageId });
}

const inRunningCombat = (actor) =>
  (game.combats?.contents ?? []).some((c) => c.started && c.combatants.some((cb) => cb.actor === actor));

/** Why an added item is not tracked, or null. */
function skipReason(item, actor) {
  const ctxOrigin = item.system?.context?.origin?.actor ?? null;
  const originUuid = typeof ctxOrigin === "string" ? ctxOrigin : ctxOrigin?.uuid ?? null;
  let origin = null;
  try {
    origin = originUuid ? fromUuidSync(originUuid) : null;
  } catch {
    origin = null;
  }
  const self = !!origin && (origin === actor || origin.uuid === actor.uuid || (origin.id && origin.id === actor.id));
  const ally = !!origin && !self && !!actor.alliance && origin.alliance === actor.alliance;
  const slug = item.slug ?? item.system?.slug ?? null;
  const reason = unbowedSkip({
    type: item.type,
    slug,
    selfOrigin: self,
    allyOrigin: ally,
    granted: !!(item.flags?.pf2e?.grantedBy || item.grantedBy),
    marker: !!flagOf(item, FLAGS.roleMarker),
  });
  if (reason) return reason;
  if (slug === "unconscious" && Number(actor.system?.attributes?.hp?.value) <= 0) return "down";
  return null;
}

export async function onCreateItem(item, _options, userId) {
  if (!on("unbowed") || !isActiveGM()) return;
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || !isSolo(actor) || !inRunningCombat(actor)) return;
  if (skipReason(item, actor)) return;
  const state = unbowedState(actor);
  const entries = unbowedAdd(state.entries ?? [], { id: item.id, name: item.name });
  if (entries.length === (state.entries ?? []).length) return;
  await writeUnbowed(actor, entries);
}

export async function onDeleteItem(item) {
  if (!isActiveGM()) return;
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor") return;
  const state = unbowedState(actor);
  if (!(state.entries ?? []).some((e) => e.id === item.id)) return;
  await writeUnbowed(actor, unbowedDrop(state.entries, item.id));
}

/** The card's "Exempt" button: a critically failed save, or something the Solo could end with an action. */
export async function exemptUnbowed(uuid, entryId) {
  const actor = await fromUuid(uuid);
  if (!actor) return;
  const state = unbowedState(actor);
  await writeUnbowed(actor, unbowedExempt(state.entries ?? [], entryId));
}

async function unbowedStart(actor) {
  const state = unbowedState(actor);
  if (!(state.entries ?? []).length) return;
  await writeUnbowed(actor, unbowedOnStart(state.entries));
}

async function unbowedEnd(actor) {
  const state = unbowedState(actor);
  if (!(state.entries ?? []).length) return;
  const { expire, keep } = unbowedOnEnd(state.entries);
  if (!expire.length) return;
  const ids = expire.map((e) => e.id).filter((id) => actor.items.has(id));
  // Drop them from the list first, so the deleteItem hook finds nothing to re-draw.
  await writeUnbowed(actor, keep, { ended: expire.map((e) => e.name) });
  if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
}

/* ── The turn hook ────────────────────────────────────────────────────── */

export async function onCombatTurnChange(combat, prior, current) {
  if (!isActiveGM() || !combat?.started || !forward(prior, current)) return;
  const ended = prior?.combatantId ? combat.combatants.get(prior.combatantId) : null;
  try {
    for (const solo of soloCombatants(combat)) {
      if (on("unbowed")) {
        if (ended && solo.id === ended.id) await unbowedEnd(solo.actor);
        if (solo.id === current?.combatantId) await unbowedStart(solo.actor);
      }
      if (on("tempo")) {
        if (solo.id === current?.combatantId) {
          await solo.setFlag(SUITE_ID, FLAGS.tempo, { available: true, messageId: null });
        } else if (ended && ended.id !== solo.id && ended.actor !== solo.actor) {
          await promptTempo(combat, solo, ended.name);
        }
      }
    }
  } catch (error) {
    console.error("GLUniverse Suite | level-ground: turn bookkeeping failed", error);
  }
}

export async function onDeleteCombat(combat) {
  if (!isActiveGM()) return;
  for (const solo of soloCombatants(combat)) {
    try {
      if (flagOf(solo.actor, FLAGS.unbowed)) await solo.actor.unsetFlag(SUITE_ID, FLAGS.unbowed);
    } catch {
      /* the actor is gone */
    }
  }
}

/* ── The tracker strip ────────────────────────────────────────────────── */

/** The running encounter's reading, or null. */
export function combatReading(combat) {
  if (!combat) return null;
  const { rows, party } = combatWorksheet(combat);
  return reading(rows, party);
}

export function onRenderCombatTracker(app, html, { open } = {}) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root?.querySelector) return;
  root.querySelector(".gllvg-strip")?.remove();
  if (!game.user?.isGM || !on("threatStrip")) return;
  const combat = app?.viewed ?? game.combats?.viewed ?? null;
  const r = combatReading(combat);
  if (!r) return;
  const holder = document.createElement("div");
  holder.innerHTML = trackerStripHTML(r, { t });
  const strip = holder.firstElementChild;
  if (!strip) return;
  strip.addEventListener("click", (event) => {
    if (!event.target.closest?.("[data-lvg-action='openThreat']")) return;
    event.preventDefault();
    open?.("threat");
  });
  // PF2e's own encounter line reads the standard XP table: beside the strip it would rate the same fight differently.
  root.querySelector("section.metrics")?.setAttribute("hidden", "");
  const list = root.querySelector("ol.combat-tracker, ol.directory-list, .combat-tracker");
  if (list?.parentElement) list.parentElement.insertBefore(strip, list);
  else root.prepend(strip);
}

let redrawTimer = null;
/** A creature in the viewed combat changed underneath the tracker (a role, an area mark, Strip, elite): redraw once. */
export function redrawSoon(actor) {
  if (!game.user?.isGM || !on("threatStrip")) return;
  const combat = game.combats?.viewed;
  if (!combat || (actor && !combat.combatants.some((c) => c.actor === actor || c.actorId === actor.id))) return;
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    try {
      ui.combat?.render?.();
    } catch {
      /* no tracker */
    }
  }, 0);
}
