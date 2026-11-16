#!/usr/bin/env node
/**
 * Level Ground — a browser-backed look at everything the feature draws.
 *
 * The page IMPORTS the shipped rules (rules.mjs), logic (logic.mjs) and markup
 * (view.mjs), reads the shipped lang file and links the shipped stylesheet, so
 * what you judge is what ships. Every number on it comes from the real rules
 * from plain inputs; nothing is typed into the markup by hand.
 *
 * What it shows:
 *   • the window at its real width (780px), one frame per tab: Threat with a
 *     reading, Break Away, Convert, Strip text, Setup with problems;
 *   • the Threat strip at the top of a combat tracker, one per band;
 *   • the Stripped marker on a sheet;
 *   • every chat card at a chat log's 14px, on PF2e's parchment and on a dark log.
 *
 * Serve it — a file:// page does not run its module script:
 *
 *   node tools/level-ground-preview.mjs && node tools/preview-server.mjs 8961
 *   → http://localhost:8961/.preview/level-ground.html   (?view=window|tracker|chat, &tab=threat|breakAway|convert|stripText|setup)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice("--out=".length) : ".preview/level-ground.html");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Level Ground — preview</title>
<!-- Foundry ships Font Awesome; the preview borrows the free build so the icons show. -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/level-ground.css">
<style>
  body { margin: 0; background: #16171c; color: #ddd; font-family: Signika, "Segoe UI", sans-serif; }
  .pv { padding: 24px 28px; display: flex; flex-direction: column; gap: 26px; }
  .pv h2 { margin: 0 0 10px; font: 700 11px/1 "Segoe UI", sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #8b8d99; }
  .row { display: flex; gap: 22px; flex-wrap: wrap; align-items: flex-start; }
  .cap { font: 12px/1.4 "Segoe UI", sans-serif; color: #8b8d99; margin-top: 6px; max-width: 320px; }
  /* A stand-in for Foundry's window frame. */
  .win { width: 780px; border: 1px solid #2a2b33; box-shadow: 0 12px 40px rgb(0 0 0 / .6); background: #000; }
  .win > header { padding: 7px 10px; font: 600 13px "Segoe UI", sans-serif; background: #15161c; border-bottom: 1px solid #2a2b33; color: #ddd; }
  .win .window-content { display: block; }
  /* A stand-in for Foundry's combat tracker sidebar. */
  .tracker { width: 300px; background: #0e0f13; border: 1px solid #2a2b33; padding: 2px 0 6px; font-size: 14px; }
  .tracker .combat-tracker { margin: 0; padding: 0; list-style: none; }
  .tracker .combat-tracker li { display: flex; gap: 8px; align-items: center; padding: 6px 10px; border-top: 1px solid #22232a; color: #ccc; }
  .tracker .combat-tracker li i { width: 26px; height: 26px; background: #2a2b33; }
  /* A stand-in for PF2e's chat log: 14px type, parchment cards. */
  .chat { width: 300px; font-size: 14px; display: flex; flex-direction: column; gap: 8px; }
  .msg { padding: 6px 8px 8px; background: #e9e3d2; color: #191813; border: 1px solid #7a6f5a; }
  .msg.dark { background: #23242b; color: #ddd; border-color: #3a3c46; }
  .msg header { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 4px; }
  .msg header small { font-weight: 400; opacity: .6; }
  /* A stand-in for an NPC sheet header. */
  .sheet { width: 420px; background: #e9e3d2; color: #191813; border: 1px solid #7a6f5a; padding: 8px; font-size: 16px; }
  .sheet h1 { margin: 6px 0 0; font: 700 22px Signika, sans-serif; }
</style></head>
<body><div class="pv">
  <section data-view="window"><h2>The window, at its real width</h2><div class="row" id="windows"></div></section>
  <section data-view="tracker"><h2>The Threat strip, top of the combat tracker</h2><div class="row" id="trackers"></div></section>
  <section data-view="sheet"><h2>A Stripped Solo's sheet</h2><div class="row" id="sheets"></div></section>
  <section data-view="chat"><h2>Chat cards, at a chat log's 14px</h2><div class="row">
    <div class="chat" id="chat-parchment"></div>
    <div class="chat" id="chat-dark"></div>
  </div></section>
</div>
<script type="module">
import { stripBlock } from "/scripts/features/level-ground/rules.mjs";
import { reading, convert, inlineCheck, breakAwayRow, RANKS } from "/scripts/features/level-ground/logic.mjs";
import { PWOL } from "/scripts/features/level-ground/constants.mjs";
import * as V from "/scripts/features/level-ground/view.mjs";

const EN = await (await fetch("/lang/level-ground.en.json")).json();
const t = (k, d) => {
  let s = EN[k] ?? ("⟦" + k + "⟧");
  if (d) for (const [key, v] of Object.entries(d)) s = s.replaceAll("{" + key + "}", String(v));
  return s;
};
const q = new URLSearchParams(location.search);
const only = q.get("view");
if (only) document.querySelectorAll("[data-view]").forEach((el) => { if (el.dataset.view !== only) el.remove(); });
const onlyTab = q.get("tab");

/* The window */
const pcs = [
  { name: "Seri", level: 8, maxHP: 92 },
  { name: "Ezren", level: 8, maxHP: 74 },
  { name: "Kyra", level: 8, maxHP: 101 },
  { name: "Valeros", level: 8, maxHP: 128 },
];
const rows = [
  { id: "a", name: "Warlord Krask", count: 1, level: 10, role: "solo", adjust: "", area: true, hazard: "", editable: false },
  { id: "b", name: "Goblin Commando", count: 4, level: 6, role: "mook", adjust: "", area: false, hazard: "", editable: false },
  { id: "c", name: "Lurking Assassin", count: 1, level: 8, role: "standard", adjust: "elite", area: false, hazard: "", hidden: true, editable: false },
  { id: "m1", name: "Spiked Pit", count: 1, level: 7, role: "standard", adjust: "", area: false, hazard: "simple", editable: true },
];
const party = { source: "combat", pcs, allies: [{ name: "Hireling", level: 4, mook: true }], area: true, casterLeads: false, casterGuess: true, manualText: "", hpText: "", alliesText: "" };
const r = reading(rows, party);
const perceived = reading(rows.filter((x) => !x.hidden), party);
const models = {
  threat: { tab: "threat", threat: { source: "combat", rows, party, reading: r, perceived, perceivedDiffers: perceived.pct !== r.pct, canAward: true } },
  breakAway: { tab: "breakAway", breakAway: { pursuerLevel: 10, pursuerName: "Warlord Krask", baseDC: breakAwayRow({ pursuerLevel: 10 }), canPost: true,
    rows: [
      { id: "1", name: "Seri", flee: true, skill: "acrobatics", faster: true, flies: false, ground: false, carrying: false, bonus: 0 },
      { id: "2", name: "Ezren", flee: true, skill: "deception", faster: true, flies: false, ground: true, carrying: false, bonus: 2 },
      { id: "3", name: "Kyra", flee: true, skill: "athletics", faster: true, flies: false, ground: false, carrying: true, bonus: 0 },
      { id: "4", name: "Valeros", flee: false, skill: "athletics", faster: false, flies: false, ground: false, carrying: false, bonus: 0 },
    ].map((x) => ({ ...x, dc: breakAwayRow({ pursuerLevel: 10, ...x }) })) } },
  convert: { tab: "convert", convert: { mode: "printed", value: 30, adjust: "hard", rarity: "common", minRank: "", statistic: "athletics", checkName: "Climb the sea wall", result: convert({ mode: "printed", value: 30, adjust: "hard" }) } },
  stripText: (() => {
    const text = "AC 17; Fort +11, Ref +6, Will +5; Perception +5; Athletics +12; Str +5; Melee ogre hook +12, Damage 1d10+7\\nItems arsenic (DC 18), manacles (DC 22), +1 chain mail; Frightful Presence 30 feet, DC 20";
    return { tab: "stripText", stripText: { level: 3, text, output: stripBlock(text, 3) } };
  })(),
  setup: { tab: "setup", setup: {
    pwol: { enabled: false, ok: false, modifiers: PWOL.modifiers.map(([key, want], i) => ({ key, rank: RANKS[i], value: i === 0 ? 0 : want, want, ok: i !== 0 })) },
    abp: { value: "noABP", ok: false },
    conflicts: [{ id: "flatfinder", title: "Flatfinder" }],
    levelProf: { count: 2, items: [{ actor: "Seri", item: "Untrained Improvisation" }, { actor: "Ezren", item: "Eclectic Skill" }] },
    unstripped: 14, flattened: 2, problems: true } },
};
const windows = document.getElementById("windows");
if (windows) {
  windows.innerHTML = Object.entries(models)
    .filter(([k]) => !onlyTab || k === onlyTab)
    .map(([k, m]) => '<div class="win gllvg-app"><header>' + t("GLLVG.window.title") + '</header><div class="window-content">' + V.windowHTML(m, { t }) + "</div></div>")
    .join("");
}

/* Tracker strips: one per band */
const fights = [
  { cap: "Below Trivial", opp: [{ count: 1, level: 2 }] },
  { cap: "Low", opp: [{ count: 1, level: 10 }] },
  { cap: "Moderate", opp: [{ count: 1, level: 9, role: "solo" }] },
  { cap: "Severe", opp: [{ count: 1, level: 9, role: "solo" }, { count: 4, level: 6, role: "mook" }] },
  { cap: "Extreme (Outclassed)", opp: [{ count: 1, level: 10, role: "solo" }] },
  { cap: "Beyond Extreme", opp: [{ count: 5, level: 10 }] },
];
const trackers = document.getElementById("trackers");
if (trackers) {
  trackers.innerHTML = fights.map((f) => {
    const rd = reading(f.opp.map((o, i) => ({ name: "c" + i, ...o })), { pcs, area: true });
    return '<div><div class="tracker">' + V.trackerStripHTML(rd, { t }) + '<ol class="combat-tracker"><li><i></i>Seri</li><li><i></i>Warlord Krask</li></ol></div><div class="cap">' + f.cap + " · " + rd.label + "</div></div>";
  }).join("");
}

/* Sheet marker */
const sheets = document.getElementById("sheets");
if (sheets) sheets.innerHTML = '<div class="sheet">' + V.sheetMarkerHTML({ stripped: { level: 10 }, role: "solo", canEdit: true }, { t }) + "<h1>Warlord Krask</h1></div>";

/* Chat */
const ba = breakAwayRow({ pursuerLevel: 10, faster: true });
const baGround = breakAwayRow({ pursuerLevel: 10, faster: true, ground: true });
const baCarry = breakAwayRow({ pursuerLevel: 10, faster: true, carrying: true });
const cards = [
  V.sizingUpCardHTML({ wordKey: perceived.wordKey, deadly: perceived.deadly }, { t }),
  V.checkRequestCardHTML({ name: "Climb the sea wall", dc: 20, rank: 3, inline: inlineCheck({ statistic: "athletics", dc: 20, rank: 3 }) }, { t }),
  V.breakAwayCardHTML({ pursuerLevel: 10, rows: [
    { actorId: "1", name: "Seri", skill: "acrobatics", dc: ba, inline: "@Check[acrobatics|dc:" + ba + "]" },
    { actorId: "2", name: "Ezren", skill: "deception", dc: baGround, bonus: 2, inline: "@Check[deception|dc:" + baGround + "]" },
    { actorId: "3", name: "Kyra", skill: "athletics", dc: baCarry, inline: "@Check[athletics|dc:" + baCarry + "]" },
  ], results: { "1": { result: "escape", total: 21 }, "2": { result: "pursued", total: 13 } } }, { t }),
  V.massiveCardHTML({ name: "Valeros", actorUuid: "Actor.x", normal: 2, critical: 3, wounded: 0 }, { t }),
  V.tempoCardHTML({ name: "Warlord Krask", after: "Seri", used: false, lost: false, combatId: "c", combatantId: "d" }, { t }),
  V.unbowedCardHTML({ name: "Warlord Krask", actorUuid: "Actor.x", inTurn: false, ended: ["Clumsy 1"], entries: [
    { id: "e1", name: "Frightened 2", when: { k: "turns", n: 2 } },
    { id: "e2", name: "Slowed 1", when: { k: "thisTurn", n: 0 } },
    { id: "e3", name: "Off-Guard", exempt: true, when: { k: "exempt", n: 0 } },
  ] }, { t }),
  V.assuranceCardHTML({ name: "Kyra", reason: "breakAway" }, { t }),
  V.xpCardHTML({ band: r.band, rows: r.xpByPC.map((x) => ({ name: x.name, xp: x.xp })) }, { t }),
];
const msg = (body, dark) => '<div class="msg' + (dark ? " dark" : "") + '"><header>Level Ground<small>now</small></header><div class="message-content">' + body + "</div></div>";
const cp = document.getElementById("chat-parchment");
const cd = document.getElementById("chat-dark");
if (cp) cp.innerHTML = cards.map((c) => msg(c, false)).join("");
if (cd) cd.innerHTML = cards.map((c) => msg(c, true)).join("");

document.body.dataset.ready = "1";
</script></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
