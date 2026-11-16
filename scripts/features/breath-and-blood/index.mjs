/**
 * Breath and Blood — suite adapter.
 *
 * A variant rule for PF2e: Hit Points split into Stamina Points (breath, back
 * at every 10-minute breather) and Hit Points (blood, mended with Resolve
 * Points unless the healer spent a daily resource). Built on pf2e's own
 * Stamina variant setting, which this feature never flips silently: the active
 * GM is asked at ready, and nothing is done to an actor while it is off.
 *
 * Nothing here runs at import time. Wrappers and hooks go in at init (so the
 * first actor preparation already has the pools), the socket, redirects and
 * the setup prompt at ready. See docs/BREATH_AND_BLOOD.md.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { onSocket } from "../../core/socket.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { FEATURE_ID, PREFIX } from "./constants.mjs";
import { registerSettings, dials as readDials, get } from "./settings.mjs";
import { installPrepare, installDrained, resetPools } from "./prepare.mjs";
import { installDamage, readyDamage } from "./damage.mjs";
import * as actions from "./actions.mjs";
import * as medicine from "./medicine.mjs";
import * as apps from "./apps.mjs";
import * as panel from "./panel.mjs";
import { isTwoPool, readState, spPath, rpPath } from "./actor.mjs";
import { t } from "./chat.mjs";
import { clearAll as clearLastingWounds } from "../pf2e-variant-rules/wounds.mjs";

let ACTIVE = false;
let DIALS = null;
const active = () => ACTIVE;
const dials = () => (DIALS ??= readDials((id) => Suite.enabled(id)));

/** The API, filled at init: game.modules.get(SUITE_ID).api.features["breath-and-blood"]. */
const api = {};

function onSettingChange() {
  DIALS = null;
  if (!ACTIVE) return;
  resetPools();
  apps.refreshApps();
}

const lastingWoundsOn = () => {
  try {
    return !!game.settings.get(SUITE_ID, "vr.wound.enabled") && Suite.enabled("vr-lasting-wounds");
  } catch {
    return false;
  }
};

/** Synchronous on purpose: the suite awaits each feature's init in turn, and the
 *  first actor preparation (after init) must already run through the wrappers. */
function onInit() {
  ACTIVE = true;

  installPrepare({ active, dials });
  installDrained();
  installDamage({ active, dials });
  actions.configureActions({ active, dials });
  actions.installActions();
  medicine.configureMedicine({ active, dials, resolveActor: actions.resolveActor });

  Object.assign(api, {
    openRest: () => apps.openRest(),
    openTreatWounds: (kind = "treat", opts = {}) => apps.openTreatWounds(kind, opts),
    catchYourBreath: (actor, { free = false } = {}) => actions.catchYourBreath(actor, { free }),
    lendStrength: (giver, taker, opts = {}) => actions.lendStrength(giver, taker, opts),
    holdOn: (actor) => actions.holdOn(actor),
    bindYourOwnWounds: (actor) => actions.breather([actor], { bind: [actor] }),
    encouragingWords: (speaker, ally) => actions.encouragingWords(speaker, ally),
    breather: (actors, opts = {}) => actions.breather([actors].flat(), opts),
    night: (actors, kinds = {}) => actions.night([actors].flat(), kinds),
    applyDirectDamage: (actor, amount) => actions.applyDirectDamage(actor, amount),
    returnFromDeath: (actor) => actions.returnFromDeath(actor),
    promptDirectDamage: (actor, amount) => actions.promptDirectDamage(actor, amount),
  });

  apps.configureApps({ active, dials, setup: { enableStamina, fillPools, openSettings, lasting: lastingWoundsOn } });
  panel.configurePanel({ active, dials, api });
  panel.installPanel();

  Hooks.on("getSceneControlButtons", (controls) => {
    const group = ensureSuiteGroup(controls);
    if (!group) return;
    group.tools["glbab-rest"] = { name: "glbab-rest", title: "GLBAB.control.rest", icon: "fa-solid fa-campground", button: true, onChange: () => apps.openRest() };
    if (game.user.isGM) {
      group.tools["glbab-treat"] = { name: "glbab-treat", title: "GLBAB.control.treat", icon: "fa-solid fa-kit-medical", button: true, onChange: () => apps.openTreatWounds("treat") };
    }
  });
  Hooks.on("renderSceneControls", (_app, html) =>
    bindSuiteToolClicks(html, { "glbab-rest": () => apps.openRest(), "glbab-treat": () => apps.openTreatWounds("treat") }),
  );
  let pending = null;
  const redraw = () => {
    clearTimeout(pending);
    pending = setTimeout(() => apps.refreshApps(), 0);
  };
  Hooks.on("updateActor", redraw);
  Hooks.on("createItem", redraw);
  Hooks.on("deleteItem", redraw);
  Hooks.on("targetToken", () => {
    for (const app of Object.values(ui.windows ?? {})) if (app?.actor?.type === "character" && app.rendered) app.render(false);
  });
}

async function onReady() {
  if (!ACTIVE) return;

  readyDamage();
  onSocket(FEATURE_ID, (payload, claimed, meta) => actions.onSocketMessage(payload, claimed, meta, { commitMedicine: medicine.commitMedicine }));
  actions.installRedirects({ openRest: () => apps.openRest(), openTreatWounds: (kind, opts) => apps.openTreatWounds(kind, opts) });
  resetPools();

  if (!game.user.isGM || game.users?.activeGM !== game.user) return;
  // Not awaited: a dialog the GM has not answered must not hold up ready.
  if (!game.pf2e?.settings?.variants?.stamina) setupPrompt().catch((error) => warn("breath-and-blood | setup prompt failed", error));
  if (lastingWoundsOn()) ui.notifications.warn(t("GLBAB.setup.lasting"), { permanent: true });
  try {
    await clearLastingWounds();
  } catch (error) {
    warn("breath-and-blood | could not clear Lasting Wounds modifiers", error);
  }
}

/* ── Setup ───────────────────────────────────────────────────────────────── */

async function setupPrompt() {
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("GLBAB.setup.promptTitle"), icon: "fa-solid fa-lungs" },
    classes: ["glbab-dialog-frame"],
    content: `<div class="glbab-dialog"><p class="glbab-lede">${t("GLBAB.setup.promptBody")}</p></div>`,
    yes: { label: t("GLBAB.setup.enable"), default: true },
    no: { label: t("GLBAB.setup.later") },
    rejectClose: false,
  });
  if (yes) await enableStamina();
}

async function enableStamina() {
  if (!game.user.isGM) return;
  await game.settings.set("pf2e", "staminaVariant", true);
  resetPools();
}

/** Give every character with two pools and none of either full pools (the variant was just turned on). */
async function fillPools() {
  if (!game.user.isGM) return;
  for (const actor of game.actors?.contents ?? []) {
    if (actor.type !== "character" || !isTwoPool(actor)) continue;
    const s = readState(actor);
    if (s.sp > 0 || s.rp > 0) continue;
    try {
      await actor.update({ [spPath(actor)]: s.maxSP, [rpPath(actor)]: s.maxRP }, { glbab: "fill" });
    } catch (error) {
      warn(`breath-and-blood | could not fill ${actor.name}`, error);
    }
  }
}

/** The suite's Control Center, where this feature's settings live. */
async function openSettings() {
  try {
    const { SuiteConfigApp } = await import("../../core/suite-config-app.mjs");
    return new SuiteConfigApp().render({ force: true });
  } catch (error) {
    warn("breath-and-blood | could not open the Control Center", error);
    return null;
  }
}

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.breath-and-blood.title",
  hint: "GLS.feature.breath-and-blood.hint",
  icon: "fa-solid fa-lungs",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings() {
    registerSettings(onSettingChange);
  },
  onInit,
  onReady,
  api,
});

export { get };
