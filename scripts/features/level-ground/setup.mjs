/**
 * Level Ground — world setup.
 *
 * Proficiency is PF2e's own Proficiency without Level, with its five modifiers
 * at −2 / +2 / +4 / +6 / +8 (the system's own initial values). The feature
 * never flips those settings on its own: on ready the active GM is asked, and
 * the window's Setup tab shows each item with a button. Automatic bonus
 * progression is recommended, not required. pf2e-flatten and Flatfinder are
 * other flat-accuracy rule sets; with Level Ground they subtract level a second
 * time, so the tab names them for as long as either is on.
 */

import { Suite } from "../../core/registry.mjs";
import { CONFLICTS, PWOL } from "./constants.mjs";
import { flattenedByPf2eFlatten, levelProfAudit, strippable, unstrippedActors } from "./actors.mjs";
import { stripRecord } from "./world.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const pf2eSetting = (key) => {
  try {
    return game.settings.get("pf2e", key);
  } catch {
    return undefined;
  }
};

const RANK_NAMES = ["untrained", "trained", "expert", "master", "legendary"];

/** The Setup tab's model. */
export function setupModel() {
  const enabled = pf2eSetting(PWOL.enabled) === true;
  const modifiers = PWOL.modifiers.map(([key, want], i) => {
    const value = Number(pf2eSetting(key));
    return { key, rank: RANK_NAMES[i], value, want, ok: value === want };
  });
  const abpValue = pf2eSetting(PWOL.abp) ?? null;
  const conflicts = CONFLICTS.filter((id) => {
    try {
      return Suite.enabled(id);
    } catch {
      return false;
    }
  }).map((id) => ({ id, title: t(Suite.get(id)?.title ?? id) }));
  const audit = levelProfAudit();
  const npcs = (game.actors?.contents ?? []).filter(strippable);
  const pwolOk = enabled && modifiers.every((m) => m.ok);
  return {
    pwol: { enabled, modifiers, ok: pwolOk },
    abp: { value: abpValue, ok: abpValue === "ABPFundamentalPotency" || abpValue === "ABPRulesAsWritten" },
    conflicts,
    levelProf: { count: audit.length, items: audit.map(({ actor, item }) => ({ actor: actor.name, item: item.name })) },
    unstripped: unstrippedActors().length,
    flattened: npcs.filter((a) => !stripRecord(a) && flattenedByPf2eFlatten(a)).length,
    problems: !pwolOk || conflicts.length > 0,
  };
}

/** Turn on Proficiency without Level with Level Ground's bonuses. Asked for, never silent. */
export async function fixPwol() {
  if (!game.user?.isGM) return;
  await game.settings.set("pf2e", PWOL.enabled, true);
  for (const [key, value] of PWOL.modifiers) {
    if (Number(pf2eSetting(key)) !== value) await game.settings.set("pf2e", key, value);
  }
  ui.notifications?.info(t("GLLVG.setup.pwolFixed"));
}

export async function fixAbp() {
  if (!game.user?.isGM) return;
  await game.settings.set("pf2e", PWOL.abp, PWOL.abpRecommended);
  ui.notifications?.info(t("GLLVG.setup.abpFixed"));
}

/** On ready, the active GM is asked once per load while the proficiency settings are off or wrong. */
export async function promptSetup(openWindow) {
  const isActive = !!game.user?.isActiveGM || game.users?.activeGM?.id === game.user?.id;
  if (!isActive) return;
  const model = setupModel();
  if (!model.problems) return;
  const lines = [];
  if (!model.pwol.ok) lines.push(`<p>${t("GLLVG.setup.prompt.pwol")}</p>`);
  for (const c of model.conflicts) lines.push(`<p>${t("GLLVG.setup.conflict", { feature: c.title })}</p>`);
  const DialogV2 = foundry.applications.api.DialogV2;
  const buttons = [];
  if (!model.pwol.ok) buttons.push({ action: "fix", label: t("GLLVG.setup.fixPwol"), icon: "fa-solid fa-wrench", default: true });
  buttons.push({ action: "open", label: t("GLLVG.setup.prompt.open"), icon: "fa-solid fa-scale-balanced" });
  buttons.push({ action: "later", label: t("GLLVG.setup.prompt.later") });
  const choice = await DialogV2.wait({
    window: { title: t("GLLVG.setup.prompt.title") },
    content: `<div class="gllvg-dialog-note">${lines.join("")}</div>`,
    buttons,
    rejectClose: false,
  });
  if (choice === "fix") await fixPwol();
  if (choice === "open") openWindow?.("setup");
}
