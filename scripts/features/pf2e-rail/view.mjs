/**
 * PF2e HUD — the bottom rail, for playing a PF2e turn without the sheet.
 *
 * A PF2e turn is three actions and a reaction, so the rail is built around
 * the action economy rather than around a sheet. One rail along the bottom
 * edge, 96px and never taller, in Ink and Signal's frame (black plates a
 * tone step apart, inset hairlines, the bottom-right cut). Left to right for
 * a player:
 *
 *   plinth    the character, standing ON the rail and rising out of it, with
 *             the Hero Points as the light behind them
 *   vitals    AC, Hit Points (temp riding over them, Stamina under), the
 *             shield and its Raise, then Perception and the three saves
 *   strikes   one row per strike: the three MAP presses, damage, critical,
 *             with the next MAP step underlined
 *   deck      one plate, four tabs, each drawn in the shape of what it holds:
 *             Spells (cards fanned up out of the rail, one rank at a time),
 *             Actions (rows in PF2e's action glyph), Skills (every skill and
 *             Lore as a one-press check, named whole), Items (tiles)
 *   util      rest, macros, the sheet
 *
 * Over the strikes and the deck, on the rail's top edge, rides the turn bar
 * in an encounter (the actions you have left, the MAP step, whose turn it
 * is) or the exploration bar out of one (what the character is doing while
 * the party travels). The two modes are the same rail re-weighted: in an
 * encounter the strikes open to their three MAP presses, exploring they
 * close to one.
 *
 * The GM's rail swaps everything after the plinth for the creature panel
 * (or the hazard panel) and a hand of every non-PC token on the scene. Over
 * the creature panel rides the stat bar: what changes the damage it takes
 * and the abilities it has without a press. On
 * both rails the party is the stack of ringed seats above the plinth.
 *
 * The skill sheet (`FINDER`) rises over the rail: a row per skill, its
 * head the plain check, beside it every action that skill rolls, each
 * carrying the defence it targets and — where the party knows the number —
 * the odds, an attack-trait action its three MAP steps. Nothing on it is
 * folded; typing only narrows it.
 *
 * This file is pure: every builder takes a plain model and a `t(key, data)`
 * translator and returns markup. It reaches no `game`, no `canvas` and no
 * DOM, so the preview page, the check tool and Foundry draw the same rail.
 * It never decides who may see what: a field the model does not carry is a
 * field the rail does not draw, and the model is built by the host after the
 * permission test (a DC the party does not know arrives as `null`). Nothing
 * here knows what a press does either; gestures attach to the data-*
 * handles (see `HANDLES`). Rules text (`text`) arrives as HTML the host has
 * already enriched and sanitised, exactly as the sheet prints it, and is the
 * one field printed unescaped.
 */
import { escapeHTML as esc } from "../../core/util.mjs";
import { ICON, costGlyph } from "./icons.mjs";
import { actionIcon } from "./action-icons.mjs";
import { GM_MOVES, LOW_HEALTH_AT, SAVES, STRIKE_ROWS } from "./const.mjs";
import { actionsLeft } from "./shape.mjs";

/** Every gesture handle the rail draws, for the host and the check tool. */
export const HANDLES = Object.freeze([
  "data-act", "data-hero", "data-pip", "data-check", "data-strike", "data-variant", "data-dmg", "data-crit",
  "data-toggle", "data-stance", "data-action", "data-spell", "data-rank-step", "data-tab", "data-item",
  "data-skill-action", "data-stat", "data-find", "data-explore", "data-drawer", "data-row",
  "data-seat", "data-foe", "data-pa", "data-reload",
]);

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");
const SR = (s) => `<span class="gph-sr">${s}</span>`;
const frac = (v, max) => (max > 0 ? Math.max(0, Math.min(1, v / max)) : 0);
const costKey = (c) => `GLRAIL.cost.${String(c).includes("-") ? "range" : c}`;
const glyph = (c, t) => (c != null ? costGlyph(c, t(costKey(c), { cost: c })) : "");

/* ── the plinth ───────────────────────────────────────────────────
   The character stands on the rail. The plate is the rail's height; the
   picture is taller and is let out of the top. A painting fades into the
   map where it leaves, so it has no hard edge above the bar; a cut-out
   (`cutout`: the token ring's subject texture, or a transparent figure) has
   its own edge and stands with a contact shadow instead.

   Hero Points are amber gems in a column on the plinth's edge, amber because
   a Hero Point is the one thing on the sheet that is pure player agency. No
   light stands behind the figure: the picture is the character's own.

   The sub line is class and level (`sub`) and Speed (`speed`), never the
   ancestry: the line is one plinth wide and both are numbers someone acts on.

   The frame (`--fdx/--fdy` in percent of the figure, `--fz` the zoom) is the
   owner's, from the actor's `ph.frame` flag; the default is the whole
   picture, contained and standing on the rail. */
export const frameVars = (f) => (f ? `--fdx:${+f.x || 0};--fdy:${+f.y || 0};--fz:${+f.scale || 1}` : "");

const heroGems = (hero, t, readonly) => {
  const [cur, max] = hero;
  return `<span class="gph-gems" data-pool="hero" role="group" aria-label="${esc(t("GLRAIL.hero.name"))}">${
    Array.from({ length: max }, (_, i) => `<button type="button" class="gph-gem${i < cur ? " on" : ""}" data-hero="${i + 1}"${readonly ? ' tabindex="-1"' : ""} aria-label="${esc(t("GLRAIL.hero.gem", { i: i + 1, max }))}" aria-pressed="${i < cur}"></button>`).join("")
  }<span class="gph-sr" data-hero-n>${esc(t("GLRAIL.hero.count", { n: cur, max }))}</span></span>`;
};

const dyingPlate = (d, t) => `
  <span class="gph-dying" role="img" aria-label="${esc(t("GLRAIL.dying.said", { n: d.value, max: d.max }))}">
    <b>${esc(t("GLRAIL.dying.label"))}</b>
    <span class="gph-beads">${Array.from({ length: d.max }, (_, i) => `<i class="${i < d.value ? "on" : ""}"></i>`).join("")}</span>
  </span>`;

/* Conditions and effects ride just above the name, where the figure meets
   the rail. A chip prints its value, because Frightened 2 and Frightened 1
   are different rolls; one that hurts takes the red edge, one that helps
   the green. A press on any of them opens the effects drawer. */
const condChip = (c) => `
    <li><button type="button" class="gph-cond" data-drawer="effects"${c.tone ? ` data-tone="${c.tone}"` : ""} title="${esc([c.value ? `${c.name} ${c.value}` : c.name, c.note].filter(Boolean).join(" · "))}">
      ${c.icon ? `<img src="${esc(c.icon)}" alt="">` : ""}<span class="gph-cn">${esc(c.name)}</span>${c.value ? `<b>${c.value}</b>` : ""}</button></li>`;

/* They sit in the nameplate's own flow, so a long name or a second row of
   chips pushes the stack up instead of under. Five at most; the rest are a
   count that opens the effects drawer, which lists them all. */
const COND_CAP = 5;
const condList = (conds, t) => {
  const shown = conds.length > COND_CAP ? conds.slice(0, COND_CAP - 1) : conds;
  const more = conds.length - shown.length;
  return `<ul class="gph-conds" aria-label="${esc(t("GLRAIL.conds"))}">${shown.map(condChip).join("")}${more ? `
    <li><button type="button" class="gph-cond is-more" data-drawer="effects" aria-label="${esc(t("GLRAIL.more", { n: more }))}"><b>+${more}</b></button></li>` : ""}</ul>`;
};

export const PLINTH = (p, t, { readonly = false } = {}) => {
  const state = p.dead ? "dead" : p.dying ? "dying" : "";
  return `
<section class="gph-plinth${p.cutout ? " is-cut" : ""}" data-plinth data-kind="${esc(p.kind ?? "character")}"${state ? ` data-state="${state}"` : ""}${p.turn ? " data-turn" : ""}${p.frame ? ` style="${frameVars(p.frame)}"` : ""}>
  <span class="gph-plate"></span>
  <span class="gph-fig" aria-hidden="true"><span class="gph-img"${p.cutout || p.img ? ` style="background-image:url('${esc(p.cutout || p.img)}')"` : ""}></span></span>
  ${p.frameable ? `<button type="button" class="gph-frm" data-act="frame" title="${esc(t("GLRAIL.frame.title"))}" aria-label="${esc(t("GLRAIL.frame.label"))}">${ICON.frame}</button>
  <span class="gph-frhint" aria-hidden="true">${esc(t("GLRAIL.frame.hint"))}</span>` : ""}
  ${p.hero ? heroGems(p.hero, t, readonly) : ""}
  <span class="gph-nameplate">
    ${p.conds?.length ? condList(p.conds, t) : ""}
    ${readonly && !p.dead && !p.dying ? `<span class="gph-watch">${esc(t("GLRAIL.observing"))}</span>` : ""}
    ${p.dead ? `<span class="gph-dead">${esc(t("GLRAIL.dead"))}</span>` : p.dying ? dyingPlate(p.dying, t) : ""}
    <b title="${esc(p.name)}">${esc(p.name)}</b>
    <span class="gph-sub"><span class="gph-subt">${esc(p.sub ?? "")}</span>${p.speed ? `<span class="gph-spd">${esc(p.speed)}</span>` : ""}${p.hp ? `<span class="gph-fhp" data-fold-hp${hpState(...p.hp) ? ' data-state="low"' : ""}><b>${p.hp[0]}</b><s>/${p.hp[1]}</s>${SR(` ${t("GLRAIL.vitals.hpName")}`)}</span>` : ""}</span>
  </span>
  ${p.fold === false ? "" : `<button type="button" class="gph-fold" data-act="fold" aria-label="${esc(t(p.folded ? "GLRAIL.fold.show" : "GLRAIL.fold.hide"))}" aria-expanded="${!p.folded}">${ICON.fold}</button>`}
</section>`;
};

/* ── the Hit Point meter ──────────────────────────────────────────
   PF2e's Hit Points run to the hundreds, so they are a length, not boxes:
   the numeral first and loudest, the bar under it. Paper at rest, red under
   a quarter (the resource bars' `LOW_HEALTH_AT`, so the token's bar and the
   rail turn together). The half mark is a tick, not a colour event — PF2e
   has no bloodied rule. Temporary Hit Points ride over the bar as an info
   line from its start. A loss leaves a chip trail: the lost length stays
   lit in red for a beat and then drains (`--gph-was`, driven by drive.mjs),
   the one place on the rail a number is allowed to be felt.

   The big numeral is a press: it opens a field in its own place (drive.mjs
   `editMeter`) that takes what a table says out loud — "−12", "+5", or the
   new total. Damage and healing typed there go through PF2e's own
   `applyDamage`, so temporary Hit Points absorb first and dying follows. */
export const hpState = (value, max) => (max > 0 && value / max <= LOW_HEALTH_AT ? "low" : "");

export const METER = (kind, m, t, { big = true } = {}) => {
  const v = frac(m.value, m.max), tmp = frac(m.temp ?? 0, m.max);
  const low = kind === "hp" && hpState(m.value, m.max);
  const name = t(kind === "sp" ? "GLRAIL.vitals.spName" : "GLRAIL.vitals.hpName");
  return `
<div class="gph-meter${big ? "" : " is-small"}" data-meter="${kind}" data-max="${m.max}"${low ? ` data-state="${low}"` : ""} style="--gph-v:${v.toFixed(4)};--gph-was:${v.toFixed(4)};--gph-tmp:${tmp.toFixed(4)}">
  ${big ? `<span class="gph-mn"><button type="button" class="gph-hpb" data-act="hp" title="${esc(t("GLRAIL.hp.title"))}"><b data-v>${m.value}</b><s>/${m.max}</s>${SR(` ${name}`)}</button><em data-tmp${m.temp ? "" : " hidden"}>${esc(t("GLRAIL.vitals.temp", { n: m.temp ?? 0 }))}</em></span>` : ""}
  <span class="gph-bar" role="meter" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="${m.max}" aria-valuenow="${m.value}"${big ? "" : ` title="${esc(`${name} ${m.value}/${m.max}`)}"`}>
    <i class="gph-chip"></i><i class="gph-fill"></i><i class="gph-half"></i><i class="gph-tmp"></i></span>
  ${big ? "" : `<span class="gph-mk" aria-hidden="true">${esc(t(kind === "sp" ? "GLRAIL.vitals.sp" : "GLRAIL.vitals.hp"))}</span><span class="gph-ms" aria-hidden="true"><b data-v>${m.value}</b></span>`}
</div>`;
};

/* ── vitals ───────────────────────────────────────────────────────
   AC is the number every attack against you is rolled at, so it is the tile
   the plate leads with; the Hit Points beside it are the number you watch.
   The shield is a press because Raise a Shield is the defensive action taken
   every round; a broken one says so in red where its Raise would be. The
   four checks a GM calls for without warning sit along the foot. */
const SHIELD = (s, t) => {
  const state = s.destroyed ? "destroyed" : s.broken ? "broken" : s.raised ? "raised" : "";
  const label = s.broken || s.destroyed ? t(s.destroyed ? "GLRAIL.shield.destroyed" : "GLRAIL.shield.broken")
    : t(s.raised ? "GLRAIL.shield.raised" : "GLRAIL.shield.raise");
  return `<button type="button" class="gph-shd" data-act="raise" data-cost="1"${state ? ` data-state="${state}"` : ""} aria-pressed="${!!s.raised}"${s.broken || s.destroyed ? ' aria-disabled="true"' : ""}
    title="${esc(t("GLRAIL.shield.title", { name: s.name, hp: s.hp, max: s.max, h: s.hardness, bt: s.bt, ac: s.ac }))}">
    ${ICON.shield}<span class="gph-shn"><b data-v>${s.hp}</b>/${s.max}</span><span class="gph-shh">${esc(t("GLRAIL.shield.hardness", { n: s.hardness }))}</span><em>${esc(label)}</em></button>`;
};

const CHECK = (key, mod, t, short) => `<button type="button" class="gph-chk" data-check="${key}" title="${esc(t("GLRAIL.check.roll", { name: t(`GLRAIL.check.${key}`) }))}">
      <span>${esc(t(`GLRAIL.check.${short}`))}</span><b>${sign(mod)}</b></button>`;

export const VITALS = (v, t) => `
<section class="gph-pl gph-vitals" data-vitals aria-label="${esc(t("GLRAIL.vitals.label"))}">
  <div class="gph-ac" role="img" aria-label="${esc(t("GLRAIL.vitals.acSaid", { n: v.ac }))}"><span aria-hidden="true">${esc(t("GLRAIL.vitals.ac"))}</span><b aria-hidden="true">${v.ac}</b></div>
  <div class="gph-life">
    ${METER("hp", v.hp, t)}
    ${v.sp ? METER("sp", v.sp, t, { big: false }) : ""}
    <div class="gph-vfoot">${v.shield ? SHIELD(v.shield, t) : ""}${v.classDC != null ? `<span class="gph-cdc">${esc(t("GLRAIL.vitals.classDC"))} <b>${v.classDC}</b></span>` : ""}</div>
  </div>
  <div class="gph-checks">
    ${CHECK("perception", v.perception, t, "perceptionShort")}
    ${SAVES.map((s) => CHECK(s, v.saves[s], t, `${s}Short`)).join("")}
  </div>
</section>`;

/* ── the turn bar / the exploration bar ───────────────────────────
   Rides the rail's top edge over the strikes and the deck, because that is
   where the actions it counts are spent. In an encounter: whose turn it is,
   the actions you have left as PF2e's diamonds (the maximum is the rules'
   — three, one more while Quickened, fewer while Slowed or Stunned — and
   the spending is this screen's own count, never stored), the reaction,
   and the MAP step the next attack is rolled at. Exploring: the activity
   the character is doing while the party travels, as PF2e records it. */
/* MAP is printed on your own turn only: off-turn it is always 0, and the
   owner's name needs the room. */
export const TURNBAR = (tb, t) => {
  if (tb.mode === "exploration") return `
<div class="gph-turnbar is-explore" data-turnbar>
  <span class="gph-tb-k">${esc(t("GLRAIL.turnbar.exploring"))}</span>
  <span class="gph-tb-acts">${(tb.activities ?? []).filter((a) => a.on).slice(0, 1).map((a) => `<button type="button" class="gph-tog on" data-explore="${esc(a.id)}" aria-pressed="true"><span>${esc(a.name)}</span></button>`).join("") || `<span class="gph-none">${esc(t("GLRAIL.turnbar.idle"))}</span>`}</span>
  ${(() => { const extra = (tb.activities ?? []).filter((a) => a.on).length - 1; return `<button type="button" class="gph-tb-more" data-act="explore" aria-label="${esc(t("GLRAIL.turnbar.chooseActivity"))}">${extra > 0 ? `<b>+${extra}</b>` : ""}${ICON.more}</button>`; })()}
</div>`;
  const e = tb.economy ?? { max: 3, spent: 0, reaction: true };
  const left = actionsLeft({ ...tb, economy: e });
  return `
<div class="gph-turnbar${tb.mine ? " is-mine" : ""}${tb.next && !tb.mine ? " is-next" : ""}" data-turnbar data-left="${left}">
  ${tb.next && !tb.mine
    ? `<span class="gph-tb-k" role="status" title="${esc(t("GLRAIL.turnbar.theirs", { name: tb.current ?? "" }))}"><span>${esc(tb.observer != null ? t("GLRAIL.turnbar.nextOf", { name: tb.observer }) : t("GLRAIL.turnbar.next"))}</span>${SR(`. ${t("GLRAIL.turnbar.theirs", { name: tb.current ?? "" })}.${tb.observer != null ? "" : ` ${t("GLRAIL.turnbar.nextSaid")}`}`)}</span>`
    : `<span class="gph-tb-k"><span>${esc(tb.mine ? (tb.observer != null ? t("GLRAIL.turnbar.theirs", { name: tb.observer }) : t("GLRAIL.turnbar.yours")) : t("GLRAIL.turnbar.theirs", { name: tb.current ?? "" }))}</span></span>`}
  <span class="gph-econ" role="group" aria-label="${esc(t("GLRAIL.turnbar.said", { left, max: e.max }) + (e.reaction ? ` ${t("GLRAIL.turnbar.reactionReady")}` : ""))}">
    ${Array.from({ length: e.max }, (_, i) => `<button type="button" class="gph-pip${i < left ? " on" : ""}${i >= 3 ? " is-extra" : ""}" data-pip="${i}" style="--i:${i}"${i >= 3 && e.note ? ` title="${esc(e.note)}"` : ""} aria-label="${esc(t("GLRAIL.turnbar.pip", { i: i + 1, max: e.max }))}" aria-pressed="${i < left}"></button>`).join("")}
    <button type="button" class="gph-pip is-react${e.reaction ? " on" : ""}" data-pip="r" style="--i:${e.max}" aria-label="${esc(t("GLRAIL.cost.r"))}" aria-pressed="${!!e.reaction}">${costGlyph("r")}</button>
  </span>
  ${e.note ? SR(e.note) : ""}
  ${tb.mine ? `<span class="gph-tb-map" aria-live="polite">${esc(t("GLRAIL.turnbar.map"))} <b data-map-n>${["0", "−5", "−10"][tb.map ?? 0]}</b></span>` : ""}
</div>`;
};

/* ── strikes ──────────────────────────────────────────────────────
   A strike is a row of PF2e's own chat-card buttons: the three attack
   variants with the multiple attack penalty already in them, then Damage and
   Critical, so the rail and the card read the same. The three steps are
   equal and keep still; the turn bar says which one is next. A weapon that
   must be reloaded (PF2e Ranged Combat) carries a Reload press beside its
   name, lit while it is empty. A weapon not in hand dims and says why
   before it is pressed. Exploring, the row closes to its first attack. */
/* `s.short` is what the weapon IS (PF2e's base item, "Greatsword"; a
   blast's element, and its range when it has one, "Water 30 ft") — the word that tells two
   rows apart, which a name cut from its end loses first behind its runes.
   The whole name rides the title and the peek. */
const STRIKE = (s, t) => {
  const short = s.ready === false;
  return `
  <div class="gph-stk${short ? " is-short" : ""}${s.kind === "blast" ? " is-blast" : ""}${s.reload ? " has-reload" : ""}" data-strike-row="${esc(s.id)}">
    <button type="button" class="gph-stn" data-strike="${esc(s.id)}" data-act="peek-strike" title="${esc(s.name)}${short ? ` · ${esc(t("GLRAIL.strike.notReady"))}` : ""}">
      ${s.img ? `<img src="${esc(s.img)}" alt="">` : ""}<b>${esc(s.short ?? s.name)}</b>${short ? SR(`, ${t("GLRAIL.strike.notReady")}`) : ""}</button>
    ${s.reload ? `<button type="button" class="gph-rld${s.reload.loaded ? " is-loaded" : ""}" data-reload="${esc(s.id)}"${s.reload.cost ? ` data-cost="${s.reload.cost}"` : ""} title="${esc(t(s.reload.loaded ? "GLRAIL.strike.loaded" : "GLRAIL.strike.empty"))}" aria-label="${esc(t("GLRAIL.strike.reload", { name: s.name }) + ", " + t(s.reload.loaded ? "GLRAIL.strike.loaded" : "GLRAIL.strike.empty"))}">${ICON.reload}</button>` : ""}
    ${[0, 1, 2].map((i) => s.variants[i] != null
      ? `<button type="button" class="gph-map" data-strike="${esc(s.id)}" data-variant="${i}" data-cost="1" data-attack${short ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.strike.attack", { name: s.name, mod: s.variants[i] }))}">${esc(s.variants[i])}</button>`
      : '<span class="gph-map is-none" aria-hidden="true"></span>').join("")}
    <button type="button" class="gph-dmg" data-dmg="${esc(s.id)}" title="${esc(s.damage ?? "")}" aria-label="${esc(t("GLRAIL.strike.dmgSaid", { name: s.name, f: s.damage ?? "" }))}">${esc(t("GLRAIL.strike.dmg"))}</button>
    <button type="button" class="gph-dmg is-crit" data-crit="${esc(s.id)}" title="${esc(s.critical ?? "")}" aria-label="${esc(t("GLRAIL.strike.critSaid", { name: s.name, f: s.critical ?? "" }))}">${esc(t("GLRAIL.strike.crit"))}</button>
  </div>`;
};

export const STRIKES = ({ list }, t) => {
  if (!list?.length) return `<section class="gph-pl gph-strikes is-none" aria-label="${esc(t("GLRAIL.strike.label"))}"><span class="gph-none">${esc(t("GLRAIL.strike.none"))}</span></section>`;
  const shown = list.length > STRIKE_ROWS ? list.slice(0, STRIKE_ROWS - 1) : list;
  const more = list.length - shown.length;
  return `
<section class="gph-pl gph-strikes" data-rows="${shown.length + (more ? 1 : 0)}" aria-label="${esc(t("GLRAIL.strike.label"))}">${shown.map((s) => STRIKE(s, t)).join("")}${more ? `
  <button type="button" class="gph-row is-more" data-drawer="strikes"><b>${esc(t("GLRAIL.more", { n: more }))}</b>${ICON.more}</button>` : ""}
</section>`;
};

/* ── the deck ─────────────────────────────────────────────────────
   One plate, four tabs down its left edge, so the plate's whole height is
   content and the tabs never compete with the cards that rise out of it.
   The marker travels between tabs; the pane changes under it. The deck is
   the one plate that grows: on a wide screen a tab simply shows more of
   itself. The ⤢ press (or typing, on Skills) opens the tab whole, as a
   panel rising over the deck. */
const TAB_ICON = { spells: "spells", actions: "actions", skills: "skills", items: "inventory" };

const TABS = (d, t) => `
  <div class="gph-tabs" role="tablist" aria-orientation="vertical" style="--gph-tab:${Math.max(0, d.tabs.findIndex((x) => x.key === d.tab))}">
    ${d.tabs.map((x) => `<button type="button" class="gph-tab${x.key === d.tab ? " on" : ""}" role="tab" data-tab="${x.key}" aria-selected="${x.key === d.tab}" title="${esc(t(`GLRAIL.tab.${x.key}`))}">
      ${ICON[TAB_ICON[x.key]]}<span>${esc(t(`GLRAIL.tab.${x.key}`))}</span>${x.count != null ? `<b>${x.count}</b>` : ""}</button>`).join("")}
    <i class="gph-tabmark" aria-hidden="true"></i>
  </div>`;

/* Spells. A spell is a card with a face and a slot is literally a limit, so
   the spells are held the way a hand of cards is: true-size compact cards
   fanned up out of the rail, never shrunk to fit 96px. A caster at level
   nine knows more spells than any fan can hold legibly, so the hand holds
   one rank at a time and the rank dial chooses which, with that rank's
   slots under the numeral. An expended prepared slot is still a card, put
   down; an empty one is a socket. */
const rankName = (k, t) => (k === "c" ? t("GLRAIL.rank.cantrips") : k === "f" ? t("GLRAIL.rank.focus") : t("GLRAIL.rank.n", { n: k }));
const rankMark = (k, t) => (k === "c" ? t("GLRAIL.rank.c") : k === "f" ? t("GLRAIL.rank.f") : String(k));
const pips = ([left, max], cls = "gph-slots") => `<span class="${cls}" aria-hidden="true">${Array.from({ length: max }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("")}</span>`;

const DIAL = (h, t) => {
  const r = h.ranks.find((x) => x.key === h.rank) ?? h.ranks[0];
  const idx = h.ranks.indexOf(r);
  const said = t("GLRAIL.rank.said", { rank: rankName(r.key, t), n: r.cards }) + (r.slots ? ` ${t("GLRAIL.rank.slotsSaid", { left: r.slots[0], max: r.slots[1] })}` : "");
  return `
  <div class="gph-dial">
    <div class="gph-dialrow">
      <button type="button" class="gph-step" data-rank-step="-1"${idx <= 0 ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.rank.prev"))}">${ICON.prev}</button>
      <button type="button" class="gph-rk" data-act="ranks" aria-label="${esc(said)}" aria-haspopup="dialog">
        <span aria-hidden="true">${esc(t(r.key === "c" ? "GLRAIL.rank.cLabel" : r.key === "f" ? "GLRAIL.rank.fLabel" : "GLRAIL.rank.label"))}</span><b aria-hidden="true">${esc(rankMark(r.key, t))}</b></button>
      <button type="button" class="gph-step" data-rank-step="1"${idx >= h.ranks.length - 1 ? ' aria-disabled="true"' : ""} aria-label="${esc(t("GLRAIL.rank.next"))}">${ICON.next}</button>
    </div>
    ${r.key === "f" && h.focus ? pips(h.focus, "gph-slots is-focus") : r.slots ? pips(r.slots) : '<span class="gph-slots is-free" aria-hidden="true"></span>'}
    <span class="gph-sdc">${h.dc != null ? `${esc(t("GLRAIL.spell.dc"))} <b>${h.dc}</b>` : ""}${h.atk != null ? ` <b>${sign(h.atk)}</b>` : ""}</span>
  </div>`;
};

const CARD = (c, t) => {
  if (c.socket) return `<span class="gph-card is-socket" aria-label="${esc(t("GLRAIL.spell.empty"))}"><span class="gph-pen">${esc(rankMark(c.rank, t))}</span><b class="gph-cname">${esc(t("GLRAIL.spell.empty"))}</b></span>`;
  const costSaid = c.cost != null ? t(costKey(c.cost), { cost: c.cost }) : "";
  return `<button type="button" class="gph-card${c.spent ? " is-spent" : ""}" data-spell="${esc(c.id)}"${c.cost != null && /^[123]$/.test(String(c.cost)) ? ` data-cost="${c.cost}"` : ""}${c.entry ? ` data-entry="${esc(c.entry)}"` : ""}${c.slot != null ? ` data-slot="${c.slot}"` : ""}
    aria-label="${esc([c.name, rankName(c.rank, t), costSaid, c.spent ? t("GLRAIL.spell.spent") : ""].filter(Boolean).join(", "))}">
    <span class="gph-art"${c.img ? ` style="background-image:url('${esc(c.img)}')"` : ""}></span>
    <span class="gph-pen" aria-hidden="true">${esc(rankMark(c.heightened ?? c.rank, t))}</span>
    ${c.cost != null ? `<span class="gph-ccost" aria-hidden="true">${costGlyph(c.cost)}</span>` : ""}
    <b class="gph-cname" aria-hidden="true">${esc(c.name)}</b>
  </button>`;
};

const FAN = (items, cls, label) => {
  const mid = (items.length - 1) / 2;
  return `<div class="gph-fan${cls}" style="--n:${items.length}" aria-label="${esc(label)}">${items.map((it, i) =>
    `<div class="gph-held${it.sel ? " is-sel" : ""}${it.socket ? " is-socket" : ""}" style="--t:${((i - mid) * Math.min(1, 3 / Math.max(mid, 1))).toFixed(2)};--z:${i + 1}">${it.html}</div>`).join("")}</div>`;
};

export const SPELLS = (h, t) => {
  const r = h.ranks.find((x) => x.key === h.rank) ?? h.ranks[0];
  const cards = h.cards.filter((c) => c.rank === r.key);
  return `${DIAL(h, t)}
  ${cards.length ? FAN(cards.map((c) => ({ socket: !!c.socket, html: CARD(c, t) })), "", t("GLRAIL.spell.handSaid", { rank: rankName(r.key, t), n: cards.length }))
    : `<span class="gph-none gph-pane-none">${esc(t("GLRAIL.spell.noneAtRank"))}</span>`}`;
};

/* Actions. Toggles first, as chips: the switches players open the sheet
   mid-fight to flip, and the one thing on this tab that is a state rather
   than a move. Then the stances, the active one lit; then everything the
   character owns with an action cost, in PF2e's glyph, with what is left of
   its frequency as round pips. */
const freqRead = (f, t) => f ? `<span class="gph-freq" title="${esc(t("GLRAIL.freq.title", { left: f.max - f.used, max: f.max, per: f.per }))}">${
  Array.from({ length: f.max }, (_, i) => `<i class="${i < f.max - f.used ? "on" : ""}"></i>`).join("")}${SR(t("GLRAIL.freq.title", { left: f.max - f.used, max: f.max, per: f.per }))}</span>` : "";

const ACTION_ROW = (a, t) => {
  const spent = a.freq && a.freq.used >= a.freq.max;
  return `<button type="button" class="gph-row${a.stance ? " is-stance" : ""}${a.active ? " is-on" : ""}${spent ? " is-spent" : ""}" ${a.stance ? "data-stance" : "data-action"}="${esc(a.id)}"${/^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""}${a.active ? ' aria-pressed="true"' : ""}>
    <span class="gph-cost">${glyph(a.cost, t)}</span><b>${esc(a.name)}</b>${spent ? SR(`, ${t("GLRAIL.freq.spent")}`) : ""}${freqRead(a.freq, t)}</button>`;
};

export const ACTIONS = ({ toggles = [], list = [] }, t) => `
  <div class="gph-actpane${toggles.length ? " has-toggles" : ""}">
    ${toggles.length ? `<div class="gph-togs">${toggles.map((g) => `<button type="button" class="gph-tog${g.on ? " on" : ""}" data-toggle="${esc(g.id)}" aria-pressed="${!!g.on}" title="${esc(g.label)}"><span>${esc(g.label)}</span></button>`).join("")}</div>` : ""}
    <div class="gph-arows">${list.length ? list.map((a) => ACTION_ROW(a, t)).join("") : `<span class="gph-none">${esc(t("GLRAIL.actions.none"))}</span>`}</div>
  </div>`;

/* Skills, in the rail. A GM says "roll Athletics" far more often than
   anybody goes looking for an action, so the tab leads with every skill
   and Lore as a plain check, in the sheet's own order, where it never
   moves: one press, no panel, no typing. Beside them are the actions worth
   reaching for right now (the pins first), which the host chooses from the
   mode, the target and the character's pins. An action with the attack
   trait is a strike's row in small: its three MAP steps, equal and still. */
const ODDS = (vs, t) => {
  if (!vs) return "";
  const dc = vs.dc == null ? t("GLRAIL.skill.unknown") : String(vs.dc);
  const chance = vs.chance == null ? "" : Array.isArray(vs.chance) ? `${Math.round(vs.chance[0] * 100)}–${Math.round(vs.chance[1] * 100)}%` : `${Math.round(vs.chance * 100)}%`;
  return `<span class="gph-vs${vs.dc == null ? " is-unknown" : ""}" title="${esc(t("GLRAIL.skill.vsTitle", { stat: vs.label, dc }))}">
    <span class="gph-vsk">${esc(vs.label)}</span><em${oddsTone(vs.chance) ? ` data-tone="${oddsTone(vs.chance)}"` : ""}>${chance || (vs.dc == null ? esc(dc) : esc(t("GLRAIL.skill.dcShort", { dc })))}</em>${chance ? SR(t("GLRAIL.skill.chanceSaid", { chance })) : ""}</span>`;
};

const RANK_TAG = (rank, t) => (rank == null ? "" : `<i class="gph-tag" data-rank="${rank}" title="${esc(t(`GLRAIL.prof.${rank}`))}">${esc(t(`GLRAIL.prof.${rank}Short`))}</i>`);

/* What a press of this action addresses: the action, and the skill of the
   row it stands in where the sheet offers it under several. */
const ACT = (a) => `data-skill-action="${esc(a.id)}"${a.stat ? ` data-stat="${esc(a.stat)}"` : ""}`;
const COST = (a) => (/^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : "");

/* The three MAP steps of an attack-trait action, as a strike's row has
   them: none lit, none moving. PF2e is handed the step and applies its own
   penalty for it (−5, then −10), which is what each press prints. */
const STEPS = (a, t) => (a.variants ? `<span class="gph-mss" role="group" aria-label="${esc(t("GLRAIL.skill.steps", { name: a.name }))}">${a.variants.map((v, i) => {
  const said = esc(t(`GLRAIL.skill.step${i}`, { name: a.name, mod: v }));
  return `<button type="button" class="gph-ms" ${ACT(a)} data-variant="${i}" data-attack${COST(a)} title="${said}" aria-label="${said}">${esc(v)}</button>`;
}).join("")}</span>` : "");

const KEY = (a, t) => {
  const said = esc([a.name, `${a.skill.name} ${sign(a.skill.mod)}`, a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}` : ""].filter(Boolean).join(", "));
  const face = `${actionIcon(a.slug)}<b>${esc(a.name)}</b><span class="gph-cost">${glyph(a.cost, t)}</span>`;
  if (a.variants) return `<span class="gph-key is-steps"><button type="button" class="gph-kb" ${ACT(a)} data-attack${COST(a)} title="${esc(t("GLRAIL.skill.atMap", { name: a.name }))}" aria-label="${said}">${face}</button>${STEPS(a, t)}${ODDS(a.vs, t)}</span>`;
  return `<button type="button" class="gph-key${a.locked ? " is-locked" : ""}" ${ACT(a)}${COST(a)}${a.locked ? ` aria-disabled="true" title="${esc(a.locked)}"` : ""} aria-label="${said}">
    ${face}<span class="gph-kmod">${sign(a.skill.mod)}</span>${ODDS(a.vs, t)}</button>`;
};

/* A skill is always named whole: a shorthand is one more thing to decode
   while the GM waits. A Lore is named by what it is about, with the word
   itself small on a second line, so "Warfare" reads at a glance and no
   Lore is mistaken for a skill. */
const skillName = (c, t, q = "") => {
  if (!c.lore) return `<span class="gph-skn">${marked(c.name, q)}</span>`;
  const subject = String(c.name).replace(/\s+Lore$/i, "") || c.name;
  return `<span class="gph-skn is-lore"><span>${marked(subject, q)}</span><small>${esc(t("GLRAIL.skill.lore"))}</small></span>`;
};
const CHECK_KEY = (c, t) => `<button type="button" class="gph-ck" data-check="${esc(c.check)}" data-rank="${c.rank ?? 0}" title="${esc(`${t("GLRAIL.check.roll", { name: c.name })} · ${t(`GLRAIL.prof.${c.rank ?? 0}`)}`)}" aria-label="${esc(`${c.name} ${sign(c.mod)}`)}">
      ${skillName(c, t)}<b>${sign(c.mod)}</b></button>`;

export const SKILLTAB = (s, t) => `
  <div class="gph-skilltab">
    <div class="gph-cks" role="group" aria-label="${esc(t("GLRAIL.group.checks"))}">${(s.checks ?? []).map((c) => CHECK_KEY(c, t)).join("")}</div>
    <div class="gph-keys" role="group" aria-label="${esc(t("GLRAIL.skill.title"))}">${(s.suggested ?? []).map((a) => KEY(a, t)).join("")}
      <button type="button" class="gph-key is-all" data-act="finder" title="${esc(t("GLRAIL.skill.find"))}">${ICON.search}<b>${esc(t("GLRAIL.skill.all"))}</b><kbd>${esc(t("GLRAIL.skill.key"))}</kbd></button></div>
  </div>`;

/* Items: what is reached for in a fight, held as a hand of the same compact
   card the spells are — the item's own painting, what is left of it on the
   pennant where a spell carries its rank, the action cost top right. A
   press uses it through PF2e; resting on it peeks, as a spell does, because
   a potion drunk by a slip of the pointer is gone. */
const ITEM_CARD = (i, t) => {
  const costSaid = i.cost != null ? t(costKey(i.cost), { cost: i.cost }) : "";
  return `<button type="button" class="gph-card is-item${i.qty === 0 ? " is-spent" : ""}" data-item="${esc(i.id)}"${/^[123]$/.test(String(i.cost)) ? ` data-cost="${i.cost}"` : ""}
    aria-label="${esc([i.name, costSaid, i.qty != null ? t("GLRAIL.items.left", { n: i.qty }) : ""].filter(Boolean).join(", "))}">
    <span class="gph-art"${i.img ? ` style="background-image:url('${esc(i.img)}')"` : ""}></span>
    ${i.qty != null ? `<span class="gph-pen" aria-hidden="true">×${i.qty}</span>` : ""}
    ${i.cost != null ? `<span class="gph-ccost" aria-hidden="true">${costGlyph(i.cost)}</span>` : ""}
    <b class="gph-cname" aria-hidden="true">${esc(i.name)}</b>
  </button>`;
};

export const ITEMS = ({ list = [] }, t) => list.length
  ? FAN(list.map((i) => ({ html: ITEM_CARD(i, t) })), " is-items", t("GLRAIL.items.handSaid", { n: list.length }))
  : `<span class="gph-none gph-pane-none">${esc(t("GLRAIL.items.none"))}</span>`;

export const DECK = (d, t) => {
  const pane = d.tab === "spells" && d.spells ? SPELLS(d.spells, t)
    : d.tab === "skills" ? SKILLTAB(d.skills ?? {}, t)
    : d.tab === "items" ? ITEMS(d.items ?? {}, t)
    : ACTIONS(d.actions ?? {}, t);
  const n = d.tab === "spells" && d.spells ? d.spells.cards.filter((c) => c.rank === (d.spells.rank ?? d.spells.ranks[0].key)).length
    : d.tab === "items" ? (d.items?.list?.length ?? 0) : 1;
  return `
<section class="gph-pl gph-deck" data-tab="${esc(d.tab)}" style="--n:${Math.max(1, n)}" aria-label="${esc(t("GLRAIL.deck.label"))}">
  ${TABS(d, t)}
  <div class="gph-pane" role="tabpanel" data-pane="${esc(d.tab)}">${pane}</div>
  <button type="button" class="gph-expand" data-act="expand" aria-label="${esc(t("GLRAIL.deck.expand", { tab: t(`GLRAIL.tab.${d.tab}`) }))}">${ICON.expand}</button>
</section>`;
};

/* Rest, macros (the hotbar is hidden while the rail is up, and Foundry
   keeps the user's macros there) and the sheet. */
export const UTIL = (u, t) => `
<nav class="gph-pl gph-util" aria-label="${esc(t("GLRAIL.util"))}">${["rest", "macros", "sheet"].map((k) => `
  <button type="button" class="gph-dw${u?.open === k ? " on" : ""}" data-drawer="${k}" title="${esc(t(`GLRAIL.drawer.${k}`))}" aria-label="${esc(t(`GLRAIL.drawer.${k}`))}"${k === "sheet" ? "" : ` aria-expanded="${u?.open === k}"`}>${ICON[k]}</button>`).join("")}
</nav>`;

/* ── the skill sheet ──────────────────────────────────────────────
   The panel that rises over the rail is the character's skills as a
   sheet, and nothing in it has to be opened, unfolded or found:

   - one row per skill, Perception first, then the sixteen by name, then
     the Lores. A row never moves and is never missing, so the eye learns
     where Athletics is;
   - the row's head IS the plain check (press it to roll Athletics): name,
     proficiency, modifier;
   - beside it, every action that skill can roll, each one line: picture,
     name, cost, and the chance against the target's defence where the
     party knows it (?? where they do not), coloured only at the ends;
   - an action with the attack trait carries its three MAP steps as a
     strike's row does. Its name rolls at the turn's own step;
   - an action several skills can roll (Recall Knowledge, Escape) stands
     in each of their rows, rolled with that row's skill;
   - a trained-only action under an untrained skill is not drawn, because
     it cannot be taken.

   Typing narrows the rows: a skill's name keeps its whole row (and Enter
   rolls the check), an action's name keeps that action. A pinned action
   also stands in a row of its own above Perception, rolled with the
   character's best skill for it, so what a player reaches for every turn
   is the first thing on the sheet. */
const oddsTone = (c) => {
  if (c == null) return "";
  const [lo, hi] = Array.isArray(c) ? c : [c, c];
  return lo >= 0.7 ? "good" : hi <= 0.3 ? "bad" : "";
};
const pctOf = (c) => (c == null ? "" : Array.isArray(c) ? `${Math.round(c[0] * 100)}–${Math.round(c[1] * 100)}%` : `${Math.round(c * 100)}%`);

/* The typed words, marked where they start a word of the name. */
const fold = (x) => String(x).toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const marked = (name, q) => {
  const words = fold(q ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return esc(name);
  return String(name).split(/(\s+|-)/).map((part) => {
    const w = words.filter((x) => fold(part).startsWith(x)).sort((x, y) => y.length - x.length)[0];
    return w ? `<mark>${esc(part.slice(0, w.length))}</mark>${esc(part.slice(w.length))}` : esc(part);
  }).join("");
};

const CHIP = (a, t, sel, k, { query = "" } = {}) => {
  const chance = a.vs?.chance ?? null;
  const known = a.vs && a.vs.dc != null;
  /* rolled with a statistic that is not this row's (Unarmed for Escape) */
  const other = a.stat ? a.skill.slug !== a.stat : !!a.best;
  const said = esc([a.name, a.cost != null ? t(costKey(a.cost), { cost: a.cost }) : "", `${a.skill.name} ${sign(a.mapMod ?? a.skill.mod)}`,
    a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}${known ? "" : " ??"}` : "", chance != null ? pctOf(chance) : "", a.secret ? t("GLRAIL.skill.secret") : ""].filter(Boolean).join(", "));
  const title = esc([a.variants ? t("GLRAIL.skill.atMap", { name: a.name }) : a.name, a.vs ? `${t("GLRAIL.skill.vs")} ${a.vs.label}${a.vs.dc != null ? ` (DC ${a.vs.dc})` : ""}` : a.note ?? "", a.secret ? t("GLRAIL.skill.secretTitle") : ""].filter(Boolean).join(" · "));
  const face = `${actionIcon(a.slug)}<b>${marked(a.name, query)}</b>${a.cost != null ? `<span class="gph-cost">${costGlyph(a.cost)}</span>` : ""}${a.secret ? ICON.secret : ""}`;
  const tail = `${other ? `<i class="gph-cskill">${esc(a.skill.name.slice(0, 3))} ${sign(a.skill.mod)}</i>` : ""}${a.pinned ? `<span class="gph-pinmk" title="${esc(t("GLRAIL.skill.pinned"))}">${ICON.pin}</span>` : ""}<em class="gph-codds"${oddsTone(chance) ? ` data-tone="${oddsTone(chance)}"` : ""}>${a.vs ? (chance != null ? pctOf(chance) : known ? esc(t("GLRAIL.skill.dcShort", { dc: a.vs.dc })) : esc(t("GLRAIL.skill.unknown"))) : ""}</em>`;
  const cls = `gph-fa${sel ? " is-sel" : ""}${a.pinned ? " is-pinned" : ""}`;
  if (a.variants) return `<span class="${cls} is-steps" role="option" aria-selected="${!!sel}" data-attack data-k="${k}" style="--k:${k}">
    <button type="button" class="gph-fab" ${ACT(a)} data-attack${COST(a)} title="${title}" aria-label="${said}">${face}</button>${STEPS(a, t)}${tail}</span>`;
  return `<button type="button" class="${cls}" role="option" aria-selected="${!!sel}" ${ACT(a)}${COST(a)} data-k="${k}" style="--k:${k}" title="${title}" aria-label="${said}">
    ${face}${tail}</button>`;
};

/* What is selected, said whole in the foot: what it rolls, against what,
   and whether the party knows that number — so the keyboard has what the
   pointer gets from a tooltip, and "??" is never a riddle. */
const SELINE = (p, f, t) => {
  if (p.row) return `<p class="gph-fsel" aria-live="polite"><b>${esc(p.row.name)}</b><span>${esc(t(`GLRAIL.prof.${p.row.rank ?? 0}`))} ${sign(p.row.mod)}</span><span class="gph-fdim">${esc(t("GLRAIL.skill.checkHint"))}</span></p>`;
  const a = p.action;
  const mod = sign(a.mapMod ?? a.skill.mod);
  const vs = a.vs
    ? `${esc(t("GLRAIL.skill.vs"))} ${esc(a.vs.label)} ${a.vs.dc != null ? `<b>${a.vs.stat === "recall" || a.vs.stat === "dc" ? esc(a.vs.dc) : esc(t("GLRAIL.skill.dcShort", { dc: a.vs.dc }))}</b>` : `<i>${esc(t("GLRAIL.skill.dcUnknown"))}</i>`}`
    : f.target || !a.note ? "" : esc(a.note);
  const odds = a.vs?.chance != null ? `<em${oddsTone(a.vs.chance) ? ` data-tone="${oddsTone(a.vs.chance)}"` : ""}>${esc(t("GLRAIL.skill.chanceOf", { chance: pctOf(a.vs.chance) }))}</em>` : "";
  const hint = !a.vs && !f.target && !a.note ? esc(t("GLRAIL.skill.pickTarget")) : "";
  return `<p class="gph-fsel" aria-live="polite"><b>${esc(a.name)}</b><span>${esc(a.skill.name)} ${mod}</span>${vs ? `<span>${vs}</span>` : ""}${odds}${hint ? `<span class="gph-fdim">${hint}</span>` : ""}${a.secret ? `<span class="gph-fdim">${esc(t("GLRAIL.skill.secretTitle"))}</span>` : ""}</p>`;
};

export const FINDER = (f, t) => {
  let k = 0;
  const sel = f.sel ?? 0;
  let picked = null;
  const rows = f.rows.map((r, ri) => {
    /* found by one of its actions only: the check stays a press, and the
       keys start on what was typed for */
    const ki = r.aside || r.pinned ? null : k++;
    if (ki != null && ki === sel) picked = { row: r };
    const head = r.pinned ? `<span class="gph-fk is-pins">${ICON.pin}<span class="gph-skn">${esc(r.name)}</span></span>` : `<button type="button" class="gph-fk${ki != null && ki === sel ? " is-sel" : ""}" data-check="${esc(r.check)}" data-rank="${r.rank ?? 0}"${ki != null ? ` data-k="${ki}" role="option" aria-selected="${ki === sel}"` : ""} title="${esc(t("GLRAIL.check.roll", { name: r.name }))}" aria-label="${esc(`${r.name}, ${t(`GLRAIL.prof.${r.rank ?? 0}`)}, ${sign(r.mod)}`)}">
          ${skillName(r, t, r.aside ? "" : f.query)}${RANK_TAG(r.rank ?? 0, t)}<em>${sign(r.mod)}</em></button>`;
    const chips = r.actions.map((a) => { const i = k++; if (i === sel) picked = { action: a }; return CHIP(a, t, i === sel, i, { query: f.query }); }).join("");
    return `
      <section class="gph-skrow${r.pinned ? " is-pins" : (r.rank ?? 0) > 0 ? "" : " is-untrained"}" aria-label="${esc(r.name)}" style="--c:${ri}">
        ${head}<div class="gph-sacts">${chips}</div>
      </section>`;
  }).join("");
  return `
<section class="gph-finder" role="dialog" aria-label="${esc(t("GLRAIL.skill.sheet"))}" data-finder>
  <header class="gph-fhead">
    <label class="gph-search">${ICON.search}<input type="search" data-find value="${esc(f.query ?? "")}" placeholder="${esc(t("GLRAIL.skill.placeholder"))}" aria-label="${esc(t("GLRAIL.skill.find"))}" autocomplete="off" spellcheck="false" aria-controls="gph-results"></label>
    ${f.target ? `<span class="gph-tgt is-big">${f.target.img ? `<img src="${esc(f.target.img)}" alt="">` : ""}<span>${esc(t("GLRAIL.skill.vs"))}</span><b>${esc(f.target.name)}</b>${f.target.known ? `<em>${esc(f.target.known)}</em>` : ""}</span>` : `<span class="gph-tgt is-big is-none">${esc(t("GLRAIL.skill.noTarget"))}</span>`}
    ${f.map ? `<span class="gph-fmap">${esc(t("GLRAIL.turnbar.map"))} <b>${["0", "−5", "−10"][f.map]}</b></span>` : ""}
    <button type="button" class="gph-x" data-act="close" aria-label="${esc(t("GLRAIL.close"))}">${ICON.close}</button>
  </header>
  <div class="gph-results" id="gph-results" role="listbox" aria-label="${esc(t("GLRAIL.skill.results"))}">
    ${f.rows.length ? `<div class="gph-skrows">${rows}</div>` : `<p class="gph-fnone">${esc(t("GLRAIL.skill.none", { q: f.query ?? "" }))}</p>`}
  </div>
  <footer class="gph-ffoot">${picked ? SELINE(picked, f, t) : ""}<span class="gph-fhint"><span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ${esc(t("GLRAIL.skill.hintMove"))}</span><span><kbd>↵</kbd> ${esc(t("GLRAIL.skill.hintRoll"))}</span><span><kbd>1</kbd>–<kbd>3</kbd> ${esc(t("GLRAIL.skill.hintMap"))}</span><span><kbd>P</kbd> ${esc(t("GLRAIL.skill.hintPin"))}</span><span><kbd>Esc</kbd> ${esc(t("GLRAIL.close"))}</span></span></footer>
</section>`;
};

/* ── drawers ──────────────────────────────────────────────────────
   A drawer is a plate that rises above the rail (placeDrawer). One at a
   time. Rows: a name, what it says about itself, and the number at the
   right edge, where the eye goes down a column of numbers. */
export const DRAWER = ({ title, note, body, wide, close = "" }) => `
<section class="gph-drawer${wide ? " is-wide" : ""}" role="dialog" aria-label="${esc(title)}">
  <header><b>${esc(title)}</b>${note ? `<span>${note}</span>` : ""}<button type="button" class="gph-x" data-act="close" aria-label="${esc(close || title)}">${ICON.close}</button></header>
  <div class="gph-dbody">${body}</div>
</section>`;

export const DLIST = ({ rows, empty }, t) => (rows.length ? `
<ul class="gph-dlist">${rows.map((r) => r.head ? `<li class="gph-dhead">${esc(r.head)}</li>` : `
  <li>${r.act ? `<button type="button" class="gph-drow${r.spent ? " is-spent" : ""}" data-row="${esc(r.key)}"${r.title ? ` title="${esc(r.title)}"` : ""}>` : '<div class="gph-drow is-read">'}
    ${r.cost != null ? `<span class="gph-cost">${glyph(r.cost, t)}</span>` : ""}
    ${r.icon ? `<img src="${esc(r.icon)}" alt="">` : ""}<b>${esc(r.name)}</b>${r.meta ? `<span>${esc(r.meta)}</span>` : ""}${r.tag ? `<i class="gph-tag"${r.tagTone ? ` data-tone="${r.tagTone}"` : ""}>${esc(r.tag)}</i>` : ""}${r.n != null ? `<em>${esc(r.n)}</em>` : ""}
  ${r.act ? "</button>" : "</div>"}</li>`).join("")}
</ul>` : `<p class="gph-dnone">${esc(empty ?? t("GLRAIL.drawer.empty"))}</p>`);

export const REST = (t) => `
<div class="gph-rest">
  <button type="button" class="gph-rb" data-row="rest:night"><b>${esc(t("GLRAIL.rest.night"))}</b><span>${esc(t("GLRAIL.rest.nightNote"))}</span></button>
</div>`;

export const MACROS = ({ page, slots }, t) => `
<div class="gph-macros">${slots.map((m, i) => m ? `
  <button type="button" class="gph-mac" data-row="macro:${esc(m.id)}" title="${esc(m.name)}">
    <span class="gph-mk">${(i + 1) % 10}</span>${m.img ? `<img src="${esc(m.img)}" alt="">` : ""}<b>${esc(m.name)}</b></button>` : `
  <span class="gph-mac is-empty"><span class="gph-mk">${(i + 1) % 10}</span></span>`).join("")}
</div>
<p class="gph-dnote gph-pager"><button type="button" class="gph-step" data-row="page:-1" aria-label="${esc(t("GLRAIL.macros.prev"))}">${ICON.prev}</button><b>${esc(t("GLRAIL.macros.pageN", { n: page }))}</b><button type="button" class="gph-step" data-row="page:1" aria-label="${esc(t("GLRAIL.macros.next"))}">${ICON.next}</button><span>${esc(t("GLRAIL.macros.page"))}</span></p>`;

/** The spell-rank picker the dial's numeral opens. */
export const RANKS = (h, t) => DLIST({
  rows: h.ranks.map((r) => ({
    key: `rank:${r.key}`, act: true, name: rankName(r.key, t), meta: t(r.cards === 1 ? "GLRAIL.rank.cards1" : "GLRAIL.rank.cardsN", { n: r.cards }),
    n: r.key === "f" && h.focus ? `${h.focus[0]}/${h.focus[1]}` : r.slots ? `${r.slots[0]}/${r.slots[1]}` : null,
    spent: r.slots ? r.slots[0] === 0 : false,
  })),
}, t);

/* ── the peek ─────────────────────────────────────────────────────
   A strike, a spell, an action or a feat, whole, over the thing it is a
   peek of, with that thing's own presses under it — the presses the chat
   card offers, so it can be used without posting it first. */
export const PEEK = ({ name, from, traits = [], lines = [], text = "", actions = [], tone }, t) => `
<div class="gph-peek"${tone ? ` data-tone="${tone}"` : ""}>
  <article class="gph-rule">
    <header><b>${esc(name)}</b>${from ? `<span>${from}</span>` : ""}</header>
    ${traits.length ? `<ul class="gph-traits">${traits.map((x) => `<li${x.tone ? ` data-tone="${x.tone}"` : ""}>${esc(x.label ?? x)}</li>`).join("")}</ul>` : ""}
    ${lines.length ? `<dl class="gph-lines">${lines.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>` : ""}
    ${text ? `<div class="gph-text">${text}</div>` : ""}
  </article>
  ${actions.length ? `<div class="gph-pacts">${actions.map((a) => `
    <button type="button" class="gph-pa${a.primary ? " is-primary" : ""}" data-pa="${esc(a.id)}"${a.cost != null && /^[123]$/.test(String(a.cost)) ? ` data-cost="${a.cost}"` : ""}${a.disabled ? ` aria-disabled="true" title="${esc(a.disabled)}"` : ""}>${
      a.cost != null ? `<span class="gph-cost">${costGlyph(a.cost, "")}</span>` : ""}<b>${esc(a.label)}</b></button>`).join("")}</div>` : ""}
</div>`;

/* ── the party seat ───────────────────────────────────────────────
   The plinth in miniature: the same art (the token ring's cut-out where the
   token wears one, else the painting) under the same frame (the owner's
   `ph.frame` zoom and offset), so a character reads the same in the party
   as on their own rail, and a cut-out stands over its plate's top edge the
   way it does there. The figure is the plinth's own markup scaled down
   (`--gph-sk`), so every mask, fade and offset is the plinth's, never a
   lookalike. Hit Points are a bar on the plate's foot, red under a quarter;
   temporary Hit Points a thin info-blue line over it. A seat the viewer may
   only see LIMITED of carries no bar and no numbers: the portrait, the name
   and what is visibly wrong. Exploring, the seat says what the character is
   doing, so the GM and the party read the marching order at a glance. */
const seatSaid = (s, t) => [s.name,
  s.hp ? t("GLRAIL.seat.hp", { v: s.hp[0], max: s.hp[1] }) : "", s.temp ? t("GLRAIL.vitals.temp", { n: s.temp }) : "",
  s.ac != null ? t("GLRAIL.vitals.acSaid", { n: s.ac }) : "", s.hero ? t("GLRAIL.hero.count", { n: s.hero[0], max: s.hero[1] }) : "",
  s.turn ? t("GLRAIL.seat.turn") : "", s.note ?? "", s.explore ? t("GLRAIL.seat.exploring", { name: s.explore }) : ""].filter(Boolean).join(", ");

export const SEAT = (s, t) => {
  const hpF = s.hp ? frac(s.hp[0], s.hp[1]) : 0, tF = s.hp && s.temp ? frac(s.temp, s.hp[1]) : 0;
  const art = s.cutout || s.img;
  return `
<div class="gph-seat${s.self ? " is-self" : ""}${s.turn ? " is-turn" : ""}"${s.id ? ` data-seat="${esc(s.id)}"` : ""}${s.state ? ` data-state="${s.state}"` : ""}${s.hp && hpState(...s.hp) ? ' data-low=""' : ""}
  style="--gph-f:${hpF.toFixed(4)};--gph-tf:${tF.toFixed(4)}${s.frame ? `;${frameVars(s.frame)}` : ""}" role="img" aria-label="${esc(seatSaid(s, t))}" data-name="${esc(s.name)}">
  <span class="gph-sfig${s.cutout ? " is-cut" : ""}" aria-hidden="true"><span class="gph-sfig-in">
    <span class="gph-plate"></span>
    <span class="gph-fig"><span class="gph-img"${art ? ` style="background-image:url('${esc(art)}')"` : ""}></span></span>
  </span>${s.hp ? '<span class="gph-sbar"><i class="gph-sbar-hp"></i><i class="gph-sbar-tmp"></i></span>' : ""}</span>
  <span class="gph-sid">
    <span class="gph-srow"><b class="gph-sname">${esc(s.name)}</b>${s.hero ? `<span class="gph-shero" aria-hidden="true">${Array.from({ length: s.hero[1] }, (_, i) => `<i class="${i < s.hero[0] ? "on" : ""}"></i>`).join("")}</span>` : ""}</span>
    <span class="gph-ssub">${s.ac != null ? `<span class="gph-sac">${esc(t("GLRAIL.vitals.ac"))} <b>${s.ac}</b></span>` : ""}${s.note ? `<span class="gph-snote">${esc(s.note)}</span>` : s.hp ? `<span class="gph-shp"><b data-v>${s.hp[0]}</b>/${s.hp[1]}</span>` : ""}</span>
    ${s.explore ? `<span class="gph-sexp" title="${esc(s.explore)}">${esc(s.explore)}</span>` : ""}
  </span>
</div>`;
};

/* ── the party's checks, and a call ───────────────────────────────
   The GM's grid (calls.mjs): a row per check, a column per character, the
   best in a row marked. Two presses, and the row says which is which:

   - a NUMBER rolls that character's check for the GM alone, blind to the
     table (a secret Perception, a Stealth nobody may know the result of);
   - a NAME calls for the check: every player gets one press on their rail.
     The DC field is the GM's; it leaves the screen only when "show" is on.

   While a call stands, its row is lit and each cell says who has rolled. */
export const PARTYCHECKS = (p, t, { dc = "", showDc = false, call = null } = {}) => {
  if (!p?.members?.length) return `<p class="gph-dnone">${esc(t("GLRAIL.call.noParty"))}</p>`;
  const got = new Set(call?.answered ?? []);
  return `
<div class="gph-pc" data-party>
  <div class="gph-pc-bar">
    <label class="gph-pc-dc"><span>${esc(t("GLRAIL.call.dc"))}</span><input type="number" data-call-dc inputmode="numeric" min="0" max="60" step="1" value="${esc(dc ?? "")}" placeholder="${esc(t("GLRAIL.call.dcNone"))}" aria-label="${esc(t("GLRAIL.call.dcSaid"))}"></label>
    <label class="gph-pc-show"><input type="checkbox" data-call-show${showDc ? " checked" : ""}><span>${esc(t("GLRAIL.call.show"))}</span></label>
    ${call ? `<span class="gph-pc-live" aria-live="polite">${ICON.call}<b>${esc(t("GLRAIL.call.live", { name: call.name }))}</b><em>${esc(t("GLRAIL.call.count", { n: got.size, of: p.members.length }))}</em></span><button type="button" class="gph-pc-end" data-act="call-end">${esc(t("GLRAIL.call.end"))}</button>`
      : `<span class="gph-pc-hint">${esc(t("GLRAIL.call.hint"))}</span>`}
  </div>
  <table class="gph-pct">
    <thead><tr><th scope="col"><span class="gph-sr">${esc(t("GLRAIL.group.checks"))}</span></th>${p.members.map((m) => `<th scope="col" title="${esc(m.name)}">${m.img ? `<img src="${esc(m.img)}" alt="">` : ""}<span>${esc(m.name)}</span></th>`).join("")}</tr></thead>
    <tbody>${p.rows.map((r, i) => `
      <tr data-group="${r.group}"${call?.check === r.check ? ' class="is-called"' : ""}${i && p.rows[i - 1].group !== r.group ? " data-first" : ""}>
        <th scope="row"><button type="button" class="gph-pc-call" data-call="${esc(r.check)}" title="${esc(t("GLRAIL.call.callFor", { name: r.name }))}">${ICON.call}<span>${esc(r.name)}</span></button></th>
        ${r.cells.map((c, ci) => `<td>${c.mod == null ? "" : `<button type="button" class="gph-pc-cell${c.best ? " is-best" : ""}${call?.check === r.check && got.has(c.id) ? " is-in" : ""}" data-pcheck="${esc(r.check)}" data-actor="${esc(c.id)}" data-rank="${c.rank}" title="${esc(t("GLRAIL.call.secretFor", { name: r.name, who: p.members[ci].name }))}" aria-label="${esc(`${p.members[ci].name}, ${r.name} ${sign(c.mod)}`)}">${sign(c.mod)}</button>`}</td>`).join("")}
      </tr>`).join("")}
    </tbody>
  </table>
</div>`;
};

/* A call on a player's rail: one press, the check named whole, the
   character's own modifier, the DC only where the GM showed it. */
export const CALLBAR = (c, t) => `
<div class="gph-call" role="alert" data-call-id="${esc(c.id)}">
  <span class="gph-call-k">${ICON.call}${esc(t("GLRAIL.call.asks"))}</span>
  <button type="button" class="gph-call-roll" data-check="${esc(c.check)}" data-answer="${esc(c.id)}" title="${esc(t("GLRAIL.check.roll", { name: c.name }))}"><b>${esc(c.name)}</b><em>${sign(c.mod)}</em>${c.dc != null ? `<i>${esc(t("GLRAIL.skill.dcShort", { dc: c.dc }))}</i>` : ""}</button>
  <button type="button" class="gph-x" data-act="call-dismiss" aria-label="${esc(t("GLRAIL.call.dismiss"))}" title="${esc(t("GLRAIL.call.dismiss"))}">${ICON.close}</button>
</div>`;

/* ── the GM's creature panel ──────────────────────────────────────
   AC leads, as on the player's vitals. Then the Hit Points the GM marks,
   the three saves and Perception as presses, and the line read before
   deciding what the party knows: level, the Recall Knowledge DC, and the
   creature's own skills through the same sheet the players use.
   The moves are the strikes as rows of MAP presses, then the abilities as
   chips in PF2e's glyph; nothing is lost silently under the panel's edge.

   What a creature does without being asked is the half a GM forgets: its
   immunities, weaknesses and resistances, and the abilities with no action
   to press (an aura, a Ferocity). They ride the
   panel's top edge, always drawn, in the order they come up in a fight:
   what changes the damage first, then the passive abilities (a press reads
   one), then the senses. What does not fit, and everything else the stat
   block says (speeds, languages, each ability's text), is one press away
   in the stat block drawer, which stays open from creature to creature. */
const IWR_ORDER = ["immune", "weak", "resist"];
const PASSIVE = (a, t) => `<button type="button" class="gph-pas" data-action="${esc(a.id)}" title="${esc(a.text ? `${a.name} · ${a.text}` : a.name)}">
      <i class="gph-pasg" aria-hidden="true"></i><b>${esc(a.name)}</b></button>`;

export const STATBAR = (n, t) => {
  const s = n.stat;
  if (!s) return "";
  const iwr = IWR_ORDER.map((k) => ({ k, list: (s.iwr ?? []).filter((x) => x.k === k) })).filter((g) => g.list.length);
  const count = (s.iwr?.length ?? 0) + (s.passives?.length ?? 0) + (s.senses?.length ?? 0);
  return `
<div class="gph-statbar" data-statbar role="group" aria-label="${esc(t("GLRAIL.stat.label", { name: n.name }))}">
  <div class="gph-sb-run">${count ? "" : `<span class="gph-sb-none">${esc(t("GLRAIL.stat.none"))}</span>`}
    ${iwr.map((g) => `<span class="gph-sb-g" data-iwr="${g.k}"><i>${esc(t(`GLRAIL.stat.${g.k}`))}</i><b>${esc(g.list.map((x) => x.text).join(", "))}</b></span>`).join("")}
    ${(s.passives ?? []).map((a) => PASSIVE(a, t)).join("")}
    ${s.senses?.length ? `<span class="gph-sb-g" data-iwr="senses"><i>${esc(t("GLRAIL.stat.senses"))}</i><b>${esc(s.senses.join(", "))}</b></span>` : ""}
  </div>
  <button type="button" class="gph-sb-all" data-drawer="statblock" title="${esc(t("GLRAIL.drawer.statblock"))}" aria-label="${esc(t("GLRAIL.drawer.statblock"))}">${ICON.sheet}<span>${esc(t("GLRAIL.stat.all"))}</span></button>
</div>`;
};

/* The drawer: the same facts whole, one to a line, and every ability with
   no action to press beside what it says. */
export const STATBLOCK = (n, t) => {
  const s = n.stat ?? {};
  const line = (k, v, tone = "") => (v ? `<div class="gph-sl"${tone ? ` data-iwr="${tone}"` : ""}><dt>${esc(t(`GLRAIL.stat.${k}`))}</dt><dd>${esc(v)}</dd></div>` : "");
  const of = (k) => (s.iwr ?? []).filter((x) => x.k === k).map((x) => x.text).join(", ");
  const skills = (s.skills ?? []).length ? `<div class="gph-sl"><dt>${esc(t("GLRAIL.stat.skills"))}</dt><dd class="gph-sks">${s.skills.map((k) => `<button type="button" class="gph-sk" data-check="${esc(k.check)}" title="${esc(t("GLRAIL.check.roll", { name: k.name }))}"><span>${esc(k.name)}</span><b>${sign(k.mod)}</b></button>`).join("")}</dd></div>` : "";
  const lines = [skills, line("immune", of("immune"), "immune"), line("weak", of("weak"), "weak"), line("resist", of("resist"), "resist"),
    line("senses", (s.senses ?? []).join(", ")), line("speeds", (s.speeds ?? []).join(", ")), line("languages", (s.languages ?? []).join(", "))].join("");
  return `
<div class="gph-statblock">
  ${lines ? `<dl class="gph-sls">${lines}</dl>` : ""}
  ${s.passives?.length ? `<ul class="gph-spas">${s.passives.map((a) => `
    <li><button type="button" class="gph-spa" data-action="${esc(a.id)}"><span class="gph-spah"><i class="gph-pasg" aria-hidden="true"></i><b>${esc(a.name)}</b></span>${a.text ? `<span class="gph-spat">${esc(a.text)}</span>` : ""}</button></li>`).join("")}
  </ul>` : ""}
  ${lines || s.passives?.length ? "" : `<p class="gph-dnone">${esc(t("GLRAIL.stat.none"))}</p>`}
</div>`;
};

const NPC_STRIKE = (s, t) => `
    <div class="gph-nstk">
      <button type="button" class="gph-stn" data-strike="${esc(s.id)}" data-act="peek-strike" title="${esc(s.name)}"><b>${esc(s.short ?? s.name)}</b></button>
      ${s.variants.map((label, i) => `<button type="button" class="gph-map" data-strike="${esc(s.id)}" data-variant="${i}" aria-label="${esc(t("GLRAIL.strike.attack", { name: s.name, mod: label }))}">${esc(label)}</button>`).join("")}
      <button type="button" class="gph-dmg" data-dmg="${esc(s.id)}" title="${esc(s.damage ?? "")}" aria-label="${esc(t("GLRAIL.strike.dmgSaid", { name: s.name, f: s.damage ?? "" }))}">${esc(t("GLRAIL.strike.dmg"))}</button>
    </div>`;

const MOVE_CHIP = (a, t) => `<button type="button" class="gph-move" data-action="${esc(a.id)}" title="${esc(a.name)}">
      <span class="gph-cost">${glyph(a.cost, t)}</span><b>${esc(a.name)}</b></button>`;

const npcMoves = (strikes, abilities, t) => {
  const sRows = strikes.slice(0, 3);
  const room = (4 - sRows.length) * 2;
  const shown = abilities.length > room ? abilities.slice(0, room - 1) : abilities;
  const more = abilities.length - shown.length + Math.max(0, strikes.length - sRows.length);
  return `${sRows.map((s) => NPC_STRIKE(s, t)).join("")}
    <div class="gph-chips">${shown.map((a) => MOVE_CHIP(a, t)).join("")}${more ? `<button type="button" class="gph-move is-more" data-act="sheet"><b>${esc(t("GLRAIL.more", { n: more }))}</b></button>` : ""}</div>`;
};

export const CREATURE = (n, t) => `
<section class="gph-pl gph-npc" aria-label="${esc(n.name)}">
  <div class="gph-ac is-npc" role="img" aria-label="${esc(t("GLRAIL.vitals.acSaid", { n: n.ac }))}"><span aria-hidden="true">${esc(t("GLRAIL.vitals.ac"))}</span><b aria-hidden="true">${n.ac}</b></div>
  <div class="gph-npct">
    ${METER("hp", n.hp, t)}
    <div class="gph-checks">${CHECK("perception", n.perception, t, "perceptionShort")}${SAVES.map((s) => CHECK(s, n.saves[s], t, `${s}Short`)).join("")}</div>
    <div class="gph-know"><span>${esc(t("GLRAIL.gm.level", { n: n.level }))}${n.recallDC != null ? ` · ${esc(t("GLRAIL.gm.recall"))} <b>${n.recallDC}</b>` : ""}${n.adjust ? ` · <em>${esc(n.adjust)}</em>` : ""}</span>
      <button type="button" class="gph-kbtn" data-act="finder">${ICON.skills}${esc(t("GLRAIL.tab.skills"))}</button></div>
  </div>
  <div class="gph-moves">${npcMoves(n.strikes ?? [], n.abilities ?? [], t)}</div>
</section>`;

/* A hazard leads with how it is found (Stealth) and how it is stopped (the
   disable line); its defences appear only where it has them. */
export const HAZARD = (z, t) => `
<section class="gph-pl gph-npc is-hazard" aria-label="${esc(z.name)}">
  <div class="gph-ac is-npc is-dc" role="img" aria-label="${esc(t("GLRAIL.hazard.stealthSaid", { n: z.stealthDC }))}"><span aria-hidden="true">${esc(t("GLRAIL.hazard.stealth"))}</span><b aria-hidden="true">${z.stealthDC}</b></div>
  <div class="gph-npct">
    ${z.hp ? METER("hp", z.hp, t) : ""}
    <p class="gph-disable"><b>${esc(t("GLRAIL.hazard.disable"))}</b> ${esc(z.disable)}</p>
    <div class="gph-know"><span>${esc(t("GLRAIL.gm.level", { n: z.level }))}${z.ac != null ? ` · ${esc(t("GLRAIL.vitals.ac"))} <b>${z.ac}</b>` : ""}${z.hardness != null ? ` · ${esc(t("GLRAIL.hazard.hardness", { n: z.hardness }))}` : ""}${z.complex ? ` · <em>${esc(t("GLRAIL.hazard.complex"))}</em>` : ""}</span></div>
  </div>
  <div class="gph-moves">${npcMoves([], z.abilities ?? [], t)}</div>
</section>`;

/* The GM's hand is every non-PC token on the scene: painting, level on the
   pennant, disposition as the card's tone edge, a Hit Point line along its
   top. Hostile first, then scene order within each, so the hand never
   reshuffles when a token is selected. Shared leading words drop; a name
   held more than once is numbered. */
const sharedHead = (names) => {
  if (names.length < 2) return 0;
  const split = names.map((n) => n.split(" "));
  let k = 0;
  while (split.every((w) => w.length > k + 1 && w[k] === split[0][k])) k++;
  return k;
};
export const shortNames = (names) => {
  const k = sharedHead(names);
  const base = names.map((n) => n.split(" ").slice(k).join(" "));
  const total = {}, seen = {};
  for (const b of base) total[b] = (total[b] ?? 0) + 1;
  /* the number is glued to the last word, so a wrapping name never strands it */
  return base.map((b) => (total[b] > 1 ? `${b}\u00a0${(seen[b] = (seen[b] ?? 0) + 1)}` : b));
};

/* A hand holds ten. Past that the last card is the rest, as a count that
   opens the whole list, and the selected creature always keeps its card: a
   card narrower than its pennant and name cannot be told apart or hit. */
export const FOE_CAP = 10;
const foeCards = (foes, selected) => {
  if (foes.length <= FOE_CAP) return { cards: foes, more: 0 };
  const cards = foes.slice(0, FOE_CAP - 1);
  const sel = foes.find((f) => f.id === selected);
  if (sel && !cards.includes(sel)) cards[cards.length - 1] = sel;
  return { cards, more: foes.length - cards.length };
};

export const FOES = ({ foes: all, selected }, t) => {
  const names = shortNames(all.map((f) => f.name));
  const { cards: foes, more } = foeCards(all, selected);
  const nameOf = new Map(all.map((f, i) => [f, names[i]]));
  const items = foes.map((f) => ({ sel: f.id === selected, html: `
    <button type="button" class="gph-card is-foe" data-foe="${esc(f.id)}" data-disp="${esc(f.disp ?? "neutral")}"${f.state ? ` data-state="${f.state}"` : ""}${f.hp && hpState(f.hp[0], f.hp[1]) ? ' data-low=""' : ""}${f.turn ? " data-turn" : ""}
      aria-label="${esc([f.name, t(`GLRAIL.disp.${f.disp ?? "neutral"}`), f.hp ? t("GLRAIL.seat.hp", { v: f.hp[0], max: f.hp[1] }) : "", f.state ? t(`GLRAIL.state.${f.state}`) : "", f.turn ? t("GLRAIL.seat.turn") : ""].filter(Boolean).join(", "))}"
      aria-pressed="${f.id === selected}" style="--gph-f:${f.hp ? frac(f.hp[0], f.hp[1]).toFixed(4) : 1}">
      <span class="gph-art"${f.img ? ` style="background-image:url('${esc(f.img)}')"` : ""}></span>
      <span class="gph-pen" aria-hidden="true">${f.level}</span>
      ${f.hp ? '<span class="gph-mini" aria-hidden="true"><i></i></span>' : ""}
      <b class="gph-cname" aria-hidden="true">${esc(nameOf.get(f))}</b>
      ${f.state ? `<span class="gph-cstate" aria-hidden="true">${esc(t(`GLRAIL.state.${f.state}`))}</span>` : ""}
    </button>` }));
  if (more) items.push({ html: `
    <button type="button" class="gph-card is-foe is-more" data-drawer="foes" aria-label="${esc(t("GLRAIL.gm.moreFoes", { n: more }))}">
      <b class="gph-cmore">+${more}</b><span class="gph-cname">${esc(t("GLRAIL.gm.moreShort"))}</span></button>` });
  return `
<section class="gph-pl gph-hand gph-foes"${items.length > 6 ? " data-dense" : ""} style="--n:${items.length}" aria-label="${esc(t("GLRAIL.gm.foes", { n: all.length }))}">
  ${FAN(items, " is-foes", t("GLRAIL.gm.foes", { n: all.length }))}
</section>`;
};

export const EMPTY = (t) => `
<section class="gph-pl gph-empty"><b>${esc(t("GLRAIL.empty.title"))}</b><span>${esc(t("GLRAIL.empty.body"))}</span></section>`;

/* ── the whole rail ───────────────────────────────────────────────
   `o.role` is "player" or "gm"; `o.mode` is "encounter" or "exploration";
   `o.slim` draws the creature rail a familiar or a player-owned NPC gets.
   `o.overlay` is whatever panel is risen over the rail (a drawer, the
   finder) and `o.peek` the open peek, both already built by the host. */
export const RAIL = (o, t) => {
  const body = o.role === "gm"
    ? (o.hazard ? HAZARD(o.hazard, t) : o.creature ? CREATURE(o.creature, t) : o.foes?.foes?.length ? "" : EMPTY(t)) + (o.foes?.foes?.length ? FOES(o.foes, t) : "")
    : VITALS(o.vitals, t) + STRIKES(o.strikes ?? { list: [] }, t) + DECK(o.deck, t) + (o.slim ? "" : UTIL(o.util, t));
  return `
<div class="gph" data-role="${o.role}" data-mode="${o.mode ?? "exploration"}" data-map="${o.turnbar?.map ?? 0}"${o.slim ? " data-slim" : ""}${o.folded ? " data-folded" : ""}${o.readonly ? " data-readonly" : ""}${o.role !== "gm" && (o.plinth?.dead || o.plinth?.dying) ? ` data-down="${o.plinth.dead ? "dead" : "dying"}"` : ""}${o.overlay ? " data-overlay" : ""}>
  ${o.stack?.length ? `<div class="gph-stack" role="group" aria-label="${esc(t("GLRAIL.party"))}">${o.stack.map((s) => SEAT(s, t)).join("")}${o.role === "gm" ? `<button type="button" class="gph-pcb" data-drawer="party" title="${esc(t("GLRAIL.call.openTitle"))}">${ICON.party}<span>${esc(t("GLRAIL.call.open"))}</span></button>` : ""}</div>` : ""}
  <div class="gph-rail">
    ${PLINTH({ ...o.plinth, folded: o.folded }, t, { readonly: o.readonly })}
    <div class="gph-body">${o.turnbar && o.role !== "gm" ? TURNBAR(o.turnbar, t) : ""}${o.call && o.role !== "gm" ? CALLBAR(o.call, t) : ""}${o.role === "gm" && o.creature ? STATBAR(o.creature, t) : ""}${body}</div>
  </div>
  ${o.overlay ?? ""}
  ${o.peek ?? ""}
</div>`;
};
