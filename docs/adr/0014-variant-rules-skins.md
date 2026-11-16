# 0014 · Scoped ink skins for Level Ground and Breath and Blood

Status: accepted (2026-11-17)

## Context

Level Ground and Breath and Blood are the owner's two PF2e variant rule sets,
shipped as two features that run alone or together. Both draw where Flatfinder
and PF2e Odds already draw: on PF2e's parchment sheets and chat cards, in the
combat tracker, and in windows of their own (Level Ground's Threat, Break
Away, Convert, Strip text and Setup tabs; Breath and Blood's Rest, Treat
Wounds and healing dialogs). Their readings are ranked (a threat rating, a
Break Away DC, three pools draining in order), so they need fixed tones that
are not the accent, on a light host and a dark one alike. An accent remap
(ADR 0001's floor) cannot give them that.

## Decision

Each feature carries a scoped Ink and Signal skin (ADR 0012), built the way
Flatfinder's (ADR 0010) and PF2e Odds' (ADR 0006) are, so all four read as one
family on a PF2e table.

- Level Ground's tokens are `--gllvg-*` on `.gllvg-root` and `.gllvg-app`.
  Breath and Blood's are `--glbab-*` on `.glbab`, `.glbab-panel`,
  `.glbab-app`, `.glbab-dialog`, `.glbab-card` and `.glbab-dialog-frame`.
  Every value is an alias of a core `--gl-is-*` token. Nothing is written on
  `:root`, and no foundation token is redeclared.
- Colour is kept for meaning. Level Ground: a reading's band sets
  `--gllvg-tone`, and the threat meter's fill says the same thing without hue.
  Breath and Blood: Stamina is breath (info blue), Hit Points are blood (red),
  Resolve is the day's reserve (amber); each pool is also its own labelled
  bar.
- Panels on a sheet and cards in chat are ink plates, so they read on
  parchment and on a dark sheet without knowing which.
- Motion comes from the suite's tokens (`--gl-d-*`, `--gl-ease*`). Any keyframe
  is prefixed with the feature's class prefix (`gllvg-`, `glbab-`).

## Consequences

- `tools/level-ground-check.mjs` and `tools/breath-and-blood-check.mjs` refuse a
  `:root` rule, a prefixed token read with no declaration, an unprefixed
  keyframe, and a raw duration or easing.
- The skins are not settings.
- No other feature gains a skin from this ADR.
