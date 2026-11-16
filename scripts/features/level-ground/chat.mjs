/**
 * Level Ground — chat cards and their buttons.
 *
 * Every card is drawn by `view.mjs` from a model kept in the message's own
 * `lvg.card` flag, so a card that changes (Break Away collecting results, Tempo
 * marked used, Unbowed counting down) is re-drawn from that model and written
 * back as the message's content. GM-only cards are whispered to the GMs.
 *
 * Break Away results are collected by the active GM: a check that carries the
 * card's key arrives as a chat message, the GM waits for its dice to land
 * (`diceSettled`, so the card never shows a result before the table sees the
 * die), then files the degree under the roller's actor.
 */

import { diceSettled } from "../../core/dice-wait.mjs";
import { FLAGS, SUITE_ID, flagPath } from "./constants.mjs";
import { OPT, breakAwayResult, isBreakAway, readTextOption } from "./logic.mjs";
import {
  assuranceCardHTML,
  breakAwayCardHTML,
  checkRequestCardHTML,
  massiveCardHTML,
  sizingUpCardHTML,
  tempoCardHTML,
  unbowedCardHTML,
  xpCardHTML,
} from "./view.mjs";
import { flagOf } from "./world.mjs";
import { on } from "./settings.mjs";
import { assuranceProblem } from "./checks.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const gmIds = () => (game.users?.filter((u) => u.isGM).map((u) => u.id) ?? []);

const RENDER = {
  sizing: sizingUpCardHTML,
  check: checkRequestCardHTML,
  breakAway: breakAwayCardHTML,
  massive: massiveCardHTML,
  tempo: tempoCardHTML,
  unbowed: unbowedCardHTML,
  assurance: assuranceCardHTML,
  xp: xpCardHTML,
};

const contentFor = (kind, model) => RENDER[kind](model, { t });

/** Post a card. `whisper`: user ids, or null for a public card. */
export async function postCard(kind, model, { whisper = null, speaker = null } = {}) {
  const data = {
    content: contentFor(kind, model),
    speaker: speaker ?? { alias: t("GLLVG.card.speaker") },
    flags: { [SUITE_ID]: { lvg: { card: { kind, model } } } },
  };
  if (whisper) data.whisper = whisper;
  return ChatMessage.implementation.create(data);
}

/** Re-draw a card from a changed model. */
export async function updateCard(message, model) {
  const card = flagOf(message, FLAGS.card);
  if (!card?.kind || !RENDER[card.kind]) return null;
  return message.update({
    content: contentFor(card.kind, model),
    [flagPath(`${FLAGS.card}.model`)]: model,
  });
}

/* ── The cards the feature posts ──────────────────────────────────────── */

export const postSizingUp = (model) => postCard("sizing", model);
export const postCheckRequest = (model) => postCard("check", model);
export const postBreakAway = (model) => postCard("breakAway", model);
export const postMassiveCard = (model) => postCard("massive", model, { whisper: gmIds() });
export const postXPCard = (model) => postCard("xp", model, { whisper: gmIds() });

/* ── Buttons ──────────────────────────────────────────────────────────── */

/** Set a PC's dying value (the massive damage card). */
async function setDying(uuid, value) {
  const actor = await fromUuid(uuid);
  if (!actor) return;
  const dying = actor.getCondition?.("dying");
  if (dying) await game.pf2e.ConditionManager.updateConditionValue(dying.id, actor, value);
  else await actor.increaseCondition?.("dying", { value });
}

const HANDLERS = {
  async setDying(button) {
    await setDying(button.dataset.uuid, Number(button.dataset.value));
  },
  async tempoUsed(button, message) {
    const { markTempoUsed } = await import("./combat.mjs");
    await markTempoUsed(button.dataset.combat, button.dataset.combatant, message);
  },
  async unbowedExempt(button) {
    const { exemptUnbowed } = await import("./combat.mjs");
    await exemptUnbowed(button.dataset.uuid, button.dataset.entry);
  },
};

/** `renderChatMessageHTML`: bind the GM's buttons on our cards (a player never sees a GM card's buttons work). */
export function onRenderChatMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const card = root?.querySelector?.(".gllvg-card");
  if (!card) return;
  for (const button of card.querySelectorAll("button[data-lvg-action]")) {
    if (!game.user?.isGM) {
      button.remove();
      continue;
    }
    if (button.dataset.lvgBound) continue;
    button.dataset.lvgBound = "1";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const handler = HANDLERS[button.dataset.lvgAction];
      if (!handler) return;
      button.disabled = true;
      try {
        await handler(button, message);
      } catch (error) {
        console.error("GLUniverse Suite | level-ground: card action failed", error);
      } finally {
        button.disabled = false;
      }
    });
  }
}

/* ── Break Away results, Assurance, on the active GM ──────────────────── */

const isActiveGM = () => !!game.user?.isActiveGM || game.users?.activeGM?.id === game.user?.id;

/** Write queue so two results landing together are two steps on the card, not one lost. */
let queue = Promise.resolve();

async function fileBreakAwayResult(message) {
  const ctx = message.flags?.pf2e?.context;
  const key = readTextOption(ctx?.options ?? [], OPT.breakAwayKey);
  if (!key) return;
  // The card is public: a blind or whispered roll is not filed on it, or its total and degree would reach every player.
  if (message.blind || (message.whisper?.length ?? 0) > 0) return;
  await diceSettled(message);
  const cardMessage = game.messages?.contents?.findLast?.((m) => flagOf(m, FLAGS.card)?.model?.key === key) ?? null;
  if (!cardMessage) return;
  const actorId = message.speaker?.actor ?? ctx?.actor ?? null;
  if (!actorId) return;
  const total = message.rolls?.[0]?.total ?? null;
  const outcome = ctx?.outcome ?? null;
  queue = queue
    .then(async () => {
      const fresh = game.messages.get(cardMessage.id);
      const model = foundry.utils.deepClone(flagOf(fresh, FLAGS.card)?.model ?? {});
      model.results ??= {};
      // A result filed for a PC who is not on the card is still filed: the roller fled.
      if (!model.rows?.some((r) => r.actorId === actorId)) {
        const actor = game.actors?.get(actorId);
        model.rows = [...(model.rows ?? []), { actorId, name: actor?.name ?? message.speaker?.alias ?? "?", skill: "athletics", dc: ctx?.dc?.value ?? "—", bonus: 0, inline: "" }];
      }
      model.results[actorId] = { total, outcome, result: breakAwayResult(outcome) };
      await updateCard(fresh, model);
    })
    .catch((error) => console.error("GLUniverse Suite | level-ground: Break Away result failed", error));
}

async function warnAssurance(message) {
  if (!on("assuranceWarnings")) return;
  const reason = assuranceProblem(message);
  if (!reason) return;
  await diceSettled(message);
  const name = message.actor?.name ?? message.speaker?.alias ?? "";
  const whisper = [...new Set([...gmIds(), message.author?.id].filter(Boolean))];
  await postCard("assurance", { name, reason }, { whisper });
}

/** `createChatMessage`: the active GM files Break Away results and flags Assurance. */
export function onCreateChatMessage(message) {
  if (!isActiveGM()) return;
  const ctx = message.flags?.pf2e?.context;
  if (!ctx) return;
  const options = ctx.options ?? [];
  if (isBreakAway(options)) fileBreakAwayResult(message).catch((error) => console.error(error));
  warnAssurance(message).catch((error) => console.error(error));
}
