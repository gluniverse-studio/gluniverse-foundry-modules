/**
 * Level Ground — every surface the feature draws, as markup strings. Pure.
 *
 * The window (five tabs), the strip at the top of the combat tracker, the
 * marker on a Stripped sheet and every chat card are drawn here from plain
 * models; the glue modules read the world into those models and bind the
 * clicks. `t(key, data)` is the only way text reaches the markup, and every
 * value that came from the world is escaped.
 *
 * Roots carry `gllvg-root`, which the skin scopes to (styles/level-ground.css).
 * Controls are `data-lvg-action` (buttons) and `data-lvg-field` (inputs); a row
 * control adds `data-lvg-row`.
 */

import { escapeHTML } from "../../core/util.mjs";
import { BAND_KEYS, BREAK_AWAY_SKILLS, DC_ADJUSTMENTS, RANKS, RARITY_ADJUSTMENTS } from "./logic.mjs";
import { CHECK_STATS, TABS } from "./constants.mjs";
import { COMMON_DCS, FIXED_DCS } from "./reference.mjs";
import { convertDC } from "./rules.mjs";

const e = escapeHTML;
const signed = (n) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);
const num = (n) => (Number.isFinite(n) ? String(Math.round(n)) : "—");

/** The reference's Outclassed and Uncertain reasons, as lang keys. */
export const SIGN_KEYS = Object.freeze({
  "two or more creatures above the party's level": "twoAbove",
  "party level 1 to 3 against a higher-level creature": "lowParty",
  "a Solo 2 or more levels above the party": "soloFar",
  "more than one Solo": "twoSolos",
  "a party of two": "partyOfTwo",
  "a mixed-level party led by a spellcaster": "mixedCaster",
  "five or more Mooks per PC": "mookHorde",
});
export const NOTE_KEYS = Object.freeze({
  "A lone PC is outside what the worksheet reads.": "lonePC",
  "Seven or more PCs and allies is untested.": "bigParty",
});
export const reasonKey = (s) => `GLLVG.reason.${SIGN_KEYS[s] ?? "unknown"}`;

/** Why Assurance is refused: Break Away, a higher-level creature's statistic, a DC set by a higher level. */
export const ASSURANCE_REASONS = Object.freeze(["breakAway", "creature", "levelDC"]);

/** Runtime-built key families; the check tool resolves every member. */
export const DYNAMIC_KEYS = Object.freeze({
  band: BAND_KEYS.map((k) => `GLLVG.band.${k}`),
  word: ["noThreat", "weaker", "realFight", "dangerous", "coinToss", "overwhelming"].map((k) => `GLLVG.word.${k}`),
  rank: RANKS.map((r) => `GLLVG.rank.${r}`),
  role: ["none", "mook", "solo", "summoned"].map((r) => `GLLVG.role.${r}`),
  tab: TABS.map((k) => `GLLVG.tab.${k}`),
  reason: [...Object.values(SIGN_KEYS), "unknown"].map((k) => `GLLVG.reason.${k}`),
  note: Object.values(NOTE_KEYS).map((k) => `GLLVG.note.${k}`),
  skill: [...new Set([...CHECK_STATS, ...BREAK_AWAY_SKILLS])].map((k) => `GLLVG.stat.${k}`),
  adjust: Object.keys(DC_ADJUSTMENTS).map((k) => `GLLVG.adjust.${k}`),
  rarity: Object.keys(RARITY_ADJUSTMENTS).map((k) => `GLLVG.rarity.${k}`),
  mode: ["printed", "level", "spell", "ritual", "rank"].map((k) => `GLLVG.convert.mode.${k}`),
  source: ["combat", "selected", "manual", "party"].map((k) => `GLLVG.source.${k}`),
  kind: ["creature", "simple", "complex"].map((k) => `GLLVG.kind.${k}`),
  adjustment: ["none", "elite", "weak"].map((k) => `GLLVG.elite.${k}`),
  result: ["escapeAlly", "escape", "pursued", "caught", "pending"].map((k) => `GLLVG.breakAway.result.${k}`),
  common: COMMON_DCS.map((c) => `GLLVG.common.${c.key}`),
  unbowed: ["exempt", "thisTurn", "turns"].map((k) => `GLLVG.unbowed.when.${k}`),
  assurance: ASSURANCE_REASONS.map((k) => `GLLVG.card.assurance.${k}`),
});

/* ── Small parts ──────────────────────────────────────────────────────── */

const opt = (value, label, selected) =>
  `<option value="${e(value)}"${String(value) === String(selected) ? " selected" : ""}>${e(label)}</option>`;

const check = (field, checked, label, attrs = "") =>
  `<label class="gllvg-check"><input type="checkbox" data-lvg-field="${e(field)}"${checked ? " checked" : ""}${attrs}><span>${e(label)}</span></label>`;

const btn = (action, label, { icon = null, attrs = "", cls = "", disabled = false } = {}) =>
  `<button type="button" class="gllvg-btn${cls ? ` ${cls}` : ""}" data-lvg-action="${e(action)}"${attrs}${disabled ? " disabled" : ""}>${icon ? `<i class="${e(icon)}" inert></i>` : ""}<span>${e(label)}</span></button>`;

const caption = (text) => `<div class="gllvg-caption">${e(text)}</div>`;

const rankName = (t, i) => t(`GLLVG.rank.${RANKS[i] ?? "trained"}`);

/** "DC 16, expert" */
export const dcLine = (t, dc, rank) => t("GLLVG.convert.dcLine", { dc, rank: rankName(t, rank) });

/* ── The window ───────────────────────────────────────────────────────── */

export function windowHTML(model, { t }) {
  const tab = TABS.includes(model?.tab) ? model.tab : "threat";
  const tabs = TABS.map(
    (k) =>
      `<button type="button" class="gllvg-tab${k === tab ? " is-active" : ""}" data-lvg-action="tab" data-tab="${k}" aria-pressed="${k === tab}">${e(t(`GLLVG.tab.${k}`))}${k === "setup" && model?.setup?.problems ? `<b class="gllvg-dot" title="${e(t("GLLVG.setup.needsAttention"))}"></b>` : ""}</button>`,
  ).join("");
  const body =
    tab === "threat"
      ? threatHTML(model.threat, { t })
      : tab === "breakAway"
        ? breakAwayHTML(model.breakAway, { t })
        : tab === "convert"
          ? convertHTML(model.convert, { t })
          : tab === "stripText"
            ? stripTextHTML(model.stripText, { t })
            : setupHTML(model.setup, { t });
  return `<div class="gllvg-root gllvg-window gl-type" data-tab="${tab}"><nav class="gllvg-tabs" role="tablist">${tabs}</nav><div class="gllvg-body">${body}</div></div>`;
}

/* ── Threat ───────────────────────────────────────────────────────────── */

function rowHTML(r, { t }) {
  const id = e(r.id);
  const ro = r.editable ? "" : " disabled";
  const kind = r.hazard || "creature";
  return `<tr class="gllvg-row${r.hidden ? " is-hidden" : ""}" data-lvg-row="${id}">
<td class="gllvg-name">${e(r.name || t("GLLVG.threat.unnamed"))}${r.hidden ? `<span class="gllvg-tag">${e(t("GLLVG.threat.hidden"))}</span>` : ""}</td>
<td><input type="number" class="gllvg-num" min="1" max="99" step="1" value="${e(r.count)}" data-lvg-row="${id}" data-lvg-field="count"${ro} aria-label="${e(t("GLLVG.threat.count"))}"></td>
<td><input type="number" class="gllvg-num" min="-1" max="30" step="1" value="${e(r.level)}" data-lvg-row="${id}" data-lvg-field="level"${ro} aria-label="${e(t("GLLVG.threat.level"))}"></td>
<td><select data-lvg-row="${id}" data-lvg-field="role"${ro || (r.hazard ? " disabled" : "")} aria-label="${e(t("GLLVG.threat.role"))}">${["standard", "mook", "solo"].map((k) => opt(k, t(`GLLVG.role.${k === "standard" ? "none" : k}`), r.role)).join("")}</select></td>
<td><select data-lvg-row="${id}" data-lvg-field="adjust"${ro || (r.hazard ? " disabled" : "")} aria-label="${e(t("GLLVG.threat.adjust"))}">${["none", "elite", "weak"].map((k) => opt(k, t(`GLLVG.elite.${k}`), r.adjust || "none")).join("")}</select></td>
<td class="gllvg-c"><input type="checkbox" data-lvg-row="${id}" data-lvg-field="area"${r.area ? " checked" : ""}${r.hazard ? " disabled" : ""} aria-label="${e(t("GLLVG.threat.area"))}"></td>
<td><select data-lvg-row="${id}" data-lvg-field="hazard"${ro} aria-label="${e(t("GLLVG.threat.kind"))}">${["creature", "simple", "complex"].map((k) => opt(k, t(`GLLVG.kind.${k}`), kind)).join("")}</select></td>
<td class="gllvg-c">${r.editable ? `<button type="button" class="gllvg-icon" data-lvg-action="removeRow" data-lvg-row="${id}" aria-label="${e(t("GLLVG.threat.remove"))}"><i class="fa-solid fa-xmark" inert></i></button>` : ""}</td>
</tr>`;
}

function columnsHTML(r, { t }) {
  const c = r.columns;
  const cells = [
    ["trivial", c.trivial],
    ["low", c.low],
    ["moderate", c.moderate],
    ["severe", c.severe],
    ["extreme", c.extreme],
    ["beyondExtreme", c.beyond],
  ];
  return `<div class="gllvg-columns">${cells
    .map(
      ([k, v]) =>
        `<div class="gllvg-col${r.band === k ? " is-band" : ""}"><span>${e(t(`GLLVG.band.${k}`))}</span><b class="gllvg-n">${e(num(v))}</b></div>`,
    )
    .join("")}</div>`;
}

export function readingHTML(r, { t }) {
  if (!r) return `<div class="gllvg-empty">${e(t("GLLVG.threat.noReading"))}</div>`;
  const reasons = (list) => list.map((s) => `<li>${e(t(reasonKey(s)))}</li>`).join("");
  const raised = r.plain !== r.label;
  return `<div class="gllvg-reading" data-band="${e(r.band)}">
<div class="gllvg-verdict"><b class="gllvg-pct gllvg-n">${e(r.pct)}%</b><div><div class="gllvg-band">${e(t(`GLLVG.band.${r.band}`))}</div><div class="gllvg-word">“${e(t(`GLLVG.word.${r.wordKey}`))}”</div></div><div class="gllvg-xp"><span>${e(t("GLLVG.threat.xp"))}</span><b class="gllvg-n">${e(r.xp)}</b></div></div>
<dl class="gllvg-facts">
<dt>${e(t("GLLVG.threat.site"))}</dt><dd class="gllvg-n">${e(r.site)}</dd>
<dt>${e(t("GLLVG.threat.total"))}</dt><dd class="gllvg-n">${e(r.total)}${r.ticks ? ` <small>${e(t("GLLVG.threat.quarters", { n: r.ticks }))}</small>` : ""}</dd>
<dt>${e(t("GLLVG.threat.partyLevel"))}</dt><dd class="gllvg-n">${e(r.partyLevel)}</dd>
<dt>${e(t("GLLVG.threat.before"))}</dt><dd>${e(t(`GLLVG.band.${r.plainBand}`))}${raised ? ` → ${e(t(`GLLVG.band.${r.band}`))}` : ""}</dd>
</dl>
${columnsHTML(r, { t })}
${r.signs.length ? `<div class="gllvg-why"><b>${e(t(r.bumped ? "GLLVG.threat.outclassed" : "GLLVG.threat.outclassedNoStep"))}</b><ul>${reasons(r.signs)}</ul></div>` : ""}
${r.doubts.length ? `<div class="gllvg-why"><b>${e(t(r.uncertain ? "GLLVG.threat.uncertain" : "GLLVG.threat.uncertainNoStep"))}</b><ul>${reasons(r.doubts)}</ul></div>` : ""}
${r.note ? `<div class="gllvg-note">${e(t(`GLLVG.note.${NOTE_KEYS[r.note] ?? "lonePC"}`))}</div>` : ""}
<div class="gllvg-deadly"><b>${e(t("GLLVG.threat.deadlyTo"))}</b> ${r.deadly.length ? e(r.deadly.join(", ")) : e(t("GLLVG.threat.deadlyNone"))}</div>
${r.perCreature.some((c) => c.to.length) ? `<ul class="gllvg-deadly-list">${r.perCreature.filter((c) => c.to.length).map((c) => `<li><span>${e(c.name)}</span> → ${e(c.to.join(", "))}</li>`).join("")}</ul>` : ""}
</div>`;
}

export function threatHTML(m, { t }) {
  if (!m) return "";
  const source = ["combat", "selected", "manual"]
    .map((k) => `<button type="button" class="gllvg-seg${m.source === k ? " is-active" : ""}" data-lvg-action="source" data-source="${k}" aria-pressed="${m.source === k}">${e(t(`GLLVG.source.${k}`))}</button>`)
    .join("");
  const p = m.party;
  const pcs = p.pcs.length
    ? `<ul class="gllvg-pcs">${p.pcs.map((pc) => `<li><span>${e(pc.name)}</span><b class="gllvg-n">${e(t("GLLVG.threat.pcLine", { level: pc.level, hp: pc.maxHP ?? "—" }))}</b></li>`).join("")}</ul>`
    : `<div class="gllvg-empty">${e(t("GLLVG.threat.noPCs"))}</div>`;
  return `<section class="gllvg-threat">
<div class="gllvg-bar"><div class="gllvg-segs" role="group" aria-label="${e(t("GLLVG.threat.source"))}">${source}</div>${btn("refresh", t("GLLVG.threat.refresh"), { icon: "fa-solid fa-rotate", cls: "is-ghost" })}</div>
${m.sourceNote ? `<div class="gllvg-note">${e(t(m.sourceNote))}</div>` : ""}
${caption(t("GLLVG.threat.opposition"))}
<div class="gllvg-table-wrap"><table class="gllvg-table"><thead><tr><th>${e(t("GLLVG.threat.name"))}</th><th>${e(t("GLLVG.threat.count"))}</th><th>${e(t("GLLVG.threat.level"))}</th><th>${e(t("GLLVG.threat.role"))}</th><th>${e(t("GLLVG.threat.adjust"))}</th><th title="${e(t("GLLVG.threat.areaHint"))}">${e(t("GLLVG.threat.area"))}</th><th>${e(t("GLLVG.threat.kind"))}</th><th></th></tr></thead>
<tbody>${m.rows.map((r) => rowHTML(r, { t })).join("") || `<tr><td colspan="8" class="gllvg-empty">${e(t("GLLVG.threat.noRows"))}</td></tr>`}</tbody></table></div>
<div class="gllvg-bar">${btn("addRow", t("GLLVG.threat.addRow"), { icon: "fa-solid fa-plus", cls: "is-ghost" })}</div>
<div class="gllvg-grid">
<div class="gllvg-col-left">
${caption(t("GLLVG.threat.party"))}
<div class="gllvg-note">${e(t(`GLLVG.source.${p.source}`))}</div>
${pcs}
${p.source === "manual" ? `<label class="gllvg-field"><span>${e(t("GLLVG.threat.manualPCs"))}</span><input type="text" data-lvg-field="party.manualText" value="${e(p.manualText ?? "")}" placeholder="5, 5, 5, 5"></label><label class="gllvg-field"><span>${e(t("GLLVG.threat.manualHP"))}</span><input type="number" class="gllvg-num" min="1" data-lvg-field="party.hpText" value="${e(p.hpText ?? "")}"></label>` : ""}
<label class="gllvg-field"><span>${e(t("GLLVG.threat.allies"))}</span><input type="text" data-lvg-field="party.alliesText" value="${e(p.alliesText ?? "")}" placeholder="1m, 1m, 4"></label>
${p.allies.length ? `<div class="gllvg-note">${e(t("GLLVG.threat.alliesFound", { list: p.allies.map((a) => `${a.name} ${a.level}${a.mook ? "m" : ""}`).join(", ") }))}</div>` : ""}
<div class="gllvg-checks">${check("party.area", p.area, t("GLLVG.threat.partyArea"))}${check("party.casterLeads", p.casterLeads, t(p.casterGuess ? "GLLVG.threat.casterLeadsGuess" : "GLLVG.threat.casterLeads"))}</div>
</div>
<div class="gllvg-col-right">
${caption(t("GLLVG.threat.reading"))}
${readingHTML(m.reading, { t })}
${m.perceivedDiffers ? `<div class="gllvg-note">${e(t("GLLVG.threat.perceivedNote", { pct: m.perceived?.pct ?? 0, band: t(`GLLVG.band.${m.perceived?.band ?? "belowTrivial"}`) }))}</div>` : ""}
<div class="gllvg-bar gllvg-actions">${btn("postSizing", t("GLLVG.threat.postSizing"), { icon: "fa-solid fa-eye", disabled: !m.perceived })}${btn("awardXP", t("GLLVG.threat.awardXP"), { icon: "fa-solid fa-star", disabled: !m.reading || !m.canAward })}</div>
</div>
</div>
</section>`;
}

/* ── Break Away ───────────────────────────────────────────────────────── */

export function breakAwayHTML(m, { t }) {
  if (!m) return "";
  const rows = m.rows
    .map((r) => {
      const id = e(r.id);
      const f = (field, checked, label) =>
        `<td class="gllvg-c"><input type="checkbox" data-lvg-row="${id}" data-lvg-field="${field}"${checked ? " checked" : ""} aria-label="${e(label)}"${r.flee ? "" : " disabled"}></td>`;
      return `<tr class="gllvg-row${r.flee ? "" : " is-off"}" data-lvg-row="${id}">
<td class="gllvg-c"><input type="checkbox" data-lvg-row="${id}" data-lvg-field="flee"${r.flee ? " checked" : ""} aria-label="${e(t("GLLVG.breakAway.flees"))}"></td>
<td class="gllvg-name">${e(r.name)}</td>
<td><select data-lvg-row="${id}" data-lvg-field="skill"${r.flee ? "" : " disabled"}>${BREAK_AWAY_SKILLS.map((s) => opt(s, t(`GLLVG.stat.${s}`), r.skill)).join("")}</select></td>
${f("faster", r.faster, t("GLLVG.breakAway.faster"))}${f("flies", r.flies, t("GLLVG.breakAway.flies"))}${f("ground", r.ground, t("GLLVG.breakAway.ground"))}${f("carrying", r.carrying, t("GLLVG.breakAway.carrying"))}
<td><select data-lvg-row="${id}" data-lvg-field="bonus"${r.flee ? "" : " disabled"} aria-label="${e(t("GLLVG.breakAway.bonus"))}">${[0, 2, 3, 4].map((n) => opt(n, n ? `+${n}` : "—", r.bonus)).join("")}</select></td>
<td class="gllvg-dc gllvg-n">${r.flee && Number.isFinite(r.dc) ? e(r.dc) : "—"}</td>
</tr>`;
    })
    .join("");
  return `<section class="gllvg-ba">
<div class="gllvg-bar">
<label class="gllvg-field gllvg-inline"><span>${e(t("GLLVG.breakAway.pursuer"))}</span><input type="number" class="gllvg-num" min="-1" max="30" data-lvg-field="breakAway.pursuerLevel" value="${e(m.pursuerLevel ?? "")}"></label>
${m.pursuerName ? `<span class="gllvg-note">${e(t("GLLVG.breakAway.pursuerFrom", { name: m.pursuerName }))}</span>` : ""}
<span class="gllvg-note">${e(t("GLLVG.breakAway.base", { dc: Number.isFinite(m.baseDC) ? m.baseDC : "—" }))}</span>
</div>
<div class="gllvg-table-wrap"><table class="gllvg-table"><thead><tr><th title="${e(t("GLLVG.breakAway.flees"))}"><i class="fa-solid fa-person-running" inert></i></th><th>${e(t("GLLVG.breakAway.pc"))}</th><th>${e(t("GLLVG.breakAway.skill"))}</th><th title="${e(t("GLLVG.breakAway.fasterHint"))}">${e(t("GLLVG.breakAway.faster"))}</th><th title="${e(t("GLLVG.breakAway.fliesHint"))}">${e(t("GLLVG.breakAway.flies"))}</th><th title="${e(t("GLLVG.breakAway.groundHint"))}">${e(t("GLLVG.breakAway.ground"))}</th><th title="${e(t("GLLVG.breakAway.carryingHint"))}">${e(t("GLLVG.breakAway.carrying"))}</th><th title="${e(t("GLLVG.breakAway.bonusHint"))}">${e(t("GLLVG.breakAway.bonus"))}</th><th>${e(t("GLLVG.breakAway.dc"))}</th></tr></thead>
<tbody>${rows || `<tr><td colspan="9" class="gllvg-empty">${e(t("GLLVG.breakAway.noPCs"))}</td></tr>`}</tbody></table></div>
<div class="gllvg-note">${e(t("GLLVG.breakAway.rulesNote"))}</div>
<div class="gllvg-bar gllvg-actions">${btn("postBreakAway", t("GLLVG.breakAway.post"), { icon: "fa-solid fa-person-running", disabled: !m.canPost })}</div>
</section>`;
}

/* ── Convert ──────────────────────────────────────────────────────────── */

function referenceHTML({ t }) {
  const common = COMMON_DCS.map(
    (c) => `<tr><td>${e(t(`GLLVG.common.${c.key}`))}</td><td class="gllvg-n">${e(c.printed.map(convertDC).join(", "))}</td></tr>`,
  ).join("");
  const fixed = FIXED_DCS.map(
    (f) =>
      `<tr><td>${f.spell ? `<i>${e(f.name)}</i>` : e(f.name)}</td><td class="gllvg-n">${e(f.printed.join(", "))}</td><td class="gllvg-n">${e(f.dc.join(", "))}</td><td>${e(f.ranks.map((r) => t(`GLLVG.rank.${r}`)).join(", "))}</td></tr>`,
  ).join("");
  return `<details class="gllvg-details" open><summary>${e(t("GLLVG.convert.common"))}</summary><table class="gllvg-table gllvg-ref"><tbody>${common}</tbody></table></details>
<details class="gllvg-details"><summary>${e(t("GLLVG.convert.fixed"))}</summary><div class="gllvg-note">${e(t("GLLVG.convert.fixedNote"))}</div><div class="gllvg-ref-scroll"><table class="gllvg-table gllvg-ref"><thead><tr><th>${e(t("GLLVG.convert.name"))}</th><th>${e(t("GLLVG.convert.printed"))}</th><th>${e(t("GLLVG.convert.lg"))}</th><th>${e(t("GLLVG.convert.rank"))}</th></tr></thead><tbody>${fixed}</tbody></table></div></details>`;
}

export function convertHTML(m, { t }) {
  if (!m) return "";
  const r = m.result;
  const needsRank = m.mode === "spell" || m.mode === "ritual";
  const valueLabel = { printed: "GLLVG.convert.printedDC", level: "GLLVG.convert.levelOf", spell: "GLLVG.convert.spellRank", ritual: "GLLVG.convert.printedDC", rank: "GLLVG.convert.taskRank" }[m.mode] ?? "GLLVG.convert.printedDC";
  const valueInput =
    m.mode === "rank"
      ? `<select data-lvg-field="convert.value">${RANKS.map((k, i) => opt(i, t(`GLLVG.rank.${k}`), m.value)).join("")}</select>`
      : m.mode === "spell"
        ? `<input type="number" class="gllvg-num" min="1" max="10" data-lvg-field="convert.spellRank" value="${e(m.spellRank ?? "")}">`
        : `<input type="number" class="gllvg-num" min="-1" max="60" data-lvg-field="convert.value" value="${e(m.value ?? "")}">`;
  const reach = r
    ? RANKS.slice(0, 5)
        .map((k, i) => ({ k, p: -2 * Math.max(0, r.rank - Math.max(i, 1)) }))
        .filter((x) => x.p < 0)
        .map((x) => `${t(`GLLVG.rank.${x.k}`)} ${signed(x.p)}`)
        .join(", ")
    : "";
  return `<section class="gllvg-convert">
<div class="gllvg-form">
<label class="gllvg-field"><span>${e(t("GLLVG.convert.modeLabel"))}</span><select data-lvg-field="convert.mode">${["printed", "level", "spell", "ritual", "rank"].map((k) => opt(k, t(`GLLVG.convert.mode.${k}`), m.mode)).join("")}</select></label>
<label class="gllvg-field"><span>${e(t(valueLabel))}</span>${valueInput}</label>
${m.mode === "ritual" ? `<label class="gllvg-field"><span>${e(t("GLLVG.convert.ritualRank"))}</span><input type="number" class="gllvg-num" min="1" max="10" data-lvg-field="convert.spellRank" value="${e(m.spellRank ?? "")}"></label>` : ""}
<label class="gllvg-field"><span>${e(t("GLLVG.convert.difficulty"))}</span><select data-lvg-field="convert.adjust">${Object.entries(DC_ADJUSTMENTS).map(([k, v]) => opt(k, `${t(`GLLVG.adjust.${k}`)}${v ? ` (${signed(v)})` : ""}`, m.adjust)).join("")}</select></label>
<label class="gllvg-field"><span>${e(t("GLLVG.convert.rarity"))}</span><select data-lvg-field="convert.rarity">${Object.entries(RARITY_ADJUSTMENTS).map(([k, v]) => opt(k, `${t(`GLLVG.rarity.${k}`)}${v ? ` (${signed(v)})` : ""}`, m.rarity)).join("")}</select></label>
${m.mode !== "rank" ? `<label class="gllvg-field"><span>${e(t("GLLVG.convert.minRank"))}</span><select data-lvg-field="convert.minRank">${opt("", "—", m.minRank ?? "")}${RANKS.slice(0, 5).map((k, i) => opt(i, t(`GLLVG.rank.${k}`), m.minRank ?? "")).join("")}</select></label>` : ""}
</div>
${needsRank && m.mode === "spell" ? `<div class="gllvg-note">${e(t("GLLVG.convert.spellNote"))}</div>` : ""}
<div class="gllvg-result">${r ? `<b class="gllvg-dcbig">${e(dcLine(t, r.dc, r.rank))}</b>${r.adjust ? `<span class="gllvg-note">${e(t("GLLVG.convert.withAdjust", { base: r.base, adjust: signed(r.adjust) }))}</span>` : ""}${reach ? `<span class="gllvg-note">${e(t("GLLVG.convert.reachLine", { list: reach }))}</span>` : ""}` : `<span class="gllvg-empty">${e(t("GLLVG.convert.enter"))}</span>`}</div>
<div class="gllvg-bar gllvg-actions">
<label class="gllvg-field gllvg-inline"><span>${e(t("GLLVG.convert.statistic"))}</span><select data-lvg-field="convert.statistic">${CHECK_STATS.map((s) => opt(s, t(`GLLVG.stat.${s}`), m.statistic)).join("")}</select></label>
<label class="gllvg-field gllvg-inline gllvg-grow"><span>${e(t("GLLVG.convert.checkName"))}</span><input type="text" data-lvg-field="convert.checkName" value="${e(m.checkName ?? "")}" placeholder="${e(t("GLLVG.convert.checkNamePlaceholder"))}"></label>
${btn("postCheck", t("GLLVG.convert.post"), { icon: "fa-solid fa-dice-d20", disabled: !r })}
</div>
${referenceHTML({ t })}
</section>`;
}

/* ── Strip text ───────────────────────────────────────────────────────── */

export function stripTextHTML(m, { t }) {
  if (!m) return "";
  return `<section class="gllvg-striptext">
<div class="gllvg-bar"><label class="gllvg-field gllvg-inline"><span>${e(t("GLLVG.stripText.level"))}</span><input type="number" class="gllvg-num" min="-1" max="30" data-lvg-field="stripText.level" value="${e(m.level ?? "")}"></label></div>
<label class="gllvg-field"><span>${e(t("GLLVG.stripText.input"))}</span><textarea rows="6" data-lvg-field="stripText.text" spellcheck="false">${e(m.text ?? "")}</textarea></label>
${caption(t("GLLVG.stripText.output"))}
<pre class="gllvg-out" data-lvg-out="strip">${e(m.output ?? "")}</pre>
<div class="gllvg-note">${e(t("GLLVG.stripText.note"))}</div>
<div class="gllvg-bar gllvg-actions">${btn("copyStrip", t("GLLVG.stripText.copy"), { icon: "fa-solid fa-copy", disabled: !m.output })}</div>
</section>`;
}

/* ── Setup ────────────────────────────────────────────────────────────── */

const status = (ok, t, { warn = false } = {}) =>
  `<span class="gllvg-status ${ok ? "is-ok" : warn ? "is-warn" : "is-bad"}">${e(t(ok ? "GLLVG.setup.ok" : warn ? "GLLVG.setup.recommended" : "GLLVG.setup.fix"))}</span>`;

export function setupHTML(m, { t }) {
  if (!m) return "";
  const mods = m.pwol.modifiers
    .map((x) => `<li><span>${e(t(`GLLVG.rank.${x.rank}`))}</span><b class="gllvg-n">${e(signed(x.value))}</b>${x.ok ? "" : `<small>${e(t("GLLVG.setup.want", { value: signed(x.want) }))}</small>`}</li>`)
    .join("");
  const conflicts = m.conflicts
    .map((c) => `<div class="gllvg-warn"><i class="fa-solid fa-triangle-exclamation" inert></i><span>${e(t("GLLVG.setup.conflict", { feature: c.title }))}</span></div>`)
    .join("");
  const profItems = m.levelProf.items
    .slice(0, 8)
    .map((i) => `<li>${e(i.actor)}: ${e(i.item)}</li>`)
    .join("");
  return `<section class="gllvg-setup">
${conflicts}
<div class="gllvg-setup-row"><div><b>${e(t("GLLVG.setup.pwol"))}</b><div class="gllvg-note">${e(t("GLLVG.setup.pwolHint"))}</div></div>${status(m.pwol.ok, t)}${m.pwol.ok ? "" : btn("fixPwol", t("GLLVG.setup.fixPwol"), { icon: "fa-solid fa-wrench" })}</div>
<ul class="gllvg-mods"><li><span>${e(t("GLLVG.setup.pwolEnabled"))}</span><b>${e(t(m.pwol.enabled ? "GLLVG.setup.on" : "GLLVG.setup.off"))}</b></li>${mods}</ul>
<div class="gllvg-setup-row"><div><b>${e(t("GLLVG.setup.abp"))}</b><div class="gllvg-note">${e(t("GLLVG.setup.abpHint", { value: m.abp.value ?? "—" }))}</div></div>${status(m.abp.ok, t, { warn: true })}${m.abp.ok ? "" : btn("fixAbp", t("GLLVG.setup.fixAbp"), { icon: "fa-solid fa-wrench", cls: "is-ghost" })}</div>
<div class="gllvg-setup-row"><div><b>${e(t("GLLVG.setup.levelProf"))}</b><div class="gllvg-note">${e(t("GLLVG.setup.levelProfHint", { count: m.levelProf.count }))}</div>${profItems ? `<ul class="gllvg-list">${profItems}</ul>` : ""}</div>${status(m.levelProf.count === 0, t)}${m.levelProf.count ? btn("fixLevelProf", t("GLLVG.setup.fixLevelProf"), { icon: "fa-solid fa-wrench" }) : ""}</div>
<div class="gllvg-setup-row"><div><b>${e(t("GLLVG.setup.strip"))}</b><div class="gllvg-note">${e(t("GLLVG.setup.stripHint", { count: m.unstripped, flattened: m.flattened }))}</div></div>${status(m.unstripped === 0, t, { warn: true })}${m.unstripped ? btn("stripAll", t("GLLVG.setup.stripAll"), { icon: "fa-solid fa-layer-group" }) : ""}</div>
<div class="gllvg-note">${e(t("GLLVG.setup.manualNote"))}</div>
</section>`;
}

/* ── The combat tracker strip ─────────────────────────────────────────── */

export function trackerStripHTML(r, { t }) {
  if (!r) return "";
  return `<div class="gllvg-root gllvg-strip gl-type" data-band="${e(r.band)}"><button type="button" class="gllvg-strip-btn" data-lvg-action="openThreat" title="${e(t("GLLVG.strip.open"))}"><span class="gllvg-caption">${e(t("GLLVG.strip.label"))}</span><b class="gllvg-band">${e(t(`GLLVG.band.${r.band}`))}</b><b class="gllvg-n">${e(r.pct)}%</b><span class="gllvg-meter"><i style="--gllvg-fill:${Math.max(0, Math.min(1.25, r.ratio)) / 1.25}"></i></span><span class="gllvg-xp gllvg-n">${e(t("GLLVG.strip.xp", { xp: r.xp }))}</span></button></div>`;
}

/* ── The sheet marker ─────────────────────────────────────────────────── */

export function sheetMarkerHTML({ stripped = null, role = null, canEdit = false }, { t }) {
  if (!stripped && !role) return "";
  const parts = [];
  if (stripped) parts.push(`<span class="gllvg-tag is-strip"><i class="fa-solid fa-scale-balanced" inert></i>${e(t("GLLVG.sheet.stripped", { level: stripped.level }))}</span>`);
  if (role && role !== "none") parts.push(`<span class="gllvg-tag is-role">${e(t(`GLLVG.role.${role}`))}</span>`);
  const actions = canEdit && stripped ? btn("unstrip", t("GLLVG.sheet.unstrip"), { icon: "fa-solid fa-rotate-left", cls: "is-ghost" }) : "";
  return `<div class="gllvg-root gllvg-marker gl-type">${parts.join("")}${actions}</div>`;
}

/* ── Chat cards ───────────────────────────────────────────────────────── */

const card = (kind, title, body, { icon = "fa-solid fa-scale-balanced" } = {}) =>
  `<div class="gllvg-root gllvg-card gl-type" data-card="${e(kind)}"><header class="gllvg-card-head"><i class="${e(icon)}" inert></i><span>${e(title)}</span></header>${body}</div>`;

/** Sizing Up: public. The word and the names, nothing else. */
export function sizingUpCardHTML({ wordKey, deadly = [] }, { t }) {
  return card(
    "sizing",
    t("GLLVG.card.sizing.title"),
    `<div class="gllvg-card-word">“${e(t(`GLLVG.word.${wordKey}`))}”</div><div class="gllvg-card-line">${deadly.length ? e(t("GLLVG.card.sizing.deadly", { names: deadly.join(", ") })) : e(t("GLLVG.card.sizing.noDeadly"))}</div>`,
    { icon: "fa-solid fa-eye" },
  );
}

/** A check the GM called from the converter; `inline` is PF2e's @Check syntax, enriched when the card renders. */
export function checkRequestCardHTML({ name, dc, rank, inline }, { t }) {
  return card(
    "check",
    name || t("GLLVG.card.check.title"),
    `<div class="gllvg-card-line"><b>${e(dcLine(t, dc, rank))}</b></div><div class="gllvg-card-line gllvg-card-check">${e(inline)}</div><div class="gllvg-card-small">${e(t("GLLVG.card.check.reach"))}</div>`,
    { icon: "fa-solid fa-dice-d20" },
  );
}

/** Break Away: one row per fleeing PC with their check, and each result once it lands. */
export function breakAwayCardHTML({ pursuerLevel, rows = [], results = {} }, { t }) {
  const body = rows
    .map((r) => {
      const res = results[r.actorId] ?? null;
      const key = res ? res.result : "pending";
      return `<li class="gllvg-ba-row" data-result="${e(key)}"><div class="gllvg-ba-who"><b>${e(r.name)}</b><span>${e(t("GLLVG.card.breakAway.row", { skill: t(`GLLVG.stat.${r.skill}`), dc: r.dc }))}${r.bonus ? ` · ${e(t("GLLVG.card.breakAway.bonus", { bonus: r.bonus }))}` : ""}</span></div>${res ? `<div class="gllvg-ba-res"><b class="gllvg-n">${e(res.total ?? "")}</b><span>${e(t(`GLLVG.breakAway.result.${key}`))}</span></div>` : `<div class="gllvg-ba-roll">${e(r.inline)}</div>`}</li>`;
    })
    .join("");
  const done = rows.length && rows.every((r) => results[r.actorId]);
  const escaped = rows.filter((r) => ["escape", "escapeAlly"].includes(results[r.actorId]?.result)).map((r) => r.name);
  const pursued = rows.filter((r) => results[r.actorId]?.result === "pursued").map((r) => r.name);
  const caught = rows.filter((r) => results[r.actorId]?.result === "caught").map((r) => r.name);
  const summary = done
    ? `<div class="gllvg-card-summary">${escaped.length ? `<div>${e(t("GLLVG.card.breakAway.escaped", { names: escaped.join(", ") }))}</div>` : ""}${pursued.length ? `<div>${e(t("GLLVG.card.breakAway.pursued", { names: pursued.join(", ") }))}</div>` : ""}${caught.length ? `<div>${e(t("GLLVG.card.breakAway.caught", { names: caught.join(", ") }))}</div>` : ""}</div>`
    : "";
  return card(
    "breakAway",
    t("GLLVG.card.breakAway.title"),
    `<div class="gllvg-card-line">${e(t("GLLVG.card.breakAway.intro", { level: pursuerLevel }))}</div><ul class="gllvg-ba-list">${body}</ul>${summary}<div class="gllvg-card-small">${e(t("GLLVG.card.breakAway.noXP"))}</div>`,
    { icon: "fa-solid fa-person-running" },
  );
}

/** Massive damage (GM only): the PC is not dead; dying as normal, one higher. */
export function massiveCardHTML({ name, actorUuid, normal, critical, wounded }, { t }) {
  return card(
    "massive",
    t("GLLVG.card.massive.title"),
    `<div class="gllvg-card-line">${e(t("GLLVG.card.massive.body", { name }))}</div>${wounded ? `<div class="gllvg-card-small">${e(t("GLLVG.card.massive.wounded", { wounded }))}</div>` : ""}<div class="gllvg-card-actions">${btn("setDying", t("GLLVG.card.massive.dying", { value: normal }), { attrs: ` data-uuid="${e(actorUuid)}" data-value="${e(normal)}"` })}${btn("setDying", t("GLLVG.card.massive.dyingCrit", { value: critical }), { attrs: ` data-uuid="${e(actorUuid)}" data-value="${e(critical)}"` })}</div>`,
    { icon: "fa-solid fa-heart-crack" },
  );
}

/** Tempo (GM only): one card per Solo per round, updated in place. */
export function tempoCardHTML({ name, after, used, lost, combatantId, combatId }, { t }) {
  const state = used ? t("GLLVG.card.tempo.used") : lost ? t("GLLVG.card.tempo.lost") : t("GLLVG.card.tempo.ready", { after });
  return card(
    "tempo",
    t("GLLVG.card.tempo.title", { name }),
    `<div class="gllvg-card-line">${e(state)}</div>${used || lost ? "" : `<div class="gllvg-card-small">${e(t("GLLVG.card.tempo.rule"))}</div><div class="gllvg-card-actions">${btn("tempoUsed", t("GLLVG.card.tempo.markUsed"), { attrs: ` data-combat="${e(combatId)}" data-combatant="${e(combatantId)}"` })}</div>`}`,
    { icon: "fa-solid fa-bolt" },
  );
}

/** Unbowed (GM only): what will end when, with an Exempt button per entry. */
export function unbowedCardHTML({ name, actorUuid, entries = [], inTurn = false, ended = [] }, { t }) {
  const rows = entries
    .map((en) => {
      const w = en.when;
      const when = w.k === "turns" ? t("GLLVG.unbowed.when.turns", { n: w.n }) : t(`GLLVG.unbowed.when.${w.k}`);
      return `<li class="gllvg-ub${en.exempt ? " is-exempt" : ""}"><span>${e(en.name)}</span><small>${e(when)}</small>${en.exempt ? "" : btn("unbowedExempt", t("GLLVG.card.unbowed.exempt"), { attrs: ` data-uuid="${e(actorUuid)}" data-entry="${e(en.id)}"`, cls: "is-ghost" })}</li>`;
    })
    .join("");
  return card(
    "unbowed",
    t("GLLVG.card.unbowed.title", { name }),
    `${ended.length ? `<div class="gllvg-card-line">${e(t("GLLVG.card.unbowed.ended", { names: ended.join(", ") }))}</div>` : ""}${rows ? `<ul class="gllvg-ub-list">${rows}</ul>` : `<div class="gllvg-card-small">${e(t("GLLVG.card.unbowed.none"))}</div>`}<div class="gllvg-card-small">${e(t(inTurn ? "GLLVG.card.unbowed.ruleInTurn" : "GLLVG.card.unbowed.rule"))}</div>`,
    { icon: "fa-solid fa-shield-halved" },
  );
}

/** Assurance used where Level Ground forbids it (GM and the roller). */
export function assuranceCardHTML({ name, reason }, { t }) {
  return card("assurance", t("GLLVG.card.assurance.title"), `<div class="gllvg-card-line">${e(t(`GLLVG.card.assurance.${reason}`, { name }))}</div>`, { icon: "fa-solid fa-triangle-exclamation" });
}

/** XP awarded (GM only): who got what. */
export function xpCardHTML({ rows = [], band }, { t }) {
  return card(
    "xp",
    t("GLLVG.card.xp.title", { band: t(`GLLVG.band.${band}`) }),
    `<ul class="gllvg-xp-list">${rows.map((r) => `<li><span>${e(r.name)}</span><b class="gllvg-n">+${e(r.xp)}</b></li>`).join("")}</ul>`,
    { icon: "fa-solid fa-star" },
  );
}

/** Every chat-card renderer, for the check tool and the preview. */
export const CARD_RENDERERS = Object.freeze({
  sizingUpCardHTML,
  checkRequestCardHTML,
  breakAwayCardHTML,
  massiveCardHTML,
  tempoCardHTML,
  unbowedCardHTML,
  assuranceCardHTML,
  xpCardHTML,
});
