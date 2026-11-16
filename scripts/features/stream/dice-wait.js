import { diceSettled, hasDice } from "../../core/dice-wait.mjs";

const DICE_CEILING_MS = 10000;

/**
 * Resolves once Dice So Nice has finished showing a message's roll, so a card
 * never spoils a roll still tumbling. The dice part is core/dice-wait.mjs,
 * which yields a task before asking Dice So Nice: from a hook that runs before
 * Dice So Nice's own createChatMessage it would otherwise see nothing rolling.
 * A message with no roll waits a beat; a world with no Dice So Nice a little
 * longer, so a card never lands on top of the chat line it came from.
 */
export async function waitForDiceAnimation(message) {
  if (!hasDice(message)) return delay(120);
  if (message?.id && typeof globalThis.game?.dice3d?.waitFor3DAnimationByMessageID === "function") {
    return diceSettled(message, { timeout: DICE_CEILING_MS });
  }
  return delay(300);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
