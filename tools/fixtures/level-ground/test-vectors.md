<!-- Transcribed verbatim from final/level-ground-rules.md (rules 0.13), section "Test Vectors". tools/level-ground-check.mjs re-runs every row against the shipped rules.mjs. -->

### Test Vectors

Vectors R1 to R6 and H1 to H6 follow from the definitions in this document.

**Convert and DCs.**

| ID | Input | Expected |
|---|---|---|
| C1 | `convertDC` of 5, 10, 13 | 5, 10, 13 |
| C2 | `convertDC` of 14, 15, 16 | 14, 14, 14 |
| C3 | `convertDC` of 17, 19 | 15, 15 |
| C4 | `convertDC` of 20, 21, 24 | 16, 16, 16 |
| C5 | `convertDC` of 25, 28, 29, 32 | 17, 17, 18, 18 |
| C6 | `convertDC` of 33, 36, 37, 40 | 19, 19, 20, 20 |
| C7 | `convertDC` of 41, 42, 45, 50, 60 | 20, 21, 22, 25, 30 |
| C8 | `taskRankOfPrintedDC` of 13, 14, 19, 20, 28, 29, 39, 40, 41 | untrained, trained, trained, expert, expert, master, master, legendary, legendary |
| C9 | `levelDC` of −1, 0, 2, 3, 5, 6, 11, 12, 15, 18, 20, 21, 24 | 13, 14, 14, 15, 15, 16, 17, 18, 19, 20, 20, 21, 24 |
| C10 | `taskRankOfLevel` of −1, 0, 4, 5, 11, 12, 19, 20 | untrained, trained, trained, expert, expert, master, master, legendary |
| C11 | `rankDC` of ranks 0 to 5 | 10, 14, 16, 18, 20, 22 |
| C12 | `assuranceResult` of ranks 1 to 4 | 12, 14, 16, 18 |
| C13 | `levelDC(10)` + very hard | 22 |

**Reach.**

| ID | Character rank, task rank | Expected penalty |
|---|---|---|
| R1 | trained, master | −4 |
| R2 | untrained, trained | 0 |
| R3 | untrained, expert | −2 |
| R4 | expert, trained | 0 |
| R5 | trained, legendary | −6 |
| R6 | legendary, mythic | −2 |

**Outmatched.**

| ID | Target level minus effect level | Expected bonus |
|---|---|---|
| O1 | −3, 0 | 0, 0 |
| O2 | 1, 2, 3, 4 | 4, 6, 8, 10 |
| O3 | 5, 9 | 10, 10 |
| O4 | −2, target is a Solo | 10 |

**Break Away DC.**

| ID | Pursuer level, circumstances | Expected DC |
|---|---|---|
| B1 | 15, none | 19 |
| B2 | 15, flies with no cover | 24 |
| B3 | 15, flies with no cover and faster | 24 |
| B4 | 15, faster, ground favors you | 19 |
| B5 | 15, faster, ground favors you, leading an ally | 21 |
| B6 | 8, faster, leading an ally | 20 |
| B7 | 3, leading an ally | 17 |
| B8 | 1, ground favors you | 12 |
| B9 | −1, none | 13 |
| B10 | 24, none | 22 |
| B11 | 30, none | 24 |

**Values and roles.**

| ID | Input | Expected |
|---|---|---|
| V1 | `specialistCap` for levels −1, 0, 1, 3, 7, 10, 20 | 12, 12, 12, 13, 15, 17, 22 |
| V2 | `creatureValue`, level 3: standard, Mook, Solo | 23, 11, 46 |
| V3 | `creatureValue`, elite at levels 4, 5, 10 | 64, 64.5, 207 |
| V4 | `creatureValue`, weak at levels 4, 5, 12 | 16, 28.667, 134.667 |
| V5 | `creatureValue`, elite Solo of level 9 | 336 |
| V6 | `creatureValue`, elite Mook at levels 4, 5 | 28, 27 |
| V7 | `threatValue` of 25, 26 | 1380.6, 1629.108 |
| V8 | `mookValue` of 25, 26 | 454.3, 536.074 |
| V9 | `threatValue` of −2, −3; `mookValue` of −2 | 2, 1; 1.5 |
| W1 | Sizing Up word, Below Trivial to Beyond Extreme | no threat, weaker, weaker, a real fight, dangerous, a coin toss, overwhelming |
| H1 | Mook, 50 Hit Points | 13 |
| H2 | Mook, 285 Hit Points | 72 |
| H3 | Solo, 50 Hit Points | 100 |
| H4 | Summoned, 51 Hit Points | 25 |
| H5 | Deadly: level 15 creature, PC with 73 maximum Hit Points | yes (Crit 73) |
| H6 | Deadly: level 3 creature, PC with 24 maximum Hit Points, without and with an area attack | no (Crit 23); yes (2 × Area = 28) |

**Threat worksheet.** Opposition entries are written as count × level. "No area" means the party has no area damage. Otherwise it has. Site, total, and party are rounded to whole numbers for display.

| ID | Party levels | Opposition | Site | Total | Party | Ratio | Quarters | Band before Outclassed | Band as read | XP |
|---|---|---|---|---|---|---|---|---|---|---|
| T1 | 5, 5, 5, 5 | 1 × 15 with area attack | 413 | 413 | 172 | 2.398 | 0 | Beyond Extreme | Beyond Extreme | 160 |
| T2 | 1, 1, 1, 1 | 1 × 5 | 43 | 43 | 40 | 1.075 | 0 | Extreme | Beyond Extreme | 160 |
| T3 | 8, 8, 8, 8 | 1 × 9 Solo | 224 | 224 | 364 | 0.615 | 0 | Moderate | Moderate | 80 |
| T4 | 8, 8, 8, 8 | 1 × 10 Solo | 276 | 276 | 364 | 0.758 | 0 | Severe | Extreme | 160 |
| T5 | 8, 8, 8, 8 | 1 × 9 Solo, 4 × 6 Mook | 316 | 316 | 364 | 0.868 | 0 | Severe | Severe | 120 |
| T6 | 10, 10, 10, 10 | 12 × 4 Mook, 2 × 8 | 350 | 438 | 552 | 0.793 | 1 | Severe | Severe | 120 |
| T7 | 10, 10, 10, 10, no area | 12 × 4 Mook, 2 × 8 | 350 | 525 | 552 | 0.951 | 2 | Severe | Severe | 120 |
| T8 | 20, 20, 20, 20 | 1 × 24 | 1170 | 1170 | 2640 | 0.443 | 0 | Low | Low | 60 |
| T9 | 10, 10, 10, 3 | 2 × 9 | 224 | 224 | 426 | 0.526 | 0 | Moderate | Moderate | 80 |
| T10 | 6, 6, 6, 6, no area | 10 × 2 Mook, 1 × 5 | 123 | 185 | 224 | 0.824 | 2 | Severe | Severe | 120 |
| T11 | 6, 6, 6, 6 | 10 × 2 Mook, 1 × 5 | 123 | 154 | 224 | 0.686 | 1 | Moderate | Moderate | 80 |
| T12 | 20, 20, 20, 20 | 8 × 14 | 2256 | 3384 | 2640 | 1.282 | 2 | Beyond Extreme | Beyond Extreme | 160 |
| T13 | 20, 20, 20, 20, no area | 8 × 14 | 2256 | 3948 | 2640 | 1.495 | 3 | Beyond Extreme | Beyond Extreme | 160 |
| T14 | 15, 5, 5, 5 | 1 × 15 | 330 | 330 | 349 | 0.946 | 0 | Severe | Severe | 120 |
| T15 | 10, 10, 5, 5, 5 | 2 × 10 | 276 | 276 | 313 | 0.882 | 0 | Severe | Severe | 120 |
| T16 | 10, 10 | 1 × 10 | 138 | 138 | 276 | 0.500 | 0 | Moderate | Severe | 120 |
| T17 | 10, 10, 10, 10 | 2 × 10 Solo | 552 | 552 | 552 | 1.000 | 0 | Extreme | Beyond Extreme | 160 |
| T18 | 10, 10, 10, 10 | 2 × 12 | 404 | 404 | 552 | 0.732 | 0 | Moderate | Severe | 120 |
| T19 | 10, 10, 10, 10 | 1 × 12 | 202 | 202 | 552 | 0.366 | 0 | Trivial | Trivial | 40 |
| T20 | 10, 10, 10, 10 | 4 × 10 | 552 | 552 | 552 | 1.000 | 0 | Extreme | Extreme | 160 |
| T21 | 10, 10, 10, 10 | 5 × 10 | 690 | 690 | 552 | 1.250 | 0 | Beyond Extreme | Beyond Extreme | 160 |
| T22 | 4, 4, 4, 4 | 1 × 4 simple hazard | 6 | 6 | 128 | 0.050 | 0 | Below Trivial | Below Trivial | 0 |
| T23 | 3, 3, 3, 3 | 2 × 5 complex hazard | 86 | 86 | 92 | 0.935 | 0 | Severe | Severe | 120 |
| T24 | 10, 10, 10, 10 and two level 4 Mook allies | 2 × 10 | 276 | 276 | 580 | 0.476 | 0 | Low | Low | 60 |
| T25 | 10, 10, 10 and a level 3 ally who is not a Mook | 2 × 10 | 276 | 276 | 437 | 0.632 | 0 | Moderate | Moderate | 80 |
| T26 | 20, 20, 20, 20 | 1 × 25 | 1381 | 1381 | 2640 | 0.523 | 0 | Moderate | Moderate | 80 |
| T27 | 10, 10 | 1 × 2 | 16 | 16 | 276 | 0.058 | 0 | Below Trivial | Below Trivial | 0 |
| T28 | 8, 8, 8, 8 | 1 × 10 elite, 2 × 5 weak | 264 | 264 | 364 | 0.726 | 0 | Moderate | Moderate | 80 |
| T29 | 5, 5, 5, 5, no area | 4 × 9 Mook | 168 | 168 | 172 | 0.977 | 0 | Severe | Extreme | 160 |
| T30 | 15, 15, 15, 15, no area | 8 × 12 | 1616 | 2828 | 1320 | 2.142 | 3 | Beyond Extreme | Beyond Extreme | 160 |
| T31 | 10, 10, 4 | 2 × 10 | 276 | 276 | 292 | 0.945 | 0 | Severe | Severe | 120 |
| T32 | 10, 10, 4, 4 | 2 × 10 | 276 | 276 | 248 | 1.113 | 0 | Extreme | Extreme | 160 |
| T33 | 8, 8, 8, 8, no area | 1 × 7 Solo, 8 × 1 Mook | 184 | 204 | 364 | 0.560 | 2 | Moderate | Moderate | 80 |
| T34 | 5, 5, 5, 5 and a level 12 ally who is not a Mook | 2 × 10 | 276 | 276 | 374 | 0.738 | 0 | Moderate | Severe | 120 |
| T35 | 1, 1, 1, 1 | 2 × 1, 1 × 0 | 28 | 28 | 40 | 0.700 | 0 | Severe | Severe | 120 |
| T36 | 10, 10 | 1 × 6 | 56 | 56 | 276 | 0.203 | 0 | Trivial | Low | 60 |
| T37 | 10, 10, 10, 10 and four level 3 allies who are not Mooks | 4 × 10 | 552 | 552 | 644 | 0.857 | 0 | Severe | Severe | 120 |
| T38 | 10, 10, 4, led by a spellcaster | 2 × 10 | 276 | 276 | 292 | 0.945 | 0 | Severe | Extreme | 160 |
| T39 | 5, 5, 5, 5, no area | 20 × 1 Mook | 100 | 150 | 172 | 0.872 | 2 | Severe | Extreme | 160 |

In T23 hazards do not count toward Outclassed. In T29 the Mooks equal the PCs in number, so nothing is added, and the four of them above the party's level make it Outclassed. In T14 and T15 most PCs are 3 or more levels below the party's level, so the higher PCs add two thirds. In T31 and T32 a second level 4 PC makes that half the party, and its total falls from 292 to 248. T27 is Below Trivial, which Outclassed never raises; in T36 the same party of two reads Trivial as Low. In T33 the Solo is not a body. In T25, T34, and T37 each ally adds its full row, and never sets the party's level or counts in line 2. In T35 the total of 28 equals the printed Severe column (4 × 7), although it is 70% of the Extreme total. T38 and T39 are Uncertain readings.

**Strip on text.** Each row is the input text, the level, and the expected output.

| ID | Level | Input | Expected |
|---|---|---|---|
| S1 | 3 | `AC 17; Fort +11, Ref +6, Will +5; Perception +5; Athletics +12; Str +5; Melee ogre hook +12, Damage 1d10+7` | `AC 14; Fort +8, Ref +3, Will +2; Perception +2; Athletics +9; Str +5; Melee ogre hook +9, Damage 1d10+7` |
| S2 | 8 | `Stealth +5 Will +3` | `Stealth −3 Will −5` |
| S3 | 3 | `Melee claw +21 [+16/+11] (agile), jaws +3 [+3/-2]` | `Melee claw +18 [+13/+8] (agile), jaws +0 [+0/−5]` |
| S4 | −1 | `Stealth +5, Athletics +7 AC 15` | `Stealth +5, Athletics +7 AC 15` |
| S5 | 0 | `Perception +9; Skills Deception +22, Diplomacy +22, Intimidation +19, Society +22, Guild Lore +17, Legal Lore +19 AC 14; Fort +6, Ref +3, Will +19; Melee fist +5, Damage 1d4+1` | `Perception +9; Skills Deception +12, Diplomacy +12, Intimidation +12, Society +12, Guild Lore +12, Legal Lore +12 AC 14; Fort +6, Ref +3, Will +12; Melee fist +5, Damage 1d4+1` |
| S6 | 7 | `Perception +16; Skills Arcana +22, Diplomacy +15, Academia Lore +25 AC 24; Fort +13, Ref +14, Will +18` | `Perception +9; Skills Arcana +15, Diplomacy +8, Academia Lore +15 AC 17; Fort +6, Ref +7, Will +11` |
| S7 | 1 | `AC 18 (20 with shield raised); Fort +7` | `AC 17 (19 with shield raised); Fort +6` |
| S8 | 5 | `DC 15 flat check, DC 5 flat, DC 22 Reflex` | `DC 15 flat check, DC 5 flat, DC 17 Reflex` |
| S9 | 5 | `Items +1 striking greatsword, +1 full plate; Will -1, Fort +9` | `Items +1 striking greatsword, +1 full plate; Will −6, Fort +4` |
| S10 | 15 | `AC 36 Fort +29 Ref +25 Will +26 +2 status to all saves vs. divine HP 285 Frightful Presence 90 feet, DC 34 Melee jaws +30 (reach 15 feet), Damage 3d12+11 piercing plus 2d6 fire` | `AC 21 Fort +14 Ref +10 Will +11 +2 status to all saves vs. divine HP 285 Frightful Presence 90 feet, DC 19 Melee jaws +15 (reach 15 feet), Damage 3d12+11 piercing plus 2d6 fire` |
| S11 | 0 | `Perception +17 (+19 to Sense Motive); Skills Diplomacy +22 (+24 to Make an Impression), Society +20` | `Perception +12 (+12 to Sense Motive); Skills Diplomacy +12 (+12 to Make an Impression), Society +12` |
| S12 | 7 | `Perception +16 (+18 to find traps); Thievery +20 (+24 to Disable a Device); Will +18 (+20 vs. mental, +1 status vs. magic)` | `Perception +9 (+11 to find traps); Thievery +13 (+15 to Disable a Device); Will +11 (+13 vs. mental, +1 status vs. magic)` |
| S13 | 5 | `Items: +2 resilient full plate, +1 striking longsword; Fort +12` | `Items: +2 resilient full plate, +1 striking longsword; Fort +7` |
| S14 | 5 | `Its staff functions as +1 striking staff; Will +9` | `Its staff functions as +1 striking staff; Will +4` |
| S15 | 3 | `Items arsenic (DC 18), manacles (DC 22), +1 chain mail; AC 21; Fort +12` | `Items arsenic (DC 18), manacles (DC 22), +1 chain mail; AC 18; Fort +9` |

**Strip on structured data.** `stripActor(actor)` on data in the pf2e system's stored form. Only the fields named were given. A1 is the Arboreal Warden (Monster Core) with one ability added to carry inline DCs. A2 is the Web Lurker Deadfall from the hazards pack. A3 to A5 are made up.

- **A1, creature of level 4.** Input: `ac.value` 20 and `ac.details` "(22 with shield raised)"; saves 13, 9, 11; `perception.mod` 11; `skills.athletics.base` 13; `skills.stealth.base` 9 with `special[0].base` 14; a melee item with `bonus.value` 13; a description `@Check[reflex|dc:21|basic] or grabbed ([[/act escape dc=21]]); @Check[flat|dc:5] to end it`. Expected: 16 and "(18 with shield raised)"; 9, 5, 7; 7; 9; 5 with 10; 9; `@Check[reflex|dc:17|basic] or grabbed ([[/act escape dc=17]]); @Check[flat|dc:5] to end it`.
- **A2, hazard of level 3.** Input: `ac.value` 19; saves 9, 9, and 0 for Will; `stealth.value` 13 and `stealth.details` `<p>@Check[stealth|dc:23]</p>`; `details.disable` "Survival (trained) or Thievery (expert) DC 20 to rearrange the webbing."; a description `@Check[reflex|dc:20|basic]`. Expected: 16; 6, 6, and 0; 10 and `<p>@Check[stealth|dc:20]</p>`; "Survival (trained) or Thievery (expert) DC 17 to rearrange the webbing."; `@Check[reflex|dc:17|basic]`.
- **A3, creature of level 0.** Input: `ac.value` 14; Will 19 with `saveDetail` "(+21 vs. emotion)"; `perception.mod` 17 with `details` "(+19 to Sense Motive)"; `skills.diplomacy.base` 22 with `special[0].base` 24; a Lore item with `mod.value` 19. Expected: 14; 12 with "(+12 vs. emotion)"; 12 with "(+12 to Sense Motive)"; 12 with 12; 12.
- **A4, creature of level 6 with carried items.** Input: a `consumable` with the description `@Check[fortitude|dc:18]`; an `equipment` item with `[[/act escape dc=22]]`; a `spell` with `@Check[reflex|dc:10]`; a spellcasting entry with `spelldc.value` 0 and `spelldc.dc` 24; an `action` with `DC 24 basic Fortitude save; @Check[fortitude|dc:24]`. Expected: the first three unchanged; 0 and 18; `DC 18 basic Fortitude save; @Check[fortitude|dc:18]`.
- **A5, hazard of level 23.** Input: `ac.value` 0; `stealth.value` 0; `details.routine` `@Check[will|dc:48|basic]`. Expected: 0; 0; `@Check[will|dc:25|basic]`.
