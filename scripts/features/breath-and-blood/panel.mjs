/**
 * Breath and Blood — the panel on an actor sheet.
 *
 * pf2e's actor sheets are AppV1 in 8.7.0, so the render hook hands over
 * jQuery; an AppV2 sheet hands over an element. Both are handled. The panel is
 * drawn by the pure `panelHTML`, prepended to the sheet's main tab, and wired
 * by delegation on its own root; the sheet re-renders on every actor update,
 * which redraws it.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { bab, canWrite, commitState, flagPath, hasFeat, isTwoPool, medicineRank, poolActor, readState, roleOf, staminaOn, PREP } from "./actor.mjs";
import { FEATS, FLAG, OPTION } from "./constants.mjs";
import { t, notify } from "./chat.mjs";
import * as R from "./rules.mjs";
import { panelHTML } from "./views.mjs";

let _active = () => false;
let _dials = () => ({});
let _api = null;
export function configurePanel({ active, dials, api }) {
  _active = active;
  _dials = dials;
  _api = api;
}

const firstTarget = () => [...(game.user?.targets ?? [])][0]?.actor ?? null;

/** The panel's model for one actor and the current user. */
export function panelModel(actor) {
  const d = _dials();
  const isGM = !!game.user?.isGM;
  const role = roleOf(actor, d);
  const holder = poolActor(actor);
  const gm = {
    roles: actor.type === "character" ? ["twoPools", "companion", "rival", "onePool"] : ["onePool", "companion", ...(d.recurringRivals ? ["rival"] : [])],
    canShare: ["character", "npc"].includes(actor.type),
    sharesOptions: (game.actors?.contents ?? [])
      .filter((a) => a.type === "character" && a.id !== actor.id && !bab(a)[FLAG.sharesWith])
      .map((a) => ({ id: a.id, name: a.name, selected: bab(actor)[FLAG.sharesWith] === a.id })),
  };
  const base = { actorId: actor.id, isGM, role, variantOn: staminaOn(), gm };
  if (!isTwoPool(actor)) return { ...base, twoPool: false };
  const s = readState(holder);
  const target = firstTarget();
  const targetHolder = target ? poolActor(target) : null;
  const canEdit = canWrite(actor);
  const actions = [];
  actions.push({ id: "catch", reason: R.catchRefusal(s) });
  if (hasFeat(actor, FEATS.steelYourResolve) || hasFeat(holder, FEATS.steelYourResolve)) {
    actions.push({ id: "steel", reason: bab(holder)[FLAG.steelUsed] ? "steelUsed" : R.catchRefusal(s, { free: true }) });
  }
  actions.push({ id: "bind", reason: R.bindRefusal(s) });
  if (s.dying > 0) actions.push({ id: "holdOn", reason: s.rp < 1 ? "noRP" : null });
  if (!s.companion) {
    let reason = null;
    if (!target) reason = "noTarget";
    else if (!isTwoPool(target)) reason = "notTwoPools";
    else reason = R.lendRefusal(s, readState(targetHolder), { same: targetHolder === holder });
    actions.push({ id: "lend", reason });
  }
  if (hasFeat(actor, FEATS.encouragingWords)) {
    let reason = null;
    if (!target) reason = "noTarget";
    else if (!isTwoPool(target)) reason = "notTwoPools";
    else reason = R.wordsRefusal(readState(targetHolder));
    actions.push({ id: "words", reason });
  }
  if (actor.type === "character" && medicineRank(actor) >= 1) actions.push({ id: "treat", reason: null });
  if (hasFeat(actor, FEATS.battleMedicine)) actions.push({ id: "battle", reason: null });
  actions.push({ id: "rest", reason: null });
  return {
    ...base,
    twoPool: true,
    canEdit,
    shares: holder !== actor ? holder.name : null,
    sp: { value: s.sp, max: s.maxSP },
    hp: { value: s.hp, max: s.maxHP, temp: s.temp },
    rp: { value: s.rp, max: s.maxRP },
    ticks: { caughtBreath: s.caughtBreath, strengthLent: s.strengthLent },
    ewImmune: s.ewImmune,
    fieldSurgeon: { has: hasFeat(actor, FEATS.fieldSurgeon), used: !!bab(actor)[FLAG.fieldSurgeonUsed] },
    steel: { has: hasFeat(actor, FEATS.steelYourResolve), used: !!bab(holder)[FLAG.steelUsed] },
    declines: !!bab(holder)[FLAG.declines],
    dying: s.dying,
    wounded: s.wounded,
    actions: actions.map((a) => ({ ...a, disabled: !!a.reason })),
  };
}

const SLOTS = ['.tab[data-tab="character"]', '.tab[data-tab="main"]', '.tab[data-tab="attributes"]', ".sheet-body", "section.window-content form", "form"];

function inject(app, html) {
  try {
    if (!_active()) return;
    const actor = app?.actor ?? app?.document;
    if (!actor || !["character", "npc", "familiar"].includes(actor.type)) return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element?.[0] ?? app.element;
    if (!root?.querySelector) return;
    root.querySelectorAll(".glbab-panel").forEach((n) => n.remove());
    const markup = panelHTML(panelModel(actor), t);
    if (!markup) return;
    const slot = SLOTS.map((s) => root.querySelector(s)).find(Boolean);
    if (!slot) return;
    slot.insertAdjacentHTML("afterbegin", markup);
    const panel = slot.querySelector(":scope > .glbab-panel");
    if (panel) wire(panel, actor);
  } catch (error) {
    warn("breath-and-blood | could not draw the sheet panel", error);
  }
}

function wire(panel, actor) {
  panel.addEventListener("click", async (event) => {
    const btn = event.target.closest?.("[data-bab-action]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    await act(actor, btn.dataset.babAction, panel);
  });
  panel.addEventListener("change", async (event) => {
    const field = event.target?.dataset?.babField;
    if (!field) return;
    event.stopPropagation();
    await change(actor, field, event.target);
  });
}

async function act(actor, action, panel) {
  const api = _api;
  const target = firstTarget();
  try {
    switch (action) {
      case "catch":
        return api.catchYourBreath(actor, { free: false });
      case "steel":
        return api.catchYourBreath(actor, { free: true });
      case "bind":
        return api.bindYourOwnWounds(actor);
      case "holdOn":
        return api.holdOn(actor);
      case "lend":
        return target ? api.lendStrength(actor, target) : notify("GLBAB.refuse.noTarget", null, "warn");
      case "words":
        return target ? api.encouragingWords(actor, target) : notify("GLBAB.refuse.noTarget", null, "warn");
      case "treat":
        return api.openTreatWounds("treat", { healer: actor });
      case "battle":
        return api.openTreatWounds("battle", { healer: actor });
      case "rest":
        return api.openRest();
      case "returned":
        return api.returnFromDeath(actor);
      case "direct": {
        const amount = Number(panel.querySelector('[data-bab-field="direct"]')?.value) || 0;
        return api.promptDirectDamage(actor, amount);
      }
      default:
    }
  } catch (error) {
    warn(`breath-and-blood | panel action ${action} failed`, error);
  }
  return null;
}

async function change(actor, field, el) {
  try {
    if (field === "declines") {
      const holder = poolActor(actor);
      if (!canWrite(holder)) return;
      await holder.update({ [flagPath(FLAG.declines)]: !!el.checked }, { [OPTION]: "declines" });
      return;
    }
    if (!game.user.isGM) return;
    if (field === "role") return setRole(actor, el.value);
    if (field === "sharesWith") return actor.update({ [flagPath(FLAG.sharesWith)]: el.value || null }, { [OPTION]: "shares" });
  } catch (error) {
    warn(`breath-and-blood | panel field ${field} failed`, error);
  }
  return null;
}

/**
 * Set a role; an NPC or familiar that gains two pools starts with full Stamina
 * and Resolve. Its stored Hit Points are left alone: preparation caps them to
 * the new pool, and a later return to one pool finds them as they were.
 */
export async function setRole(actor, role) {
  if (!R.ROLES.includes(role)) return;
  await actor.update({ [flagPath(FLAG.role)]: role }, { [OPTION]: "role" });
  if (actor.type === "character") return;
  const prep = PREP.get(actor);
  if (!prep?.twoPool) return;
  await actor.update({ [flagPath(FLAG.sp)]: prep.maxSP, [flagPath(FLAG.rp)]: prep.maxRP }, { [OPTION]: "role" });
}

export function installPanel() {
  Hooks.on("renderActorSheet", inject);
  Hooks.on("renderActorSheetV2", inject);
}

export { SUITE_ID, commitState };
