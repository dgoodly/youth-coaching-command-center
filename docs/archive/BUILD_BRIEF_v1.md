# Youth Coaching Command Center — Build Brief

> **Read this first.** This document orients a fresh Claude Code session (which has
> none of the original design conversation) to what we're building and — more
> importantly — *why the decisions were made the way they were*. The "why" is the
> part that isn't recoverable from the other files. Treat the rationale sections as
> binding design intent, not background reading.

---

## 0. TL;DR

Build a local, single-coach **command center** to track youth athletes, run a
movement-quality **assessment**, assign a non-user-facing **tier (S/A/B/C)**, serve
the right **workout** for that tier, and surface a **dashboard** across the roster.

The dashboard is allowed to be rough. The **data model, scoring engine, and program
assembler are NOT** — they must be built clean, because they are the literal
foundation of a future consumer app. Build #1 (personal tool) so it feeds #2 (app).

**Storage:** local files (JSON or SQLite). A few dozen athletes max at this stage.
Do not introduce servers, cloud DBs, auth, or web infrastructure. Resist scope creep
toward "the app" — that's a later, separate build informed by what this one teaches us.

---

## 1. What this is, and the prime directive

The coach is a youth speed/strength/athletic-development specialist. This tool is for
**their own roster** — not yet a product. But it is deliberately architected so its
core logic transfers directly into a future app.

**Prime directive: separate the durable core from the disposable surface.**

| Layer | Durable? | Notes |
|---|---|---|
| Data model | **Durable** | Mirrors the assessment spec. Becomes the app's schema. |
| Scoring engine | **Durable** | Tier assignment logic. Runs identically in app + tool. |
| Program assembler | **Durable** | Tier → session generation from a tagged movement library. |
| Dashboard / CLI / UI | **Disposable** | Whatever's fastest. Will be rebuilt for the app. |
| Validation log | **Durable (data)** | The dataset that de-risks the whole app. |

If a tradeoff pits "ship the dashboard faster" against "keep the core clean," **keep
the core clean.** The dashboard can be ugly; the core cannot be wrong.

---

## 2. Companion files to read

These sit in the project folder alongside this brief, all in Markdown so they're native to
the repo and diffable. Read them before building:

- **`Youth_Tiering_Assessment_Spec.md`** — the authoritative spec for the assessment:
  the 6-test battery, the 0–3 rubrics, the scoring engine (raw total → base tier →
  gates), the tier→program mapping, the maturity axis, and the §8 data model. **This
  brief does not restate the spec in full — implement from the spec, use this brief
  for intent and sequencing.**
- **`COACHING_INSTRUCTIONS.md`** — the coaching philosophy/persona that governs all
  program content (Sprint/Jump/Lift chassis, within-session order, base+funnel
  warm-up, strength-first-on-mechanics, scale-dose-to-maturity, etc.). The program
  assembler must not violate these. (This is the same text as the coach's project
  custom-instructions, exported to a file so this environment can read it.)
- **`4Day_Athletic_Split_Program.md`** (plus 2-day and 3-day companion reference programs) —
  fully built reference programs at each training frequency. Use them as the reference shape for
  what an assembled session looks like at 2, 3, and 4 days/week, and the 4-day as the anchor for
  the movement library's tagging. See §2A.8 for the multi-frequency requirement.
- **`Field_Form_Data_Contract.md`** — the data-entry contract derived from the paper
  capture form. Whatever the coach writes on paper must map 1:1 into the tool; this file
  defines those fields and the ingestion rules.
- **`exercise_library.json`** — the populated movement library (127 exercises). **This
  IS the `/library/movements.json` referenced in §4 — do not create a second/empty one.**
  See the Library Update section below before using it.
- **`EXERCISE_LIBRARY.md`** — schema, the difficulty model, the assembler selection
  logic, and the variation/rotation (anti-staleness) system for the library above.

Polished human-facing originals (`.docx` / `.pdf` of the spec, program, and field form)
may also be present — they're for the coach to read/print. The **Markdown files above are
the machine-facing source of truth** for building.

If any of these files are missing, ask the coach for them before proceeding — do not
reconstruct their contents from memory.

---

## 2A. Library Update (added after v1 brief — read this)

A populated exercise library (`exercise_library.json` + `EXERCISE_LIBRARY.md`) was added
after this brief's first draft. It resolves and extends several things below. Treat these
points as binding:

1. **It IS `movements.json`.** §4's architecture calls for `/library/movements.json`. That
   file already exists as `exercise_library.json` — 127 exercises, populated and validated.
   **Use it. Do not scaffold an empty or parallel movement library.** Rename/relocate into
   `/library/` if you like, but it's the same file.

2. **The exercise schema is defined — don't invent one.** `EXERCISE_LIBRARY.md` §2 is the
   authoritative exercise schema (fields, types, dose shape). The assessment spec's §8 data
   model covers athletes/assessments; the exercise schema comes from the library doc. Use it
   as-is.

3. **`min_tier` and `difficulty` are SEPARATE by design — do not merge them.** `min_tier`
   (C/B/A/S) is the safety/selection gate. `difficulty` (1–10) is the inherent demand, used
   for session load-balancing and progression ordering. They look redundant; they are not.
   Collapsing them breaks the assembler's ability to balance load within a tier. This is a
   do-not-re-litigate decision.

4. **The assembler now has a written spec.** §5 of this brief said "build the assembler"
   without detail. That detail now lives in `EXERCISE_LIBRARY.md` §3 (selection logic:
   gate-by-tier → filter-by-equipment → match-plane/pattern → valgus-priority →
   balance-difficulty → enforce hard rules) and §4 (rotation logic). Implement the assembler
   from those two sections. Do not improvise selection logic.

5. **New scope: the rotation system needs persisted per-block state.** The library adds an
   anti-staleness system (`EXERCISE_LIBRARY.md` §4): movements are grouped into
   `variation_family` sets and rotated at 8–10-week block boundaries while the session
   skeleton stays fixed. **This requires new stored state** — track, per athlete, which
   family variant they're on for each slot in the current block, and the block start date.
   Add this to the data model (e.g. a `block_state` record per athlete). Rotation cannot work
   without it.

6. **`0-set dose` convention.** In an exercise's per-tier `dose`, a tier with `"sets": 0`
   means **"not prescribed at this tier"** — it is NOT a literal zero-set instruction, and is
   distinct from `min_tier` gating. The assembler must treat a 0-set dose as "unavailable at
   this tier" and skip it. Missing this generates broken sessions.

7. **The library's numbers are unvalidated defaults.** The `difficulty` ratings and per-tier
   doses are reasoned starting points, not tested values — same status as the assessment's
   score bands/gate thresholds. They belong in the same validation loop; note them in
   `FEATURE_IDEAS.md` as "tune against real athletes."

8. **Support 2-, 3-, and 4-day training frequencies.** The seed folder now carries reference
   programs at all three frequencies, not just the original 4-day split — the assembler/program
   layer must support all three. A lower-frequency program is a **subset of the same 4-day
   day-template set, not a different chassis**: the day templates stay the source of session
   structure, and frequency is expressed as *which* of those days a given plan runs.
   **Implemented via tier-scoped plans (`library/plans.json`):** each plan names the day-template
   days a tier follows — C = 2-day (days 1·2), A/B = 3-day (days 1·2·4), S = 4-day (1·2·3·4) — and
   every plan day is assembled by the normal pipeline (`planForTier` → `assembleSession` per day;
   surfaced as the dashboard's day tabs). Validate each assembled frequency against its matching
   reference program. When adding/adjusting frequencies, edit `plans.json` (and add a reference
   program), not the assembler — day selection is the knob, the chassis is fixed.

---

## 3. The core design decisions (the "why" — do not re-litigate)

These were resolved deliberately in the original design work. A fresh session will be
tempted to "improve" them; don't, without flagging it to the coach first.

### 3.1 Two independent axes: TIER and MATURITY
- **Tier (S/A/B/C)** governs *movement selection / risk* — which exercises are safe
  and appropriate (depth drops, plyo density, max-velocity volume, loaded progressions).
  Set by the assessment.
- **Maturity** governs *dose* — volume, load, recovery — *within* a tier. Set by
  biological maturity (height-velocity tracking).
- **They must be stored and computed as separate fields.** Never let maturity change
  the tier, and never let the tier dictate dose. Rationale: the coaching model is
  "scale the dose to biological maturity, not skill." Conflating them breaks that rule.
  An athlete is e.g. *"A-tier movement, low maturity"* = advanced movements, trimmed
  volume.

### 3.2 Landing integrity is the gate
The scoring engine is weighted so a powerful, well-balanced athlete who **cannot
control landings** is routed *down*, not up. This is encoded as **hard gates that can
only lower a tier, never raise it** (see spec §4). Specifically: failing the squat or
drop-stick test caps at C; a non-perfect single-leg drop-stick caps below S. Rationale:
this is a youth long-term-development model — injury avoidance and movement control
outrank athletic output, always. **Do not soften the gates to make tiers feel more
generous.**

### 3.3 Tiers and raw scores are non-user-facing
The tool may show them to the *coach*. A future app must **never** show a tier label
or raw score to the *athlete or parent* — only "today's workout" and positive,
improvement-framed feedback. Rationale: a 9-year-old seeing "C-tier" undercuts the
entire long-term-development, keep-it-fun philosophy. Bake this into the data model as
a visibility concept now so it's not retrofitted later.

### 3.4 One movement library, tagged by minimum tier
Do **not** build four separate programs. Build **one** library of movements/drills,
each tagged with a `min_tier`, and assemble sessions by filtering. Rationale: keeps
re-tiering seamless (an athlete moving B→A just unlocks more of the same library) and
keeps the program logic single-sourced. The 4-day split is the A/S reference; a C-tier
athlete gets the *same session skeleton* (Jump→Sprint→Lift, base+funnel warm-up) with
simpler movements, double-leg landings, no depth drops, acceleration-only sprinting.

### 3.5 Program structure is fixed; only content scales
Every assembled session, every tier, follows the same skeleton:
**Warm-up (base + funnel) → Jump → Sprint → Lift → cooldown.** The within-session
order (highest-CNS work first) and the hard sequencing rule (max-velocity sprint work
never downstream of a heavy plyo block) are non-negotiable and must be enforced by the
assembler, not left to chance. Warm-up funnels to the day's emphasis (Linear Speed vs
Change-of-Direction).

### 3.6 Dynamic re-tiering, both directions
Tiers are re-assessed every 4–6 weeks and can go **up or down** (down after layoff /
injury / a growth spurt). The gates re-run every assessment. Rationale: this is what
makes the system adaptive rather than a one-time sort, and it's a core app behavior we
want to prototype now.

### 3.7 The validation log is a first-class feature, not an afterthought
Every assessment stores the **calculated tier**, the **base tier before gates**, and
**which gate fired** — plus a field for the **coach's independent gut-call tier**. The
gap between calculated and gut-call, across real athletes, is what tunes the score
bands and gate thresholds. Rationale: the bands/gates in the spec are *reasoned
defaults, not validated numbers.* This log is how they become validated. The whole
command center partly exists to generate this dataset.

---

## 4. Suggested architecture (local, simple)

Keep it boring and file-based. A reasonable shape:

```
/command-center
  /data
    athletes.json            # roster: profile, sport(s), training-months, DOB
    assessments.json         # one record per assessment (scores, tiers, gate, gut-call)
    height_log.json          # quarterly standing-height entries (maturity axis)
    workout_log.json         # sessions served + completion / coach notes
  /library
    movements.json           # the single movement library, each tagged min_tier + slot
  /engine
    scoring.*                # raw total -> base tier -> gates (from spec §4)
    assembler.*              # athlete tier -> assembled session (enforces §3.5)
    maturity.*               # height-velocity -> dose modifier (defer detail, stub now)
  /dashboard
    (whatever surface is fastest: CLI table, simple local web view, etc.)
  BUILD_BRIEF.md             # this file
  <spec, instructions, program, form live here too>
```

SQLite instead of JSON is fine if preferred — same data model either way. Choose
whichever the coach finds easier to inspect by hand, since they'll want to eyeball the
data. Favor human-readable.

---

## 5. Build sequence (do this first; defer that)

Build in this order. Each step should produce something usable before moving on.

**Phase 1 — Durable core (build carefully)**
1. **Data model** — implement the spec §8 schema as the local files above. Include the
   visibility concept (§3.3) and both axes as separate fields (§3.1).
2. **Scoring engine** — implement spec §4 exactly: raw total → base tier → gates,
   gates lower-only. Store base tier, final tier, and gate-fired. Unit-test it against
   a handful of hand-worked examples from the spec before trusting it.
3. **Data entry** — a path to enter a completed paper field-form (§ companion file) as
   an assessment record. Include the coach's gut-call tier field (§3.7).

**Phase 2 — Program assembler**
4. **Movement library** — seed `movements.json` from the 4-day split, each movement
   tagged `min_tier` and a session slot (warm-up-base / funnel-linear / funnel-cod /
   jump / sprint / lift / cooldown). This is hand-curation work; do it with the coach.
5. **Assembler** — given an athlete's tier, generate a session that respects the fixed
   skeleton and the hard sequencing rule (§3.5). Output should resemble the 4-day
   program's session shape.

**Phase 3 — Dashboard (move fast, it's disposable)**
6. Roster overview: each athlete's current tier, last assessment date, **due for
   re-assessment** flag (4–6 wks), and any height-velocity flag.
7. Individual view: tier history over time, score trends per test, workout log.
8. **Validation view:** calculated tier vs coach gut-call across the roster, and a
   tally of which gates are firing how often. This is the feature-discovery and
   threshold-tuning surface.

**Phase 4 — Maturity axis (stub now, build later)**
9. Height-velocity calc from `height_log.json` → a dose-pullback flag near peak height
   velocity. Spec'd at concept level only; a simple stub flag is enough for v1. Keep it
   decoupled from tier (§3.1).

**Explicitly deferred (do NOT build yet):** athlete/parent-facing UI, accounts/auth,
cloud sync, multi-coach support, the consumer app itself, anything mobile. These belong
to build #2 and should be informed by what this tool teaches us — not pre-built.

---

## 6. How this feeds the future app (#2)

Keep these in view while building, because they're the whole point of doing #1 this way:

- The **dashboard is the feature-discovery engine.** As the coach uses it and hits "I
  wish it showed X," X becomes a real, real-world-validated feature request for the app.
  Worth keeping a running `FEATURE_IDEAS.md` that the coach (or Claude) appends to
  whenever a wish surfaces.
- The **data model + scoring engine transfer directly** — same code, new interface.
- The **validation log** answers the app's single biggest risk ("are the tiers
  actually right?") with real data before a line of app code is written.

---

## 7. Coaching guardrails the assembler must respect

Pulled forward from the persona instructions so they're not missed (but the instructions
file is authoritative — read it):

- Sprint / Jump / Lift is the non-negotiable chassis, every session, every tier.
- Within-session order: Jump → Sprint → Lift (highest-CNS work first).
- Warm-up = shared BASE + day-specific FUNNEL (Linear Speed or Change-of-Direction).
- Max-velocity sprint quality is protected — never downstream of a heavy plyo block.
- Strength-first on mechanics — don't over-coach form; let force production drive it.
- Plyos: all three planes, single-leg bias, contrast chains, programmed stick/catch.
- Trunk: rotation / anti-rotation bias, folded into lift days.
- Conditioning: low priority — sport provides it; don't program dedicated blocks by
  default.
- Default athlete: 8+, multiple seasons of organized sport, has a training base.
- Scale dose to biological maturity, not calendar age or skill.

---

## 8. Open questions to raise with the coach before/while building

- **Storage format:** JSON (max human-readability) or SQLite (max queryability)? Default
  to JSON unless the coach prefers otherwise.
- **Movement library scope for v1:** seed only from the 4-day split, or expand to cover
  all four tiers' simpler regressions up front? (Recommend: start from the split, add
  C/B regressions as the assembler needs them.)
- **Dashboard surface:** CLI tables, a simple local web page, or a notebook-style view?
  Pick by what the coach will actually open daily.
- **Gut-call capture:** does the coach want to enter their gut-call tier *before* seeing
  the calculated tier (cleaner validation data) or after (faster)? Before is better
  science; confirm they'll tolerate the extra step.

---

*End of brief. Implement from the spec; use this document for intent, sequencing, and
the design rationale that lives nowhere else.*
