/**
 * Breath and Blood — describing a healing source for `classifyHealing`.
 *
 * Pure over duck-typed pf2e objects, so the check tool drives it with
 * fixtures. What is read:
 *
 *   item (the `item` argument pf2e's applyDamage receives, which for a chat
 *   card is `ChatMessagePF2e#item`):
 *     spell     `spell.parentItem` (a scroll, wand or staff: an embedded spell),
 *               `spell.isCantrip`, `spell.spellcasting` with the getters
 *               `isPrepared` / `isSpontaneous` / `isInnate` / `isFocusPool` /
 *               `isRitual`, and an innate spell's `system.location.uses.max`
 *     physical  `traits` / `system.traits.value` has `infused`
 *     feat / action  `system.frequency.per` (a per-day ability)
 *   message (the card the user pressed apply on, when known):
 *     `flags.pf2e.casting.embeddedSpell` (cast from an item)
 *   rollOptions: `action:treat-wounds`, `action:battle-medicine` (pf2e's own
 *     Treat Wounds card carries the check's options on its healing roll)
 */

const PHYSICAL = new Set(["consumable", "equipment", "weapon", "armor", "shield", "treasure", "backpack", "book"]);

const traitsOf = (item) => {
  const t = item?.traits;
  if (t instanceof Set) return t;
  return new Set(item?.system?.traits?.value ?? []);
};

const optionSet = (o) => (o instanceof Set ? o : new Set(Array.isArray(o) ? o : []));

/** Is the spell's casting entry, read through pf2e's own getters, of a kind? */
function entryKind(spell) {
  const entry = spell?.spellcasting ?? null;
  if (!entry) return null;
  try {
    if (entry.isFocusPool) return "focus";
    if (entry.isRitual) return "ritual";
    if (entry.isInnate) return "innate";
    if (entry.isPrepared) return "prepared";
    if (entry.isSpontaneous) return "spontaneous";
    if (entry.category === "items") return "items";
  } catch {
    /* an entry without the getters */
  }
  return null;
}

/** The descriptor `classifyHealing` takes. */
export function describeSource({ item = null, message = null, rollOptions = null } = {}) {
  const opts = optionSet(rollOptions);
  if (opts.has("action:battle-medicine")) return { source: "battleMedicine" };
  if (opts.has("action:treat-wounds")) return { source: "treatWounds" };
  if (!item) {
    if (message?.flags?.pf2e?.casting?.embeddedSpell) return { source: "spell", embedded: true };
    return { source: "none" };
  }
  const type = item.type;
  if (type === "spell") {
    const entry = entryKind(item);
    const uses = Number(item.system?.location?.uses?.max ?? 0);
    return {
      source: "spell",
      embedded: !!item.parentItem || !!message?.flags?.pf2e?.casting?.embeddedSpell || entry === "items",
      cantrip: !!(item.isCantrip ?? traitsOf(item).has("cantrip")),
      entry,
      innateLimited: entry === "innate" && uses > 0,
    };
  }
  if (PHYSICAL.has(type)) return { source: "item", infused: traitsOf(item).has("infused") };
  if (type === "feat" || type === "action") {
    const per = item.system?.frequency?.per ?? null;
    return { source: "ability", perDay: per === "day" || per === "PT24H" };
  }
  if (type === "effect" || type === "condition") return { source: "none" };
  return { source: "item", infused: traitsOf(item).has("infused") };
}

/**
 * Is this healing message one of pf2e's fast-healing or regeneration
 * installments? `FastHealingRuleElement#onUpdateEncounter` posts a bare
 * healing roll at the start of the creature's turn: no `flags.pf2e.context`,
 * a flavor built from `PF2E.Encounter.Broadcast.FastHealing.<type>.ReceivedMessage`,
 * and the creature itself as the speaker.
 */
export function isRepeatingMessage(message, receivedTexts = []) {
  if (!message) return false;
  if (message.flags?.pf2e?.context) return false;
  const flavor = String(message.flavor ?? "");
  return receivedTexts.some((text) => text && flavor.includes(text));
}
