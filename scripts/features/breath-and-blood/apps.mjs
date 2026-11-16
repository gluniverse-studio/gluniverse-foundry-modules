/**
 * Breath and Blood — the Rest window and the Treat Wounds window.
 *
 * What they show is built here from the actors and drawn by the pure
 * `views.mjs`, so the preview draws the same markup. The ApplicationV2
 * classes are built in a memoised factory, never at module scope, so nothing
 * that a check tool imports reaches `foundry.applications.api`.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { bab, canWrite, hasFeat, isTwoPool, medicineRank, poolActor, readState, PREP, staminaOn } from "./actor.mjs";
import { APP_IDS, FEATS, FLAG, SETTINGS } from "./constants.mjs";
import { t, notify } from "./chat.mjs";
import { restHTML, treatHTML } from "./views.mjs";
import { breather, night, resolveActor } from "./actions.mjs";
import { runMedicine, treatModel } from "./medicine.mjs";
import * as R from "./rules.mjs";

let _active = () => false;
let _dials = () => ({});
let _setup = { enableStamina: async () => {}, fillPools: async () => {}, openSettings: () => {}, lasting: () => false };
export function configureApps({ active, dials, setup }) {
  _active = active;
  _dials = dials;
  _setup = { ..._setup, ...setup };
}

/** The party: two-pool actors with a player owner, plus GM-marked companions. Eidolons are their summoner. */
export function partyActors() {
  return (game.actors?.contents ?? []).filter((a) => isTwoPool(a) && poolActor(a) === a && (a.hasPlayerOwner || PREP.get(a)?.role === "companion"));
}

const fieldOf = (el) => el?.dataset?.babField ?? null;

function bindDelegates(app) {
  const root = app.element;
  if (!root || root.dataset.glbabBound) return;
  root.dataset.glbabBound = "1";
  root.addEventListener("click", (event) => {
    const btn = event.target.closest?.("[data-bab-action]");
    if (!btn || btn.disabled) return;
    event.preventDefault();
    app._onAction(btn.dataset.babAction, btn, event);
  });
  root.addEventListener("change", (event) => {
    const el = event.target;
    const field = fieldOf(el);
    if (field) app._onField(field, el, event);
  });
}

let _classes = null;

/** Build the two window classes on first use. */
export function appClasses() {
  if (_classes) return _classes;
  const { ApplicationV2 } = foundry.applications.api;

  class RestApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_IDS.rest,
      classes: ["glbab", "glbab-window"],
      tag: "div",
      window: { title: "GLBAB.rest.title", icon: "fa-solid fa-campground", resizable: true },
      position: { width: 640, height: "auto" },
    };

    tab = "rest";
    picks = new Set();
    bind = new Set();
    lendTo = new Map();
    nights = new Map();

    async _prepareContext() {
      const d = _dials();
      const party = partyActors();
      const rows = party.filter((a) => canWrite(a));
      if (!this.picks.size) for (const a of rows) this.picks.add(a.id);
      const actors = rows.map((a) => {
        const s = readState(a);
        const lendTargets = party.filter((o) => o.id !== a.id).map((o) => ({ id: o.id, name: o.name }));
        return {
          id: a.id,
          name: a.name,
          picked: this.picks.has(a.id),
          sp: s.sp,
          maxSP: s.maxSP,
          hp: s.hp,
          maxHP: s.maxHP,
          rp: s.rp,
          maxRP: s.maxRP,
          wounded: s.wounded,
          dying: s.dying,
          unconscious: s.unconscious,
          bind: this.bind.has(a.id),
          bindRefusal: R.bindRefusal(s),
          canLend: !s.companion && s.rp >= 1,
          lendTo: this.lendTo.get(a.id) ?? "",
          lendTargets,
          night: this.nights.get(a.id) ?? "rest",
        };
      });
      const nights = d.havens ? ["rest", "rough", "haven"] : ["rest", "rough"];
      return {
        isGM: game.user.isGM,
        tab: game.user.isGM ? this.tab : "rest",
        variantOn: staminaOn() && _active(),
        actors,
        nights,
        setup: setupModel(),
      };
    }

    async _renderHTML(context) {
      return restHTML(context, t);
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      bindDelegates(this);
    }

    _onField(field, el) {
      const id = el.closest("[data-actor-id]")?.dataset.actorId;
      if (field === "pick" && id) el.checked ? this.picks.add(id) : this.picks.delete(id);
      else if (field === "bind" && id) el.checked ? this.bind.add(id) : this.bind.delete(id);
      else if (field === "lendTo" && id) this.lendTo.set(id, el.value);
      else if (field === "night" && id) this.nights.set(id, el.value);
    }

    async _onAction(action, btn) {
      try {
        if (action === "tab") {
          this.tab = btn.dataset.tab === "setup" ? "setup" : "rest";
          return this.render();
        }
        if (action === "enableStamina") return (await _setup.enableStamina(), this.render());
        if (action === "fillPools") return (await _setup.fillPools(), this.render());
        if (action === "openSettings") return _setup.openSettings();
        const picked = [...this.picks].map((id) => game.actors.get(id)).filter(Boolean);
        if (!picked.length) return notify("GLBAB.refuse.noTarget", null, "warn");
        if (action === "endBreather") {
          const lend = [...this.lendTo.entries()]
            .filter(([giver, taker]) => taker && this.picks.has(giver))
            .map(([giver, taker]) => ({ giver: game.actors.get(giver), taker: game.actors.get(taker) }));
          await breather(picked, { bind: [...this.bind].filter((id) => this.picks.has(id)), lend });
          this.bind.clear();
          this.lendTo.clear();
        } else if (action === "night") {
          await night(picked, Object.fromEntries(this.nights));
        }
        this.render();
      } catch (error) {
        warn("breath-and-blood | rest window action failed", error);
      }
    }
  }

  class TreatApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_IDS.treat,
      classes: ["glbab", "glbab-window"],
      tag: "div",
      window: { title: "GLBAB.treat.title", icon: "fa-solid fa-kit-medical", resizable: true },
      position: { width: 560, height: "auto" },
    };

    kind = "treat";
    healerId = null;
    rank = null;
    assurance = false;
    surgeonId = null;
    patients = [];

    configure({ kind, healer } = {}) {
      if (kind === "treat" || kind === "battle") this.kind = kind;
      if (healer) this.healerId = healer.id;
      if (!this.patients.length) this.fromTargets();
      return this;
    }

    healers() {
      return (game.actors?.contents ?? []).filter((a) => a.type === "character" && medicineRank(a) >= 1 && a.isOwner);
    }

    fromTargets() {
      const fromTargets = [...(game.user.targets ?? [])].map((tk) => tk.actor).filter(Boolean);
      const selected = (canvas?.tokens?.controlled ?? []).map((tk) => tk.actor).filter(Boolean);
      const list = fromTargets.length ? fromTargets : selected;
      const seen = new Set();
      this.patients = list
        .filter((a) => (seen.has(a.uuid) ? false : (seen.add(a.uuid), true)))
        .map((a) => ({ uuid: a.uuid, declines: !!bab(poolActor(a))[FLAG.declines] }));
    }

    current() {
      const healers = this.healers();
      const healer = healers.find((h) => h.id === this.healerId) ?? healers.find((h) => h === game.user.character) ?? healers[0] ?? null;
      if (healer) this.healerId = healer.id;
      const patients = this.patients.map((p) => ({ actor: resolveActor(p.uuid), declines: p.declines })).filter((p) => p.actor);
      return { healers, healer, patients };
    }

    async _prepareContext() {
      const { healers, healer, patients } = this.current();
      return treatModel({ kind: this.kind, healers, healer, rank: this.rank, assurance: this.assurance, surgeonId: this.surgeonId, patients });
    }

    async _renderHTML(context) {
      return treatHTML(context, t);
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _onRender(context, options) {
      super._onRender?.(context, options);
      bindDelegates(this);
    }

    _onField(field, el) {
      const id = el.closest("[data-actor-id]")?.dataset.actorId;
      if (field === "healer") {
        this.healerId = el.value;
        this.rank = null;
        this.surgeonId = null;
      } else if (field === "rank") this.rank = Number(el.value) || null;
      else if (field === "assurance") this.assurance = el.checked;
      else if (field === "surgeon") this.surgeonId = el.value || null;
      else if (field === "choice" && id) {
        const row = this.patients.find((p) => resolveActor(p.uuid)?.id === id);
        if (row) row.declines = el.value === "decline";
      }
      this.render();
    }

    async _onAction(action, btn) {
      try {
        if (action === "kind") {
          this.kind = btn.dataset.kind === "battle" ? "battle" : "treat";
          this.surgeonId = null;
          return this.render();
        }
        if (action === "refreshTargets") {
          this.fromTargets();
          return this.render();
        }
        if (action === "dropPatient") {
          const id = btn.closest("[data-actor-id]")?.dataset.actorId;
          this.patients = this.patients.filter((p) => resolveActor(p.uuid)?.id !== id);
          return this.render();
        }
        if (action === "run") {
          const { healer, patients } = this.current();
          const ctx = await this._prepareContext();
          btn.disabled = true;
          await runMedicine({ kind: this.kind, healer, rank: ctx.rank, assurance: this.assurance, surgeonId: this.surgeonId, patients });
          this.surgeonId = null;
          this.render();
        }
      } catch (error) {
        warn("breath-and-blood | treat window action failed", error);
      }
    }
  }

  _classes = { RestApp, TreatApp };
  return _classes;
}

/** The Setup tab's model. */
export function setupModel() {
  const d = _dials();
  const party = (game.actors?.contents ?? []).filter((a) => a.type === "character" && a.hasPlayerOwner);
  const unfilled = party.filter((a) => {
    const s = isTwoPool(a) ? readState(a) : null;
    return s && (s.sp < s.maxSP || s.rp < s.maxRP) && s.sp === 0 && s.rp === 0;
  }).length;
  const yes = (v) => t(v ? "GLBAB.setup.yes" : "GLBAB.setup.no");
  const choice = (key, v) => t(`GLBAB.settings.${key}.choice.${v}`);
  return {
    stamina: staminaOn(),
    lasting: _setup.lasting(),
    unfilled,
    dials: [
      { key: "maxResolve", text: d.resolveByLevel ? t("GLBAB.setup.byLevel") : String(d.maxResolve) },
      { key: "resolveByLevel", text: yes(d.resolveByLevel) },
      { key: "havens", text: yes(d.havens) },
      { key: "grimWounds", text: yes(d.grimWounds) },
      { key: "generousSupplies", text: yes(d.generousSupplies) },
      { key: "recurringRivals", text: yes(d.recurringRivals) },
      { key: "lingeringWounds", text: yes(d.lingeringWounds) },
      { key: "levelGroundDCs", text: `${choice("levelGroundDCs", game.settings.get(SUITE_ID, SETTINGS.levelGroundDCs))} (${yes(d.levelGround)})` },
      { key: "healingPrompt", text: choice("healingPrompt", d.healingPrompt) },
      { key: "redirectSystemActions", text: yes(d.redirect) },
    ],
  };
}

export function openRest() {
  const { RestApp } = appClasses();
  const app = foundry.applications.instances.get(APP_IDS.rest) ?? new RestApp();
  app.render({ force: true });
  return app;
}

export function openTreatWounds(kind = "treat", { healer = null } = {}) {
  const { TreatApp } = appClasses();
  const app = foundry.applications.instances.get(APP_IDS.treat) ?? new TreatApp();
  app.configure({ kind, healer });
  app.render({ force: true });
  return app;
}

/** Redraw an open window after an actor changed. */
export function refreshApps() {
  for (const id of Object.values(APP_IDS)) {
    const app = foundry.applications.instances.get(id);
    if (app?.rendered) app.render();
  }
}

export { hasFeat, FEATS };
