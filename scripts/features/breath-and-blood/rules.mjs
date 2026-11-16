/**
 * Breath and Blood — the rules, and nothing else.
 *
 * A port of the Procedures in the rules file's implementation reference
 * (rules version 0.9) and of its reference implementation (`stamina/sim/
 * vectors.py`). Every function takes a state and returns a new one; nothing
 * here reads `game`, `foundry`, `ui`, `Hooks` or `canvas`, so the check tool
 * runs the exact code the Foundry glue calls (`tools/breath-and-blood-check.mjs`
 * runs all 102 test vectors against this file).
 *
 * A creature's state (`Pools`):
 *   level, con, sp, maxSP, hp, maxHP, temp, rp, maxRP,
 *   wounded, dying, unconscious, dead,
 *   caughtBreath, strengthLent, mended, ewImmune,
 *   inEncounter, companion (cannot Lend Strength), noHeal (the Guard)
 *
 * Every division in this variant rounds down (`Math.floor`).
 */

export const RULES_VERSION = "0.9";

/** The four kinds of healing (Procedures, Healing). */
export const KIND = Object.freeze({ spent: "spent", paid: "paid", covered: "covered", unpaid: "unpaid" });
export const KINDS = Object.freeze(["spent", "paid", "covered", "unpaid"]);

/** Kinds a source can be classified as before a patient decides. `ask` = not recognised. */
export const SOURCE_KINDS = Object.freeze(["spent", "paid", "ask"]);

/** Nights (Procedures, Nights). `haven` is the optional rule. */
export const NIGHTS = Object.freeze(["rest", "rough", "haven"]);

/** Roles (Settings, Role). */
export const ROLES = Object.freeze(["twoPools", "companion", "rival", "onePool"]);

/** Proficiency ranks by number, as PF2e stores them. */
export const RANKS = Object.freeze(["untrained", "trained", "expert", "master", "legendary"]);

/** Treat Wounds by rank (Data, treatWounds.ranks). */
export const TREAT = Object.freeze({
  1: { dc: 15, dcLevelGround: 14, added: 0 },
  2: { dc: 20, dcLevelGround: 16, added: 10 },
  3: { dc: 30, dcLevelGround: 18, added: 30 },
  4: { dc: 40, dcLevelGround: 20, added: 50 },
});

export const FRACTION = Object.freeze({ quarter: 0.25, half: 0.5 });

/** Data block numbers the glue reads. */
export const DATA = Object.freeze({
  resolveMaximum: 4,
  companionResolve: 3,
  rivalResolve: 2,
  resolveSettings: [2, 3, 4, 5, 6],
  narrowed: { throughLevel8: 4, fromLevel9: 3 },
  catchMinimum: 5,
  wordsBase: 5,
  coverSecondsPermanent: 60,
  breatherMinutes: 10,
  wardMedic: { 1: 2, 2: 2, 3: 4, 4: 4 },
});

const int = (v, d = 0) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : d;
};

/** A complete state with defaults: the fighter of the test vectors unless told otherwise. */
export function makePools(over = {}) {
  const level = int(over.level ?? 5, 5);
  const maxSP = int(over.maxSP ?? 35, 35);
  const maxHP = int(over.maxHP ?? 33, 33);
  const maxRP = int(over.maxRP ?? 4, 4);
  return {
    level,
    con: int(over.con ?? 2, 2),
    maxSP,
    maxHP,
    maxRP,
    sp: over.sp == null ? maxSP : int(over.sp),
    hp: over.hp == null ? maxHP : int(over.hp),
    temp: int(over.temp ?? 0),
    rp: over.rp == null ? maxRP : int(over.rp),
    wounded: int(over.wounded ?? 0),
    dying: int(over.dying ?? 0),
    unconscious: !!over.unconscious,
    dead: !!over.dead,
    caughtBreath: !!over.caughtBreath,
    strengthLent: !!over.strengthLent,
    mended: !!over.mended,
    ewImmune: !!over.ewImmune,
    inEncounter: !!over.inEncounter,
    companion: !!over.companion,
    noHeal: !!over.noHeal,
  };
}

const with_ = (c, patch) => ({ ...c, ...patch });

/* ══════════════════════════════════════════════════════════════════════════
   POOLS
   ══════════════════════════════════════════════════════════════════════════ */

/** Stamina Points per level: max(1, classHP / 2 + Con). */
export const staminaPerLevel = (classHP, con) => Math.max(1, Math.floor(int(classHP) / 2) + int(con));

/** A character's pools (Procedures, Pools). `extra` is every other bonus to maximum Hit Points. */
export function characterPools({ classHP, con, level, ancestryHP, extra = 0 }) {
  const lvl = int(level);
  return {
    maxSP: lvl * staminaPerLevel(classHP, con),
    maxHP: int(ancestryHP) + lvl * Math.floor(int(classHP) / 2) + int(extra),
  };
}

/** A companion, familiar, named ally or rival with printed maximum Hit Points H. */
export function companionPools(H, { role = "companion", maxResolve = 4, resolveByLevel = false, level = 1 } = {}) {
  const total = Math.max(0, int(H));
  const maxSP = Math.floor(total / 2);
  return { maxSP, maxHP: total - maxSP, maxRP: maxResolveFor({ role, level, maxResolve, resolveByLevel }) };
}

/** Maximum Resolve Points for a role (Settings, maxResolve and resolveByLevel). */
export function maxResolveFor({ role = "twoPools", level = 1, maxResolve = 4, resolveByLevel = false } = {}) {
  if (role === "onePool") return 0;
  if (role === "rival") return DATA.rivalResolve;
  const setting = Math.min(6, Math.max(2, int(maxResolve, 4)));
  const party = resolveByLevel ? (int(level) <= 8 ? DATA.narrowed.throughLevel8 : DATA.narrowed.fromLevel9) : setting;
  if (role === "companion") return Math.min(DATA.companionResolve, party);
  return party;
}

/**
 * PF2e's Stamina variant computes `(floor(classhp / 2) + con) * level` with no
 * minimum. The rules give at least 1 per level, which is the same number
 * raised to `level` (both are `level * max(1, x)` when x is a whole number).
 */
export const raiseStaminaToMinimum = (systemMaxSP, level) => Math.max(int(systemMaxSP), Math.max(0, int(level)));

/** Drained (Procedures, Drained): maximum Stamina Points absorb the loss first. */
export function drainedSplit({ baseSP, baseHP, loss }) {
  const l = Math.max(0, int(loss));
  const spCut = Math.min(l, Math.max(0, int(baseSP)));
  const hpCut = l - spCut;
  return { maxSP: int(baseSP) - spCut, maxHP: int(baseHP) - hpCut, spCut, hpCut };
}

/**
 * The current values when drained rises from `oldLoss` to `newLoss`. Each pool
 * loses the increase of its own cut, to a minimum of 0. A fall changes nothing.
 */
export function drainedRise({ sp, hp }, { baseSP, oldLoss, newLoss }) {
  const before = drainedSplit({ baseSP, baseHP: 0, loss: oldLoss });
  const after = drainedSplit({ baseSP, baseHP: 0, loss: newLoss });
  const dSP = Math.max(0, after.spCut - before.spCut);
  const dHP = Math.max(0, after.hpCut - before.hpCut);
  return { sp: Math.max(0, int(sp) - dSP), hp: Math.max(0, int(hp) - dHP), dSP, dHP };
}

/** The reference's whole drained step on a state (vectors R1–R3). */
export function drained(c, { baseSP, baseHP, value }) {
  const loss = c.level * int(value);
  const s = drainedSplit({ baseSP, baseHP, loss });
  return with_(c, { maxSP: s.maxSP, maxHP: s.maxHP, sp: Math.max(0, c.sp - s.spCut), hp: Math.max(0, c.hp - s.hpCut) });
}

/* ══════════════════════════════════════════════════════════════════════════
   DAMAGE
   ══════════════════════════════════════════════════════════════════════════ */

/** Massive damage: compared before temporary Hit Points. */
export const isMassive = (amount, maxSP, maxHP) => int(amount) >= 2 * (int(maxSP) + int(maxHP));

/**
 * Damage (Procedures, Damage). `direct` skips Stamina Points. Returns the new
 * state and where every point went.
 */
export function damage(c, amount, { direct = false } = {}) {
  let n = Math.max(0, int(amount));
  const massive = isMassive(n, c.maxSP, c.maxHP);
  const toTemp = Math.min(c.temp, n);
  n -= toTemp;
  let toSP = 0;
  if (!direct) {
    toSP = Math.min(c.sp, n);
    n -= toSP;
  }
  const toHP = Math.min(c.hp, n);
  const state = with_(c, { temp: c.temp - toTemp, sp: c.sp - toSP, hp: Math.max(0, c.hp - n) });
  return { state, massive, toTemp, toSP, toHP, atZero: state.hp === 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   HEALING
   ══════════════════════════════════════════════════════════════════════════ */

/** minimum(c, fraction) = max(c.level, floor(c.maxHP * fraction)). */
export const minimum = (c, fraction = FRACTION.quarter) => Math.max(int(c.level), Math.floor(int(c.maxHP) * fraction));

/** Why a paid healing would be unpaid, or null if the patient can pay. */
export function unpaidReason(c, { declines = false } = {}) {
  if (c.noHeal) return "noHeal";
  if (declines) return "declined";
  if (c.rp < 1) return "noRP";
  if (c.hp >= c.maxHP) return "fullHP";
  return null;
}

/**
 * decide(c): the prompt, before the healer acts and before any roll. The only
 * moment of payment. A patient under the Guard (cannot regain Hit Points) is
 * never asked to pay for healing that cannot restore anything.
 */
export function decide(c, { declines = false } = {}) {
  const reason = unpaidReason(c, { declines });
  if (reason) return { kind: KIND.unpaid, state: c, reason };
  return { kind: KIND.paid, state: with_(c, { rp: c.rp - 1 }), reason: null };
}

/**
 * applyHealing(c, rolled, kind, fraction). Regaining Hit Points from 0 ends
 * dying (and raises wounded by 1, as printed) and wakes the creature.
 */
export function applyHealing(c, rolled, kind, fraction = FRACTION.quarter) {
  const out = { state: c, toHP: 0, toSP: 0, lost: 0, amount: 0, minimumApplied: false, minimum: 0, revived: false, endedDying: false };
  if (c.noHeal) return out;
  if (kind === KIND.unpaid) {
    if (c.hp === 0) {
      const revived = regainFromZero(c);
      return { ...out, state: with_(revived.state, { hp: 1 }), toHP: 1, revived: true, endedDying: revived.endedDying };
    }
    return out;
  }
  let amount = Math.max(0, int(rolled));
  const min = kind === KIND.paid ? minimum(c, fraction) : 0;
  const minimumApplied = kind === KIND.paid && min > amount;
  if (kind === KIND.paid) amount = Math.max(amount, min);
  const toHP = Math.min(c.maxHP - c.hp, amount);
  let state = with_(c, { hp: c.hp + toHP });
  let toSP = 0;
  if (kind === KIND.spent && !(state.hp === 0)) {
    toSP = Math.max(0, Math.min(c.maxSP - c.sp, amount - toHP));
    state = with_(state, { sp: state.sp + toSP });
  }
  let revived = false;
  let endedDying = false;
  if (toHP > 0 && c.hp === 0) {
    const r = regainFromZero(state);
    state = r.state;
    revived = true;
    endedDying = r.endedDying;
  }
  if (toHP > 0 && !c.inEncounter) state = with_(state, { mended: true });
  return { state, toHP, toSP, lost: amount - toHP - toSP, amount, minimumApplied, minimum: min, revived, endedDying };
}

/** The printed rules for regaining Hit Points while at 0: dying ends (wounded +1), and the creature wakes. */
function regainFromZero(c) {
  const endedDying = c.dying > 0;
  return {
    endedDying,
    state: with_(c, { dying: 0, unconscious: false, wounded: endedDying ? c.wounded + 1 : c.wounded }),
  };
}

/* ── Healing that repeats ────────────────────────────────────────────────── */

/**
 * The kind of one installment of repeating healing, given the patient's cover
 * record for that source (or null when the effect begins now).
 *   cover: { paid: boolean, spent?: boolean, until: number|null }
 */
export function installmentKind(cover, now = 0) {
  if (!cover) return null;
  if (cover.until != null && now >= cover.until) return null;
  if (cover.spent) return KIND.spent;
  return cover.paid ? KIND.covered : KIND.unpaid;
}

/** A new cover record once the patient has decided, when the effect begins. */
export function startCover({ kind, permanent = false, now = 0, source = null, effectId = null }) {
  return {
    source,
    effectId,
    spent: kind === KIND.spent,
    paid: kind === KIND.paid,
    startedAt: now,
    until: permanent ? now + DATA.coverSecondsPermanent : null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   BREATHER, ENCOUNTERS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * breather(c): run once at the end of 10 uninterrupted minutes. Every test is
 * made in this order. Waking does not set mended.
 */
export function breather(c, { lingeringWounds = false } = {}) {
  let state = c;
  let woke = false;
  if (!c.noHeal && state.hp === 0 && !state.dying && !state.dead) {
    state = with_(state, { hp: 1, unconscious: false });
    woke = true;
  }
  let spGained = 0;
  if (!c.noHeal && state.hp >= 1) {
    spGained = state.maxSP - state.sp;
    state = with_(state, { sp: state.maxSP });
  }
  state = with_(state, { caughtBreath: false });
  const woundedBefore = state.wounded;
  if (state.wounded > 0 && (state.mended || state.hp === state.maxHP)) {
    state = with_(state, { wounded: lingeringWounds ? Math.max(1, state.wounded - 1) : 0 });
  }
  state = with_(state, { mended: false });
  return { state, woke, spGained, woundedBefore, woundedAfter: state.wounded };
}

export const startEncounter = (c) => with_(c, { mended: false, inEncounter: true });
export const endEncounter = (c) => with_(c, { inEncounter: false });

/* ══════════════════════════════════════════════════════════════════════════
   ACTIONS
   ══════════════════════════════════════════════════════════════════════════ */

/** Why Catch Your Breath is refused, or null. */
export function catchRefusal(c, { free = false } = {}) {
  if (c.noHeal) return "noHeal";
  if (c.caughtBreath) return "caught";
  if (c.hp < 1) return "noHP";
  if (!(c.rp >= 1 || free)) return "noRP";
  return null;
}

/** catchYourBreath(c, free). `free` is Steel Your Resolve's once-per-day use. */
export function catchYourBreath(c, { free = false } = {}) {
  const reason = catchRefusal(c, { free });
  if (reason) return { ok: false, reason, state: c, gained: 0 };
  const gain = Math.max(Math.floor(c.maxSP / 2), DATA.catchMinimum);
  const sp = Math.min(c.maxSP, c.sp + gain);
  return { ok: true, reason: null, state: with_(c, { rp: free ? c.rp : c.rp - 1, sp, caughtBreath: true }), gained: sp - c.sp };
}

/** holdOn(c): a free action before a recovery check. */
export function holdOn(c) {
  if (c.rp < 1) return { ok: false, reason: "noRP", state: c, stabilized: false };
  if (c.dying < 1) return { ok: false, reason: "notDying", state: c, stabilized: false };
  const dying = c.dying - 1;
  const stabilized = dying === 0;
  const state = with_(c, {
    rp: c.rp - 1,
    dying,
    wounded: stabilized ? c.wounded + 1 : c.wounded,
    unconscious: stabilized ? true : c.unconscious,
  });
  return { ok: true, reason: null, state, stabilized };
}

/** Why Lend Strength is refused, or null. `same` is true when both name one pool (eidolon and summoner). */
export function lendRefusal(giver, taker, { same = false } = {}) {
  if (same || giver === taker) return "self";
  if (giver.companion) return "companion";
  if (giver.rp < 1) return "noRP";
  if (taker.rp >= taker.maxRP) return "full";
  if (taker.strengthLent) return "lent";
  return null;
}

export function lendStrength(giver, taker, opts = {}) {
  const reason = lendRefusal(giver, taker, opts);
  if (reason) return { ok: false, reason, giver, taker };
  return {
    ok: true,
    reason: null,
    giver: with_(giver, { rp: giver.rp - 1 }),
    taker: with_(taker, { rp: taker.rp + 1, strengthLent: true }),
  };
}

/** Why Bind Your Own Wounds is refused, or null. */
export function bindRefusal(c) {
  if (c.noHeal) return "noHeal";
  if (c.rp < 1) return "noRP";
  if (c.hp < 1) return "noHP";
  if (c.hp >= c.maxHP) return "fullHP";
  return null;
}

/** bindYourOwnWounds(c): c's activity for one breather, run at its end. */
export function bindYourOwnWounds(c) {
  const reason = bindRefusal(c);
  if (reason) return { ok: false, reason, state: c, heal: null };
  const d = decide(c);
  const heal = applyHealing(d.state, 0, d.kind, FRACTION.quarter);
  return { ok: true, reason: null, state: heal.state, heal, kind: d.kind };
}

/** Why Encouraging Words is refused, or null. The ally state is the summoner's for an eidolon. */
export function wordsRefusal(ally) {
  if (ally.noHeal) return "noHeal";
  if (ally.hp < 1) return "noHP";
  if (ally.ewImmune) return "immune";
  return null;
}

export const wordsAmount = (speakerLevel) => DATA.wordsBase + 2 * Math.max(0, int(speakerLevel));

export function encouragingWords(speakerLevel, ally) {
  const reason = wordsRefusal(ally);
  if (reason) return { ok: false, reason, state: ally, gained: 0 };
  const sp = Math.min(ally.maxSP, ally.sp + wordsAmount(speakerLevel));
  return { ok: true, reason: null, state: with_(ally, { sp, ewImmune: true }), gained: sp - ally.sp };
}

/* ══════════════════════════════════════════════════════════════════════════
   TREAT WOUNDS AND BATTLE MEDICINE
   ══════════════════════════════════════════════════════════════════════════ */

const rankOf = (r) => Math.min(4, Math.max(1, int(r, 1)));

/** The DC for a chosen rank. */
export const treatDC = (rank, { levelGround = false } = {}) => (levelGround ? TREAT[rankOf(rank)].dcLevelGround : TREAT[rankOf(rank)].dc);

/** The DCs a healer of `healerRank` may choose, lowest first. */
export const treatChoices = (healerRank, opts = {}) =>
  Array.from({ length: Math.max(0, Math.min(4, int(healerRank))) }, (_, i) => ({ rank: i + 1, dc: treatDC(i + 1, opts), added: TREAT[i + 1].added }));

/**
 * The healing roll's formula, as PF2e's own `treatWoundsMacroCallback` builds it:
 * 2d8 (4d8 on a critical success), d10s with Magic Hands, plus the DC's added
 * Hit Points, 5 per rank above trained with Medic Dedication, and the healer's
 * level with Magic Hands. Null on a failure.
 */
export function healFormula({ degree, rank, medicDedication = false, magicHands = false, level = 0 }) {
  if (degree !== "success" && degree !== "criticalSuccess") return null;
  const r = rankOf(rank);
  const bonus = TREAT[r].added + (medicDedication ? (r - 1) * 5 : 0) + (magicHands ? Math.max(0, int(level)) : 0);
  const dice = `${degree === "criticalSuccess" ? 4 : 2}${magicHands ? "d10" : "d8"}`;
  return bonus > 0 ? `${dice}+${bonus}` : dice;
}

/** Patients per treatment: 1, or with Ward Medic 2 (4 at master). */
export const wardMedicLimit = (healerRank, hasWardMedic) => (hasWardMedic ? DATA.wardMedic[rankOf(healerRank)] : 1);

/** Assurance's fixed result: 10 + the proficiency bonus (without level under Level Ground). */
export const assuranceResult = (rank, level, { levelGround = false } = {}) =>
  10 + 2 * Math.max(0, int(rank)) + (levelGround || int(rank) < 1 ? 0 : Math.max(0, int(level)));

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** The degree of success for a total against a DC; `die` shifts on a natural 20 or 1. */
export function degreeOf(total, dc, die = null) {
  let i = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (die === 20) i = Math.min(3, i + 1);
  if (die === 1) i = Math.max(0, i - 1);
  return DEGREES[i];
}

/**
 * The first half of Treat Wounds: every patient's kind, before any roll.
 *   patients: [{ state, declines, surgeon }]   at most one surgeon
 */
export function treatDecide(patients, { surgeonAvailable = true } = {}) {
  let surgeonUsed = false;
  const rows = patients.map(({ state, declines = false, surgeon = false }) => {
    if (surgeon && surgeonAvailable && !surgeonUsed) {
      surgeonUsed = true;
      return { kind: KIND.paid, state, reason: null, surgeon: true };
    }
    const d = decide(state, { declines });
    return { ...d, surgeon: false };
  });
  return { rows, checkNeeded: rows.some((r) => r.kind === KIND.paid), surgeonUsed };
}

/** The second half: one roll for every patient (0 when no check was made, or it failed). */
export function treatApply(rows, rolled, { continualRecovery = false, checkMade = true } = {}) {
  const fraction = continualRecovery ? FRACTION.half : FRACTION.quarter;
  return rows.map((row) => ({ ...row, heal: applyHealing(row.state, checkMade ? rolled : 0, row.kind, fraction) }));
}

/** Treat Wounds in one call, as the vectors describe it. */
export function treatWounds(patients, rolled, { continualRecovery = false, surgeonAvailable = true } = {}) {
  const decided = treatDecide(patients, { surgeonAvailable });
  const results = treatApply(decided.rows, rolled, { continualRecovery, checkMade: decided.checkNeeded });
  return { checkMade: decided.checkNeeded, surgeonUsed: decided.surgeonUsed, results, states: results.map((r) => r.heal.state) };
}

/** Battle Medicine on one patient: Treat Wounds' amounts, a quarter, never Continual Recovery. */
export function battleMedicine(state, rolled, { declines = false } = {}) {
  const d = decide(state, { declines });
  const heal = applyHealing(d.state, d.kind === KIND.paid ? rolled : 0, d.kind, FRACTION.quarter);
  return { kind: d.kind, reason: d.reason, checkMade: d.kind === KIND.paid, heal, state: heal.state };
}

/* ══════════════════════════════════════════════════════════════════════════
   NIGHTS, DEATH
   ══════════════════════════════════════════════════════════════════════════ */

/** Hit Points a night restores: max(con, 1) * level, changed by Fast Recovery and the like. */
export const nightRestores = ({ con, level, multiplier = 1, addend = 0 }) => Math.max(int(con), 1) * int(level) * (Number(multiplier) || 1) + int(addend);

export function night(c, kind = "rest", { multiplier = 1, addend = 0 } = {}) {
  let restored = nightRestores({ con: c.con, level: c.level, multiplier, addend });
  if (kind === "haven") restored *= 2;
  const hp = Math.min(c.maxHP, c.hp + restored);
  return with_(c, {
    hp,
    sp: c.maxSP,
    rp: kind === "rough" ? Math.min(c.maxRP, c.rp + 2) : c.maxRP,
    caughtBreath: false,
    strengthLent: false,
    ewImmune: false,
    wounded: 0,
    mended: false,
  });
}

/** Returning from death: 0 Resolve Points, 0 Stamina Points; Hit Points as the effect states. */
export const returnFromDeath = (c, hp = c.hp) => with_(c, { rp: 0, sp: 0, hp: Math.max(0, int(hp)), dead: false });

/* ══════════════════════════════════════════════════════════════════════════
   CLASSIFYING HEALING
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Classify one healing source before anyone decides.
 *   source: "spell" | "item" | "ability" | "treatWounds" | "battleMedicine" | "none"
 *   entry:  "prepared" | "spontaneous" | "innate" | "focus" | "ritual" | "items" | null
 *   cantrip, embedded (scroll, wand, staff), innateLimited, infused, perDay
 * Returns { kind: "spent" | "paid" | "ask", reason, sure }.
 */
export function classifyHealing(desc = {}, { generousSupplies = false } = {}) {
  const d = desc ?? {};
  const out = (kind, reason, sure = true) => ({ kind, reason, sure });
  switch (d.source) {
    case "treatWounds":
      return out("paid", "treatWounds");
    case "battleMedicine":
      return out("paid", "battleMedicine");
    case "spell": {
      if (d.embedded) return generousSupplies ? out("spent", "generous") : out("paid", "embedded");
      if (d.cantrip) return out("paid", "cantrip");
      if (d.entry === "focus") return out("paid", "focus");
      if (d.entry === "ritual") return out("spent", "ritual");
      if (d.entry === "prepared" || d.entry === "spontaneous") return out("spent", "slot");
      if (d.entry === "innate") return d.innateLimited ? out("spent", "innateLimited") : out("paid", "atWill");
      return out("ask", "unknownSpell", false);
    }
    case "item": {
      if (generousSupplies) return out("spent", "generous");
      if (d.infused) return out("spent", "infused", false);
      return out("paid", "item");
    }
    case "ability":
      return d.perDay ? out("spent", "perDay") : out("paid", "atWill");
    default:
      return out("ask", "unknown", false);
  }
}

/** Should the applying user see the dialog? `prompt` is the setting: always, unsure, never. */
export function shouldPrompt(classification, prompt = "unsure") {
  if (prompt === "always") return true;
  if (prompt === "never") return false;
  return !classification?.sure;
}

/** What "never prompt" settles an unrecognised source as: paid, the general rule. */
export const fallbackKind = (classification) => (classification?.kind === "ask" ? "paid" : classification?.kind ?? "paid");
