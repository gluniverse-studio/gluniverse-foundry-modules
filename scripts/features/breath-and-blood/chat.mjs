/**
 * Breath and Blood — localisation and the chat card. Foundry glue.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { chatCardHTML } from "./views.mjs";

export const t = (key, data) => {
  try {
    return data && Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key);
  } catch {
    return key;
  }
};

/** Post one Breath and Blood card. */
export async function postCard(model, { actor = null, whisperGM = false } = {}) {
  try {
    const speaker = actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker();
    const data = {
      content: chatCardHTML(model, t),
      speaker,
      flags: { [SUITE_ID]: { bab: { card: true } } },
    };
    if (whisperGM) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
    return await ChatMessage.create(data);
  } catch (error) {
    warn("breath-and-blood | could not post a card", error);
    return null;
  }
}

export const notify = (key, data, level = "info") => {
  try {
    ui.notifications?.[level]?.(t(key, data));
  } catch {
    /* no ui under a check tool */
  }
};
