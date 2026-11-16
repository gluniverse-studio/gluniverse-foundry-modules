#!/usr/bin/env node
/**
 * Level Ground — consistency check.
 *
 *   node tools/level-ground-check.mjs
 *
 * Almost everything this feature gets wrong renders perfectly: a Convert row
 * one off is a plausible DC, a threat value transcribed wrong is a plausible
 * band, a battle form left with "+ your level" in its AC is a plausible AC, a
 * Strip that misses a path is a creature that looks Stripped. So this tool
 * re-runs every rules vector (C, R, O, B, V, W, H, T, S, A) from the rules'
 * own text (tools/fixtures/level-ground/test-vectors.md) against the shipped
 * rules.mjs, holds the data block, the reference tables and the battle forms
 * to the rules, drives the rewrites, Strip and Unstrip, the roll wrapper and
 * the roles through the shipped modules with a stub `game`, and pins the lang
 * file, the settings, the CSS and the purity of the pure modules.
 *
 * Every fixture is in tools/fixtures/level-ground; nothing here reads the
 * rules' working folder. Zero problems required.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = "scripts/features/level-ground";
const FIX = "tools/fixtures/level-ground";
const read = (p) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const json = (p) => JSON.parse(read(p));
const problems = [];
let checks = 0;
const fail = (msg) => problems.push(msg);
const same = (id, got, want) => {
  checks += 1;
  if (String(got) !== String(want)) fail(`${id}: got ${got}\n      want ${want}`);
};
const ok = (id, cond, msg = "") => {
  checks += 1;
  if (!cond) fail(`${id}${msg ? `: ${msg}` : ""}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ── A stub world, installed before any glue module is imported ────────── */

const SUITE = "gluniverse-foundry-modules";
const settingsStore = new Map();
const pf2eSettings = new Map([
  ["proficiencyVariant", true],
  ["proficiencyUntrainedModifier", -2],
  ["proficiencyTrainedModifier", 2],
  ["proficiencyExpertModifier", 4],
  ["proficiencyMasterModifier", 6],
  ["proficiencyLegendaryModifier", 8],
]);
class StubModifier {
  constructor({ slug, label, modifier, type = "untyped" }) {
    Object.assign(this, { slug, label, modifier, type });
  }
}
globalThis.game = {
  user: { id: "gm", isGM: true, isActiveGM: true },
  users: { activeGM: { id: "gm" }, filter: () => [] },
  settings: {
    get(scope, key) {
      if (scope === "pf2e") {
        if (!pf2eSettings.has(key)) throw new Error(`unregistered pf2e.${key}`);
        return pf2eSettings.get(key);
      }
      if (!settingsStore.has(key)) throw new Error(`unregistered ${scope}.${key}`);
      return settingsStore.get(key);
    },
    async set(scope, key, value) {
      if (scope === "pf2e") pf2eSettings.set(key, value);
      else settingsStore.set(key, value);
      return value;
    },
    register(scope, key, def) {
      if (scope !== SUITE) fail(`a setting registered under ${scope}`);
      settingsStore.set(key, def.default);
    },
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` },
  pf2e: { Modifier: StubModifier },
  actors: { contents: [], get: () => null },
  messages: { get: () => null },
  modules: { get: () => null },
};
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

/* ── The shipped modules ──────────────────────────────────────────────── */

const rules = await import(join(ROOT, FEATURE, "rules.mjs"));
const logic = await import(join(ROOT, FEATURE, "logic.mjs"));
const constants = await import(join(ROOT, FEATURE, "constants.mjs"));
const reference = await import(join(ROOT, FEATURE, "reference.mjs"));
const view = await import(join(ROOT, FEATURE, "view.mjs"));
const settings = await import(join(ROOT, FEATURE, "settings.mjs"));
const checksMod = await import(join(ROOT, FEATURE, "checks.mjs"));
const actorsMod = await import(join(ROOT, FEATURE, "actors.mjs"));
await import(join(ROOT, FEATURE, "world.mjs"));
await import(join(ROOT, FEATURE, "combat.mjs"));
await import(join(ROOT, FEATURE, "chat.mjs"));
await import(join(ROOT, FEATURE, "app.mjs"));
await import(join(ROOT, FEATURE, "setup.mjs"));
await import(join(ROOT, FEATURE, "index.mjs"));

for (const [key, def] of settings.settingDefinitions()) game.settings.register(SUITE, key, def);

const c = rules;

/* ═══ 1. The rules' test vectors, read from the rules' own text ════════════ */

const md = read(`${FIX}/test-vectors.md`);
const tvText = md.slice(md.indexOf("### Test Vectors"));
const rows = {};
for (const line of tvText.split("\n")) {
  const m = /^\| ([A-Z]+\d+) \| (.*) \|$/.exec(line);
  if (m) rows[m[1]] = m[2].split(" | ");
}
const data = json(`${FIX}/data-block.json`);
const CRIT = data.crit;
const AREA = data.area;

const neg = (s) => String(s).replace(/-/g, "−");
const j = (a) => a.map(neg).join(", ");
const r3 = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 1000) / 1000));
const RK = logic.RANKS;
const S = (count, level, o = {}) => Object.assign({ count, level, role: "standard", adjust: "", area: false, hazard: "" }, o);

const expected = {
  C1: j([5, 10, 13].map(c.convertDC)),
  C2: j([14, 15, 16].map(c.convertDC)),
  C3: j([17, 19].map(c.convertDC)),
  C4: j([20, 21, 24].map(c.convertDC)),
  C5: j([25, 28, 29, 32].map(c.convertDC)),
  C6: j([33, 36, 37, 40].map(c.convertDC)),
  C7: j([41, 42, 45, 50, 60].map(c.convertDC)),
  C8: j([13, 14, 19, 20, 28, 29, 39, 40, 41].map(c.taskRank)),
  C9: j([-1, 0, 2, 3, 5, 6, 11, 12, 15, 18, 20, 21, 24].map(c.levelDC)),
  C10: j([-1, 0, 4, 5, 11, 12, 19, 20].map(c.levelRank)),
  C11: j([0, 1, 2, 3, 4, 5].map(c.rankDC)),
  C12: j([1, 2, 3, 4].map(c.assurance)),
  C13: String(c.levelDC(10) + logic.DC_ADJUSTMENTS["very-hard"]),
  // Reach through the shipped reachPenalty (the wrapper's own arithmetic).
  R1: neg(logic.reachPenalty(1, 3)),
  R2: neg(logic.reachPenalty(0, 1)),
  R3: neg(logic.reachPenalty(0, 2)),
  R4: neg(logic.reachPenalty(2, 1)),
  R5: neg(logic.reachPenalty(1, 4)),
  R6: neg(logic.reachPenalty(4, 5)),
  // Outmatched through the shipped outmatchedBonus (gap = target − effect).
  O1: j([-3, 0].map((g) => logic.outmatchedBonus({ targetLevel: 10 + g, effectLevel: 10 }).bonus)),
  O2: j([1, 2, 3, 4].map((g) => logic.outmatchedBonus({ targetLevel: 10 + g, effectLevel: 10 }).bonus)),
  O3: j([5, 9].map((g) => logic.outmatchedBonus({ targetLevel: 10 + g, effectLevel: 10 }).bonus)),
  O4: String(logic.outmatchedBonus({ targetLevel: 8, effectLevel: 10, solo: true }).bonus),
  // Break Away through the shipped breakAwayRow (the window's and card's DC).
  B1: logic.breakAwayRow({ pursuerLevel: 15 }),
  B2: logic.breakAwayRow({ pursuerLevel: 15, flies: true }),
  B3: logic.breakAwayRow({ pursuerLevel: 15, flies: true, faster: true }),
  B4: logic.breakAwayRow({ pursuerLevel: 15, faster: true, ground: true }),
  B5: logic.breakAwayRow({ pursuerLevel: 15, faster: true, ground: true, carrying: true }),
  B6: logic.breakAwayRow({ pursuerLevel: 8, faster: true, carrying: true }),
  B7: logic.breakAwayRow({ pursuerLevel: 3, carrying: true }),
  B8: logic.breakAwayRow({ pursuerLevel: 1, ground: true }),
  B9: logic.breakAwayRow({ pursuerLevel: -1 }),
  B10: logic.breakAwayRow({ pursuerLevel: 24 }),
  B11: logic.breakAwayRow({ pursuerLevel: 30 }),
  V1: j([-1, 0, 1, 3, 7, 10, 20].map(c.specialistCap)),
  V2: j(["standard", "mook", "solo"].map((role) => c.creatureValue({ level: 3, role }))),
  V3: j([4, 5, 10].map((level) => r3(c.creatureValue({ level, adjust: "elite" })))),
  V4: j([4, 5, 12].map((level) => r3(c.creatureValue({ level, adjust: "weak" })))),
  V5: String(c.creatureValue({ level: 9, adjust: "elite", role: "solo" })),
  V6: j([4, 5].map((level) => c.creatureValue({ level, adjust: "elite", role: "mook" }))),
  V7: j([25, 26].map((l) => r3(c.tv(l)))),
  V8: j([25, 26].map((l) => r3(c.mookValue(l)))),
  V9: `${j([-2, -3].map(c.tv))}; ${c.mookValue(-2)}`,
  // The word list as the shipped lang file prints it, band by band.
  W1: logic.BAND_LABELS.map((label) => logic.wordOf(label)).join(", "),
  // Hit Points through the shipped roleHP (the role writes).
  H1: logic.roleHP("mook", 50),
  H2: logic.roleHP("mook", 285),
  H3: logic.roleHP("solo", 50),
  H4: logic.roleHP("summoned", 51),
  H5: logic.isDeadly({ level: 15 }, 73) ? `yes (Crit ${logic.critValue(15)})` : "no",
  H6: `${logic.isDeadly({ level: 3 }, 24) ? "yes" : `no (Crit ${logic.critValue(3)})`}; ${logic.isDeadly({ level: 3, area: true }, 24) ? `yes (2 × Area = ${2 * logic.areaValue(3)})` : "no"}`,
};

const seen = new Set();
for (const [id, got] of Object.entries(expected)) {
  seen.add(id);
  if (!rows[id]) {
    fail(`${id}: missing from the rules' vectors`);
    continue;
  }
  same(id, got, rows[id][rows[id].length - 1]);
}

// The worksheet rows, parsed from the document itself, run through the shipped `reading`.
for (const [id, cells] of Object.entries(rows)) {
  if (/^T\d+$/.test(id)) {
    seen.add(id);
    const [pt, ot, site, total, party, ratio, q, plain, label, xp] = cells;
    const area = !/no area/.test(pt);
    const casterLeads = /led by a spellcaster/.test(pt);
    const allies = [];
    let pcs = pt.replace(", no area", "").replace(", led by a spellcaster", "");
    const am = / and (four|two|a) level (\d+) (Mook allies|ally who is not a Mook|allies who are not Mooks)/.exec(pcs);
    if (am) {
      for (let i = 0; i < ({ four: 4, two: 2 }[am[1]] || 1); i++) allies.push({ level: +am[2], mook: /Mook allies/.test(am[3]) });
      pcs = pcs.slice(0, am.index);
    }
    const levels = pcs.split(", ").map(Number);
    const opp = ot.split(", ").map((tx) => {
      const m = /^(\d+) × (−?\d+)(.*)$/.exec(tx);
      return S(+m[1], +m[2].replace("−", "-"), {
        role: /Solo/.test(m[3]) ? "solo" : /Mook/.test(m[3]) ? "mook" : "standard",
        adjust: /elite/.test(m[3]) ? "elite" : /weak/.test(m[3]) ? "weak" : "",
        area: /area attack/.test(m[3]),
        hazard: /simple hazard/.test(m[3]) ? "simple" : /complex hazard/.test(m[3]) ? "complex" : "",
      });
    });
    const r = c.rate(opp, { levels, allies, area, casterLeads });
    same(id, [r.site, r.total, r.partyTotal, r.ratio.toFixed(3), r.ticks, r.plain, r.label, r.xp].join(" | "), [site, total, party, ratio, q, plain, label, xp].join(" | "));
    // The window's reading (logic.reading) must say what `rate` says.
    const rd = logic.reading(
      opp.map((o, i) => ({ ...o, name: `c${i}` })),
      { pcs: levels.map((level, i) => ({ name: `pc${i}`, level, maxHP: 1000 })), allies, area, casterLeads },
    );
    ok(`${id} reading`, rd && rd.label === r.label && rd.xp === r.xp && rd.band === logic.bandKey(r.label) && rd.pct === Math.round(r.ratio * 100), "reading() disagrees with rate()");
  }
  if (/^S\d+$/.test(id)) {
    seen.add(id);
    const [level, input, want] = cells;
    same(id, "`" + c.stripBlock(input.slice(1, -1), +level.replace("−", "-")) + "`", want);
  }
}

// A1 to A5: the structured data as the rules write it, through stripActor AND the shipped stripPlan.
const A = tvText.slice(tvText.indexOf("**Strip on structured data.**"));
const withIds = (actor) => {
  const a = clone(actor);
  a.items = (a.items ?? []).map((it, i) => ({ _id: `item${i}`, ...it }));
  return a;
};
/** Apply a stripPlan's writes to a copy, the way an update would. */
function applyPlan(actorData, plan) {
  const out = clone(actorData);
  const setPath = (obj, path, value) => {
    const parts = path.split(".");
    let o = obj;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    o[parts.at(-1)] = clone(value);
  };
  for (const [path, value] of Object.entries(plan.actor ?? {})) setPath(out, path, value);
  for (const u of plan.items ?? []) {
    const item = out.items.find((i) => i._id === u._id);
    for (const [path, value] of Object.entries(u)) if (path !== "_id") setPath(item, path, value);
  }
  return out;
}
const structured = {
  A1: {
    type: "npc",
    system: {
      details: { level: { value: 4 } },
      attributes: { ac: { value: 20, details: "(22 with shield raised)" } },
      saves: { fortitude: { value: 13 }, reflex: { value: 9 }, will: { value: 11 } },
      perception: { mod: 11 },
      skills: { athletics: { base: 13 }, stealth: { base: 9, special: [{ base: 14 }] } },
    },
    items: [
      { type: "melee", system: { bonus: { value: 13 } } },
      { type: "action", system: { description: { value: "@Check[reflex|dc:21|basic] or grabbed ([[/act escape dc=21]]); @Check[flat|dc:5] to end it" } } },
    ],
  },
  A2: {
    type: "hazard",
    system: {
      details: { level: { value: 3 }, disable: "Survival (trained) or Thievery (expert) DC 20 to rearrange the webbing." },
      attributes: { ac: { value: 19 }, stealth: { value: 13, details: "<p>@Check[stealth|dc:23]</p>" } },
      saves: { fortitude: { value: 9 }, reflex: { value: 9 }, will: { value: 0 } },
    },
    items: [{ type: "action", system: { description: { value: "@Check[reflex|dc:20|basic]" } } }],
  },
  A3: {
    type: "npc",
    system: {
      details: { level: { value: 0 } },
      attributes: { ac: { value: 14 } },
      saves: { fortitude: { value: 6 }, reflex: { value: 3 }, will: { value: 19, saveDetail: "(+21 vs. emotion)" } },
      perception: { mod: 17, details: "(+19 to Sense Motive)" },
      skills: { diplomacy: { base: 22, special: [{ base: 24 }] } },
    },
    items: [{ type: "lore", system: { mod: { value: 19 } } }],
  },
  A4: {
    type: "npc",
    system: {
      details: { level: { value: 6 } },
      attributes: { ac: { value: 23 } },
      saves: { fortitude: { value: 12 }, reflex: { value: 15 }, will: { value: 12 } },
      perception: { mod: 13 },
    },
    items: [
      { type: "consumable", system: { description: { value: "@Check[fortitude|dc:18]" } } },
      { type: "equipment", system: { description: { value: "[[/act escape dc=22]]" } } },
      { type: "spell", system: { description: { value: "@Check[reflex|dc:10]" } } },
      { type: "spellcastingEntry", system: { spelldc: { value: 0, dc: 24 } } },
      { type: "action", system: { description: { value: "DC 24 basic Fortitude save; @Check[fortitude|dc:24]" } } },
    ],
  },
  A5: {
    type: "hazard",
    system: {
      details: { level: { value: 23 }, routine: "@Check[will|dc:48|basic]" },
      attributes: { ac: { value: 0 }, stealth: { value: 0, details: "" } },
      saves: { fortitude: { value: 0 }, reflex: { value: 0 }, will: { value: 0 } },
    },
    items: [],
  },
};
const describe = {
  A1: (w) => {
    const y = w.system;
    return `${y.attributes.ac.value} and "${y.attributes.ac.details}"; ${y.saves.fortitude.value}, ${y.saves.reflex.value}, ${y.saves.will.value}; ${y.perception.mod}; ${y.skills.athletics.base}; ${y.skills.stealth.base} with ${y.skills.stealth.special[0].base}; ${w.items[0].system.bonus.value}; \`${w.items[1].system.description.value}\`.`;
  },
  A2: (w) => {
    const y = w.system;
    return `${y.attributes.ac.value}; ${y.saves.fortitude.value}, ${y.saves.reflex.value}, and ${y.saves.will.value}; ${y.attributes.stealth.value} and \`${y.attributes.stealth.details}\`; "${y.details.disable}"; \`${w.items[0].system.description.value}\`.`;
  },
  A3: (w) => {
    const y = w.system;
    return `${y.attributes.ac.value}; ${y.saves.will.value} with "${y.saves.will.saveDetail}"; ${y.perception.mod} with "${y.perception.details}"; ${y.skills.diplomacy.base} with ${y.skills.diplomacy.special[0].base}; ${w.items[0].system.mod.value}.`;
  },
  A4: (w, src) => {
    const unchanged = [0, 1, 2].every((i) => w.items[i].system.description.value === src.items[i].system.description.value);
    return `${unchanged ? "the first three unchanged" : "CHANGED"}; ${w.items[3].system.spelldc.value} and ${w.items[3].system.spelldc.dc}; \`${w.items[4].system.description.value}\`.`;
  },
  A5: (w) => `${w.system.attributes.ac.value}; ${w.system.attributes.stealth.value}; \`${w.system.details.routine}\`.`,
};
for (const [id, src] of Object.entries(structured)) {
  seen.add(id);
  const viaRules = describe[id](c.stripActor(clone(src)), src);
  ok(id, A.includes(`Expected: ${viaRules}`), `stripActor gives ${viaRules}`);
  // The same through the writes the feature makes, then back through Unstrip.
  const actorData = withIds(src);
  const plan = logic.stripPlan(actorData, logic.printedLevelOf(actorData));
  const written = plan ? applyPlan(actorData, plan) : clone(actorData);
  const viaPlan = describe[id](written, src);
  ok(`${id} as writes`, A.includes(`Expected: ${viaPlan}`), `stripPlan writes give ${viaPlan}`);
  if (plan) {
    const record = JSON.parse(JSON.stringify({ level: logic.printedLevelOf(actorData), printed: plan.printed }));
    const back = applyPlan(written, logic.unstripPlan(record));
    ok(`${id} round trip`, eq(back, actorData), "Unstrip does not restore the printed data exactly");
    ok(`${id} record`, plan.printed.actor.every((p) => Array.isArray(p) && typeof p[0] === "string"), "printed values must be [path, value] pairs");
  }
}

const docIds = Object.keys(rows).length + Object.keys(structured).length;
ok("vector coverage", Object.keys(rows).every((id) => seen.has(id)), `unchecked: ${Object.keys(rows).filter((id) => !seen.has(id)).join(", ")}`);
const vectorCount = seen.size;

/* ═══ 2. The data block against the shipped tables ═════════════════════════ */

ok("data version", data.version === rules.RULES_VERSION, `${data.version} vs ${rules.RULES_VERSION}`);
ok("data threat == TV", eq(data.threat, rules.TV));
ok("data mook == MOOK", eq(data.mook, rules.MOOK));
ok("data crit == CRIT", eq(data.crit, rules.CRIT));
ok("data area == AREA", eq(data.area, rules.AREA));
ok("data words == WORDS", data.worksheet.bands.map((b) => b.word).join("|") === rules.WORDS.join("|"));
ok("data bands == BAND_LABELS", data.worksheet.bands.map((b) => b.name).join("|") === logic.BAND_LABELS.join("|"));
ok("data band XP", data.worksheet.bands.every((b) => rules.rate([S(1, 1)], { levels: [1] }) && Number.isFinite(b.xp)));
for (const [rank, value] of Object.entries(data.rankDC)) same(`rankDC ${rank}`, rules.rankDC(RK.indexOf(rank)), value);
for (const [i, [key, value]] of constants.PWOL.modifiers.entries()) same(`PWoL ${key}`, value, data.proficiencyBonus[RK[i]]);
for (const [name, value] of Object.entries(data.dcAdjustments)) {
  const key = name.replace(/ /g, "-");
  const v = key in logic.DC_ADJUSTMENTS ? logic.DC_ADJUSTMENTS[key] : logic.RARITY_ADJUSTMENTS[key];
  same(`dc adjustment ${name}`, v, value);
}
for (const [gap, bonus] of Object.entries(data.outmatched.bonusByLevelsAboveEffect)) same(`outmatched gap ${gap}`, rules.outmatched(+gap), bonus);
same("outmatched solo floor", logic.outmatchedBonus({ targetLevel: 0, effectLevel: 20, solo: true }).gap, data.outmatched.soloMinimumLevelsAbove);
ok("outmatched solo, unknown level", logic.outmatchedBonus({ targetLevel: null, effectLevel: null, solo: true })?.bonus === data.outmatched.maximumBonus);
ok("outmatched unknown level, not a Solo", logic.outmatchedBonus({ targetLevel: 5, effectLevel: null }) === null);
same("effect level of a spell", logic.effectLevel({ kind: "spell", rank: 3 }), 6);
same("unbowed turns", logic.UNBOWED_TURNS, data.roles.solo.unbowedEndsAfterTurns);
same("massive dying increase", logic.massiveDying({ critical: false, wounded: 0 }) - 1, data.massiveDamage.dyingValueIncrease);
same("break away DC above 20 continues", logic.breakAwayRow({ pursuerLevel: 21 }), 21);
ok("break away awards no XP", data.breakAway.awardsXP === false);

/* ═══ 3. The converter and the reference tables ════════════════════════════ */

for (const cdc of reference.COMMON_DCS) {
  same(`common ${cdc.key}`, cdc.printed.map(rules.convertDC).join(","), reference.COMMON_EXPECTED[cdc.key].join(","));
}
for (const f of reference.FIXED_DCS) {
  same(`fixed ${f.name} DCs`, f.printed.map(rules.convertDC).join(","), f.dc.join(","));
  same(`fixed ${f.name} ranks`, [...new Set(f.printed.map(rules.taskRank))].join(","), f.ranks.join(","));
}
const cv = (o) => logic.convert(o);
same("convert printed 20", cv({ mode: "printed", value: 20 }).dc, 16);
same("convert printed 20 hard", cv({ mode: "printed", value: 20, adjust: "hard" }).dc, 18);
same("convert level 10", cv({ mode: "level", value: 10 }).dc, 17);
same("convert level 10 rank", RK[cv({ mode: "level", value: 10 }).rank], "expert");
same("convert spell rank 3 (level 5)", cv({ mode: "spell", spellRank: 3 }).dc, rules.levelDC(5));
same("convert ritual 30 at rank 4", cv({ mode: "ritual", value: 30, spellRank: 4 }).dc, 22);
same("convert rank master", cv({ mode: "rank", value: 3 }).dc, 18);
same("convert rare", cv({ mode: "printed", value: 15, rarity: "rare" }).dc, 19);
same("convert minimum rank wins", RK[cv({ mode: "printed", value: 15, minRank: 3 }).rank], "master");
ok("convert garbage", cv({ mode: "printed", value: "x" }) === null);

/* ── Inline checks and the options the wrapper reads ── */

const inline = logic.inlineCheck({ statistic: "athletics", dc: 16, rank: 2, name: "Climb | the [cliff]" });
same("inline check", inline, "@Check[athletics|dc:16|options:level-ground:task-rank:2|name:Climb   the  cliff]");
// PF2e splits each parameter at its FIRST colon and `options:` on commas.
{
  const params = inline.slice("@Check[".length, -1).split("|").map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]);
  const opts = params.find(([k]) => k === "options")[1].split(",");
  ok("inline option survives PF2e's parser", opts.includes("level-ground:task-rank:2"));
  same("task rank read back", logic.readTaskRank(new Set(opts)), 2);
}
ok("inline refuses a bad slug", logic.inlineCheck({ statistic: "Ath letics", dc: 15 }) === null);
same("break away flag", logic.isBreakAway(new Set([logic.OPT.breakAway])), true);
same("proficiency read", logic.readProficiencyRank(["proficiency:master"]), 3);
same("bonus read", logic.readNumberOption(["level-ground:break-away-bonus:3"], logic.OPT.breakAwayBonus), 3);
same("clamp bonus 1", logic.clampBonus(1), 2);
same("clamp bonus 9", logic.clampBonus(9), 4);
same("break away results", ["criticalSuccess", "success", "failure", "criticalFailure", "x"].map(logic.breakAwayResult).join(","), "escapeAlly,escape,pursued,caught,pending");

/* ═══ 4. The roll wrapper, driven ══════════════════════════════════════════ */

function fakeCheck(slug = "athletics") {
  return {
    slug,
    modifiers: [],
    push(m) {
      this.modifiers.push(m);
    },
  };
}
const run = (check, context) => {
  let passed = null;
  checksMod.checkRollHandler((ch, ctx) => (passed = { ch, ctx }), check, context);
  return passed;
};
const actor = (level, extra = {}) => ({ _source: { system: { details: { level: { value: level } } } }, flags: {}, getFlag: () => undefined, ...extra });
const soloActor = (level) => actor(level, { flags: { [SUITE]: { lvg: { role: { role: "solo" } } } } });

{
  // Reach: trained against a master task.
  const ch = fakeCheck();
  run(ch, { type: "skill-check", options: new Set(["proficiency:trained", "level-ground:task-rank:3"]) });
  same("reach applied", ch.modifiers.map((m) => `${m.slug}:${m.modifier}`).join(","), "level-ground-reach:-4");
}
{
  // Reach never on Break Away.
  const ch = fakeCheck();
  run(ch, { type: "skill-check", options: new Set(["proficiency:untrained", "level-ground:task-rank:4", logic.OPT.breakAway, "level-ground:break-away-bonus:2"]) });
  same("no reach on Break Away", ch.modifiers.map((m) => `${m.slug}:${m.modifier}:${m.type}`).join(","), "level-ground-break-away:2:circumstance");
}
{
  // No task rank: nothing.
  const ch = fakeCheck();
  run(ch, { type: "skill-check", options: new Set(["proficiency:untrained"]) });
  same("no task rank, no reach", ch.modifiers.length, 0);
}
{
  // Outmatched on a save: PF2e's incapacitation step goes, the bonus and the floor arrive.
  const ch = fakeCheck("will");
  const native = { adjustments: { all: { label: "PF2E.TraitIncapacitation", amount: -1 } } };
  const ctx = {
    type: "saving-throw",
    options: new Set(["item:trait:incapacitation"]),
    dc: { value: 20 },
    actor: actor(9),
    origin: { actor: actor(5) },
    dosAdjustments: [native],
  };
  run(ch, ctx);
  same("outmatched save bonus", ch.modifiers.map((m) => `${m.slug}:${m.modifier}`).join(","), "level-ground-outmatched:10");
  ok("incapacitation step removed", !ctx.dosAdjustments.includes(native));
  ok("critical failure floor", eq(ctx.dosAdjustments.at(-1), logic.outmatchedSaveAdjustment("GLLVG.roll.outmatched")));
}
{
  // Outmatched, equal levels: no bonus, and PF2e's step still goes (the rule replaces the trait).
  const ch = fakeCheck("will");
  const native = { adjustments: { all: { label: "PF2E.TraitIncapacitation", amount: 1 } } };
  const ctx = { type: "saving-throw", options: new Set(["incapacitation"]), dc: { value: 20 }, actor: actor(5), origin: { actor: actor(5) }, dosAdjustments: [native] };
  run(ch, ctx);
  ok("equal levels: no bonus", ch.modifiers.length === 0 && ctx.dosAdjustments.length === 0);
}
{
  // Outmatched against a Solo's DC: the DC rises, a critical success is a success.
  const ch = fakeCheck("athletics");
  const ctx = { type: "skill-check", options: new Set(["incapacitation"]), dc: { value: 15, label: "DC" }, actor: actor(10), target: { actor: soloActor(6) }, origin: { actor: actor(10) }, dosAdjustments: [] };
  run(ch, ctx);
  same("solo DC raised", ctx.dc.value, 25);
  ok("solo crit-success cap", eq(ctx.dosAdjustments.at(-1), logic.outmatchedCheckAdjustment("GLLVG.roll.outmatched")));
}
{
  // Treat Wounds and First Aid DCs are Converted (and only once).
  const ctx = { type: "skill-check", options: new Set(["action:treat-wounds"]), dc: { value: 30 } };
  run(fakeCheck("medicine"), ctx);
  same("treat wounds DC", ctx.dc.value, 18);
  run(fakeCheck("medicine"), ctx);
  same("treat wounds DC converted once", ctx.dc.value, 18);
  const fa = { type: "skill-check", options: new Set(["action:administer-first-aid"]), dc: { value: 15 } };
  run(fakeCheck("medicine"), fa);
  same("first aid DC", fa.dc.value, 14);
  const stab = { type: "skill-check", options: new Set(["action:administer-first-aid", "action:administer-first-aid:stabilize"]), dc: { value: 17 } };
  run(fakeCheck("medicine"), stab);
  same("stabilize DC (printed 17)", stab.dc.value, 15);
  const bleed = { type: "skill-check", options: new Set(["action:administer-first-aid", "action:administer-first-aid:stop-bleeding"]), dc: { value: 25 } };
  run(fakeCheck("medicine"), bleed);
  same("stop bleeding is DC 14", bleed.dc.value, checksMod.STOP_BLEEDING_DC);
  same("stop bleeding DC is the rules' 14", checksMod.STOP_BLEEDING_DC, 14);
}
{
  // A toggle switched off is off.
  settingsStore.set(constants.SETTINGS.reach, false);
  const ch = fakeCheck();
  run(ch, { type: "skill-check", options: new Set(["proficiency:trained", "level-ground:task-rank:4"]) });
  same("reach off", ch.modifiers.length, 0);
  settingsStore.set(constants.SETTINGS.reach, true);
}
{
  // A step that throws degrades the rule, never the roll.
  let rolled = false;
  const quiet = console.error;
  console.error = () => {};
  checksMod.checkRollHandler(() => (rolled = true), null, { type: "skill-check", get options() { throw new Error("boom"); } });
  console.error = quiet;
  ok("a failing step still rolls", rolled);
}

/* ── Massive damage, Tempo, Unbowed ── */

ok("massive", logic.isMassive({ damageTaken: 60, hpMax: 30, hpAfter: 0 }));
ok("not massive above 0", !logic.isMassive({ damageTaken: 60, hpMax: 30, hpAfter: 1 }));
ok("not massive below twice", !logic.isMassive({ damageTaken: 59, hpMax: 30, hpAfter: 0 }));
ok("massive counts Stamina", !logic.isMassive({ damageTaken: 60, hpMax: 30, spMax: 10, hpAfter: 0 }));
same("massive dying", `${logic.massiveDying({})},${logic.massiveDying({ critical: true, wounded: 1 })}`, "2,4");
ok("tempo lost unconscious", logic.tempoLost([{ slug: "unconscious" }]));
ok("tempo kept slowed", !logic.tempoLost([{ slug: "slowed", value: 2 }]));
ok("tempo kept stunned with a value", !logic.tempoLost([{ slug: "stunned", value: 2, unit: "unlimited" }]));
ok("tempo lost stunned for a duration", logic.tempoLost([{ slug: "stunned", value: 1, granted: true }]));
{
  let e = logic.unbowedAdd([], { id: "a", name: "Frightened" });
  e = logic.unbowedAdd(e, { id: "a", name: "Frightened" });
  same("unbowed once", e.length, 1);
  same("unbowed when, added", logic.unbowedWhen(e[0]).n, 3);
  for (let i = 0; i < 2; i++) {
    e = logic.unbowedOnStart(e);
    ok(`unbowed turn ${i + 1} keeps`, logic.unbowedOnEnd(e).expire.length === 0);
  }
  e = logic.unbowedOnStart(e);
  same("unbowed when, third turn", logic.unbowedWhen(e[0]).k, "thisTurn");
  same("unbowed ends after the third", logic.unbowedOnEnd(e).expire.map((x) => x.id).join(), "a");
  ok("unbowed exempt never ends", logic.unbowedOnEnd(logic.unbowedExempt(e, "a")).expire.length === 0);
  same("unbowed skips persistent damage", logic.unbowedSkip({ type: "condition", slug: "persistent-damage" }), "never");
  same("unbowed skips afflictions", logic.unbowedSkip({ type: "affliction" }), "affliction");
  same("unbowed skips its own effects", logic.unbowedSkip({ type: "effect", selfOrigin: true }), "self");
  same("unbowed tracks an enemy's frightened", logic.unbowedSkip({ type: "condition", slug: "frightened" }), null);
}

/* ── Roles: HP after elite or weak ── */

same("role source max, elite mook", logic.roleSourceMax({ role: "mook", printedMax: 50, adjustHP: 10 }), Math.ceil(60 / 4) - 10);
ok("role source max never below 1", logic.roleSourceMax({ role: "mook", printedMax: 4, adjustHP: 10 }) >= 1);
{
  const src = read(`${FEATURE}/actors.mjs`);
  const body = src.slice(src.indexOf("export async function setRole"), src.indexOf("export async function promptRole"));
  const max = body.indexOf('"system.attributes.hp.max"');
  const value = body.indexOf('"system.attributes.hp.value"');
  const updates = body.match(/await actor\.update\(/g) ?? [];
  ok("role HP in two updates", max > 0 && value > max && updates.length >= 2 && !/hp\.max[^;]*hp\.value/.test(body.slice(max, value - 60)), "max and value must be separate updates (PF2e clamps value against the old max)");
  ok("role never writes the level", !/details\.level/.test(body));
}

/* ═══ 5. The item rewrites ════════════════════════════════════════════════ */

/* Level as a proficiency bonus, under PF2e's stacking rules. */
function proficiencyTotal(mods) {
  // applyStackingRules: per type, the highest bonus and the lowest penalty both apply.
  const bonuses = mods.filter((m) => m > 0);
  const penalties = mods.filter((m) => m < 0);
  return (bonuses.length ? Math.max(...bonuses) : 0) + (penalties.length ? Math.min(...penalties) : 0);
}
const levelProf = json(`${FIX}/level-prof.json`);
for (const item of levelProf.items) {
  const patch = actorsMod.levelProfPatch(clone(item));
  ok(`levelProf ${item.name} rewritten`, !!patch, "no rewrite");
  if (!patch) continue;
  const value = patch["system.rules"].find(logic.isLevelProfRule)?.value;
  ok(`levelProf ${item.name} none left`, patch["system.rules"].every((r) => !(r.key === "FlatModifier" && r.type === "proficiency" && /@actor\.level/.test(String(r.value)))));
  const rewritten = patch["system.rules"].filter((r) => r.key === "FlatModifier" && r.type === "proficiency").map((r) => Number(r.value));
  for (const v of rewritten) {
    same(`levelProf ${item.name} untrained total`, proficiencyTotal([v, -2]), 0);
    same(`levelProf ${item.name} trained untouched`, proficiencyTotal([v, 2]), 2);
  }
  ok(`levelProf ${item.name} flag`, !!patch[`flags.${SUITE}.lvg.levelProf`]);
  ok(`levelProf ${item.name} once`, actorsMod.levelProfPatch({ ...clone(item), flags: { [SUITE]: { lvg: { levelProf: {} } } } }) === null);
  void value;
}
// A rewrite to 0 would leave the untrained −2 in force: the reason the value is 2.
same("levelProf: 0 would not work", proficiencyTotal([0, -2]), -2);
same("levelProf value follows the setting", logic.levelProfValue(-4), 4);

/* Battle forms against the rules' table (rules 0.13, "Battle Forms"). Rows: [rank, AC, attack, skill]. */
const FORM_TABLE = {
  "Animal Form (Bear)": { 2: [16, 6, 6], 3: [17, 9, 9], 4: [18, 9, 9], 5: [18, 9, 11] },
  "Dragon Form": { 6: [18, 11, 12], 8: [21, 13, 13] },
  "Pest Form": { 1: [15, null, null] },
  "Elephant Form": { 5: [18, 9, 12], 7: [21, 12, 12] },
  "Angel Form (Monadic Deva)": { 7: [22, 12, 12], 9: [22, 13, 16] },
  "Daemon Form (Ceustodaemon)": { 6: [21, 10, 12] },
  "Ooze Form": { 3: [7, 9, 9], 4: [7, 9, 9], 5: [7, 9, 11], 8: [7, 13, 14] },
  "Monstrosity Form (Kaiju)": { 9: [22, 14, 16] },
};
/** Where pf2e's data and the rules' table disagree; reported in docs/LEVEL_GROUND.md. Any other mismatch fails. */
const KNOWN_DATA_GAPS = new Set([
  "Pest Form 1 skill", // the data gives Acrobatics/Stealth +10 and Athletics −4; the table prints "none"
  "Angel Form (Monadic Deva) 7 skill", // the data gives Athletics +9 at rank 7; the table prints +25
  "Monstrosity Form (Kaiju) 9 attack", // a level-20 effect: read as rank 10, the table's values are rank 9's
  "Monstrosity Form (Kaiju) 9 skill",
]);
/** Resolve a BattleForm rule as PF2e would for a cast at `rank`: overrides, then each bracket up to it. */
function resolveForm(rule, rank) {
  const out = { ac: null, strikes: {}, skills: {} };
  const take = (v) => {
    if (!v) return;
    if (v.armorClass?.modifier !== undefined) out.ac = v.armorClass.modifier;
    for (const [k, s] of Object.entries(v.strikes ?? {})) if (typeof s?.modifier === "number") out.strikes[k] = s.modifier;
    for (const [k, s] of Object.entries(v.skills ?? {})) if (typeof s?.modifier === "number") out.skills[k] = s.modifier;
  };
  take(rule.overrides);
  for (const b of rule.brackets ?? []) if ((b.start ?? 0) <= rank && (b.end ?? Infinity) >= rank) take(b.value);
  return out;
}
const forms = json(`${FIX}/battle-forms.json`).items;
const formGaps = new Set();
for (const item of forms) {
  const name = item.name.replace(/^Spell Effect: /, "");
  const table = FORM_TABLE[name];
  ok(`battle form ${name} in the table`, !!table);
  if (!table) continue;
  for (const [rankText, [acWant, atkWant, skillWant]] of Object.entries(table)) {
    const rank = Number(rankText);
    // The effect is created at the rank it was cast at, unless the data pins a higher level (Kaiju: 20).
    const level = Math.max(rank, Number(item.system.level.value));
    const applied = clone(item);
    applied.system.level.value = level;
    const patch = actorsMod.battleFormPatch(applied);
    ok(`battle form ${name} ${rank} rewritten`, !!patch);
    if (!patch) continue;
    const rule = patch["system.rules"].find((r) => r.key === "BattleForm");
    const got = resolveForm(rule, level);
    const gap = (what, cond, detail) => {
      const id = `${name} ${rank} ${what}`;
      checks += 1;
      if (cond) return;
      if (KNOWN_DATA_GAPS.has(id)) formGaps.add(id);
      else fail(`battle form ${id}: ${detail}`);
    };
    gap("AC", got.ac === acWant, `AC ${got.ac}, table ${acWant}`);
    const atk = Object.values(got.strikes);
    gap("attack", atkWant === null ? atk.length === 0 : atk.length > 0 && atk.every((v) => v === atkWant), `attacks ${atk.join("/")}, table ${atkWant}`);
    const sk = Object.values(got.skills);
    gap("skill", skillWant === null ? sk.length === 0 : sk.includes(skillWant), `skills ${sk.join("/")}, table ${skillWant}`);
    ok(`battle form ${name} ${rank} keeps the printed rules`, eq(patch[`flags.${SUITE}.lvg.battleForm`].printed, item.system.rules));
  }
}
for (const id of KNOWN_DATA_GAPS) ok(`known gap still present: ${id}`, formGaps.has(id), "the data now agrees with the table: remove it from KNOWN_DATA_GAPS and the docs");
same("battle form rank, spell", logic.battleFormRank(6), 6);
same("battle form rank, level 20", logic.battleFormRank(20), 10);
same("battle form rank, feat level 8", logic.battleFormRank(8, { spell: false }), 4);
same("strip level term", logic.stripLevelTerm("16 + @actor.level"), 16);

/* Items that impose their own DC. */
{
  const item = (o) => ({ type: "consumable", name: "Bomb", system: { level: { value: 3 }, description: { value: "@Check[fortitude|dc:20] and @Check[flat|dc:5] ([[/act escape dc=19]])" } }, ...o });
  const patch = actorsMod.itemDCPatch(item());
  same("item DC shifted", patch?.["system.description.value"], "@Check[fortitude|dc:17] and @Check[flat|dc:5] ([[/act escape dc=16]])");
  ok("item DC once", actorsMod.itemDCPatch({ ...item(), flags: { [SUITE]: { lvg: { itemDC: {} } } } }) === null);
  ok("item DC: level 0 untouched", actorsMod.itemDCPatch(item({ system: { level: { value: 0 }, description: { value: "@Check[will|dc:15]" } } })) === null);
  ok("item DC: scroll untouched", !logic.itemDCEligible(item({ system: { level: { value: 3 }, category: "scroll", description: { value: "@Check[will|dc:20]" } } })));
  ok("item DC: wand trait untouched", !logic.itemDCEligible(item({ system: { level: { value: 3 }, traits: { value: ["wand"] }, description: { value: "@Check[will|dc:20]" } } })));
  ok("item DC: a spell carrier untouched", !logic.itemDCEligible(item({ system: { level: { value: 3 }, spell: { name: "x" }, description: { value: "@Check[will|dc:20]" } } })));
  ok("item DC: weapons untouched", !logic.itemDCEligible({ ...item(), type: "weapon" }));
}

/* Strip refuses pf2e-flatten's modifier (it subtracts level already). */
{
  const { MODIFIER_LABEL, MODIFIER_SLUG } = await import(join(ROOT, "scripts/features/pf2e-flatten/constants.js"));
  const flattened = { type: "npc", system: { customModifiers: { all: [{ label: MODIFIER_LABEL, slug: MODIFIER_SLUG }] } }, flags: {} };
  same("strip refuses flattened", actorsMod.stripRefusal(flattened), "GLLVG.strip.refuse.flattened");
  same("strip refuses a character", actorsMod.stripRefusal({ type: "character", flags: {} }), "GLLVG.strip.refuse.type");
  same("strip refuses twice", actorsMod.stripRefusal({ type: "npc", flags: { [SUITE]: { lvg: { strip: { level: 1 } } } } }), "GLLVG.strip.refuse.already");
  game.user.isGM = false;
  same("strip refuses a player", actorsMod.stripRefusal({ type: "npc", flags: {} }), "GLLVG.strip.refuse.gm");
  game.user.isGM = true;
}
same("readFlag nested", constants.readFlag({ [SUITE]: { lvg: { strip: 1 } } }, "lvg.strip"), 1);
same("readFlag dotted", constants.readFlag({ [SUITE]: { "lvg.strip": 2 } }, "lvg.strip"), 2);

/* ═══ 6. The surfaces: settings, lang, markup, CSS, purity ═════════════════ */

/* Settings */
{
  const defs = settings.settingDefinitions();
  ok("13 toggles", constants.TOGGLES.length === 13, `${constants.TOGGLES.length}`);
  for (const [key, def] of defs) {
    ok(`setting ${key} prefixed`, key.startsWith(constants.PREFIX));
    if (def.config) ok(`setting ${key} world+restricted Boolean`, def.scope === "world" && def.restricted === true && def.type === Boolean && def.default === true);
  }
  const adapter = read(`${FEATURE}/index.mjs`);
  ok("adapter prefix", /settingPrefix:\s*"lvg\."/.test(adapter));
  ok("adapter pf2e only", /system:\s*"pf2e"/.test(adapter));
  ok("adapter off by default", /defaultEnabled:\s*false/.test(adapter));
}

/* Lang */
const lang = json("lang/level-ground.en.json");
const langKeys = new Set(Object.keys(lang));
{
  for (const k of langKeys) {
    ok(`lang ${k} namespaced`, k.startsWith("GLLVG."));
    ok(`lang ${k} not a head`, ![...langKeys].some((o) => o.startsWith(`${k}.`)), "a key that heads another drops the whole file");
  }
  const used = new Set();
  for (const f of readdirSync(join(ROOT, FEATURE))) {
    const s = read(`${FEATURE}/${f}`);
    for (const m of s.matchAll(/["'`](GLLVG\.[A-Za-z0-9_.-]+[A-Za-z0-9_])["'`]/g)) used.add(m[1]);
  }
  for (const k of used) ok(`lang ${k} resolves`, langKeys.has(k));
  for (const [family, keys] of Object.entries(view.DYNAMIC_KEYS)) for (const k of keys) ok(`lang ${family} ${k} resolves`, langKeys.has(k));
  for (const name of constants.TOGGLES) for (const part of ["name", "hint"]) ok(`lang setting ${name}.${part}`, langKeys.has(`GLLVG.settings.${name}.${part}`));
  for (const role of ["mook", "solo", "summoned"]) ok(`lang roleText ${role}`, langKeys.has(`GLLVG.roleText.${role}`));
  for (const key of ["tempo", "unbowed"]) for (const part of ["name", "text"]) ok(`lang solo ${key}.${part}`, langKeys.has(`GLLVG.solo.${key}.${part}`));
  ok("lang every reasonKey", Object.values(view.SIGN_KEYS).every((k) => langKeys.has(`GLLVG.reason.${k}`)));
  // Every band of the shipped rate() has a key, every word too.
  for (const label of logic.BAND_LABELS) ok(`lang band ${label}`, langKeys.has(`GLLVG.band.${logic.bandKey(label)}`) && langKeys.has(`GLLVG.word.${logic.wordKey(label)}`));
  // Every Outclassed/Uncertain reason the shipped rate() can produce has a key.
  const reasons = new Set();
  const parties = [[1, 1, 1, 1], [10, 10], [10, 10, 4], [5, 5, 5, 5], [8, 8, 8, 8, 8, 8, 8]];
  const opps = [[S(2, 12)], [S(1, 6)], [S(1, 14, { role: "solo" })], [S(2, 10, { role: "solo" })], [S(24, 1, { role: "mook" })], [S(1, 1)]];
  for (const levels of parties) for (const opp of opps) for (const casterLeads of [false, true]) {
    const r = rules.rate(opp, { levels, allies: [], area: true, casterLeads });
    for (const s of [...(r.signs ?? []), ...(r.doubts ?? [])]) reasons.add(s);
    if (r.note) ok(`note ${r.note}`, r.note in view.NOTE_KEYS);
  }
  for (const s of reasons) ok(`reason "${s}" has a key`, s in view.SIGN_KEYS);
}

/* Markup: every surface renders with real keys, escapes world text, and binds every action. */
{
  const t = (k, d) => {
    if (!langKeys.has(k)) fail(`render asked for missing key ${k}`);
    let s = lang[k] ?? k;
    for (const [n, v] of Object.entries(d ?? {})) s = s.replaceAll(`{${n}}`, String(v));
    return s;
  };
  const evil = `<img src=x onerror=alert(1)>`;
  const r = logic.reading([{ name: evil, count: 1, level: 15, area: true }], { pcs: [{ name: evil, level: 5, maxHP: 40 }], area: true });
  const party = { source: "combat", pcs: [{ name: evil, level: 5, maxHP: 40 }], allies: [], area: true, casterLeads: false, casterGuess: true, manualText: "", hpText: "", alliesText: "" };
  const threat = { source: "combat", rows: [{ id: "r1", name: evil, count: 1, level: 15, role: "standard", adjust: "", area: true, hazard: "", editable: true }], party, reading: r, perceived: r, perceivedDiffers: false, canAward: true };
  const pages = {
    threat: view.windowHTML({ tab: "threat", threat }, { t }),
    breakAway: view.windowHTML({ tab: "breakAway", breakAway: { pursuerLevel: 6, pursuerName: evil, baseDC: 16, rows: [{ id: "a", name: evil, flee: true, skill: "athletics", faster: true, flies: false, ground: false, carrying: false, bonus: 2, dc: 18 }], canPost: true } }, { t }),
    convert: view.windowHTML({ tab: "convert", convert: { mode: "printed", value: 20, adjust: "none", rarity: "common", minRank: "", statistic: "athletics", checkName: evil, result: logic.convert({ mode: "printed", value: 20 }) } }, { t }),
    stripText: view.windowHTML({ tab: "stripText", stripText: { level: 3, text: evil, output: rules.stripBlock(evil, 3) } }, { t }),
    setup: view.windowHTML({ tab: "setup", setup: { pwol: { enabled: false, ok: false, modifiers: constants.PWOL.modifiers.map(([key, want], i) => ({ key, rank: RK[i], value: 0, want, ok: false })) }, abp: { value: "noABP", ok: false }, conflicts: [{ id: "flatfinder", title: evil }], levelProf: { count: 1, items: [{ actor: evil, item: evil }] }, unstripped: 2, flattened: 0, problems: true } }, { t }),
    strip: view.trackerStripHTML(r, { t }),
    marker: view.sheetMarkerHTML({ stripped: { level: 4 }, role: "solo", canEdit: true }, { t }),
    sizing: view.sizingUpCardHTML({ wordKey: "dangerous", deadly: [evil] }, { t }),
    check: view.checkRequestCardHTML({ name: evil, dc: 16, rank: 2, inline: logic.inlineCheck({ statistic: "athletics", dc: 16, rank: 2 }) }, { t }),
    breakAwayCard: view.breakAwayCardHTML({ pursuerLevel: 6, rows: [{ actorId: "a", name: evil, skill: "athletics", dc: 18, bonus: 2, inline: "@Check[athletics|dc:18]" }, { actorId: "b", name: "B", skill: "stealth", dc: 16, inline: "@Check[stealth|dc:16]" }], results: { a: { result: "escape", total: 22 }, b: { result: "caught", total: 3 } } }, { t }),
    massive: view.massiveCardHTML({ name: evil, actorUuid: "Actor.x", normal: 2, critical: 3, wounded: 0 }, { t }),
    tempo: view.tempoCardHTML({ name: evil, after: evil, used: false, lost: false, combatId: "c", combatantId: "d" }, { t }),
    unbowed: view.unbowedCardHTML({ name: evil, actorUuid: "Actor.x", entries: [{ id: "e", name: evil, when: { k: "turns", n: 2 } }, { id: "f", name: "F", exempt: true, when: { k: "exempt", n: 0 } }], ended: [evil] }, { t }),
    assurance: view.assuranceCardHTML({ name: evil, reason: "breakAway" }, { t }),
    xp: view.xpCardHTML({ rows: [{ name: evil, xp: 160 }], band: "extreme" }, { t }),
  };
  for (const [name, html] of Object.entries(pages)) {
    ok(`render ${name} escapes world text`, !html.includes("<img src=x"), "unescaped markup from the world");
    ok(`render ${name} has no undefined`, !/undefined|NaN|\[object Object\]/.test(html));
    ok(`render ${name} has no raw key`, !/GLLVG\./.test(html));
  }
  // Every action the views draw has a handler.
  const app = read(`${FEATURE}/app.mjs`) + read(`${FEATURE}/chat.mjs`) + read(`${FEATURE}/actors.mjs`) + read(`${FEATURE}/combat.mjs`);
  const actions = new Set();
  for (const html of Object.values(pages)) for (const m of html.matchAll(/data-lvg-action="([^"]+)"/g)) actions.add(m[1]);
  for (const a of actions) ok(`action ${a} handled`, new RegExp(`["'\`]${a}["'\`]|\\b${a}\\s*[:(]`).test(app), "a button with no handler");
  // Every field the views draw is read.
  const fields = new Set();
  for (const html of Object.values(pages)) for (const m of html.matchAll(/data-lvg-field="([^"]+)"/g)) fields.add(m[1].split(".")[0]);
  for (const f of fields) ok(`field ${f} read`, read(`${FEATURE}/app.mjs`).includes(f));
  // The Threat strip reads its tone from the band.
  ok("strip carries its band", /data-band="(belowTrivial|trivial|low|moderate|severe|extreme|beyondExtreme)"/.test(pages.strip));
  // Sizing Up hands players the word and names only: no percentage, XP or band name.
  ok("sizing up: no numbers", !/%|XP|\d/.test(view.sizingUpCardHTML({ wordKey: "dangerous", deadly: ["Seri"] }, { t }).replace(/<[^>]+>/g, "")));
}

/* CSS */
{
  const css = read("styles/level-ground.css");
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok("css no raw hex", !/#[0-9a-fA-F]{3,8}\b/.test(body), "use a token");
  ok("css no raw rgba veil", !/rgba?\(\s*\d/.test(body));
  ok("css no @font-face", !/@font-face/.test(body));
  ok("css no @import", !/@import/.test(body));
  ok("css no reduced-motion query", !/prefers-reduced-motion/.test(body));
  ok("css no raw durations", !/\b\d+(\.\d+)?m?s\b(?![^;]*var\(--gl-d)/.test(body.replace(/var\([^)]*\)/g, "")), "durations come from --gl-d-*");
  ok("css keyframes prefixed", [...body.matchAll(/@keyframes\s+([\w-]+)/g)].every((m) => m[1].startsWith("gllvg-")));
  ok("css never on :root", !/(^|[\s,}]):root\b/.test(body));
  const px = [...body.matchAll(/font(?:-size)?:[^;]*?\b(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  ok("css text at least 11px", px.every((n) => n >= 11), `sizes: ${px.join(",")}`);
  ok("css sizes its own buttons", /\.gllvg-btn\s*\{[^}]*font:[^}]*height:|\.gllvg-btn\s*\{[^}]*height:[^}]*font:/s.test(body), ".gllvg-btn must set its own height and font");
  ok("css chat buttons sized", /\.gllvg-card \.gllvg-btn\s*\{[^}]*font-size/.test(body));
  ok("css no foundation token declared", ![...body.matchAll(/(--gl-[a-z][\w-]*)\s*:/g)].length, "declare --gllvg-* only");
  const vars = new Set([...body.matchAll(/var\((--gllvg-[\w-]+)/g)].map((m) => m[1]));
  const declared = new Set([...body.matchAll(/(--gllvg-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const v of vars) ok(`css ${v} declared`, declared.has(v) || v === "--gllvg-fill");
  // Every class the views draw has a rule, and every class rule is drawn somewhere.
  const views = read(`${FEATURE}/view.mjs`) + read(`${FEATURE}/actors.mjs`) + read(`${FEATURE}/combat.mjs`) + read(`${FEATURE}/setup.mjs`) + read(`${FEATURE}/app.mjs`);
  const ruled = new Set([...body.matchAll(/\.(gllvg-[\w-]+)/g)].map((m) => m[1]));
  for (const cls of ruled) ok(`css .${cls} is drawn`, views.includes(cls), "a rule for a class nothing draws");
  const module = json("module.json");
  ok("module.json lists the sheet", module.styles.includes("styles/level-ground.css"));
  ok("module.json lists the lang file", module.languages.some((l) => l.path === "lang/level-ground.en.json"));
}

/* Purity and the seams */
{
  const PURE = ["rules.mjs", "logic.mjs", "view.mjs", "reference.mjs", "constants.mjs"];
  for (const f of PURE) {
    const src = read(`${FEATURE}/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(`${f} is pure`, !/\b(game|canvas|foundry|ui|Hooks|CONFIG|document|window|fromUuid|fromUuidSync)\b\s*[.?([]/.test(src), "reaches the world");
    ok(`${f} imports only pure modules`, [...src.matchAll(/from\s+"([^"]+)"/g)].every((m) => /^\.\/(rules|logic|constants|reference)\.mjs$|^\.\.\/\.\.\/core\/util\.mjs$/.test(m[1])));
  }
  const all = readdirSync(join(ROOT, FEATURE)).map((f) => [f, read(`${FEATURE}/${f}`)]);
  for (const [f, src] of all) {
    ok(`${f} no raw socket`, !/game\.socket/.test(src));
    ok(`${f} no libWrapper direct`, !/libWrapper\.register/.test(src), "wrap through core/wrapper.mjs");
    ok(`${f} never writes the level`, !/["']system\.details\.level\.value["']\s*:/.test(src));
  }
  const adapter = read(`${FEATURE}/index.mjs`);
  ok("adapter: no hooks at import", !/^Hooks\./m.test(adapter) && adapter.indexOf("Hooks.on") > adapter.indexOf("function onInit"));
  const checksSrc = read(`${FEATURE}/checks.mjs`);
  ok("wrapper inside try", /try\s*\{\s*registerWrapper\("game\.pf2e\.Check\.roll"/.test(checksSrc) && /try\s*\{\s*registerWrapper\("CONFIG\.PF2E\.Actor/.test(checksSrc));
  ok("reach skips Break Away", /if \(isBreakAway\(options\)\) return;/.test(checksSrc.slice(checksSrc.indexOf("function applyReach"))));
  ok("massive un-defeats", /toggleDefeated\(\{ to: false \}\)/.test(checksSrc));
  const world = read(`${FEATURE}/world.mjs`);
  ok("worksheet refuses a boss's extra turns", /isExtraTurn\(combatant\)/.test(world));
  ok("worksheet reads printed levels", /_source\?\.system\?\.details\?\.level\?\.value/.test(world));
  const combat = read(`${FEATURE}/combat.mjs`);
  ok("tracker hides PF2e's metrics", /section\.metrics/.test(combat));
  ok("turn bookkeeping on the active GM", /if \(!isActiveGM\(\) \|\| !combat\?\.started \|\| !forward\(prior, current\)\) return;/.test(combat));
  const chat = read(`${FEATURE}/chat.mjs`);
  ok("chat buttons are a GM's", /isGM/.test(chat));
  ok("chat results wait for the dice", /diceSettled/.test(chat));
  const actors = read(`${FEATURE}/actors.mjs`);
  ok("auto-strip on the creating client", /onCreateActor[\s\S]{0,400}userId !== game\.user\?\.id/.test(actors));
  ok("dent config style: no ApplicationV2 at module scope", !/^const\s*\{[^}]*ApplicationV2[^}]*\}\s*=\s*foundry/m.test(read(`${FEATURE}/app.mjs`)));
}

/* ═══ Report ═══════════════════════════════════════════════════════════════ */

if (problems.length) {
  console.log(problems.map((p) => `  ✗ ${p}`).join("\n"));
  console.log(`\nlevel-ground-check: ${problems.length} problem(s) in ${checks} checks (${vectorCount} rules vectors of ${docIds})`);
  process.exit(1);
}
console.log(`level-ground-check: ${checks} checks, ${vectorCount} rules vectors, ${formGaps.size} known battle-form data gaps, 0 problems`);
process.exit(0);
