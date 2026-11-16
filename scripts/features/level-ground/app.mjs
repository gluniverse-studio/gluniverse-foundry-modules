/**
 * Level Ground — the GM window: Threat, Break Away, Convert, Strip text, Setup.
 *
 * The markup is `windowHTML` (view.mjs) from a model built here; the class is
 * built in a memoised factory, never at module scope, so the modules the check
 * tool imports never touch `foundry.applications` under plain Node.
 *
 * The worksheet's manual rows, source and party toggles are a client setting
 * (`lvg.worksheet`), so a GM preparing a location keeps them across reloads.
 * The rest of the window's state lives for the session.
 */

import { SETTINGS, SUITE_ID, FLAGS, TABS, flagPath } from "./constants.mjs";
import {
  OPT,
  breakAwayRow,
  clampBonus,
  convert,
  inlineCheck,
  reading,
} from "./logic.mjs";
import { stripBlock } from "./rules.mjs";
import { windowHTML } from "./view.mjs";
import {
  combatWorksheet,
  isCaster,
  partyPCs,
  pcEntry,
  participants,
  printedLevel,
  rowFromActor,
  viewedCombat,
} from "./world.mjs";
import { setupModel, fixAbp, fixPwol } from "./setup.mjs";
import { fixLevelProf, stripAll } from "./actors.mjs";
import { postBreakAway, postCheckRequest, postSizingUp, postXPCard } from "./chat.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const randomId = () => foundry.utils.randomID(8);

/* ── Session state ────────────────────────────────────────────────────── */

const session = {
  tab: "threat",
  convert: { mode: "printed", value: 20, spellRank: 1, adjust: "none", rarity: "common", minRank: "", statistic: "athletics", checkName: "" },
  stripText: {
    level: 3,
    text: "AC 17; Fort +11, Ref +6, Will +5; Perception +5; Athletics +12; Str +5; Melee ogre hook +12, Damage 1d10+7",
  },
  breakAway: { pursuerLevel: null, rows: {} },
};

function readWorksheet() {
  let ws = {};
  try {
    ws = game.settings.get(SUITE_ID, SETTINGS.worksheet) ?? {};
  } catch {
    ws = {};
  }
  return {
    source: ["combat", "selected", "manual"].includes(ws.source) ? ws.source : "combat",
    manualRows: Array.isArray(ws.manualRows) ? ws.manualRows : [],
    party: { area: true, casterLeads: null, manualText: "", hpText: "", alliesText: "", ...(ws.party ?? {}) },
  };
}

async function writeWorksheet(ws) {
  try {
    await game.settings.set(SUITE_ID, SETTINGS.worksheet, ws);
  } catch (error) {
    console.warn("GLUniverse Suite | level-ground: could not save the worksheet", error);
  }
}

/* ── Models ───────────────────────────────────────────────────────────── */

const parseLevels = (text) =>
  String(text ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function parseAllies(text) {
  return parseLevels(text)
    .map((s) => {
      const m = /^(-?\d+)(m)?$/i.exec(s);
      return m ? { name: s, level: Number(m[1]), mook: !!m[2] } : null;
    })
    .filter(Boolean);
}

function selectedRows() {
  const tokens = globalThis.canvas?.tokens?.controlled ?? [];
  return tokens
    .filter((tk) => tk.actor && (tk.actor.type === "npc" || tk.actor.type === "hazard"))
    .map((tk) => rowFromActor(tk.actor, { id: tk.document?.id ?? tk.id, name: tk.document?.name ?? tk.name, hidden: tk.document?.hidden }));
}

function threatModel() {
  const ws = readWorksheet();
  const combat = viewedCombat();
  let rows = [];
  let sourceNote = null;
  let worldAllies = [];
  if (ws.source === "combat") {
    if (!combat) sourceNote = "GLLVG.threat.noCombat";
    else {
      const w = combatWorksheet(combat);
      rows = w.rows;
      worldAllies = w.party.allies;
    }
  } else if (ws.source === "selected") {
    rows = selectedRows();
    if (!rows.length) sourceNote = "GLLVG.threat.noSelection";
  }
  const manual = ws.manualRows.map((r) => ({ ...r, editable: true }));
  rows = [...rows, ...manual];

  const world = ws.source === "manual" ? { source: "manual", actors: [] } : partyPCs(combat);
  let pcs = world.actors.map(pcEntry);
  let partySource = world.source;
  const manualLevels = parseLevels(ws.party.manualText).map(Number).filter(Number.isFinite);
  if (!pcs.length) {
    partySource = "manual";
    const hp = Number(ws.party.hpText);
    const lowest = manualLevels.length ? Math.min(...manualLevels) : null;
    let given = false;
    pcs = manualLevels.map((level, i) => {
      const takesHP = !given && level === lowest && Number.isFinite(hp) && hp > 0;
      if (takesHP) given = true;
      return { name: t("GLLVG.threat.pcN", { n: i + 1 }), level, maxHP: takesHP ? hp : null };
    });
  }
  const top = world.actors.slice().sort((a, b) => (printedLevel(b) ?? 0) - (printedLevel(a) ?? 0))[0];
  const casterGuess = ws.party.casterLeads === null || ws.party.casterLeads === undefined;
  const casterLeads = casterGuess ? (top ? isCaster(top) : false) : !!ws.party.casterLeads;
  const allies = [...worldAllies, ...parseAllies(ws.party.alliesText)];
  const party = { pcs, allies, area: ws.party.area !== false, casterLeads };
  const full = reading(rows, party);
  const perceived = reading(rows.filter((r) => !r.hidden), party);
  return {
    source: ws.source,
    sourceNote,
    rows,
    party: {
      source: partySource,
      pcs,
      manualText: ws.party.manualText,
      hpText: ws.party.hpText,
      alliesText: ws.party.alliesText,
      allies: worldAllies,
      area: party.area,
      casterLeads,
      casterGuess,
    },
    reading: full,
    perceived,
    perceivedDiffers: !!full && !!perceived && perceived.label !== full.label,
    canAward: partySource !== "manual" && pcs.length > 0,
    _actors: world.actors,
  };
}

function breakAwayModel() {
  const combat = viewedCombat();
  const { threats } = participants(combat);
  const top = threats
    .map(({ actor }) => actor)
    .sort((a, b) => (printedLevel(b) ?? -99) - (printedLevel(a) ?? -99))[0];
  const level = Number.isFinite(session.breakAway.pursuerLevel) ? session.breakAway.pursuerLevel : printedLevel(top);
  const { actors } = partyPCs(combat);
  const rows = actors.map((actor) => {
    const s = session.breakAway.rows[actor.id] ?? {};
    const row = {
      id: actor.id,
      name: actor.name,
      flee: s.flee !== false,
      skill: s.skill ?? "athletics",
      faster: !!s.faster,
      flies: !!s.flies,
      ground: !!s.ground,
      carrying: !!s.carrying,
      bonus: clampBonus(s.bonus),
    };
    row.dc = Number.isFinite(level) ? breakAwayRow({ pursuerLevel: level, ...row }) : null;
    return row;
  });
  return {
    pursuerLevel: Number.isFinite(level) ? level : null,
    pursuerName: !Number.isFinite(session.breakAway.pursuerLevel) && top ? top.name : null,
    baseDC: Number.isFinite(level) ? breakAwayRow({ pursuerLevel: level }) : null,
    rows,
    canPost: Number.isFinite(level) && rows.some((r) => r.flee),
  };
}

function convertModel() {
  const c = session.convert;
  const result = convert({
    mode: c.mode,
    value: c.mode === "spell" ? c.spellRank : c.value,
    spellRank: c.spellRank,
    adjust: c.adjust,
    rarity: c.rarity,
    minRank: c.minRank === "" ? null : Number(c.minRank),
  });
  return { ...c, result };
}

function stripTextModel() {
  const s = session.stripText;
  const level = Number(s.level);
  return { ...s, output: Number.isFinite(level) && s.text ? stripBlock(s.text, level) : "" };
}

function windowModel() {
  const setup = setupModel();
  return {
    tab: session.tab,
    threat: session.tab === "threat" ? threatModel() : null,
    breakAway: session.tab === "breakAway" ? breakAwayModel() : null,
    convert: session.tab === "convert" ? convertModel() : null,
    stripText: session.tab === "stripText" ? stripTextModel() : null,
    setup,
  };
}

/* ── Actions ──────────────────────────────────────────────────────────── */

async function awardXP() {
  const m = threatModel();
  const r = m.reading;
  if (!r || !m.canAward) return;
  const actors = m._actors;
  const rows = actors.map((a) => {
    const level = printedLevel(a) ?? 1;
    const xp = level < r.partyLevel ? 2 * r.xp : r.xp;
    return { actor: a, name: a.name, xp };
  });
  const DialogV2 = foundry.applications.api.DialogV2;
  const ok = await DialogV2.confirm({
    window: { title: t("GLLVG.threat.awardXP") },
    content: `<p>${t("GLLVG.threat.awardConfirm", { band: t(`GLLVG.band.${r.band}`), list: rows.map((x) => `${x.name} +${x.xp}`).join(", ") })}</p>`,
    rejectClose: false,
  });
  if (!ok) return;
  for (const row of rows) {
    if (!row.xp) continue;
    const now = Number(row.actor.system?.details?.xp?.value ?? 0);
    await row.actor.update({ "system.details.xp.value": now + row.xp });
  }
  await postXPCard({ band: r.band, rows: rows.map(({ name, xp }) => ({ name, xp })) });
}

async function postBreakAwayCard() {
  const m = breakAwayModel();
  if (!m.canPost) return;
  const key = randomId().toLowerCase();
  const rows = m.rows
    .filter((r) => r.flee && Number.isFinite(r.dc))
    .map((r) => ({
      actorId: r.id,
      name: r.name,
      skill: r.skill,
      dc: r.dc,
      bonus: r.bonus,
      inline: inlineCheck({
        statistic: r.skill,
        dc: r.dc,
        options: [OPT.breakAway, `${OPT.breakAwayKey}${key}`, r.bonus ? `${OPT.breakAwayBonus}${r.bonus}` : null],
        name: t("GLLVG.breakAway.checkName"),
      }),
    }));
  await postBreakAway({ key, pursuerLevel: m.pursuerLevel, rows, results: {} });
}

async function postCheck() {
  const m = convertModel();
  const r = m.result;
  if (!r) return;
  const level = m.mode === "level" ? Number(m.value) : m.mode === "spell" ? 2 * Number(m.spellRank) - 1 : null;
  const inline = inlineCheck({
    statistic: m.statistic,
    dc: r.dc,
    rank: r.rank,
    options: Number.isFinite(level) ? [`${OPT.dcLevel}${level}`] : [],
    name: m.checkName || null,
  });
  if (!inline) return;
  await postCheckRequest({ name: m.checkName || null, dc: r.dc, rank: r.rank, inline });
}

async function postSizing() {
  const r = threatModel().perceived;
  if (!r) return;
  await postSizingUp({ wordKey: r.wordKey, deadly: r.deadly });
}

/* ── The class ────────────────────────────────────────────────────────── */

let _cls = null;
let _app = null;

function appClass() {
  if (_cls) return _cls;
  const { ApplicationV2 } = foundry.applications.api;
  _cls = class LevelGroundWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      // A feature-prefixed frame class only: a positioned utility on the frame
      // (.gl-glass) would demote Foundry's absolutely positioned window.
      id: "gllvg-window",
      classes: ["gllvg-app"],
      window: { title: "GLLVG.window.title", icon: "fa-solid fa-scale-balanced", resizable: true },
      position: { width: 780, height: "auto" },
    };

    async _prepareContext() {
      return windowModel();
    }

    async _renderHTML(context) {
      return windowHTML(context, { t });
    }

    _replaceHTML(result, content) {
      const body = content.querySelector(".gllvg-body");
      const top = body?.scrollTop ?? 0;
      content.innerHTML = result;
      const next = content.querySelector(".gllvg-body");
      if (next) next.scrollTop = top;
    }

    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      const el = this.element;
      el.addEventListener("click", (event) => this.#onClick(event));
      el.addEventListener("change", (event) => this.#onChange(event));
      el.addEventListener("input", (event) => this.#onInput(event));
    }

    #queue = Promise.resolve();

    #run(fn) {
      this.#queue = this.#queue
        .then(async () => {
          await fn();
          if (this.rendered) await this.render();
        })
        .catch((error) => console.error("GLUniverse Suite | level-ground: window action failed", error));
      return this.#queue;
    }

    #onClick(event) {
      const button = event.target.closest?.("[data-lvg-action]");
      if (!button || button.disabled || !this.element.contains(button)) return;
      event.preventDefault();
      const action = button.dataset.lvgAction;
      const row = button.dataset.lvgRow;
      const run = (fn) => this.#run(fn);
      switch (action) {
        case "tab":
          session.tab = button.dataset.tab;
          return run(async () => {});
        case "source":
          return run(async () => {
            const ws = readWorksheet();
            ws.source = button.dataset.source;
            await writeWorksheet(ws);
          });
        case "refresh":
          return run(async () => {});
        case "addRow":
          return run(async () => {
            const ws = readWorksheet();
            const level = threatModel().reading?.partyLevel ?? 1;
            ws.manualRows.push({ id: `m${randomId()}`, name: t("GLLVG.threat.newRow", { n: ws.manualRows.length + 1 }), count: 1, level, role: "standard", adjust: "", area: false, hazard: "" });
            await writeWorksheet(ws);
          });
        case "removeRow":
          return run(async () => {
            const ws = readWorksheet();
            ws.manualRows = ws.manualRows.filter((r) => r.id !== row);
            await writeWorksheet(ws);
          });
        case "postSizing":
          return run(postSizing);
        case "awardXP":
          return run(awardXP);
        case "postBreakAway":
          return run(postBreakAwayCard);
        case "postCheck":
          return run(postCheck);
        case "copyStrip":
          return navigator.clipboard?.writeText?.(stripTextModel().output).then(() => ui.notifications?.info(t("GLLVG.stripText.copied")));
        case "fixPwol":
          return run(fixPwol);
        case "fixAbp":
          return run(fixAbp);
        case "fixLevelProf":
          return run(fixLevelProf);
        case "stripAll":
          return run(stripAll);
        default:
          return undefined;
      }
    }

    #onInput(event) {
      const el = event.target;
      if (el?.dataset?.lvgField !== "stripText.text") return;
      session.stripText.text = el.value;
      const out = this.element.querySelector("[data-lvg-out='strip']");
      if (out) out.textContent = stripTextModel().output;
    }

    #onChange(event) {
      const el = event.target;
      const field = el?.dataset?.lvgField;
      if (!field) return;
      const value = el.type === "checkbox" ? el.checked : el.value;
      const row = el.dataset.lvgRow;
      this.#run(async () => {
        if (row && session.tab === "threat") await this.#changeRow(row, field, value);
        else if (row && session.tab === "breakAway") {
          const s = (session.breakAway.rows[row] ??= {});
          s[field] = field === "bonus" ? Number(value) : value;
        } else if (field.startsWith("party.")) {
          const ws = readWorksheet();
          ws.party[field.slice("party.".length)] = value;
          await writeWorksheet(ws);
        } else if (field === "breakAway.pursuerLevel") {
          session.breakAway.pursuerLevel = value === "" ? null : Number(value);
        } else if (field.startsWith("convert.")) {
          session.convert[field.slice("convert.".length)] = value;
        } else if (field.startsWith("stripText.")) {
          session.stripText[field.slice("stripText.".length)] = value;
        }
      });
    }

    async #changeRow(id, field, value) {
      const ws = readWorksheet();
      const manual = ws.manualRows.find((r) => r.id === id);
      if (manual) {
        if (field === "count" || field === "level") manual[field] = Math.trunc(Number(value) || 0);
        else if (field === "adjust") manual.adjust = value === "none" ? "" : value;
        else if (field === "hazard") manual.hazard = value === "creature" ? "" : value;
        else manual[field] = value;
        await writeWorksheet(ws);
        return;
      }
      // A world row: only the area-attack mark is the worksheet's to change, and it is kept on the actor.
      if (field !== "area") return;
      const m = threatModel();
      const r = m.rows.find((x) => x.id === id);
      if (!r?.uuid) return;
      const actor = await fromUuid(r.uuid);
      if (actor) await actor.update({ [flagPath(FLAGS.area)]: !!value });
    }
  };
  return _cls;
}

/** Open (or bring forward) the window on a tab. GM only. */
export function openWindow(tab = null) {
  if (!game.user?.isGM) return null;
  if (tab) session.tab = TABS.includes(tab) ? tab : "threat";
  const Cls = appClass();
  _app ??= new Cls();
  _app.render({ force: true });
  return _app;
}

/** Redraw an open window (the world it reads changed). */
export function refreshWindow() {
  if (_app?.rendered) _app.render();
}
