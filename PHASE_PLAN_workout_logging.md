# Phase Plan — Per-Set Workout Logging & Progress Tracking

> Planning doc for the next phase of the Youth Coaching Command Center. Adds the ability to
> record what actually happened in a training session — per set, per exercise — with typed
> measurements (load, time, distance, reps, duration…), logged against the assembler's
> prescribed dose as the target, and surfaced as progress/PR trends over time.
>
> This is a plan, not an implementation. The central decision (typed metrics vs. sparse
> columns) is documented in full because getting it wrong is expensive to reverse.

---

## ✅ Decisions locked (from planning)

- **Granularity: per set.** Each set is its own record (set 1: 3 reps @ 40kg; set 2:
  3 @ 42.5kg). This is the biggest schema driver and it rules out any "one summary row per
  exercise" shortcut.
- **Prescription is the target; log actuals against it.** The assembler already generates a
  prescribed dose (sets/reps/rest per tier). The logger shows that as the target and records
  what actually happened. Logged values are *actuals*, explicitly related to — but
  independent of — the prescription.
- **Progress tracking is the point.** Not just a historical record — the goal is trends and
  PRs per exercise per athlete over time. This means the stored values must be *typed and
  comparable* (you can't chart "3 ea" against "40kg"), which forces the metric model below.

---

## 🧠 The central decision: typed metrics, NOT sparse columns

**The trap to avoid.** The tempting schema is to add fixed columns to the workout log —
`weight`, `time`, `distance`, `reps`, `duration` — and let each exercise fill in whichever
apply. **Do not do this.** The library spans measurement types that don't share a shape:

| Exercise kind | Naturally measured by |
|---|---|
| Lift (squat, hinge, push, pull) | load (kg/lb) × reps |
| Sprint (accel, max-velocity) | time (s); distance is usually fixed by the prescription |
| Jump (broad, vertical, bound) | distance or height (cm) — or sometimes just reps |
| Trunk / iso (plank, hollow hold) | duration (s) |
| Warm-up / cooldown | typically not logged at all |

Fixed columns produce a table that's mostly nulls, gives the UI no way to know which fields
are valid for which movement, can't express units (is this value seconds or kilograms?), and
requires a schema migration every time a new measurement matters (RPE, contact time, heart
rate). It also makes progress charts impossible to do correctly, because nothing tells the
chart that squat-load and plank-duration aren't the same axis.

**The right model — same discipline the rest of this project already uses.** The project's
recurring principle is *don't collapse things that answer different questions* (tier vs.
maturity; `min_tier` vs. `difficulty`). Measurement type is another such thing. So:

1. **Exercises declare their metrics.** Add a `metrics` field to the exercise definition in
   the library — the ordered list of what this movement is measured by. Each metric is a
   small typed descriptor:
   ```
   Metric = {
     id:    string        // stable, e.g. 'load', 'reps', 'time_s', 'distance_cm', 'duration_s'
     label: string        // 'Load', 'Reps', 'Time', 'Distance', 'Hold'
     unit:  string        // 'kg' | 'lb' | 's' | 'cm' | 'reps' | ...
     input: 'number' | 'integer' | 'duration'   // drives the form control + validation
     higherIsBetter: boolean   // load↑ good, sprint-time↓ good — drives PR direction
   }
   ```
   Examples: back squat → `[load, reps]`; broad jump → `[distance_cm]` (or `[distance_cm, reps]`);
   15yd sprint → `[time_s]`; plank → `[duration_s]`.

2. **A metric catalog is the single source of truth for units/direction.** Define the metric
   *types* once (a small `metrics.ts` or a section of `program.ts`), and have exercises
   reference metric ids rather than redefining unit/direction inline. This guarantees every
   squat logs load in the same unit and every sprint's PR direction (lower is better) is
   consistent — the same "define once, reference everywhere" move recommended for the
   `splitOf` accessor and the design tokens.

3. **Set records store `{metricId: value}` pairs**, not named columns:
   ```
   SetLogEntry = {
     setLogId, workoutId, athleteId, exerciseId,
     setIndex: number,                 // 1-based
     values: { [metricId: string]: number },   // e.g. { load: 42.5, reps: 3 }
     prescribed?: { sets?, reps?, rest_sec? },  // snapshot of the target at log time
     rpe?: number,                     // optional, if you want it later — additive
     note?: string,
     loggedAt: string,
   }
   ```
   Because values key off the exercise's declared metrics, the form renders exactly the right
   inputs with the right units, and validation is derivable (a `time_s` can't be negative, a
   `reps` is an integer). New metric types are additive — no migration.

**Why this is worth the extra structure now:** it's the difference between "add a column and
migrate" forever vs. "add a metric to the catalog" never-migrate. And it's the only model
that makes the stated goal — comparable trends and PRs per exercise — actually correct rather
than approximate.

---

## 🧩 Architecture: what changes, what doesn't

| Layer | Change |
|---|---|
| `engine/program.ts` (or new `engine/metrics.ts`) | **Durable core.** Add the `Metric` type + the metric catalog + `metrics` on `Exercise`. Pure, no I/O. |
| `library/exercise_library.json` | Add a `metrics` list to each *loggable* exercise (lift/sprint/jump/trunk). Warm-up/funnel/cooldown can declare none. Coach-authored data task. |
| `store/library.ts` | Validate `metrics` on load (every referenced metric id resolves in the catalog) — same loud-fail discipline as progression links. |
| `engine/types.ts` | Add `SetLogEntry` (durable — it's the app's schema too). |
| `store/json-store.ts` | New `set_log` collection. Reuse the safe write primitive from the write-surface phase. |
| `store/query.ts` | Read queries for an athlete's set-log, grouped by exercise/date; PR/trend derivations. |
| **A new `engine/progress.ts`** | **Durable core, pure.** Given an athlete's set-log for an exercise, compute PRs, best-per-session, and trend series. Belongs in the engine (it's app #2 logic too), takes data in, returns derived signals — never touches the store. |
| `dashboard/*` | The logging form (per set, pre-filled with prescription targets) + progress display on the athlete page. Disposable surface. |

**Boundary rule holds:** metric definitions and progress math live in `engine/*` (pure);
persistence and queries live in `store/*`; the form lives in `dashboard/*`. `engine/*` never
imports `store/*`. Progress computation is a pure function of set-log data, exactly like
`computeMaturity` is a pure function of the height log — follow that existing pattern.

---

## 🛠 Build sequence (dependency order)

### Phase A — Metric model in the durable core (do first; everything depends on it)
1. Define the `Metric` type + the metric catalog (`load`, `reps`, `time_s`, `distance_cm`,
   `duration_s`, plus room to grow).
2. Add `metrics: string[]` (metric ids) to the `Exercise` type in `program.ts`.
3. Add `metrics` data to each loggable exercise in `exercise_library.json`. This is
   coach-authored — you know which movements are load-based vs. time-based vs. distance-based.
   Warm-up/funnel/cooldown declare no metrics (not logged).
4. Extend `store/library.ts` validation: every exercise's `metrics` ids must resolve in the
   catalog; fail loudly on a typo. Add the test.

**Deliverable:** the library loads with typed metrics per exercise, validated. No UI yet.

### Phase B — Set-log persistence (depends on A + the write-surface primitive)
1. Add `SetLogEntry` to `engine/types.ts` and a `set_log` collection to the store.
2. Write path goes through the safe write primitive built in the write-surface phase (the
   in-process write queue) — logging is now another browser-sourced write.
3. Read queries in `store/query.ts`: an athlete's sets for an exercise over time; a session's
   sets grouped by exercise.

**Deliverable:** set records can be written and read back. Tested round-trip.

### Phase C — The logging form (depends on B; reuses the assembled-session shape)
1. On the athlete's plan view (the day tabs already built), each assembled exercise gets a
   "log" affordance. The form pre-fills the **prescribed** sets/reps/rest as the target and
   renders one row per prescribed set.
2. Each set row renders inputs **driven by that exercise's declared metrics** — a squat shows
   load + reps; a sprint shows time; a plank shows duration. The UI reads `metrics`; it does
   not hardcode which fields to show.
3. Log actuals against the target; allow adding/removing sets (athlete did an extra set, or
   cut one short). Server-side validation per metric type.
4. Snapshot the prescription onto the record at log time (`prescribed`) so later prescription
   changes don't rewrite history.

**Deliverable:** log a full exercise, per set, from the browser, against its prescription.

### Phase D — Progress & PRs (depends on B/C data existing; the stated goal)
1. `engine/progress.ts` (pure): per exercise per athlete, compute PRs (using each metric's
   `higherIsBetter` for direction — load↑, sprint-time↓), best-per-session, and a trend
   series.
2. Surface on the athlete page: per-exercise trend (e.g. squat load over time, sprint time
   over time), PR highlights, "last time you did this: X" shown *in the logging form* so the
   coach sees the target to beat.
3. Respect the coach-only visibility posture — this is coach-facing data; an athlete surface
   (if ever built) filters per `isVisibleTo`.

**Deliverable:** progress trends and PRs per exercise; "last time / PR" context shown while
logging.

---

## ⚡ Performance + reliability notes

- **Set-log is the first collection that grows unbounded.** Every athlete × every session ×
  every exercise × every set. Still small in absolute terms (a few dozen athletes, a season),
  but it's the first table where "read the whole JSON array on every request" could eventually
  feel it. Not a v1 problem — but it's the collection most likely to motivate the eventual
  move off flat JSON, so note it in `FEATURE_IDEAS.md` as the canary for a real datastore.
- **PR/trend computation is pure and cheap** at this scale — compute on read, don't
  pre-materialize or cache. (Consistent with the project's "don't cache prematurely" posture.)
- **Snapshot the prescription** onto each set record. If you instead join back to the live
  assembler output at read time, a future library edit silently rewrites what the athlete
  "was prescribed" months ago. Store the target as it was.
- **Units are a correctness surface.** Decide kg vs. lb once (a coach-level setting or a
  per-metric fixed unit) and store canonically. Mixing units in one metric's history breaks
  every trend silently. Recommend: fix a canonical unit per metric in the catalog; convert at
  display if ever needed, never at storage.

## 🧪 Testing plan

- **Phase A:** library validation rejects an unresolvable metric id; every loggable slot has
  metrics, warm-up/cooldown don't.
- **Phase B:** set-log round-trip; concurrent writes don't lose sets (reuses the write-queue
  test).
- **Phase C:** form renders the correct inputs per exercise (squat→load+reps, sprint→time,
  plank→duration) purely from `metrics`; server-side validation rejects a negative time / a
  non-integer rep count; prescription snapshot is stored, not joined live.
- **Phase D:** PR direction is correct per metric (`higherIsBetter` — a *lower* sprint time is
  a PR; a *higher* squat load is a PR); trend series orders correctly; an exercise with one
  data point degrades gracefully (no trend yet), mirroring the maturity "needs two entries"
  pattern.

## 📌 Open items to confirm before building

1. **Units:** kg or lb (or coach-configurable)? Fix a canonical storage unit per metric
   before Phase A data authoring.
2. **Which exercises are loggable, and with which metrics?** This is coach-authored data
   (Phase A step 3) — you know the movements. A quick pass tagging each lift/sprint/jump/trunk
   with its metric list is the one blocking data task.
3. **RPE / subjective load now or later?** The `SetLogEntry.rpe?` field is additive — safe to
   defer, but decide if you want it in the Phase C form or as a later add.
4. **Do warm-up/funnel/cooldown ever get logged?** Assumed no (they declare no metrics). Confirm.

## Suggested handoff order to Claude Code

1. Phase A (metric model + library data) — durable core, blocks everything.
2. Phase B (set-log persistence) — needs the write-surface primitive already built.
3. Phase C (logging form) — the daily-use win.
4. Phase D (progress/PRs) — the stated goal, needs data from B/C to exist first.
