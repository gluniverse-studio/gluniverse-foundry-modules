/**
 * Level Ground — reading the world into the plain shapes the pure modules take.
 *
 * Every level here is the PRINTED level (`_source.system.details.level.value`):
 * PF2e's prepared `details.level.value` already includes an elite or weak step,
 * and the rules read every level before that adjustment.
 *
 * Functions only; nothing runs at import.
 */

import { Suite } from "../../core/registry.mjs";
import { isExtraTurn } from "../pf2e-variant-rules/boss/initiative.mjs";
import { PREP } from "../breath-and-blood/actor.mjs";
import { FLAGS, SUITE_ID, readFlag } from "./constants.mjs";

/* ── One actor ────────────────────────────────────────────────────────── */

/** The printed level: stored source level, before elite or weak. */
export function printedLevel(actor) {
  const src = actor?._source?.system?.details?.level?.value;
  if (Number.isFinite(Number(src)) && src !== null && src !== "") return Number(src);
  const base = actor?.system?.details?.level?.base;
  if (Number.isFinite(base)) return base;
  const v = actor?.system?.details?.level?.value ?? actor?.level;
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

export const flagOf = (doc, key) => {
  try {
    const v = doc?.getFlag?.(SUITE_ID, key);
    if (v !== undefined) return v;
  } catch {
    /* fall through to the raw read */
  }
  return readFlag(doc?.flags ?? doc?._source?.flags, key);
};

/** The actor's role: "none", "mook", "solo" or "summoned". */
export const roleOf = (actor) => {
  const r = flagOf(actor, FLAGS.role)?.role;
  return ["mook", "solo", "summoned"].includes(r) ? r : "none";
};

export const isSolo = (actor) => roleOf(actor) === "solo";

export const stripRecord = (actor) => flagOf(actor, FLAGS.strip) ?? null;

const hasTrait = (actor, trait) => !!(actor?.traits?.has?.(trait) || actor?.system?.traits?.value?.includes?.(trait));

/** A player character in the party (not a minion, eidolon or familiar). */
export function isPartyPC(actor) {
  if (actor?.type !== "character") return false;
  if (hasTrait(actor, "minion") || hasTrait(actor, "eidolon")) return false;
  return actor.alliance !== "opposition";
}

/** Part of its PC for the worksheet: an animal companion, eidolon, familiar or summoned creature. */
const partOfAPC = (actor) =>
  actor?.type === "familiar" || hasTrait(actor, "minion") || hasTrait(actor, "eidolon") || hasTrait(actor, "summoned");

/**
 * Maximum Hit Points with Breath and Blood's Stamina pool added back: the
 * deadly test reads both pools, and a role's Hit Points are set from the total
 * before Breath and Blood splits it. A character's Stamina is pf2e's
 * `hp.sp`; an NPC's lives only in Breath and Blood's prepared pools (`PREP`).
 */
export function maxHPOf(actor) {
  const hp = actor?.system?.attributes?.hp;
  const max = Number(hp?.max) || 0;
  let sp = 0;
  try {
    if (Suite.enabled("breath-and-blood")) sp = Number(PREP.get(actor)?.maxSP ?? hp?.sp?.max) || 0;
  } catch {
    sp = 0;
  }
  return max + sp;
}

/** A guess: the PC casts from a regular (prepared or spontaneous) spellcasting entry. */
export function isCaster(actor) {
  try {
    const entries = actor?.spellcasting?.regular ?? actor?.itemTypes?.spellcastingEntry ?? [];
    return entries.some((entry) => {
      const type = entry?.system?.prepared?.value ?? entry?.category;
      return ["prepared", "spontaneous"].includes(type);
    });
  } catch {
    return false;
  }
}

/** One worksheet row for an NPC or hazard. */
export function rowFromActor(actor, { id, name, hidden = false } = {}) {
  const hazard = actor?.type === "hazard" ? (actor.system?.details?.isComplex ? "complex" : "simple") : "";
  const role = roleOf(actor);
  return {
    id: id ?? actor?.uuid ?? actor?.id ?? "",
    uuid: actor?.uuid ?? null,
    name: name ?? actor?.name ?? "",
    count: 1,
    level: printedLevel(actor) ?? 0,
    role: role === "mook" || role === "solo" ? role : "standard",
    adjust: hazard ? "" : actor?.system?.attributes?.adjustment ?? "",
    area: !!flagOf(actor, FLAGS.area),
    hazard,
    hidden: !!hidden,
    editable: false,
  };
}

/* ── A combat ─────────────────────────────────────────────────────────── */

/** Who is in a combat: `{ pcs, threats: [{combatant, actor}], allies: [actor] }`, each creature once. */
export function participants(combat) {
  const pcs = [];
  const threats = [];
  const allies = [];
  const seen = new Set();
  const D = globalThis.CONST?.TOKEN_DISPOSITIONS ?? { FRIENDLY: 1, NEUTRAL: 0 };
  for (const combatant of combat?.combatants ?? []) {
    const actor = combatant.actor;
    if (!actor || isExtraTurn(combatant)) continue;
    const key = actor.uuid ?? combatant.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isPartyPC(actor)) {
      pcs.push(actor);
      continue;
    }
    if (actor.type !== "npc" && actor.type !== "hazard") continue;
    if (partOfAPC(actor)) continue;
    const disposition = combatant.token?.disposition;
    if (actor.alliance === "party" || disposition === D.FRIENDLY) {
      if (actor.type === "npc") allies.push(actor);
      continue;
    }
    if (disposition === D.NEUTRAL) continue;
    threats.push({ combatant, actor });
  }
  return { pcs, threats, allies };
}

export const viewedCombat = () => game.combats?.viewed ?? game.combat ?? null;

/** The party's PCs: those in the combat, else the Party actor's members. */
export function partyPCs(combat = viewedCombat()) {
  const { pcs } = participants(combat);
  if (pcs.length) return { source: "combat", actors: pcs };
  const members = (game.actors?.party?.members ?? []).filter(isPartyPC);
  if (members.length) return { source: "party", actors: members };
  return { source: "manual", actors: [] };
}

export const pcEntry = (actor) => ({
  id: actor.id,
  uuid: actor.uuid,
  name: actor.name,
  level: printedLevel(actor) ?? 1,
  maxHP: maxHPOf(actor),
});

/** The opposition and party of a combat for the tracker strip. */
export function combatWorksheet(combat) {
  const { pcs, threats, allies } = participants(combat);
  const party = pcs.length ? pcs : (game.actors?.party?.members ?? []).filter(isPartyPC);
  const top = party.slice().sort((a, b) => (printedLevel(b) ?? 0) - (printedLevel(a) ?? 0))[0];
  return {
    rows: threats.map(({ combatant, actor }) =>
      rowFromActor(actor, { id: combatant.id, name: combatant.name, hidden: combatant.hidden || combatant.token?.hidden }),
    ),
    party: {
      pcs: party.map(pcEntry),
      allies: allies.map((a) => ({ name: a.name, level: printedLevel(a) ?? 0, mook: roleOf(a) === "mook" })),
      area: true,
      casterLeads: top ? isCaster(top) : false,
    },
  };
}
