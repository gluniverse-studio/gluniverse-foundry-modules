# Level Ground

Level Ground is the owner's flat-accuracy variant for PF2e Remaster (rules
version 0.13): a creature's level leaves every d20 roll and every DC, so a
level 5 party can still hit a level 12 creature and a level 12 party still
fears a crowd of level 5s. This feature runs the parts a table would otherwise
do by hand. It is PF2e only, off by default, and every part of it is a toggle
in the Control Center (`lvg.*`).

The rules text governs. `rules.mjs` is a line-for-line port of the reference
implementation (`reference/core.js`), and `tools/level-ground-check.mjs`
re-runs every one of the rules' own test vectors against it.

## What it does

**Proficiency** is PF2e's own *Proficiency without Level* variant, with its
five modifiers at −2 / +2 / +4 / +6 / +8 (the system's defaults). The feature
never flips those settings on its own: on ready the active GM is asked once per
load while they are off or wrong, and the window's **Setup** tab shows every
item with a button. Automatic bonus progression (property runes kept) is
recommended, not required. Setup also names pf2e-flatten and Flatfinder while
either is on: both are other flat-accuracy rule sets and subtract level a
second time beside Level Ground.

**Strip** (creatures and hazards). A GM's newly created NPC or hazard is
Stripped on the creating client (`autoStrip`): its level comes off AC, saves,
Perception, skills, Lores, attacks, spell DCs and attack modifiers, and every DC
in its abilities' text, and a skill, Lore, Perception or Will still above
12 + half its level is lowered to that line (the Specialists cap), conditional
values included. Carried consumables and equipment keep their own DCs, which
the item rule then moves by the item's own level. Every value Strip overwrites
is kept in the `lvg.strip` flag as `[path, value]` pairs, and **Unstrip**
(sheet marker, actor directory context menu) puts the printed stat block back
exactly. The flag travels with a duplicate or an export, which is what stops a
second Strip. A creature carrying pf2e-flatten's modifier is refused (it
already loses its level). Setup has **Strip every unstripped creature and
hazard** for an existing world. A Stripped sheet shows *Stripped, level N*; a
creature whose level changes afterwards prompts the GM to Unstrip and Strip
again. A token's synthetic actor writes to its delta.

**Convert** (the window's Convert tab). A printed DC (the Convert table), a
level (the level-based DC), a spell's rank (level 2 × rank − 1), a ritual's
printed DC (minus 2 × rank) or a task rank the GM picks for a new task, with
the difficulty and rarity adjustments and a printed minimum rank. The result
names its task rank and what Reach costs each rank below it, and **Post the
check** puts a PF2e inline check in chat carrying
`level-ground:task-rank:N` (and `level-ground:dc-level:L` for a level-based
DC). The tab also prints the rules' Common DCs and Fixed DCs tables.

**Reach**, in the roll. A skill or Perception check carrying a task rank takes
−2 for each rank the roller is below it (untrained counts as trained). Never on
Break Away.

**Outmatched** replaces the incapacitation trait. PF2e's degree step is removed
whenever the rule can be read. A save by a higher-level target gains +4, +6,
+8 or +10 for being 1, 2, 3 or 4+ levels above the effect (2 × rank for a
spell, the item's level, else the creature's level), and its critical failure
is a failure. Against a higher-level creature's DC, the DC rises by the same and
a critical success is a success. A Solo always gains the full +10, even when the
effect's level cannot be read.

**Treat Wounds and Administer First Aid** convert their printed DC when the
check is rolled (`convertActionDCs`); stopping bleeding is a fixed DC 14,
whatever the bleed's own DC, and stabilizing Converts PF2e's 5 + recovery DC. Treat Wounds is left to Breath and Blood
while that feature is on.

**Roles** (token HUD button, actor directory context menu). Mook: a quarter of
its Hit Points, rounded up. Solo: twice its Hit Points, with Tempo and Unbowed.
Summoned: half, rounded down (set automatically on an NPC created with the
summoned trait, `autoSummoned`). Elite or weak is applied first, then the role.
The printed maximum is kept in `lvg.role`, a marker effect shows the role on
the token, and a Solo gets Tempo and Unbowed as action items.

**Tempo** (`tempo`). After another creature's turn ends, the GM is whispered a
prompt for each Solo that still has it this round: one card per Solo per round,
updated in place, with a *Used* button. It resets at the start of the Solo's
own turn and is not offered while the Solo is unconscious, paralyzed, petrified
or stunned for a duration.

**Unbowed** (`unbowed`). Every condition or effect put on a Solo during combat
(not one it gave itself or an ally gave it, and never persistent damage,
afflictions, grabbed or restrained) is listed on a GM card with when it ends:
at the end of the third turn the Solo starts afterwards. The GM can *Exempt* an
entry (the Solo critically failed its save, or could end it with an action).
Entries end on schedule as the Solo's turns end.

**Threat** (the window's Threat tab, and the strip at the top of the combat
tracker for the GM, `threatStrip`). The worksheet reads the viewed combat, the
selected tokens or rows typed by hand: each creature's count, printed level,
role, elite or weak and area attack, and each hazard. The party is the combat's
PCs, else the Party actor's members, else levels typed by hand, plus allied NPCs
and hirelings. It prints the percentage, the band (Below Trivial to Beyond
Extreme), the XP, the site and total values, the party's value, the band before
Outclassed, every Outclassed and Uncertain reason, and who each creature is
Deadly to. **Post Sizing Up** posts what the PCs perceive (hidden creatures left
out) as the word and the Deadly names only. **Award XP** gives each PC the band's
XP, double below the party's level. The tracker strip hides PF2e's own encounter
line, which reads the standard XP table.

**Break Away** (the window's Break Away tab). The pursuer's level (the highest
in the combat by default), each fleeing PC's skill and the four circumstances,
and a +2 to +4 help bonus. **Post Break Away** posts one card with each PC's
check; as each roll lands the active GM files its total and degree on the card
(escapes, pursued, caught) after the dice settle. A blind or whispered roll is
not filed on the public card. The card says no XP is earned.

**Massive damage** (`massiveDamage`). When PF2e reports massive damage on a PC,
the defeat it marked is undone and the GM is whispered a card offering dying as
normal one value higher (2, or 3 on a critical, plus wounded).

**Battle forms** (`battleForms`). When a battle form effect is applied to a
character, its AC loses "+ your level" and each attack and skill modifier loses
2 × rank − 1 (each bracket by its own rank).

**Items that impose their own DC** (`itemDCs`). A consumable or piece of
equipment of level 1 or higher created on an actor loses its level from each
inline DC in its description. Scrolls, wands, staves, spellhearts and anything
carrying a spell are left alone (they use the user's DC).

**Level as a proficiency bonus** (`levelProf`). A feat or effect that adds the
character's level as a proficiency bonus (Untrained Improvisation, Eclectic
Skill and others) is rewritten as it arrives so it gives +0 in place of the
untrained −2. Setup lists the ones already on actors and fixes them.

**Assurance** (`assuranceWarnings`). The GM and the roller are warned when
Assurance is used to Break Away, against a higher-level creature's statistic, or
against a DC set by a higher level.

**Strip text** (the window's Strip text tab). Paste a stat block, set the level,
copy the Stripped text.

## Entry points

The scene control *Level Ground* (GM), the tracker strip, the token HUD and the
actor directory. The API, inert while the feature is off:

```js
const lg = game.modules.get("gluniverse-foundry-modules").api.features["level-ground"];
lg.openWindow("threat" | "breakAway" | "convert" | "stripText" | "setup");
await lg.strip(actor);  await lg.unstrip(actor);
await lg.setRole(actor, "none" | "mook" | "solo" | "summoned");
lg.rate(opposition, party);  lg.convertDC(25);  lg.levelDC(10);
```

## Files

```
scripts/features/level-ground/
  index.mjs       adapter: hooks in onInit/onReady, the wrappers, the API
  rules.mjs       PURE  the rules (port of reference/core.js): Convert, rank and
                        level DCs, Outmatched, Assurance, Break Away, threat and
                        Mook values, rate(), the Specialists cap, stripBlock,
                        stripActor, the Crit and Area tables
  logic.mjs       PURE  everything else the feature decides: option names, the
                        converter, inline checks, Outmatched readings, roles' HP,
                        Tempo and Unbowed bookkeeping, the worksheet reading,
                        Break Away rows and results, massive damage, the three
                        item rewrites, Strip and Unstrip as writes
  constants.mjs   PURE  ids, setting keys, flag keys, PWoL values, tabs
  reference.mjs   PURE  the Common DCs and Fixed DCs tables
  view.mjs        PURE  every surface as markup: the window's five tabs, the
                        tracker strip, the sheet marker, every chat card
  settings.mjs          the 13 toggles and the worksheet's client setting
  world.mjs             reading actors and combats into the pure shapes
  actors.mjs            Strip/Unstrip, roles, the three item rewrites, the sheet
                        marker, the context menu, the token HUD button
  checks.mjs            the Check.roll handler (Outmatched, Reach, Break Away
                        help, action DCs), massive damage, Assurance
  chat.mjs              posting and updating cards, their buttons, Break Away
                        results, Assurance warnings
  combat.mjs            Tempo, Unbowed, the tracker strip
  setup.mjs             the Setup tab's model, its fixes, the ready prompt
  app.mjs               the window (ApplicationV2 built in a memoised factory)
styles/level-ground.css       the skin (Ink and Signal aliases, --gllvg-*)
lang/level-ground.en.json     GLLVG.*
tools/level-ground-check.mjs  the consistency check
tools/level-ground-preview.mjs
tools/fixtures/level-ground/  the rules' vectors and data block, pf2e excerpts
```

Flags (all under the suite id): `lvg.strip`, `lvg.role`, `lvg.roleMarker`,
`lvg.area` (a creature's area attack, for the worksheet), `lvg.levelProf`,
`lvg.battleForm`, `lvg.itemDC` (each rewrite keeps what it replaced and stops a
second pass), `lvg.tempo` (combatant), `lvg.unbowed` (actor), `lvg.card`
(message: the card's kind and model, from which it is redrawn).

## The PF2e seams

- **`game.pf2e.Check.roll(check, context)`**, wrapped through
  `core/wrapper.mjs` inside a try/catch, every step guarded so a PF2e change
  degrades the rule, never the roll. Modifiers go on the CheckModifier with
  `push` (the context's own `modifiers` are metadata). Outmatched filters
  PF2e's `PF2E.TraitIncapacitation` adjustment out of `context.dosAdjustments`
  and pushes its own in the shape `DegreeOfSuccess` reads (a degree name as the
  amount); against a DC it raises `context.dc.value`.
- **Roll options.** PF2e's inline check parser splits each parameter at its
  first colon and `options:` on commas, so `level-ground:task-rank:3` survives
  into the roll. PF2e's own `proficiency:<rank>` option gives the roller's
  rank; `action:treat-wounds` and `action:administer-first-aid` mark the two
  actions.
- **`CharacterPF2e#applyDamage`**, wrapped on
  `CONFIG.PF2E.Actor.documentClasses.character.prototype`. PF2e writes its HP
  update with `{ damageTaken }` in the options (caught in `preUpdateActor`) and
  its massive test is `damageTaken ≥ 2 × (HP max + Stamina max)` at 0 HP; the
  wrapper then calls `combatant.toggleDefeated({ to: false })`.
- **Hit Points under a role.** An NPC has no DataModel, so `hp.max` is a source
  field, and `_preUpdate` clamps an incoming `hp.value` against the maximum the
  actor has at that moment: the maximum and the value are two updates.
- **Levels.** Every level the rules read is the printed one,
  `_source.system.details.level.value`, before elite or weak. Nothing writes a
  level (pf2e-flatten would subtract it again).
- **Battle forms** are `BattleForm` rule elements: `overrides` plus `brackets`
  whose `value` holds `armorClass.modifier` ("N + @actor.level"), `strikes.*.modifier`
  and `skills.*.modifier`.
- **Level as proficiency** is a `FlatModifier` of type `proficiency` whose value
  reads `@actor.level`.
- **Assurance** is a substitution with slug `assurance`, read from the message's
  `flags.pf2e.context`.
- **Boss extra turns** (`pf2e-variant-rules`) are real combatants with the boss's
  own actor; the worksheet refuses them (`isExtraTurn`) and counts each
  creature once.

## What stays manual

- Simple DCs typed into PF2e's own check prompt, and DCs written in plain text a
  card does not mark up: Convert them on the Convert tab.
- Trick Magic Item's DC.
- The Recall Knowledge DC of an elite or weak creature (PF2e reads its adjusted
  level).
- Whether an Unbowed entry is exempt (a critically failed save, or something the
  Solo could end with an action): the GM's *Exempt* button.
- Whether the Solo used Tempo: the GM's *Used* button.
- The area attack mark on a creature for the worksheet, and whether the party
  has area damage.
- Which dying value applies after massive damage (the card offers both).
- Anything about Treat Wounds under Breath and Blood (that feature's).

## Where the implementation reference was wrong

- **Level as a proficiency bonus is rewritten to +2, not 0.** The reference
  says to rewrite the rule's value to 0. PF2e's `applyStackingRules` applies a
  typed bonus and a typed penalty of the same type together, and Proficiency
  without Level's untrained −2 is a *proficiency* penalty: a proficiency bonus
  of 0 beside it still totals −2, which leaves the rule unchanged in effect.
  The value that totals +0 is the size of the untrained penalty (2, read from
  `proficiencyUntrainedModifier`); trained and above already give +2 or more of
  the same type, so it never raises a trained skill. The check simulates the
  stacking for every fixture.
- **Battle forms: the data and the table disagree in three places.** pf2e 8.7.0's
  *Pest Form* effect gives Acrobatics and Stealth +10 and Athletics −4; the table
  prints "none". *Angel Form (Monadic Deva)* gives Athletics +9 at rank 7; the
  table prints +25 (the data is wrong, and Level Ground then gives −4). *Element
  Embodied (Air)* gives Acrobatics +23; the table prints +36 → +17. The feature
  rewrites what the data holds; the check lists the first two as known gaps and
  fails if they change.
- **Battle forms granted by a feat or at a level above 10.** The table is per
  spell rank; a feat's form (Rampaging Form, Worm Form, A Little Bird Told Me)
  and *Monstrosity Form (Kaiju)*, a "spell effect" pf2e stores at level 20, have
  no rank. The feature reads a spell effect's level as its rank up to 10 and
  anything else as the rank a caster first has at that level (⌈level ÷ 2⌉).
  Kaiju's values are monstrosity form's rank 9 values, so it comes out two lower
  (+12 and Athletics +14 where rank 9 gives +14 and +16). The owner should rule
  on these.
- **Elephant Form's un-bracketed values** are written at the effect's level 4
  (no rank 4 elephant form exists); they are overridden by the rank 5 and rank 7
  brackets whenever the spell can be cast, so they never apply.
- **An untrained character keeps Proficiency without Level's −2 on a battle
  form's fixed skill.** PF2e's `useFixedStatisticModifier` keeps the "shared"
  modifiers when a form replaces a skill, and the untrained penalty is one of
  them. Found live: an untrained sorcerer in *animal form* rolled Athletics +7
  where the table's +9 was expected; an expert fighter in the same form rolled
  +9. This is pf2e's behaviour, not the feature's, and is left as it is.
- **The rank a battle form is written for comes from the effect's level when it
  is created.** pf2e normally sets a spell effect's level to the rank it was
  cast at; an effect dragged onto a sheet by hand keeps the compendium level.

## Checks

```bash
node tools/level-ground-check.mjs
node tools/level-ground-preview.mjs && node tools/preview-server.mjs 8961
```

then `/.preview/level-ground.html` (`?view=window|tracker|sheet|chat`,
`&tab=threat|breakAway|convert|stripText|setup`).
