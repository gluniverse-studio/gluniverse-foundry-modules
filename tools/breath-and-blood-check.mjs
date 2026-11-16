#!/usr/bin/env node
/**
 * Breath and Blood — consistency check.
 *
 * Almost everything this feature can get wrong fails silently: a rule one
 * point off is a plausible number, a runtime-built i18n key prints itself, a
 * module that reads the world breaks the preview, an unprefixed setting lands
 * in the wrong Control Center group. This drives the shipped modules:
 *
 *   1. The 102 rules vectors (tools/fixtures/breath-and-blood/vectors.mjs)
 *      against rules.mjs: every row, and the ids match the list.
 *   2. The adapter: registered with the right prefix, system and default, no
 *      hook or socket touched at import time, every setting registered under
 *      `bab.` with a label, a hint and a label per choice.
 *   3. i18n: every literal GLBAB key resolves, every runtime-built family
 *      resolves for every value it can take, no key is also the head of
 *      another, and the preview (every view, every model) prints no missing key.
 *   4. Purity: rules / constants / classify / views reach no Foundry global.
 *   5. The pf2e-facing rewrites on fixtures: describeSource → classifyHealing,
 *      derivePools (drained re-split, companions, rivals, the SP floor),
 *      drainedLoss, isRepeatingMessage.
 *   6. Seams that read as harmless edits: Lasting Wounds stands down,
 *      applyDamage writes healing with `final: true`, the socket honours only
 *      `meta.attested`, no `game.socket`, foundry.applications only inside
 *      functions, every `.gl-btn` sized by the feature.
 *   7. CSS hygiene for styles/breath-and-blood.css.
 *
 * Usage: node tools/breath-and-blood-check.mjs     (exit 1 on any problem)
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEATURE = "scripts/features/breath-and-blood";
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);

const problems = [];
let checks = 0;
const check = (label, ok, detail = "") => {
  checks += 1;
  if (!ok) problems.push(detail ? `${label}: ${detail}` : label);
};
const fmt = (v) => JSON.stringify(v);

/* ── Globals that must NOT be touched at import time ──────────────────────── */

const touched = [];
const trap = (name) =>
  new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === "then") return undefined;
      touched.push(`${name}.${String(prop)}`);
      return trap(`${name}.${String(prop)}`);
    },
    apply() {
      touched.push(`${name}()`);
      return trap(`${name}()`);
    },
  });
for (const g of ["Hooks", "game", "ui", "canvas", "CONFIG", "foundry"]) globalThis[g] = trap(g);

const R = await mod(`${FEATURE}/rules.mjs`);
const C = await mod(`${FEATURE}/constants.mjs`);
const CL = await mod(`${FEATURE}/classify.mjs`);
const V = await mod(`${FEATURE}/views.mjs`);
const S = await mod(`${FEATURE}/settings.mjs`);
const P = await mod(`${FEATURE}/prepare.mjs`);
const { Suite } = await mod("scripts/core/registry.mjs");
await mod(`${FEATURE}/index.mjs`);
check("no Foundry global touched while importing the feature", touched.length === 0, touched.slice(0, 6).join(", "));
for (const g of ["Hooks", "game", "ui", "canvas", "CONFIG", "foundry"]) delete globalThis[g];

/* ── 1. Rules vectors ─────────────────────────────────────────────────────── */

const { run, VECTOR_IDS } = await import(pathToFileURL(join(ROOT, "tools/fixtures/breath-and-blood/vectors.mjs")).href);
const rows = run(R);
check("102 vectors", rows.length === 102 && VECTOR_IDS.length === 102, `rows ${rows.length}, ids ${VECTOR_IDS.length}`);
check("vector rows match the id list", isDeepStrictEqual(rows.map((r) => r.id), VECTOR_IDS));
let vectorsOK = 0;
for (const r of rows) {
  const ok = isDeepStrictEqual(r.got, r.expected);
  check(`vector ${r.id}`, ok, `got ${fmt(r.got)}, expected ${fmt(r.expected)}`);
  if (ok) vectorsOK += 1;
}

/* ── 2. Adapter and settings ──────────────────────────────────────────────── */

const def = Suite.get(C.FEATURE_ID);
check("the feature registers", !!def);
if (def) {
  check("settingPrefix is bab.", def.settingPrefix === C.PREFIX);
  check("system is pf2e", def.system === "pf2e" || (Array.isArray(def.system) && def.system.includes("pf2e")));
  check("off by default", def.defaultEnabled === false);
  check("not core (switchable)", !def.core);
  check("lifecycle present", typeof def.onInit === "function" && typeof def.onReady === "function" && typeof def.registerSettings === "function");
  check("title key is the lead's", def.title === "GLS.feature.breath-and-blood.title");
}
check("index.mjs imports the adapter", /breath-and-blood\/index\.mjs/.test(read("scripts/features/index.mjs")));
const manifest = JSON.parse(read("module.json"));
check("module.json lists the stylesheet", manifest.styles.includes("styles/breath-and-blood.css"));
check("module.json lists the lang file", manifest.languages.some((l) => l.path === "lang/breath-and-blood.en.json"));
check("FEATURE_CONTRACT has the bab. row", /breath-and-blood[^\n]*bab\./.test(read("docs/FEATURE_CONTRACT.md")));

const registered = [];
globalThis.game = { settings: { register: (scope, key, d) => registered.push({ scope, key, d }), registerMenu: () => {} } };
try {
  def?.registerSettings();
} finally {
  delete globalThis.game;
}
const defs = S.settingDefs();
check("registerSettings registers every def", registered.length === defs.length && registered.length === Object.keys(C.SETTINGS).length, `${registered.length} registered, ${defs.length} defs`);
for (const { scope, key, d } of registered) {
  check(`${key} under the suite id`, scope === "gluniverse-foundry-modules");
  check(`${key} is prefixed bab.`, key.startsWith(C.PREFIX) && Object.values(C.SETTINGS).includes(key));
  check(`${key} is a GM world setting`, d.scope === "world" && d.restricted === true);
  check(`${key} has a change handler`, typeof d.onChange === "function");
  check(`${key} default fits its type`, d.type === Number ? typeof d.default === "number" : d.type === Boolean ? typeof d.default === "boolean" : typeof d.default === "string");
  if (d.choices) check(`${key} default is a choice`, d.default in d.choices);
}

/* ── 3. i18n ──────────────────────────────────────────────────────────────── */

const LANG = JSON.parse(read("lang/breath-and-blood.en.json"));
const leaves = new Map();
const heads = new Set();
(function walk(o, path) {
  for (const [k, v] of Object.entries(o)) {
    const p = path ? `${path}.${k}` : k;
    check(`lang key segment has no dot (${p})`, !k.includes("."));
    if (v && typeof v === "object") {
      heads.add(p);
      walk(v, p);
    } else leaves.set(p, v);
  }
})(LANG, "");
for (const k of leaves.keys()) check(`lang key is not also a head (${k})`, !heads.has(k));
check("GLBAB is this file's alone", !JSON.stringify(JSON.parse(read("lang/en.json"))).includes('"GLBAB'));
const has = (k) => typeof leaves.get(k) === "string" && leaves.get(k).length > 0;
const need = (k, where) => check(`i18n ${k}${where ? ` (${where})` : ""}`, has(k));

// Literal keys in every feature source file.
const SRC = readdirSync(join(ROOT, FEATURE)).filter((f) => f.endsWith(".mjs"));
const sources = Object.fromEntries(SRC.map((f) => [f, read(`${FEATURE}/${f}`)]));
let literal = 0;
for (const [f, s] of Object.entries(sources)) {
  for (const m of s.matchAll(/GLBAB\.[A-Za-z0-9_.-]*[A-Za-z0-9_](?![A-Za-z0-9_.-]*\$\{)/g)) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\.[$<*]|^\$\{/.test(after)) continue; // a family head (code or a doc comment)
    need(m[0], f);
    literal += 1;
  }
}

// Every runtime-built family, for every value it can take.
const DEGREES = ["criticalSuccess", "success", "failure", "criticalFailure"];
const families = [
  ["action", V.PANEL_ACTIONS],
  ["actionHint", V.PANEL_ACTIONS],
  ["refuse", C.REFUSALS],
  ["unpaid", [...C.UNPAID_REASONS, "declined"]],
  ["why", C.WHY],
  ["role", R.ROLES],
  ["night", R.NIGHTS],
  ["card.night", R.NIGHTS],
  ["card.kind", R.KINDS.filter((k) => k !== R.KIND.unpaid)],
  ["card.medicine", ["treat", "battle"]],
  ["kind", ["spent", "paid"]],
  ["degree", DEGREES],
  ["rank", Object.keys(R.TREAT)], // treatChoices ranks 1..4
  ["rest.tab", ["rest", "setup"]],
  ["treat.kind", ["treat", "battle"]],
  ["treat.choice", ["pay", "decline"]],
];
let dynamic = 0;
for (const [head, values] of families) {
  check(`family ${head} has values`, Array.isArray(values) && values.length > 0);
  for (const v of values ?? []) {
    need(`GLBAB.${head}.${v}`, "dynamic");
    dynamic += 1;
  }
}
for (const [key, d] of defs) {
  const k = key.slice(C.PREFIX.length);
  check(`${key} label is the GLBAB.settings key`, d.name === `GLBAB.settings.${k}.name` && d.hint === `GLBAB.settings.${k}.hint`);
  need(d.name, "setting");
  need(d.hint, "setting");
  for (const [v, label] of Object.entries(d.choices ?? {})) {
    check(`${key} choice ${v} is in CHOICES`, C.CHOICES[k]?.includes(v));
    need(label, "choice");
  }
}

// Reasons the rules return must each be a refusal, an unpaid reason or a why.
const rulesSrc = sources["rules.mjs"];
const returned = new Set([...rulesSrc.matchAll(/(?:return|reason:)\s*"([a-zA-Z]+)"/g)].map((m) => m[1]));
const known = new Set([...C.REFUSALS, ...C.UNPAID_REASONS, ...C.WHY, ...R.KINDS, "ask", "declined"]);
for (const r of returned) check(`rules reason "${r}" has a family`, known.has(r));

// The rules' own refusals are all listed.
const pools = R.makePools();
for (const reason of [
  R.catchRefusal({ ...pools, caughtBreath: true }),
  R.catchRefusal({ ...pools, rp: 0 }),
  R.bindRefusal({ ...pools, rp: 0 }),
  R.bindRefusal({ ...pools, hp: 0 }),
  R.lendRefusal(pools, pools),
  R.lendRefusal({ ...pools, companion: true }, { ...pools, rp: 1 }),
  R.lendRefusal(pools, { ...pools, rp: 1, strengthLent: true }),
  R.wordsRefusal({ ...pools, ewImmune: true }),
]) {
  check(`refusal ${reason} is listed`, reason && C.REFUSALS.includes(reason));
}

// Every view, every preview model: no missing key printed.
const tmp = mkdtempSync(join(tmpdir(), "glbab-check-"));
try {
  const out = join(tmp, "p.html");
  execFileSync(process.execPath, [join(ROOT, "tools/breath-and-blood-preview.mjs"), `--out=${out}`], { stdio: "pipe" });
  const html = readFileSync(out, "utf8");
  const missing = [...new Set([...html.matchAll(/⟦([^⟧]*)⟧/g)].map((m) => m[1]))];
  check("the preview prints no missing key", missing.length === 0, missing.join(", "));
  check("the preview prints no undefined/NaN", !/>[^<]*\b(undefined|NaN|null)\b[^<]*</.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
  for (const f of ["panel", "rest", "setup", "treat", "battle", "heal", "holdon", "chat"]) check(`the preview draws ${f}`, html.includes(`data-frame="${f}"`));
} catch (error) {
  check("the preview runs", false, String(error.stderr ?? error.message).slice(0, 400));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ── 4. Purity ────────────────────────────────────────────────────────────── */

const strip = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
const GLOBALS = /\b(game|foundry|ui|Hooks|canvas|CONFIG|document|window|PIXI|fromUuid|fromUuidSync|ChatMessage|libWrapper)\b/;
for (const f of ["rules.mjs", "constants.mjs", "classify.mjs", "views.mjs"]) {
  const code = strip(sources[f]);
  const hit = code.split("\n").find((l) => GLOBALS.test(l) && !/^\s*import\b/.test(l));
  check(`${f} is pure`, !hit, hit?.trim());
  const imports = [...sources[f].matchAll(/^import[^"]*"([^"]+)"/gm)].map((m) => m[1]);
  check(`${f} imports only pure modules`, imports.every((i) => /^\.\/(rules|constants|classify)\.mjs$|\/core\/util\.mjs$/.test(i)), imports.join(", "));
}
check("rules.mjs uses no Math.random", !/Math\.random/.test(strip(rulesSrc)));

/* ── 5. Rewrites on fixtures ──────────────────────────────────────────────── */

const spell = ({ entry = null, cantrip = false, parent = null, uses = 0 } = {}) => ({
  type: "spell",
  system: { location: { uses: { max: uses } } },
  isCantrip: cantrip,
  parentItem: parent,
  spellcasting: entry ? { [entry]: true } : null,
});
const SOURCES = [
  ["prepared slot", { item: spell({ entry: "isPrepared" }) }, "spent", "slot"],
  ["spontaneous slot", { item: spell({ entry: "isSpontaneous" }) }, "spent", "slot"],
  ["cantrip", { item: spell({ entry: "isPrepared", cantrip: true }) }, "paid", "cantrip"],
  ["focus spell", { item: spell({ entry: "isFocusPool" }) }, "paid", "focus"],
  ["ritual", { item: spell({ entry: "isRitual" }) }, "spent", "ritual"],
  ["innate, limited", { item: spell({ entry: "isInnate", uses: 1 }) }, "spent", "innateLimited"],
  ["innate, at will", { item: spell({ entry: "isInnate" }) }, "paid", "atWill"],
  ["scroll (parentItem)", { item: spell({ entry: "isPrepared", parent: {} }) }, "paid", "embedded"],
  ["wand (message flag only)", { message: { flags: { pf2e: { casting: { embeddedSpell: true } } } } }, "paid", "embedded"],
  ["items entry", { item: spell({ entry: null }), message: null }, "ask", "unknownSpell"],
  ["infused elixir", { item: { type: "consumable", system: { traits: { value: ["infused", "healing"] } } } }, "spent", "infused"],
  ["bought potion", { item: { type: "consumable", traits: new Set(["healing"]) } }, "paid", "item"],
  ["feat 1/day", { item: { type: "feat", system: { frequency: { per: "day" } } } }, "spent", "perDay"],
  ["action 1/hour", { item: { type: "action", system: { frequency: { per: "PT1H" } } } }, "paid", "atWill"],
  ["Treat Wounds card", { rollOptions: ["action:treat-wounds"] }, "paid", "treatWounds"],
  ["Battle Medicine card", { rollOptions: new Set(["action:battle-medicine"]) }, "paid", "battleMedicine"],
  ["no source", {}, "ask", "unknown"],
];
for (const [label, input, kind, why] of SOURCES) {
  const got = R.classifyHealing(CL.describeSource(input), {});
  check(`classify ${label}`, got.kind === kind && got.reason === why, fmt(got));
  check(`classify ${label}: why has a key`, got.reason == null || has(`GLBAB.why.${got.reason}`));
}
const generous = R.classifyHealing(CL.describeSource({ item: { type: "consumable", traits: new Set() } }), { generousSupplies: true });
check("generous supplies make an item spent", generous.kind === "spent" && generous.reason === "generous", fmt(generous));
check("generous supplies leave a cantrip paid", R.classifyHealing(CL.describeSource(SOURCES[2][1]), { generousSupplies: true }).kind === "paid");
check("unsure classification prompts under 'unsure'", R.shouldPrompt(R.classifyHealing({ source: "none" }), "unsure") === true);
check("sure classification does not prompt under 'unsure'", R.shouldPrompt(R.classifyHealing(CL.describeSource(SOURCES[0][1])), "unsure") === false);
check("'never' never prompts", R.shouldPrompt(R.classifyHealing({ source: "none" }), "never") === false);
check("'always' always prompts", R.shouldPrompt(R.classifyHealing(CL.describeSource(SOURCES[0][1])), "always") === true);

const DIALS = { maxResolve: 4, resolveByLevel: false };
const POOLS = [
  // pf2e's split (35 SP / 33 HP at level 5); drained 1 removes 5 from hp.max, which moves to SP first.
  ["character, no drain", { type: "character", role: "twoPools", level: 5, hpMax: 33, systemSP: 35, drainLoss: 0 }, { maxSP: 35, maxHP: 33, maxRP: 4 }],
  ["character, drained 1", { type: "character", role: "twoPools", level: 5, hpMax: 28, systemSP: 35, drainLoss: 5 }, { maxSP: 30, maxHP: 33, maxRP: 4 }],
  ["character, drained 2", { type: "character", role: "twoPools", level: 5, hpMax: 23, systemSP: 35, drainLoss: 10 }, { maxSP: 25, maxHP: 33, maxRP: 4 }],
  ["character, drained past SP", { type: "character", role: "twoPools", level: 5, hpMax: 33 - 40, systemSP: 35, drainLoss: 40 }, null],
  ["character, SP floor", { type: "character", role: "twoPools", level: 5, hpMax: 33, systemSP: 2, drainLoss: 0 }, { maxSP: 5, maxHP: 33, maxRP: 4 }],
  ["NPC companion, 71 HP", { type: "npc", role: "companion", level: 7, hpMax: 71, systemSP: 0, drainLoss: 0 }, { maxSP: 35, maxHP: 36, maxRP: 3 }],
  ["NPC rival, drained", { type: "npc", role: "rival", level: 7, hpMax: 64, systemSP: 0, drainLoss: 7 }, { maxSP: 28, maxHP: 36 }],
  ["character companion halves both pools", { type: "character", role: "companion", level: 3, hpMax: 20, systemSP: 15, drainLoss: 0 }, { maxSP: 17, maxHP: 18, maxRP: 3 }],
];
for (const [label, input, expected] of POOLS) {
  const got = P.derivePools({ ...input, dials: DIALS });
  if (!expected) {
    const split = R.drainedSplit({ baseSP: 35, baseHP: 33, loss: 40 });
    check(`derivePools ${label}`, got.maxSP === split.maxSP && got.maxHP === split.maxHP && got.maxSP >= 0, fmt(got));
    continue;
  }
  const picked = Object.fromEntries(Object.keys(expected).map((k) => [k, got?.[k]]));
  check(`derivePools ${label}`, isDeepStrictEqual(picked, expected), `got ${fmt(picked)}, expected ${fmt(expected)}`);
}
check("derivePools: one pool is null", P.derivePools({ type: "npc", role: "onePool", level: 1, hpMax: 10, dials: DIALS }) === null);
check("derivePools: resolve by level", P.derivePools({ type: "character", role: "twoPools", level: 1, hpMax: 10, systemSP: 8, drainLoss: 0, dials: { maxResolve: 4, resolveByLevel: true } }).maxRP === R.maxResolveFor({ role: "twoPools", level: 1, maxResolve: 4, resolveByLevel: true }));
check(
  "drainedLoss sums enabled drained modifiers only",
  P.drainedLoss({ modifiers: [{ slug: "drained", modifier: -5 }, { slug: "clumsy", modifier: -3 }, { slug: "drained", modifier: -5, enabled: false }, { slug: "drained", modifier: -4, ignored: true }] }) === 5,
);
check("drainedLoss of nothing is 0", P.drainedLoss(undefined) === 0 && P.drainedLoss({}) === 0);

const FH = "regains 5 Hit Points from fast healing";
check("fast-healing message is repeating", CL.isRepeatingMessage({ flavor: `Valeros ${FH}.`, flags: {} }, [FH]) === true);
check("a check's healing is not repeating", CL.isRepeatingMessage({ flavor: FH, flags: { pf2e: { context: { type: "damage-roll" } } } }, [FH]) === false);
check("no texts, no repeating", CL.isRepeatingMessage({ flavor: FH }, []) === false);

/* ── 6. Seams ─────────────────────────────────────────────────────────────── */

const wounds = read("scripts/features/pf2e-variant-rules/wounds.mjs");
check("Lasting Wounds exports its stand-down", /export const lastingWoundsActive\s*=/.test(wounds) && /export function supersededByBreathAndBlood/.test(wounds));
const woundsCalls = [...strip(wounds).matchAll(/\bwoundsOn\(\)/g)].length;
check("Lasting Wounds reads woundsOn() only inside lastingWoundsActive", woundsCalls === 1, `${woundsCalls} calls`);
check("Lasting Wounds stands down for this feature's id", /Suite\.enabled\("breath-and-blood"\)/.test(wounds));

const all = Object.values(sources).map(strip).join("\n");
check("no game.socket (use core/socket.mjs)", !/game\.socket/.test(all));
check("the socket handler reads meta.attested", /meta\?\.attested/.test(sources["actions.mjs"]));
check("socket ops honoured only on the active GM", /activeGM/.test(sources["actions.mjs"]));
check("healing reaches pf2e with final: true", /final:\s*true/.test(sources["damage.mjs"]));
check("wrappers go through registerWrapper", !/libWrapper\.register/.test(all) && /registerWrapper\(/.test(all));
for (const t of P.PREPARE_TARGETS) check(`prepare target ${t}`, /^CONFIG\.PF2E\.Actor\.documentClasses\.(character|npc|familiar)\.prototype\.prepareData$/.test(t));
for (const [f, s] of Object.entries(sources)) {
  const lines = s.split("\n");
  lines.forEach((l, i) => {
    if (/foundry\.applications/.test(l) && !/^\s*(\*|\/\/)/.test(l)) check(`${f}:${i + 1} reaches foundry.applications inside a function`, /^\s+/.test(l));
  });
}
check("no prefers-reduced-motion in JS", !/prefers-reduced-motion/.test(all));

const viewSrc = sources["views.mjs"];
const btns = [...viewSrc.matchAll(/class="([^"]*\bgl-btn\b[^"]*)"/g)].map((m) => m[1]);
check("views draw buttons", btns.length > 0);
for (const b of btns) check(`button "${b}" carries glbab-btn`, /\bglbab-btn\b/.test(b));

/* ── 7. CSS ───────────────────────────────────────────────────────────────── */

const css = read("styles/breath-and-blood.css");
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
check("CSS: .glbab-btn.gl-btn sets its own font-size", /\.glbab-btn\.gl-btn\s*\{[^}]*font-size\s*:/.test(cssCode));
check("CSS: no :root rule", !/:root\b/.test(cssCode));
check("CSS: no raw hex", !/#[0-9a-fA-F]{3,8}\b/.test(cssCode));
check("CSS: no raw rgb()/rgba() veil", !/rgba?\(\s*\d/.test(cssCode));
check("CSS: no @font-face / @import", !/@(font-face|import)\b/.test(cssCode));
check("CSS: no prefers-reduced-motion", !/prefers-reduced-motion/.test(cssCode));
for (const m of cssCode.matchAll(/@keyframes\s+([\w-]+)/g)) check(`CSS: keyframes ${m[1]} prefixed glbab-`, m[1].startsWith("glbab-"));
for (const m of cssCode.matchAll(/(transition|animation)[\w-]*\s*:([^;]*)/g)) check(`CSS: no raw duration in "${m[0].trim()}"`, !/\b\d+(\.\d+)?m?s\b/.test(m[2]));
for (const m of cssCode.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) check(`CSS: font-size ${m[1]}px is at least 11px`, Number(m[1]) >= 11);
for (const m of cssCode.matchAll(/(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*[,)]/g)) check(`CSS: ${m[1]} is not self-referential`, m[1] !== m[2]);
// --gl-accent may be routed on a scoped selector (the design system says so); nothing else.
for (const m of cssCode.matchAll(/(?:^|[;{\s])(--gl-[\w-]+)\s*:/g)) check(`CSS: foundation token ${m[1]} not redeclared`, m[1] === "--gl-accent");
const declared = new Set([...cssCode.matchAll(/(--glbab-[\w-]+)\s*:/g)].map((m) => m[1]));
for (const v of new Set([...cssCode.matchAll(/var\(\s*(--glbab-[\w-]+)/g)].map((m) => m[1]))) check(`CSS: ${v} is declared`, declared.has(v));
const tokens = read("styles/gl-tokens.css");
for (const v of new Set([...cssCode.matchAll(/var\(\s*(--gl-[\w-]+)\s*\)/g)].map((m) => m[1]))) check(`CSS: ${v} exists in gl-tokens.css`, tokens.includes(`${v}:`));

/* ── Report ───────────────────────────────────────────────────────────────── */

const summary = `${checks} checks (${vectorsOK}/${rows.length} vectors, ${literal} literal and ${dynamic} runtime-built keys)`;
if (problems.length) {
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`breath-and-blood: ${problems.length} problem(s) in ${summary}`);
  process.exit(1);
}
console.log(`breath-and-blood: no problems found, ${summary}`);
