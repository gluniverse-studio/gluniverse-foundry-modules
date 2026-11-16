/**
 * Level Ground — the reference tables the converter shows. Pure data.
 *
 * Transcribed from the rules (0.13), "Common DCs" and "Fixed DCs". Names are
 * the book's and are not localized (they are the printed rules elements'
 * names). `tools/level-ground-check.mjs` holds every row to `convertDC` and
 * `taskRank`, so a transcription slip is a failure rather than a wrong number
 * on the GM's screen.
 */

/** Common DCs: a label key and the printed DCs they Convert from. */
export const COMMON_DCS = Object.freeze([
  { key: "aid", printed: [15] },
  { key: "treatWounds", printed: [15, 20, 30, 40] },
  { key: "highJump", printed: [30] },
  { key: "longJump", printed: [15, 20, 25, 30] },
  { key: "pickLock", printed: [15, 20, 25, 30, 40] },
]);

/** The rules' printed values for the Common DCs, to hold `convertDC` to them. */
export const COMMON_EXPECTED = Object.freeze({
  aid: [14],
  treatWounds: [14, 16, 18, 20],
  highJump: [18],
  longJump: [14, 16, 17, 18],
  pickLock: [14, 16, 17, 18, 20],
});

/** Fixed DCs: `ranks` lists the distinct task ranks of the printed DCs, as the table prints them. */
export const FIXED_DCS = Object.freeze([
  {"name":"alarm","spell":true,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"aqueous orb","spell":true,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"Armor Assist","spell":false,"printed":[15,20,25],"dc":[14,16,17],"ranks":["trained","expert"]},
  {"name":"Barricade Snare","spell":false,"printed":[12],"dc":[12],"ranks":["untrained"]},
  {"name":"Biographical Eye","spell":false,"printed":[30],"dc":[18],"ranks":["master"]},
  {"name":"Blaze of Revelation","spell":false,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"Coral Symbiotes","spell":false,"printed":[5,10,15],"dc":[5,10,14],"ranks":["untrained","trained"]},
  {"name":"cordyceps command","spell":true,"printed":[28],"dc":[17],"ranks":["expert"]},
  {"name":"Create Forgery","spell":false,"printed":[20],"dc":[16],"ranks":["expert"]},
  {"name":"Dance of Intercession","spell":false,"printed":[35],"dc":[19],"ranks":["master"]},
  {"name":"Dandy Dedication","spell":false,"printed":[15,20,30,40],"dc":[14,16,18,20],"ranks":["trained","expert","master","legendary"]},
  {"name":"Desperate Resuscitation","spell":false,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"earthquake","spell":true,"printed":[9,14,15],"dc":[9,14,14],"ranks":["untrained","trained"]},
  {"name":"Embed Aeon Stone","spell":false,"printed":[30],"dc":[18],"ranks":["master"]},
  {"name":"Encouraging Words","spell":false,"printed":[20,30,40],"dc":[16,18,20],"ranks":["expert","master","legendary"]},
  {"name":"Final Union","spell":false,"printed":[45],"dc":[22],"ranks":["legendary"]},
  {"name":"Fire Lung","spell":false,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"Fire Savvy","spell":false,"printed":[5,10,15],"dc":[5,10,14],"ranks":["untrained","trained"]},
  {"name":"Folksy Patter","spell":false,"printed":[20],"dc":[16],"ranks":["expert"]},
  {"name":"forest of gates","spell":true,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"Ghostly Grasp (Ghost)","spell":false,"printed":[20],"dc":[16],"ranks":["expert"]},
  {"name":"hag's fruit","spell":true,"printed":[30],"dc":[18],"ranks":["master"]},
  {"name":"Influence Rumor","spell":false,"printed":[15,20,30,40],"dc":[14,16,18,20],"ranks":["trained","expert","master","legendary"]},
  {"name":"Lightning Rod","spell":false,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"maze of locked doors","spell":true,"printed":[25,30],"dc":[17,18],"ranks":["expert","master"]},
  {"name":"Medic Dedication","spell":false,"printed":[20,30,40],"dc":[16,18,20],"ranks":["expert","master","legendary"]},
  {"name":"pest swarm","spell":true,"printed":[24],"dc":[16],"ranks":["expert"]},
  {"name":"pillar of water","spell":true,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"pillars of sand","spell":true,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"Pinning Fire","spell":false,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"Pirate Dedication","spell":false,"printed":[20],"dc":[16],"ranks":["expert"]},
  {"name":"Predict Weather","spell":false,"printed":[15,20],"dc":[14,16],"ranks":["trained","expert"]},
  {"name":"Preternatural Polish","spell":false,"printed":[35],"dc":[19],"ranks":["master"]},
  {"name":"Propelled Leap","spell":false,"printed":[30],"dc":[18],"ranks":["master"]},
  {"name":"Rally","spell":false,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"Read the Stars","spell":false,"printed":[28,32],"dc":[17,18],"ranks":["expert","master"]},
  {"name":"Resuscitate","spell":false,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"Rip Guts! Rip Guts!","spell":false,"printed":[25],"dc":[17],"ranks":["expert"]},
  {"name":"Rise, My Creature!","spell":false,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"Rouse the Forest's Fury","spell":false,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"Sacred Defense","spell":false,"printed":[30,40],"dc":[18,20],"ranks":["master","legendary"]},
  {"name":"Scorched on the Crackling Mountain","spell":false,"printed":[5,10,15],"dc":[5,10,14],"ranks":["untrained","trained"]},
  {"name":"sliding blocks","spell":true,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"Speedrun Strats","spell":false,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"steel fortifications","spell":true,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"summon elemental herald","spell":true,"printed":[15],"dc":[14],"ranks":["trained"]},
  {"name":"Traces of the Divine","spell":false,"printed":[5],"dc":[5],"ranks":["untrained"]},
  {"name":"transmute rock and mud","spell":true,"printed":[10],"dc":[10],"ranks":["untrained"]},
  {"name":"Unusual Treatment","spell":false,"printed":[20,30],"dc":[16,18],"ranks":["expert","master"]},
  {"name":"Unwind Death","spell":false,"printed":[40],"dc":[20],"ranks":["legendary"]},
  {"name":"upheaval","spell":true,"printed":[9],"dc":[9],"ranks":["untrained"]},
  {"name":"whirling scarves","spell":true,"printed":[5,6],"dc":[5,6],"ranks":["untrained"]},
  {"name":"wind jump","spell":true,"printed":[30],"dc":[18],"ranks":["master"]}
]);
