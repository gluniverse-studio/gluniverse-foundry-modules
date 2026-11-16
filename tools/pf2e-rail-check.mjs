#!/usr/bin/env node
/**
 * tools/pf2e-rail-check.mjs — consistency check for the PF2e HUD (`pf2e-rail`).
 *
 *   node tools/pf2e-rail-check.mjs
 *
 * Everything here fails silently in a live world. A press the view draws and
 * the host never answers is a button that does nothing. A reader that emits a
 * field under a name the view does not read draws an empty plate, and one
 * that forgets a field draws `undefined`. A runtime-built i18n key prints
 * itself. A skin rule outside `.gph`, a foundation token redeclared or a
 * bare keyframe name repaints somebody else's feature. A rail on the stream
 * login puts the GM's rail on the recording, and an echo of a blind roll
 * tells a player the number PF2e hid from them. None of that throws.
 *
 * The readers are driven with fake PF2e actors (a fighter, a prepared caster,
 * a kineticist, a familiar, an NPC, a hazard, a dying fighter) in the shapes
 * PF2e 8.7 prepares, and their output is held to the fixtures
 * (tools/pf2e-rail-fixtures.mjs), which are the view's model contract.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as V from "../scripts/features/pf2e-rail/view.mjs";
import * as S from "../scripts/features/pf2e-rail/shape.mjs";
import * as R from "../scripts/features/pf2e-rail/read.mjs";
import { Turn, economyOf, turnKey, upNext } from "../scripts/features/pf2e-rail/turn.mjs";
import { answers, echoOf } from "../scripts/features/pf2e-rail/echo.mjs";
import { combatOf, isTurnOf, shouldMount, subjectOf } from "../scripts/features/pf2e-rail/subject.mjs";
import { PEEK_PRESSES, ROW_KEYS, actionPeek, effectRows, inventoryRows, itemPeek, macroSlots, spellPeek, strikePeek } from "../scripts/features/pf2e-rail/peeks.mjs";
import { PRESSES } from "../scripts/features/pf2e-rail/presses.mjs";
import { FEATURE_ID, PREFIX, SHED_ORDER, STANDARD_EXPLORATION, STD_EXPLORE } from "../scripts/features/pf2e-rail/const.mjs";
import { downOf, momentsOf, relight } from "../scripts/features/pf2e-rail/moments.mjs";
import { LIGHT_TONE } from "../scripts/features/pf2e-rail/light.mjs";
import * as Drive from "../scripts/features/pf2e-rail/drive.mjs";
import { INK_SIGNAL } from "../scripts/core/theme.mjs";
import { FLAGS, SETTINGS } from "../scripts/features/pf2e-rail/settings.mjs";
import * as K from "../scripts/features/pf2e-rail/skill-actions.mjs";
const { SKILL_ACTIONS } = K;
import { STATES } from "./pf2e-rail-fixtures.mjs";
import { DRAWER_BODIES, PARTY_ACTORS, checkNameOf } from "./pf2e-rail-fixtures.mjs";
import * as C from "../scripts/features/pf2e-rail/calls.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8").replace(/\r\n/g, "\n");
const problems = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else problems.push(msg); };
const section = (title, fn) => {
  const before = problems.length;
  try { fn(); } catch (e) { problems.push(`${title}: threw ${e?.stack ?? e}`); }
  console.log(`${problems.length === before ? "✓" : "✗"} ${title}`);
};
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/[^\n"'`]*$/gm, "$1");

const DIR = "scripts/features/pf2e-rail/";
const src = Object.fromEntries(["view.mjs", "read.mjs", "turn.mjs", "echo.mjs", "subject.mjs", "peeks.mjs", "presses.mjs", "shape.mjs", "skill-actions.mjs", "host.mjs", "calls.mjs", "index.mjs", "settings.mjs", "const.mjs", "drive.mjs", "light.mjs", "moments.mjs"].map((f) => [f, read(DIR + f)]));
const css = read("styles/pf2e-rail.css");
const lang = JSON.parse(read("lang/pf2e-rail.en.json"));
const seen = new Set();
const t = (k, d) => { seen.add(k); let s = lang[k] ?? `‹${k}›`; if (d) for (const [a, b] of Object.entries(d)) s = s.replaceAll(`{${a}}`, String(b)); return s; };
const loc = (k) => String(k).replace(/^PF2E\./, "");
const art = (p) => `/art/${p}`;

/* ══ fake PF2e ═════════════════════════════════════════════════════════ */

const stat = (label, mod, rank = 1, extra = {}) => ({ label, mod, rank, dc: { value: 10 + mod }, ...extra });
const cond = (slug, name, value = null) => ({ id: `c-${slug}`, slug, name, type: "condition", img: `/c/${slug}.webp`, system: { value: { value } }, isActive: true });
const item = (id, name, type, sys = {}, extra = {}) => ({ id, name, type, slug: name.toLowerCase().replace(/[^a-z]+/g, "-"), img: `/i/${id}.webp`, sort: 0, system: { traits: { value: [] }, ...sys }, ...extra });
const skillsFor = (ranks) => Object.fromEntries(R.SKILLS.map((s) => [s, stat(s[0].toUpperCase() + s.slice(1), ranks[s]?.[1] ?? 1, ranks[s]?.[0] ?? 0)]));
const strike = (label, mod, o = {}) => ({
  type: "strike", label, totalModifier: mod, ready: o.ready ?? true, visible: true,
  item: { id: `w-${label}`, name: label, img: `/w/${label}.webp`, system: { baseItem: o.base ?? null, traits: { value: o.traits ?? [] } }, range: null, isRanged: false },
  variants: [0, -5, -10].map((p, i) => ({ penalty: p, label: i ? `${mod + p} (MAP ${p})` : `+${mod}` })), traits: [],
});
const base = (o) => ({
  id: o.id, uuid: `Actor.${o.id}`, name: o.name, type: o.type ?? "character", img: `/a/${o.id}.webp`, isOwner: true, hasPlayerOwner: o.pc ?? true,
  level: o.level ?? 5, class: o.cls ? { name: o.cls } : null,
  armorClass: { value: o.ac ?? 20 },
  perception: stat("Perception", o.per ?? 10, 2),
  saves: { fortitude: stat("Fortitude", 12, 2), reflex: stat("Reflex", 10, 2), will: stat("Will", 8, 2) },
  skills: { ...skillsFor(o.ranks ?? { athletics: [2, 14], intimidation: [1, 10] }), ...(o.lores ?? {}) },
  system: {
    attributes: { hp: { value: o.hp?.[0] ?? 40, max: o.hp?.[1] ?? 50, temp: o.temp ?? 0 }, ac: { value: o.ac ?? 20 }, shield: o.shield ?? { itemId: null }, dying: o.dying ?? { value: 0, max: 4 } },
    details: { level: { value: o.level ?? 5 }, ...(o.details ?? {}) },
    resources: o.type && o.type !== "character" ? {} : { heroPoints: { value: o.hero ?? 1, max: 3 } },
    movement: { speeds: { land: { value: 25 } } },
    actions: o.strikes ?? [],
    exploration: o.exploration ?? [],
    traits: { value: o.traits ?? [], size: { value: o.size ?? "med" } },
  },
  itemTypes: { condition: o.conds ?? [], effect: o.effects ?? [], action: o.actions ?? [], feat: o.feats ?? [], consumable: o.consumables ?? [] },
  items: new Map([...(o.actions ?? []), ...(o.feats ?? [])].map((i) => [i.id, i])),
  synthetics: { toggles: o.toggles ?? {} },
  classDC: o.type && o.type !== "character" ? null : { dc: { value: 21 } },
  statuses: new Set(o.statuses ?? []),
  identificationDCs: { standard: { dc: 18 }, skills: ["society"] },
  ...(o.extra ?? {}),
});

const fighter = () => base({
  id: "valeros", name: "Valeros", cls: "Fighter", ac: 23, hp: [68, 76], temp: 5, hero: 2,
  shield: { itemId: "s1", name: "Steel Shield", ac: 2, hp: { value: 14, max: 20 }, hardness: 5, brokenThreshold: 10, raised: false, broken: false, destroyed: false },
  strikes: [strike("+1 Striking Longsword", 14, { base: "longsword" }), strike("Shortbow", 12, { ready: false }), strike("Fist", 12, { traits: ["unarmed", "agile"] })],
  conds: [cond("off-guard", "Off-Guard")],
  actions: [
    item("a1", "Sudden Charge", "action", { actionType: { value: "action" }, actions: { value: 2 } }),
    item("a2", "Reactive Strike", "action", { actionType: { value: "reaction" } }),
    item("a3", "Search", "action", { actionType: { value: "passive" }, traits: { value: ["exploration"] } }),
  ],
  feats: [
    item("f1", "Mountain Stance", "feat", { actionType: { value: "action" }, actions: { value: 1 }, traits: { value: ["stance"] } }),
    item("f2", "Battle Medicine", "feat", { actionType: { value: "action" }, actions: { value: 1 }, frequency: { value: 1, max: 1, per: "day" } }),
    item("f3", "Toughness", "feat", { actionType: { value: "passive" } }),
  ],
  effects: [{ id: "e1", slug: "stance-mountain-stance", name: "Stance: Mountain Stance", img: "/e.webp" }],
  consumables: [item("p1", "Healing Potion", "consumable", { quantity: 2, traits: { value: ["consumable", "potion"] } }), item("p2", "Arrows", "consumable", { quantity: 20, category: "ammo", traits: { value: ["consumable"] } }), item("p3", "Chalk", "consumable", { quantity: 10, category: "other" })],
  toggles: { "all": { "power-attack": { itemId: "f9", label: "Power Attack", checked: true, enabled: true }, "hidden": { itemId: "f8", label: "Always", checked: true, alwaysActive: true } } },
  exploration: ["a3"],
  lores: { "warfare-lore": stat("Warfare Lore", 8, 1, { lore: true, slug: "warfare-lore" }) },
});
const caster = () => base({ id: "ezren", name: "Ezren", cls: "Wizard", hp: [29, 52], temp: 6, ranks: { arcana: [3, 17], society: [2, 15] } });
const kineticist = () => base({ id: "nahoa", name: "Nahoa", cls: "Kineticist", conds: [cond("quickened", "Quickened")], strikes: [strike("Fist", 12, { traits: ["unarmed"] })],
  actions: [item("eb", "Elemental Blast", "action", { actionType: { value: "action" }, actions: { value: 1 } }, { slug: "elemental-blast" })] });
const familiar = () => base({ id: "fam", name: "Hoot", type: "familiar", hp: [10, 15], extra: { master: { name: "Ezren" } } });
const ogre = () => base({ id: "ogre", name: "Ogre Warrior", type: "npc", pc: false, level: 3, ac: 17, hp: [50, 50], traits: ["giant"], size: "lg",
  strikes: [strike("Ogre Hook", 12), strike("Javelin", 8)],
  actions: [item("n1", "Reactive Strike", "action", { actionType: { value: "reaction" } }), item("n2", "Sweeping Hook", "action", { actionType: { value: "action" }, actions: { value: 2 } })],
  extra: { isElite: true } });
const trapBase = () => base({ id: "trap", name: "Spear Launcher", type: "hazard", pc: false, level: 2, traits: ["trap", "mechanical"], hp: [32, 32],
  details: { disable: "<p>Thievery <strong>DC 18</strong> (trained)</p>", isComplex: false },
  extra: {} });
const trap = () => { const a = trapBase(); a.system.attributes.stealth = { dc: 20 }; return a; };
const dying = () => base({ id: "valeros", name: "Valeros", cls: "Fighter", hp: [0, 76], dying: { value: 2, max: 4 }, conds: [cond("dying", "Dying", 2), cond("unconscious", "Unconscious"), cond("wounded", "Wounded", 1), cond("prone", "Prone")] });

const SPELL = (id, name, rank, time = "2", extra = {}) => ({ id, name, rank, baseRank: rank, img: `/s/${id}.webp`, system: { time: { value: time }, traits: { value: ["fire"] }, range: { value: "500 feet" }, area: { value: 20, type: "burst" }, defense: { save: { statistic: "reflex", basic: true } } }, ...extra });
const ENTRIES = [
  { id: "arc", name: "Arcane Prepared", isPrepared: true, isFocusPool: false, isRitual: false, dc: 25, atk: 15, groups: [
    { id: "cantrips", active: [{ spell: SPELL("ea", "Electric Arc", 0) }, { spell: SPELL("sh", "Shield", 0, "1") }] },
    { id: 1, uses: { max: 2 }, active: [{ spell: SPELL("fb", "Force Barrage", 1, "1 to 3"), castRank: 1 }, null] },
    { id: 3, uses: { max: 2 }, active: [{ spell: SPELL("fire", "Fireball", 3), castRank: 3 }, { spell: SPELL("fire", "Fireball", 3), castRank: 3, expended: true }] },
    { id: 4, uses: { max: 1 }, active: [{ spell: SPELL("fire", "Fireball", 3), castRank: 4 }] },
  ] },
  { id: "foc", name: "Focus", isPrepared: false, isFocusPool: true, isRitual: false, dc: 25, atk: 15, groups: [{ id: 3, uses: { value: 1, max: 1 }, active: [{ spell: SPELL("fbolt", "Force Bolt", 1, "1") }] }] },
  { id: "rit", name: "Rituals", isRitual: true, groups: [] },
];
const MORE_ENTRIES = [
  /* PF2e marks every spell of a spontaneous rank expended once its slots are gone */
  { id: "spo", name: "Divine Spontaneous", isSpontaneous: true, dc: 22, atk: 12, groups: [
    { id: "cantrips", active: [{ spell: SPELL("dl", "Divine Lance", 0), expended: true }] },
    { id: 2, uses: { value: 0, max: 3 }, active: [{ spell: SPELL("heal", "Heal", 2, "1 to 3"), castRank: 2, expended: true }, { spell: SPELL("bless", "Bless", 2, "2"), castRank: 2, expended: true }] },
  ] },
  { id: "inn", name: "Innate", isInnate: true, dc: 20, atk: 10, groups: [
    { id: 1, active: [{ spell: SPELL("fly", "Fly", 1, "2"), castRank: 1, expended: true }, { spell: SPELL("light", "Light", 1, "2", { atWill: true }), castRank: 1, expended: true }] },
  ] },
];
const BLASTS = [{ element: "water", label: "Elemental Blast", elementLabel: "Water", img: "/b/water.webp", range: { max: 30 }, damageTypes: [{ value: "bludgeoning", label: "Bludgeoning", selected: true }],
  maps: { melee: { map0: "+15", map1: "+10 (MAP -5)", map2: "+5 (MAP -10)" }, ranged: { map0: "+15", map1: "+10 (MAP -5)", map2: "+5 (MAP -10)" } } }];

const ctxBase = (actor, o = {}) => ({
  actor, token: null, t, loc, config: { baseWeaponTypes: { longsword: "PF2E.Weapon.Base.longsword" }, actorSizes: { lg: "PF2E.ActorSizeLarge" }, creatureTraits: { giant: "PF2E.TraitGiant" }, frequencies: { day: "PF2E.Frequency.day" } },
  readonly: false, stamina: false, mode: "encounter", turn: { mine: true, current: "", round: 2 }, econ: { max: 3, spent: 1, reaction: true }, map: 1,
  formulas: new Map([["0", { damage: "1d8+4 slashing", critical: "2d8+8 slashing" }]]), blasts: null, spells: null, rank: null, tab: null,
  target: { name: "Ogre Warrior", img: "/o.webp", recallSkill: "society", recallDC: 18 },
  know: (s) => ({ ac: 17, reflex: 16, will: { lo: 13, hi: 15 } }[s] ?? null), truth: false,
  party: [{ actor: caster(), observe: true, turn: false }, { actor: base({ id: "meri", name: "Merisiel", conds: [cond("frightened", "Frightened", 2)] }), observe: false, turn: true }],
  pins: ["demoralize"], frame: null, folded: false, ...o,
});

/* ══ shapes: paths a model holds, arrays folded to [] ══════════════════ */

function paths(o, pre = "", out = new Set()) {
  if (Array.isArray(o)) { for (const x of o) paths(x, `${pre}[]`, out); return out; }
  if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) { out.add(`${pre}.${k}`); paths(v, `${pre}.${k}`, out); } return out; }
  return out;
}
/* Fields the view reads that no fixture happens to carry. Each is named in
   view.mjs; a path here that the view does not read is a reader bug. */
const VIEW_EXTRAS = [".plinth.img", ".plinth.frame", ".plinth.dead", ".plinth.frame.x", ".plinth.frame.y", ".plinth.frame.scale", ".deck.spells.cards[].entry",
  ".vitals.shield.destroyed", ".stack[].turn", ".stack[].self", ".stack[].temp", ".creature.adjust", ".hazard.complex", ".foes.foes[].turn", ".folded", ".readonly",
  ".deck.skills.target.known", ".vitals.sp", ".vitals.sp.value", ".vitals.sp.max", ".turnbar.economy.note", ".turnbar.economy.tone", ".turnbar.next", ".turnbar.observer",
  ".deck.skills.suggested[].vs.degrees[]", ".sk.target.recallDC", ".plinth.speed"];
const playerFix = ["martial", "prepared", "spontaneous", "kineticist", "companion", "dying", "stress"].map((k) => STATES[k](art));
const gmFix = ["gm", "hazard", "gm-horde"].map((k) => STATES[k](art));
const union = (models) => { const u = new Set(VIEW_EXTRAS); for (const m of models) for (const p of paths(m)) u.add(p); return u; };
/* `deck.skills.suggested` is the finder's output in both; compare it through the finder, not the fixtures (which leave it to the host). */
const fold = (p) => p.replace(/^\.deck\.skills\.(suggested|target|checks)(\[\])?\..*$/, ".deck.skills.$1");
const allowP = new Set([...union(playerFix)].map(fold)), allowG = new Set([...union(gmFix)].map(fold));

function holds(model, allow, name) {
  const html = V.RAIL(model, t);
  ok(!/undefined|NaN|\[object Object\]/.test(html.replace(/data-[a-z-]+="[^"]*"/g, "")), `${name}: the drawn rail prints undefined/NaN/[object Object]`);
  for (const p of paths(model)) {
    const f = fold(p);
    if (/^\.deck\.skills\.(suggested|target|checks)/.test(f) || f.startsWith(".sk.")) continue;
    ok(allow.has(f), `${name}: the reader emits ${p}, which no fixture draws and view.mjs does not read`);
  }
  return html;
}
function requires(model, fixtureKeys, name) {
  const have = new Set([...paths(model)].map(fold));
  for (const k of fixtureKeys) ok(have.has(k), `${name}: the reader drops ${k}, which the fixtures always carry`);
}

section("a cast throws away only a prepared slot", () => {
  const h = strip(src["host.mjs"]), d = strip(src["drive.mjs"]);
  const cast = h.slice(h.indexOf("async cast("), h.indexOf("async pressPeek("));
  ok(/castCard\(card, \{ leaves: ref\.key !== "c" && ref\.slotId != null \}\)/.test(cast), "the card leaves the hand only for a prepared slot cast; a cantrip (prepared ones carry a slot too), a focus spell and a spontaneous caster's stay");
  ok(/uncastCard\(card\)/.test(cast) && /finally/.test(cast), "a thrown card comes back when the cast left nothing to redraw");
  const fn = d.slice(d.indexOf("export function castCard("), d.indexOf("export function uncastCard("));
  ok(/if \(!leaves\)/.test(fn) && /is-played/.test(fn) && /classList\.remove\("is-played"\)/.test(fn), "a played card animates in place and keeps its press");
  ok(/\.gph-held\.is-played \{[^}]*animation:/.test(css) && !/\.gph-held\.is-played \{[^}]*(forwards|pointer-events)/.test(css), "the played card's animation does not hold it away or off the pointer");
});

/* ══ the readers ═══════════════════════════════════════════════════════ */

section("the readers are pure", () => {
  for (const f of ["read.mjs", "turn.mjs", "echo.mjs", "subject.mjs", "peeks.mjs", "presses.mjs"]) {
    const code = strip(src[f]);
    for (const g of ["game", "canvas", "ui", "CONFIG", "Hooks", "foundry", "document", "window", "fromUuid"]) ok(!new RegExp(`(?<![.\\w])${g}\\b(?!\\s*:)`).test(code), `${f} reaches ${g}; the check tool and the preview drive it under Node`);
  }
});

section("player readers hold the fixture shape", () => {
  const always = [".role", ".mode", ".turnbar", ".plinth.kind", ".plinth.name", ".plinth.sub", ".vitals.ac", ".vitals.hp.value", ".vitals.hp.max", ".vitals.perception", ".vitals.saves.fortitude",
    ".strikes.list", ".deck.tab", ".deck.tabs[].key", ".deck.actions.toggles", ".deck.actions.list", ".deck.items.list", ".sk.skills", ".stack"];
  const m = R.readPlayer(ctxBase(fighter()));
  holds(m, allowP, "fighter"); requires(m, always, "fighter");
  ok(m.plinth.kind === "character" && m.plinth.sub === "Fighter 5" && m.plinth.speed === "25 ft" && m.plinth.frameable === true, "fighter: plinth kind/sub/speed/frameable");
  ok(JSON.stringify(m.plinth.hero) === "[2,3]" && JSON.stringify(m.plinth.hp) === "[68,76]" && m.plinth.turn === true, "fighter: hero points, hp and the turn mark");
  ok(m.plinth.conds?.[0]?.tone === "danger" && m.plinth.conds[0].name === "Off-Guard", "fighter: off-guard is a danger chip");
  ok(m.vitals.shield?.bt === 10 && m.vitals.shield.raised === false && m.vitals.classDC === 21, "fighter: shield and class DC");
  const [ls, bow] = m.strikes.list;
  ok(ls.id === "0" && JSON.stringify(ls.variants) === JSON.stringify(["+14", "+9", "+4"]) && ls.damage === "1d8+4 slashing" && ls.short === "Weapon.Base.longsword", `fighter: the longsword row (got ${JSON.stringify(ls)})`);
  ok(bow.ready === false, "fighter: a bow not in hand is ready:false");
  ok(m.turnbar.mode === "encounter" && m.turnbar.mine && m.turnbar.map === 1 && m.turnbar.economy.max === 3 && m.turnbar.economy.spent === 1, "fighter: the encounter bar");
  const acts = m.deck.actions.list;
  ok(acts.map((a) => a.name).join("|") === "Sudden Charge|Reactive Strike|Battle Medicine|Mountain Stance", `fighter: action rows (got ${acts.map((a) => a.name)})`);
  ok(acts.at(-1).stance && acts.at(-1).active && acts[1].cost === "r" && acts[0].cost === 2, "fighter: the stance is last and lit; costs read");
  ok(acts[2].freq?.max === 1 && acts[2].freq.used === 0 && acts[2].freq.per === "Frequency.day", "fighter: frequency pips");
  ok(m.deck.actions.toggles.length === 1 && m.deck.actions.toggles[0].id === "all|power-attack|f9" && m.deck.actions.toggles[0].on, "fighter: toggles (always-active ones are not switches)");
  ok(m.deck.items.list.length === 1 && m.deck.items.list[0].qty === 2, "fighter: consumables, ammunition and chalk left out");
  ok(m.sk.skills.unarmed?.mod === 12 && m.sk.lores?.[0]?.slug === "warfare-lore" && m.sk.skills.athletics.rank === 2, "fighter: finder skills, unarmed and lores");
  ok(m.sk.target.defences.reflex === 16 && m.sk.target.defences.fortitude === null && m.sk.target.recallDC === undefined, "fighter: the target as the party knows it; no recall DC for a player");
  ok(m.sk.target.known === "AC 17 · Ref 16 · Will 13–15", `fighter: the known line (got ${m.sk.target.known})`);
  ok(!m.deck.skills.suggested, "fighter: the reader leaves the Skills tab keys to the host (they print the MAP step, a driven value)");
  ok(R.withSkills(m.deck, m.sk, { mode: m.mode, map: 1, t }).skills.suggested?.[0]?.id === "demoralize", "fighter: a pin leads the Skills tab");
  ok(m.stack.length === 2 && m.stack[0].hp && !m.stack[1].hp && m.stack[1].note === "Frightened 2" && m.stack[1].turn, "fighter: a seat without OBSERVER carries no numbers");
  ok(m.util && !m.slim, "fighter: full rail");
  /* Exploring: the bar is the activity, from the character's own exploration items. */
  const x = R.readPlayer(ctxBase(fighter(), { mode: "exploration", turn: null, map: 0 }));
  ok(x.turnbar.mode === "exploration" && x.turnbar.activities.length === 1 && x.turnbar.activities[0].on, "fighter exploring: the activity bar");
  holds(x, allowP, "fighter exploring");
  /* PF2e's standard activities follow the character's own, minus the ones
     they already carry (by slug), each copied from the compendium on pick. */
  const xs = R.readPlayer(ctxBase(fighter(), { mode: "exploration", turn: null, map: 0, standardExploration: true })).turnbar.activities;
  const std = xs.filter((a) => a.std);
  ok(xs[0].id === "a3" && xs[0].on && !xs[0].std, "exploring: the character's own activity leads");
  ok(std.length === STANDARD_EXPLORATION.length - 1 && !std.some((a) => a.id === `${STD_EXPLORE}search`) && std.every((a) => a.id.startsWith(STD_EXPLORE) && !a.on),
    `exploring: the standard activities the character lacks follow, Search (carried) left out (got ${std.map((a) => a.id).join(", ")})`);
  ok(STANDARD_EXPLORATION.every((a) => /^[A-Za-z0-9]{16}$/.test(a.id) && a.slug && a.name), "exploring: every standard activity names its compendium id");
  /* The seat: the plinth's art and frame, and the activity while exploring. */
  const ring = { ring: { enabled: true, subject: { texture: "/cut/ezren.webp" } } };
  const seat = R.seatOf(fighter(), { t, token: ring, frame: { x: 2, y: 4, scale: 1.3 }, exploring: true });
  ok(seat.cutout === "/cut/ezren.webp" && !seat.img && seat.frame?.scale === 1.3, "seat: the token ring's cut-out under the owner's frame, as the plinth draws it");
  ok(seat.explore === "Search" && !R.seatOf(fighter(), { t, exploring: false }).explore, "seat: names the exploration activity while exploring only");
  const sh = V.SEAT(seat, t);
  ok(/class="gph-sfig is-cut"/.test(sh) && /--fz:1\.3/.test(sh) && /class="gph-fig"><span class="gph-img"/.test(sh) && /gph-sexp/.test(sh), "seat: drawn as the plinth's figure (frame vars, cut-out), with the activity");
  const xp = R.readPlayer(ctxBase(fighter(), { mode: "exploration", turn: null, map: 0, party: [{ actor: fighter(), observe: false, turn: false, exploring: true }] }));
  ok(xp.stack[0].explore === "Search" && !xp.stack[0].hp, "seat: the activity shows on a seat without OBSERVER (it is not a number)");
});

section("the caster's hand", () => {
  const m = R.readPlayer(ctxBase(caster(), { spells: ENTRIES, tab: null }));
  holds(m, allowP, "caster");
  const sp = m.deck.spells;
  ok(m.deck.tab === "spells", "caster: a caster opens on Spells");
  ok(sp.ranks.map((r) => r.key).join(",") === "c,1,3,4,f", `caster: ranks c,1,3,4,f in order (got ${sp.ranks.map((r) => r.key)})`);
  ok(sp.dc === 25 && sp.atk === 15 && JSON.stringify(sp.focus) === "[1,1]", "caster: DC, attack and the focus pool");
  const r3 = sp.ranks.find((r) => r.key === 3), r1 = sp.ranks.find((r) => r.key === 1);
  ok(JSON.stringify(r3.slots) === "[1,2]" && JSON.stringify(r1.slots) === "[1,2]", `caster: prepared slots left/max (got ${JSON.stringify(r3.slots)} ${JSON.stringify(r1.slots)})`);
  ok(sp.cards.some((c) => c.socket && c.rank === 1), "caster: an empty prepared slot is a socket");
  const spent = sp.cards.filter((c) => c.rank === 3 && c.spent);
  ok(spent.length === 1 && spent[0].slot === 1 && spent[0].id === "arc.fire.3.1", `caster: an expended slot is a card put down, addressed by slot (got ${JSON.stringify(spent)})`);
  ok(sp.cards.find((c) => c.rank === 4)?.heightened === 4, "caster: a heightened card prints its rank");
  ok(sp.cards.find((c) => c.id.startsWith("arc.fb."))?.cost === "1-3" && sp.cards.find((c) => c.name === "Shield")?.cost === 1, "caster: casting times as costs");
  ok(sp.rank === 4, `caster: the dial opens on the highest rank with a slot left (got ${sp.rank})`);
  ok(m.deck.tabs[0].key === "spells" && m.deck.tabs[0].count === sp.cards.filter((c) => !c.socket && !c.spent).length, "caster: the Spells tab counts castable cards");
  ok(R.spellsOf([ENTRIES[2]]) === null, "caster: rituals alone are no hand");
  {
    const spo = R.spellsOf([MORE_ENTRIES[0]]);
    ok(spo.cards.length === 3 && spo.cards.every((c) => !c.spent && !c.socket && c.slot == null), "caster: a spontaneous caster's spells stay in the hand with the rank's slots gone, and so do its cantrips");
    ok(JSON.stringify(spo.ranks.find((r) => r.key === 2).slots) === "[0,3]", "caster: a spontaneous rank out of slots says so on its count");
    const inn = R.spellsOf([MORE_ENTRIES[1]]);
    ok(inn.cards.find((c) => c.name === "Fly")?.spent === true && !inn.cards.find((c) => c.name === "Light")?.spent, "caster: an innate spell out of uses is put down; an at-will one never is");
    const pc = R.spellsOf([{ ...ENTRIES[0], groups: [{ id: "cantrips", active: [{ spell: SPELL("ea", "Electric Arc", 0), expended: true }] }] }]);
    ok(!pc.cards[0].spent, "caster: a prepared cantrip is never put down");
    ok(!sp.cards.some((c) => c.rank === "f" && c.spent), "caster: a focus spell is never put down");
  }
  ok(R.readPlayer(ctxBase(caster(), { spells: ENTRIES, rank: "f" })).deck.spells.rank === "f", "caster: a chosen rank is kept");
});

section("the kineticist's blasts", () => {
  const m = R.readPlayer(ctxBase(kineticist(), { blasts: BLASTS, econ: new Turn().economy(economyOf(kineticist().itemTypes.condition)), formulas: new Map([["blast:water:m", { damage: "2d8+4 bludgeoning", critical: "4d8+8 bludgeoning" }]]) }));
  holds(m, allowP, "kineticist");
  const [mel, rng] = m.strikes.list;
  ok(mel.kind === "blast" && mel.id === "blast:water:m" && mel.short === "Water" && mel.damage === "2d8+4 bludgeoning", `kineticist: the melee blast (got ${JSON.stringify(mel)})`);
  ok(rng.id === "blast:water:r" && rng.short === "Water 30 ft" && JSON.stringify(rng.variants) === JSON.stringify(["+15", "+10", "+5"]), `kineticist: the ranged blast (got ${JSON.stringify(rng)})`);
  ok(!m.deck.actions.list.some((a) => a.name === "Elemental Blast"), "kineticist: the blast action is a strike row, not an action row");
  ok(m.turnbar.economy.max === 4 && m.turnbar.economy.tone === "good", "kineticist: Quickened is four actions, in green");
  /* PF2e's unconfigured fallback config has empty MAP labels: the steps come from the statistic. */
  const fb = R.blastRows([{ ...BLASTS[0], statistic: { check: { mod: 12 } }, maps: { melee: { map0: "", map1: "", map2: "" }, ranged: { map0: "", map1: "", map2: "" } } }], { t, loc });
  ok(JSON.stringify(fb[0].variants) === JSON.stringify(["+12", "+7", "+2"]), `kineticist: PF2e's fallback blast still draws its MAP steps (got ${JSON.stringify(fb[0].variants)})`);
});

section("familiar, dying, GM and hazard", () => {
  const f = R.readPlayer(ctxBase(familiar()));
  holds(f, allowP, "familiar");
  ok(f.slim && !f.util && f.plinth.kind === "npc" && !f.plinth.hero && f.plinth.sub === "Familiar · Ezren", "familiar: the slim rail, no Hero Points");
  const d = R.readPlayer(ctxBase(dying(), { turn: { mine: false, current: "Ogre Warrior", round: 3 } }));
  holds(d, allowP, "dying");
  ok(JSON.stringify(d.plinth.dying) === '{"value":2,"max":4}' && !d.plinth.conds.some((c) => c.slug === "dying"), "dying: the dying plate, not a dying chip");
  ok(d.plinth.conds.find((c) => c.slug === "prone") && !d.plinth.conds.find((c) => c.slug === "prone").tone, "dying: prone carries no edge");
  ok(d.turnbar.current === "Ogre Warrior" && !d.turnbar.mine && !d.plinth.turn, "dying: off-turn bar");
  const tokens = [
    { id: "t1", name: "Goblin", document: { disposition: 1 }, actor: base({ id: "g", name: "Goblin", type: "npc", pc: false, level: -1, hp: [6, 6] }) },
    { id: "t2", name: "Ogre Warrior", document: { disposition: -1 }, actor: ogre() },
    { id: "t3", name: "Valeros", document: { disposition: 1 }, actor: fighter() },
    { id: "t4", name: "Spear Launcher", document: { disposition: -1 }, actor: trap() },
  ];
  const gmCtx = (actor, tk) => ({ ...ctxBase(actor), token: tk, name: tk?.name, tokens, selected: tk?.id ?? null, turnTokenId: "t2", know: (s) => ({ fortitude: 23, reflex: 21 }[s] ?? null), truth: true, target: { name: "Valeros", img: "/v.webp", recallDC: null } });
  const g = R.readGM(gmCtx(ogre(), tokens[1]));
  holds(g, allowG, "gm");
  requires(g, [".role", ".plinth.kind", ".plinth.name", ".plinth.sub", ".plinth.fold", ".creature.ac", ".creature.hp.value", ".creature.saves.will", ".creature.strikes[].variants", ".creature.abilities[].cost", ".foes.foes[].disp", ".foes.selected", ".stack"], "gm");
  ok(g.plinth.sub === "Level 3 · ActorSizeLarge TraitGiant" && g.creature.recallDC === 18 && g.creature.adjust === "Elite", `gm: the creature's line (got ${g.plinth.sub})`);
  ok(g.foes.foes.map((x) => x.id).join(",") === "t2,t4,t1" && g.foes.foes[0].turn && g.foes.selected === "t2", `gm: the hand is hostile first, scene order, no PCs (got ${g.foes.foes.map((x) => x.id)})`);
  ok(g.sk?.target?.recallDC === undefined || g.sk.target.recallDC === null || typeof g.sk.target.recallDC === "number", "gm: the GM finder target");
  ok(g.stack.every((s) => s.hp), "gm: the GM sees every seat's numbers");
  const z = R.readGM(gmCtx(trap(), tokens[3]));
  holds(z, allowG, "hazard");
  ok(z.hazard && z.creature === null && z.hazard.stealthDC === 20 && z.hazard.disable === "Thievery DC 18 (trained)" && z.plinth.kind === "hazard", `hazard: the hazard panel (got ${JSON.stringify(z.hazard)})`);
  const e = R.readGM({ ...gmCtx(null, null), actor: null, tokens: [] });
  ok(e.role === "gm" && !e.foes && e.plinth.fold && !e.creature, "gm with nothing on the scene: the empty panel");
  ok(V.RAIL(e, t).includes("gph-empty"), "gm with nothing on the scene: the empty plate is drawn");
  /* Creatures on the scene and none selected: the hand, never "no creatures on this scene" over it. */
  const n = R.readGM({ ...gmCtx(null, null), actor: null });
  const nh = V.RAIL(n, t);
  ok(n.foes?.foes?.length === 3 && !nh.includes("gph-empty") && nh.includes("gph-foes"), "gm with foes and none selected: the hand without the empty plate");
  /* PF2e authors a Disable line in inline syntax; it must read as words. */
  const iz = R.readGM(gmCtx((() => { const a = trap(); a.system.details.disable = "<p>@Check[thievery|dc:18|name:Disable Thievery] (trained) on the plate, or @Check[type:athletics|dc:20]{Force it open}; see @UUID[Compendium.pf2e.x.Item.y]{Spear}. [[/r 2d6#piercing]] @Damage[2d6[piercing]]</p>"; return a; })(), tokens[3]));
  const want = "Thievery DC 18 (trained) on the plate, or Force it open; see Spear. 2d6 2d6";
  ok(iz.hazard.disable === want, `hazard: PF2e inline syntax reads as words (got ${JSON.stringify(iz.hazard.disable)})`);
});

section("shape and live values", () => {
  const a = R.readPlayer(ctxBase(fighter())), act = fighter();
  act.system.attributes.hp.value = 40; act.system.resources.heroPoints.value = 0;
  const b = R.readPlayer(ctxBase(act));
  ok(S.shapeOf(a) === S.shapeOf(b), "losing Hit Points or a Hero Point is a value change (drive), not a redraw");
  ok(S.liveOf(b).hp.value === 40 && S.liveOf(b).hero === 0, "liveOf carries the new values");
  const c = R.readPlayer(ctxBase(fighter(), { econ: { max: 3, spent: 2, reaction: false }, map: 2 }));
  ok(S.shapeOf(a) === S.shapeOf(c), "spending actions and the MAP step are values");
  ok(S.shapeOf(a) !== S.shapeOf(R.readPlayer(ctxBase(dying()))), "dying is shape");
});

/* ══ presses ═══════════════════════════════════════════════════════════ */

section("every press the view draws has a host handler", () => {
  for (const h of V.HANDLES) ok(PRESSES.attrs.includes(h), `view.mjs HANDLES ${h}, which the host does not answer`);
  const camel = (a) => a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const onClick = src["host.mjs"].slice(src["host.mjs"].indexOf("async onClick("), src["host.mjs"].indexOf("async check("));
  for (const a of PRESSES.attrs) {
    if (a === "data-find") { ok(/closest\("\[data-find\]"\)/.test(src["host.mjs"]), "the host never reads data-find (typing opens the finder)"); continue; }
    if (a === "data-seat") { ok(/closest\("\[data-seat\]"\)/.test(onClick), "the host never answers a seat"); continue; }
    ok(new RegExp(`\\bd\\.${camel(a)}\\b`).test(onClick), `onClick never reads ${a} (dataset.${camel(a)})`);
  }
  for (const v of PRESSES.acts) ok(onClick.includes(`d.act === "${v}"`), `onClick has no branch for data-act="${v}"`);
  /* The markup of every state, every host-built drawer and peek. */
  const marks = [];
  for (const [name, build] of Object.entries(STATES)) {
    const m = build(art);
    marks.push(V.RAIL({ ...m, util: { ...(m.util ?? {}), open: null } }, t));
    if (m.sk) marks.push(V.FINDER(finderOf(m), t));
    if (m.deck?.spells) marks.push(V.RANKS(m.deck.spells, t));
  }
  const fa = fighter();
  marks.push(V.DLIST({ rows: inventoryRows({ itemTypes: { ...fa.itemTypes, weapon: [item("w", "Longsword", "weapon", { quantity: 1, equipped: { carryType: "held", handsHeld: 1 } })] } }, t) }, t));
  marks.push(V.DLIST({ rows: effectRows(dying()) }, t), V.REST(t), V.MACROS({ page: 1, slots: macroSlots([{ slot: 1, macro: { id: "m1", name: "Hi" } }, { slot: 2 }]) }, t));
  const ps = [strikePeek(fa.system.actions[0], { t, loc, mod: "+14", damage: "1d8", critical: "2d8" }), spellPeek(SPELL("fire", "Fireball", 3), { t, rank: 3, entryName: "Arcane", dc: 25 }), actionPeek(fa.itemTypes.feat[1], { t }), itemPeek(item("el", "Elixir of Life", "consumable", { quantity: 2, level: { value: 1 } }), { t })];
  for (const p of ps) marks.push(V.PEEK(p, t));
  const html = marks.join("\n");
  const tags = html.match(/<(button|div)\b[^>]*>/g) ?? [];
  const acts = new Set(), drawers = new Set(), rows = new Set(), pas = new Set();
  for (const tag of tags) {
    const isButton = tag.startsWith("<button");
    for (const [, k, v] of tag.matchAll(/\s(data-[a-z-]+)(?:="([^"]*)")?/g)) {
      if (isButton && V.HANDLES.includes(k)) ok(PRESSES.attrs.includes(k), `a press carries ${k}, which the host does not answer`);
      if (k === "data-act") acts.add(v);
      if (k === "data-drawer") drawers.add(v);
      if (k === "data-row") rows.add(v.split(":")[0]);
      if (k === "data-pa") pas.add(v);
    }
  }
  for (const v of acts) ok(PRESSES.acts.includes(v), `the view draws data-act="${v}", which the host does not answer`);
  for (const v of drawers) ok(PRESSES.drawers.includes(v), `the view draws data-drawer="${v}", which the host cannot open`);
  for (const v of rows) ok(ROW_KEYS.includes(v), `a drawer row "${v}:" has no host branch`);
  for (const k of ROW_KEYS) ok(src["host.mjs"].includes(`kind === "${k}"`), `pressRow has no branch for "${k}:"`);
  for (const v of pas) ok(PEEK_PRESSES.includes(v), `a peek carries data-pa="${v}", which the host does not answer`);
  for (const k of PEEK_PRESSES) ok(src["host.mjs"].includes(`pa === "${k}"`), `pressPeek has no branch for "${k}"`);
  for (const d of PRESSES.drawers.filter((x) => x !== "sheet")) ok(src["host.mjs"].includes(`kind === "${d}"`), `the host builds no "${d}" drawer`);
  /* Every skill action the finder offers is one PF2e defines: a new-style action or a legacy function. */
  const pf2e = readPf2eActions();
  if (pf2e) for (const a of SKILL_ACTIONS) ok(pf2e.has(a.slug) || pf2e.has(a.slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase())), `PF2e 8.7 defines no action "${a.slug}": its press would do nothing`);
});

function finderOf(m) { return K.finderModel({ ...m.sk, query: "", sel: 0, mode: m.mode ?? "encounter", map: m.turnbar?.map ?? 0, t }); }

/** The slugs and legacy names `game.pf2e.actions` carries, read from the
 *  local PF2e bundle when there is one. */
function readPf2eActions() {
  const home = process.env.HOME ?? "";
  for (const p of [`${home}/.local/share/FoundryVTT/Data/systems/pf2e/pf2e.mjs`]) {
    try {
      const b = readFileSync(p, "utf8");
      const out = new Set([...b.matchAll(/slug: `([a-z-]+)`/g)].map((m) => m[1]));
      const im = /Im = \{([^}]*)\}/.exec(b);
      if (im) for (const n of im[1].split(",")) out.add(n.trim());
      /* and what zm attaches beside them: raiseAShield, restForTheNight, earnIncome… */
      const zm = /Object\.entries\(\{([^}]*?)\.\.\.Im/.exec(b);
      if (zm) for (const n of zm[1].split(",")) out.add(n.split(":")[0].trim());
      console.log(`  (PF2e actions read from ${p})`);
      return out;
    } catch { /* no local PF2e */ }
  }
  console.log("  (no local PF2e bundle: skill-action slugs not checked)");
  return null;
}

/* ══ the turn, the echo, the gates ═════════════════════════════════════ */

section("the action economy is local and follows PF2e's counts", () => {
  ok(economyOf([]).max === 3 && !economyOf([]).note, "three actions");
  ok(economyOf([cond("quickened", "Quickened")]).max === 4, "Quickened: four");
  ok(economyOf([cond("slowed", "Slowed", 1)]).max === 2 && economyOf([cond("slowed", "Slowed", 1)]).tone === "danger", "Slowed 1: two, in red");
  ok(economyOf([cond("stunned", "Stunned", 2), cond("quickened", "Quickened")]).max === 2, "Stunned 2 and Quickened: two");
  ok(economyOf([cond("stunned", "Stunned", 1), cond("slowed", "Slowed", 2)]).max === 1, "Stunned 1 and Slowed 2: one (the larger loss, never the sum)");
  const tn = new Turn();
  ok(tn.sync("c:1:0", true) === true && tn.spent === 0, "a new turn refills");
  tn.spend(2, false, { mine: true, max: 3 }); tn.spend(1, true, { mine: true, max: 3 });
  ok(tn.spent === 3 && tn.map === 1, "two then an attack: three spent, MAP −5");
  ok(tn.sync("c:1:0", true) === false && tn.spent === 3, "a refresh inside the same turn keeps the tally");
  ok(tn.spend(1, true, { mine: false, max: 3 }) === false && tn.spend("r", false, { mine: false, max: 3 }) === true && !tn.reaction, "off-turn only a reaction is spent");
  tn.sync("c:2:0", true);
  ok(tn.spent === 0 && tn.map === 0 && tn.reaction, "the next turn refills actions, reaction and MAP");
  tn.pip(0, 3);
  ok(tn.spent === 3, "pressing the first lit diamond spends all three");
  ok(turnKey({ id: "c", round: 2, turn: 1 }) === "c:2:1" && turnKey(null) === null, "the turn key");
  ok(!/setFlag|update\(|setting\(/.test(strip(src["turn.mjs"])), "turn.mjs writes nothing");
  const hostSpend = src["host.mjs"].slice(src["host.mjs"].indexOf("spend(cost, attack = false)"), src["host.mjs"].indexOf("deny(el)"));
  ok(!/setFlag|actor\.update|emitSocket|game\.settings\.set/.test(hostSpend), "the host's spend() stores or syncs the tally");
});

section("a secret roll never echoes, and the stream login never does", () => {
  const msg = (o = {}) => ({ rolls: [{ total: 23 }], whisper: [], blind: false, author: { id: "u1" }, speaker: { actor: "valeros" }, flags: { pf2e: { context: { outcome: "success" } } }, ...o });
  ok(echoOf(msg(), { userId: "u1", degreeShown: true, words: ["a", "b", "c", "d"] })?.degree === 2, "a public roll echoes its total and degree");
  ok(echoOf(msg(), { userId: "u1", degreeShown: false })?.degree === null, "the degree only where PF2e would show it");
  ok(echoOf(msg({ blind: true }), { userId: "u1", degreeShown: true }) === null, "a blind roll never echoes");
  ok(echoOf(msg({ blind: true }), { userId: "gm", degreeShown: true }) === null, "a blind roll never echoes, even for the GM");
  ok(echoOf(msg({ whisper: ["gm"], author: { id: "u2" } }), { userId: "u1" }) === null, "a whisper the viewer is not in never echoes");
  ok(echoOf(msg({ isContentVisible: false }), { userId: "u1" }) === null, "content Foundry hides never echoes");
  ok(echoOf(msg(), { userId: "u1", stream: true, degreeShown: true }) === null, "the stream login never echoes");
  ok(answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u1", now: 100 }) && !answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u2", now: 100 }), "only the presser's own roll answers the press");
  ok(!answers(msg(), { actorId: "valeros", at: 0 }, { userId: "u1", now: 60_000 }), "a late message answers nothing");
  ok(/echoOf\(message, \{[^}]*stream: this\.stream/.test(src["host.mjs"]), "the host passes the stream flag to echoOf");
  ok(/degreeShown: seesTruth\(\) \|\| metagame\("results"\)/.test(src["host.mjs"]), "the host shows a degree only to the truth or under PF2e's metagame results setting");
  ok(!shouldMount({ system: "pf2e", stream: true }), "the stream login never mounts");
  ok(!shouldMount({ system: "pf2e", pf2eHud: true }), "never beside pf2e-hud");
  ok(!shouldMount({ system: "dnd5e" }) && shouldMount({ system: "pf2e" }), "pf2e only");
  const idx = strip(src["index.mjs"]);
  ok(idx.indexOf("shouldMount(") > -1 && idx.indexOf("shouldMount(") < idx.indexOf("new RailHost"), "index.mjs asks shouldMount before it builds the host");
  ok(/stream:\s*isStream\(\)/.test(idx) && /pf2eHud/.test(idx), "index.mjs hands shouldMount the stream login and pf2e-hud");
  ok(!/Hooks\.on|document\.|new RailHost/.test(idx.slice(0, idx.indexOf("Suite.register("))), "index.mjs does nothing at import time");
  ok(!/\bHooks\.on\(/.test(idx), "index.mjs wires no hooks itself; the host does, from onReady");
});

section("whose rail it is", () => {
  const pc = { id: "p", type: "character" }, npc = { id: "n", type: "npc" }, fam = { id: "f", type: "familiar" }, hz = { id: "h", type: "hazard" };
  ok(subjectOf({ isGM: false, controlled: [{ id: "t", actor: fam }] })?.actor === fam, "a player's controlled familiar is the subject");
  ok(subjectOf({ isGM: false, controlled: [], character: pc })?.actor === pc, "then the assigned character");
  ok(subjectOf({ isGM: false, controlled: [], sceneTokens: [{ actor: pc }] })?.actor === pc, "then an owned character on the scene");
  ok(subjectOf({ isGM: false, controlled: [], sceneTokens: [] }) === null, "a player with nothing has no rail");
  ok(subjectOf({ isGM: true, controlled: [{ actor: npc }] }).role === "gm" && subjectOf({ isGM: true, controlled: [{ actor: hz }] }).actor === hz, "a GM's NPC or hazard is the GM rail");
  ok(subjectOf({ isGM: true, controlled: [{ actor: pc }] }).role === "player", "a GM controlling a character gets its player rail");
  ok(subjectOf({ isGM: true, controlled: [] }).actor === null, "a GM with nothing: the panel with no creature");
  const combat = { started: true, scene: { id: "s" }, combatant: { tokenId: "t1" }, combatants: [{ tokenId: "t1", actorId: "n" }] };
  ok(combatOf([combat], npc, { id: "t1" }, "s") === combat && combatOf([{ ...combat, started: false }], npc, { id: "t1" }, "s") === null, "an encounter only once the combat has started");
  ok(combatOf([combat], npc, { id: "t1" }, "other") === null, "and only on this scene");
  ok(isTurnOf(combat.combatant, npc, { id: "t1" }) && !isTurnOf(combat.combatant, npc, { id: "t2" }), "two tokens of one actor are two turns");
});

/* ══ keys ══════════════════════════════════════════════════════════════ */

section("settings and flags are ph.", () => {
  ok(FEATURE_ID === "pf2e-rail" && PREFIX === "ph.", "feature id and prefix");
  for (const v of [...Object.values(SETTINGS), ...Object.values(FLAGS)]) ok(v.startsWith("ph."), `${v} is not under ph.`);
  const idx = src["index.mjs"];
  ok(/settingPrefix:\s*PREFIX/.test(idx) && /system:\s*"pf2e"/.test(idx) && /defaultEnabled:\s*false/.test(idx), "the adapter declares ph., pf2e and off by default");
  ok(/frame: "ph\.frame"/.test(src["settings.mjs"]) && /pins: "ph\.pins"/.test(src["settings.mjs"]), "the frame is ph.frame and the pins ph.pins");
  for (const m of src["host.mjs"].matchAll(/(?:set|get)Flag\(SUITE_ID,\s*([^,)]+)/g)) ok(/^FLAGS\.\w+$/.test(m[1].trim()), `a flag written outside FLAGS: ${m[1]}`);
  for (const m of src["settings.mjs"].matchAll(/register\(SUITE_ID,\s*([^,]+),/g)) ok(/^SETTINGS\.\w+$/.test(m[1].trim()), `a setting registered outside SETTINGS: ${m[1]}`);
  ok(/actor\.setFlag\(SUITE_ID, FLAGS\.frame/.test(src["host.mjs"]) && /game\.user\.setFlag\(SUITE_ID, FLAGS\.pins/.test(src["host.mjs"]), "the frame is the actor's, the pins the user's");
  const reg = read("scripts/features/index.mjs"), mod = JSON.parse(read("module.json"));
  ok(reg.includes('import "./pf2e-rail/index.mjs";'), "features/index.mjs imports the adapter");
  ok(mod.styles.includes("styles/pf2e-rail.css") && mod.languages.some((l) => l.path === "lang/pf2e-rail.en.json"), "module.json loads the skin and the strings");
});

/* ══ i18n ══════════════════════════════════════════════════════════════ */

section("every key resolves, including the runtime-built ones", () => {
  const families = [
    ...["perception", "fortitude", "reflex", "will", "stealth", "deception"].map((k) => `GLRAIL.check.${k}`),
    ...["perception", "fortitude", "reflex", "will"].map((k) => `GLRAIL.check.${k}Short`),
    ...["spells", "actions", "skills", "items"].map((k) => `GLRAIL.tab.${k}`),
    ...["rest", "macros", "sheet", "effects", "inventory", "strikes", "foes", "statblock"].map((k) => `GLRAIL.drawer.${k}`),
    ...["immune", "weak", "resist", "senses", "speeds", "languages"].map((k) => `GLRAIL.stat.${k}`),
    ...[0, 1, 2].map((i) => `GLRAIL.skill.step${i}`),
    ...[0, 1, 2, 3, 4].flatMap((r) => [`GLRAIL.prof.${r}`, `GLRAIL.prof.${r}Short`]),
    ...["1", "2", "3", "r", "f", "range"].map((c) => `GLRAIL.cost.${c}`),
    ...["hostile", "friendly", "neutral", "secret"].map((d) => `GLRAIL.disp.${d}`),
    ...["dying", "dead"].map((s) => `GLRAIL.state.${s}`),
    ...[0, 1, 2, 3].map((i) => `GLRAIL.degree.${i}`),
    "GLS.feature.pf2e-rail.title", "GLS.feature.pf2e-rail.hint",
  ];
  /* Foundry expands every lang file with expandObject: a key that is also the
     head of another ("GLRAIL.deck" beside "GLRAIL.deck.expand") throws, and the
     WHOLE file is dropped — every string on the rail prints its key. */
  const keys = Object.keys(lang);
  for (const k of keys) ok(!keys.some((o) => o.startsWith(`${k}.`)), `lang key ${k} is also the head of another key; Foundry drops the whole file`);
  for (const k of families) ok(k in lang, `missing ${k}`);
  for (const [f, s] of Object.entries(src)) for (const m of s.matchAll(/["`]((?:GLRAIL|GLS)\.[A-Za-z0-9_.-]+[A-Za-z0-9])["`]/g)) ok(m[1] in lang, `${f} uses ${m[1]}, which lang/pf2e-rail.en.json lacks`);
  for (const k of seen) ok(k in lang, `a render asked for ${k}, which does not resolve`);
});

/* ══ the skin ══════════════════════════════════════════════════════════ */

function ruleSelectors(text) {
  const out = []; let prelude = ""; const stack = [];
  for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, "")) {
    if (ch === "{") {
      const head = prelude.trim(); prelude = "";
      if (stack.includes("kf") || head.startsWith("@keyframes")) { stack.push("kf"); continue; }
      if (head.startsWith("@")) { stack.push("at"); continue; }
      stack.push("rule");
      let depth = 0, cur = "";
      for (const c of head) { if (c === "(") depth++; if (c === ")") depth--; if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c; }
      if (cur.trim()) out.push(cur.trim());
    } else if (ch === "}") { stack.pop(); prelude = ""; } else if (ch === ";") prelude = ""; else prelude += ch;
  }
  return out;
}

section("the skin is scoped", () => {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/:root\b/.test(bare), "pf2e-rail.css writes on :root");
  for (const s of ruleSelectors(bare)) ok(/^(?:[a-z]+)?(?::is\(|:where\()?\.gph(?:-[\w-]+)?(?![\w-])/.test(s), `a rule outside the .gph names: ${s}`);
  for (const m of bare.matchAll(/(?:^|[;{\s])(--gl-[\w-]+)\s*:/g)) problems.push(`pf2e-rail.css redeclares the foundation token ${m[1]}`);
  for (const m of bare.matchAll(/@keyframes\s+([\w-]+)/g)) ok(m[1].startsWith("gph-"), `keyframes ${m[1]} is not gph-`);
  for (const m of bare.matchAll(/@property\s+(--[\w-]+)/g)) ok(m[1].startsWith("--gph-"), `@property ${m[1]} is not --gph-`);
  ok(!/prefers-reduced-motion/.test(bare) && !/prefers-reduced-motion/.test(strip(Object.values(src).join("\n"))), "the suite does not honour prefers-reduced-motion");
  for (const m of bare.matchAll(/(?:transition|animation)(?:-duration|-delay)?\s*:([^;]*);/g)) {
    const raw = m[1].replace(/var\([^)]*\)/g, "").replace(/calc\([^;]*\)/g, "");
    ok(!/\b\d*\.?\d+m?s\b/.test(raw), `a raw duration: ${m[0].trim()}`);
  }
  for (const m of bare.matchAll(/font(?:-size)?\s*:[^;]*?(\d+(?:\.\d+)?)px/g)) ok(+m[1] >= 11, `type under 11px: ${m[0].trim()}`);
  ok(!/@import|@font-face/.test(bare), "no @import or @font-face");
  ok(!/rgba\(255,\s*255,\s*255/.test(bare), "no raw white veils");
});

section("the host keeps to its own corner", () => {
  const h = strip(src["host.mjs"]);
  ok(!/game\.socket/.test(h) && [...h.matchAll(/emitSocket\(([^;]*);/g)].every((m) => /^FEATURE_ID, /.test(m[1]) && /\{ recipients: /.test(m[1])), "the host syncs nothing but a call, through the suite socket, to named recipients");
  ok(!/\.roll\(\{[^}]*dialog/i.test(h) && !/new\s+\w*Dialog/.test(h), "no HUD roll dialog: every press is PF2e's own");
  ok(/style\.display = off \? "none" : ""/.test(h), "the hotbar and the player list are hidden, and given back");
  ok(/hide\("hotbar", SETTINGS\.hideHotbar\)/.test(h) && /hide\("players", SETTINGS\.hidePlayers\)/.test(h), "each docked Foundry panel is hidden behind its own setting");
  ok(/renderPlayers[^\n]*this\.dock\(\)/.test(h), "a re-rendered player list is hidden again");
  ok(/style\.left = `\$\{kept\?\.width \? Math\.round\(kept\.right\) : 0\}px`/.test(h), "the rail stands in the bottom-left corner, or beside a kept player list");
  ok(/--gph-rail-top/.test(h), "the rail publishes its top edge");
  ok(/Budget\.claimMotion/.test(h) === false, "the rail animates only on input, so it claims no motion");
  ok(/hidden[^\n]*GLRAIL\.turnbar\.someone|GLRAIL\.turnbar\.someone[^\n]*hidden/.test(h) || /veiled[\s\S]{0,200}GLRAIL\.turnbar\.someone/.test(h), "a hidden combatant's name never reaches a player's turn bar");
  ok(/variants[\s\S]{0,400}kind: "variant"/.test(h) && /variant: kind/.test(h), "an action with several PF2e variants asks which, and passes it to use()");
  ok(/spendCtx\(\)[\s\S]{0,40}await/.test(h) && !/await [^;]+;\s*(return )?this\.spend\([^)]*\)\s*;?\s*(\}|$)/m.test(h.replace(/this\.spend\([^)]*ctx\)/g, "")), "every press that awaits PF2e spends against the context it started in");
  ok(/turnKey\(ctx\.combat\) !== ctx\.key/.test(h), "a pending press checks its own combat's live turn before spending");
  ok(/updateSetting[\s\S]{0,240}clearKnowledgeCache/.test(h), "a knowledge change refreshes the rail");
  ok(/dock\(drawn = !!this\.el && !!this\.model\)/.test(h) && /const off = drawn && setting/.test(h), "Foundry's panels are hidden only while a rail is drawn");
});

/* The light fails silently in every way it can: a uniform the shader declares
   and the host never writes holds 0, a canvas stacked over the rail puts its
   smoke over the figure and the cards, a shed name SHED_ORDER does not list
   never degrades, and a pass that fires on the wrong transition plays the
   lights going out on someone who just got up. */
section("the light is a moment, behind the rail", () => {
  const l = src["light.mjs"], code = strip(l);
  const frag = l.slice(l.indexOf("const FRAG"), l.indexOf("}`;", l.indexOf("const FRAG")));
  const declared = [...frag.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);
  const written = new Set([...code.matchAll(/u\.(u[A-Z]\w*)/g)].map((m) => m[1]));
  ok(declared.length > 5, "the light's shader declares its uniforms");
  for (const u of declared) ok(written.has(u), `the light's uniform ${u} is declared and never written`);
  ok(/for \(const n of \[([^\]]+)\]\)/.test(code) && declared.every((u) => code.match(/for \(const n of \[([^\]]+)\]\)/)[1].includes(`"${u}"`)), "every uniform's location is looked up");
  ok(SHED_ORDER.includes("light") && /this\.ladder\.allows\("light"\)/.test(code) && /Budget\.ladder\(FEATURE_ID, SHED_ORDER\)/.test(code), "the light is shed through the shared budget");
  ok(/Surfaces\.register\(/.test(code) && /this\.surface\?\.use\(\)/.test(code), "the light's context is registered and used before each draw");
  ok(/claimMotion\(`\$\{FEATURE_ID\}\.light`, true\)/.test(code) && /claimMotion\(`\$\{FEATURE_ID\}\.light`, false\)/.test(code), "the light claims motion only while it plays");
  ok(!/(?<![.\w])(game|canvas|foundry|ui|Hooks)\./.test(code), "the light is pure: the preview plays the shipped one");
  ok(/scaledMs\(/.test(code), "the light's length follows the motion tier");
  const rail = css.match(/\.gph-rail \{[^}]*\}/)?.[0] ?? "", lightRule = css.match(/\.gph-light \{[^}]*\}/)?.[0] ?? "";
  const z = (r) => +(r.match(/z-index:\s*(\d+)/)?.[1] ?? NaN);
  ok(/position:\s*relative/.test(rail) && z(rail) > z(lightRule), "the rail stacks over the light, so its smoke stays behind the figure and the cards");
  ok(/root\.prepend\(this\.canvas\)/.test(code), "the canvas goes in first, under the rail");
  const host = strip(src["host.mjs"]);
  ok(/this\.light\.attach\(root\)/.test(host), "the host attaches the light after every render");
  ok(relight("", "dying") === "out" && relight("dying", "") === "in" && relight("dying", "dead") === null && relight("", "") === null && relight("dead", "") === "in", "the lights go out on going down and come back on getting up, never between dying and dead");
  ok(downOf({ role: "player", plinth: { dying: { value: 1 } } }) === "dying" && downOf({ role: "gm", plinth: { dead: true } }) === "" && downOf({ role: "player", plinth: {} }) === "", "only a player's own rail goes down");
  ok(/\.gph\[data-light\][^{]*\{[^}]*animation: gph-rimlit[^}]*var\(--gph-lit-d/.test(css) && /--gph-lit-d/.test(code), "each plate's edge takes the light when the spark reaches it");
});

/* Every moment fails silently: a transition read the wrong way round plays
   the turn going home on someone whose turn just started, a class the drive
   restarts that no rule animates is a moment that never shows, a host and a
   preview deciding moments separately drift apart, and a MAP grid whose live
   track is not where the marker's arithmetic assumes underlines the wrong
   attack. */
section("the moments", () => {
  const P = (tb, plinth = {}) => ({ role: "player", turnbar: tb ? { mode: "encounter", economy: { max: 3, spent: 0, reaction: true }, map: 0, ...tb } : null, plinth });
  const mine = P({ mine: true }), theirs = P({ mine: false }), next = P({ mine: false, next: true });
  let m = momentsOf(theirs, mine, { fresh: true });
  ok(m.light === "in" && m.ignite && !m.call, "a new turn plays the ignition and the light in");
  m = momentsOf(mine, theirs);
  ok(m.light === "home" && !m.ignite, "the turn ending plays the light going home");
  m = momentsOf(mine, P({ mine: false }, { dying: { value: 1, max: 4 } }));
  ok(m.light === "out", "going down as the turn ends puts the lights out; it never goes home");
  ok(momentsOf(mine, mine).light === null && momentsOf(theirs, theirs).light === null, "nothing plays while the turn stands");
  ok(momentsOf(theirs, next).call && !momentsOf(next, next).call && !momentsOf(next, theirs).call, "the on-deck knock plays once, as you become next");
  ok(!momentsOf(theirs, P({ mine: true, next: true })).call, "a turn of your own is never on deck");
  ok(momentsOf(theirs, next).light === null, "being next is no light: the canvas light is a moment, never a state");
  m = momentsOf(P(null, { hero: [2, 3] }), P(null, { hero: [1, 3] }));
  ok(m.hero?.from === 2 && m.hero?.to === 1, "a Hero Point spent cracks a gem");
  ok(momentsOf(P(null, { hero: [1, 3] }), P(null, { hero: [2, 3] })).hero === null, "a Hero Point gained cracks nothing");
  const dy = (v) => P(null, { dying: { value: v, max: 4 } });
  ok(momentsOf(dy(2), dy(3)).dying?.to === 3 && momentsOf(dy(2), dy(1)).dying?.to === 1, "a dying bead lit burns and one put out exhales");
  ok(momentsOf(dy(3), P(null, { dead: true, dying: { value: 4, max: 4 } })).dying === null, "death plays no bead");
  m = momentsOf(dy(1), P({ mine: false }, {}));
  ok(m.light === "in" && !m.dying, "stabilising brings the light back");
  const G = (turn) => ({ role: "gm", plinth: {}, foes: { foes: [{ id: "a", disp: "hostile", ...(turn === "a" ? { turn: true } : {}) }, { id: "b", disp: "friendly", ...(turn === "b" ? { turn: true } : {}) }] } });
  m = momentsOf(G("a"), G("b"), { fresh: true });
  ok(m.light === "in" && m.tone === "friendly" && m.card === "b" && !m.ignite, "a creature's turn on the GM's screen plays the light in its disposition and calls its card");
  ok(momentsOf(G("a"), G(null), { fresh: true }).light === null, "a turn that is not a creature in the hand plays nothing on the GM's screen");
  ok(momentsOf(G("a"), G("b")).light === null && momentsOf(G("a"), mine, { fresh: true }).light === null, "the GM's light needs a new turn, and a change of rail plays nothing");
  for (const d of ["hostile", "friendly", "neutral", "secret"]) {
    const v = LIGHT_TONE[d];
    ok(!!v && new RegExp(`${v.replace(/-/g, "\\-")}:`).test(css), `the ${d} light's colour ${v} is a skin token`);
  }
  for (const k of ["paper", "red", "green", "steel"]) ok(/^#[0-9a-f]{6}$/i.test(INK_SIGNAL[k] ?? ""), `the light's ${k} has its mirror in core`);
  const mo = strip(src["moments.mjs"]);
  ok(!/(?<![.\w])(game|canvas|foundry|ui|Hooks)\./.test(mo), "moments.mjs is pure: the preview plays the shipped moments");
  for (const f of ["ignite", "callCard", "callUp", "spendHero", "dyingBeat"]) ok(typeof Drive[f] === "function" && mo.includes(`D.${f}(`), `playMoments plays ${f}`);
  ok(/light\?\.play\(root, mo\.light, \{ tone: mo\.tone \}\)/.test(mo), "playMoments plays the light in its tone");
  const drv = strip(src["drive.mjs"]);
  for (const [cls, rule] of [["is-calling", /\.gph-turnbar\.is-calling \{[^}]*animation/], ["is-called", /\.gph-card\.is-foe\.is-called \{[^}]*animation/], ["crack", /\.gph-gem\.crack::after \{[^}]*animation/], ["is-heroic", /\.is-heroic \{[^}]*animation/], ["is-burn", /i\.is-burn \{[^}]*animation/], ["is-exhale", /i\.is-exhale::after \{[^}]*animation/], ["is-flicker", /\.gph\.is-flicker[^{]*\{[^}]*animation/]]) {
    ok(drv.includes(`"${cls}"`), `the drive restarts ${cls}`);
    ok(rule.test(css), `${cls} has a rule that animates it`);
  }
  ok(/\.gph-streak \{/.test(css) && /scaledMs\(/.test(drv), "the streak is styled, and the moments' lengths follow the motion tier");
  const host = strip(src["host.mjs"]);
  ok(/playMoments\(this\.root, momentsOf\(was, model, \{ fresh: this\.fresh \}\), \{ light: this\.light, heroAt: \(\) => this\.heroAt\(\) \}\)/.test(host), "the host plays the moments it reads between two rails of one subject");
  ok(/momentsOf\(was, next, \{ fresh \}\)/.test(read("tools/pf2e-rail-preview.mjs")) && /playMoments\(/.test(read("tools/pf2e-rail-preview.mjs")), "the preview decides moments with the same module");
  ok(/this\.gmKey !== undefined && k !== this\.gmKey/.test(host), "the GM's light waits for a turn to change, never the first read");
  ok(/context\?\.isReroll/.test(host) && /within: TIMING\.rerollWindow/.test(host) && /this\.lastEcho = \{/.test(host), "a Hero Point reroll echoes on the press the first roll did");
  /* up next */
  const T = (ids, dead = []) => ids.map((id) => ({ id, isDefeated: dead.includes(id) }));
  const me = (c) => c?.id === "me";
  ok(upNext(T(["a", "me", "b"]), 0, me) && !upNext(T(["a", "me", "b"]), 1, me) && !upNext(T(["a", "me", "b"]), 2, me), "up next is the turn after the current one, and never the current one");
  ok(upNext(T(["me", "a", "b"]), 2, me), "up next wraps the round");
  ok(!upNext(T(["a", "x", "me"]), 0, me, { skipDefeated: true }) && upNext(T(["a", "x", "me"], ["x"]), 0, me, { skipDefeated: true }) && !upNext(T(["a", "x", "me"], ["x"]), 0, me), "a defeated combatant is passed over only where the tracker skips them");
  ok(!upNext(T(["me"]), 0, me) && !upNext([], 0, me) && !upNext(T(["a", "me"]), -1, me), "no next in a combat of one or before it starts");
  const tbN = R.turnbarOf({}, { mode: "encounter", turn: { mine: false, next: true, current: "Kyra" }, econ: { max: 3, spent: 0, reaction: true } });
  const tbM = R.turnbarOf({}, { mode: "encounter", turn: { mine: true, next: true }, econ: { max: 3, spent: 0, reaction: true } });
  ok(tbN.next === true && !tbM.next, "the turn bar is on deck only while the turn is somebody else's");
  const tt = (k) => k;
  const onDeck = V.TURNBAR(tbN, (k, d) => (d?.name ? `${k}:${d.name}` : k)), mineBar = V.TURNBAR(tbM, tt);
  ok(/is-next/.test(onDeck) && /<span>GLRAIL\.turnbar\.next<\/span>/.test(onDeck) && !/is-next|GLRAIL\.turnbar\.next</.test(mineBar), "the on-deck bar's label says you're next, and your own turn's never does");
  const T2 = (k, d) => (d?.name ? `${k}:${d.name}` : k);
  const obsNext = V.TURNBAR({ ...tbN, observer: "Seelah" }, T2), obsMine = V.TURNBAR({ ...tbM, observer: "Seelah" }, T2);
  ok(/GLRAIL\.turnbar\.nextOf:Seelah/.test(obsNext) && !/GLRAIL\.turnbar\.(next|nextSaid|yours)\b(?!Of)/.test(obsNext.replace(/GLRAIL\.turnbar\.nextOf/g, "")) && /GLRAIL\.turnbar\.theirs:Seelah/.test(obsMine) && !/GLRAIL\.turnbar\.yours/.test(obsMine), "an observer's bar names the character, never \"you\"");
  ok(R.turnbarOf({ name: "Seelah" }, { mode: "encounter", readonly: true, turn: { mine: false }, econ: { max: 3, spent: 0, reaction: true } }).observer === "Seelah" && R.turnbarOf({ name: "Seelah" }, { mode: "encounter", turn: { mine: false }, econ: { max: 3, spent: 0, reaction: true } }).observer === undefined, "the reader names the observed character only on a read-only rail");
  ok(/title="GLRAIL\.turnbar\.theirs:Kyra"/.test(onDeck) && /GLRAIL\.turnbar\.nextSaid/.test(onDeck), "on deck, whose turn it is now is still said (title and screen reader)");
  ok(/\.gph-turnbar\.is-next::before \{[^}]*animation/.test(css), "the on-deck edge breathes while it is true");
  {
    const spentAll = R.turnbarOf({}, { mode: "encounter", turn: { mine: false, next: true, current: "Kyra" }, econ: { max: 3, spent: 3, reaction: true } });
    const lit = (html) => (html.match(/class="gph-pip on"/g) ?? []).length;
    ok(lit(V.TURNBAR(spentAll, tt)) === 3 && S.liveOf({ turnbar: spentAll }).econ.left === 3 && S.actionsLeft({ ...spentAll, next: false }) === 0,
      "on deck the diamonds are the turn coming, not what was left of the last one (drawn and driven alike)");
  }
  /* the MAP steps keep still: no step is lit, sized or marked by the MAP */
  ok(!/gph-mapmark|--gph-m-live|--gph-map\b/.test(css + src["view.mjs"] + src["drive.mjs"]), "no live-step marker, sizing or slide");
  ok(!/data-map="[0-2]"\][^{]*\.gph-(n?stk|map)/.test(css), "no MAP step is styled by the step you are on");
});

section("reload (PF2e Ranged Combat)", () => {
  const tt = (k) => k;
  const LOADED = "Compendium.pf2e-ranged-combat.effects.Item.nEqdxZMAHlYVXI0Z";
  const xbow = { id: "xb", type: "weapon", system: { reload: { value: "2" } } };
  const bow = { id: "bow", type: "weapon", system: { reload: { value: "0" } } };
  const who = (effects = [], item = xbow) => ({ itemTypes: { effect: effects }, _item: item });
  const on = { ranged: true };
  ok(R.reloadOf(who(), xbow, { ranged: false }) === null, "no Reload press unless the module runs");
  ok(R.reloadOf(who(), bow, on) === null && R.reloadOf(who(), { ...bow, system: { reload: { value: "-" } } }, on) === null, "reload 0 and – weapons carry no Reload press");
  ok(JSON.stringify(R.reloadOf(who(), xbow, on)) === '{"cost":2,"loaded":false}', "an empty reload-2 weapon: Reload costs 2, not loaded");
  ok(R.reloadOf(who([{ sourceId: LOADED, flags: { "pf2e-ranged-combat": { targetId: "xb" } } }]), xbow, on).loaded === true, "the module's Loaded effect aimed at the weapon is loaded");
  ok(R.reloadOf(who([{ sourceId: LOADED, flags: { "pf2e-ranged-combat": { targetId: "other" } } }]), xbow, on).loaded === false, "a Loaded effect aimed at another weapon is not");
  ok(R.reloadOf(who(), { ...xbow, subitems: [{ quantity: 1, isAmmoFor: () => true }] }, on).loaded === true, "under PF2e's own ammunition a round in the weapon is loaded");
  ok(R.reloadOf(who(), { ...xbow, system: { reload: { value: "10" } } }, on).cost === null, "a one-minute reload spends no diamonds");
  const row = V.STRIKES({ list: [{ id: "1", name: "Crossbow", variants: ["+9", "+4", "-1"], damage: "1d10", critical: "2d10", reload: { cost: 2, loaded: false } }] }, tt);
  ok(/class="gph-stk has-reload"/.test(row) && /class="gph-rld" data-reload="1" data-cost="2"/.test(row), "an empty weapon's row draws a lit Reload press that costs its actions");
  ok(/gph-rld is-loaded/.test(V.STRIKES({ list: [{ id: "1", name: "Crossbow", variants: ["+9"], reload: { cost: 1, loaded: true } }] }, tt)), "a loaded weapon's press goes faint");
  const h = strip(src["host.mjs"]);
  ok(/game\.pf2eRangedCombat\.reload\(\)/.test(h) && /pf2eRangedCombatReload/.test(h), "Reload is the module's own action, and the actions are spent on its hook");
  ok(/onReloaded\(actor, weapon\)[\s\S]{0,200}actor\?\.id !== p\.actorId/.test(h) && /this\.spend\(n, false, p\.ctx\)/.test(h), "a reload spends only for the actor pressed, against the turn it was pressed in");
  ok(/pf2eRangedCombatReload", \(actor, weapon\) => this\.onReloaded\(actor, weapon\)/.test(h) && /weapon\?\.reloadActions/.test(h) && !/p\.cost/.test(h), "the cost is the reloaded weapon's, not the pressed row's");
  ok(/\.gph-stk\.has-reload \{ grid-template-columns: minmax\(0, 1fr\) 24px repeat\(3, 32px\) 34px 34px; \}/.test(css), "the Reload press takes its own track, the MAP steps keep theirs");
});

/* What the polish pass added, each of which fails without a word: a Hit Point
   entry read as the wrong kind turns "12 damage" into "set to 12"; a tooltip
   handed to Foundry as `data-tooltip` is rendered as HTML, and item and macro
   names are whatever a player typed; an Escape the host does not eat also
   releases the controlled token, and the rail with it. */
section("the Hit Point field, tooltips and putting things away", () => {
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(S.hpEntry("-12"), { delta: -12 }) && eq(S.hpEntry("−12"), { delta: -12 }) && eq(S.hpEntry(" – 7 "), { delta: -7 }), "a minus, typed or typographic, is damage");
  ok(eq(S.hpEntry("+5"), { delta: 5 }), "a plus is healing");
  ok(eq(S.hpEntry("30"), { set: 30 }) && eq(S.hpEntry("=30"), { set: 30 }) && eq(S.hpEntry("0"), { set: 0 }), "a bare number is the new total, never damage");
  for (const bad of ["", "abc", "1d8", "--3", "+-3", "12.5", "5+5", "999999"]) ok(S.hpEntry(bad) === null, `the field takes "${bad}"`);
  const meter = V.METER("hp", { value: 68, max: 76, temp: 5 }, t);
  ok(/<button type="button" class="gph-hpb" data-act="hp"[^>]*><b data-v>68<\/b>/.test(meter), "the numeral is the press, and still carries data-v for the drive");
  ok(!/data-act="hp"/.test(V.METER("sp", { value: 3, max: 9 }, t, { big: false })), "Stamina has no field");
  const h = strip(src["host.mjs"]);
  ok(/modifyTokenAttribute\("attributes\.hp", e\.delta, true, true\)/.test(h), "damage and healing go through PF2e's applyDamage (temp first, dying after)");
  const apply = h.slice(h.indexOf("async applyHp("), h.indexOf("pressSeat(id) {"));
  ok(/e\.delta != null\) return/.test(apply) && /Math\.max\(0,/.test(apply) && /Math\.min\(max, e\.set\)/.test(apply), "a typed total is clamped to 0…max and never applied as a change");
  ok(/editHp\(b\) \{[\s\S]{0,160}!actor\?\.isOwner/.test(h), "only an owner's field opens");
  ok(/dataset\.tooltipText = s/.test(h) && !/dataset\.tooltip = |dataset\.tooltipHtml/.test(h), "tooltips are handed over as plain text, never as markup");
  ok(/removeAttribute\("title"\)/.test(h), "the native title goes, or both tooltips open");
  ok(/e\.key === "Escape" && \(this\.peek \|\| this\.open\.drawer\)\) \{ eat\(\);/.test(h), "an Escape that closes something is eaten: Foundry would release the token");
  const outside = h.slice(h.indexOf("onOutside(e) {"), h.indexOf("onKey(e) {"));
  ok(/!this\.peek && !this\.open\.drawer/.test(outside) && !/closeFinder|fs\.open = false/.test(outside), "a press off the rail closes a drawer or a peek, never the finder");
  ok(/render\(\{ arrive = false \} = \{\}\) \{[\s\S]{0,700}this\.hoverToken\(null\)/.test(h) && /unmount\(\) \{[\s\S]{0,500}this\.hoverToken\(null\)/.test(h), "a token lit from a card is let go when the card is redrawn or the rail leaves");
  ok(/tk\.visible && tk\._canHover/.test(h), "a card never lights a token its viewer cannot see");
  /* an item in the hand */
  const known = itemPeek(item("el", "Elixir of Life", "consumable", { quantity: 2, level: { value: 1 }, traits: { value: ["healing"] }, uses: { value: 1, max: 3 } }), { t });
  ok(known.traits.length === 1 && known.lines.length === 2 && known.actions[0].id === "use", "an item peek: traits, what is left and its doses, Use first");
  const hidden = itemPeek(item("x", "Elixir of Life", "consumable", { quantity: 1, level: { value: 9 }, traits: { value: ["healing"] }, identification: { unidentified: { name: "Unusual Vial" } } }, { isIdentified: false }), { t });
  ok(hidden.name === "Unusual Vial" && hidden.traits.length === 0 && !/9/.test(hidden.from), "an unidentified item peeks under its unidentified name, with no level and no traits");
  ok(/p\.kind === "item"/.test(h) && /HOVER_PEEKS = new Set\(\["spell", "item"\]\)/.test(h), "the item peek has its presses, and closes when the pointer leaves");
  ok(!/data-item="[^"]*" title=/.test(V.ITEMS({ list: [{ id: "a", name: "Potion", qty: 1 }] }, t)), "an item card that peeks carries no tooltip under the peek");
  ok(/\[data-readonly\] button:not\([^)]*\.gph-card\[data-item\]/.test(css), "an observer's item card still peeks, like a spell");
  /* macros and ranks */
  const mac = V.MACROS({ page: 2, slots: macroSlots([]) }, t);
  ok(/data-row="page:-1"/.test(mac) && /data-row="page:1"/.test(mac) && /cyclePage/.test(h), "the Macros drawer steps Foundry's own hotbar pages");
  ok(/renderHotbar[^\n]*this\.open\.drawer === "macros"[^\n]*this\.render\(\)/.test(h), "a page turned redraws the open drawer");
  const ranks = V.RANKS({ ranks: [{ key: "f", cards: 1 }, { key: 1, cards: 3, slots: [2, 3] }] }, t);
  ok(/1 spell</.test(ranks) && /3 spells</.test(ranks), "one spell is not \"1 spells\"");
  ok(/aria-label="Close"/.test(V.DRAWER({ title: "Rest", body: "", close: t("GLRAIL.close") })), "a drawer's close press says Close");
  ok(/drawer\(kind\) \{[\s\S]{0,120}close: t\("GLRAIL\.close"\)/.test(h), "the host names every drawer's close press");
  const wheel = h.slice(h.indexOf("onWheel(e) {"), h.indexOf("onOutside(e) {"));
  ok(/TIMING\.wheelStep/.test(wheel) && wheel.indexOf("this.wheelAt = now") < wheel.indexOf("if (!quiet) return"), "the wheel turns one rank a gesture: every event extends the gesture, not only the one that stepped");
  ok(/class="gph-tog[^>]*><span>/.test(V.ACTIONS({ toggles: [{ id: "a|b|c", label: "Aura", on: true }], list: [] }, t)) && /\.gph-tog > span \{[^}]*text-overflow: ellipsis/.test(css), "a squeezed toggle ends in an ellipsis, not mid-letter");
});

/* ══ the skill sheet, the MAP steps, the stat bar ══════════════════════ */

section("the skill sheet shows every skill, and never has to be opened", () => {
  const m = STATES.martial(art);
  const full = finderOf(m);
  /* the pins stand above the sheet, in a row of their own */
  ok(m.sk.pins.length > 0 && full.rows[0].pinned === true && full.rows[0].actions.map((a) => a.slug).join() === m.sk.pins.join() && full.rows.filter((r) => r.pinned).length === 1, "the pinned actions are the sheet's first row");
  ok(full.rows[0].actions.every((a) => !a.stat && a.best) && /class="gph-fk is-pins"/.test(V.FINDER(full, t)) && !/class="gph-fk is-pins"[^>]*data-check/.test(V.FINDER(full, t)), "a pin rolls with the character's best skill, and its row's head is a label, not a check");
  ok(!finderOf({ ...m, sk: { ...m.sk, pins: [] } }).rows.some((r) => r.pinned) && !K.finderModel({ ...m.sk, query: "dem", mode: "encounter", t }).rows.some((r) => r.pinned), "no pins, no row; and typing searches the sheet, not the pins");
  const f = { ...full, rows: full.rows.filter((r) => !r.pinned) };
  const keys = f.rows.map((r) => r.key);
  const sixteen = keys.filter((k) => R.SKILLS.includes(k));
  ok(keys[0] === "perception", "Perception leads the sheet");
  ok(sixteen.length === 16 && R.SKILLS.every((k) => keys.includes(k)), `every one of the sixteen skills has a row, untrained or not (got ${sixteen.length})`);
  const names = f.rows.filter((r) => R.SKILLS.includes(r.key)).map((r) => r.name);
  ok(names.join("|") === [...names].sort((a, b) => a.localeCompare(b)).join("|"), "the skills stand in the sheet's order, by name, whatever their modifier");
  ok(f.rows.at(-1).lore === true && f.rows.findIndex((r) => r.lore) > keys.indexOf("thievery"), "the Lores follow the skills");
  ok(f.rows.every((r) => r.check === (r.key === "perception" ? "perception" : `skill:${r.key}`)), "every row's head is that skill's plain check");
  ok(!("columns" in f) && !("checks" in f), "nothing is folded away: no columns to open, no foot of leftover checks");
  /* an action several skills roll stands in each row, rolled with that row's skill */
  const rk = f.rows.filter((r) => r.actions.some((a) => a.slug === "recall-knowledge"));
  ok(["arcana", "crafting", "nature", "occultism", "religion", "society"].every((k) => rk.some((r) => r.key === k)) && rk.some((r) => r.lore), "Recall Knowledge stands under every skill that can roll it, and the Lores");
  ok(rk.every((r) => r.actions.find((a) => a.slug === "recall-knowledge").skill.slug === r.key && r.actions.find((a) => a.slug === "recall-knowledge").stat === r.key), "and is rolled with its row's skill, not the character's best");
  /* a statistic with no row competes inside the action's rows */
  const esc = f.rows.find((r) => r.key === "acrobatics").actions.find((a) => a.slug === "escape");
  ok(esc && esc.stat === "acrobatics" && esc.skill.mod === Math.max(m.sk.skills.acrobatics.mod, m.sk.skills.unarmed.mod), "Escape under Acrobatics rolls the better of Acrobatics and Unarmed");
  /* trained-only under an untrained skill cannot be taken */
  const untrained = f.rows.filter((r) => !(r.rank > 0));
  ok(untrained.length > 0 && untrained.every((r) => r.actions.every((a) => !SKILL_ACTIONS.find((x) => x.slug === a.slug).trained)), "a trained-only action is not drawn under an untrained skill");
  ok(f.rows.find((r) => r.key === "thievery").actions.every((a) => a.slug !== "pick-a-lock"), "an untrained Thievery offers no Pick a Lock");
  /* an encounter shows what can be done in one; exploring, everything */
  ok(!f.actions.some((a) => a.slug === "treat-wounds") && K.finderModel({ ...m.sk, query: "", mode: "exploration", t }).rows.find((r) => r.key === "medicine").actions.some((a) => a.slug === "treat-wounds"), "exploring adds the exploration actions; an encounter leaves them out");
  ok(K.finderModel({ ...m.sk, query: "treat w", mode: "encounter", t }).rows.some((r) => r.actions.some((a) => a.slug === "treat-wounds")), "typing finds an action the mode left out");

  /* typing: a skill's name keeps its whole row and Enter rolls the check */
  const ath = K.finderModel({ ...m.sk, query: "ath", mode: "encounter", t });
  ok(ath.rows.length === 1 && ath.rows[0].key === "athletics" && !ath.rows[0].aside && ath.rows[0].actions.length === f.rows.find((r) => r.key === "athletics").actions.length, "a skill's name keeps its whole row");
  const athHtml = V.FINDER(ath, t);
  ok(/class="gph-fk is-sel" data-check="skill:athletics"[^>]*data-k="0"/.test(athHtml), "and the check is the first key, so Enter rolls Athletics");
  /* an action's name keeps that action; the row's check is drawn but the keys skip it */
  const trip = K.finderModel({ ...m.sk, query: "trip", mode: "encounter", t });
  ok(trip.rows.length === 1 && trip.rows[0].aside === true && trip.rows[0].actions.map((a) => a.slug).join() === "trip", "an action's name keeps that action alone");
  const tripHtml = V.FINDER(trip, t);
  ok(/class="gph-fk" data-check="skill:athletics" data-rank="\d" title/.test(tripHtml) && /class="gph-fa is-sel is-steps"[^>]*data-k="0"/.test(tripHtml), "and Enter rolls Trip, not Athletics: the row's check takes no key");

  /* the markup */
  const html = V.FINDER(f, t);
  const ks = [...html.matchAll(/data-k="(\d+)"/g)].map((x) => +x[1]);
  ok(ks.length === f.rows.length + f.rows.reduce((n, r) => n + r.actions.length, 0) && ks.every((k, i) => k === i), "every check and every action is a key, numbered in reading order");
  const tabs = R.withSkills(m.deck, m.sk, { mode: m.mode, map: 0, t }).tabs.find((x) => x.key === "skills");
  ok(tabs && tabs.count == null, "the Skills tab prints no count: it holds every skill, always");
  ok(!/expand-col|gph-more|gph-fchecks/.test(html) && !/expand-col/.test(src["host.mjs"]), "nothing on the sheet is a \"more\" press");
  ok(/\.gph-skrow \{[^}]*grid-template-columns: \d+px minmax\(0, 1fr\)/.test(css) && /\.gph-sacts \{[^}]*repeat\(auto-fill/.test(css), "a row is its check and its actions, in columns that line up down the sheet");
  const host = src["host.mjs"];
  ok(/querySelectorAll\("\[data-finder\] \[data-k\]"\)/.test(host) && /if \(e\.key === "Enter"\) \{ eat\(\); if \(c\) pressOf\(c\)\.click\(\)/.test(host), "Enter presses the selected key, a check or an action alike");
  ok(/d\.stat \?\? null\)/.test(host) && /rows\.find\(\(r\) => r\.key === stat\)\?\.actions\.find/.test(host) && /statistic: a\.skill\.slug/.test(host), "a press on the sheet rolls with the row it stands in");
  ok(/"data-skill-action", "data-stat"\]/.test(host), "the echo lands on the row that rolled, not on the action's first row");
});

section("the Skills tab is the plain checks, one press each", () => {
  const m = STATES.martial(art);
  const deck = R.withSkills(m.deck, m.sk, { mode: m.mode, map: 0, t });
  const checks = deck.skills.checks;
  ok(checks.length === 16 + (m.sk.lores?.length ?? 0) && !checks.some((c) => c.key === "perception"), "every skill and Lore is a check on the tab (Perception is on the vitals plate)");
  const html = V.SKILLTAB(deck.skills, t);
  for (const c of checks) ok(html.includes(`data-check="${c.check}"`), `the tab draws no check for ${c.key}`);
  ok(!/data-find/.test(html) && /data-act="finder"/.test(html), "the tab asks for no typing: the sheet is one press away");
  for (const c of checks.filter((x) => !x.lore)) ok(html.includes(`<span class="gph-skn">${c.name}</span>`), `the tab abbreviates ${c.name}: a skill is named whole`);
  ok(/<span class="gph-skn is-lore"><span>Warfare<\/span><small>Lore<\/small><\/span>/.test(html), "a Lore is its subject, with the word small on a second line");
  ok(/\.gph-cks \{[^}]*grid-auto-columns: minmax\(0, auto\)/.test(css) && /\.gph-skn \{[^}]*text-overflow: ellipsis/.test(css), "a column is as wide as its longest name, and only a deck with no room cuts one");
  ok(/\.gph-cks \{[^}]*grid-auto-flow: column[^}]*grid-template-rows: repeat\(3, 24px\)/.test(css), "the checks fill the pane three deep, in the sheet's order");
  ok(/@container gph \(max-width: \d+px\) \{\s*\.gph-cks \{[^}]*position: absolute[^}]*grid-auto-flow: row[^}]*grid-template-columns: repeat\(auto-fill/.test(css) && !/\.gph-cks \{[^}]*overflow/.test(css) && !/\.gph-ck\[data-rank="0"\] \{ (display: none|order)/.test(css), "a narrow deck cuts no name, hides no skill and scrolls none: the checks rise as a block");
  ok(/@media \(max-height: \d+px\) \{[^@]*\.gph-fk, \.gph-fa, \.gph-fab \{ height: 22px/.test(css) && /\.gph-finder \{[^}]*max-height: min\(820px, calc\(100vh - var\(--gph-h\) - 60px\)\)/.test(css), "a 900p screen holds the whole sheet: its lines close up and it may stand taller");
  ok(/\.gph-keys \{ display: none;/.test(css) && /@container gph \(min-width: \d+px\) \{[^@]*\.gph-keys \{ display: grid; \}/.test(css), "the action keys take only the room the names leave");
});

section("an attack-trait skill action can be rolled at every MAP step", () => {
  const m = STATES.martial(art);
  const attacks = SKILL_ACTIONS.filter((a) => a.attack).map((a) => a.slug);
  ok(attacks.includes("trip") && attacks.includes("grapple") && attacks.includes("escape"), "the catalogue marks the attack-trait actions");
  const f = finderOf(m);
  const sheet = V.FINDER(f, t);
  for (const r of f.rows) for (const a of r.actions.filter((x) => x.attack)) {
    for (const i of [0, 1, 2]) ok(new RegExp(`class="gph-ms" data-skill-action="${a.slug}" data-stat="${r.key}" data-variant="${i}" data-attack`).test(sheet), `the sheet draws no MAP step ${i} for ${a.slug} under ${r.key}`);
    ok(a.variants.length === 3 && a.variants[0] === (a.skill.mod >= 0 ? `+${a.skill.mod}` : `−${-a.skill.mod}`), `${a.slug}: the first step is the bare modifier`);
  }
  ok(!/class="gph-ms" data-skill-action="demoralize"/.test(sheet), "an action without the attack trait carries no steps");
  const deck = R.withSkills(m.deck, { ...m.sk, pins: ["trip"] }, { mode: m.mode, map: 2, t });
  const tab = V.SKILLTAB(deck.skills, t);
  ok([0, 1, 2].every((i) => new RegExp(`class="gph-ms" data-skill-action="trip" data-variant="${i}"`).test(tab)), "the tab's keys carry the same three steps");
  ok(/>\+15<\/button>.*>\+10<\/button>.*>\+5<\/button>/s.test(tab.slice(tab.indexOf('data-skill-action="trip" data-variant="0"') - 40)), "and print each step's own modifier, whatever the turn's MAP");
  const host = src["host.mjs"];
  ok(/this\.useSkillAction\(d\.skillAction, d\.variant != null \? \+d\.variant : undefined/.test(host) && /multipleAttackPenalty: mapArg\(map, a\.mapStep\)/.test(host) && /const mapArg = \(step, per\) => \(per == null \|\| per === 5 \|\| !step \? step : -per \* step\)/.test(host) && /const map = a\.attack \? \(variant \?\? this\.model\?\.turnbar\?\.map \?\? 0\) : 0/.test(host),
    "a step press hands PF2e that step; the name rolls at the turn's own");
  ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(sheet) && !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(tab), "no press is nested inside another");
  ok(/\.gph-ms \{[^}]*min-height: 18px[^}]*max-height: 18px/.test(css), "a MAP step states its own size");
  /* a press resolves its action from every action, not from what the sheet shows */
  const typed = K.finderModel({ ...m.sk, query: "treat wounds", mode: "encounter", map: 0, t }), bare = K.finderModel({ ...m.sk, query: "", mode: "encounter", map: 0, t }), every = K.finderModel({ ...m.sk, query: "", mode: "exploration", map: 0, t });
  ok(typed.actions.some((a) => a.slug === "treat-wounds") && !bare.actions.some((a) => a.slug === "treat-wounds") && every.actions.some((a) => a.slug === "treat-wounds") && /useSkillAction\([\s\S]{0,420}K\.finderModel\(\{ \.\.\.m\.sk, query: "", sel: 0, mode: "exploration"/.test(host), "an action found by typing in an encounter is still pressable: the host looks it up among every action");
  /* a rule that lowers a skill's penalty: PF2e's skill actions consult nothing, so it is honoured here */
  const stat = (domains) => ({ domains, createRollOptions: () => ["self:level:5"] });
  const rule = (penalty, pass = true) => ({ penalty, predicate: { test: () => pass } });
  const syn = (m) => ({ synthetics: { multipleAttackPenalties: m } });
  ok(R.mapStepOf({}, stat(["athletics"])) === 5 && R.mapStepOf(syn({}), stat(["athletics"])) === 5 && R.mapStepOf(syn({ attack: [rule(-3)] }), stat(["athletics", "skill-check"])) === 5, "by the book a step costs 5, and a rule written for Strikes is not read for a skill");
  ok(R.mapStepOf(syn({ athletics: [rule(-4), rule(-3, false)] }), stat(["athletics"])) === 4 && R.mapStepOf(syn({ athletics: [rule(-4)], "skill-check": [rule(-3)] }), stat(["athletics", "skill-check"])) === 3 && R.mapStepOf(syn({ athletics: [rule(-7), rule(2)] }), stat(["athletics"])) === 5, "a rule on the skill's own domain lowers it where its predicate holds; the mildest wins, and none makes it worse");
  const low = K.finderModel({ ...m.sk, skills: { ...m.sk.skills, athletics: { ...m.sk.skills.athletics, mapStep: 4 } }, query: "", mode: "encounter", map: 1, t });
  const trip4 = low.rows.find((r) => r.key === "athletics").actions.find((a) => a.slug === "trip");
  ok(trip4.variants.join() === "+15,+11,+7" && trip4.mapMod === 11 && trip4.mapStep === 4, `a lowered step is what the presses print (got ${trip4.variants.join()})`);
  const mapArg = new Function(`return ${host.match(/const mapArg = ([^;]+);/)[1]}`)();
  ok(mapArg(0, 4) === 0 && mapArg(1, 4) === -4 && mapArg(2, 4) === -8 && mapArg(2, undefined) === 2 && mapArg(1, 5) === 1, "and what PF2e is handed: the step by the book, the penalty itself where a rule lowered it");
});

const g2skills = () => { const g = STATES.gm(art); const b = V.STATBLOCK(g.creature, t); return g.creature.stat.skills.every((k) => b.includes(`class="gph-sk" data-check="${k.check}"`)); };
section("the GM reads the party's checks, rolls one in secret and calls for one", () => {
  const art = (p) => p;
  const party = PARTY_ACTORS(art);
  const p = C.partyChecks(party, { name: checkNameOf });
  ok(p.rows.length === 20 && p.rows[0].check === "perception" && p.rows.slice(1, 4).map((x) => x.check).join() === "fortitude,reflex,will" && p.rows.slice(4).every((x) => x.check.startsWith("skill:")) && p.rows.every((x) => x.cells.length === party.length), "the grid is Perception, the saves and the sixteen skills, a cell per character");
  const ath = p.rows.find((x) => x.check === "skill:athletics"), perf = p.rows.find((x) => x.check === "skill:performance");
  ok(ath.cells.filter((c) => c.best).map((c) => c.id).join() === "valeros" && perf.cells.filter((c) => c.best).length === 2, "the best modifier in a row is marked, every holder of it on a tie");
  ok(!C.partyChecks(party.slice(0, 1), { name: checkNameOf }).rows.some((x) => x.cells.some((c) => c.best)), "a row where everybody is equal marks nobody");
  const html = V.PARTYCHECKS(p, t);
  ok(p.rows.every((x) => html.includes(`data-call="${x.check}"`) && x.cells.every((c) => html.includes(`data-pcheck="${x.check}" data-actor="${c.id}"`))), "every row's name calls for the check, every number rolls it for that character");
  ok(p.rows.every((x) => html.includes(`<span>${x.name}</span>`)), "every check is named whole");
  /* a call */
  const call = C.makeCall({ check: "skill:athletics", dc: "20", showDc: false, id: "c1", at: 1000 });
  ok(call && !("dc" in call) && C.makeCall({ check: "skill:athletics", dc: "20", showDc: true, id: "c1", at: 1000 }).dc === 20, "the DC leaves the GM's screen only when the GM shows it");
  ok(C.makeCall({ check: "skill:athletics\" onclick=", id: "x", at: 0 }) === null && C.makeCall({ check: "strike:0", id: "x", at: 0 }) === null, "a call names one of the checks the grid rolls and nothing else");
  ok(C.readCall(call, { fromGM: false, now: 0 }) === null && C.readCall({ ...call, sender: "gm", isGM: true }, { fromGM: false, now: 0 }) === null, "a call from anyone the server does not name a GM is nothing, whatever the payload says");
  ok(C.readCall({ type: "call", id: "x", check: "skill:nonsense" }, { fromGM: true }) === null && C.readCall({ type: "call", id: 5, check: "perception" }, { fromGM: true }) === null && C.readCall(null, { fromGM: true }) === null && C.readCall({ type: "call", id: "x", check: "perception", dc: "<b>" }, { fromGM: true, now: 0 }).dc === undefined, "the reader is total: a malformed call is nothing, a malformed DC is no DC");
  const got = C.readCall({ ...call, dc: 22, extra: "<img>" }, { fromGM: true, now: 5000 });
  ok(Object.keys(got).sort().join() === "check,dc,id,until" && got.until === 5000 + C.CALL_LIFE, "a call keeps its id, its check, its DC and its hour, and nothing else of the payload");
  const who = party[0].actor;
  const cm = C.callModel(got, who, { name: checkNameOf, now: 6000 });
  ok(cm && cm.name === "Athletics" && cm.mod === 15 && cm.dc === 22 && C.callModel(got, who, { name: checkNameOf, now: got.until }) === null && C.callModel(got, {}, { name: checkNameOf, now: 6000 }) === null, "the rail draws a live call for a character who has the statistic, and none once it has run out");
  const bar = V.CALLBAR(cm, t);
  ok(/data-check="skill:athletics" data-answer="c1"/.test(bar) && /<b>Athletics<\/b><em>\+15<\/em><i>DC 22<\/i>/.test(bar) && /data-act="call-dismiss"/.test(bar) && !/DC/.test(V.CALLBAR({ ...cm, dc: undefined }, t)), "a call is one press: the check named whole, the character's modifier, the DC only where shown");
  ok(V.RAIL({ ...STATES.martial(art), call: cm }, t).includes('class="gph-call"') && !V.RAIL({ ...STATES.gm(art), call: cm }, t).includes('class="gph-call"') && !V.RAIL(STATES.martial(art), t).includes("gph-call"), "the call stands on a player's rail, never the GM's, and only while there is one");
  ok(V.RAIL(STATES.gm(art), t).includes('data-drawer="party"') && !V.RAIL(STATES.martial(art), t).includes('data-drawer="party"') && DRAWER_BODIES.party(V, t, art, STATES.martial(art)) === null, "the party's checks open from the GM's stack and from nowhere else");
  ok(C.readCall({ type: "end", id: "c1" }, { fromGM: true }).end === "c1" && C.readCall({ type: "end", id: "c1" }, { fromGM: false }) === null, "only a GM takes a call back");
  /* answers */
  const out = { ...call };
  ok(C.answersCall(out, { actorId: "valeros", ctx: { type: "skill-check", domains: ["athletics", "skill-check"] }, at: 2000 }) && !C.answersCall(out, { actorId: "valeros", ctx: { type: "skill-check", domains: ["acrobatics"] }, at: 2000 })
    && !C.answersCall(out, { actorId: "valeros", ctx: { type: "skill-check", domains: ["athletics"] }, at: 500 }) && !C.answersCall(out, { actorId: null, ctx: { type: "skill-check", domains: ["athletics"] }, at: 2000 })
    && C.answersCall({ check: "will", at: 0 }, { actorId: "a", ctx: { type: "saving-throw", domains: ["will"] }, at: 1 }) && C.answersCall({ check: "perception", at: 0 }, { actorId: "a", ctx: { type: "perception-check", domains: ["perception"] }, at: 1 }),
    "an answer is the called check, by a character, after the call");
  const lit = V.PARTYCHECKS(p, t, { dc: "20", showDc: true, call: { check: "skill:athletics", name: "Athletics", answered: ["valeros"] } });
  ok(/class="is-called"/.test(lit) && /gph-pc-cell is-best is-in" data-pcheck="skill:athletics" data-actor="valeros"/.test(lit) && (lit.match(/ is-in"/g) ?? []).length === 1 && /data-act="call-end"/.test(lit) && /1 of 4 rolled/.test(lit), "a standing call lights its row, marks who has rolled and can be ended");
  /* the host */
  const h = src["host.mjs"];
  ok(/onCall\(payload, attested\) \{\s*if \(game\.user\.isGM \|\| this\.stream\) return;\s*const call = readCall\(payload, \{ fromGM: !!\(attested && game\.users\.get\(attested\)\?\.isGM\)/.test(h) && /onSocket\(FEATURE_ID, \(payload, _claimed, meta\) => this\.onCall\(payload, meta\?\.attested \?\? null\)\)/.test(h), "the host honours a call only from the server-attested sender, and never on the stream login");
  ok(/sendCall\(check\) \{\s*if \(!game\.user\.isGM\) return;\s*const users = game\.users\.filter\(\(u\) => u\.active && !u\.isGM\)/.test(h), "a call goes to the connected players alone (the stream login holds GM rights)");
  ok(/secretCheck\(check, actorId\) \{\s*if \(!game\.user\.isGM\) return;[\s\S]{0,200}roll\(\{ messageMode: "gm"/.test(h) && !/secretCheck[\s\S]{0,300}roll\(\{[^}]*event/.test(h), "a secret check is PF2e's GM-only message, with no event to turn it public");
  ok(/if \(kind === "party"\) \{\s*if \(!game\.user\.isGM\) return null;/.test(h), "the party drawer is the GM's");
  ok(!/setFlag|settings\.set\([^)]*call/i.test(src["calls.mjs"]) && !/\b(game|canvas|foundry|ui|Hooks|document|window)\b\./.test(src["calls.mjs"].replace(/\/\*[\s\S]*?\*\//g, "")), "calls.mjs is pure, and a call is stored nowhere");
  ok(/@container gph \(max-width: \d+px\) \{ \.gph-call,/.test(css) && /\.gph-pc-cell \{[^}]*height: 22px; min-height: 22px; max-height: 22px/.test(css) && /\.gph-pcb \{[^}]*height: 24px; min-height: 24px; max-height: 24px/.test(css) && /\.gph-call-roll \{[^}]*height: 34px; min-height: 34px/.test(css), "every new press states its own size, and the call steps over a narrow deck's checks");
});

section("the GM reads a creature's passives without opening anything", () => {
  const withStat = () => {
    const a = ogre();
    a.system.attributes.immunities = [{ type: "fear", label: "fear" }];
    a.system.attributes.weaknesses = [{ type: "cold-iron", value: 5 }];
    a.system.attributes.resistances = [{ type: "physical", value: 3, label: "physical 3 (except bludgeoning)" }];
    a.system.perception = { ...(a.system.perception ?? {}), senses: [{ type: "scent", label: "Scent (imprecise) 30 ft" }] };
    a.system.movement = { speeds: { land: { value: 25 }, climb: { value: 15 }, fly: { value: 0 } } };
    a.system.details.languages = { value: ["jotun", "common"] };
    a.itemTypes.action.push(item("n3", "Thick Hide", "action", { actionType: { value: "passive" }, description: { value: "<p>Reduce physical damage by 3. @Check[fortitude|dc:18]</p>" } }));
    return a;
  };
  const a = withStat();
  const s = R.statOf(a, { t, loc, config: {} });
  ok(s.iwr.map((x) => `${x.k}:${x.text}`).join("|") === "immune:fear|weak:Cold iron 5|resist:physical 3 (except bludgeoning)", `immunities, weaknesses and resistances, in PF2e's own words (got ${s.iwr.map((x) => `${x.k}:${x.text}`).join("|")})`);
  ok(s.passives.map((p) => p.id).join() === "n3", "the passives are the abilities with no action to take; a reaction or an action is a move already, and is not drawn twice");
  ok(s.passives[0].text === "Reduce physical damage by 3. Fortitude DC 18", `a passive's text is read plain, inline syntax resolved (got ${s.passives[0].text})`);
  ok(s.skills.map((k) => `${k.check}:${k.mod}`).join() === "skill:athletics:14,skill:intimidation:10", `the skills the stat block lists, each a check (got ${s.skills.map((k) => `${k.check}:${k.mod}`).join()})`);
  ok(g2skills(), "the stat block draws each listed skill as a press");
  ok(s.senses.join() === "Scent (imprecise) 30 ft" && s.speeds.length === 2 && s.languages.length === 2, "senses, the speeds it has, languages");
  const c = R.creatureOf(a, { t, loc, config: {}, formulas: new Map() });
  ok(c.stat && c.stat.iwr.length === 3, "the creature's model carries its stat block");
  const g = STATES.gm(art);
  const rail = V.RAIL(g, t);
  ok(/data-statbar/.test(rail) && rail.indexOf("data-statbar") < rail.indexOf("gph-npc"), "the stat bar is drawn with the creature panel, always");
  for (const p of g.creature.stat.passives) ok(rail.includes(`class="gph-pas" data-action="${p.id}"`), `the bar draws no press for the passive ${p.name}`);
  ok(/data-iwr="weak"/.test(rail) && /data-iwr="immune"/.test(rail) && /data-iwr="resist"/.test(rail) && /data-drawer="statblock"/.test(rail), "what changes the damage, and the way to the whole block");
  ok(!/data-statbar/.test(V.RAIL(STATES.martial(art), t)) && !/data-statbar/.test(V.RAIL(STATES.hazard(art), t)), "a player's rail and a hazard draw no stat bar");
  const block = V.STATBLOCK(g.creature, t);
  ok(g.creature.stat.passives.every((p) => block.includes(p.text.slice(0, 30).replace(/&/g, "&amp;"))) && /Jotun/.test(block) && /Climb/.test(block), "the drawer has each passive's text, the speeds and the languages");
  ok(/V\.STATBLOCK\(m\.creature, t\)/.test(src["host.mjs"]), "the host builds the stat block drawer");
  const host = src["host.mjs"];
  ok(/this\.open\.drawer === "statblock" && model\.creature/.test(host) && /STAYS = new Set\(\["statblock", "party"\]\)/.test(host) && /!STAYS\.has\(this\.open\.drawer\)\) \{ this\.open\.drawer = null; this\.render\(\); \}/.test(host) && /if \(!STAYS\.has\(this\.open\.drawer\)\) this\.open\.drawer = null;/.test(host),
    "the stat block stays open from creature to creature, and through a press on the canvas");
  ok(/\.gph-sb-run \{[^}]*flex-wrap: wrap[^}]*max-height: 52px/.test(css), "the bar takes two lines before anything is cut");
});

/* ══ the dice ══════════════════════════════════════════════════════════ */

{
  const before = problems.length;
  const { diceSettled, hasDice } = await import("../scripts/core/dice-wait.mjs");
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  /* Dice So Nice as it behaves: it marks the message animating in its own
     createChatMessage hook, which may run after ours in the same dispatch. */
  const board = () => {
    const b = { animating: false, release: null, asked: 0 };
    b.waitFor3DAnimationByMessageID = () => { b.asked++; return b.animating ? new Promise((r) => { b.release = r; }) : Promise.resolve(true); };
    return b;
  };
  const msg = { id: "m1", rolls: [{ total: 17 }] };
  {
    const b = board(); let done = false;
    const p = diceSettled(msg, { dice3d: b, timeout: 500 }).then(() => { done = true; });
    ok(b.asked === 0, "the dice wait does not ask in the hook itself");
    b.animating = true;
    await tick(30);
    ok(b.asked === 1 && !done, "the dice wait asks only after Dice So Nice has marked the message, and holds while the dice roll");
    b.release?.(true); await p;
    ok(done, "and lets go when they land");
  }
  {
    const b = board(); b.animating = true; const at = Date.now();
    await diceSettled(msg, { dice3d: b, timeout: 60 });
    ok(Date.now() - at >= 50 && Date.now() - at < 400, "a completion signal that never comes ends at the timeout, never in silence");
  }
  {
    const b = board(); b.animating = true;
    await diceSettled({ id: "m2", rolls: [] }, { dice3d: b, timeout: 5000 });
    await diceSettled(msg, { dice3d: null, timeout: 5000 });
    await diceSettled(msg, { dice3d: { waitFor3DAnimationByMessageID: () => { throw new Error("x"); } }, timeout: 5000 });
    ok(b.asked === 0 && !hasDice({ rolls: [] }) && hasDice(msg), "a message with no roll, a world with no Dice So Nice and a board that throws do not wait");
  }
  const host = src["host.mjs"];
  const on = host.slice(host.indexOf("  onMessage(message) {"), host.indexOf("  /** The press a Hero Point spent now streaks to"));
  ok(/diceSettled\(message\)\.then\(/.test(on) && on.indexOf("diceSettled(message)") < on.indexOf("D.echo(b, e)") && !/D\.echo\(b, e\)/.test(on.slice(0, on.indexOf("diceSettled(message)"))), "the echo prints only after the dice have landed");
  ok(on.indexOf("this.pending = null") < on.indexOf("diceSettled(message)"), "the press is matched at once, while it is still the pending one");
  ok(/this\.root\?\.querySelector\(p\.sel\)/.test(on.slice(on.indexOf("diceSettled(message)"))), "the button is looked up after the wait: the rail may have been redrawn");
  for (const [file, what] of [["scripts/features/pf2e-variant-rules/chip.mjs", "chip damage"], ["scripts/features/pf2e-odds/observe.mjs", "the odds ledger"], ["scripts/features/critical/module.js", "the critical cut-in"]]) {
    ok(/from "\.\.\/\.\.\/core\/dice-wait\.mjs"/.test(read(file)) && /diceSettled\(message/.test(read(file)), `${what} waits for the dice through core/dice-wait.mjs`);
  }
  console.log(`${problems.length === before ? "✓" : "✗"} a result is shown only after the dice have landed`);
}

console.log(problems.length ? `\n${problems.length} problem(s):\n  ${problems.join("\n  ")}` : `\nall ${passed} checks passed`);
process.exit(problems.length ? 1 : 0);
