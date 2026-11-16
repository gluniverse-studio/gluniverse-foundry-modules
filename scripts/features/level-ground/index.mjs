/**
 * GLUniverse Suite — feature adapter for "level-ground".
 *
 * The Level Ground variant for PF2e (rules 0.13): level leaves every d20 roll
 * and DC. Proficiency rides PF2e's own Proficiency without Level setting; the
 * feature Strips creatures and hazards, Converts DCs, applies Reach and
 * Outmatched in the roll, runs the Mook, Solo and summoned roles with Tempo and
 * Unbowed, rates fights with the Threat worksheet, and posts Sizing Up and
 * Break Away. See docs/LEVEL_GROUND.md.
 *
 * Nothing runs at import: hooks are wired in onInit/onReady, which the registry
 * calls only while the feature is enabled in a PF2e world.
 */

import { Suite } from "../../core/registry.mjs";
import { ensureSuiteGroup, bindSuiteToolClicks } from "../../core/scene-controls.mjs";
import { registerSettings } from "./settings.mjs";
import { convertDC, levelDC, rate } from "./rules.mjs";
import * as actors from "./actors.mjs";
import * as app from "./app.mjs";
import * as chat from "./chat.mjs";
import * as checks from "./checks.mjs";
import * as combat from "./combat.mjs";
import * as setup from "./setup.mjs";

let live = false;
const mods = { actors, app, chat, checks, combat, setup };

const TOOL = "gllvg-open";

function onInit() {
  live = true;

  Hooks.on("preCreateItem", actors.onPreCreateItem);
  Hooks.on("createActor", actors.onCreateActor);
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    actors.onUpdateActor(actor, changes, options, userId);
    combat.redrawSoon(actor);
  });
  Hooks.on("preUpdateActor", checks.onPreUpdateActor);
  Hooks.on("renderActorSheet", actors.onRenderActorSheet);
  Hooks.on("getActorContextOptions", actors.onActorContext);
  Hooks.on("renderTokenHUD", actors.onRenderTokenHUD);

  Hooks.on("renderChatMessageHTML", chat.onRenderChatMessage);
  Hooks.on("createChatMessage", chat.onCreateChatMessage);

  Hooks.on("combatTurnChange", combat.onCombatTurnChange);
  Hooks.on("deleteCombat", combat.onDeleteCombat);
  Hooks.on("createItem", combat.onCreateItem);
  Hooks.on("deleteItem", combat.onDeleteItem);
  Hooks.on("renderCombatTracker", (tracker, html) => combat.onRenderCombatTracker(tracker, html, { open: app.openWindow }));
  for (const hook of ["createItem", "deleteItem"]) {
    Hooks.on(hook, (item) => {
      if (item?.type === "effect" && item.parent?.documentName === "Actor") combat.redrawSoon(item.parent);
    });
  }

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM) return;
    const group = ensureSuiteGroup(controls);
    if (!group) return;
    group.tools[TOOL] = {
      name: TOOL,
      title: "GLLVG.tool",
      icon: "fa-solid fa-scale-balanced",
      button: true,
      order: 70,
      onChange: () => app.openWindow(),
    };
  });
  Hooks.on("renderSceneControls", (_app, html) => {
    if (game.user?.isGM) bindSuiteToolClicks(html, { [TOOL]: () => app.openWindow() });
  });
}

function onReady() {
  checks.registerCheckWrapper();
  checks.registerMassiveWrapper();
  setup.promptSetup(app.openWindow).catch((error) => console.error("GLUniverse Suite | level-ground: setup prompt failed", error));
}

/** `game.modules.get("gluniverse-foundry-modules").api.features["level-ground"]`; inert while the feature is off. */
const api = Object.freeze({
  openWindow: (tab) => (live ? mods.app.openWindow(tab) : null),
  strip: (actor) => (live ? mods.actors.strip(actor) : Promise.resolve(false)),
  unstrip: (actor) => (live ? mods.actors.unstrip(actor) : Promise.resolve(false)),
  setRole: (actor, role) => (live ? mods.actors.setRole(actor, role) : Promise.resolve(false)),
  rate,
  convertDC,
  levelDC,
});

Suite.register({
  id: "level-ground",
  title: "GLS.feature.level-ground.title",
  hint: "GLS.feature.level-ground.hint",
  icon: "fa-solid fa-scale-balanced",
  settingPrefix: "lvg.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,
  onInit,
  onReady,
  api,
});
