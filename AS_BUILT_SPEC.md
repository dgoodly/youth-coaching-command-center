# As-Built Spec — Youth Coaching Command Center

> **What this is:** a description of the system **as actually implemented in this repo**, as of
> 2026-07-03. It is the counterpart to the design docs (`BUILD_BRIEF.md`, `Youth_Tiering_Assessment_Spec.md`,
> `COACHING_INSTRUCTIONS.md`, `EXERCISE_LIBRARY.md`, `Field_Form_Data_Contract.md`), which state
> *intent*. Where a design doc and the code disagree, **the code wins and this doc records the code.**
> Section references like "spec §4" point back into those design docs.

---

## 1. What it is

A local, single-coach command center for youth athletic development. It:

1. Tracks a small roster of athletes (a few dozen max).
2. Ingests a completed paper assessment (six movement-quality tests) and computes a
   non-user-facing **tier** (C/B/A/S).
3. Assembles a tier-appropriate 4-day training session from a tagged exercise library,
   enforcing the coach's hard sequencing rules.
4. Tracks growth (a height log → maturity / PHV signal) and rotation state (training blocks),
   and surfaces everything on a read-only dashboard — including a **validation view** that
   compares the computed tier to the coach's gut-call for threshold tuning.

**Two independent axes, never collapsed** (spec §3.1):
- **Tier** (from the assessment) governs *movement selection / risk*.
- **Maturity** (from the height log) governs *dose* only, and must never change the tier.

**Two-audience visibility** (spec §3.3): tiers and raw scores are coach-only; an athlete/parent
surface would filter to improvement-framed feedback. This is baked into the type layer
(`Audience`, `COACH_ONLY_FIELDS`, `isVisibleTo`) so it can't be retrofitted later.

---

## 2. Architecture: durable core vs disposable surface

The central design constraint (`BUILD_BRIEF.md` §1): the **durable core** is built clean so it
transfers unchanged into a future app; the **surface** (CLIs, dashboard, JSON store) is disposable.

| Layer | Directory | Durable? | Depends on |
|---|---|---|---|
| Data model + types | `engine/types.ts` | **Durable core** | nothing |
| Scoring engine | `engine/scoring.ts` | **Durable core** | types |
| Maturity axis | `engine/maturity.ts` | **Durable core** | types |
| Volume guardrails | `engine/guardrails.ts` | **Durable core** | (none) |
| Library schema + dose helpers | `engine/program.ts` | **Durable core** | types |
| Program assembler | `engine/assembler.ts` | **Durable core** | program, types |
| Field-form ingest | `store/ingest.ts` | core logic, store I/O | engine + json-store |
| Rotation / block state | `store/blocks.ts` | core logic, store I/O | program + json-store |
| JSON persistence | `store/json-store.ts` | **Disposable** | types |
| Library / template loaders | `store/library.ts` | **Disposable** | program, types |
| Read queries | `store/query.ts` | **Disposable** | types + json-store |
| Store doctor (gap scan) | `store/doctor.ts` | **Disposable** | types |
| Athlete CRUD | `store/athletes.ts` | **Disposable** | types + json-store |
| Data-entry CLI | `cli/enter-assessment.ts` | **Disposable** | ingest + athletes |
| Session-builder CLI | `cli/build-session.ts` | **Disposable** | assembler + store |
| Data-doctor CLI | `cli/doctor.ts` | **Disposable** | doctor + json-store |
| Dashboard (HTTP + render) | `dashboard/*.ts` | **Disposable** | query + engine |

**Rule enforced by imports:** production engine code depends only on `engine/*`; it never imports
`store/*` (the shared `equipmentAvailable` helper lives in `engine/program.ts`, not the store). A
test (`engine/boundary.test.ts`) scans the engine source and fails if any non-test file imports
`store`/`cli`/`dashboard`, so the boundary is enforced, not just documented. This is what lets the
engine drop into the future app untouched.

**Runtime:** Node ≥ 22, TypeScript run directly via `--experimental-strip-types` (no build step).
ES modules, `.ts` import specifiers. Zero runtime dependencies; dev-deps are only `typescript`
and `@types/node`.

---

## 3. Data model (`engine/types.ts`)

The schema is build #1's schema *and* the future app's schema, so it carries full validation
provenance.

- **`Tier`** = `'C' | 'B' | 'A' | 'S'`, ranked `C(0) < B(1) < A(2) < S(3)` (`TIER_RANK`). Stages:
  C Foundational · B Developing · A Proficient · S Advanced.
- **`Scores`** — the six tests in fixed contract order: `squat, dropStick, balance, pushup,
  broad, pogo`, each a `TestScore` (integer 0–3). `SCORE_KEYS` is the canonical order; do not reorder.
- **`GateFired`** = `'none' | 'capC' | 'capA' | 'S->A'` — which hard gate lowered the tier
  (stored for validation).
- **`Assessment`** — one record: ids, date, tester, the six scores, recomputed
  `rawTotal / baseTier / finalTier / gateFired`, `coachGutCall`, `heightCm`, `videoRefs`, `notes`,
  and optional `paperMismatch` provenance (only present when hand-written paper values disagreed
  with the recompute).
- **`AthleteProfile`** — id, displayName, dob (age derived), `sex` (`'M' | 'F' | null`, for the
  maturity estimate only), sports, `trainingMonths` (context, not a scored point), `valgusWatch`
  (drives assembler valgus priority), `weeklySportHours` / `weeklyTrainingHours` / `restDaysPerWeek`
  (optional, feed the volume guardrails), createdAt, notes.
- **`HeightLogEntry`** — `{athleteId, date, heightCm, sittingHeightCm?, source: 'assessment' |
  'manual'}`. Feeds the maturity axis; assessment-supplied heights (standing + optional sitting)
  are dual-written here with `source: 'assessment'`.
- **`WellnessLogEntry`** — `{athleteId, date, sleepHours?, soreness?, energy?, notes?}`. Brief
  weekly load/growth check (all fields optional).
- **`BlockState`** — per-athlete rotation state: `blockStartDate`, `blockIndex` (0-based),
  `slotVariants` (map of `"<day>:<slot>:<index>"` → exerciseId).
- **`WorkoutLogEntry`** — a served session snapshot: `servedForTier`, `sessionLabel`, `completed`,
  `coachNotes`.
- **Visibility** — `Audience = 'coach' | 'athlete'`, `COACH_ONLY_FIELDS`
  (`rawTotal, baseTier, finalTier, gateFired, coachGutCall, scores`), and `isVisibleTo(field, audience)`.
- **Guards** — `isTestScore`, `isTier`.

---

## 4. Scoring engine (`engine/scoring.ts`) — spec §4

Pure functions, no I/O. Assessment → tier in two steps:

**Step 1 — base tier from the raw-total bands** (`baseTierFromRaw`), max raw = 18:

| Raw total | Base tier |
|---|---|
| 17–18 | S |
| 13–16 | A |
| 8–12 | B |
| 0–7 | C |

**Step 2 — hard gates that can only *lower* the tier** (`assignTier`), applied in order:

1. **capC** — `squat < 2` **OR** `dropStick < 2` → capped at C (foundational control missing).
2. **capA** — else if `dropStick === 2` → capped at A (single-leg landing not solid enough for S).
3. **S→A** — if still S but `dropStick < 3` → drop to A (S demands a perfect stick).

The design principle (`BUILD_BRIEF.md` §3.2): **landing integrity is *the* gate.** A powerful,
well-balanced athlete who cannot control landings is routed **down**, not up. Output never
outranks movement control in a youth long-term-development model.

`assignTier` returns full provenance `{rawTotal, baseTier, finalTier, gateFired}`. Invariants
proven by the tests (all 4096 score combinations): gates never *raise* the tier; `gateFired ===
'none'` iff `finalTier === baseTier`; final S only when `dropStick === 3`; `squat < 2 OR dropStick
< 2 ⟹ finalTier === C`.

---

## 5. Maturity axis (`engine/maturity.ts`) — spec §7

Pure function of the height log + optional profile inputs; governs **dose only**, never tier.
`computeMaturity(entries, { dob?, sex? })` returns two complementary, tier-independent signals:

- **Height velocity** — from the **two most recent** entries (cm / year, 365.25-day year). Needs
  ≥ 2 entries; degrades gracefully (distinct notes) for 0 entries, 1 entry, or two entries sharing
  a date. **`PHV_FLAG_CM_PER_YEAR = 7`** — at/above this, `nearPHV` is true → the note prescribes a
  **dose pullback** (trim volume, conservative loading, extra landing emphasis), explicitly *not* a
  tier change. Reasoned default, not validated (see `FEATURE_IDEAS.md`).
- **Maturity-offset estimate** — the **Moore/Fransen (2015)** equations (preferred over the older
  Mirwald), sex-specific: boys use sitting height, girls use standing height, both × decimal age at
  measurement. Returns `maturityOffsetYears` (years from PHV, − = pre), `estimatedAgeAtPHV`,
  `phvBand` (`pre` < −1yr · `circa` ±1yr · `post` > +1yr), and `method`. Null (with a reason in
  `method`) when sex, DOB, or — for boys — sitting height is missing. Population estimate, not
  precision; the `circa` band is the spurt window where dose eases and coordination dips.

**Volume guardrails** (`engine/guardrails.ts`, also pure/durable) make the coach's anti-overuse
stance checkable: `checkVolumeGuardrails({ age, weeklySportHours, weeklyTrainingHours,
restDaysPerWeek })` returns per-rule findings (`ok`/`watch`/`exceeded`/`unknown`) for three rules —
total weekly sport+training hours ≤ age; intense organized sport < `INTENSE_SPORT_HOURS_CAP` (16
h/week); ≥ 1–2 rest days/week — plus `anyExceeded`/`anyWatch` roll-ups. Advisory (flags, never
blocks); missing inputs yield `unknown`, not a false pass. Surfaced on the dashboard (roster "Load"
badge + an athlete-page findings table).

---

## 6. Exercise library (`library/exercise_library.json`, schema in `engine/program.ts`)

The library is the single tagged source the assembler draws from. **127 exercises**, **34
variation families**, across **9 slots**:

| Slot | Count |
|---|---|
| warmup_base | 14 |
| funnel_linear | 7 |
| funnel_cod | 8 |
| jump | 33 |
| sprint | 14 |
| lift | 29 |
| trunk | 9 |
| motor_skill | 6 |
| cooldown | 7 |

**Per-exercise schema** (`Exercise`): `id, name, slot, pattern, plane, laterality, min_tier,
difficulty, variation_family, stick, valgus_relevant, equipment[], dose, cue, progression_to,
regression_to, notes`.

**Two independent ratings, kept separate** (EXERCISE_LIBRARY.md §1):
- **`min_tier`** (C/B/A/S) — the *safety / competency gate*: is the athlete cleared for this movement?
- **`difficulty`** (1–10) — *inherent demand*, used for session load-balancing and progression order.

**Dose** is either `{ all: "..." }` (warm-up / funnel / cooldown — scaled by trimming) or a
per-tier map `{C,B,A,S: {sets, reps, rest_sec}}`. **Two independent availability conditions**
(`isAvailableAtTier`): the tier must meet `min_tier`, **and** for per-tier doses the tier must not
be **0-set** (`sets: 0` = "not prescribed at this tier", distinct from the gate).

**Rotation families** — every exercise belongs to a `variation_family` whose members train the
same job in the same slot and are swappable; `progression_to` / `regression_to` link the
difficulty chain (all links validated to resolve at load).

**Loader/validation** (`store/library.ts`): light structural validation on load (unique ids, valid
enums, difficulty 1–10, present variation_family + dose + equipment array, resolvable progression
links) so a hand-edited library fails loudly; it also **warns** (not fails) on a
`progression_to`/`regression_to` link that crosses a `variation_family` (which would silently break
rotation stability). Not cached — a JSON edit takes effect on the next load, no restart. Overridable
via `CC_LIBRARY_FILE`, `CC_DAY_TEMPLATES_FILE`, `CC_EQUIPMENT_CONFIG` env vars.

**Dose rendering** (`doseLabel`) is robust to imperfect data: blank reps render "sub-max"
(e.g. pull-up volume), non-numeric rest is dropped.

---

## 7. Day templates (`library/day-templates.json`) — the 4-day split

Each template is a tier-shared, sequencing-safe recipe. Slots `jump/sprint/lift/trunk/motor_skill`
are filled from **pools of variation families** (`SlotFill = string[]`); within a block the fill uses
`pool[blockIndex % pool.length]`, and multi-family pools (used for trunk) cycle biases across blocks.
Each day's `motor_skill` pool rotates enrichment families across the week (Day 1 throw/catch,
Day 2 locomotor, Day 3 rotational, Day 4 all three) so breadth accumulates.

| Day | Label | Emphasis | Sprint | Jump ceiling |
|---|---|---|---|---|
| 1 | Max Velocity + Lower Strength | linear-speed | max_velocity | **5** (binding) |
| 2 | Plyo Density / Single-Leg + Upper | linear-speed (short funnel) | acceleration | null |
| 3 | Acceleration / Multidirectional + Posterior | change-of-direction | accel + CoD | null |
| 4 | Lateral & Rotational Power + Total | change-of-direction | reactive | null |

Day 1 is the only max-velocity day, so it is the only day with a binding **summed-jump-difficulty
ceiling** (see §8).

---

## 8. Program assembler (`engine/assembler.ts`) — EXERCISE_LIBRARY.md §3–§4

Pure: caller supplies exercises, template, equipment, and block state; it returns the assembled
session plus the (possibly updated) `slotVariants`. `assembleSession` builds the fixed skeleton:

**warm-up base → funnel (exactly one, by emphasis) → Jump → Sprint → Lift → Trunk → Motor-skill → cooldown.**

- **Warm-up base, funnel, cooldown** are not family-rotated — they include all tier-available
  drills (`fixedSlotItems`). The linear funnel trims to 3 drills in `funnel_mode: short` (Day 2).
- **Jump / Sprint / Lift / Trunk / Motor-skill** each fill from their pools via **`selectFill`**
  (§3 steps 1–6). `motor_skill` is general enrichment (throw/catch, rotational, locomotor) programmed
  on every day (COACHING_INSTRUCTIONS "MOTOR-SKILL BREADTH"), folded in after trunk; its pool is
  optional per template and absent pools yield no block:
  1. gate by tier (`isAvailableAtTier`);
  2. filter to available equipment;
  3. choose the family from the pool by block index, **with graceful fallback** to the next pool
     family if the preferred one has no member at this tier (so multi-family trunk pools degrade
     instead of omitting);
  4. keep the existing in-block variant if still valid (block stability);
  5. otherwise entry-select by difficulty target — **band-floor** (lowest member ≥ the tier band's
     low end, so advanced athletes start near their level) for most slots, or **globally-lowest**
     for jumps on a ceilinged day (keep the runs fresh);
  6. **valgus priority** — near the target floor, prefer a `stick` option, then `valgus_relevant`.
- **Difficulty balance** is **advisory** — a note fires if more than half the main-work items fall
  outside the tier's band (`DIFFICULTY_BAND`: C 1–3, B 2–4, A 4–6, S 5–8); the assembler does not
  force a rebalance in v1.
- **Realized sprint emphasis** may regress: if the template wants max-velocity but no max-velocity
  sprint is available at the tier (e.g. C), it downgrades to acceleration with a note.

**The hard sequencing rule** (`assertSequencingRule`) — the coach's protected invariant: on a day
carrying a **max-velocity** sprint, the day's **summed jump difficulty** must not exceed the
template's ceiling. Since Jump precedes Sprint, a breach means max-velocity work sits downstream of
too much accumulated plyo. **The assembler throws rather than silently reorder** — a breach means
the template/library is misconfigured. Proven by tests across every tier × day, plus an explicit
throw test and the ceiling-protection-during-rotation test.

---

## 9. Rotation / block state (`store/blocks.ts`) — EXERCISE_LIBRARY.md §4

A training block is **`BLOCK_WEEKS = 9`** weeks (tunable). Within a block, sessions reuse the
stored `slotVariants`; at a boundary the coach rotates deliberately.

- `getOrInitBlockState` → existing state or a fresh block-0.
- `dueForRotation` → true at ≥ 9 weeks since `blockStartDate`.
- `advanceVariant` (pure) — prefers `progression_to` if available at the tier; else a same-family
  lateral swap at nearest difficulty; else keeps current. **On a ceilinged (max-velocity) jump
  fill, never advances above current difficulty** (protects the runs).
- `rotateBlockState` (pure) — increments `blockIndex`, resets the start date, and advances every
  stored variant (jump fills on ceiling days flagged so they don't climb). Multi-family trunk pools
  cross-rotate automatically via the new block index at the next assembly.

---

## 10. Persistence (`store/json-store.ts`)

Plain JSON files under `/data`, one per collection, each an array — chosen for hand-readability
(the coach can open and edit any record). Full read/rewrite per change is fine at this scale.

- Collections: `athletes, assessments, height_log, wellness_log, workout_log, block_state`.
- `readCollection` returns `[]` if the file is missing/empty (first run).
- `writeCollection` pretty-prints (2-space) and **atomically renames** a temp file into place so a
  crash mid-write can't corrupt the live file.
- `append` = read → push → write.
- `DATA_DIR` overridable via `CC_DATA_DIR` (used by tests to isolate).

**Atomicity across collections:** a single `writeCollection` is atomic (temp-file rename), but a
multi-collection operation is not. `saveAssessment` appends the assessment and the height-log entry
in two independent writes — a crash between them can leave an assessment with no matching height
entry, silently under-feeding the maturity axis. This is **detectable and recoverable** rather than
prevented: `npm run doctor` scans for assessments whose height never reached the height log, and
`npm run doctor -- --fix` backfills them (`store/doctor.ts`).

**Concurrency:** the store assumes a **single writer at a time** (one coach, one CLI/dashboard
process). `append`/`writeCollection` do read-modify-write with no locking — concurrent writers can
race and lose an update (they can't *corrupt* a file; the atomic rename still prevents torn writes).
This is fine for v1's usage. App #2, if it introduces any second writer (a second device, a sync
process, a web client with write endpoints), needs a real transactional datastore or an explicit
locking/queueing layer before this assumption can be relied on.

**Privacy:** `/data/*.json` is git-ignored (real roster data is private); only `/data/samples/`
and `.gitkeep` are tracked. `data/samples/assessment_form.example.json` is the batch-ingest template.

---

## 11. CLIs

**`npm run enter`** (`cli/enter-assessment.ts`) — transcribe a paper field form into a stored
assessment. Interactive mode captures the coach's **gut-call before revealing** the computed tier
(clean validation data, §3.7), applies the Test-5 CAP rule, cross-checks optional paper-written
values, then computes/reveals/saves. Batch mode: `npm run enter -- --json <path>` (shape =
`FieldFormInput` + optional `displayName`/`valgusWatch` to create a new athlete). On save it
dual-writes the height entry and prints the suggested re-assessment date (+5 weeks).

**`npm run session`** (`cli/build-session.ts`) — assemble and print a session:
- `--tier A --day 1` — ad-hoc by tier.
- `--athlete "Maya" --day 2` — tier from the latest assessment; uses/persists block state; warns
  if due to rotate.
- `--athlete <id> --day 3 --log` — also append to `workout_log`.
- `--athlete <id> --rotate` — advance to the next training block.
- `--equip none,box` — override available equipment for the run.
Printed shape resembles the reference program; tier is labeled coach-only.

**`npm run wellness`** (`cli/log-wellness.ts`) — record a brief weekly wellness check
(sleep / soreness / energy / notes) for an athlete. Interactive or `-- --json <path>` batch.

**`npm run doctor`** (`cli/doctor.ts`) — scan the store for data-integrity gaps (v1: assessments
whose `heightCm` never reached the height log). Report-only by default; `-- --fix` backfills the
missing height-log entries. Scan logic is pure (`store/doctor.ts`).

---

## 12. Dashboard (`dashboard/server.ts`, `dashboard/render.ts`)

Plain `node:http`, no deps, server-rendered HTML read live from the JSON store. Launched via
`npm run dashboard` → **http://localhost:5173** (port overridable via `CC_DASHBOARD_PORT`; a
`.claude/launch.json` config registers it for the preview tooling). Three views:

- **`/`** Roster — per athlete: tier badge, age, last-assessment date, re-assess flag (fires at
  ≥ 6 weeks / 42 days), height velocity (PHV-flagged), a volume-guardrail "Load" badge, current block.
- **`/athlete?id=`** Individual — maturity estimate + standing/sitting height log, wellness log,
  training-load guardrail findings, the athlete's **current plan** (tier-scoped, from
  `library/plans.json` — A: 3-day 1·2·4, C: 2-day 1·2; other tiers fall back to the full split)
  rendered as instant client-side day tabs (Day 1 default, no reload) where each day is the fully
  assembled session for that day, tier history (raw / base / final / gate / gut-call), per-test
  score trends, workout log.
- **`/validation`** — the threshold-tuning surface: calculated tier vs coach gut-call with an
  agreement %, a per-assessment match/DIFFERS table, and a gate-firing tally. This is where the
  score bands and gate thresholds get tuned against real athletes.

---

## 13. Tests

`npm test` runs the Node built-in test runner over `engine/**/*.test.ts` and `store/**/*.test.ts`
via `--experimental-strip-types`. **93 tests, all passing.** Coverage:

- **`engine/scoring.test.ts`** — band boundaries, every gate, and exhaustive invariants over all
  4096 score combinations (incl. the `S->A`-gate unreachability invariant).
- **`engine/assembler.test.ts`** — sequencing rule across every tier × day, skeleton order, one
  funnel per emphasis, Day-1 jump-ceiling protection, valgus priority, band-floor entry, block
  stability, rotation/progression, the misconfig throw, family-scoped variant selection, and the
  motor-skill enrichment block (present every day, placed after trunk / before cooldown).
- **`engine/maturity.test.ts`** — velocity from the two most recent entries, PHV threshold, edge
  cases, and the Moore/Fransen maturity-offset estimate (pre/circa/post bands, sex-specific inputs,
  graceful null when inputs are missing).
- **`engine/guardrails.test.ts`** — the three volume guardrails (hours-vs-age, intense-sport cap,
  rest days) across ok/watch/exceeded/unknown, and the report roll-ups.
- **`store/ingest.test.ts`** — recompute-as-source-of-truth, CAP rule, paper-mismatch surfacing,
  height dual-write, gut-call passthrough, validation errors, re-assessment date.
- **`store/library.test.ts`** — the real library loads/validates (127 exercises, 9 slots, links
  resolve, no cross-family links), the two availability conditions, equipment filter, family
  grouping, every slot populatable at C, the cross-family warning, no-stale-cache re-reads, the
  flying-sprint distance guard (no sprint dose ≥ 40 yd), and the tier-scoped workout plans
  (valid days, A=1·2·4 / C=1·2).
- **`store/doctor.test.ts`** — height-log gap detection, matching, null-height skip, backfill.
- **`store/query.test.ts`** — `resolveAthleteIn` found/not_found/ambiguous resolution.

---

## 14. Configuration & environment

- `config/equipment.json` — single global inventory the assembler filters against; v1 seeds all 14
  equipment types (`none` always implicit). Trim to the coach's real setup.
- Env overrides: `CC_DATA_DIR`, `CC_LIBRARY_FILE`, `CC_DAY_TEMPLATES_FILE`, `CC_EQUIPMENT_CONFIG`,
  `CC_DASHBOARD_PORT`.
- `npm run typecheck` — `tsc --noEmit`.

---

## 15. Not built yet (deferred by design)

- **Athlete-facing surface.** The `Audience` split exists in types, but only the coach dashboard is
  built; no athlete/parent view yet.
- **Active difficulty rebalancing.** Difficulty balance is advisory only (§8).
- **Maturity-weighted motor-skill volume.** The `motor_skill` slot is programmed every session, but
  the "weight enrichment heavier pre-PHV" nuance isn't wired — the assembler selects on tier, not
  maturity. Volume is tier-scaled only; maturity-weighting is a follow-up once maturity feeds the assembler.
- **Funnel/cooldown rotation.** Warm-up base, funnels, and cooldown include all tier-available
  drills; they are not family-rotated in v1.
- **Richer maturity signals.** Sitting height + the Moore/Fransen maturity-offset estimate are now
  in; weight/shoe-size trend and Khamis-Roche (%-predicted-adult-height, needs parental heights) remain future enrichment.
- **Video refs.** `videoRefs` is stored but nothing captures/plays clips yet.
- **Remaining C-tier library gaps.** `resisted_sprint`, `transition_sprint`, and `sled` still omit
  C athletes on some days (`depth_contrast` is A/S-only by design). See `FEATURE_IDEAS.md`.
- **Unvalidated defaults.** All score bands, gate thresholds, difficulty ratings, the Day-1 jump
  ceiling (5), block length (9 wks), re-assess cadence, and the PHV trigger (7 cm/yr) are reasoned
  defaults awaiting real-athlete validation — the validation dashboard is the tuning surface.

---

*Companion docs: `BUILD_BRIEF.md` (intent & phasing), `Youth_Tiering_Assessment_Spec.md`
(assessment/scoring), `COACHING_INSTRUCTIONS.md` (coaching rules), `EXERCISE_LIBRARY.md`
(library/rotation model), `Field_Form_Data_Contract.md` (paper→data), `FEATURE_IDEAS.md`
(tunables & wishes).*
