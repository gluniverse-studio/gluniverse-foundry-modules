/**
 * Breath and Blood — every test vector of the rules file (rules version 0.9),
 * ported from `stamina/sim/vectors.py`, run against the SHIPPED rules module.
 *
 * `run(R)` takes the imported `scripts/features/breath-and-blood/rules.mjs` and
 * returns one row per vector: { id, got, expected }. The check tool compares.
 * Each line restates the Python reference line for line, so a reader can hold
 * the two side by side.
 */

export function run(R) {
  const rows = [];
  const chk = (id, got, expected) => rows.push({ id, got, expected });
  const C = (o = {}) => R.makePools(o);
  const pools = (cls, con, lvl, anc, extra = 0) => {
    const p = R.characterPools({ classHP: cls, con, level: lvl, ancestryHP: anc, extra });
    return [p.maxSP, p.maxHP];
  };
  const companion = (H) => {
    const p = R.companionPools(H, { role: "companion", maxResolve: 4 });
    return [p.maxSP, p.maxHP, p.maxRP];
  };
  const dmg = (c, n, direct = false) => R.damage(c, n, { direct });
  const heal = (c, rolled, kind, fr = R.FRACTION.quarter) => R.applyHealing(c, rolled, kind, fr).state;
  /** heal(c, rolled, decide(c)) */
  const healDecided = (c, rolled, { declines = false, fr = R.FRACTION.quarter } = {}) => {
    const d = R.decide(c, { declines });
    return heal(d.state, rolled, d.kind, fr);
  };
  let LW = false;
  const breather = (c) => R.breather(c, { lingeringWounds: LW }).state;
  const treat = (list, rolled, { cr = false, surgeon = null } = {}) =>
    R.treatWounds(
      list.map((c, i) => ({ state: c, declines: false, surgeon: surgeon === i })),
      rolled,
      { continualRecovery: cr },
    );
  const bm = (c, rolled, declines = false) => R.battleMedicine(c, rolled, { declines }).state;

  // ── Pools ────────────────────────────────────────────────────────────────
  chk("P1", pools(10, 2, 5, 8), [35, 33]);
  chk("P2", pools(10, 2, 1, 8), [7, 13]);
  chk("P3", pools(8, 1, 3, 6), [15, 18]);
  chk("P4", pools(6, 1, 8, 6), [32, 30]);
  chk("P5", pools(6, -1, 4, 6), [8, 18]);
  chk("P6", pools(6, -3, 2, 6), [2, 12]);
  chk("P7", pools(12, 4, 10, 10, 10), [100, 80]);
  chk("P8", companion(71), [35, 36, 3]);
  chk("P9", companion(15), [7, 8, 3]);

  // ── Damage ───────────────────────────────────────────────────────────────
  let c = C();
  c = dmg(c, 20).state;
  chk("D1", [c.sp, c.hp], [15, 33]);
  c = dmg(c, 22).state;
  chk("D2", [c.sp, c.hp], [0, 26]);
  c = dmg(C({ temp: 5 }), 12).state;
  chk("D3", [c.temp, c.sp, c.hp], [0, 28, 33]);
  c = dmg(C({ sp: 10, hp: 6 }), 30).state;
  chk("D4", [c.sp, c.hp], [0, 0]);
  c = dmg(C(), 9, true).state;
  chk("D5", [c.sp, c.hp], [35, 24]);
  c = dmg(C({ temp: 4 }), 9, true).state;
  chk("D6", [c.temp, c.sp, c.hp], [0, 35, 28]);
  chk("D7", dmg(C(), 136).massive, true);
  {
    const r = dmg(C(), 135);
    chk("D8", [r.massive, r.state.sp, r.state.hp], [false, 0, 0]);
  }
  chk("D9", dmg(C({ temp: 10 }), 136).massive, true);

  // ── Healing ──────────────────────────────────────────────────────────────
  c = heal(C({ sp: 0, hp: 20 }), 40, R.KIND.spent);
  chk("H1", [c.sp, c.hp, c.rp], [27, 33, 4]);
  c = healDecided(C({ sp: 0, hp: 20 }), 5);
  chk("H2", [c.sp, c.hp, c.rp], [0, 28, 3]);
  c = healDecided(C({ sp: 0, hp: 20 }), 19);
  chk("H3", [c.sp, c.hp, c.rp], [0, 33, 3]);
  c = healDecided(C({ sp: 0, hp: 20, rp: 0 }), 19);
  chk("H4", [c.sp, c.hp, c.rp], [0, 20, 0]);
  c = healDecided(C({ sp: 0, hp: 0, rp: 0 }), 19);
  chk("H5", [c.sp, c.hp, c.rp], [0, 1, 0]);
  c = healDecided(C({ sp: 0, hp: 0, rp: 2 }), 3);
  chk("H6", [c.sp, c.hp, c.rp], [0, 8, 1]);
  c = healDecided(C({ sp: 20, hp: 30, rp: 3 }), 2);
  chk("H7", [c.sp, c.hp, c.rp], [20, 33, 2]);
  c = healDecided(C({ level: 1, maxSP: 7, maxHP: 13, hp: 4 }), 0);
  chk("H8", [c.hp, c.rp], [7, 3]);
  c = healDecided(C({ level: 1, maxSP: 2, maxHP: 3, hp: 1, rp: 2 }), 0);
  chk("H9", [c.hp, c.rp], [2, 1]);
  c = healDecided(C({ hp: 20, rp: 2 }), 18, { declines: true });
  chk("H10", [c.sp, c.hp, c.rp], [35, 20, 2]);
  c = healDecided(C({ sp: 20, rp: 3 }), 19);
  chk("H11", [c.sp, c.hp, c.rp], [20, 33, 3]);
  c = heal(C({ sp: 20, hp: 30 }), 10, R.KIND.spent);
  chk("H12", [c.sp, c.hp, c.rp], [27, 33, 4]);

  // ── Treat Wounds, Battle Medicine, Medicine feats ────────────────────────
  {
    let t = treat([C({ hp: 10, rp: 2, wounded: 1 })], 17).states[0];
    const w = t.wounded;
    t = breather(t);
    chk("T1", [t.hp, t.rp, w, t.wounded], [27, 1, 1, 0]);
  }
  c = treat([C({ hp: 10, rp: 2, wounded: 1 })], 30).states[0];
  chk("T2", [c.sp, c.hp, c.rp], [35, 33, 1]);
  c = breather(treat([C({ hp: 10, rp: 2, wounded: 1 })], 0).states[0]);
  chk("T3", [c.hp, c.rp, c.wounded], [18, 1, 0]);
  c = treat([C({ hp: 10, rp: 2, wounded: 1 })], 12, { cr: true }).states[0];
  chk("T4", [c.hp, c.rp], [26, 1]);
  c = treat([C({ hp: 10, rp: 0 })], 0, { surgeon: 0 }).states[0];
  chk("T5", [c.hp, c.rp], [18, 0]);
  c = treat([C({ hp: 10, rp: 0 })], 0, { cr: true, surgeon: 0 }).states[0];
  chk("T6", [c.hp, c.rp], [26, 0]);
  {
    const r = treat([C({ hp: 10, rp: 0 })], 19);
    chk("T7", [r.checkMade, r.states[0].hp, r.states[0].rp], [false, 10, 0]);
  }
  {
    const [a, b] = treat([C({ hp: 20, rp: 2 }), C({ hp: 20, rp: 0 })], 19).states;
    chk("T8", [a.hp, a.rp, b.hp, b.rp], [33, 1, 20, 0]);
  }
  {
    const [a, b] = treat([C({ hp: 20, rp: 2 }), C({ hp: 20, rp: 0 })], 19, { surgeon: 1 }).states;
    chk("T9", [a.hp, a.rp, b.hp, b.rp], [33, 1, 33, 0]);
  }
  {
    let t = R.startEncounter(C({ hp: 20, rp: 1, wounded: 1 }));
    t = bm(t, 0);
    t = R.endEncounter(t);
    t = breather(t);
    chk("T10", [t.hp, t.rp, t.wounded], [28, 0, 1]);
  }
  {
    const lg = { levelGround: true };
    const expert = R.assuranceResult(2, 5, lg);
    chk("T11", [R.degreeOf(expert, R.treatDC(2, lg)), R.degreeOf(expert, R.treatDC(1, lg))], ["failure", "success"]);
    const master = R.assuranceResult(3, 5, lg);
    chk("T12", R.degreeOf(master, R.treatDC(2, lg)), "success");
  }
  {
    const [a, b] = treat([C({ hp: 20, rp: 2 }), C({ hp: 20, rp: 0 })], 5).states;
    chk("T13", [a.hp, a.rp, b.hp, b.rp], [28, 1, 20, 0]);
  }
  c = breather(bm(C({ hp: 20, rp: 1, wounded: 1 }), 0));
  chk("T14", [c.hp, c.rp, c.wounded], [28, 0, 0]);
  {
    const r = treat([C({ sp: 0, hp: 0, rp: 0, unconscious: true })], 19);
    chk("T15", [r.checkMade, r.states[0].hp, r.states[0].sp], [false, 1, 0]);
  }

  // ── Breather, Bind Your Own Wounds, Catch Your Breath ────────────────────
  c = breather(C({ sp: 4, hp: 20, caughtBreath: true }));
  chk("B1", [c.sp, c.hp, c.caughtBreath, c.rp], [35, 20, false, 4]);
  c = breather(C({ sp: 0, hp: 0, wounded: 1, unconscious: true }));
  chk("B2", [c.sp, c.hp, !c.unconscious, c.wounded], [35, 1, true, 1]);
  {
    let t = R.bindYourOwnWounds(C({ hp: 20, rp: 2, wounded: 1 })).state;
    const w = t.wounded;
    t = breather(t);
    chk("B3", [t.hp, t.rp, w, t.wounded], [28, 1, 1, 0]);
  }
  chk("B4", breather(C({ wounded: 2 })).wounded, 0);
  c = breather(C({ sp: 4, hp: 20, rp: 0, wounded: 1 }));
  chk("B5", [c.sp, c.hp, c.wounded], [35, 20, 1]);
  {
    let t = R.startEncounter(C({ hp: 20, wounded: 1 }));
    t = heal(t, 5, R.KIND.spent);
    t = breather(R.endEncounter(t));
    chk("B6", [t.hp, t.wounded], [25, 1]);
  }
  c = breather(C({ sp: 0, hp: 0, dying: 1 }));
  chk("B7", [c.sp, c.hp], [0, 0]);
  c = breather(heal(C({ hp: 20, wounded: 1 }), 5, R.KIND.spent));
  chk("B8", [c.hp, c.wounded], [25, 0]);
  {
    let t = heal(C({ hp: 20, wounded: 1 }), 5, R.KIND.spent);
    t = R.endEncounter(R.startEncounter(t));
    t = breather(t);
    chk("B9", [t.hp, t.wounded], [25, 1]);
  }
  // An encounter interrupts the treatment: no procedure runs.
  c = C({ sp: 4, hp: 20, rp: 2, wounded: 1 });
  chk("B10", [c.sp, c.hp, c.rp, c.wounded], [4, 20, 2, 1]);
  {
    const first = R.catchYourBreath(C({ sp: 4 }));
    chk("C1", [first.state.sp, first.state.rp, first.state.caughtBreath], [21, 3, true]);
    chk("C2", R.catchYourBreath(first.state).ok, false);
  }
  c = R.catchYourBreath(C({ level: 3, maxSP: 15, sp: 2 })).state;
  chk("C3", [c.sp, c.rp], [9, 3]);
  c = R.catchYourBreath(C({ level: 1, maxSP: 7, sp: 0 })).state;
  chk("C4", [c.sp, c.rp], [5, 3]);
  c = R.catchYourBreath(C({ level: 1, maxSP: 7, sp: 4 })).state;
  chk("C5", [c.sp, c.rp], [7, 3]);
  c = R.catchYourBreath(C({ sp: 0, rp: 0 }), { free: true }).state;
  chk("C6", [c.sp, c.rp, c.caughtBreath], [17, 0, true]);
  c = R.catchYourBreath(C({ level: 8, maxSP: 32, sp: 10 })).state;
  chk("C7", [c.sp, c.rp], [26, 3]);
  c = R.catchYourBreath(C({ sp: 4 })).state; // Surge adds a Stride or Strike; the pools are the same.
  chk("C8", [c.sp, c.rp, c.caughtBreath], [21, 3, true]);

  // ── Lend Strength and Hold On ────────────────────────────────────────────
  {
    const r = R.lendStrength(C({ rp: 3 }), C({ rp: 0 }));
    chk("L1", [r.giver.rp, r.taker.rp, r.taker.strengthLent], [2, 1, true]);
    chk("L2", R.lendStrength(r.giver, r.taker).ok, false);
  }
  chk("L3", R.lendStrength(C({ rp: 3 }), C({ rp: 4 })).ok, false);
  chk("L4", R.lendStrength(C({ rp: 3, maxRP: 3, companion: true }), C({ rp: 0 })).ok, false);
  c = R.holdOn(C({ sp: 0, hp: 0, rp: 1, dying: 2 })).state;
  chk("L5", [c.dying, c.rp], [1, 0]);
  {
    const held = R.holdOn(C({ sp: 0, hp: 0, rp: 1, dying: 1, wounded: 1, unconscious: true })).state;
    chk("L6", [held.dying, held.hp, !held.unconscious, held.wounded, held.rp], [0, 0, false, 2, 0]);
    const woke = breather(held);
    chk("L7", [woke.hp, woke.sp, !woke.unconscious, woke.wounded], [1, 35, true, 2]);
  }

  // ── Nights ───────────────────────────────────────────────────────────────
  c = R.night(C({ sp: 3, hp: 12, rp: 1, caughtBreath: true, strengthLent: true }), "rest");
  chk("N1", [c.sp, c.hp, c.rp, c.caughtBreath, c.strengthLent], [35, 22, 4, false, false]);
  c = R.night(C({ sp: 3, hp: 12, rp: 1 }), "rough");
  chk("N2", [c.sp, c.hp, c.rp], [35, 22, 3]);
  c = R.night(C({ sp: 3, hp: 12, rp: 3 }), "rough");
  chk("N3", [c.sp, c.hp, c.rp], [35, 22, 4]);
  c = R.night(C({ sp: 3, hp: 12, rp: 1, wounded: 1 }), "haven");
  chk("N4", [c.sp, c.hp, c.rp, c.wounded], [35, 32, 4, 0]);
  c = R.night(C({ level: 8, maxSP: 32, maxHP: 30, sp: 0, hp: 5, rp: 0, con: 1 }), "rest");
  chk("N5", [c.sp, c.hp, c.rp], [32, 13, 4]);
  c = R.night(C({ sp: 3, hp: 12, rp: 1, wounded: 2 }), "rough");
  chk("N6", [c.sp, c.hp, c.rp, c.wounded], [35, 22, 3, 0]);

  // ── Encouraging Words, drained, companions ───────────────────────────────
  {
    const r = R.encouragingWords(5, C({ sp: 12 }));
    chk("E1", [r.state.sp, r.state.ewImmune], [27, true]);
  }
  chk("E2", R.encouragingWords(5, C({ sp: 30 })).state.sp, 35);
  chk("E3", [R.wordsAmount(1), R.wordsAmount(12)], [7, 29]);
  // The eidolon's ally state is its summoner's: the glue resolves it before asking.
  chk("E4", R.encouragingWords(5, C({ sp: 10, ewImmune: true })).ok, false);
  c = R.drained(C({ sp: 20 }), { baseSP: 35, baseHP: 33, value: 2 });
  chk("R1", [c.maxSP, c.maxHP, c.sp, c.hp], [25, 33, 10, 33]);
  c = R.drained(C({ level: 1, maxSP: 3, maxHP: 9 }), { baseSP: 3, baseHP: 9, value: 4 });
  chk("R2", [c.maxSP, c.maxHP, c.sp, c.hp], [0, 8, 0, 8]);
  c = R.drained(C({ sp: 5 }), { baseSP: 35, baseHP: 33, value: 1 });
  chk("R3", [c.maxSP, c.sp, c.hp], [30, 0, 33]);
  {
    let m = C({ level: 7, maxSP: 35, maxHP: 36, rp: 3, maxRP: 3, companion: true });
    m = dmg(m, 47).state;
    chk("M1", [m.sp, m.hp], [0, 24]);
    m = healDecided(m, 0);
    chk("M2", [m.hp, m.rp], [33, 2]);
    m = R.catchYourBreath(m).state;
    chk("M3", [m.sp, m.rp], [17, 1]);
  }

  // ── Healing that repeats ─────────────────────────────────────────────────
  {
    let f = C({ sp: 0, hp: 10, rp: 2 });
    const d = R.decide(f);
    const rp0 = d.state.rp;
    f = heal(d.state, 3, d.kind);
    chk("F1", [rp0, f.hp], [1, 18]);
    const cover = R.startCover({ kind: d.kind });
    f = heal(f, 3, R.installmentKind(cover));
    chk("F2", [f.hp, f.rp], [21, 1]);
    let g = C({ sp: 0, hp: 10, rp: 2 });
    const k = R.decide(g, { declines: true });
    g = heal(heal(k.state, 3, k.kind), 3, k.kind);
    chk("F3", [g.hp, g.rp], [10, 2]);
    f = heal({ ...f, hp: 32 }, 3, R.installmentKind(cover));
    chk("F4", [f.hp, f.sp], [33, 0]);
  }

  // ── Lingering Wounds ─────────────────────────────────────────────────────
  LW = true;
  {
    let w = breather(treat([C({ hp: 10, rp: 2, wounded: 2 })], 17).states[0]);
    chk("W1", [w.sp, w.hp, w.rp, w.wounded], [35, 27, 1, 1]);
    w = breather(treat([w], 0).states[0]);
    chk("W2", [w.hp, w.rp, w.wounded], [33, 0, 1]);
  }
  {
    let w = breather(C({ wounded: 2 }));
    chk("W3", w.wounded, 1);
    w = breather(w);
    chk("W4", w.wounded, 1);
  }
  c = breather(healDecided(C({ sp: 0, hp: 0, rp: 0, wounded: 2, unconscious: true }), 19));
  chk("W5", [c.sp, c.hp, c.rp, c.wounded], [35, 1, 0, 2]);
  {
    let w = R.bindYourOwnWounds(C({ hp: 5, rp: 3, wounded: 3 })).state;
    w = treat([w], 17).states[0];
    w = breather(w);
    chk("W6", [w.hp, w.rp, w.wounded], [30, 1, 2]);
  }
  {
    let w = R.startEncounter(C({ sp: 0, hp: 20, rp: 1, wounded: 2 }));
    w = breather(R.endEncounter(bm(w, 0)));
    chk("W7", [w.hp, w.rp, w.wounded], [28, 0, 2]);
  }
  c = R.night(C({ sp: 3, hp: 12, rp: 1, wounded: 2 }), "rough");
  chk("W8", [c.sp, c.hp, c.rp, c.wounded], [35, 22, 3, 0]);
  c = breather(heal(C({ hp: 20, wounded: 2 }), 40, R.KIND.spent));
  chk("W9", [c.hp, c.rp, c.wounded], [33, 4, 1]);
  LW = false;
  c = breather(treat([C({ hp: 10, rp: 2, wounded: 2 })], 17).states[0]);
  chk("W10", [c.hp, c.rp, c.wounded], [27, 1, 0]);
  LW = true;
  c = breather(bm(C({ hp: 20, rp: 1, wounded: 2 }), 0));
  chk("W11", [c.hp, c.rp, c.wounded], [28, 0, 1]);
  const on = breather(C({ hp: 20, rp: 0, wounded: 2 })).wounded;
  LW = false;
  c = breather(C({ hp: 20, rp: 0, wounded: 2 }));
  chk("W12", [on, c.wounded], [2, 2]);

  return rows;
}

/** The vector ids the rules file lists, in its order: 102 of them. */
export const VECTOR_IDS = [
  ...Array.from({ length: 9 }, (_, i) => `P${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `D${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `H${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `T${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `B${i + 1}`),
  ...Array.from({ length: 8 }, (_, i) => `C${i + 1}`),
  ...Array.from({ length: 7 }, (_, i) => `L${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `N${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `E${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `R${i + 1}`),
  ...Array.from({ length: 3 }, (_, i) => `M${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 12 }, (_, i) => `W${i + 1}`),
];
