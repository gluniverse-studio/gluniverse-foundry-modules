# PF2e HUD (`pf2e-rail`) — the wiring

Status: **built and run in a live v14 / PF2e 8.7 session** (a scratch data
folder, GM and one player). The design — view, drive, skin, fixtures, preview —
is settled and recorded in `docs/adr/0013-pf2e-rail-skin.md`; this file is the
seam between that pure rail and Foundry.

| | |
|---|---|
| Feature | `pf2e-rail`, prefix `ph.`, i18n `GLRAIL.*`, PF2e only, off by default |
| Check | `node tools/pf2e-rail-check.mjs` (zero problems) |
| Preview | `node tools/pf2e-rail-preview.mjs && node tools/preview-server.mjs` |

## Who gets which rail

`subject.mjs` decides, from what the screen has in hand:

- a **player character** (controlled, else the user's own character) → the
  full rail; a **familiar or a player-owned NPC** → the slim rail;
- on the GM's screen, a controlled **NPC or hazard** → the creature or hazard
  panel, plus a hand of every non-PC token on the scene, hostile first; nothing
  controlled → the hand alone (the empty plate is drawn only when the scene has
  no creatures at all). A GM controlling a PC gets that PC's player rail.
- `ph.gmRail` off hides the GM rail on that screen.

It never mounts on the **stream login** (`isConfiguredStreamUser`, read through
the stream feature's setting, which exists whether or not that feature is on),
and never beside **pf2e-hud** — the GM is warned once a session.

## Readers (`read.mjs`, pure)

An actor in, the fixture shape out (`tools/pf2e-rail-fixtures.mjs` is the
contract; the check holds every reader to it path for path).

- **Strikes** are `actor.system.actions` (id = index). Each variant's modifier
  is read off PF2e's own label, damage formulas come from
  `damage({ getFormula: true })` (the host caches them per actor until the actor
  or an item on it changes).
- **Blasts** are `new game.pf2e.ElementalBlast(actor).configs`. An actor with no
  `flags.pf2e.kineticist.elementalBlast` gets PF2e's fallback config, whose MAP
  labels are empty: the steps are then the blast statistic's own modifier at
  0/−5/−10.
- **Spells** come from `entry.getSheetData()` for each regular entry, addressed
  `<entry>.<spell>.<rank>.<slot>`; an empty prepared slot is a socket.
- **Items** are physical items with the `consumable` trait and a quantity —
  PF2e files Chalk and Rations as consumables too; the trait is what separates
  a potion from them. They are held as a hand of the same compact card as the
  spells (80 × 112, the Daggerheart card's 1 : 1.4), what is left on the
  pennant where a spell carries its rank, laid nearly flat.
- **Down and observing** are states of the whole rail. A dying or dead
  character's rail carries `data-down`: the strikes and deck dim behind the
  dying plate, and the gems, checks and drawers stay lit. A rail the user
  does not own is `data-readonly`: the host ignores every press but opening
  or closing a drawer and the fold, so every other press stops answering
  the pointer (a spell still peeks on hover) and the nameplate says
  Observing.
- **Reload** is PF2e Ranged Combat's, drawn only while that module runs: a
  weapon whose `system.reload.value` is 1 or more gets a Reload press beside
  its name, lit while it is empty. Loaded is the module's Loaded effect aimed
  at the weapon (`flags["pf2e-ranged-combat"].targetId`), or, under PF2e's own
  ammunition, a round among the weapon's sub-items.
- **Spell cards** are put down (`spent`) only when the card was its own
  resource: a prepared slot cast, or an innate spell out of uses. Cantrips,
  focus spells and a spontaneous or flexible caster's spells stay in the hand;
  PF2e marks a whole spontaneous rank `expended` when its slots run out, and
  that is the rank's count on the pennant, not the cards.
- **A cast throws a card away only when it spends that card**: a prepared
  rank slot (`data-slot` on a ranked card; a prepared cantrip keeps its card)
  leaves the hand upward and the hand redraws it put
  down. Every other cast is *played* — the card lifts and settles back into
  the fan (`is-played`) and stays pressable, because nothing in the hand
  changed and the host does not redraw it. A thrown card that no redraw
  replaces (a cast cancelled or refused) comes back after
  `TIMING.cardReturn`.
- **Party seats** are the plinth in miniature: the same art (`artOf` on the
  member's token on this scene, else its prototype token, so a ring
  cut-out stands over its plate) under the owner's `ph.frame`, drawn with
  the plinth's own figure markup scaled by `--gph-sk`. Hit Points are a bar
  on the plate's foot. Exploring, a seat names the member's exploration
  activity, for the GM and the party alike (it is not a number, so a
  LIMITED seat shows it too).
- **Exploration activities** are the character's own exploration items,
  then (world setting `ph.coreExploration`, on by default) PF2e's nine
  standard ones the character does not carry, by slug
  (`STANDARD_EXPLORATION`, ids pinned against PF2e 8.7's Actions pack).
  Picking a standard one copies it from `pf2e.actionspf2e` onto the sheet
  (`game.items.fromCompendium`, so its source is kept) and sets it.
- **Foes**: disposition is read off `token.document`, never the placeable.
- **Hazard Disable** text runs through `inlineText`, so
  `@Check[thievery|dc:18]` reads "Thievery DC 18" instead of printing raw.
- **The target** is the target *as the party knows it*: `knownStat` from
  PF2e Odds' ledger, as a range, unless `seesTruth()` or the target is an ally.

`readPlayer` does not put the skill suggestions on the deck: the host adds
them in `compose()` (`withSkills`), because they follow the MAP step, and the
MAP step is a **driven** value. In the reader it would turn every attack into a
shape change and a re-render.

## The host (`host.mjs`)

Renders on a shape change (`shape.mjs` `shapeOf`), drives on a value change
(`liveOf` → `drive.mjs`). Every hook schedules one refresh per frame, with a
`TIMING.refreshFallback` timer beside the `requestAnimationFrame`: a background
tab starves frames, and without the timer the rail never draws there.

It mounts `#gph-host` at `--gl-z-hud` in the bottom-left corner, running to
the right edge of `#ui-middle`. While a rail is drawn it hides `#hotbar`
(`ph.hideHotbar`; the Macros drawer shows the user's hotbar) and Foundry's
player list `#players` (`ph.hidePlayers`; a kept list keeps the corner and
the rail starts beside it), gives both back when it is not, and publishes the rail's top edge as
`--gph-rail-top` on `body`. `/` opens the skill sheet from the canvas only (never
while somebody types).

**Putting things away.** Escape closes a peek or a drawer and is *eaten* when
it does: left to Foundry the same key also releases the controlled token, and
on the GM's screen the rail with it. A press anywhere off the rail closes a
drawer or a peek too. The skill sheet is the exception and stays open through it,
because targeting a token on the canvas is part of using it; so does the GM's
stat block, which is read while creatures are picked on the canvas.

**Tooltips.** The view states what a press is in `title` (it is pure, and the
preview has nothing else). On Foundry the host moves every `title` to
`data-tooltip-text` as markup lands (one MutationObserver on `#gph-host`), so
they open as Foundry's own tooltips, above the press, in half the time.
Always `-text`, never `data-tooltip`: that one is rendered as HTML, and item
and macro names are whatever a player typed. A redraw puts away a tooltip
standing on a node it is about to replace.

**Cards stand for tokens.** Resting on a card in the GM's hand or on a party
seat lights that token on the canvas, the way the combat tracker's rows do
(`_onHoverIn`, only for a token the viewer can see); picking a creature the
screen is not showing pans to it. A redraw and an unmount let a lit token go,
since the card that lit it never hears the pointer leave.

**The wheel** over the spell dial or the hand turns the rank, one step a
gesture (`TIMING.wheelStep`). Nowhere else on the rail does it mean anything.

Stored: the portrait frame in the actor flag `ph.frame`; the finder's pins in
the user flag `ph.pins` (`{ [actorId]: slug[] }`); `ph.folded`, `ph.gmRail`,
`ph.hideHotbar` and `ph.hidePlayers` are client settings; `ph.coreExploration` is a world setting. **The action economy is stored nowhere**:
`turn.mjs` keeps a tally per actor on this screen, refilled when the combat's
`id:round:turn` key names a new turn of that actor, spent only in a started
encounter. It is a reminder, never a rule.

## What every press calls

No press opens a dialog of the HUD's own. Where PF2e shows its
`CheckModifiersDialog`, that is PF2e following the user's own setting.

| Press | PF2e call |
|---|---|
| Perception / save / skill | `actor.perception.roll` / `actor.saves[k].roll` / `actor.skills[slug].roll` |
| Strike step | `strike.variants[i].roll({ event })`; MAP then steps |
| Damage / crit | `strike.damage({ event })` / `strike.critical({ event })` |
| Blast step / damage | `ElementalBlast#attack({ element, damageType, melee, mapIncreases })` / `#damage` |
| Skill action (sheet, deck) | `game.pf2e.actions.get(slug).use({ actors, statistic, multipleAttackPenalty, event })` — `statistic` is the sheet row the press stands in, `multipleAttackPenalty` the MAP step pressed (the action's name rolls at the turn's own step), else PF2e's legacy function of that name; Earn Income → `game.pf2e.actions.earnIncome(actor)` |
| Spell card | `entry.cast(spell, { rank, slotId })` |
| Action / feat (peek Use) | `game.pf2e.rollItemMacro(uuid, event)` — PF2e spends the frequency and applies the self-effect |
| Post (peek) | `item.toMessage` / `spell.toMessage` |
| Toggle / stance | `actor.toggleRollOption(domain, option, itemId, value)` |
| Raise | `game.pf2e.actions.raiseAShield({ actors, event })` |
| Reload (PF2e Ranged Combat) | `game.pf2eRangedCombat.reload()` — the module picks the weapon (it asks only when several could be loaded) and the actor (an open sheet, else the controlled token, else the user's character); the actions are spent on its `pf2eRangedCombatReload` hook |
| Item | `item.consume()`; resting on the card peeks (text, what is left, Use and Post), as a spell does |
| Hit Points (the numeral) | a field in the numeral's place: `−12` / `+5` → `actor.modifyTokenAttribute("attributes.hp", ±n, true)`, which is PF2e's `applyDamage` (temporary Hit Points first, dying after), as the token HUD's own field does; a bare number → `actor.update` clamped to 0…max. Owners only; the GM's creature panel has it too |
| Rest | `game.pf2e.actions.restForTheNight` |
| Macro | `macro.execute()`; the drawer's foot steps Foundry's own hotbar pages (`ui.hotbar.cyclePage`) |
| Hero point | `actor.update({ "system.resources.heroPoints.value" })` |
| Exploration activity | `actor.update({ "system.exploration": [id] })` (one at a time); a standard one the character lacks is first `actor.createEmbeddedDocuments("Item", [game.items.fromCompendium(doc)])` from `pf2e.actionspf2e` |
| Seat | GM: control that PC's token; player: open the sheet they can observe |
| Foe | control that token |

`presses.mjs` lists every `data-*` handle and `data-act` the view draws; the
check refuses one without a handler, and every finder slug PF2e's bundle does
not define.

## The light (`light.mjs`)

The rail's one moment that is not feedback. One WebGL2 canvas is prepended
to the `.gph` root after every render (the node and its context survive a
render) and stacked under `.gph-rail` (`z-index` 1 over 0): the plates are
opaque, so the light shows only on and above their edges, and the figure and
the held cards stay in front of it without a mask.

- **"in"** plays when your turn comes round (beside `D.ignite`) and when you
  get up from dying: a paper spark leaves the portrait, runs every plate's
  top edge left to right (fast, slowing at the far end), and lit smoke and
  sparks rise behind it.
- **"out"** plays when you go down (`relight(was, now)`; dying to dead plays
  nothing): the same pass in red, heavier with smoke, and the strikes and the
  deck dim (`is-going-down`) the moment it reaches them.
- **"home"** plays when your turn ends (going down outranks it): dimmer
  (`HOME_GAIN`) and quicker (`HOME_PACE`), it runs right to left, speeding
  up, and gathers behind the figure on the plinth.
- **On the GM's screen** a creature's turn plays "in" in its disposition's
  colour (`LIGHT_TONE`: red hostile, green friendly, steel neutral), and its
  card in the hand rises (`is-called`) and stays standing while the turn is
  its. The GM's turn key is read every refresh; the first read plays nothing.
- Each plate's edge flashes as the spark arrives: the host writes
  `--gph-lit-d` per plate from the inverse of the shader's own easing, so
  the CSS and the shader agree.
- The plate edges are measured at the start of a pass and handed to the
  shader as spans; every edge lights what stands above it and falls off past
  its ends, and the brightest wins, so no wall appears where two plates meet.
- Shed first (`SHED_ORDER = ["light"]`), registered with `Surfaces`,
  compiled in idle time after the first attach, motion claimed only while it
  plays, length `--gl-d-cinematic × 1.6` through the motion tier. Never on a
  folded rail or a hidden tab.

`pf2e-rail-check` pins the uniforms (every declared one written and looked
up), the stacking, the shed, the transition table and the purity. It cannot
compile GLSL: serve the preview and look (`&light=in|out&lt=0..1` holds a
frame).

## The moments (`moments.mjs`)

Everything the rail plays once is decided in one place: `momentsOf(was, now,
{ fresh })` compares the rail that was drawn with the one about to be (same
subject only; a change of rail plays nothing), and `playMoments` plays the
answer. `fresh` is the host's "a turn just started" (`Turn#sync` for a
player, a changed turn key for the GM). The preview calls the same two.

| Change | Moment |
|---|---|
| Your turn starts | the ignition and the light "in" |
| Your turn ends | the light goes home |
| You go down / get up | the light "out" / "in" |
| You become next (`upNext`, `turnbar.next`) | the bar knocks twice and its label pops |
| A Hero Point is spent | the gem cracks; with a roll echoed in the last `TIMING.rerollWindow`, its light streaks to that press and lands amber |
| A dying bead is lit / put out | it burns and the rail's edges flicker red / it exhales |
| A creature's turn (GM) | the light in its disposition, its card rises |

**On deck** is a state, not a moment: while the turn after the current one
is yours (`upNext` over `combat.turns`, skipping the defeated where core's
`skipDefeated` does), the turn bar's label reads "You're next" in an
outlined paper slab, the diamonds you are about to have are drawn in paper and
its top edge breathes. Whose turn it is now rides the title and the screen
reader. The canvas light never plays for it. An observer's rail is somebody
else's character, so the bar names them ("Valeros is next", "Valeros's turn",
`turnbar.observer`) and never says "you".

**A Hero Point's reroll** is PF2e's `rerollFromMessage`: it lowers the
points first, deletes the old message and posts a new one whose check context
carries `isReroll`. The host keeps the press the last roll echoed on
(`lastEcho`), so the spend streaks there and the reroll echoes there, both
within `TIMING.rerollWindow`.

**The dying beads** follow the dying value, whatever moved it: a recovery
check, a hit while dying (which burns, as it should), healing. Death plays no
bead; stabilising is the light coming back.

## The MAP steps

The strike row's three MAP steps are three equal presses, and none is lit,
sized or marked by the step you are on: the turn bar prints the MAP, and the
row keeps still while attacks land, so every bonus reads at a glance. (A
live step that grew, faded and slid was tried and taken out: too much moved
to judge a number by.)

## Skills

**The Skills tab is the plain checks.** Every skill and Lore is one press,
named whole, in the sheet's order (by name), three deep; a column is as wide as
its longest name. A Lore is its subject with the word small on a second line.
The keys never move, so nobody has to search for Athletics. Proficiency is the
rule under a key, in PF2e's rank hue; an untrained skill is dimmer. A deck too
narrow for sixteen names cuts none, hides none and scrolls none: the checks
become a block that rises out of the deck, as many columns as full names fit
(`@container gph`), so every skill is one press on a 900p screen with the
sidebar open. The sheet closes its lines up on a short screen
(`@media (max-height)`) and holds every skill at 900p without scrolling. The
tab prints no count, because it always holds every skill. A deck with
room to spare also shows the actions worth reaching for (the pins first, then
the best odds against the target, then the mode's staples) and a key that opens
the sheet.

**A key rested on offers its skill's actions (the fly).** A mouse that stays on
a key for `TIMING.flyOpen` raises that skill's row of the sheet over it
(`flyOf`, `V.SKILLFLY`): the same keys and the same presses as the sheet, so
an action rolled there is `useSkillAction` with that row's skill, MAP steps
included. The key under it is still the plain check. The fly stands edge to
edge on its key (`placeFly`), so the pointer walks up into it over no other
key; it closes `TIMING.peekClose` after the pointer leaves both, and with one
fly up the next key's follows at the card peek's pace. It lists every action
the skill can roll, whatever the mode, and leaves out what the sheet leaves
out (a trained-only action under an untrained skill). A finger's press never
opens it, and a key that flies carries no tooltip.

**The skill sheet** (`/`, the tab's ⤢, the GM's Skills press) is
`finderModel().rows`: Perception, the sixteen skills, the Lores, every one of
them always there. A row's head is that skill's plain check; beside it is every
action that skill can roll. Nothing is folded and nothing has to be opened.
Above them, while nothing is typed, stands one **Pinned** row: the character's
pins, each rolled with its best skill, so a pin is one glance away on any deck
(the rail's own keys show pins only where the deck has room). Its head is a
label, never a check, and the pinned actions keep their places in the rows below.

- An action several skills can roll (Recall Knowledge, Escape, Earn Income)
  stands in each of their rows and is rolled with **that row's** skill
  (`data-stat`). A statistic with no row of its own (Unarmed for Escape, Reflex
  for Grab an Edge) competes inside the rows the action has.
- A trained-only action under an untrained skill is not drawn.
- An encounter shows what can be done in one; exploring adds the exploration
  and downtime actions; typing finds any of them.
- Typing a skill's name keeps its whole row and puts the check first, so
  `/ath⏎` rolls Athletics. Typing an action's name keeps that action, and the
  row's check takes no key, so `/trip⏎` rolls Trip.
- Left and right step through the keys in reading order, up and down change
  row, Enter presses, P pins.

**MAP steps.** An action with the attack trait (Trip, Grapple, Shove, Disarm,
Reposition, Escape, Force Open) carries three presses beside its name, as a
strike's row does: first, second and third attack, each printing its own
modifier, none lit by the turn. A step hands PF2e that step
(`multipleAttackPenalty`), and PF2e applies its own penalty for it (−5, then
−10), which is what the press prints. PF2e's skill actions consult nothing
else: no weapon's agile trait and no rule element (its compendium rules all
select `attack`, a domain a skill check is not in, and Agile Maneuvers has no
rules at all). So `mapStepOf` reads the one thing that can lower it for a
skill, a MultipleAttackPenalty rule element whose selector is one of the
statistic's own domains (`athletics`, `skill-check`), takes the mildest whose
predicate holds, prints it, and hands PF2e the penalty itself as a negative
number, which `use()` applies unchanged. The action's name rolls at the turn's own step; `1`–`3` on the
sheet press a step of the selected action.

## The GM's stat bar

Over the creature panel, always drawn (`STATBAR`, from `statOf`): immunities,
weaknesses and resistances in PF2e's own labels (which already carry the value
and the exceptions), then every ability with no action to take (`actionType`
passive; reactions and free actions are among the moves already), then the senses. Two lines at
most. A passive is a press that peeks its text, as an ability chip does.
**Stat block** opens a drawer with the same facts whole, plus speeds, languages
each passive's text and the creature's listed skills as presses (the same
`data-check` a save uses); it stays open from creature to creature and through a
press on the canvas, and closes on its ✕ or Escape.

## The party's checks, and a call (`calls.mjs`)

**Party checks** (the press under the GM's party stack) is a grid: Perception,
the three saves and the sixteen skills down the side, a column per character,
the best modifier in each row marked. It stays open through a press on the
canvas, as the stat block does.

- **A number rolls that character's check in secret**: PF2e's own statistic
  roll with `messageMode: "gm"` and no event (an event would let a modifier key
  turn it public). The DC field, when filled, is handed to the roll.
- **A name calls for the check.** Each called player's rail shows the call over
  the turn bar: an amber slab, the check named whole at display size, their own
  modifier, the DC only when the GM ticked "show", and a paper Roll press. Its
  foot drains by the time it has left. A call ends when answered or put away,
  when the GM ends it, or after `CALL_LIFE`.

The bar over the grid composes the call as the sentence the GM would say, and the
line under it says it back before anything is sent:

- **To.** The column heads are the picker. Nobody picked is the whole party;
  pressing heads picks those characters (`callTargets`).
- **Roll.** How the roll is posted, in Foundry's own message modes
  (`CALL_MODES`): **Open** (`public`, the table sees it), **Private** (`gm`,
  the roller and the GM), **Blind** (`blind`, the GM alone sees the result).
  The player's bar says which before they roll, and the press hands PF2e that
  `messageMode`. PF2e's check dialog still offers its own mode select, and Ctrl
  still turns any roll blind.
- **DC**, and whether players see it.

While a call stands, that line is the call: a seat per called character
(waiting, rolled and the total, or away with nobody connected), the count, and
the same drain. The total is printed after `diceSettled`; its tone is PF2e's
outcome where the roll carried the DC, else `degreeOf` against the GM's own DC,
which never left the screen. The stack's Party checks press turns amber and
carries the tally while a call is out.

A call is stored nowhere. Five rules keep it honest, and the check pins them:
a call is honoured only when the **server-attested** sender is a GM
(`meta.attested`; the payload's own claim is never read); `readCall` is total
and keeps only the id, a check from `CALL_CHECKS`, a mode from `CALL_MODES`,
the called character ids, a DC in range and the expiry; a hidden DC never leaves
the GM's client, because a DC handed to PF2e is printed on the card; a call for
some of the party is **sent** to those players alone (`callRecipients`: the
player a character is assigned to, else its connected owners; never a GM or the
stream login), one message per player, so no other client hears that it was
made; and each payload names only that player's own called characters.

The arrival plays once (`fresh`, `.is-fresh`): the bar is drawn out from its
left edge, the slab strikes paper and settles to amber, the horn rings, the check
and its press land in turn. A redraw never replays it, and the grid's own
changes (a pick, a mode, an answer) swap the drawer's body in place
(`redrawParty`) so the drawer does not rise again under the GM's hand.

## The echo (`echo.mjs`)

A roll's total (and its degree, where PF2e would show it: `seesTruth()` or the
metagame "results" setting) prints on the press that made it, when the message
arrives within twelve seconds from the same user for the same actor. Never on the stream
login, never for a blind roll (PF2e's secret trait — even on the GM's screen,
where the card already has it), never for a whisper this viewer is not in.

It prints when the message's **dice have landed**, not when the message arrives:
with Dice So Nice the two are seconds apart, and a total printed at once gives the
roll away under the dice still tumbling. The press is matched as the message
arrives (while it is still the pending one); the number waits on
`diceSettled(message)` in `core/dice-wait.mjs` and the button is looked up again
afterwards.
