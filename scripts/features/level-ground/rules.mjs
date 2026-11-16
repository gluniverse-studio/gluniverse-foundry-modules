/**
 * Level Ground — the rules, as pure functions (rules version 0.13).
 *
 * This file is the reference implementation `final/reference/core.js` from the
 * rules repository, ported to an ES module and otherwise unchanged: every
 * function below keeps the reference's behaviour line for line, so the rules
 * document's test vectors (C, R, O, B, V, W, H, T1–T39, S1–S15, A1–A5) hold
 * here exactly as they hold there. `tools/level-ground-check.mjs` re-runs all
 * of them against this module. Do not "improve" a function here without the
 * rules changing first: the calculator, the paper worksheet and this module
 * have to read the same band.
 *
 * Pure: no `game`, `foundry`, `ui`, `Hooks` or `canvas`. Everything Level
 * Ground adds on top of the reference (Reach, Outmatched in the roll, roles,
 * battle forms, Sizing Up) lives in `logic.mjs`.
 */

export const RULES_VERSION = "0.13";

export const TV = {"-1": 4, "0": 8, "1": 10, "2": 16, "3": 23, "4": 32, "5": 43, "6": 56, "7": 72, "8": 91, "9": 112, "10": 138, "11": 168, "12": 202, "13": 240, "14": 282, "15": 330, "16": 380, "17": 430, "18": 495, "19": 575, "20": 660, "21": 750, "22": 860, "23": 990, "24": 1170};
export const MOOK = {"-1": 3, "0": 5, "1": 5, "2": 8, "3": 11, "4": 14, "5": 18, "6": 23, "7": 28, "8": 35, "9": 42, "10": 51, "11": 62, "12": 73, "13": 85, "14": 99, "15": 114, "16": 128, "17": 142, "18": 164, "19": 192, "20": 220, "21": 248, "22": 286, "23": 325, "24": 385};

// The standard level-based DCs with level removed, except printed 20: it reads 16, so a rank's Simple DC is 12 + its proficiency bonus (14 / 16 / 18 / 20).
export function convertDC(d) { return d < 14 ? d : d === 20 ? 16 : d <= 40 ? 14 + Math.floor((d - 13) / 4) : 20 + Math.floor((d - 40) / 2); }
export function rankDC(rank) { return rank <= 0 ? 10 : 12 + 2 * rank; }   // 0 untrained, 1 trained ... 4 legendary
export function taskRank(d) { return d < 14 ? 'untrained' : d < 20 ? 'trained' : d < 29 ? 'expert' : d < 40 ? 'master' : 'legendary'; }
export function levelDC(level) { return level < 0 ? 13 : level <= 20 ? 14 + Math.floor(level / 3) : level; }
export function levelRank(level) { return level < 0 ? 'untrained' : level < 5 ? 'trained' : level < 12 ? 'expert' : level < 20 ? 'master' : 'legendary'; }
// The calculator's DC box: with a level, the DC is the level-based DC alone (level 5 is DC 15) and the printed DC is not used.
export function dcFor(printed, level) { return level === null || level === undefined || !Number.isFinite(level) ? { dc: convertDC(printed), rank: taskRank(printed) } : { dc: levelDC(level), rank: levelRank(level) }; }
export function outmatched(gap) { return gap <= 0 ? 0 : Math.min(10, 2 + 2 * gap); }
export function assurance(rank) { return 10 + (rank <= 0 ? -2 : 2 * rank); }   // as printed with level read as 0: the DC of the rank below yours
// The Break Away DC keeps rising by 1 for every 3 levels above level 20 (it does not switch to "equal to the level" as levelDC does).
export function breakAwayDC(level, o) { o = o || {}; return (level < 0 ? 13 : 14 + Math.floor(level / 3)) + (o.flies ? 5 : o.faster ? 2 : 0) - (o.ground ? 2 : 0) + (o.carrying ? 2 : 0); }
// Above level 24 each level adds 18%. Below level -1 each level halves the value.
function ext(table, level) { return level > 24 ? table[24] * Math.pow(1.18, level - 24) : level < -1 ? table[-1] * Math.pow(0.5, -1 - level) : table[level]; }
export function tv(level) { return ext(TV, level); }
export function mookValue(level) { return ext(MOOK, level); }
export function creatureValue(c) {
  let v = c.role === 'mook' ? mookValue(c.level) : tv(c.level);
  if (c.role === 'solo') v *= 2;
  // Elite and Weak change a low-level creature more: x 2 and x 1/2 up to level 4, x 1 1/2 and x 2/3 from level 5
  if (c.adjust === 'elite') v *= c.level <= 4 ? 2 : 1.5;
  if (c.adjust === 'weak') v *= c.level <= 4 ? 0.5 : 2 / 3;
  return v;
}
// The Threat worksheet, rules version 0.13. sim/worksheet.py is the same arithmetic (tool/crosscheck.py compares them).
// opposition: [{count, level, role: 'standard'|'mook'|'solo', adjust: ''|'elite'|'weak', area: bool, hazard: ''|'simple'|'complex'}]. level is the printed level.
// party: {levels: [..], allies: [{level, mook}], area: bool, casterLeads: bool}. casterLeads: the highest-level PC is a spellcaster (used only by Uncertain readings).
export const WORDS = ['no threat', 'weaker', 'weaker', 'a real fight', 'dangerous', 'a coin toss', 'overwhelming'];   // Sizing Up: one word per band, Below Trivial to Beyond Extreme
export function rate(opposition, party) {
  const allies = party.allies || [];
  const partyLevel = Math.max(...party.levels);   // the level of the highest-level PC; an ally never sets it
  const levels = party.levels, n = levels.length + allies.filter(a => !a.mook).length;   // steps 3 and 4 count an ally who is not a Mook as a PC
  let site = 0, other = 0, bod = 0, bodies = 0, aboveN = 0, soloN = 0, soloFar = false, mooks = 0;
  for (const c of opposition) {
    const v = creatureValue(c) * (c.area ? 1.25 : 1) * (c.hazard === 'simple' ? 0.2 : 1) * c.count;   // step 1: the site
    site += v;
    if (c.hazard) { other += v; continue; }   // a hazard adds its value and counts for nothing else
    const solo = c.role === 'solo';
    if (c.role === 'mook') mooks += c.count;
    if (c.level > partyLevel) aboveN += c.count;
    if (solo) { soloN += c.count; if (c.level >= partyLevel + 2) soloFar = true; }
    if (c.role === 'mook' || (c.level < partyLevel && !solo)) { bod += v; bodies += c.count; } else other += v;   // bodies: Mooks, and creatures below the party's level; never a Solo
  }
  // step 3, outnumbered: each tick adds a quarter to the bodies' total
  const per = bodies / n;
  const ticks = (per >= 2 ? 1 : 0) + (!party.area && per > 1 ? 1 : 0) + (partyLevel >= 15 && per >= 2 ? 1 : 0);
  const total = other + bod * (1 + 0.25 * ticks);
  // step 2: a few PCs 3 or more levels below add half their row; when they are half the PCs or more, the higher PCs add two thirds instead. These two lines count PCs only.
  const farN = levels.filter(l => l <= partyLevel - 3).length, few = farN < levels.length / 2;
  const share = l => l <= partyLevel - 3 ? (few ? 0.5 : 1) : (few ? 1 : 2 / 3);
  // one column of the party table: each row is rounded down, as printed, so the calculator reads what the paper table reads. An ally adds its full row, from its Mook value if it is a Mook.
  const column = (num, den) => levels.reduce((s, l) => s + share(l) * Math.floor(tv(l) * num / den), 0) + allies.reduce((s, a) => s + Math.floor((a.mook ? mookValue(a.level) : tv(a.level)) * num / den), 0);
  const low = column(3, 8), extreme = column(1, 1), ratio = total / extreme;
  const columns = { trivial: low / 2, low, moderate: column(1, 2), severe: column(3, 4), extreme, beyond: extreme * 1.25 };
  const bands = [['Below Trivial', 0], ['Trivial', 40], ['Low', 60], ['Moderate', 80], ['Severe', 120], ['Extreme', 160], ['Beyond Extreme', 160]];
  let bi = Object.values(columns).filter(edge => total >= edge).length; const plain = bands[bi][0];   // step 4: the highest column the total reaches
  // outclassed: one band higher, once, however many signs are true; never from Below Trivial
  const signs = [];
  if (aboveN >= 2) signs.push('two or more creatures above the party\'s level');
  else if (aboveN >= 1 && partyLevel <= 3) signs.push('party level 1 to 3 against a higher-level creature');
  if (soloFar) signs.push('a Solo 2 or more levels above the party');
  if (soloN >= 2) signs.push('more than one Solo');
  if (n === 2) signs.push('a party of two');
  const bumped = signs.length > 0 && bi > 0 && bi < bands.length - 1; if (bumped) bi++;
  // uncertain readings, after Outclassed: Severe is read as Extreme for a mixed-level party (one that used either mixed-level line of step 2) led by a spellcaster, and for five or more Mooks per PC
  const doubts = [];
  if (farN > 0 && party.casterLeads) doubts.push('a mixed-level party led by a spellcaster');
  if (mooks / n >= 5) doubts.push('five or more Mooks per PC');
  const uncertain = doubts.length > 0 && bi === 4; if (uncertain) bi++;
  const band = bands[bi];
  const lowest = Math.min(...party.levels);
  return { site: Math.round(site), total: Math.round(total), bodiesPerPC: per, ticks, partyTotal: Math.round(extreme), columns, ratio, word: WORDS[bi], plain, label: band[0], xp: band[1], partyLevel, lowest, bumped, signs, uncertain, doubts, note: n === 1 ? 'A lone PC is outside what the worksheet reads.' : n >= 7 ? 'Seven or more PCs and allies is untested.' : '' };
}
// Specialists: after Strip, a skill, Lore, Perception or Will above this line is lowered to it (the extreme skill column never is above it).
export function specialistCap(level) { return 12 + Math.floor(Math.max(level, 0) / 2); }
// The statistic's own value and any conditional value in the parentheses that follow it: "Diplomacy +22 (+24 to Make an Impression)"
const SPECIALIST = /\b((?:Acrobatics|Arcana|Athletics|Crafting|Deception|Diplomacy|Intimidation|Medicine|Nature|Occultism|Performance|Religion|Society|Stealth|Survival|Thievery|Lore|Perception|Will) )\+(\d+)(?![\dd])( ?\([^()]*\))?/g;
const TYPED = '(?!\\s*(?:status|circumstance|item|untyped)|\\d|d\\d)';
// Strip a pasted stat block: subtract the level from AC, DCs and modifiers, leaving damage, attributes and typed bonuses alone.
// The Items line is left as it is (a carried item follows the item rule by its own level), and so is a signed number after "as" ("functions as +1 striking staff").
export function stripBlock(text, level) {
  level = Math.max(level, 0); const cap = specialistCap(level);
  const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n);
  const kept = [];   // the Items line, up to the next semicolon, line break or AC entry
  text = text.replace(/\bItems:? [^;\n]*?(?=;|\n|$| AC \d)/g, m => '\u0002' + (kept.push(m) - 1) + '\u0002');
  const finish = t => t.replace(/\u0001(-?\d+)\u0001/g, (m, n) => signed(parseInt(n))).replace(/\u0002(\d+)\u0002/g, (m, n) => kept[n]);
  const limit = n => parseInt(n) - level > cap ? '\u0001' + cap + '\u0001' : '+' + n;   // a value over the line is set to it now; the rest are stripped below
  text = text.replace(SPECIALIST, (m, name, n, cond) => name + limit(n) + (cond ? cond.replace(new RegExp('\\+(\\d+)' + TYPED, 'g'), (mm, v) => limit(v)) : ''));
  if (level <= 0) return finish(text);
  let t = text.replace(/\b(AC|DC) (\d+)(?!\d| flat)/g, (m, k, n, off, s) => /flat check $/.test(s.slice(Math.max(0, off - 11), off)) ? m : k + ' ' + (parseInt(n) - level));
  t = t.replace(/\((\d+) (vs\.?|against|with|while|when) /g, (m, n, k) => '(' + (parseInt(n) - level) + ' ' + k + ' ');   // "DC 34 (36 vs. prone)"
  t = t.replace(/(\b(?:Str|Dex|Con|Int|Wis|Cha) )?(?<![\dd])([+\-–−])(\d+)(?!\s*(?:status|circumstance|item|untyped)|\d|d\d|-(?:foot|feet))/g, (m, attr, sign, n, off, s) => {
    if (attr) return m;
    if (/(^|\W)as $/.test(s.slice(Math.max(0, off - 4), off))) return m;   // "functions as +1 striking staff"
    if (/[\[\/]$/.test(s.slice(0, off)) && /^[^\[]*\]/.test(s.slice(off)) ) return signed((sign === '+' ? 1 : -1) * parseInt(n) - level);   // "[+13/+8]" and "[+3/-2]": every value inside the brackets is an attack modifier
    if (sign !== '+' && !/[A-Za-z] $/.test(s.slice(Math.max(0, off - 2), off))) return m;   // a minus only counts as a modifier after a word: "Will -1"
    if (sign === '+' && /^ [a-z]/.test(s.slice(off + m.length, off + m.length + 2)) && /(^|[,;:] )$/.test(s.slice(Math.max(0, off - 2), off))) return m;   // an item named in a list: ", +1 full plate"
    if (sign !== '+') n = -parseInt(n);
    const before = s.slice(Math.max(0, off - 8), off);
    if (/\dd\d+\s*$/.test(before) || /\d\s*$/.test(before)) return m;   // part of a damage expression such as 3d12+11
    if (/^\s*(?:bonus|penalty|temporary|feet|foot|to damage|to all damage)/.test(s.slice(off + m.length, off + m.length + 16))) return m;   // prose, not a statistic
    return signed(parseInt(n) - level);
  });
  return finish(t);
}
// Strip structured data: an NPC or hazard in the pf2e system's source form, {type, system, items}. Returns a changed copy; the input is not touched.
// level is the printed level (system.details.level.value in source data, system.details.level.base once the system has prepared an elite or weak actor).
// A stored 0 (or null) is a statistic the block does not have and is left alone. DCs in descriptions are changed only in the block's own actions and attacks
// (items of type action and melee): a carried item follows the item rule by its own level, and a spell's own text is not the creature's.
export function stripActor(actor, level) {
  const a = JSON.parse(JSON.stringify(actor)), s = a.system, npc = a.type === 'npc';
  const L = Math.max(level === undefined ? s.details.level.value : level, 0), cap = specialistCap(L);
  const plain = v => v - L, capped = v => Math.min(v - L, cap), sgn = r => (r < 0 ? '−' : '+') + Math.abs(r), num = (sg, v) => (sg === '+' ? 1 : -1) * v;
  const MOD = new RegExp('(?<!\\bas )([+\\-−])(\\d+)' + TYPED, 'g');   // not "functions as +1 striking staff"
  const mods = (t, f) => (t || '').replace(MOD, (m, sg, v) => sgn(f(num(sg, v))));   // "(+18 to Sense Motive)"
  const allSaves = t => { const will = []; return mods((t || '').replace(/\bWill ([+\-−])(\d+)/g, (m, sg, v) => 'Will \u0001' + (will.push(capped(num(sg, v))) - 1) + '\u0001'), plain).replace(/\u0001(\d+)\u0001/g, (m, k) => sgn(will[k])); };   // a Will value written here takes the Specialists limit
  const inline = t => (t || '').replace(/(@Check\[(?!(?:type:)?flat\b)[^\]]*?\bdc:)(\d+)/g, (m, k, v) => k + (v - L)).replace(/(\[\[\/act [^\]]*?\bdc=)(\d+)/g, (m, k, v) => k + (v - L));
  const prose = t => inline(t).replace(/\bDC (\d+)(?! flat)/g, (m, v, off, str) => /flat check $/.test(str.slice(Math.max(0, off - 11), off)) ? m : 'DC ' + (v - L));   // "DC 26 basic Reflex save" written as text
  const at = s.attributes;
  if (npc || at.ac.value) at.ac.value -= L;
  if (at.ac.details) at.ac.details = at.ac.details.replace(/\b(\d+)(?= (?:with|when|while|against|vs\.?|in|from) )/g, (m, v) => v - L);   // "(22 with shield raised)", "26 in animal form"
  for (const k of ['fortitude', 'reflex', 'will']) {
    const sv = s.saves[k], f = npc && k === 'will' ? capped : plain;
    if (npc || sv.value) sv.value = f(sv.value);
    if (sv.saveDetail) sv.saveDetail = mods(sv.saveDetail, f);
  }
  if (npc) {
    if (at.allSaves && at.allSaves.value) at.allSaves.value = allSaves(at.allSaves.value);
    s.perception.mod = capped(s.perception.mod); if (s.perception.details) s.perception.details = mods(s.perception.details, capped);
    for (const sk of Object.values(s.skills || {})) { sk.base = capped(sk.base); for (const sp of sk.special || []) sp.base = capped(sp.base); }
  } else {
    if (at.stealth.value) at.stealth.value -= L;
    at.stealth.details = inline(at.stealth.details);   // a second check written as @Check[...|dc:N]
    for (const k of ['disable', 'routine']) if (s.details[k]) s.details[k] = prose(s.details[k]).replace(/\b(attack modifier )\+(\d+)/g, (m, k2, v) => k2 + sgn(v - L));   // save DCs in a routine, and "spell attack modifier +14"
  }
  for (const it of a.items || []) {
    const y = it.system;
    if (it.type === 'lore') y.mod.value = capped(y.mod.value);
    if (it.type === 'melee') y.bonus.value -= L;
    if (it.type === 'spellcastingEntry') { if (y.spelldc.value) y.spelldc.value -= L; if (y.spelldc.dc) y.spelldc.dc -= L; }
    if ((it.type === 'action' || it.type === 'melee') && y.description && y.description.value) y.description.value = prose(y.description.value);
  }
  return a;
}

/** Sizing Up: the average critical hit and area attack of a creature of each level, -1 to 24 (the rules' data block). */
export const CRIT = {"-1": 7, "0": 11, "1": 13, "2": 19, "3": 23, "4": 28, "5": 32, "6": 36, "7": 40, "8": 44, "9": 48, "10": 52, "11": 56, "12": 61, "13": 65, "14": 69, "15": 73, "16": 75, "17": 77, "18": 79, "19": 84, "20": 88, "21": 92, "22": 96, "23": 100, "24": 104};
export const AREA = {"-1": 4, "0": 6, "1": 7, "2": 10, "3": 14, "4": 18, "5": 21, "6": 24, "7": 28, "8": 32, "9": 35, "10": 38, "11": 42, "12": 46, "13": 49, "14": 52, "15": 56, "16": 60, "17": 63, "18": 66, "19": 70, "20": 74, "21": 77, "22": 80, "23": 84, "24": 88};
