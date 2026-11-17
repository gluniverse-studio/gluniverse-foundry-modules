/**
 * Level Ground — everything the module decides that the reference does not.
 *
 * `rules.mjs` is the rules repository's reference implementation, ported as is.
 * This file holds the rest of the arithmetic and every rewrite the module makes
 * to PF2e data: Reach and Outmatched as they reach a roll, the roles' Hit
 * Points, Tempo and Unbowed bookkeeping, Sizing Up, Break Away rows, the
 * converter, battle forms, level-as-proficiency rule elements, item DCs, and
 * the Strip plan that turns `stripActor`'s copy into the few paths an update
 * writes.
 *
 * Pure: it reaches no `game`, `foundry`, `ui`, `Hooks` or `canvas`, so the
 * check tool imports it under plain Node and the preview imports it in a page.
 */

import {
  AREA,
  CRIT,
  WORDS,
  breakAwayDC,
  convertDC,
  levelDC,
  levelRank,
  outmatched,
  rankDC,
  rate,
  stripActor,
  taskRank,
} from "./rules.mjs";
import { BOSS_FLAGS } from "../pf2e-variant-rules/boss/constants.mjs";
import { readFlag } from "./constants.mjs";

/* ── Ranks ────────────────────────────────────────────────────────────── */

export const RANKS = ["untrained", "trained", "expert", "master", "legendary", "mythic"];

/** A rank as its index 0..5, from an index or a name; null when it is neither. */
export function rankIndex(rank) {
  if (typeof rank === "number" && Number.isInteger(rank) && rank >= 0 && rank <= 5) return rank;
  const i = RANKS.indexOf(String(rank ?? "").toLowerCase());
  return i >= 0 ? i : null;
}

/** Reach: −2 for each rank the character is below the task; untrained counts as trained. */
export function reachPenalty(characterRank, taskRankIndex) {
  const effective = Math.max(characterRank, 1);
  return -2 * Math.max(0, taskRankIndex - effective);
}

/* ── Roll options the module writes and reads ─────────────────────────── */

/**
 * PF2e's inline check parser splits parameters on `|` and each parameter at its
 * FIRST colon only, then splits `options:` on commas (pf2e.mjs, the inline
 * check's `#n` param reader and `splitListString`), so a colon inside an option
 * survives. These are the option names, all lower case.
 */
export const OPT = Object.freeze({
  taskRank: "level-ground:task-rank:",
  dcLevel: "level-ground:dc-level:",
  breakAway: "level-ground:break-away",
  breakAwayKey: "level-ground:break-away:key:",
  breakAwayBonus: "level-ground:break-away-bonus:",
});

const asList = (options) =>
  options instanceof Set ? [...options] : Array.isArray(options) ? options : [];

const has = (options, value) =>
  options instanceof Set ? options.has(value) : asList(options).includes(value);

/** The number after a prefixed option, or null. */
export function readNumberOption(options, prefix) {
  for (const o of asList(options)) {
    if (typeof o !== "string" || !o.startsWith(prefix)) continue;
    const n = Number(o.slice(prefix.length));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** The text after a prefixed option, or null. */
export function readTextOption(options, prefix) {
  for (const o of asList(options)) {
    if (typeof o === "string" && o.startsWith(prefix) && o.length > prefix.length) return o.slice(prefix.length);
  }
  return null;
}

/** The task rank a check carries (0..5), or null. */
export function readTaskRank(options) {
  const n = readNumberOption(options, OPT.taskRank);
  return n === null ? null : rankIndex(n);
}

export const isBreakAway = (options) => has(options, OPT.breakAway);

/** The roller's rank in the statistic, from PF2e's own `proficiency:<rank>` roll option. */
export function readProficiencyRank(options) {
  for (const o of asList(options)) {
    const m = /^proficiency:(untrained|trained|expert|master|legendary)$/.exec(o ?? "");
    if (m) return RANKS.indexOf(m[1]);
  }
  return null;
}

/** True when a roll carries the incapacitation trait (the test PF2e itself makes). */
export const hasIncapacitation = (options) =>
  has(options, "incapacitation") || has(options, "item:trait:incapacitation");

/* ── The converter ────────────────────────────────────────────────────── */

/** DC adjustments, applied as printed after Convert. */
export const DC_ADJUSTMENTS = Object.freeze({
  none: 0,
  "incredibly-easy": -10,
  "very-easy": -5,
  easy: -2,
  hard: 2,
  "very-hard": 5,
  "incredibly-hard": 10,
});
export const RARITY_ADJUSTMENTS = Object.freeze({ common: 0, uncommon: 2, rare: 5, unique: 10 });

/**
 * The converter: a printed DC (the Convert table), a level (the level-based
 * DC), a spell's rank (its level is 2 × rank − 1), a ritual's printed DC
 * (minus 2 × rank), or a rank the GM chooses for a new task (the rank DC).
 * Returns `{ dc, rank, base, adjust, method }` with `rank` an index 0..5, or
 * null when the input is not a number.
 */
export function convert({ mode = "printed", value, spellRank = null, adjust = "none", rarity = "common", minRank = null } = {}) {
  const v = Number(value);
  const adj = (DC_ADJUSTMENTS[adjust] ?? 0) + (RARITY_ADJUSTMENTS[rarity] ?? 0);
  let base;
  let rank;
  if (mode === "rank") {
    rank = rankIndex(v);
    if (rank === null) return null;
    base = rankDC(rank);
  } else if (mode === "spell") {
    const r = Number(spellRank ?? value);
    if (!Number.isInteger(r) || r < 1) return null;
    const level = 2 * r - 1;
    base = levelDC(level);
    rank = RANKS.indexOf(levelRank(level));
  } else if (mode === "ritual") {
    const r = Number(spellRank);
    if (!Number.isFinite(v) || !Number.isInteger(r) || r < 1) return null;
    base = v - 2 * r;
    rank = RANKS.indexOf(levelRank(2 * r));
  } else if (mode === "level") {
    if (!Number.isFinite(v)) return null;
    base = levelDC(Math.trunc(v));
    rank = RANKS.indexOf(levelRank(Math.trunc(v)));
  } else {
    if (!Number.isFinite(v)) return null;
    base = convertDC(Math.trunc(v));
    rank = RANKS.indexOf(taskRank(Math.trunc(v)));
  }
  // A printed minimum proficiency rank is the task's rank (Reach, "Finding the rank").
  const min = rankIndex(minRank);
  if (min !== null) rank = min;
  return { dc: base + adj, base, adjust: adj, rank, method: mode };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * An inline check PF2e renders in chat: `@Check[<statistic>|dc:<n>|options:…]`.
 * The task rank rides as a roll option so the Check.roll wrapper can apply
 * Reach when the check is rolled. Returns null for a statistic slug PF2e would
 * not accept.
 */
export function inlineCheck({ statistic, dc, rank = null, options = [], name = null, traits = [] } = {}) {
  const stat = String(statistic ?? "").trim().toLowerCase();
  if (!SLUG.test(stat) || !Number.isFinite(Number(dc))) return null;
  const opts = [...(rank === null || rank === undefined ? [] : [`${OPT.taskRank}${rank}`]), ...options].filter(Boolean);
  const parts = [stat, `dc:${Math.trunc(Number(dc))}`];
  if (opts.length) parts.push(`options:${opts.join(",")}`);
  if (traits.length) parts.push(`traits:${traits.join(",")}`);
  if (name) parts.push(`name:${String(name).replace(/[|\]\[]/g, " ").trim()}`);
  return `@Check[${parts.join("|")}]`;
}

/* ── Outmatched ───────────────────────────────────────────────────────── */

/** The effect's level, as for the incapacitation trait: 2 × rank, the item's level, else the creature's. */
export function effectLevel({ kind, rank = null, itemLevel = null, originLevel = null } = {}) {
  if (kind === "spell" && Number.isFinite(rank)) return 2 * rank;
  if (kind === "physical" && Number.isFinite(itemLevel)) return itemLevel;
  return Number.isFinite(originLevel) ? originLevel : null;
}

/**
 * The Outmatched bonus for a target: `{ gap, bonus }`, the gap after the Solo
 * floor. A Solo always gains the full +10, even when the effect's level is not
 * known. Null when neither level is known for an ordinary creature.
 */
export function outmatchedBonus({ targetLevel, effectLevel: eff, solo = false } = {}) {
  const known = Number.isFinite(targetLevel) && Number.isFinite(eff);
  if (!known) return solo ? { gap: 4, bonus: outmatched(4) } : null;
  let gap = targetLevel - eff;
  if (solo) gap = Math.max(gap, 4);
  return { gap, bonus: outmatched(gap) };
}

/** PF2e's own incapacitation step (`getIncapacitationAdjustment`), which Outmatched replaces. */
export function isNativeIncapacitation(adjustment) {
  if (adjustment?.adjustments?.all?.label === "PF2E.TraitIncapacitation") return true;
  try {
    return JSON.stringify(adjustment ?? null).includes("TraitIncapacitation");
  } catch {
    return false;
  }
}

/**
 * Degree-of-success adjustments in the shape PF2e's `DegreeOfSuccess` reads
 * (`{ adjustments: { <unadjusted degree>: { label, amount } } }`, where an
 * amount may be a degree name): a save's critical failure is a failure, and a
 * check against the creature's DC turns a critical success into a success.
 */
export const outmatchedSaveAdjustment = (label) => ({ adjustments: { criticalFailure: { label, amount: "failure" } } });
export const outmatchedCheckAdjustment = (label) => ({ adjustments: { criticalSuccess: { label, amount: "success" } } });

/* ── Roles ────────────────────────────────────────────────────────────── */

export const ROLES = ["none", "mook", "solo", "summoned"];

/** Hit Points under a role: Mook ¼ rounded up, Solo ×2, summoned ½ rounded down. */
export function roleHP(role, hp) {
  const n = Math.max(0, Math.trunc(Number(hp) || 0));
  if (role === "mook") return Math.ceil(n / 4);
  if (role === "solo") return n * 2;
  if (role === "summoned") return Math.floor(n / 2);
  return n;
}

/**
 * The stored maximum that makes the prepared maximum `role(printed + adjustment)`.
 * PF2e adds the elite or weak Hit Points (and any rule element's) on top of the
 * stored value while preparing, so the adjustment is applied first and the role
 * second (the rules' stated order), and the stored value is what is left.
 */
export function roleSourceMax({ role, printedMax, adjustHP = 0 }) {
  const want = roleHP(role, Number(printedMax) + Number(adjustHP || 0));
  return Math.max(1, want - Number(adjustHP || 0));
}

/* ── Tempo ────────────────────────────────────────────────────────────── */

/**
 * Tempo is lost only while unconscious, paralyzed, petrified, or stunned for a
 * duration. PF2e's stunned condition always carries a value, so a duration
 * shows as a stunned condition granted by another item (an effect with a
 * duration) or one whose own duration is not unlimited.
 * `conditions`: `[{ slug, value, unit, granted }]`.
 */
export function tempoLost(conditions = []) {
  return conditions.some((c) => {
    if (["unconscious", "paralyzed", "petrified"].includes(c?.slug)) return true;
    if (c?.slug !== "stunned") return false;
    return !!c.granted || (!!c.unit && c.unit !== "unlimited");
  });
}

/* ── Unbowed ──────────────────────────────────────────────────────────── */

export const UNBOWED_TURNS = 3;

/** Conditions Unbowed never ends, or that are not something imposed on the Solo. */
export const UNBOWED_NEVER = Object.freeze([
  "persistent-damage",
  "grabbed",
  "restrained",
  "dying",
  "wounded",
  "doomed",
  "hidden",
  "observed",
  "undetected",
  "unnoticed",
  "concealed",
  "invisible",
  "friendly",
  "helpful",
  "hostile",
  "indifferent",
  "unfriendly",
  "encumbered",
  "broken",
  "cursebound",
  "quickened",
]);

/**
 * Why an item added to a Solo is not tracked, or null when it is.
 * `{ type, slug, selfOrigin, allyOrigin, granted, marker }`.
 */
export function unbowedSkip({ type, slug, selfOrigin = false, allyOrigin = false, granted = false, marker = false } = {}) {
  if (marker) return "marker";
  if (type === "affliction") return "affliction";
  if (type !== "condition" && type !== "effect") return "type";
  if (granted) return "granted";
  if (selfOrigin) return "self";
  if (allyOrigin) return "ally";
  if (type === "condition" && UNBOWED_NEVER.includes(slug)) return "never";
  return null;
}

/** Add an entry (`{ id, name }`), once. A turn already in progress does not count, so it starts at 0. */
export function unbowedAdd(entries = [], entry) {
  if (!entry?.id || entries.some((e) => e.id === entry.id)) return entries.slice();
  return [...entries, { id: entry.id, name: String(entry.name ?? ""), starts: 0, exempt: false }];
}

/** The Solo starts a turn: every entry recorded before it counts one. */
export const unbowedOnStart = (entries = []) => entries.map((e) => ({ ...e, starts: (e.starts ?? 0) + 1 }));

/** The Solo ends a turn: entries on their third counted turn end now. */
export function unbowedOnEnd(entries = [], limit = UNBOWED_TURNS) {
  const expire = [];
  const keep = [];
  for (const e of entries) (!e.exempt && (e.starts ?? 0) >= limit ? expire : keep).push(e);
  return { expire, keep };
}

export const unbowedExempt = (entries = [], id) => entries.map((e) => (e.id === id ? { ...e, exempt: true } : e));
export const unbowedDrop = (entries = [], id) => entries.filter((e) => e.id !== id);

/**
 * When an entry ends, as words the card can say: `{ k, n }` where `k` is
 * "exempt", "thisTurn" (its third counted turn is in progress) or "turns"
 * (`n` more turns of the Solo's must start, and that last one end).
 */
export function unbowedWhen(entry, { inTurn = false, limit = UNBOWED_TURNS } = {}) {
  if (entry?.exempt) return { k: "exempt", n: 0 };
  const left = limit - (entry?.starts ?? 0);
  if (left <= 0) return { k: "thisTurn", n: 0 };
  return { k: "turns", n: left, inTurn: !!inTurn };
}

/* ── Sizing Up, XP ────────────────────────────────────────────────────── */

const tableValue = (table, level) => {
  const l = Math.max(-1, Math.min(24, Math.trunc(Number(level) || 0)));
  return table[l];
};
/** Above level 24 the level 24 values are a minimum; below −1, the −1 values. */
export const critValue = (level) => tableValue(CRIT, level);
export const areaValue = (level) => tableValue(AREA, level);

/** Deadly: Crit ≥ max HP, or (with an area attack) 2 × Area ≥ max HP. */
export function isDeadly({ level, area = false }, maxHP) {
  const hp = Number(maxHP);
  if (!Number.isFinite(hp) || hp <= 0) return false;
  return critValue(level) >= hp || (!!area && 2 * areaValue(level) >= hp);
}

/** The PCs any creature is deadly to, in party order. Hazards are never tested. */
export function deadlyTo(creatures = [], pcs = []) {
  const live = creatures.filter((c) => !c.hazard);
  return pcs.filter((pc) => live.some((c) => isDeadly(c, pc.maxHP))).map((pc) => pc.name);
}

export const BAND_KEYS = ["belowTrivial", "trivial", "low", "moderate", "severe", "extreme", "beyondExtreme"];
export const BAND_LABELS = ["Below Trivial", "Trivial", "Low", "Moderate", "Severe", "Extreme", "Beyond Extreme"];
export const WORD_KEYS = ["noThreat", "weaker", "weaker", "realFight", "dangerous", "coinToss", "overwhelming"];

export const bandIndex = (label) => BAND_LABELS.indexOf(label);
export const bandKey = (label) => BAND_KEYS[bandIndex(label)] ?? "belowTrivial";
export const wordKey = (label) => WORD_KEYS[bandIndex(label)] ?? "noThreat";
export const wordOf = (label) => WORDS[bandIndex(label)] ?? WORDS[0];

/** XP for one PC: double while below the party's level. */
export const xpFor = (xp, pcLevel, partyLevel) => (pcLevel < partyLevel ? 2 * xp : xp);

/**
 * The worksheet's full reading for the window and the tracker strip. `rows` are
 * `{ count, level, role, adjust, area, hazard, name }`; `party` is
 * `{ pcs: [{ name, level, maxHP }], allies: [{ level, mook }], area, casterLeads }`.
 * Null when there is no opposition or no PC.
 */
export function reading(rows = [], party = {}) {
  const pcs = (party.pcs ?? []).filter((p) => Number.isFinite(p.level));
  const opposition = rows
    .filter((r) => Number.isFinite(r.level) && (r.count ?? 1) > 0)
    .map((r) => ({
      count: Math.max(1, Math.trunc(r.count ?? 1)),
      level: Math.trunc(r.level),
      role: r.role === "mook" || r.role === "solo" ? r.role : "standard",
      adjust: r.adjust === "elite" || r.adjust === "weak" ? r.adjust : "",
      area: !!r.area,
      hazard: r.hazard === "simple" || r.hazard === "complex" ? r.hazard : "",
    }));
  if (!opposition.length || !pcs.length) return null;
  const allies = (party.allies ?? [])
    .filter((a) => Number.isFinite(a.level))
    .map((a) => ({ level: Math.trunc(a.level), mook: !!a.mook }));
  const result = rate(opposition, {
    levels: pcs.map((p) => Math.trunc(p.level)),
    allies,
    area: !!party.area,
    casterLeads: !!party.casterLeads,
  });
  const creatures = rows
    .filter((r) => Number.isFinite(r.level) && !r.hazard)
    .map((r) => ({ name: r.name, level: r.level, area: !!r.area, hazard: false }));
  const deadly = deadlyTo(creatures, pcs);
  const perCreature = creatures.map((c) => ({ name: c.name, to: pcs.filter((p) => isDeadly(c, p.maxHP)).map((p) => p.name) }));
  return {
    ...result,
    pct: Math.round(result.ratio * 100),
    band: bandKey(result.label),
    plainBand: bandKey(result.plain),
    wordKey: wordKey(result.label),
    deadly,
    perCreature,
    xpByPC: pcs.map((p) => ({ name: p.name, level: p.level, xp: xpFor(result.xp, p.level, result.partyLevel) })),
  };
}

/* ── Break Away ───────────────────────────────────────────────────────── */

export const BREAK_AWAY_SKILLS = Object.freeze(["athletics", "acrobatics", "stealth", "survival", "deception"]);

/** One fleeing PC's DC from the pursuer and their four toggles. */
export function breakAwayRow({ pursuerLevel, faster = false, flies = false, ground = false, carrying = false } = {}) {
  const level = Math.trunc(Number(pursuerLevel));
  if (!Number.isFinite(level)) return null;
  return breakAwayDC(level, { faster, flies, ground, carrying });
}

/** What a degree of success means for a fleeing PC. */
export function breakAwayResult(outcome) {
  switch (outcome) {
    case "criticalSuccess":
      return "escapeAlly";
    case "success":
      return "escape";
    case "failure":
      return "pursued";
    case "criticalFailure":
      return "caught";
    default:
      return "pending";
  }
}

export const clampBonus = (n) => {
  const v = Math.trunc(Number(n) || 0);
  return v <= 0 ? 0 : Math.max(2, Math.min(4, v));
};

/* ── Massive damage ───────────────────────────────────────────────────── */

/** PF2e's own test (`ActorPF2e#applyDamage`): damage at 0 HP ≥ twice both pools. */
export function isMassive({ damageTaken, hpMax, spMax = 0, hpAfter }) {
  const d = Number(damageTaken);
  return Number(hpAfter) === 0 && d > 0 && d >= 2 * (Number(hpMax || 0) + Number(spMax || 0));
}

/** Dying as normal, one higher: 1 (2 on a critical) + wounded + 1. */
export const massiveDying = ({ critical = false, wounded = 0 } = {}) => (critical ? 2 : 1) + Math.max(0, Number(wounded) || 0) + 1;

/* ── Level as a proficiency bonus ─────────────────────────────────────── */

/** A `FlatModifier` of type proficiency whose value is built on `@actor.level`. */
export const isLevelProfRule = (r) =>
  r?.key === "FlatModifier" && r.type === "proficiency" && /@actor\.level/.test(String(r.value ?? ""));

/**
 * The value that makes such a rule give a proficiency bonus of +0.
 *
 * PF2e applies a typed bonus and a typed penalty of the same type together
 * (`applyStackingRules`: bonuses keep the highest, penalties the lowest, and
 * both count), and Proficiency without Level's untrained −2 is a *proficiency*
 * penalty. A rewritten value of 0 is a proficiency bonus of 0 beside that
 * penalty, which totals −2: the formula unchanged in effect. The value that
 * totals +0 is the untrained penalty's size, +2 — and since trained and above
 * are already +2 or more of the same type, it never raises a trained skill.
 */
export const levelProfValue = (untrainedModifier = -2) => Math.max(0, -Math.trunc(Number(untrainedModifier) || 0));

/** Rewrite every such rule. Returns `{ rules, changed: [[index, oldValue]] }`; the input is not touched. */
export function rewriteLevelProf(rules = [], untrainedModifier = -2) {
  const value = levelProfValue(untrainedModifier);
  const changed = [];
  const out = (rules ?? []).map((r, i) => {
    if (!isLevelProfRule(r)) return r;
    changed.push([i, r.value]);
    return { ...r, value };
  });
  return { rules: out, changed };
}

/* ── Battle forms ─────────────────────────────────────────────────────── */

const LEVEL_TERM = /\s*\+\s*@actor\.level\b/g;

/** "16 + @actor.level" → 16. Any other value is returned unchanged. */
export function stripLevelTerm(value) {
  if (typeof value !== "string" || !/@actor\.level/.test(value)) return value;
  const s = value.replace(LEVEL_TERM, "").trim();
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

/**
 * The rank a battle form's values are written for. A spell effect's level is
 * the rank it was cast at (1 to 10). Anything else — a feat's form, or a
 * "spell effect" a level-20 feat grants — is a character level, read as the
 * rank a caster first has at that level.
 */
export function battleFormRank(level, { spell = true } = {}) {
  const l = Math.max(1, Math.trunc(Number(level) || 1));
  return spell && l <= 10 ? l : Math.max(1, Math.ceil(l / 2));
}

function stripFormValues(v, n) {
  if (!v || typeof v !== "object") return false;
  let changed = false;
  if (v.armorClass && v.armorClass.modifier !== undefined) {
    const next = stripLevelTerm(v.armorClass.modifier);
    if (next !== v.armorClass.modifier) {
      v.armorClass.modifier = next;
      changed = true;
    }
  }
  for (const group of ["strikes", "skills"]) {
    for (const entry of Object.values(v[group] ?? {})) {
      if (entry && typeof entry.modifier === "number") {
        entry.modifier -= n;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Rewrite every `BattleForm` rule: an AC of "N + @actor.level" becomes N, and
 * each strike and skill modifier loses 2 × rank − 1 — a bracket by its own
 * `start`, the un-bracketed overrides by the item's level. Returns
 * `{ rules, changed }`; the input is not touched.
 */
export function rewriteBattleForm(rules = [], { level = 1, spell = true } = {}) {
  let changed = false;
  const out = (rules ?? []).map((r) => {
    if (r?.key !== "BattleForm") return r;
    const copy = JSON.parse(JSON.stringify(r));
    const base = battleFormRank(level, { spell });
    if (stripFormValues(copy.overrides, 2 * base - 1)) changed = true;
    for (const b of copy.brackets ?? []) {
      const rank = Number.isFinite(b?.start) ? battleFormRank(b.start, { spell }) : base;
      if (stripFormValues(b?.value, 2 * rank - 1)) changed = true;
    }
    return copy;
  });
  return { rules: out, changed };
}

export const hasBattleForm = (rules = []) => (rules ?? []).some((r) => r?.key === "BattleForm");

/* ── Items that impose their own DC ───────────────────────────────────── */

/** Inline DCs that are not flat checks: `@Check[...|dc:N]` and `[[/act ... dc=N]]`. */
export function shiftInlineDCs(text, by) {
  return String(text ?? "")
    .replace(/(@Check\[(?!(?:type:)?flat\b)[^\]]*?\bdc:)(\d+)/g, (m, k, v) => k + (Number(v) - by))
    .replace(/(\[\[\/act [^\]]*?\bdc=)(\d+)/g, (m, k, v) => k + (Number(v) - by));
}

/** Count the inline DCs `shiftInlineDCs` would change. */
export function countInlineDCs(text) {
  const s = String(text ?? "");
  return (s.match(/@Check\[(?!(?:type:)?flat\b)[^\]]*?\bdc:\d+/g) ?? []).length + (s.match(/\[\[\/act [^\]]*?\bdc=\d+/g) ?? []).length;
}

const SPELL_CARRIERS = ["scroll", "wand", "staff", "spellheart"];

/**
 * A physical item of level 1 or higher that imposes its own DC: a consumable or
 * a piece of equipment, never a scroll, a wand, a staff, or anything that
 * carries a spell (those use the user's statistics).
 */
export function itemDCEligible(item) {
  if (!item || (item.type !== "consumable" && item.type !== "equipment")) return false;
  const sys = item.system ?? {};
  const level = Number(sys.level?.value ?? 0);
  if (!(level >= 1)) return false;
  if (SPELL_CARRIERS.includes(sys.category)) return false;
  if (sys.spell) return false;
  const traits = sys.traits?.value ?? [];
  if (traits.some((t) => SPELL_CARRIERS.includes(t))) return false;
  return countInlineDCs(sys.description?.value) > 0;
}

/* ── Strip, as an update ──────────────────────────────────────────────── */

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Every leaf that differs between two copies of the same data, as
 * `{ path, from, to }`. An array that differs is one entry, because Foundry
 * replaces an array whole and cannot address one of its elements by path.
 */
export function diffPaths(before, after, prefix = "") {
  const out = [];
  const walk = (a, b, path) => {
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path, from: a, to: b });
      return;
    }
    if (isPlain(a) && isPlain(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k);
      return;
    }
    // An absent text field the reference normalised to "" is not a change.
    if ((a === undefined || a === null) && b === "") return;
    if (!Object.is(a, b)) out.push({ path, from: a, to: b });
  };
  walk(before, after, prefix);
  return out;
}

/** The label pf2e-flatten gives its custom modifier (scripts/features/pf2e-flatten/constants.js). */
export function isFlattened(actorData, { label, slug } = {}) {
  const mods = actorData?.system?.customModifiers?.all ?? [];
  return mods.some((m) => (label && m?.label === label) || (slug && m?.slug === slug));
}

/** The printed level of an actor's source data (before elite or weak). */
export const printedLevelOf = (actorData) => {
  const v = Number(actorData?.system?.details?.level?.value);
  return Number.isFinite(v) ? v : null;
};

/**
 * Strip as the writes it takes: `{ actor: { path: value }, items: [{ _id, path: value }], printed }`
 * where `printed` keeps every overwritten value as `[path, value]` pairs (never
 * an object keyed by a dotted path, which an update would expand into nesting).
 * Null when nothing changes.
 */
export function stripPlan(actorData, level) {
  const L = level ?? printedLevelOf(actorData);
  // Boss Creatures owns the text of the items it grants and writes it from a
  // Boss DC that already follows this record (its flattenOffset), so Strip
  // leaves them as they are: stripping them too takes the level off twice.
  const ownedByBoss = (item) => readFlag(item?.flags, BOSS_FLAGS.item) != null;
  actorData = { ...actorData, items: (actorData.items ?? []).filter((item) => !ownedByBoss(item)) };
  const stripped = stripActor(actorData, L);
  const actorDiff = diffPaths(actorData.system, stripped.system, "system");
  const items = [];
  const printedItems = [];
  (actorData.items ?? []).forEach((item, i) => {
    const d = diffPaths(item.system, stripped.items[i]?.system, "system");
    if (!d.length || !item._id) return;
    const update = { _id: item._id };
    for (const c of d) {
      update[c.path] = c.to;
      printedItems.push([item._id, c.path, c.from]);
    }
    items.push(update);
  });
  if (!actorDiff.length && !items.length) return null;
  const actor = Object.fromEntries(actorDiff.map((c) => [c.path, c.to]));
  return {
    actor,
    items,
    printed: { actor: actorDiff.map((c) => [c.path, c.from]), items: printedItems },
  };
}

/** The writes that put the printed values back, from a stored strip record. */
export function unstripPlan(record) {
  const actor = {};
  for (const [path, value] of record?.printed?.actor ?? []) if (typeof path === "string") actor[path] = value;
  const byId = new Map();
  for (const [id, path, value] of record?.printed?.items ?? []) {
    if (typeof id !== "string" || typeof path !== "string") continue;
    const u = byId.get(id) ?? { _id: id };
    u[path] = value;
    byId.set(id, u);
  }
  return { actor, items: [...byId.values()] };
}
