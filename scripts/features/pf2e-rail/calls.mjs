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
 * A call says two more things. WHO: the whole party, or the characters the
 * GM picked, in which case it is sent to their players alone and no other
 * client hears that it was made. HOW the roll is posted (`CALL_MODES`,
 * Foundry's own message modes): `public` for the table, `gm` for the
 * roller and the GM, `blind` for the GM alone.
 *
 * Five things here fail silently.
 *
 *   - A call is honoured only from a sender the SERVER names and who is a
 *     GM. The payload's own word for who sent it is never read.
 *   - A call's `check` is one of the keys this module rolls and nothing
 *     else: it becomes a `data-check` on somebody else's screen.
 *   - The DC is the GM's number. It rides the call only when the GM chose
 *     to show it; hidden, the player's roll carries no DC at all and the GM
 *     reads the total, because a DC handed to PF2e is printed on the card.
 *   - A call for some of the party goes to those players and nobody else
 *     (`callRecipients`): the server filters by recipient, so a payload
 *     sent wider and ignored by the others is still in their socket.
 *   - Each player's payload names only the characters of THEIRS that were
 *     called (`who`), never the rest of the list.
 *
 * Pure: no game, no DOM. The host owns the socket and the clock.
 */
import { SAVES } from "./const.mjs";
import { SKILLS } from "./read.mjs";

/** How long a call stands on a player's rail unanswered. */
export const CALL_LIFE = 120000;
/** The lowest and highest DC a call may carry (PF2e's own table runs 5–50). */
export const DC_RANGE = Object.freeze([0, 60]);

/** How a called roll is posted: Foundry's message modes, less `self`. */
export const CALL_MODES = Object.freeze(["public", "gm", "blind"]);
/** The most characters one payload names. */
const WHO_MAX = 16;

/** Every check a call may name, in the grid's order. */
export const CALL_CHECKS = Object.freeze(["perception", ...SAVES, ...SKILLS.map((s) => `skill:${s}`)]);

const list = (x) => (Array.isArray(x) ? x : x ? [...x] : []);
const int = (x) => (Number.isFinite(+x) ? Math.trunc(+x) : null);
const ids = (x) => [...new Set(list(x).filter((v) => typeof v === "string" && v).map((v) => v.slice(0, 64)))].slice(0, WHO_MAX);

/** A mode as given: one of `CALL_MODES`, else the open roll. */
export const modeOf = (x) => (CALL_MODES.includes(x) ? x : "public");

/**
 * The characters a call is for. `who` is the GM's pick (actor ids); an
 * empty pick, or one that names nobody in the party, is the whole party.
 */
export function callTargets(members, who) {
  const all = list(members).map((m) => m?.actor?.id ?? m?.id).filter(Boolean);
  const pick = ids(who).filter((id) => all.includes(id));
  return pick.length ? pick : all;
}

/**
 * Who hears a call. `users` is [{ id, active, isGM, character, owns(actorId) }].
 * A character's call goes to the connected player it is assigned to; with
 * no such player, to the connected players who own it (a world where
 * everybody owns everything would otherwise tell the whole table).
 * → { to: Map(userId → [actorId]), away: [actorId] } — `away` has nobody
 * connected to answer for it.
 */
export function callRecipients(targets, users) {
  const players = list(users).filter((u) => u?.active && !u.isGM);
  const to = new Map(), away = [];
  for (const id of list(targets)) {
    const own = players.filter((u) => u.character === id);
    const hear = own.length ? own : players.filter((u) => u.owns?.(id));
    if (!hear.length) { away.push(id); continue; }
    for (const u of hear) to.set(u.id, [...(to.get(u.id) ?? []), id]);
  }
  return { to, away };
}

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
 * A call as it leaves the GM, for ONE player. `showDc` false keeps the
 * number at home; `who` is the characters of that player's it is for.
 * → the socket payload, or null when the check is not one a call may name.
 */
export function makeCall({ check, dc = null, showDc = false, mode = "public", who = [], id, at }) {
  if (!CALL_CHECKS.includes(check)) return null;
  const n = dcOf(dc);
  return { type: "call", id: String(id), check, at: +at || 0, mode: modeOf(mode), who: ids(who), ...(showDc && n != null ? { dc: n } : {}) };
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
  return { id: payload.id.slice(0, 64), check: payload.check, mode: modeOf(payload.mode), who: ids(payload.who), until: now + CALL_LIFE, ...(dc != null ? { dc } : {}) };
}

/** Is this call still standing at `now`? */
export const callLive = (call, now) => !!call && !call.end && now < (call.until ?? 0);

/**
 * What a player's rail draws for a call, for the character in hand.
 * → { id, check, name, mod, mode, left, life, dc? } or null (no call, a
 * character it was not made for, or one with no such statistic). `left` of
 * `life` is how long it still stands, which the bar drains by.
 */
export function callModel(call, actor, { name, now = 0 } = {}) {
  if (!callLive(call, now) || !actor) return null;
  if (list(call.who).length && !call.who.includes(actor.id)) return null;
  const s = statisticOf(actor, call.check);
  if (!s) return null;
  return { id: call.id, check: call.check, name: name(call.check), mod: int(s.mod ?? s.check?.mod) ?? 0, mode: modeOf(call.mode),
    left: Math.max(0, call.until - now), life: CALL_LIFE, ...(call.dc != null ? { dc: call.dc } : {}) };
}

/**
 * The call that is out, as the GM's grid draws it. `out` is the host's
 * record: { check, mode, until, targets, away, answered: Map(id → { total?, degree? }) }.
 * → { check, name, mode, left, life, n, of, targets: [{ id, name, img, state, total?, degree? }] }
 * `state` is "in" (rolled), "wait", or "away" (nobody connected to answer).
 */
export function outModel(out, members, { name, now = 0 } = {}) {
  if (!out) return null;
  const by = new Map(list(members).map((m) => [m.id, m]));
  const got = out.answered instanceof Map ? out.answered : new Map(list(out.answered).map((id) => [id, {}]));
  const targets = list(out.targets).filter((id) => by.has(id)).map((id) => {
    const a = got.get(id), m = by.get(id);
    return { id, name: m.name, img: m.img ?? null, state: a ? "in" : list(out.away).includes(id) ? "away" : "wait",
      ...(a?.total != null ? { total: a.total } : {}), ...(a?.degree != null ? { degree: a.degree } : {}) };
  });
  return { check: out.check, name: name(out.check), mode: modeOf(out.mode), left: Math.max(0, (out.until ?? 0) - now), life: CALL_LIFE,
    n: targets.filter((x) => x.state === "in").length, of: targets.length, targets };
}

/**
 * Did this chat message answer the call? A check by one of the called
 * characters (`call.targets`, where the call names them) on the called
 * statistic, posted after the call went out.
 * `ctx` is the message's PF2e context (`flags.pf2e.context`).
 */
export function answersCall(call, { actorId, ctx, at }) {
  if (!call || !actorId || !ctx || (at ?? 0) < (call.at ?? 0)) return false;
  if (call.targets && !list(call.targets).includes(actorId)) return false;
  const slug = call.check.startsWith("skill:") ? call.check.slice(6) : call.check;
  const domains = list(ctx.domains);
  const type = ctx.type;
  if (call.check === "perception") return type === "perception-check" || domains.includes("perception");
  if (SAVES.includes(call.check)) return type === "saving-throw" && domains.includes(slug);
  return type === "skill-check" && domains.includes(slug);
}
