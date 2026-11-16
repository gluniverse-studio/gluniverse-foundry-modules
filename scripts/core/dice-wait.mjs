/**
 * When have a chat message's 3D dice come to rest?
 *
 * Foundry tells every client about a roll the moment its message exists, which
 * with Dice So Nice is seconds before the dice stop. Anything that says what
 * the roll came to (a total on a press, damage taken off a bar, a chance that
 * narrows) has to wait for this first, or it gives the result away while the
 * dice are still in the air.
 *
 * Three things here fail silently, each of which has shipped wrong somewhere:
 *
 *   - `game.dice3d` is read at call time. Dice So Nice assigns it in its own
 *     ready hook, after the suite's init, so a snapshot is always empty.
 *   - Dice So Nice marks a message as animating in ITS createChatMessage hook.
 *     Asked from a hook that happens to run first, `waitFor3DAnimationByMessageID`
 *     sees no animation and resolves at once; one macrotask later it is set.
 *   - That promise settles only on the message's own completion signal, which
 *     rapid rolls can lose. The wait is raced against `timeout`, so a caller is
 *     late at worst and never silent.
 *
 * With no Dice So Nice, no roll on the message, or no animation for this
 * client (a hidden roll, "only my rolls"), it resolves as soon as it can.
 * It never rejects.
 */

export const DICE_WAIT_MS = 8000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Does this message carry dice Dice So Nice might be throwing? */
export function hasDice(message) {
  return Array.isArray(message?.rolls) ? message.rolls.length > 0 : !!message?.isRoll;
}

/**
 * Resolves once the message's dice have landed on this client.
 * @param {object} message   a ChatMessage (needs `id` and `rolls`)
 * @param {{ timeout?: number, dice3d?: object|null }} [o]
 *   `dice3d` is injected by the check tools; live it is read from `game`.
 */
export async function diceSettled(message, { timeout = DICE_WAIT_MS, dice3d } = {}) {
  if (!message?.id || !hasDice(message)) return;
  const board = () => (dice3d !== undefined ? dice3d : globalThis.game?.dice3d);
  if (typeof board()?.waitFor3DAnimationByMessageID !== "function") return;
  await pause(0);
  try {
    await Promise.race([Promise.resolve(board()?.waitFor3DAnimationByMessageID?.(message.id)), pause(timeout)]);
  } catch { /* a board that throws is a board that is not rolling */ }
}
