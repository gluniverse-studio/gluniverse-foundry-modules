# Breath and Blood

Breath and Blood is the GM's own Stamina rule for PF2e Remaster (rules version
0.9, `final/breath-and-blood-rules.md` in the private `level-ground` repo). It
sits on top of pf2e's **Stamina variant** (`pf2e.staminaVariant`) and rewrites
the parts of that variant that disagree with the rule: how Resolve Points are
capped, how healing is paid for, what a breather and a night do, Treat Wounds,
Battle Medicine, drained, and companions, rivals and eidolons. It is a suite
feature (`breath-and-blood`, prefix `bab.`, pf2e only, off by default).

It does nothing to an actor while pf2e's Stamina variant is off. On ready the
active GM is asked once whether to turn it on, and the Rest window's Setup tab
shows the status with a button. Nothing turns the variant on without the GM's
click.

## What it does

| Rule | What runs | Where |
|---|---|---|
| Two pools | Maximum SP raised to 1 per level; maximum RP set to `bab.maxResolve` (3 for companions, 2 for rivals, or by level); drained re-split, SP first; companions and rivals split in half | `prepareData` wrapper (`prepare.mjs`) |
| Companions, rivals, eidolons | The GM marks an actor's role on its panel. A character companion is re-split. An NPC or familiar keeps its SP and RP in flags. An eidolon names its summoner (`sharesWith`), and every read and write goes to the summoner | `actor.mjs` |
| Damage order | Temp → SP → HP; direct damage skips SP; Grim Wounds makes damage direct while unconscious or bleeding | `calculateHealthDelta` / `applyDamage` wrappers (`damage.mjs`) |
| Healing | Classified (spent / paid / ask). The patient pays 1 RP or declines (`bab.declines`), the minimum applies, and spent healing overflows into SP. pf2e writes the HP (`final: true`); SP, RP and the mended state follow | `applyDamage` wrapper, `classify.mjs`, `rules.mjs` |
| Healing that repeats | Fast healing and regeneration: paid once when the effect begins, then a cover runs until the effect ends | `damage.mjs` (covers) |
| Treat Wounds, Battle Medicine | This feature's own window: each patient chooses first, then one check and one roll (Ward Medic), replacement degrees, minimum, Field Surgeon, Assurance, Level Ground DCs, Battle Medicine immunity per healer | `medicine.mjs`, `apps.mjs` |
| Breather | One End Breather command: Lend Strength first, then Bind Your Own Wounds, then the breather (wake, SP, flags, wounded) | Rest window, `actions.mjs` |
| Nights | Night's rest / rough night / haven per actor. pf2e's `restForTheNight` runs for characters, then corrections: RP for a rough night, the second HP helping in a haven, wounded ends, flags cleared | Rest window, `pf2e.restForTheNight` hook |
| Actions | Catch Your Breath, Steel Your Resolve (free, once per day), Surge, Hold On (offered before each recovery check), Lend Strength, Encouraging Words | Sheet panel, `rollRecovery` wrapper |
| Redirects | `game.pf2e.actions.takeABreather` opens the Rest window; `steelYourResolve`, `treatWounds` and `encouragingWords` run this feature's versions (`bab.redirectSystemActions`, on by default). pf2e's Action objects for `treat-wounds` and `encouraging-words` (`game.pf2e.actions.get(slug).use`, which inline `[[/act]]` links call) are redirected too | `installRedirects` |
| Mended | Set when HP rises outside a started encounter and the write was not this feature's own; cleared when an encounter starts | `damage.mjs` |
| Returning from death | GM button: RP and SP to 0 | Sheet panel (GM block) |
| Massive damage | Nothing: pf2e makes the test | — |
| Lasting Wounds | Stands down while this feature is on: no penalty, no sync, no rest hook; existing penalties are cleared on ready | `pf2e-variant-rules/wounds.mjs` |

Players see the panel on their own sheets, with refusals given as the rules'
reasons. The GM also sees a block on every sheet for role, `sharesWith`,
returning from death and direct damage. The scene controls gain Rest (everyone)
and Treat Wounds (GM). The suite API (`game.modules.get(id).api["breath-and-blood"]`)
exposes `openRest`, `openTreatWounds`, `catchYourBreath`, `lendStrength`,
`holdOn`, `bindYourOwnWounds`, `encouragingWords`, `breather`, `night`,
`applyDirectDamage`, `returnFromDeath` and `promptDirectDamage`.

## Files

```
scripts/features/breath-and-blood/
  index.mjs      Adapter: settings, synchronous onInit (wrappers), onReady (socket,
                 redirects, setup prompt, Lasting Wounds clean-up), scene tools, API
  rules.mjs      PURE. Every procedure of the reference, state in, new state out
  constants.mjs  PURE. Setting keys, flag keys, feat slugs, refusal/why/unpaid lists
  classify.mjs   PURE. describeSource (duck-typed pf2e item/message/options) and
                 isRepeatingMessage
  views.mjs      PURE. Every piece of markup (panel, Rest, Setup, Treat, dialogs, card)
  settings.mjs   Setting defs as data, registerSettings, dials()
  actor.mjs      Reading and writing pools (system paths or flags), conditions
  prepare.mjs    derivePools (pure) + the prepareData and LoseHitPoints wrappers
  damage.mjs     Damage/healing wrappers, the healing dialog, covers, mended
  actions.mjs    The actions, breather, night, socket ops, redirects
  medicine.mjs   Treat Wounds / Battle Medicine model, run and commit
  apps.mjs       RestApp and TreatApp (ApplicationV2 built in a memoised factory)
  panel.mjs      The sheet panel
  chat.mjs       Chat cards and notifications
styles/breath-and-blood.css         Ink and Signal under --glbab-*, scoped roots
lang/breath-and-blood.en.json       GLBAB.*
tools/breath-and-blood-check.mjs    The check (below)
tools/breath-and-blood-preview.mjs  Every surface, drawn from views.mjs
tools/fixtures/breath-and-blood/vectors.mjs  The reference's 102 test vectors
```

Flags live under `flags["gluniverse-foundry-modules"].bab.*` (`role`,
`sharesWith`, `declines`, `caughtBreath`, `strengthLent`, `mended`, `ewImmune`,
`fieldSurgeonUsed`, `steelUsed`, `covers`, and `sp`/`rp` for NPC-type pools).
A character's SP and RP stay at pf2e's own paths (`system.attributes.hp.sp`,
`system.resources.resolve`), so pf2e's token bars, clamps and rest keep working.

## Check and preview

```bash
node tools/breath-and-blood-check.mjs
node tools/breath-and-blood-preview.mjs && node tools/preview-server.mjs 8962
```

The check runs the 102 vectors against `rules.mjs`, the adapter's
registration, every setting, every literal and runtime-built `GLBAB` key, the
purity of the pure modules, the pf2e-facing rewrites on fixtures
(`describeSource` → `classifyHealing`, `derivePools`, `drainedLoss`,
`isRepeatingMessage`), the seams listed below, and CSS hygiene. It also runs the
preview and refuses a missing key in it. To see the surfaces, open
`/.preview/breath-and-blood.html` (`?only=panel|panel-dark|panel-gm|panel-companion|panel-one|panel-off|rest|setup|treat|battle|heal|heal-repeat|holdon|chat`,
`?fonts=1` lists any text under 11px). Stop the server with `fuser -k 8962/tcp`.

## The pf2e seams

Each of these fails silently, and the check can only pin the shape of the
call, not what pf2e does with it.

- **The pools are set after `prepareData`.** The wrapper runs pf2e's
  preparation and then overwrites `hp.max`, `hp.sp.max` and `resources.resolve.max`.
  pf2e's update clamp and its rest read those prepared maxima back, so 4 RP
  survives an update and a rest. The reference suggested an `afterDerived`
  ActiveEffectLike instead. That needs an effect item on every actor and does
  nothing for SP, drained or companions.
- **Healing is written by pf2e with `final: true`.** `applyDamage` with `final`
  sets `skipIWR` and skips the `healing-received` modifiers (pf2e.mjs
  33224–33240: `l && (a = !1, i = !0)` and `if (l || m) return { modifiers: [] }`).
  The wrapper therefore folds `healing-received` into the amount itself before
  it decides, then hands pf2e the HP part only, so pf2e still handles dying,
  wounded and its own chat line.
- **A bar edit is not healing.** `applyDamage` called with `final` and no item
  or options is a token bar drag. It is passed through untouched, so a GM can
  always set HP by hand.
- **Drained is wrapped in two places.** pf2e's drained has a `LoseHitPoints`
  rule with `reevaluateOnUpdate: true` (conditions pack). `onCreate` writes HP
  inside the creating update, and `preUpdate` writes it when the value changes.
  Both run before any `preUpdateItem` hook could see them (pf2e.mjs 44313–44335),
  so the correction wraps both and changes the write pf2e makes, once, on the
  client that made it.
- **Hold On wraps `rollRecovery`** on the character, NPC and familiar classes
  and asks before the roll.
- **The night is pf2e's `restForTheNight`, then corrections.** pf2e fires
  `pf2e.restForTheNight` per actor after it has updated that actor and before it
  creates the chat messages (pf2e.mjs 25960–25990). The Rest window calls the
  action with `skipDialog` and corrects afterwards. A night started from pf2e's
  own sheet button is corrected from the hook, and `NIGHT_RUNNING` stops the two
  from both applying.
- **Socket ops** (`lend`, `words`, `medicine`, `result`) are honoured only by
  the active GM, and only when the server-attested sender (`meta.attested`) owns
  the giver, the speaker or the healer.

## What stays manual

- Marking which NPC-type actors are companions or rivals, and which eidolon
  shares with which summoner.
- Whether the 10 minutes were restful, whether a night was rough or a haven,
  range, and whether two characters share a breather.
- Healing the classifier is unsure of (`healingPrompt` decides when the dialog
  appears): unknown spells, items made at today's preparations, staves.
- Direct damage the damage type does not identify (the GM's Direct Damage
  button, or `api.applyDirectDamage`).
- Returning from death (the GM's button).
- Grim Wounds can only see unconsciousness and a persistent bleed condition.

## Known limits

- **The patient decides when the healing is applied, not before the roll.**
  pf2e calls no hook before a healing roll, and wrapping the casting paths was
  left out. This is the reference's own fallback.
- **NPC-type pools are not on the token bars.** They live in flags, and pf2e's
  massive damage test reads `sp.max` only for characters (pf2e.mjs 33290:
  `this.isOfType("character") ? this.attributes.hp.sp?.max ?? 0 : 0`). An NPC
  companion is therefore tested against its HP alone, and so dies of massive
  damage more easily. pf2e's rest handles characters only, so an NPC
  companion's drained, doomed and fatigued are not reduced by the night.
- **Socket results trust the healer's own roll.** The GM re-decides every
  procedure on the live actors, but takes the degree and the healing total from
  the attested owner of the healer.
- **Field Surgeon and Surge are not in pf2e's packs.** The suite's own
  "Breath and Blood (PF2e)" compendium (`packs/breath-and-blood`) carries them,
  with the rule's versions of the other feats under pf2e's slugs. The feature
  reads feats by slug only, so a world copy of either works too.

## Where the implementation reference was wrong

1. **pf2e has an Encouraging Words action.** The reference names
   `takeABreather` and `steelYourResolve` as the system actions to avoid.
   `game.pf2e.actions.encouragingWords` also exists (pf2e.mjs 114484–114560,
   exported at 116731). It heals by the printed feat and applies the printed
   immunity, which conflicts with the rule in the same way, so it is redirected
   too.
   pf2e also keeps an Action object for Treat Wounds and Encouraging Words
   (`game.pf2e.actions.get(slug)`); an inline `[[/act treat-wounds]]` link calls
   its `use`, not the legacy function, so wrapping the functions alone left that
   road on pf2e's printed version (found live). The instances' `use` is shadowed
   as well.
2. **Field Surgeon and Surge do not exist in pf2e's packs.** The feats pack has
   `encouraging-words` (L2), `steel-your-resolve` (L3), `continual-recovery`
   (L2), `ward-medic` (L2) and `battle-medicine` (L1), but no `field-surgeon` and
   no `surge`. The rules treat both as feats a character can have. The suite's
   compendium carries them.
3. **Drained's lost HP are written twice, not once.** The reference says
   drained has "a `LoseHitPoints` rule of the same size". It also has
   `reevaluateOnUpdate: true`, so `LoseHitPointsRuleElement#preUpdate` takes HP
   again whenever the value changes (pf2e.mjs 44326 onward), not only `onCreate`.
   A correction made only on creation leaves drained 1 → 2 taking HP. The
   modifier on `hp` is `min(-1 * @actor.level, -1) * value`, so a level 0
   creature loses 1 per value, not 0.
4. **`applyDamage(..., final: true)` drops healing bonuses.** The reference
   (carried over) says negative damage with `final: true` "applies healing
   through the system". It does, but `final` also skips every
   `healing-received` modifier (pf2e.mjs 33233–33238). A healing bonus such as a
   ward or an effect is lost unless the module adds it first, which this
   feature does.
5. **Massive damage counts SP only for characters.** The reference says the
   threshold is `(hp.max + sp.max) * 2` and that the module needs no change.
   pf2e reads `sp.max` only for `character` actors (pf2e.mjs 33290), so for a
   companion or rival kept in flags, the threshold is `hp.max * 2`. This is
   recorded as a limit.
6. **Fast healing arrives with no item.** The reference expects a repeating
   source to be identified when the effect begins. pf2e's
   `FastHealingRuleElement#onUpdateEncounter` posts each installment as a bare
   roll message (flavor `PF2E.Encounter.Broadcast.FastHealing.<type>.ReceivedMessage`,
   no `flags.pf2e.context`; pf2e.mjs 43805–43818), and the apply button passes
   no item. The source is found from the message the user clicked
   (`isRepeatingMessage`) and from the actor's FastHealing rules.
7. **Rest for the Night's hook comes before the messages.** The hook fires per
   actor inside the loop, after that actor's update and before
   `ChatMessagePF2e.createDocuments` (pf2e.mjs 25984–25989). Corrections made in
   the hook are therefore in place before pf2e's "awakens" card is posted, but
   that card lists pf2e's restored values, not the corrected ones. This
   feature's own night card follows it with the corrected values.
