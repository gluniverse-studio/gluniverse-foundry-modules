/**
 * Initiative dice in the air: the rail must not show a rolled initiative, or
 * re-sort on it, before that roll's 3D dice have landed.
 *
 * The rail redraws from `updateCombatant`, not from the chat message, so the
 * hold is keyed on the message and applied to the combatant. What PF2e does
 * (pf2e.mjs, `ActorInitiative#roll` and `EncounterPF2e#rollInitiative`): the
 * check's chat message is created and awaited FIRST, and only then is the
 * tracker written (`setInitiative` / one `setMultipleInitiatives` for Roll All
 * after every message of the batch). So on every client `createChatMessage`
 * arrives before the `updateCombatant` that carries the number, and the
 * combatant still holds its old value when the message is seen. That is the
 * moment the old value and the old order are snapshotted.
 *
 * Foundry core's `Combat#rollInitiative` (systems that do not override it)
 * runs the other way round: the combatant update first, the messages one round
 * trip later. Nothing on that update marks it as a roll (`turnEvents: false` is
 * stamped on EVERY combatant update while a combat runs, by
 * `Combatant._preUpdateOperation`), so it cannot be told from a GM's edit
 * without a grace delay on every edit. That path is deliberately not held: the
 * hold starts only from a message, and a message that lands after its number
 * has already been drawn holds nothing (`hold` refuses a combatant whose value
 * already equals the roll's total), rather than hiding a number the table has
 * already seen.
 *
 * Fails open everywhere: no match, no dice, no Dice So Nice, a wait that times
 * out — the rail shows the truth. A GM-set initiative has no message and is
 * never held. Pure: no `game`, no DOM, no timers (the host owns those).
 */

/** Combat Intro's state flag (combat-intro/constants.mjs `FLAG`); pinned by combat-intro-check. */
export const COMBAT_INTRO_FLAG = "ci.state";

/** Is this chat message an ordinary initiative roll whose dice may be in the air? */
export function isInitiativeRollMessage(message, suiteId) {
  if (!message) return false;
  const flags = message.flags ?? {};
  // Combat Intro and Spotlight Roll post their own held cards after the result
  // is already on the table, with Dice So Nice told to skip them.
  if (flags["dice-so-nice"]?.skip) return false;
  if (suiteId && flags[suiteId]?.spotlight) return false;
  const rolls = Array.isArray(message.rolls) ? message.rolls : [];
  if (!rolls.length) return false;
  return flags.core?.initiativeRoll === true || flags.pf2e?.context?.type === "initiative";
}

/**
 * The combatants of `combatants` this message rolled for. Matched by token
 * first (a boss's extra turns share its token and are held with it), by actor
 * only when the message names no token.
 */
export function combatantsForMessage(combatants, message) {
  const list = Array.from(combatants ?? []).map(e => (Array.isArray(e) ? e[1] : e)).filter(Boolean);
  const speaker = message?.speaker ?? {};
  const context = message?.flags?.pf2e?.context ?? {};
  const tokenId = speaker.token || context.token || null;
  const actorId = speaker.actor || context.actor || null;
  if (tokenId) {
    const byToken = list.filter(c => (c.tokenId ?? c.token?.id) === tokenId);
    if (byToken.length) return byToken;
  }
  if (!actorId) return [];
  return list.filter(c => (c.actorId ?? c.actor?.id) === actorId);
}

/** The roll's total, or null. */
function totalOf(message) {
  const total = Number(message?.rolls?.[0]?.total);
  return Number.isFinite(total) ? total : null;
}

/**
 * Who is held, and as what. One entry per combatant: the value and the order
 * snapshotted when its first message arrived, and the messages still rolling
 * for it. A combatant is released when its last message settles.
 */
export class DiceHold {
  constructor() {
    this.entries = new Map();   // combatantId -> { initiative, messages: Set }
    this.baseOrder = [];        // turn ids when the oldest live hold began
  }

  get size() { return this.entries.size; }

  has(id) { return this.entries.has(id); }

  /**
   * Holds every combatant this message rolled for. `order` is the turn order
   * (ids) as it stands now, before the update. Returns the ids held.
   */
  hold(message, combatants, order = []) {
    const total = totalOf(message);
    const held = [];
    for (const c of combatants ?? []) {
      if (!c?.id) continue;
      const current = c.initiative ?? null;
      let entry = this.entries.get(c.id);
      if (!entry) {
        // Core order: the update already landed and the number is drawn. Holding
        // now would hide a number the table has seen.
        if (total !== null && current === total) continue;
        if (!this.entries.size) this.baseOrder = Array.from(order);
        entry = { initiative: current, messages: new Set() };
        this.entries.set(c.id, entry);
      }
      entry.messages.add(message.id);
      held.push(c.id);
    }
    return held;
  }

  /** The message's dice have landed (or the wait gave up). Returns true when anything was released. */
  release(messageId) {
    let changed = false;
    for (const [id, entry] of this.entries) {
      if (!entry.messages.delete(messageId)) continue;
      if (!entry.messages.size) { this.entries.delete(id); changed = true; }
    }
    if (!this.entries.size) this.baseOrder = [];
    return changed;
  }

  clear() {
    const had = this.entries.size > 0;
    this.entries.clear();
    this.baseOrder = [];
    return had;
  }

  /** The initiative the rail draws for this combatant. */
  initiativeOf(combatant) {
    const entry = combatant?.id ? this.entries.get(combatant.id) : null;
    return entry ? entry.initiative : combatant?.initiative;
  }

  /**
   * The turn order the rail draws: the truth for everyone who is not held, and
   * each held combatant back at the index it had when its dice were thrown.
   * Same elements, never fewer.
   */
  order(turns) {
    const list = Array.from(turns ?? []);
    if (!this.entries.size) return list;
    const out = list.filter(t => !this.entries.has(t?.id));
    const held = list.filter(t => this.entries.has(t?.id));
    const slot = id => { const i = this.baseOrder.indexOf(id); return i < 0 ? Infinity : i; };
    held.sort((x, y) => slot(x.id) - slot(y.id));
    for (const turn of held) out.splice(Math.min(slot(turn.id), out.length), 0, turn);
    return out;
  }
}
