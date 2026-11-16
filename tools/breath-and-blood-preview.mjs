#!/usr/bin/env node
/**
 * Breath and Blood — a browser-backed look at every surface.
 *
 * Every frame is drawn by the shipped pure views (`views.mjs`), localised from
 * the shipped language file, under the shipped stylesheets. The numbers come
 * from the shipped rules (`rules.mjs`), so a refusal shown on a disabled
 * button is the rules' own reason. The panel lands on a pf2e sheet (16px host,
 * parchment and dark), the chat card in a 14px chat log.
 *
 * Usage: node tools/breath-and-blood-preview.mjs [--out=.preview/breath-and-blood.html]
 *        node tools/preview-server.mjs 8962
 *        /.preview/breath-and-blood.html            every frame
 *        /.preview/breath-and-blood.html?only=rest   one frame
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/breath-and-blood.html");

const mod = (p) => import(pathToFileURL(join(ROOT, p)).href);
const R = await mod("scripts/features/breath-and-blood/rules.mjs");
const V = await mod("scripts/features/breath-and-blood/views.mjs");
const { healCard } = await mod("scripts/features/breath-and-blood/damage.mjs");

const LANG = JSON.parse(readFileSync(join(ROOT, "lang/breath-and-blood.en.json"), "utf8"));
const t = (key, data) => {
  const s = key.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), LANG);
  const str = typeof s === "string" ? s : `⟦${key}⟧`;
  return data ? str.replace(/\{(\w+)\}/g, (m, k) => (k in data ? String(data[k]) : m)) : str;
};

/* ── Models, from the rules ──────────────────────────────────────────────── */

const fighter = R.makePools({ sp: 12, hp: 26, rp: 3, wounded: 1, caughtBreath: true });
const gm = (role = "twoPools", type = "character") => ({
  roles: type === "character" ? ["twoPools", "companion", "rival", "onePool"] : ["onePool", "companion", "rival"],
  canShare: true,
  sharesOptions: [
    { id: "a", name: "Amiri", selected: false },
    { id: "b", name: "Seoni", selected: false },
  ],
});

function panel(s, { isGM = false, name = "Valeros", feats = {}, target = null, role = "twoPools" } = {}) {
  const actions = [{ id: "catch", reason: R.catchRefusal(s) }];
  if (feats.steel) actions.push({ id: "steel", reason: feats.steelUsed ? "steelUsed" : R.catchRefusal(s, { free: true }) });
  actions.push({ id: "bind", reason: R.bindRefusal(s) });
  if (s.dying > 0) actions.push({ id: "holdOn", reason: s.rp < 1 ? "noRP" : null });
  if (!s.companion) actions.push({ id: "lend", reason: target ? R.lendRefusal(s, target) : "noTarget" });
  if (feats.words) actions.push({ id: "words", reason: target ? R.wordsRefusal(target) : "noTarget" });
  if (feats.medicine) actions.push({ id: "treat", reason: null });
  if (feats.battle) actions.push({ id: "battle", reason: null });
  actions.push({ id: "rest", reason: null });
  return {
    actorId: name,
    isGM,
    role,
    variantOn: true,
    twoPool: true,
    canEdit: true,
    shares: null,
    gm: gm(role),
    sp: { value: s.sp, max: s.maxSP },
    hp: { value: s.hp, max: s.maxHP, temp: s.temp },
    rp: { value: s.rp, max: s.maxRP },
    ticks: { caughtBreath: s.caughtBreath, strengthLent: s.strengthLent },
    ewImmune: s.ewImmune,
    fieldSurgeon: { has: !!feats.surgeon, used: !!feats.surgeonUsed },
    steel: { has: !!feats.steel, used: !!feats.steelUsed },
    declines: !!feats.declines,
    dying: s.dying,
    wounded: s.wounded,
    actions: actions.map((a) => ({ ...a, disabled: !!a.reason })),
  };
}

const ally = R.makePools({ rp: 1, sp: 30 });
const panelPlayer = panel(fighter, { feats: { medicine: true, battle: true, words: true, steel: true }, target: ally });
const panelGM = panel(R.makePools({ sp: 0, hp: 0, rp: 2, dying: 2, wounded: 1, unconscious: true }), { isGM: true, name: "Kyra" });
const companion = R.companionPools(71, { role: "companion" });
const panelCompanion = panel(R.makePools({ level: 7, ...companion, sp: 10, hp: 30, rp: 3, companion: true }), { isGM: true, name: "Wolf", role: "companion" });
const panelOne = { actorId: "goblin", isGM: true, role: "onePool", variantOn: true, twoPool: false, gm: gm("onePool", "npc") };
const panelOff = { actorId: "x", isGM: true, role: "twoPools", variantOn: false, twoPool: false, gm: gm() };

const restRow = (name, s, extra = {}) => ({
  id: name,
  name,
  picked: true,
  sp: s.sp,
  maxSP: s.maxSP,
  hp: s.hp,
  maxHP: s.maxHP,
  rp: s.rp,
  maxRP: s.maxRP,
  wounded: s.wounded,
  dying: s.dying,
  unconscious: s.unconscious,
  bind: false,
  bindRefusal: R.bindRefusal(s),
  canLend: !s.companion && s.rp >= 1,
  lendTo: "",
  lendTargets: [{ id: "Seoni", name: "Seoni" }, { id: "Kyra", name: "Kyra" }],
  night: "rest",
  ...extra,
});
const setup = {
  stamina: false,
  lasting: true,
  unfilled: 4,
  dials: [
    { key: "maxResolve", text: "4" },
    { key: "resolveByLevel", text: t("GLBAB.setup.no") },
    { key: "havens", text: t("GLBAB.setup.yes") },
    { key: "grimWounds", text: t("GLBAB.setup.no") },
    { key: "generousSupplies", text: t("GLBAB.setup.no") },
    { key: "recurringRivals", text: t("GLBAB.setup.no") },
    { key: "lingeringWounds", text: t("GLBAB.setup.no") },
    { key: "levelGroundDCs", text: `${t("GLBAB.settings.levelGroundDCs.choice.auto")} (${t("GLBAB.setup.yes")})` },
    { key: "healingPrompt", text: t("GLBAB.settings.healingPrompt.choice.unsure") },
    { key: "redirectSystemActions", text: t("GLBAB.setup.yes") },
  ],
};
const restModel = {
  isGM: true,
  tab: "rest",
  variantOn: true,
  nights: ["rest", "rough", "haven"],
  setup,
  actors: [
    restRow("Valeros", fighter, { bind: true }),
    restRow("Seoni", R.makePools({ level: 5, maxSP: 20, maxHP: 23, sp: 3, hp: 23, rp: 0 }), { night: "rough" }),
    restRow("Kyra", R.makePools({ sp: 0, hp: 0, rp: 2, wounded: 2, unconscious: true }), { lendTo: "" }),
    restRow("Wolf", R.makePools({ level: 7, ...companion, sp: 10, hp: 30, rp: 3, companion: true })),
  ],
};

const patient = (name, s, { declines = false, surgeon = false, cr = false, immune = false } = {}) => ({
  id: name,
  uuid: name,
  name,
  twoPool: true,
  hp: s.hp,
  maxHP: s.maxHP,
  rp: s.rp,
  maxRP: s.maxRP,
  declines,
  surgeon,
  minimum: R.minimum(s, cr ? R.FRACTION.half : R.FRACTION.quarter),
  unpaidReason: surgeon ? null : R.unpaidReason(s, { declines }),
  immune,
});
const treatModel = {
  kind: "treat",
  healers: [{ id: "k", name: "Kyra", selected: true }, { id: "s", name: "Seoni", selected: false }],
  dcs: R.treatChoices(3, { levelGround: true }).map((c) => ({ ...c, selected: c.rank === 2 })),
  rank: 2,
  assurance: { available: true, checked: false, result: R.assuranceResult(3, 7, { levelGround: true }) },
  surgeon: { has: true, used: false, available: true, options: [{ id: "Valeros", name: "Valeros", selected: false }, { id: "Amiri", name: "Amiri", selected: true }] },
  limit: R.wardMedicLimit(3, true),
  patients: [
    patient("Valeros", R.makePools({ hp: 10, rp: 2 }), { cr: true }),
    patient("Amiri", R.makePools({ hp: 12, rp: 0 }), { surgeon: true, cr: true }),
    patient("Merisiel", R.makePools({ hp: 20, rp: 3 }), { declines: true, cr: true }),
    patient("Seoni", R.makePools({ hp: 33, rp: 3 }), { cr: true }),
  ],
  canRun: true,
  refusal: null,
  refusalData: {},
};
const battleModel = {
  ...treatModel,
  kind: "battle",
  limit: 1,
  surgeon: { has: true, used: false, available: false, options: [] },
  patients: [patient("Valeros", R.makePools({ hp: 20, rp: 1 }), { immune: true })],
  canRun: false,
  refusal: "bmImmune",
};

const healModel = { name: "Valeros", amount: 14, kind: "spent", why: "infused", declines: false, minimum: 8, rp: 3, unpaidReason: null, repeating: false };
const healModel2 = { ...healModel, kind: "paid", why: "unknown", amount: 6, repeating: true };

const h = R.applyHealing(R.decide(R.makePools({ sp: 0, hp: 20 })).state, 5, R.KIND.paid);
const cards = [
  healCard({ name: "Valeros" }, { kind: "paid", why: "item", reason: null, rolled: 5, heal: h, rpSpent: 1 }),
  healCard({ name: "Valeros" }, { kind: "spent", why: "slot", reason: null, rolled: 40, heal: R.applyHealing(R.makePools({ sp: 0, hp: 20 }), 40, "spent"), rpSpent: 0 }),
  healCard({ name: "Kyra" }, { kind: "unpaid", why: "item", reason: "noRP", rolled: 19, heal: R.applyHealing(R.makePools({ hp: 0, rp: 0 }), 19, "unpaid"), rpSpent: 0 }),
  {
    title: { k: "GLBAB.card.medicine.treat", d: { healer: "Kyra" } },
    tone: "good",
    rows: [
      { lines: [{ k: "GLBAB.card.check", d: { degree: t("GLBAB.degree.success"), rolled: 19 } }] },
      { name: "Valeros", lines: [{ k: "GLBAB.card.restored", d: { hp: 13, sp: 0 } }, { k: "GLBAB.card.rpSpent", d: { rp: 1 } }] },
      { name: "Amiri", lines: [{ k: "GLBAB.card.restored", d: { hp: 19, sp: 0 } }, { k: "GLBAB.card.surgeon" }] },
      { name: "Merisiel", lines: [{ k: "GLBAB.unpaid.declined" }] },
    ],
    foot: null,
  },
  { title: { k: "GLBAB.card.breatherTitle", d: { name: "Kyra" } }, tone: "good", rows: [{ lines: [{ k: "GLBAB.card.woke" }, { k: "GLBAB.card.spRestored", d: { sp: 35, max: 35 } }, { k: "GLBAB.card.woundedStays", d: { value: 2 } }] }] },
  { title: { k: "GLBAB.card.nightTitle", d: { name: "Seoni" } }, tone: "info", rows: [{ lines: [{ k: "GLBAB.card.night.rough" }, { k: "GLBAB.card.nightRP", d: { rp: 2, max: 4 } }, { k: "GLBAB.card.woundedGone" }] }] },
];

/* ── Page ─────────────────────────────────────────────────────────────────── */

const frame = (id, title, body, { width = 640, host = "sheet", paper = false } = {}) => `
<section class="frame" data-frame="${id}">
  <h2>${title}</h2>
  <div class="host host-${host}${paper ? " paper" : ""}" style="width:${width}px">${body}</div>
</section>`;

const win = (title, body) => `<div class="application glbab glbab-window fake-window"><header class="window-header"><h1 class="window-title">${title}</h1></header><section class="window-content">${body}</section></div>`;

const frames = [
  frame("panel", "Sheet panel: player, parchment sheet", V.panelHTML(panelPlayer, t), { width: 560, paper: true }),
  frame("panel-dark", "Sheet panel: player, dark sheet", V.panelHTML(panelPlayer, t), { width: 560 }),
  frame("panel-gm", "Sheet panel: GM view, dying", V.panelHTML(panelGM, t), { width: 560, paper: true }),
  frame("panel-companion", "Sheet panel: NPC companion (GM)", V.panelHTML(panelCompanion, t), { width: 480, paper: true }),
  frame("panel-one", "Sheet panel: one pool (GM only)", V.panelHTML(panelOne, t), { width: 480, paper: true }),
  frame("panel-off", "Sheet panel: variant off (GM only)", V.panelHTML(panelOff, t), { width: 480, paper: true }),
  frame("rest", "Rest window", win(t("GLBAB.rest.title"), V.restHTML(restModel, t)), { width: 680, host: "desk" }),
  frame("setup", "Rest window: Setup tab", win(t("GLBAB.rest.title"), V.restHTML({ ...restModel, tab: "setup" }, t)), { width: 680, host: "desk" }),
  frame("treat", "Treat Wounds window (Level Ground DCs)", win(t("GLBAB.treat.title"), V.treatHTML(treatModel, t)), { width: 600, host: "desk" }),
  frame("battle", "Battle Medicine, patient immune", win(t("GLBAB.treat.title"), V.treatHTML(battleModel, t)), { width: 600, host: "desk" }),
  frame("heal", "Healing dialog: infused item", win(t("GLBAB.heal.title", { name: "Valeros" }), V.healDialogHTML(healModel, t)), { width: 420, host: "desk" }),
  frame("heal-repeat", "Healing dialog: fast healing, unknown source", win(t("GLBAB.heal.title", { name: "Valeros" }), V.healDialogHTML(healModel2, t)), { width: 420, host: "desk" }),
  frame("holdon", "Hold On dialog", win(t("GLBAB.holdOn.title", { name: "Kyra" }), V.holdOnDialogHTML({ name: "Kyra", dying: 2, rp: 2 }, t)), { width: 420, host: "desk" }),
  frame("chat", "Chat cards (14px chat log)", cards.map((c) => `<div class="msg">${V.chatCardHTML(c, t)}</div>`).join(""), { width: 300, host: "chat" }),
];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Breath and Blood preview</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../styles/gl-fonts.css">
<link rel="stylesheet" href="../styles/gl-tokens.css">
<link rel="stylesheet" href="../styles/gl-motion.css">
<link rel="stylesheet" href="../styles/breath-and-blood.css">
<style>
  body { margin: 0; padding: 24px; background: #23252d; color: #ddd; font: 14px system-ui, sans-serif; display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
  .frame h2 { font: 600 12px system-ui; color: #9aa; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; }
  .host { padding: 12px; }
  .host-sheet { font-size: 16px; background: #1f1d1b; }
  .host-sheet.paper { background: #e9dfcc; color: #222; }
  .host-desk { background: #3a3d48; padding: 0; }
  .host-chat { font-size: 14px; background: #dad5c8; color: #191813; display: flex; flex-direction: column; gap: 8px; }
  .fake-window { position: relative; box-shadow: 0 8px 30px #0008; }
  .fake-window .window-header { display: flex; align-items: center; height: 30px; padding: 0 10px; background: #0b0c10; color: #eee; }
  .fake-window .window-title { font: 600 13px system-ui; margin: 0; }
  .msg { background: #f3eee2; padding: 6px; border: 1px solid #b9b1a0; }
</style></head>
<body>
${frames.join("\n")}
<script>
  const only = new URLSearchParams(location.search).get("only");
  if (only) for (const f of document.querySelectorAll(".frame")) if (f.dataset.frame !== only) f.remove();
  // ?fonts=1 lists every text run under 11px (the suite floor), for headless --dump-dom.
  if (new URLSearchParams(location.search).get("fonts")) {
    const small = [];
    for (const el of document.querySelectorAll(".host *")) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (own && px < 11) small.push(px + "px " + el.className + " :: " + el.textContent.trim().slice(0, 40));
    }
    const pre = document.createElement("pre");
    pre.id = "fontcheck";
    pre.textContent = small.length ? small.join("\\n") : "fonts OK";
    document.body.prepend(pre);
  }
</script>
</body></html>`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
