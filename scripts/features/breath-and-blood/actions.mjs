/**
 * Breath and Blood — the commands: Catch Your Breath, Steel Your Resolve,
 * Hold On, Lend Strength, Encouraging Words, the breather (with Bind Your Own
 * Wounds and a shared breather's Lend Strength), nights, returning from death
 * and direct damage. Each reads the actor as the rules' state, runs the pure
 * procedure (`rules.mjs`) and writes the difference.
 *
 * A command that changes an actor the user does not own (Lend Strength and
 * Encouraging Words on another player's character, Treat Wounds on a patient)
 * goes over the suite socket to the active GM, who honours it only on the
 * server-attested sender (`meta.attested`) owning the giver, the speaker or the
 * healer, and recomputes the procedure from the live actors.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { emitSocket } from "../../core/socket.mjs";
import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import {
  bab, canWrite, commitState, flagPath, hasFeat, isCharacter, isTwoPool, nightFlagUpdate, poolActor, readState, tokenOf, PREP,
} from "./actor.mjs";
import { FEATS, FEATURE_ID, FLAG, OPTION } from "./constants.mjs";
import { postCard, notify, t } from "./chat.mjs";
import { DIRECT, NO_MEND } from "./damage.mjs";
import * as R from "./rules.mjs";
import { holdOnDialogHTML, directDialogHTML } from "./views.mjs";

let _active = () => false;
let _dials = () => ({});
export function configureActions({ active, dials }) {
  _active = active;
  _dials = dials;
}

/* ── Plumbing ────────────────────────────────────────────────────────────── */

/** Resolve an actor reference sent over the socket. */
export function resolveActor(uuid) {
  try {
    const doc = fromUuidSync(uuid);
    if (!doc) return null;
    if (doc.documentName === "Actor") return doc;
    return doc.actor ?? null;
  } catch {
    return null;
  }
}

const gmOnline = () => !!game.users?.activeGM;

/** Run on this client when it may write every actor, else ask the active GM. */
async function routed(op, payload, actors, local) {
  if (actors.every((a) => canWrite(a))) return local();
  if (!gmOnline()) {
    notify("GLBAB.notify.noGM", null, "warn");
    return null;
  }
  emitSocket(FEATURE_ID, { op, ...payload }, { recipients: [game.users.activeGM.id] });
  notify("GLBAB.notify.sent");
  return null;
}

/** Refuse with the rules' reason. */
function refuse(actor, reason, data = {}) {
  notify(`GLBAB.refuse.${reason}`, { name: actor?.name ?? "", ...data }, "warn");
  return { ok: false, reason };
}

function requireTwoPool(actor) {
  if (!_active() || !globalThis.game?.pf2e?.settings?.variants?.stamina) return "variantOff";
  if (!actor || !isTwoPool(actor)) return "notTwoPools";
  return null;
}

/* ── Marker effects (visible on the token; the flag is the truth) ────────── */

const EW_SLUG = "glbab-encouraging-words";

async function setMarker(actor, on, { slug, name, img, duration, flags = {} }) {
  const existing = (actor.itemTypes?.effect ?? []).filter((e) => e.system?.slug === slug);
  if (!on) {
    if (existing.length) await actor.deleteEmbeddedDocuments("Item", existing.map((e) => e.id));
    return;
  }
  if (existing.length) return;
  await actor.createEmbeddedDocuments("Item", [
    {
      type: "effect",
      name,
      img,
      system: {
        slug,
        duration: duration ?? { value: -1, unit: "unlimited", sustained: false, expiry: null },
        tokenIcon: { show: true },
        rules: [],
      },
      flags: { [SUITE_ID]: { bab: flags } },
    },
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   CATCH YOUR BREATH, STEEL YOUR RESOLVE
   ══════════════════════════════════════════════════════════════════════════ */

export async function catchYourBreath(actor, { free = false } = {}) {
  const bad = requireTwoPool(actor);
  if (bad) return refuse(actor, bad);
  if (!canWrite(actor)) return refuse(actor, "notOwner");
  const holder = poolActor(actor);
  if (free) {
    if (!hasFeat(actor, FEATS.steelYourResolve) && !hasFeat(holder, FEATS.steelYourResolve)) return refuse(actor, "noFeat", { feat: t("GLBAB.feat.steel") });
    if (bab(holder)[FLAG.steelUsed]) return refuse(actor, "steelUsed");
  }
  const before = readState(holder);
  const r = R.catchYourBreath(before, { free });
  if (!r.ok) return refuse(actor, r.reason);
  const extra = free ? { [flagPath(FLAG.steelUsed)]: true } : {};
  await commitState(holder, before, r.state, { extra, tag: "catch" });
  const lines = [{ k: "GLBAB.card.catch", d: { gained: r.gained, sp: r.state.sp, max: r.state.maxSP } }];
  lines.push(free ? { k: "GLBAB.card.steel" } : { k: "GLBAB.card.rpSpent", d: { rp: 1 } });
  if (hasFeat(actor, FEATS.surge)) lines.push({ k: "GLBAB.card.surge" });
  await postCard({ title: { k: "GLBAB.card.catchTitle", d: { name: actor.name } }, tone: "good", rows: [{ lines }] }, { actor });
  return { ok: true, state: r.state };
}

/* ══════════════════════════════════════════════════════════════════════════
   HOLD ON
   ══════════════════════════════════════════════════════════════════════════ */

export async function holdOn(actor) {
  const bad = requireTwoPool(actor);
  if (bad) return refuse(actor, bad);
  if (!canWrite(actor)) return refuse(actor, "notOwner");
  const holder = poolActor(actor);
  const before = readState(holder);
  const r = R.holdOn(before);
  if (!r.ok) return refuse(actor, r.reason);
  await commitState(holder, before, r.state, { tag: "holdOn" });
  const lines = [{ k: "GLBAB.card.holdOn", d: { dying: r.state.dying } }, { k: "GLBAB.card.rpSpent", d: { rp: 1 } }];
  if (r.stabilized) lines.push({ k: "GLBAB.card.stabilized", d: { wounded: r.state.wounded } });
  await postCard({ title: { k: "GLBAB.card.holdOnTitle", d: { name: actor.name } }, tone: "warn", rows: [{ lines }] }, { actor });
  return { ok: true, state: r.state };
}

/** `rollRecovery`: an actor with Resolve Points is asked first. */
async function recoveryWrapper(wrapped, ...args) {
  try {
    const actor = this;
    if (!_active() || !isTwoPool(actor) || !canWrite(actor)) return wrapped(...args);
    const s = readState(actor);
    if (s.rp < 1 || s.dying < 1) return wrapped(...args);
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: t("GLBAB.holdOn.title", { name: actor.name }), icon: "fa-solid fa-hand-fist" },
      classes: ["glbab-dialog-frame"],
      content: holdOnDialogHTML({ name: actor.name, dying: s.dying, rp: s.rp }, t),
      rejectClose: false,
      buttons: [
        { action: "holdOn", label: t("GLBAB.holdOn.use"), default: true },
        { action: "roll", label: t("GLBAB.holdOn.roll") },
      ],
    });
    if (choice === "holdOn") {
      await holdOn(actor);
      return null;
    }
    if (choice === "roll") return wrapped(...args);
    return null;
  } catch (error) {
    warn("breath-and-blood | Hold On prompt failed; rolling as printed", error);
    return wrapped(...args);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   LEND STRENGTH, ENCOURAGING WORDS
   ══════════════════════════════════════════════════════════════════════════ */

export async function lendStrength(giver, taker, { free = false } = {}) {
  const bad = requireTwoPool(giver) ?? requireTwoPool(taker);
  if (bad) return refuse(giver, bad);
  if (!canWrite(giver)) return refuse(giver, "notOwner");
  return routed("lend", { giver: giver.uuid, taker: taker.uuid, free }, [giver, taker], () => commitLend(giver, taker, { free }));
}

export async function commitLend(giver, taker, { free = false } = {}) {
  const g = poolActor(giver);
  const tk = poolActor(taker);
  if (!isTwoPool(g) || !isTwoPool(tk)) return refuse(giver, "notTwoPools");
  const gs = readState(g);
  const ts = readState(tk);
  const r = R.lendStrength(gs, ts, { same: g === tk });
  if (!r.ok) {
    await postCard({ title: { k: "GLBAB.card.lendTitle", d: { giver: giver.name, taker: taker.name } }, tone: "warn", rows: [{ lines: [{ k: `GLBAB.refuse.${r.reason}`, d: { name: taker.name } }] }] }, { actor: giver });
    return { ok: false, reason: r.reason };
  }
  await commitState(g, gs, r.giver, { tag: "lend" });
  await commitState(tk, ts, r.taker, { tag: "lend" });
  const lines = [{ k: "GLBAB.card.lend", d: { giver: giver.name, taker: taker.name, rp: r.taker.rp, max: r.taker.maxRP } }];
  if (free) lines.push({ k: "GLBAB.card.lendFree" });
  await postCard({ title: { k: "GLBAB.card.lendTitle", d: { giver: giver.name, taker: taker.name } }, tone: "good", rows: [{ lines }] }, { actor: giver });
  return { ok: true };
}

export async function encouragingWords(speaker, ally) {
  if (!speaker || !ally) return refuse(speaker, "noTarget");
  const bad = requireTwoPool(ally);
  if (bad) return refuse(ally, bad);
  if (!canWrite(speaker)) return refuse(speaker, "notOwner");
  if (!hasFeat(speaker, FEATS.encouragingWords)) return refuse(speaker, "noFeat", { feat: t("GLBAB.feat.words") });
  return routed("words", { speaker: speaker.uuid, ally: ally.uuid }, [ally], () => commitWords(speaker, ally));
}

export async function commitWords(speaker, ally) {
  const holder = poolActor(ally);
  if (!isTwoPool(holder)) return refuse(ally, "notTwoPools");
  const before = readState(holder);
  const r = R.encouragingWords(Number(speaker.level) || 0, before);
  if (!r.ok) {
    await postCard({ title: { k: "GLBAB.card.wordsTitle", d: { speaker: speaker.name, ally: ally.name } }, tone: "warn", rows: [{ lines: [{ k: `GLBAB.refuse.${r.reason}`, d: { name: ally.name } }] }] }, { actor: speaker });
    return { ok: false, reason: r.reason };
  }
  await commitState(holder, before, r.state, { tag: "words" });
  try {
    await setMarker(holder, true, { slug: EW_SLUG, name: t("GLBAB.effect.words"), img: "icons/svg/sound.svg", flags: { ewMarker: true } });
  } catch (error) {
    warn("breath-and-blood | could not mark Encouraging Words immunity", error);
  }
  await postCard(
    { title: { k: "GLBAB.card.wordsTitle", d: { speaker: speaker.name, ally: ally.name } }, tone: "good", rows: [{ lines: [{ k: "GLBAB.card.words", d: { gained: r.gained, sp: r.state.sp, max: r.state.maxSP } }, { k: "GLBAB.card.wordsImmune" }] }] },
    { actor: speaker },
  );
  return { ok: true };
}

/* ══════════════════════════════════════════════════════════════════════════
   THE BREATHER
   ══════════════════════════════════════════════════════════════════════════ */

const unique = (actors) => {
  const seen = new Set();
  const out = [];
  for (const a of actors) {
    const h = a && poolActor(a);
    if (!h || seen.has(h.uuid)) continue;
    seen.add(h.uuid);
    out.push({ actor: a, holder: h });
  }
  return out;
};

/**
 * End a breather for these actors. `bind`: actors (or ids) who Bound Their Own
 * Wounds as their activity; `lend`: [{ giver, taker }] during the shared breather.
 * Order: Lend Strength, then Bind Your Own Wounds, then `breather()`.
 */
export async function breather(actors, { bind = [], lend = [] } = {}) {
  const d = _dials();
  if (!_active()) return [];
  for (const pair of lend) {
    if (pair?.giver && pair?.taker) await lendStrength(pair.giver, pair.taker, { free: true });
  }
  const bindIds = new Set(bind.map((a) => (typeof a === "string" ? a : a?.id)));
  const out = [];
  for (const { actor, holder } of unique(actors)) {
    if (!isTwoPool(holder) || !canWrite(holder)) continue;
    const before = readState(holder);
    let s = before;
    const lines = [];
    if (bindIds.has(actor.id) || bindIds.has(holder.id)) {
      const b = R.bindYourOwnWounds(s);
      if (b.ok) {
        s = b.state;
        lines.push({ k: "GLBAB.card.bind", d: { hp: b.heal.toHP } });
      } else lines.push({ k: `GLBAB.refuse.${b.reason}`, d: { name: actor.name } });
    }
    const r = R.breather(s, { lingeringWounds: d.lingeringWounds });
    if (r.woke) lines.push({ k: "GLBAB.card.woke" });
    if (r.spGained > 0) lines.push({ k: "GLBAB.card.spRestored", d: { sp: r.state.sp, max: r.state.maxSP } });
    else if (r.state.hp < 1) lines.push({ k: "GLBAB.card.noSP" });
    if (r.woundedBefore !== r.woundedAfter) {
      lines.push(r.woundedAfter > 0 ? { k: "GLBAB.card.woundedLower", d: { value: r.woundedAfter } } : { k: "GLBAB.card.woundedGone" });
    } else if (r.woundedBefore > 0) lines.push({ k: "GLBAB.card.woundedStays", d: { value: r.woundedBefore } });
    try {
      await commitState(holder, before, r.state, { extra: { [flagPath(FLAG.covers)]: {} }, tag: r.woke ? "waking" : "breather" });
    } catch (error) {
      warn("breath-and-blood | breather write failed", error);
      continue;
    }
    await postCard({ title: { k: "GLBAB.card.breatherTitle", d: { name: actor.name } }, tone: "good", rows: [{ lines }] }, { actor });
    out.push({ actor, state: r.state });
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   NIGHTS
   ══════════════════════════════════════════════════════════════════════════ */

/** Actor ids inside our own night: pf2e's `pf2e.restForTheNight` hook skips them. */
const NIGHT_RUNNING = new Set();

const recovery = (actor) => {
  const hp = actor.system?.attributes?.hp ?? {};
  return { multiplier: Number(hp.recoveryMultiplier ?? 1) || 1, addend: Number(hp.recoveryAddend ?? 0) || 0 };
};

/**
 * A night for these actors. `kinds`: { [actorId]: "rest" | "rough" | "haven" }.
 * Characters run pf2e's own `restForTheNight` (Hit Points, conditions, spell
 * slots, daily preparations) and are corrected after it; NPC and familiar
 * companions run the rules' night on their flags.
 */
export async function night(actors, kinds = {}) {
  const d = _dials();
  if (!_active()) return [];
  const rows = unique(actors)
    .filter(({ holder }) => isTwoPool(holder) && canWrite(holder))
    .map(({ actor, holder }) => {
      let kind = kinds[actor.id] ?? kinds[holder.id] ?? "rest";
      if (kind === "haven" && !d.havens) kind = "rest";
      if (!R.NIGHTS.includes(kind)) kind = "rest";
      return { actor, holder, kind, before: readState(holder) };
    });
  const chars = rows.filter((r) => isCharacter(r.holder));
  for (const r of rows) {
    NIGHT_RUNNING.add(r.holder.id);
    NO_MEND.add(r.holder.uuid);
  }
  try {
    if (chars.length) await game.pf2e.actions.restForTheNight({ actors: chars.map((r) => r.holder), skipDialog: true });
    for (const r of rows) await correctNight(r.holder, r.kind, r.before, { character: isCharacter(r.holder), actor: r.actor });
  } finally {
    for (const r of rows) {
      NIGHT_RUNNING.delete(r.holder.id);
      NO_MEND.delete(r.holder.uuid);
    }
  }
  return rows;
}

/**
 * After pf2e's rest (characters) or in its place (flag pools): Resolve Points
 * by the kind of night, a haven's second helping of Hit Points, wounded gone,
 * every daily flag cleared.
 */
async function correctNight(actor, kind, before, { character = true, actor: shown = actor } = {}) {
  const now = readState(actor);
  const { multiplier, addend } = recovery(actor);
  let after;
  const lines = [{ k: `GLBAB.card.night.${kind}` }];
  if (character) {
    const restored = R.nightRestores({ con: now.con, level: now.level, multiplier, addend });
    after = {
      ...now,
      sp: now.maxSP,
      rp: kind === "rough" && before ? Math.min(now.maxRP, before.rp + 2) : now.maxRP,
      hp: kind === "haven" ? Math.min(now.maxHP, now.hp + restored) : now.hp,
      wounded: 0,
      caughtBreath: false,
      strengthLent: false,
      ewImmune: false,
      mended: false,
    };
    if (kind === "haven" && after.hp > now.hp) lines.push({ k: "GLBAB.card.haven", d: { hp: after.hp - now.hp } });
  } else {
    after = R.night(now, kind, { multiplier, addend });
    if (after.hp > now.hp) lines.push({ k: "GLBAB.card.nightHP", d: { hp: after.hp - now.hp } });
  }
  lines.push({ k: "GLBAB.card.nightRP", d: { rp: after.rp, max: after.maxRP } });
  if (now.wounded > 0) lines.push({ k: "GLBAB.card.woundedGone" });
  await commitState(actor, now, after, { extra: nightFlagUpdate(), tag: "night" });
  try {
    await setMarker(actor, false, { slug: EW_SLUG });
  } catch {
    /* the flag is the truth */
  }
  await postCard({ title: { k: "GLBAB.card.nightTitle", d: { name: shown.name } }, tone: "info", rows: [{ lines }] }, { actor: shown });
}

/** pf2e's own Rest for the Night, started from its sheet: the "rest" corrections. */
async function onSystemRest(actor) {
  try {
    if (!_active() || NIGHT_RUNNING.has(actor?.id) || !isTwoPool(actor) || !canWrite(actor)) return;
    await correctNight(actor, "rest", null, { character: true });
  } catch (error) {
    warn("breath-and-blood | could not correct pf2e's rest", error);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   GM: RETURNING FROM DEATH, DIRECT DAMAGE
   ══════════════════════════════════════════════════════════════════════════ */

export async function returnFromDeath(actor) {
  if (!game.user.isGM) return refuse(actor, "notOwner");
  const bad = requireTwoPool(actor);
  if (bad) return refuse(actor, bad);
  const holder = poolActor(actor);
  const before = readState(holder);
  const after = R.returnFromDeath(before);
  await commitState(holder, before, after, { tag: "returned" });
  await postCard({ title: { k: "GLBAB.card.returnedTitle", d: { name: actor.name } }, tone: "info", rows: [{ lines: [{ k: "GLBAB.card.returned" }] }] }, { actor });
  return { ok: true };
}

/** Damage to temporary Hit Points, then Hit Points, skipping Stamina Points. */
export async function applyDirectDamage(actor, amount) {
  const n = Math.max(0, Math.trunc(Number(amount) || 0));
  if (!n) return { ok: false };
  const bad = requireTwoPool(actor);
  if (bad) return refuse(actor, bad);
  if (!canWrite(actor)) return refuse(actor, "notOwner");
  const holder = poolActor(actor);
  const token = tokenOf(holder);
  if (token) {
    DIRECT.add(holder);
    try {
      await holder.applyDamage({ damage: n, token, final: true });
    } finally {
      DIRECT.delete(holder);
    }
    return { ok: true };
  }
  const before = readState(holder);
  const r = R.damage(before, n, { direct: true });
  await commitState(holder, before, r.state, { tag: "direct" });
  await postCard({ title: { k: "GLBAB.card.directTitle", d: { name: actor.name } }, tone: "bad", rows: [{ lines: [{ k: "GLBAB.card.direct", d: { amount: n, hp: r.state.hp } }] }] }, { actor });
  return { ok: true };
}

/** Ask for an amount, then apply it as direct damage. */
export async function promptDirectDamage(actor, amount = 0) {
  const n = Number(amount) || 0;
  if (n > 0) return applyDirectDamage(actor, n);
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("GLBAB.gm.direct") },
    classes: ["glbab-dialog-frame"],
    content: directDialogHTML({ name: actor.name, amount: 0 }, t),
    rejectClose: false,
    ok: { label: t("GLBAB.gm.direct"), callback: (_e, button) => Number(button.form?.elements?.amount?.value) || 0 },
  });
  return value ? applyDirectDamage(actor, value) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
   SOCKET (active GM only, on the server-attested sender)
   ══════════════════════════════════════════════════════════════════════════ */

export async function onSocketMessage(payload, _claimed, meta, { commitMedicine }) {
  if (!_active() || game.users?.activeGM !== game.user) return;
  const user = meta?.attested ? game.users.get(meta.attested) : null;
  if (!user) return;
  const owns = (actor) => !!actor && (user.isGM || actor.testUserPermission?.(user, "OWNER"));
  switch (payload?.op) {
    case "lend": {
      const giver = resolveActor(payload.giver);
      const taker = resolveActor(payload.taker);
      if (!owns(giver) || !taker) return;
      await commitLend(giver, taker, { free: !!payload.free });
      return;
    }
    case "words": {
      const speaker = resolveActor(payload.speaker);
      const ally = resolveActor(payload.ally);
      if (!owns(speaker) || !ally || !hasFeat(speaker, FEATS.encouragingWords)) return;
      await commitWords(speaker, ally);
      return;
    }
    case "medicine": {
      const healer = resolveActor(payload.healer);
      if (!owns(healer)) return;
      await commitMedicine(payload, { healer });
      return;
    }
    default:
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   WIRING
   ══════════════════════════════════════════════════════════════════════════ */

export const RECOVERY_TARGETS = ["character", "npc", "familiar"].map((t) => `CONFIG.PF2E.Actor.documentClasses.${t}.prototype.rollRecovery`);

export function installActions() {
  for (const target of RECOVERY_TARGETS) {
    try {
      registerWrapper(target, recoveryWrapper, MIXED);
    } catch (error) {
      warn(`breath-and-blood | could not wrap ${target}; Hold On stays on the panel`, error);
    }
  }
  Hooks.on("pf2e.restForTheNight", onSystemRest);
}

/**
 * Point pf2e's own breather, Steel Your Resolve, Treat Wounds and Encouraging
 * Words at this feature's commands (`bab.redirectSystemActions`). The rules say
 * the system's breather and Steel Your Resolve must not be used.
 */
export function installRedirects({ openRest, openTreatWounds }) {
  const actions = game.pf2e?.actions;
  if (!actions) return;
  const redirect = () => _active() && _dials().redirect;
  const first = (o) => [o?.actors].flat().filter(Boolean)[0] ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;
  const wraps = {
    takeABreather(wrapped, ...args) {
      if (!redirect()) return wrapped(...args);
      return openRest();
    },
    steelYourResolve(wrapped, options = {}, ...rest) {
      if (!redirect()) return wrapped(options, ...rest);
      const actor = first(options);
      return actor ? catchYourBreath(actor, { free: true }) : refuse(null, "noTarget");
    },
    treatWounds(wrapped, options = {}, ...rest) {
      if (!redirect()) return wrapped(options, ...rest);
      return openTreatWounds("treat", { healer: first(options) });
    },
    encouragingWords(wrapped, options = {}, ...rest) {
      if (!redirect()) return wrapped(options, ...rest);
      const speaker = first(options);
      const ally = [...(game.user.targets ?? [])][0]?.actor ?? null;
      return encouragingWords(speaker, ally);
    },
  };
  for (const [name, fn] of Object.entries(wraps)) {
    if (typeof actions[name] !== "function") continue;
    try {
      registerWrapper(`game.pf2e.actions.${name}`, fn, MIXED);
    } catch (error) {
      warn(`breath-and-blood | could not redirect game.pf2e.actions.${name}`, error);
    }
  }
  // pf2e 8.7 also keeps Action objects (`game.pf2e.actions.get(slug)`), and its
  // sheet's skill actions call their `use`, never the legacy functions above. No
  // dotted path reaches an instance, so its `use` is shadowed by an own property
  // that falls through to the class's method whenever the redirect is off.
  const instances = { "treat-wounds": wraps.treatWounds, "encouraging-words": wraps.encouragingWords };
  for (const [slug, fn] of Object.entries(instances)) {
    const action = actions.get?.(slug);
    if (!action || typeof action.use !== "function" || Object.hasOwn(action, "use")) continue;
    const original = action.use;
    // async: pf2e's inline /act chains .catch() on what use() returns.
    action.use = async function (...args) {
      return fn((...a) => original.apply(this, a), ...args);
    };
  }
}

export { PREP, OPTION };
