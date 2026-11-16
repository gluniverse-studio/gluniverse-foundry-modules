/**
 * PF2e HUD — the party's checks, and a check the GM calls for.
 *
 * Two things a GM does all session and has no quick way to do:
 *
 *   - read who in the party is good at what, and roll one of those checks
 *     for a player without the table seeing it (a secret Perception, a
 *     Stealth the character does not know the result of);
 *   - say "everybody roll Athletics", and have every player find it.
 *
 * The first is a grid (`partyChecks`): a row per check, a column per
 * character. The second is a CALL: a message on the suite socket to the
 * players' clients, which puts one press on each of their rails. A call is
 * never stored. It is the GM's sentence, and it ends when it is answered,
 * when the GM takes it back, or after `CALL_LIFE`.
 *
 * Three things here fail silently.
 *
 *   - A call is honoured only from a sender the SERVER names and who is a
 *     GM. The payload's own word for who sent it is never read.
 *   - A call's `check` is one of the keys this module rolls and nothing
 *     else: it becomes a `data-check` on somebody else's screen.
 *   - The DC is the GM's number. It rides the call only when the GM chose
 *     to show it; hidden, the player's roll carries no DC at all and the GM
 *     reads the total, because a DC handed to PF2e is printed on the card.
 *
 * Pure: no game, no DOM. The host owns the socket and the clock.
 */
import { SAVES } from "./const.mjs";
import { SKILLS } from "./read.mjs";

/** How long a call stands on a player's rail unanswered. */
export const CALL_LIFE = 120000;
/** The lowest and highest DC a call may carry (PF2e's own table runs 5–50). */
export const DC_RANGE = Object.freeze([0, 60]);

/** Every check a call may name, in the grid's order. */
export const CALL_CHECKS = Object.freeze(["perception", ...SAVES, ...SKILLS.map((s) => `skill:${s}`)]);

const list = (x) => (Array.isArray(x) ? x : x ? [...x] : []);
const int = (x) => (Number.isFinite(+x) ? Math.trunc(+x) : null);

/** The statistic a check key rolls on an actor. */
export function statisticOf(actor, check) {
  if (check === "perception") return actor?.perception ?? null;
  if (SAVES.includes(check)) return actor?.saves?.[check] ?? null;
  if (typeof check === "string" && check.startsWith("skill:")) return actor?.skills?.[check.slice(6)] ?? null;
  return null;
}

/** A DC as typed: a whole number in range, or null (no DC). */
export function dcOf(x) {
  if (x == null || String(x).trim() === "") return null;
  const n = int(x);
  return n == null || n < DC_RANGE[0] || n > DC_RANGE[1] ? null : n;
}

/**
 * The grid. `members` is [{ actor }] (the party as the host reads it);
 * `name(check)` localises a row.
 * → { members: [{ id, name, img }], rows: [{ check, name, group, cells: [{ id, mod, rank, best }] }] }
 * `best` marks the highest modifier in a row (every holder of it, on a tie),
 * and never a row where everybody is equal.
 */
export function partyChecks(members, { name }) {
  const pcs = list(members).map((m) => m.actor).filter(Boolean);
  const rows = CALL_CHECKS.map((check) => {
    const cells = pcs.map((a) => {
      const s = statisticOf(a, check);
      return { id: a.id, mod: int(s?.mod ?? s?.check?.mod), rank: int(s?.rank) ?? 0 };
    });
    const mods = cells.map((c) => c.mod).filter((m) => m != null);
    const top = mods.length ? Math.max(...mods) : null;
    const flat = mods.every((m) => m === top);
    for (const c of cells) c.best = !flat && c.mod != null && c.mod === top;
    return { check, name: name(check), group: check === "perception" ? "perception" : SAVES.includes(check) ? "save" : "skill", cells };
  });
  return { members: pcs.map((a) => ({ id: a.id, name: a.name, img: a.img ?? null })), rows };
}

/**
 * A call as it leaves the GM. `showDc` false keeps the number at home.
 * → the socket payload, or null when the check is not one a call may name.
 */
export function makeCall({ check, dc = null, showDc = false, id, at }) {
  if (!CALL_CHECKS.includes(check)) return null;
  const n = dcOf(dc);
  return { type: "call", id: String(id), check, at: +at || 0, ...(showDc && n != null ? { dc: n } : {}) };
}

/**
 * A payload as it arrives on a player's client. Total: anything that is not
 * a well-formed call from a GM is null, and nothing else of it is kept.
 * `fromGM` is the host's answer about the server-attested sender.
 */
export function readCall(payload, { fromGM = false, now = 0 } = {}) {
  if (!fromGM || !payload || typeof payload !== "object") return null;
  if (payload.type === "end") return typeof payload.id === "string" ? { end: payload.id.slice(0, 64) } : null;
  if (payload.type !== "call" || !CALL_CHECKS.includes(payload.check) || typeof payload.id !== "string") return null;
  const dc = dcOf(payload.dc);
  return { id: payload.id.slice(0, 64), check: payload.check, until: now + CALL_LIFE, ...(dc != null ? { dc } : {}) };
}

/** Is this call still standing at `now`? */
export const callLive = (call, now) => !!call && !call.end && now < (call.until ?? 0);

/**
 * What a player's rail draws for a call, for the character in hand.
 * → { id, check, name, mod, dc? } or null (no call, or a character with no
 * such statistic).
 */
export function callModel(call, actor, { name, now = 0 } = {}) {
  if (!callLive(call, now) || !actor) return null;
  const s = statisticOf(actor, call.check);
  if (!s) return null;
  return { id: call.id, check: call.check, name: name(call.check), mod: int(s.mod ?? s.check?.mod) ?? 0, ...(call.dc != null ? { dc: call.dc } : {}) };
}

/**
 * Did this chat message answer the call? A check by one of the called
 * characters on the called statistic, posted after the call went out.
 * `ctx` is the message's PF2e context (`flags.pf2e.context`).
 */
export function answersCall(call, { actorId, ctx, at }) {
  if (!call || !actorId || !ctx || (at ?? 0) < (call.at ?? 0)) return false;
  const slug = call.check.startsWith("skill:") ? call.check.slice(6) : call.check;
  const domains = list(ctx.domains);
  const type = ctx.type;
  if (call.check === "perception") return type === "perception-check" || domains.includes("perception");
  if (SAVES.includes(call.check)) return type === "saving-throw" && domains.includes(slug);
  return type === "skill-check" && domains.includes(slug);
}
