/**
 * Breath and Blood — Treat Wounds and Battle Medicine, the module's own
 * commands (rules: "These blocks replace the printed Treat Wounds activity
 * and Battle Medicine feat for a patient who has Stamina Points and Resolve
 * Points").
 *
 * Order, exactly as the Procedures give it: Field Surgeon is named, every
 * patient decides (and a payer spends the point), and only if someone paid is
 * one Medicine check made (`healer.skills.medicine.roll` with
 * `action:treat-wounds` / `action:battle-medicine`) and one healing roll made
 * for all of them, built as pf2e's own `treatWoundsMacroCallback` builds it.
 * A critical failure deals no damage. Treat Wounds leaves no immunity; Battle
 * Medicine leaves the patient immune to this healer's Battle Medicine for a day.
 *
 * The rolls happen on the healer's client. The writes happen where every
 * patient can be written: here, or on the active GM, who re-runs the decisions
 * on the live actors (`commitMedicine`).
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { emitSocket } from "../../core/socket.mjs";
import { bab, canWrite, commitState, flagPath, hasFeat, isTwoPool, medicineRank, poolActor, readState } from "./actor.mjs";
import { FEATS, FEATURE_ID, FLAG } from "./constants.mjs";
import { notify, postCard, t } from "./chat.mjs";
import * as R from "./rules.mjs";

let _active = () => false;
let _dials = () => ({});
let _resolve = () => null;
export function configureMedicine({ active, dials, resolveActor }) {
  _active = active;
  _dials = dials;
  _resolve = resolveActor;
}

const DEGREES = ["criticalFailure", "failure", "success", "criticalSuccess"];

/** What the healer brings. */
export function healerInfo(healer) {
  return {
    rank: medicineRank(healer),
    level: Math.max(0, Math.trunc(Number(healer?.level) || 0)),
    fsUsed: !!bab(healer)[FLAG.fieldSurgeonUsed],
    feats: {
      continualRecovery: hasFeat(healer, FEATS.continualRecovery),
      wardMedic: hasFeat(healer, FEATS.wardMedic),
      fieldSurgeon: hasFeat(healer, FEATS.fieldSurgeon),
      battleMedicine: hasFeat(healer, FEATS.battleMedicine),
      medicDedication: hasFeat(healer, FEATS.medicDedication),
      magicHands: hasFeat(healer, FEATS.magicHands),
      assurance: hasFeat(healer, FEATS.assurance),
    },
  };
}

/** Is this patient immune to this healer's Battle Medicine? */
export function bmImmune(patient, healer) {
  return (patient?.itemTypes?.effect ?? []).some((e) => e.flags?.[SUITE_ID]?.bab?.[FLAG.bmHealer] === healer?.id && !e.isExpired);
}

/** The window's model. `patients`: [{ actor, declines }]. */
export function treatModel({ kind, healers, healer, rank, assurance, surgeonId, patients }) {
  const d = _dials();
  const info = healer ? healerInfo(healer) : null;
  const limit = kind === "battle" ? 1 : R.wardMedicLimit(info?.rank ?? 1, info?.feats.wardMedic);
  const chosenRank = Math.min(Math.max(1, Number(rank) || info?.rank || 1), Math.max(1, info?.rank ?? 1));
  const fraction = kind === "treat" && info?.feats.continualRecovery ? R.FRACTION.half : R.FRACTION.quarter;
  const surgeonAvailable = kind === "treat" && !!info?.feats.fieldSurgeon && !info.fsUsed;
  const rows = patients.map((p) => {
    const holder = poolActor(p.actor);
    const two = isTwoPool(holder);
    const s = two ? readState(holder) : null;
    const surgeon = surgeonAvailable && surgeonId === p.actor.id;
    return {
      id: p.actor.id,
      uuid: p.actor.uuid,
      name: p.actor.name,
      twoPool: two,
      hp: s?.hp ?? 0,
      maxHP: s?.maxHP ?? 0,
      rp: s?.rp ?? 0,
      maxRP: s?.maxRP ?? 0,
      declines: !!p.declines,
      surgeon,
      minimum: s ? R.minimum(s, fraction) : 0,
      unpaidReason: s && !surgeon ? R.unpaidReason(s, { declines: p.declines }) : null,
      immune: kind === "battle" && healer ? bmImmune(p.actor, healer) : false,
    };
  });
  let refusal = null;
  let refusalData = {};
  if (!healer) refusal = "noHealer";
  else if (info.rank < 1) refusal = "noRank";
  else if (kind === "battle" && !info.feats.battleMedicine) {
    refusal = "noFeat";
    refusalData = { feat: t("GLBAB.feat.battle") };
  } else if (!rows.length) refusal = "noPatients";
  else if (rows.length > limit) {
    refusal = "tooMany";
    refusalData = { limit };
  } else if (rows.some((r) => !r.twoPool)) {
    refusal = "notTwoPools";
    refusalData = { name: rows.find((r) => !r.twoPool).name };
  } else if (rows.some((r) => r.immune)) {
    refusal = "bmImmune";
  }
  const assuranceResult = info ? R.assuranceResult(info.rank, info.level, { levelGround: d.levelGround }) : 0;
  return {
    kind,
    healers: healers.map((h) => ({ id: h.id, name: h.name, selected: h.id === healer?.id })),
    dcs: info ? R.treatChoices(info.rank, { levelGround: d.levelGround }).map((c) => ({ ...c, selected: c.rank === chosenRank })) : [],
    rank: chosenRank,
    assurance: { available: !!info?.feats.assurance, checked: !!assurance && !!info?.feats.assurance, result: assuranceResult },
    surgeon: {
      has: !!info?.feats.fieldSurgeon,
      used: !!info?.fsUsed,
      available: surgeonAvailable,
      options: rows.map((r) => ({ id: r.id, name: r.name, selected: r.id === surgeonId })),
    },
    limit,
    patients: rows,
    canRun: !refusal,
    refusal,
    refusalData,
  };
}

/** Run one treatment from the healer's client. */
export async function runMedicine({ kind = "treat", healer, rank, assurance = false, surgeonId = null, patients = [] }) {
  if (!_active()) return null;
  const d = _dials();
  const model = treatModel({ kind, healers: [healer].filter(Boolean), healer, rank, assurance, surgeonId, patients });
  if (!model.canRun) {
    notify(`GLBAB.refuse.${model.refusal}`, model.refusalData, "warn");
    return null;
  }
  if (!canWrite(healer)) {
    notify("GLBAB.refuse.notOwner", { name: healer.name }, "warn");
    return null;
  }
  const info = healerInfo(healer);
  const slug = kind === "battle" ? "battle-medicine" : "treat-wounds";
  const holders = patients.map((p) => poolActor(p.actor));
  const rows = holders.map((h, i) => ({ state: readState(h), declines: !!patients[i].declines, surgeon: model.patients[i].surgeon }));
  const needed =
    kind === "battle" ? R.decide(rows[0].state, { declines: rows[0].declines }).kind === R.KIND.paid : R.treatDecide(rows, { surgeonAvailable: model.surgeon.available }).checkNeeded;

  let checkMade = false;
  let degree = null;
  let rolled = 0;
  let formula = null;
  if (needed) {
    const dc = R.treatDC(model.rank, { levelGround: d.levelGround });
    if (model.assurance.checked) {
      const total = model.assurance.result;
      degree = R.degreeOf(total, dc);
      await postCard(
        { title: { k: `GLBAB.treat.kind.${kind}`, d: {} }, tone: "info", rows: [{ name: healer.name, lines: [{ k: "GLBAB.card.assurance", d: { total, dc, degree: t(`GLBAB.degree.${degree}`) } }] }] },
        { actor: healer },
      );
    } else {
      const roll = await healer.skills?.medicine?.roll({
        dc: { value: dc, visible: true },
        extraRollOptions: [`action:${slug}`],
        action: slug,
        traits: kind === "battle" ? ["healing", "manipulate"] : ["exploration", "healing", "manipulate"],
        label: t(`GLBAB.treat.kind.${kind}`),
      });
      if (!roll) return null;
      degree = DEGREES[roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess] ?? "failure";
    }
    checkMade = true;
    formula = R.healFormula({ degree, rank: model.rank, medicDedication: info.feats.medicDedication, magicHands: info.feats.magicHands, level: info.level });
    if (formula) {
      const roll = await new Roll(formula).evaluate();
      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: healer }),
        flavor: t("GLBAB.treat.healRoll", { kind: t(`GLBAB.treat.kind.${kind}`), degree: t(`GLBAB.degree.${degree}`) }),
      });
      rolled = roll.total;
    }
  }

  const payload = {
    op: "medicine",
    kind,
    healer: healer.uuid,
    rank: model.rank,
    checkMade,
    degree,
    rolled,
    formula,
    patients: patients.map((p, i) => ({ uuid: p.actor.uuid, declines: !!p.declines, surgeon: !!model.patients[i].surgeon })),
  };
  if (holders.every((h) => canWrite(h))) return commitMedicine(payload, { healer });
  if (!game.users?.activeGM) {
    notify("GLBAB.notify.noGM", null, "warn");
    return null;
  }
  emitSocket(FEATURE_ID, payload, { recipients: [game.users.activeGM.id] });
  notify("GLBAB.notify.sent");
  return payload;
}

/** Apply a treatment to the live actors. Runs where every patient can be written. */
export async function commitMedicine(payload, { healer }) {
  const info = healerInfo(healer);
  const kind = payload.kind === "battle" ? "battle" : "treat";
  const patients = (payload.patients ?? []).map((p) => ({ ...p, actor: _resolve(p.uuid) })).filter((p) => p.actor);
  const holders = patients.map((p) => poolActor(p.actor));
  if (!patients.length || holders.some((h) => !isTwoPool(h))) return null;
  const rolled = Math.max(0, Math.trunc(Number(payload.rolled) || 0));
  const results = [];

  if (kind === "battle") {
    const p = patients[0];
    if (bmImmune(p.actor, healer)) return null;
    const before = readState(holders[0]);
    const r = R.battleMedicine(before, payload.checkMade ? rolled : 0, { declines: p.declines });
    await commitState(holders[0], before, r.state, { tag: "medicine" });
    results.push({ name: p.actor.name, kind: r.kind, reason: r.reason, heal: r.heal });
    try {
      await p.actor.createEmbeddedDocuments("Item", [
        {
          type: "effect",
          name: t("GLBAB.effect.battle", { healer: healer.name }),
          img: "systems/pf2e/icons/features/feats/treat-wounds.webp",
          system: { slug: `glbab-battle-medicine-${healer.id}`, duration: { value: 1, unit: "days", sustained: false, expiry: "turn-start" }, tokenIcon: { show: true }, rules: [] },
          flags: { [SUITE_ID]: { bab: { [FLAG.bmHealer]: healer.id } } },
        },
      ]);
    } catch (error) {
      warn("breath-and-blood | could not mark Battle Medicine immunity", error);
    }
  } else {
    const surgeonAvailable = info.feats.fieldSurgeon && !info.fsUsed;
    const rows = holders.map((h, i) => ({ state: readState(h), declines: !!patients[i].declines, surgeon: !!patients[i].surgeon }));
    const dec = R.treatDecide(rows, { surgeonAvailable });
    const applied = R.treatApply(dec.rows, dec.checkNeeded && payload.checkMade ? rolled : 0, { continualRecovery: info.feats.continualRecovery, checkMade: dec.checkNeeded });
    for (let i = 0; i < holders.length; i++) {
      await commitState(holders[i], rows[i].state, applied[i].heal.state, { tag: "medicine" });
      results.push({ name: patients[i].actor.name, kind: applied[i].kind, reason: applied[i].reason, surgeon: applied[i].surgeon, heal: applied[i].heal });
    }
    if (dec.surgeonUsed) await healer.update({ [flagPath(FLAG.fieldSurgeonUsed)]: true }, { glbab: "medicine" });
  }

  const head = payload.checkMade
    ? { k: "GLBAB.card.check", d: { degree: t(`GLBAB.degree.${payload.degree ?? "failure"}`), rolled } }
    : { k: "GLBAB.card.noCheck" };
  await postCard(
    {
      title: { k: `GLBAB.card.medicine.${kind}`, d: { healer: healer.name } },
      tone: "good",
      rows: [{ lines: [head] }].concat(
        results.map((r) => ({
          name: r.name,
          lines: patientLines(r),
        })),
      ),
      foot: kind === "battle" ? { k: "GLBAB.card.bmImmune", d: { healer: healer.name } } : null,
    },
    { actor: healer },
  );
  return results;
}

function patientLines(r) {
  if (r.kind === R.KIND.unpaid) {
    const lines = [{ k: `GLBAB.unpaid.${r.reason ?? "declined"}` }];
    if (r.heal.toHP > 0) lines.push({ k: "GLBAB.card.oneHP" });
    return lines;
  }
  const lines = [{ k: "GLBAB.card.restored", d: { hp: r.heal.toHP, sp: r.heal.toSP } }];
  lines.push(r.surgeon ? { k: "GLBAB.card.surgeon" } : { k: "GLBAB.card.rpSpent", d: { rp: 1 } });
  if (r.heal.minimumApplied) lines.push({ k: "GLBAB.card.minimum", d: { minimum: r.heal.minimum } });
  if (r.heal.endedDying) lines.push({ k: "GLBAB.card.endedDying" });
  return lines;
}
