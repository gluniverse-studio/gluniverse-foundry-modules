/**
 * Level Ground — names. Pure.
 *
 * Settings and flags live under the suite id with the feature prefix `lvg.`.
 * Every flag key here is written with setFlag/getFlag (or as the full dotted
 * update path `flags.<suite>.lvg.<name>`), which Foundry stores nested as
 * `flags[suite].lvg.<name>`; `readFlag` reads that shape from raw data too.
 */

export const FEATURE_ID = "level-ground";
export const PREFIX = "lvg.";
export const SUITE_ID = "gluniverse-foundry-modules";

/** World toggles (Control Center), in the order they are shown. */
export const TOGGLES = Object.freeze([
  "autoStrip",
  "autoSummoned",
  "reach",
  "outmatched",
  "convertActionDCs",
  "battleForms",
  "itemDCs",
  "levelProf",
  "massiveDamage",
  "tempo",
  "unbowed",
  "threatStrip",
  "assuranceWarnings",
]);

export const SETTINGS = Object.freeze({
  ...Object.fromEntries(TOGGLES.map((k) => [k, `${PREFIX}${k}`])),
  /** Client: the worksheet's manual rows, sources and toggles. */
  worksheet: `${PREFIX}worksheet`,
});

export const FLAGS = Object.freeze({
  strip: "lvg.strip",
  role: "lvg.role",
  roleMarker: "lvg.roleMarker",
  area: "lvg.area",
  levelProf: "lvg.levelProf",
  battleForm: "lvg.battleForm",
  itemDC: "lvg.itemDC",
  tempo: "lvg.tempo",
  unbowed: "lvg.unbowed",
  card: "lvg.card",
});

/** Read a `lvg.*` flag from raw flags (nested, or a literal dotted key). */
export function readFlag(flags, key) {
  const scope = flags?.[SUITE_ID];
  if (!scope || typeof scope !== "object") return undefined;
  if (key in scope) return scope[key];
  return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), scope);
}

/**
 * Whether an actor update's `changed` set or removed the `lvg.strip` record.
 * A flag arrives in more than one shape: nested (`lvg: { strip }`), as the
 * literal dotted key `setFlag` sends, or as a deletion (`-=strip`,
 * `-=lvg.strip`, `-=lvg`). Boss Creatures rewrites a boss's ability text on it.
 */
export function stripChanged(changed) {
  const scope = changed?.flags?.[SUITE_ID];
  if (!scope || typeof scope !== "object") return false;
  return Object.keys(scope).some((k) => {
    if (k === "-=lvg" || k === "-=lvg.strip" || k === "lvg.strip") return true;
    if (k !== "lvg") return false;
    const lvg = scope.lvg;
    return !!lvg && typeof lvg === "object" && Object.keys(lvg).some((j) => j === "strip" || j === "-=strip");
  });
}

/** The full dotted path an update writes a flag under. */
export const flagPath = (key) => `flags.${SUITE_ID}.${key}`;

/** PF2e's settings for Proficiency without Level and their Level Ground values. */
export const PWOL = Object.freeze({
  enabled: "proficiencyVariant",
  modifiers: Object.freeze([
    ["proficiencyUntrainedModifier", -2],
    ["proficiencyTrainedModifier", 2],
    ["proficiencyExpertModifier", 4],
    ["proficiencyMasterModifier", 6],
    ["proficiencyLegendaryModifier", 8],
  ]),
  abp: "automaticBonusVariant",
  /** Fundamental runes removed, property runes kept: the rules remove only potency, striking and resilient. */
  abpRecommended: "ABPFundamentalPotency",
});

/** Modifier slugs the Check.roll wrapper pushes. */
export const SLUGS = Object.freeze({
  reach: "level-ground-reach",
  outmatched: "level-ground-outmatched",
  breakAwayBonus: "level-ground-break-away",
});

/** Suite features that are other flat-accuracy rule sets (they subtract level a second time). */
export const CONFLICTS = Object.freeze(["pf2e-flatten", "flatfinder"]);

/** The window's tabs, in order. */
export const TABS = Object.freeze(["threat", "breakAway", "convert", "stripText", "setup"]);

/** Statistics the converter can call a check for. */
export const CHECK_STATS = Object.freeze([
  "perception",
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery",
]);
