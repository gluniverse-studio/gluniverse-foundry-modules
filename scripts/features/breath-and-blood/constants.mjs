/**
 * Breath and Blood — ids, setting keys, flag keys. Pure: the check tool imports it.
 */

export const FEATURE_ID = "breath-and-blood";
export const PREFIX = "bab.";

/** World settings (all GM-only). */
export const SETTINGS = Object.freeze({
  maxResolve: "bab.maxResolve",
  resolveByLevel: "bab.resolveByLevel",
  havens: "bab.havens",
  grimWounds: "bab.grimWounds",
  generousSupplies: "bab.generousSupplies",
  recurringRivals: "bab.recurringRivals",
  lingeringWounds: "bab.lingeringWounds",
  levelGroundDCs: "bab.levelGroundDCs",
  healingPrompt: "bab.healingPrompt",
  redirectSystemActions: "bab.redirectSystemActions",
});

/** Choices of the two String settings. Each has `GLBAB.settings.<key>.choice.<value>`. */
export const CHOICES = Object.freeze({
  levelGroundDCs: ["auto", "on", "off"],
  healingPrompt: ["always", "unsure", "never"],
});

/**
 * Actor flags, under scope SUITE_ID. Every key sits inside one `bab` object, so
 * `flags[SUITE_ID].bab.<key>`; the update path is `FLAG_ROOT + key`.
 */
export const FLAG = Object.freeze({
  role: "role",
  sharesWith: "sharesWith",
  declines: "declines",
  caughtBreath: "caughtBreath",
  strengthLent: "strengthLent",
  mended: "mended",
  ewImmune: "ewImmune",
  fieldSurgeonUsed: "fieldSurgeonUsed",
  steelUsed: "steelUsed",
  covers: "covers",
  sp: "sp",
  rp: "rp",
  /** On a Battle Medicine immunity effect: the healer's actor id. */
  bmHealer: "bmHealer",
});

/** The feats this variant reads, by slug (the printed feats count as the replacements). */
export const FEATS = Object.freeze({
  continualRecovery: "continual-recovery",
  wardMedic: "ward-medic",
  fieldSurgeon: "field-surgeon",
  encouragingWords: "encouraging-words",
  steelYourResolve: "steel-your-resolve",
  surge: "surge",
  battleMedicine: "battle-medicine",
  medicDedication: "medic-dedication",
  magicHands: "magic-hands",
  assurance: "assurance",
});

/** Update options this feature tags its own writes with. */
export const OPTION = "glbab";

/** Refusal reasons the rules return; each has `GLBAB.refuse.<reason>`. */
export const REFUSALS = Object.freeze([
  "noHeal", "caught", "noHP", "noRP", "notDying", "self", "companion", "full", "lent", "fullHP", "immune",
  "notTwoPools", "noFeat", "steelUsed", "noTarget", "notOwner", "variantOff", "noHealer", "noPatients", "tooMany",
  "bmImmune", "noRank",
]);

/** Why a healing went unpaid; each has `GLBAB.unpaid.<reason>`. */
export const UNPAID_REASONS = Object.freeze(["noHeal", "declined", "noRP", "fullHP"]);

/** Why a source was classified as it was; each has `GLBAB.why.<reason>`. */
export const WHY = Object.freeze([
  "treatWounds", "battleMedicine", "embedded", "generous", "cantrip", "focus", "ritual", "slot", "innateLimited",
  "atWill", "unknownSpell", "infused", "item", "perDay", "unknown", "repeating", "covered",
]);

/** Socket operations (all honoured only on the active GM, on `meta.attested`). */
export const OPS = Object.freeze(["lend", "words", "medicine", "result"]);

export const APP_IDS = Object.freeze({ rest: "glbab-rest", treat: "glbab-treat" });
