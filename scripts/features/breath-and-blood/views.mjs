/**
 * Breath and Blood — every surface as a markup string. Pure: no `game`, no
 * DOM. The glue builds a model, these draw it, and the preview draws the same
 * models over the shipped stylesheet. `t(key, data)` localises; every key a
 * view asks for is a literal here or a `<family>.<value>` the check tool
 * resolves for every value.
 *
 * Skin: Ink and Signal under `--glbab-*` on the feature's own roots
 * (`.glbab-panel`, `.glbab-app`, `.glbab-card`, `.glbab-dialog`).
 */

import { escapeHTML as esc } from "../../core/util.mjs";

const attr = (v) => esc(v);
const pct = (value, max) => (max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0);

/** A pool meter: label, value / max, a bar. */
function meter(kind, label, value, max, extra = "") {
  return `<div class="glbab-meter" data-pool="${kind}">
    <span class="glbab-meter-label">${esc(label)}</span>
    <span class="glbab-meter-num"><b>${value}</b><span class="glbab-meter-max">/ ${max}</span>${extra}</span>
    <span class="glbab-meter-bar"><span class="glbab-meter-fill" style="width:${pct(value, max)}%"></span></span>
  </div>`;
}

/** Resolve Points as pips. */
function pips(value, max, t) {
  const cells = Array.from({ length: Math.max(0, max) }, (_, i) => `<span class="glbab-pip${i < value ? " is-on" : ""}"></span>`).join("");
  return `<div class="glbab-meter glbab-meter--rp" data-pool="rp">
    <span class="glbab-meter-label">${esc(t("GLBAB.pool.rp"))}</span>
    <span class="glbab-meter-num"><b>${value}</b><span class="glbab-meter-max">/ ${max}</span></span>
    <span class="glbab-pips" aria-hidden="true">${cells}</span>
  </div>`;
}

const chip = (on, label, tone = "") => `<span class="glbab-chip${on ? " is-on" : ""}"${tone ? ` data-tone="${tone}"` : ""}>${esc(label)}</span>`;

function button(action, label, { disabled = false, title = "", tone = "", data = {} } = {}) {
  const extra = Object.entries(data)
    .map(([k, v]) => ` data-${k}="${attr(v)}"`)
    .join("");
  return `<button type="button" class="gl-btn glbab-btn"${tone ? ` data-tone="${tone}"` : ""} data-bab-action="${action}"${extra}${
    disabled ? " disabled" : ""
  }${title ? ` data-tooltip-text="${attr(title)}" aria-label="${attr(title)}"` : ""}>${esc(label)}</button>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SHEET PANEL
   ══════════════════════════════════════════════════════════════════════════ */

/** The actions a panel can show, in order. Each has GLBAB.action.<id>. */
export const PANEL_ACTIONS = ["catch", "steel", "bind", "holdOn", "lend", "words", "treat", "battle", "rest"];

export function panelHTML(m, t) {
  if (!m) return "";
  const gm = m.isGM ? gmBlock(m, t) : "";
  if (!m.variantOn) {
    return m.isGM
      ? `<section class="glbab-panel" data-actor-id="${attr(m.actorId)}"><header class="glbab-head"><span class="glbab-eyebrow">${esc(
          t("GLBAB.title"),
        )}</span></header><p class="glbab-note" data-tone="warn">${esc(t("GLBAB.setup.off"))}</p></section>`
      : "";
  }
  if (!m.twoPool) {
    return m.isGM
      ? `<section class="glbab-panel is-one" data-actor-id="${attr(m.actorId)}"><header class="glbab-head"><span class="glbab-eyebrow">${esc(
          t("GLBAB.title"),
        )}</span><span class="glbab-role">${esc(t(`GLBAB.role.${m.role}`))}</span></header>${gm}</section>`
      : "";
  }
  const shares = m.shares ? `<p class="glbab-note">${esc(t("GLBAB.panel.shares", { name: m.shares }))}</p>` : "";
  const temp = m.hp.temp > 0 ? `<span class="glbab-meter-temp">+${m.hp.temp}</span>` : "";
  const state = [];
  if (m.dying > 0) state.push(chip(true, t("GLBAB.panel.dying", { value: m.dying }), "bad"));
  if (m.wounded > 0) state.push(chip(true, t("GLBAB.panel.wounded", { value: m.wounded }), "warn"));
  const ticks = [
    chip(m.ticks.caughtBreath, t("GLBAB.tick.caughtBreath")),
    chip(m.ticks.strengthLent, t("GLBAB.tick.strengthLent")),
    chip(m.ewImmune, t("GLBAB.tick.ewImmune")),
    m.fieldSurgeon.has ? chip(m.fieldSurgeon.used, t("GLBAB.tick.fieldSurgeon")) : "",
    m.steel.has ? chip(m.steel.used, t("GLBAB.tick.steel")) : "",
  ].join("");
  const actions = m.actions
    .map((a) =>
      button(a.id, t(`GLBAB.action.${a.id}`), {
        disabled: a.disabled,
        title: a.reason ? t(`GLBAB.refuse.${a.reason}`) : t(`GLBAB.actionHint.${a.id}`),
      }),
    )
    .join("");
  const decline = m.canEdit
    ? `<label class="glbab-toggle"><input type="checkbox" data-bab-field="declines"${m.declines ? " checked" : ""}><span>${esc(
        t("GLBAB.panel.declines"),
      )}</span></label>`
    : `<span class="glbab-toggle-read">${esc(t(m.declines ? "GLBAB.panel.declining" : "GLBAB.panel.paying"))}</span>`;
  return `<section class="glbab-panel" data-actor-id="${attr(m.actorId)}">
    <header class="glbab-head">
      <span class="glbab-eyebrow">${esc(t("GLBAB.title"))}</span>
      ${state.join("")}
      <span class="glbab-role">${esc(t(`GLBAB.role.${m.role}`))}</span>
    </header>
    ${shares}
    <div class="glbab-pools">
      ${meter("sp", t("GLBAB.pool.sp"), m.sp.value, m.sp.max)}
      ${meter("hp", t("GLBAB.pool.hp"), m.hp.value, m.hp.max, temp)}
      ${pips(m.rp.value, m.rp.max, t)}
    </div>
    <div class="glbab-ticks">${ticks}</div>
    <div class="glbab-row">${decline}</div>
    ${m.canEdit ? `<div class="glbab-actions">${actions}</div>` : ""}
    ${gm}
  </section>`;
}

function gmBlock(m, t) {
  const roles = m.gm.roles.map((r) => `<option value="${r}"${r === m.role ? " selected" : ""}>${esc(t(`GLBAB.role.${r}`))}</option>`).join("");
  const shares = [`<option value="">${esc(t("GLBAB.gm.sharesNone"))}</option>`]
    .concat(m.gm.sharesOptions.map((o) => `<option value="${attr(o.id)}"${o.selected ? " selected" : ""}>${esc(o.name)}</option>`))
    .join("");
  const tools = m.twoPool
    ? `<div class="glbab-gm-row">
        ${button("returned", t("GLBAB.gm.returned"), { title: t("GLBAB.gm.returnedHint"), tone: "warn" })}
        <span class="glbab-direct">
          <input type="number" class="glbab-num" data-bab-field="direct" min="0" step="1" value="" placeholder="0" aria-label="${attr(t("GLBAB.gm.directAmount"))}">
          ${button("direct", t("GLBAB.gm.direct"), { title: t("GLBAB.gm.directHint"), tone: "bad" })}
        </span>
      </div>`
    : "";
  return `<div class="glbab-gm">
    <span class="glbab-gm-tag">${esc(t("GLBAB.gm.tag"))}</span>
    <div class="glbab-gm-row">
      <label class="glbab-field"><span>${esc(t("GLBAB.gm.role"))}</span><select data-bab-field="role">${roles}</select></label>
      ${m.gm.canShare ? `<label class="glbab-field"><span>${esc(t("GLBAB.gm.shares"))}</span><select data-bab-field="sharesWith">${shares}</select></label>` : ""}
    </div>
    ${tools}
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE REST WINDOW
   ══════════════════════════════════════════════════════════════════════════ */

export function restHTML(m, t) {
  const tabs = m.isGM
    ? `<nav class="glbab-tabs">${["rest", "setup"]
        .map((id) => `<button type="button" class="glbab-tab${m.tab === id ? " is-on" : ""}" data-bab-action="tab" data-tab="${id}">${esc(t(`GLBAB.rest.tab.${id}`))}</button>`)
        .join("")}</nav>`
    : "";
  const body = m.tab === "setup" && m.isGM ? setupHTML(m.setup, t) : restBody(m, t);
  return `<div class="glbab-app">${tabs}${body}</div>`;
}

function restBody(m, t) {
  if (!m.variantOn) return `<p class="glbab-note" data-tone="warn">${esc(t("GLBAB.setup.off"))}</p>`;
  if (!m.actors.length) return `<p class="glbab-note">${esc(t("GLBAB.rest.none"))}</p>`;
  const rows = m.actors.map((a) => restRow(a, m, t)).join("");
  return `<p class="glbab-lede">${esc(t("GLBAB.rest.lede"))}</p>
    <div class="glbab-rest-head">
      <span>${esc(t("GLBAB.rest.col.who"))}</span>
      <span>${esc(t("GLBAB.rest.col.pools"))}</span>
      <span>${esc(t("GLBAB.rest.col.breather"))}</span>
      <span>${esc(t("GLBAB.rest.col.night"))}</span>
    </div>
    <div class="glbab-rest-rows">${rows}</div>
    <footer class="glbab-foot">
      ${button("endBreather", t("GLBAB.rest.endBreather"), { title: t("GLBAB.rest.endBreatherHint"), tone: "good" })}
      ${button("night", t("GLBAB.rest.night"), { title: t("GLBAB.rest.nightHint") })}
    </footer>`;
}

function restRow(a, m, t) {
  const lend = [`<option value="">${esc(t("GLBAB.rest.lendNone"))}</option>`]
    .concat(a.lendTargets.map((o) => `<option value="${attr(o.id)}"${o.id === a.lendTo ? " selected" : ""}>${esc(o.name)}</option>`))
    .join("");
  const nights = m.nights.map((k) => `<option value="${k}"${k === a.night ? " selected" : ""}>${esc(t(`GLBAB.night.${k}`))}</option>`).join("");
  const flags = [
    a.dying > 0 ? chip(true, t("GLBAB.panel.dying", { value: a.dying }), "bad") : "",
    a.wounded > 0 ? chip(true, t("GLBAB.panel.wounded", { value: a.wounded }), "warn") : "",
    a.unconscious ? chip(true, t("GLBAB.rest.unconscious"), "bad") : "",
  ].join("");
  return `<div class="glbab-rest-row" data-actor-id="${attr(a.id)}">
    <label class="glbab-rest-who"><input type="checkbox" data-bab-field="pick"${a.picked ? " checked" : ""}><span class="glbab-rest-name">${esc(a.name)}</span>${flags}</label>
    <span class="glbab-rest-pools glbab-numeric">
      <span data-pool="sp">${a.sp}<i>/${a.maxSP}</i></span>
      <span data-pool="hp">${a.hp}<i>/${a.maxHP}</i></span>
      <span data-pool="rp">${a.rp}<i>/${a.maxRP}</i></span>
    </span>
    <span class="glbab-rest-breather">
      <label class="glbab-mini"${a.bindRefusal ? ` data-tooltip-text="${attr(t(`GLBAB.refuse.${a.bindRefusal}`))}"` : ""}><input type="checkbox" data-bab-field="bind"${a.bind ? " checked" : ""}${
        a.bindRefusal ? " disabled" : ""
      }><span>${esc(t("GLBAB.rest.bind"))}</span></label>
      <label class="glbab-mini"><span>${esc(t("GLBAB.rest.lend"))}</span><select data-bab-field="lendTo"${a.canLend ? "" : " disabled"}>${lend}</select></label>
    </span>
    <span class="glbab-rest-night"><select data-bab-field="night">${nights}</select></span>
  </div>`;
}

export function setupHTML(s, t) {
  const yes = (on) => esc(t(on ? "GLBAB.setup.yes" : "GLBAB.setup.no"));
  const status = `<div class="glbab-status" data-tone="${s.stamina ? "good" : "warn"}">
    <span class="glbab-status-label">${esc(t("GLBAB.setup.stamina"))}</span>
    <b>${yes(s.stamina)}</b>
    ${s.stamina ? "" : button("enableStamina", t("GLBAB.setup.enable"), { tone: "good" })}
  </div>`;
  const rows = s.dials
    .map((d) => `<li class="glbab-dial"><span>${esc(t(`GLBAB.settings.${d.key}.name`))}</span><b>${esc(String(d.text))}</b></li>`)
    .join("");
  const lasting = s.lasting ? `<p class="glbab-note" data-tone="warn">${esc(t("GLBAB.setup.lasting"))}</p>` : "";
  return `<div class="glbab-setup">
    <p class="glbab-lede">${esc(t("GLBAB.setup.lede"))}</p>
    ${status}
    ${lasting}
    <ul class="glbab-dials">${rows}</ul>
    <p class="glbab-note">${esc(t("GLBAB.setup.fillHint", { count: s.unfilled }))}</p>
    <footer class="glbab-foot">
      ${button("fillPools", t("GLBAB.setup.fill"), { disabled: !s.stamina || !s.unfilled })}
      ${button("openSettings", t("GLBAB.setup.settings"))}
    </footer>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   TREAT WOUNDS AND BATTLE MEDICINE
   ══════════════════════════════════════════════════════════════════════════ */

export function treatHTML(m, t) {
  const kinds = ["treat", "battle"]
    .map((k) => `<button type="button" class="glbab-tab${m.kind === k ? " is-on" : ""}" data-bab-action="kind" data-kind="${k}">${esc(t(`GLBAB.treat.kind.${k}`))}</button>`)
    .join("");
  const healers = m.healers.map((h) => `<option value="${attr(h.id)}"${h.selected ? " selected" : ""}>${esc(h.name)}</option>`).join("");
  const dcs = m.dcs
    .map((d) => `<option value="${d.rank}"${d.selected ? " selected" : ""}>${esc(t("GLBAB.treat.dcOption", { rank: t(`GLBAB.rank.${d.rank}`), dc: d.dc, added: d.added }))}</option>`)
    .join("");
  const surgeon = m.surgeon.available
    ? `<label class="glbab-field"><span>${esc(t("GLBAB.treat.surgeon"))}</span><select data-bab-field="surgeon"><option value="">${esc(t("GLBAB.treat.surgeonNone"))}</option>${m.surgeon.options
        .map((o) => `<option value="${attr(o.id)}"${o.selected ? " selected" : ""}>${esc(o.name)}</option>`)
        .join("")}</select></label>`
    : m.surgeon.has
      ? `<span class="glbab-note">${esc(t(m.surgeon.used ? "GLBAB.treat.surgeonUsed" : "GLBAB.treat.surgeonBattle"))}</span>`
      : "";
  const assurance = m.assurance.available
    ? `<label class="glbab-mini"><input type="checkbox" data-bab-field="assurance"${m.assurance.checked ? " checked" : ""}><span>${esc(
        t("GLBAB.treat.assurance", { result: m.assurance.result }),
      )}</span></label>`
    : "";
  const patients = m.patients.length
    ? m.patients.map((p) => patientRow(p, t)).join("")
    : `<p class="glbab-note">${esc(t("GLBAB.treat.noPatients"))}</p>`;
  const refusal = m.refusal ? `<p class="glbab-note" data-tone="bad">${esc(t(`GLBAB.refuse.${m.refusal}`, m.refusalData ?? {}))}</p>` : "";
  return `<div class="glbab-app">
    <nav class="glbab-tabs">${kinds}</nav>
    <div class="glbab-grid">
      <label class="glbab-field"><span>${esc(t("GLBAB.treat.healer"))}</span><select data-bab-field="healer">${healers}</select></label>
      <label class="glbab-field"><span>${esc(t("GLBAB.treat.dc"))}</span><select data-bab-field="rank"${m.dcs.length ? "" : " disabled"}>${dcs}</select></label>
    </div>
    <div class="glbab-grid">${surgeon}${assurance}</div>
    <p class="glbab-lede">${esc(t(m.kind === "battle" ? "GLBAB.treat.ledeBattle" : "GLBAB.treat.lede", { limit: m.limit }))}</p>
    <div class="glbab-patients">${patients}</div>
    ${refusal}
    <footer class="glbab-foot">
      ${button("refreshTargets", t("GLBAB.treat.fromTargets"))}
      ${button("run", t(m.kind === "battle" ? "GLBAB.treat.runBattle" : "GLBAB.treat.run"), { disabled: !m.canRun, tone: "good" })}
    </footer>
  </div>`;
}

function patientRow(p, t) {
  const choice = ["pay", "decline"]
    .map((c) => `<option value="${c}"${(c === "decline") === p.declines ? " selected" : ""}>${esc(t(`GLBAB.treat.choice.${c}`))}</option>`)
    .join("");
  const preview = p.surgeon
    ? t("GLBAB.treat.previewSurgeon", { minimum: p.minimum })
    : p.unpaidReason
      ? t(`GLBAB.unpaid.${p.unpaidReason}`)
      : t("GLBAB.treat.previewPaid", { minimum: p.minimum });
  return `<div class="glbab-patient" data-actor-id="${attr(p.id)}" data-kind="${p.surgeon ? "surgeon" : p.unpaidReason ? "unpaid" : "paid"}">
    <span class="glbab-patient-name">${esc(p.name)}</span>
    <span class="glbab-rest-pools glbab-numeric">
      <span data-pool="hp">${p.hp}<i>/${p.maxHP}</i></span>
      <span data-pool="rp">${p.rp}<i>/${p.maxRP}</i></span>
    </span>
    <select data-bab-field="choice"${p.surgeon || p.immune ? " disabled" : ""}>${choice}</select>
    <span class="glbab-patient-preview">${esc(p.immune ? t("GLBAB.refuse.bmImmune") : preview)}</span>
    <button type="button" class="glbab-x" data-bab-action="dropPatient" aria-label="${attr(t("GLBAB.treat.drop"))}" data-tooltip-text="${attr(t("GLBAB.treat.drop"))}">×</button>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   DIALOGS
   ══════════════════════════════════════════════════════════════════════════ */

/** The applying user's healing dialog: the kind (changeable), and the patient's pay or decline. */
export function healDialogHTML(m, t) {
  const kinds = ["spent", "paid"]
    .map((k) => `<option value="${k}"${m.kind === k ? " selected" : ""}>${esc(t(`GLBAB.kind.${k}`))}</option>`)
    .join("");
  const choice = m.unpaidReason
    ? `<p class="glbab-note" data-tone="warn">${esc(t(`GLBAB.unpaid.${m.unpaidReason}`))}</p>`
    : `<label class="glbab-field"><span>${esc(t("GLBAB.heal.patient", { name: m.name }))}</span><select name="choice">${["pay", "decline"]
        .map((c) => `<option value="${c}"${(c === "decline") === m.declines ? " selected" : ""}>${esc(t(`GLBAB.treat.choice.${c}`))}</option>`)
        .join("")}</select></label>`;
  return `<div class="glbab-dialog">
    <p class="glbab-lede">${esc(t("GLBAB.heal.lede", { name: m.name, amount: m.amount }))}</p>
    <div class="glbab-grid">
      <label class="glbab-field"><span>${esc(t("GLBAB.heal.kind"))}</span><select name="kind">${kinds}</select></label>
      <span class="glbab-why">${esc(t(`GLBAB.why.${m.why}`))}</span>
    </div>
    <div class="glbab-paid-only">${choice}
      <p class="glbab-note">${esc(t("GLBAB.heal.paidRule", { minimum: m.minimum, rp: m.rp }))}</p>
    </div>
    <p class="glbab-note">${esc(t("GLBAB.heal.spentRule"))}</p>
    ${m.repeating ? `<p class="glbab-note" data-tone="info">${esc(t("GLBAB.heal.repeating"))}</p>` : ""}
  </div>`;
}

export function holdOnDialogHTML(m, t) {
  return `<div class="glbab-dialog">
    <p class="glbab-lede">${esc(t("GLBAB.holdOn.lede", { name: m.name, dying: m.dying, rp: m.rp }))}</p>
    <p class="glbab-note">${esc(t("GLBAB.holdOn.rule"))}</p>
  </div>`;
}

export function directDialogHTML(m, t) {
  return `<div class="glbab-dialog">
    <p class="glbab-lede">${esc(t("GLBAB.direct.lede", { name: m.name }))}</p>
    <label class="glbab-field"><span>${esc(t("GLBAB.gm.directAmount"))}</span><input type="number" name="amount" min="0" step="1" value="${Number(m.amount) || 0}"></label>
  </div>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   CHAT
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * One short card: a title and one line per creature.
 *   { title: {k, d}, tone, rows: [{ name, lines: [{k, d}] }], foot: {k, d} | null }
 */
export function chatCardHTML(m, t) {
  const line = (l) => `<li>${esc(t(l.k, l.d ?? {}))}</li>`;
  const rows = (m.rows ?? [])
    .map(
      (r) => `<div class="glbab-card-row">
        ${r.name ? `<span class="glbab-card-name">${esc(r.name)}</span>` : ""}
        <ul class="glbab-card-lines">${(r.lines ?? []).map(line).join("")}</ul>
      </div>`,
    )
    .join("");
  return `<section class="glbab-card"${m.tone ? ` data-tone="${m.tone}"` : ""}>
    <header class="glbab-card-head">${esc(t(m.title.k, m.title.d ?? {}))}</header>
    ${rows}
    ${m.foot ? `<footer class="glbab-card-foot">${esc(t(m.foot.k, m.foot.d ?? {}))}</footer>` : ""}
  </section>`;
}
