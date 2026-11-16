/**
 * Level Ground — what the feature writes to actors and items.
 *
 * Strip and Unstrip, the roles, and the three rewrites made as an item is
 * created on an actor (level as a proficiency bonus, battle forms, items that
 * impose their own DC). Plus the surfaces that reach them: the sheet marker,
 * the actor directory's context menu and the token HUD's role button.
 *
 * Strip writes stored data, once, and keeps every value it overwrites in the
 * `lvg.strip` flag as `[path, value]` pairs, so Unstrip restores the printed
 * stat block exactly. The flag travels with a duplicate or an export, which is
 * what stops a second Strip. The arithmetic is `stripActor` (rules.mjs); the
 * paths are `stripPlan` (logic.mjs); this file only writes them.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { MODIFIER_LABEL as FLATTEN_LABEL, MODIFIER_SLUG as FLATTEN_SLUG } from "../pf2e-flatten/constants.js";
import { FLAGS, flagPath } from "./constants.mjs";
import {
  hasBattleForm,
  isFlattened,
  itemDCEligible,
  levelProfValue,
  rewriteBattleForm,
  rewriteLevelProf,
  roleSourceMax,
  shiftInlineDCs,
  stripPlan,
  unstripPlan,
} from "./logic.mjs";
import { RULES_VERSION } from "./rules.mjs";
import { on } from "./settings.mjs";
import { sheetMarkerHTML } from "./view.mjs";
import { flagOf, printedLevel, roleOf, stripRecord } from "./world.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const notify = (kind, key, data) => ui.notifications?.[kind]?.(t(key, data));

const asElement = (html) => (html instanceof HTMLElement ? html : html?.[0] ?? null);

/* ── Strip ────────────────────────────────────────────────────────────── */

export const strippable = (actor) => actor?.type === "npc" || actor?.type === "hazard";
export const flattenedByPf2eFlatten = (actor) => isFlattened(actor, { label: FLATTEN_LABEL, slug: FLATTEN_SLUG });

/**
 * Why an actor cannot be Stripped, as a lang key, or null when it can.
 * A GM decides; a player never writes a stat block.
 */
export function stripRefusal(actor) {
  if (!game.user?.isGM) return "GLLVG.strip.refuse.gm";
  if (!strippable(actor)) return "GLLVG.strip.refuse.type";
  if (stripRecord(actor)) return "GLLVG.strip.refuse.already";
  if (flattenedByPf2eFlatten(actor)) return "GLLVG.strip.refuse.flattened";
  return null;
}

/** Strip an NPC or hazard (a token's synthetic actor writes to its delta). Returns true when it wrote. */
export async function strip(actor, { quiet = false } = {}) {
  const refusal = stripRefusal(actor);
  if (refusal) {
    if (!quiet) notify("warn", refusal, { name: actor?.name ?? "" });
    return false;
  }
  const level = printedLevel(actor) ?? 0;
  const plan = stripPlan(actor.toObject(), level);
  const record = { level, rules: RULES_VERSION, printed: plan?.printed ?? { actor: [], items: [] } };
  // The flag goes in the same update as the actor's own paths and before the
  // items: an interrupted Strip then reads as Stripped and Unstrip puts back
  // whatever it changed, where the other order could Strip the items twice.
  await actor.update({ ...(plan?.actor ?? {}), [flagPath(FLAGS.strip)]: record });
  if (plan?.items?.length) await actor.updateEmbeddedDocuments("Item", plan.items);
  if (on("itemDCs")) await applyCarriedItemDCs(actor);
  if (!quiet) notify("info", "GLLVG.strip.done", { name: actor.name, level });
  return true;
}

/** Put the printed values back and drop the record. */
export async function unstrip(actor, { quiet = false } = {}) {
  if (!game.user?.isGM) return false;
  const record = stripRecord(actor);
  if (!record) {
    if (!quiet) notify("warn", "GLLVG.strip.refuse.notStripped", { name: actor?.name ?? "" });
    return false;
  }
  const plan = unstripPlan(record);
  const items = plan.items.filter((u) => actor.items.has(u._id));
  if (Object.keys(plan.actor).length) await actor.update(plan.actor);
  if (items.length) await actor.updateEmbeddedDocuments("Item", items);
  await actor.unsetFlag(SUITE_ID, FLAGS.strip);
  if (!quiet) notify("info", "GLLVG.strip.undone", { name: actor.name });
  return true;
}

/** Every world NPC and hazard not yet Stripped (and not carrying pf2e-flatten's modifier). */
export const unstrippedActors = () =>
  (game.actors?.contents ?? []).filter((a) => strippable(a) && !stripRecord(a) && !flattenedByPf2eFlatten(a));

export async function stripAll() {
  const list = unstrippedActors();
  notify("info", "GLLVG.strip.allStart", { count: list.length });
  let n = 0;
  for (const actor of list) {
    try {
      if (await strip(actor, { quiet: true })) n += 1;
    } catch (error) {
      console.error("GLUniverse Suite | level-ground: Strip failed for", actor?.name, error);
    }
  }
  notify("info", "GLLVG.strip.allDone", { count: n });
  return n;
}

/* ── Roles ────────────────────────────────────────────────────────────── */

const MARKER_IMG = {
  mook: "icons/svg/pawprint.svg",
  solo: "icons/svg/skull.svg",
  summoned: "icons/svg/sun.svg",
};

/** The role marker effect and Solo's two abilities: plain items, no rules. */
function roleItems(role) {
  const flags = { [SUITE_ID]: { lvg: { roleMarker: role } } };
  const items = [
    {
      name: t(`GLLVG.role.${role}`),
      type: "effect",
      img: MARKER_IMG[role] ?? "icons/svg/aura.svg",
      system: {
        description: { value: `<p>${t(`GLLVG.roleText.${role}`)}</p>` },
        duration: { value: -1, unit: "unlimited", expiry: null, sustained: false },
        tokenIcon: { show: true },
        rules: [],
      },
      flags,
    },
  ];
  if (role === "solo") {
    for (const key of ["tempo", "unbowed"]) {
      items.push({
        name: t(`GLLVG.solo.${key}.name`),
        type: "action",
        img: key === "tempo" ? "icons/svg/clockwork.svg" : "icons/svg/shield.svg",
        system: {
          description: { value: `<p>${t(`GLLVG.solo.${key}.text`)}</p>` },
          actionType: { value: key === "tempo" ? "free" : "passive" },
          actions: { value: null },
          category: key === "tempo" ? "offensive" : "defensive",
          rules: [],
          traits: { value: [], rarity: "common" },
        },
        flags,
      });
    }
  }
  return items;
}

/**
 * Set a creature's role ("none", "mook", "solo", "summoned"). Hit Points: the
 * printed maximum is kept in the flag the first time, and the stored maximum
 * is set so the prepared one equals role(printed + adjustment) — elite or weak
 * first, then the role. PF2e's `_preUpdate` clamps an incoming `hp.value`
 * against the maximum the actor has at that moment, so the maximum and the
 * value are written in two updates (NPCs have no DataModel; `hp.max` is a plain
 * source field).
 */
export async function setRole(actor, role) {
  if (!game.user?.isGM || actor?.type !== "npc") return false;
  const next = ["mook", "solo", "summoned"].includes(role) ? role : "none";
  const stored = flagOf(actor, FLAGS.role);
  const printedMax = Number(stored?.printedMax ?? actor._source?.system?.attributes?.hp?.max ?? 0);
  const hp = actor.system?.attributes?.hp ?? {};
  const sourceMax = Number(actor._source?.system?.attributes?.hp?.max ?? 0);
  const adjustHP = Number(hp.max ?? sourceMax) - sourceMax;
  const wasFull = Number(hp.value) >= Number(hp.max);

  const newSource = next === "none" ? printedMax : roleSourceMax({ role: next, printedMax, adjustHP });
  const update = { "system.attributes.hp.max": newSource };
  if (next !== "none") update[flagPath(FLAGS.role)] = { role: next, printedMax };
  await actor.update(update);
  if (next === "none" && stored) await actor.unsetFlag(SUITE_ID, FLAGS.role);
  const preparedMax = Number(actor.system?.attributes?.hp?.max ?? newSource);
  const value = wasFull ? preparedMax : Math.min(Number(hp.value) || 0, preparedMax);
  await actor.update({ "system.attributes.hp.value": value });

  // Markers: drop the old ones, add the new role's.
  const old = actor.items.filter((i) => flagOf(i, FLAGS.roleMarker));
  if (old.length) await actor.deleteEmbeddedDocuments("Item", old.map((i) => i.id));
  if (next !== "none") await actor.createEmbeddedDocuments("Item", roleItems(next));
  notify("info", "GLLVG.role.set", { name: actor.name, role: t(`GLLVG.role.${next}`) });
  return true;
}

/** Ask for a role, then set it. */
export async function promptRole(actor) {
  if (!game.user?.isGM || actor?.type !== "npc") return;
  const DialogV2 = foundry.applications.api.DialogV2;
  const current = roleOf(actor);
  const choice = await DialogV2.wait({
    window: { title: t("GLLVG.role.dialog", { name: actor.name }) },
    content: `<p class="gllvg-dialog-note">${t("GLLVG.role.dialogHint")}</p>`,
    buttons: ["none", "mook", "solo", "summoned"].map((r) => ({
      action: r,
      label: t(`GLLVG.role.${r}`),
      default: r === current,
    })),
    rejectClose: false,
  });
  if (choice && choice !== current) await setRole(actor, choice);
}

/* ── Rewrites as items arrive on actors ───────────────────────────────── */

const untrainedModifier = () => {
  try {
    return Number(game.settings.get("pf2e", "proficiencyUntrainedModifier")) || -2;
  } catch {
    return -2;
  }
};

/** Level as a proficiency bonus: the rule elements' new values, or null when none applies. */
export function levelProfPatch(itemData) {
  if (flagOf(itemData, FLAGS.levelProf)) return null;
  const { rules, changed } = rewriteLevelProf(itemData?.system?.rules ?? [], untrainedModifier());
  if (!changed.length) return null;
  return { "system.rules": rules, [flagPath(FLAGS.levelProf)]: { value: levelProfValue(untrainedModifier()), printed: changed } };
}

/** A battle form's fixed values with level taken out, or null. */
export function battleFormPatch(itemData) {
  if (flagOf(itemData, FLAGS.battleForm)) return null;
  const rules = itemData?.system?.rules ?? [];
  if (!hasBattleForm(rules)) return null;
  const slug = itemData?.system?.slug ?? "";
  const spell = /^spell-effect-/.test(slug) || /^Spell Effect:/i.test(itemData?.name ?? "");
  const level = Number(itemData?.system?.level?.value ?? 1);
  const out = rewriteBattleForm(rules, { level, spell });
  if (!out.changed) return null;
  return { "system.rules": out.rules, [flagPath(FLAGS.battleForm)]: { level, spell, printed: rules } };
}

/** An item that imposes its own DC: each inline DC loses the item's level. */
export function itemDCPatch(itemData) {
  if (flagOf(itemData, FLAGS.itemDC)) return null;
  if (!itemDCEligible(itemData)) return null;
  const level = Number(itemData.system.level.value);
  const before = itemData.system.description.value;
  const after = shiftInlineDCs(before, level);
  if (after === before) return null;
  return { "system.description.value": after, [flagPath(FLAGS.itemDC)]: { level, printed: before } };
}

/** The `preCreateItem` hook: rewrite an item as it is created on an actor, on the creating client. */
export function onPreCreateItem(item, data, _options, userId) {
  if (userId !== game.user?.id) return;
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor") return;
  const source = item.toObject ? item.toObject() : data;
  const patch = {};
  if (on("levelProf")) Object.assign(patch, levelProfPatch(source) ?? {});
  if (on("battleForms") && actor.type === "character" && source.type === "effect") Object.assign(patch, battleFormPatch(source) ?? {});
  if (on("itemDCs")) Object.assign(patch, itemDCPatch(source) ?? {});
  if (Object.keys(patch).length) item.updateSource(patch);
}

/** Carried items on a creature: the item rule by the item's own level (Strip never changes them). */
export async function applyCarriedItemDCs(actor) {
  const updates = [];
  for (const item of actor.items ?? []) {
    const patch = itemDCPatch(item.toObject());
    if (patch) updates.push({ _id: item.id, ...patch });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

/** Items already on actors that still add level as a proficiency bonus. */
export function levelProfAudit() {
  const out = [];
  for (const actor of game.actors?.contents ?? []) {
    for (const item of actor.items ?? []) {
      const src = item.toObject();
      if (levelProfPatch(src)) out.push({ actor, item });
    }
  }
  return out;
}

export async function fixLevelProf() {
  const byActor = new Map();
  for (const { actor, item } of levelProfAudit()) {
    const patch = levelProfPatch(item.toObject());
    if (!patch) continue;
    const list = byActor.get(actor) ?? [];
    list.push({ _id: item.id, ...patch });
    byActor.set(actor, list);
  }
  let n = 0;
  for (const [actor, updates] of byActor) {
    await actor.updateEmbeddedDocuments("Item", updates);
    n += updates.length;
  }
  notify("info", "GLLVG.setup.levelProfFixed", { count: n });
  return n;
}

/* ── Hooks on actors ──────────────────────────────────────────────────── */

/** Auto-Strip a new NPC or hazard, and halve a summoned one, on the creating GM's client. */
export async function onCreateActor(actor, _options, userId) {
  if (userId !== game.user?.id || !game.user?.isGM) return;
  try {
    if (on("autoStrip") && strippable(actor) && !stripRecord(actor) && !flattenedByPf2eFlatten(actor)) {
      await strip(actor, { quiet: true });
    }
    if (on("autoSummoned") && actor.type === "npc" && roleOf(actor) === "none" && actor.system?.traits?.value?.includes?.("summoned")) {
      await setRole(actor, "summoned");
    }
  } catch (error) {
    console.error("GLUniverse Suite | level-ground: new actor handling failed", error);
  }
}

/** A Stripped creature's level changed: tell the GM who changed it; never re-strip on our own. */
export function onUpdateActor(actor, changes, _options, userId) {
  if (userId !== game.user?.id || !game.user?.isGM) return;
  const record = stripRecord(actor);
  const nextLevel = changes?.system?.details?.level?.value;
  if (record && nextLevel !== undefined && Number(nextLevel) !== Number(record.level)) {
    notify("warn", "GLLVG.strip.levelChanged", { name: actor.name, from: record.level, to: nextLevel });
  }
  // Elite or weak toggled on a creature with a role: its Hit Points follow.
  if (changes?.system?.attributes && "adjustment" in changes.system.attributes && roleOf(actor) !== "none") {
    setRole(actor, roleOf(actor)).catch((error) => console.error("GLUniverse Suite | level-ground: role refresh failed", error));
  }
}

/* ── Surfaces ─────────────────────────────────────────────────────────── */

/** The marker on an NPC or hazard sheet: "Stripped, level N", the role, and Unstrip for a GM. */
export function onRenderActorSheet(app, html) {
  const actor = app?.actor ?? app?.document;
  if (!strippable(actor)) return;
  const root = asElement(html);
  if (!root) return;
  root.querySelector(".gllvg-marker")?.remove();
  const record = stripRecord(actor);
  const role = roleOf(actor);
  if (!record && role === "none") return;
  const holder = document.createElement("div");
  holder.innerHTML = sheetMarkerHTML({ stripped: record, role, canEdit: !!game.user?.isGM }, { t });
  const marker = holder.firstElementChild;
  if (!marker) return;
  marker.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-lvg-action='unstrip']");
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    await unstrip(actor);
  });
  const content = root.querySelector(".window-content") ?? root;
  content.prepend(marker);
}

const actorFromLi = (li) => {
  const el = li instanceof HTMLElement ? li : li?.[0] ?? null;
  const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
  return id ? game.actors?.get(id) ?? null : null;
};

/** Actor directory right-click: Strip, Unstrip, Set role. */
export function onActorContext(_app, options) {
  if (!game.user?.isGM || !Array.isArray(options)) return;
  options.push(
    {
      name: t("GLLVG.context.strip"),
      icon: '<i class="fa-solid fa-scale-balanced"></i>',
      condition: (li) => {
        const a = actorFromLi(li);
        return strippable(a) && !stripRecord(a);
      },
      callback: (li) => strip(actorFromLi(li)),
    },
    {
      name: t("GLLVG.context.unstrip"),
      icon: '<i class="fa-solid fa-rotate-left"></i>',
      condition: (li) => !!stripRecord(actorFromLi(li)),
      callback: (li) => unstrip(actorFromLi(li)),
    },
    {
      name: t("GLLVG.context.role"),
      icon: '<i class="fa-solid fa-chess-king"></i>',
      condition: (li) => actorFromLi(li)?.type === "npc",
      callback: (li) => promptRole(actorFromLi(li)),
    },
  );
}

/** Token HUD: a role button for a GM on an NPC token (writes the synthetic actor of an unlinked token). */
export function onRenderTokenHUD(hud, html) {
  if (!game.user?.isGM) return;
  const actor = hud?.object?.actor ?? hud?.document?.actor;
  if (actor?.type !== "npc") return;
  const root = asElement(html);
  const col = root?.querySelector(".col.right") ?? root?.querySelector(".right");
  if (!col || col.querySelector(".gllvg-hud")) return;
  const role = roleOf(actor);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon gllvg-hud";
  button.dataset.tooltipText = t("GLLVG.hud.role", { role: t(`GLLVG.role.${role}`) });
  button.innerHTML = `<i class="fa-solid ${role === "solo" ? "fa-chess-king" : role === "mook" ? "fa-chess-pawn" : role === "summoned" ? "fa-wand-sparkles" : "fa-chess"}" inert></i>`;
  if (role !== "none") button.classList.add("active");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    promptRole(actor);
  });
  col.append(button);
}
