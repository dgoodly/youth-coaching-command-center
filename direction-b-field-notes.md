# Direction B — "Field Notes"

Visual system for the Coaching Command Center (youth speed and agility). Locked direction as of the
roster screen exploration, since updated to adopt a client-supplied palette (Orange Pantone,
Midnight Green, Gunmetal, Sand Yellow, Light Silver) onto the same structural logic. Carry this
alongside `DESIGNER_HANDOFF.md` so the visual system and the product invariants travel together
into any new design session.

## Concept

A sports-science field manual, not a wellness app. Off-white and ink instead of glossy dark mode.
One confident, warm accent instead of an ambient brand color. Precise enough to trust with an
assessment score, warm enough to eventually carry an athlete-facing surface without a full re-skin.

Register: quiet and accurate, not decorative. Every color, weight, and label either encodes a fact
from the data model or supports reading it faster — nothing exists purely for mood.

---

## Color

### Core palette

Adopted from the client-supplied brand palette, mapped onto Direction B's original structure. The
page background reverted to the original off-white after a brief detour through Ivory Cream and a
Light-Silver tint — neither earned its place once tested against the new accent.

| Token | Hex | Use |
|---|---|---|
| Page / surface | #F7F6F2 | App background, card fills (reverted to original — deliberately neutral so it never competes with the accent) |
| Outer canvas | #ECE9E2 | Wrapper behind the app frame, not part of the product itself |
| Ink (primary text, primary buttons) | #233038 (Gunmetal) | Headings, primary labels, primary buttons, nav |
| Muted text | #5C666D | Secondary labels, timestamps, helper copy |
| Border / hairline | #D3DBDD (Light Silver) | Dividers, input borders, table rules |
| Border / faint | #EAE7DF | Row dividers inside dense tables |
| Header row / hover tint | #F2F0EA | Table header background, row hover |
| Accent | #FF5B04 (Orange Pantone) | The one saturated color: badges/alerts, active states, top of the tier ramp, load-exceeded alert |

Rule: the accent is spent deliberately and reserved for "this matters most" — tier S and
load-exceeded share it on purpose, since both mean "maximum signal." Primary buttons use solid
Gunmetal instead, so the accent doesn't get diluted into a default UI color.

### Tier ramp — one hue, rising saturation

Tier (C to B to A to S) is a single hue — now Orange Pantone — ramping from pale to fully
saturated, not four unrelated colors. Progression reads by intensity alone, and the letter stays as
a redundant, colorblind-safe signal — status is never color-only.

| Tier | Background | Foreground | Meaning |
|---|---|---|---|
| C | #FCE0CC | #8A3B0A | Foundational |
| B | #FAB37D | #7A3306 | Developing |
| A | #FF8B45 | #4A1F02 | Proficient |
| S | #FF5B04 | #F7F6F2 | Advanced |
| none | #EDE9DC | #A6A39A | No assessment on file, a distinct state rather than a blank cell |

Never merge this ramp with maturity/PHV indicators. Maturity now gets its own dedicated hue —
Midnight Green #075056 — via a small triangle marker, completely unrelated to the orange family so
the two axes can never be mistaken for one signal. This is a hard product invariant, not a style
preference — see DESIGNER_HANDOFF.md section 4. Midnight Green replaces the original amber marker
and is a stronger fit: a genuinely separate hue rather than a second warm tone living near orange.

### Status and flag colors

| State | Background | Foreground | Notes |
|---|---|---|---|
| Load: over | #FF5B04 (solid) | #F7F6F2 | Full-strength accent — intentionally shares meaning with tier S ("maximum signal"); pairs with the word "over," never color alone |
| Load: watch | #FBEFCF (Sand Yellow tint) | #6B4E12 | |
| Load: ok / n-a | transparent | #B7B3A8 | Quiet by design |
| Re-assess due | dot #FF5B04 | text #FF5B04 | Dot plus text, not a colored cell background |
| Valgus watch pill | #E6EAEB | #233038 (Gunmetal) | Moved to a neutral chip — a persistent physical note, not a severity signal, so it no longer borrows the tier-C hue |
| Urgent row wash | #F7F0EB (hover #F1E4DA) | — | Desaturated close to the page background on purpose — a nudge toward the orange signal, not a second alarm competing with it |

---

## Typography

Three families, each with one job. Never mix a role across families.

| Role | Family | Weights | Where |
|---|---|---|---|
| Display / numerals / headers | Archivo | 600, 700, 800 | Page titles, hero stats, tier badge letters, section headers |
| Body / UI / labels | Inter | 400, 500, 600, 700 | Body copy, table labels, buttons, nav, helper text |
| Raw data (timed/measured values) | IBM Plex Mono | 400, 500, 600 | Times, splits, dates, cm/yr, anything where digit alignment matters more than character |

Scale used so far:

| Size | Weight | Use |
|---|---|---|
| 26-28px | Archivo 800 | Page H1 |
| 34-40px | Archivo 800 | Hero stat numbers |
| 15px | Inter 600 | Card titles |
| 13px | Inter 400/600 | Body, table cells |
| 12px | Inter 600 | Chips, flags, small labels |
| 10-11px | Inter 600, uppercase, tracked +0.08em | Eyebrows, column headers |

Sentence case throughout except eyebrow labels — small caps / uppercase tracking is the one
deliberate exception, reserved for section labels, never headings, buttons, or body text.

---

## Shape and spacing

| Element | Radius |
|---|---|
| Cards, panels | 10-16px |
| Buttons, inputs | 8px |
| Tier badges | 6px |
| Filter chips | 20px (pill) |
| Table / dividers | 0, hairline rules only |

- Borders are always 1px solid — no soft/faded borders, no drop shadows. Flat surfaces throughout.
- Card padding: 16-18px. Section padding: 28-36px horizontal on desktop.
- One accent-filled button per screen; everything else stays quiet (outline, ghost, or plain nav).

---

## Component patterns established

- Tier badge: fixed-size rounded-square chip, letter centered, Archivo 700, color from the ramp
  above. Same shape everywhere it appears (roster row, athlete header, tier history).
- Status flag: icon or dot plus short text label, always paired, never a bare color swatch.
- Attention/triage cards: a row of plain white cards above a table, each a count plus label,
  clickable to filter the table below — answers "what needs me today" before the table does.
- Urgent row: a warm background wash on the row, not a badge or border — visible at a glance
  without competing with the tier badge for attention.
- Maturity marker: small triangle plus mono value, separate hue family from tier, never placed to
  imply correlation with it.
- Data cells (times, splits, cm/yr, block-split): set in IBM Plex Mono for alignment; surrounding
  labels stay in Inter.

---

## What this direction is not

- Not decorative — no gradients, no icons without a functional purpose, no color used for mood
  rather than meaning.

## Reference files


- DESIGNER_HANDOFF.md — the product invariants this visual system must respect (tier/maturity
  separation, coach-only fields, gut-call-before-reveal)
