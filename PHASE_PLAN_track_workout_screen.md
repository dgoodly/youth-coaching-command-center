# Phase Plan — Separate the Plan View from a Dedicated Track-Workout Screen

> Splits the currently-merged "view plan + log inline" interaction into two distinct UX
> paths: (1) the athlete detail page's plan view becomes **read-only reference** (no logging),
> and (2) a new **Track workout** screen becomes the live, field-logging surface the coach
> uses alongside the athlete in real time. Builds directly on the Phase A–D logging work
> already merged into `main`.
>
> A plan, not an implementation. Hand to Claude Code screen by screen.

---

## ✅ Decisions locked (from planning)

- **Plan view goes read-only.** Remove the inline `LOG ›` buttons from the athlete detail
  page's day-tab plan view (the ones on Linear Pogo, Vertical Jump, Flying Sprint, the lifts,
  Pallof Press in the current screenshots). That view is for *reviewing* the prescription, not
  entering data. The day tabs stay; only the logging affordance leaves.
- **New "Track workout" button** joins "Enter assessment" and "Edit athlete" in the athlete
  detail action row. It opens the dedicated logging screen.
- **Track-workout default day = the next day in the split after the athlete's most recent
  logged session, wrapping around** (Day 2 → Day 1 on a 2-day split). The coach can still pick
  any other day. This is a *history lookup*, not "always Day 1."
- **Save-as-you-go.** Each set persists immediately on entry — a closed tab or dead phone
  mid-workout leaves a real, resumable session. This means the `WorkoutLogEntry` is
  **create-or-find'd up front** when the screen opens (status: in-progress), so sets have a
  parent to attach to.
- **In-progress sessions are visible**, not hidden. A half-logged session shows an "in
  progress" state somewhere the coach can find and resume it (see §UI).
- **Pre-fill every metric with the athlete's last logged value for that exact exercise+metric**
  — weight, time, reps, ball weight, all of it. Not the prescription; the *history*. The point
  is "here's what you did last time" without digging through the log.
- **First-time-ever pre-fills to 0 (for load) / blank, with a subtle "first time — no prior
  data" hint** so the 0 reads as "unknown," not "lifted zero."

---

## 🧠 The core reframing: reference surface vs. field tool

The current page conflates two jobs that want opposite designs. **Reviewing a plan** is a
scan-and-read task — dense, complete, every exercise visible, no interaction. **Logging a
session** is a do-one-thing-at-a-time task — focused, sequential, input-heavy, used on a phone
while watching an athlete. Cramming `LOG ›` buttons into the reference view serves neither well.

Splitting them means:
- The plan view can stay the dense reference table it already is — just without the buttons.
- The track screen can be designed *for the field*: big inputs, one exercise in focus at a
  time, pre-filled with last time's numbers, saving as it goes.

This is the same "don't collapse things that answer different questions" discipline the whole
project runs on — here applied to *interaction surfaces*, not data fields.

---

## 🧩 Architecture: what changes, what doesn't

| Layer | Change |
|---|---|
| `engine/progress.ts` | **Durable core.** Add a `lastLoggedValue(athleteId, exerciseId, metricId)` lookup (most-recent set value per exercise+metric). This is the pre-fill source and it's the same history query the PR/trend feature already needs. Pure; reads data passed in, returns values. |
| `engine/assembler.ts` | **No change.** The track screen assembles the chosen day exactly as the plan view does. |
| `store/query.ts` | Add: resolve "next day in split after most recent logged session"; find in-progress session for an athlete. |
| `store/json-store.ts` | No new primitive — reuse `runExclusive` for the create-or-find + per-set writes. |
| `dashboard/server.ts` | Remove inline log buttons from the plan view render path. Add routes: `GET /athlete/track?id=&day=` (the screen), `POST /athlete/track/set` (persist one set). |
| `dashboard/render.ts` | Remove `LOG ›` from the plan-view exercise rows. Add the track-screen render (per-exercise input fields driven by each exercise's `metrics`). |

**Boundary rule holds:** the "last logged value" and "next day" logic lives in
`engine/*`/`store/*` as pure/query functions; the screen is `dashboard/*`. `engine/*` never
imports `store/*`. Pre-fill values are computed server-side and rendered into the form — the
client never computes them.

---

## 🛠 Build sequence

### Step 1 — Strip logging from the plan view (small, do first)
Remove the `LOG ›` buttons from the athlete detail day-tab plan view. It becomes pure
read-only reference. This is a subtraction — quick, and it cleanly separates the two paths
before the new screen is built, so there's never a moment where logging lives in two places.

### Step 2 — "Track workout" entry point
Add the **Track workout** button to the athlete detail action row (next to "Enter assessment"
/ "Edit athlete"). It links to `GET /athlete/track?id=<id>` with no day param — the screen
resolves the default day itself (Step 3).

### Step 3 — Default-day resolution (the "next day" logic)
In `store/query.ts`: given an athlete, find their most recent `WorkoutLogEntry`, read which
day it was, and return the next day in their *current split* (wrapping at the end). Edge cases:
- **No prior sessions** → default to Day 1.
- **Split changed since last session** (e.g. they were on 3-day, now on 2-day) → clamp to a
  valid day in the current split; don't return a day that no longer exists.
- **An in-progress session already exists** → open *that* session's day rather than advancing
  past it (you don't skip a workout you haven't finished).

### Step 4 — Session create-or-find on screen open
When `GET /athlete/track` loads, create-or-find the `WorkoutLogEntry` for (athlete, day,
today) inside `runExclusive` — status **in-progress**. If one already exists for today+day,
resume it (load its already-logged sets). This is the up-front session creation that
save-as-you-go requires. Reuse the create-or-find pattern from the merged logging work; do not
write a second one.

### Step 5 — The field-logging screen (the core deliverable)
Render the chosen day's assembled session, but instead of read-only rows, each **trackable**
exercise (the ones with `metrics` — lifts, sprints, jumps, trunk, the two med-ball throws)
gets input fields:
- **One row per prescribed set** (a `3 × 6` lift renders 3 set-rows), each with an input per
  metric the exercise declares (a squat: load + reps; a sprint: time; a med-ball throw: load).
- **Inputs pre-filled from history** via `lastLoggedValue` — last time's value for that exact
  exercise+metric. First-time-ever → 0 (load) / blank, with a small **"first time — no prior
  data"** hint on that exercise.
- **Non-trackable slots** (warm-up, funnel, cooldown, and the non-logged motor-skill drills)
  render as plain read-only reference rows — same as the plan view. The coach sees the full
  session; only the metric-bearing movements have inputs.
- **Each set persists on entry** (`POST /athlete/track/set`, one set at a time, through
  `runExclusive`) — a blur/change on an input writes that set. Show a lightweight "saved"
  affordance so the coach trusts it landed.
- **Add/remove set** per exercise (athlete did an extra set, or cut one) — the prescribed count
  is the starting point, not a cap.
- **Snapshot the prescription** onto each set record at write time (per the logging phase's
  rule) so later library edits don't rewrite history.
- **Respect 0-set tier gating**: a movement not prescribed at this athlete's tier never appears
  as a trackable row (same `isAvailableAtTier` rule the assembler uses).

### Step 6 — In-progress visibility + finish
- An in-progress session surfaces on the athlete detail page (and optionally the roster) as an
  **"in progress" state** with a resume link back into the track screen — so a half-logged
  session isn't lost or invisible.
- An explicit **"Finish session"** action flips the session `completed` (per the earlier
  decision that `completed` means *explicitly marked done*, not *first set logged*). Until
  then it reads as in-progress even with sets logged.

---

## ⚡ Performance + reliability notes

- **`lastLoggedValue` is a per-exercise-per-metric history scan** — cheap at this data scale;
  compute on load, don't cache. It's the same read the progress feature does.
- **Save-as-you-go multiplies write frequency.** Every set is now its own POST + `runExclusive`
  cycle. Fine at one-coach scale, but it makes the set-log the busiest write path in the
  system — reinforces the earlier note that set-log is the canary collection for eventually
  outgrowing flat JSON. Not a v1 problem; worth the `FEATURE_IDEAS.md` line.
- **The up-front session creation must be idempotent.** Opening the track screen twice (two
  tabs, a refresh) must not create two sessions for the same athlete+day+date — that's exactly
  why create-or-find runs inside `runExclusive`. Test the double-open case explicitly.
- **Pre-fill is a convenience, never an assumption — LOCKED behavior.** A pre-filled set-row
  is a *hint*, not logged data. A set is persisted **only when the coach explicitly saves or
  advances that specific set** — an untouched pre-filled row is NEVER written. Scrolling past a
  pre-filled row leaves it unlogged, exactly as if it were blank. This keeps the log honest: it
  contains only sets the coach confirmed happened, never assumed-from-last-time phantom data.
  Concretely: the pre-filled value populates the input for convenience, but the set record is
  created on an explicit save/advance action on that row, not on render and not on screen-leave.

## 🧪 Testing plan

- **Step 1:** plan view renders with zero log buttons; still shows all exercises.
- **Step 3:** next-day resolution wraps correctly; no-history → Day 1; split-changed → clamps
  to a valid day; in-progress session → opens that day, doesn't advance.
- **Step 4:** double-open (two tabs) creates exactly one session (idempotent create-or-find
  under `runExclusive`).
- **Step 5:** inputs render per the exercise's declared metrics (squat→load+reps, sprint→time,
  med-ball→load); pre-fill pulls the last logged value per exercise+metric; first-time→0/blank
  + hint; 0-set-at-tier movements don't render as trackable; each set persists on entry;
  prescription snapshot stored.
- **Step 6:** in-progress session is visible + resumable; "Finish" flips `completed`; a
  session with sets but not finished still reads in-progress.
- **Pre-fill safety (critical):** an untouched pre-filled set is NOT written — only sets the
  coach explicitly saves/advances are persisted. Test: render a day, touch nothing, leave the
  screen → zero set records created. Touch one set, save it → exactly one record.

## 📌 Resolved

- **Untouched-prefill semantics: LOCKED.** A set persists only on explicit save/advance; an
  untouched pre-filled row is never written. (See the ⚡ note above.) Pre-fills are hints, not
  auto-logged actuals — the log contains only confirmed sets.
- **Session creation is LAZY, not up-front (revises the §"Decisions locked" save-as-you-go note).**
  The `WorkoutLogEntry` is create-or-find'd on the **first set save**, not on screen open. The
  original "create up front on open" premise — "so sets have a parent to attach to" — doesn't hold:
  `getOrCreateWorkout` is atomic/idempotent, so the first set's write creates session + set together
  (exactly what the merged `handleLogNew` already does). Up-front-on-open would litter phantom
  zero-set "in progress" sessions from a misclick and dirty the next-day history lookup. Lazy
  creation keeps the log honest at BOTH levels (set and session) — nothing exists until the coach
  confirms an action. **Consequence for Step 6:** in-progress visibility reads only real,
  set-bearing sessions (free under lazy creation, but asserted in a test so it can't regress).
- **Per-set writes need an upsert, not append.** Save-as-you-go re-saves/edits a set by
  `(workoutId, exerciseId, setIndex)` identity, so `store/setlog.ts` gains an `upsertSet`/`removeSet`
  (built on the existing `updateCollection`/`runExclusive`) — the append-only `saveSetLog` would
  duplicate sets and corrupt PR/trend math. (Missing from the §architecture table's file list.)
- **The track screen requires client JS** (per-set autosave on blur), the first hard-JS surface in
  an otherwise no-JS dashboard. Mandated by the locked save-as-you-go decision; a `<noscript>`
  full-form fallback keeps it usable without JS.
- **Pre-fill source reuses `computeExerciseProgress().metrics[].last`** (via the existing
  `priorsFor`), not a new `lastLoggedValue` scan. Note `.last` is the last *session's best* value,
  not literally the last set — the deliberate "what you did last time" reading.

## 📌 Open items to confirm before building

1. **Where in-progress shows** — athlete page only, or roster too? (Roster gives an at-a-glance
   "who has an unfinished session" but is more work.) Recommend athlete page for v1.
2. **One session per day, or multiple?** If a coach tracks Day 1 twice in one day (rare), is
   that two sessions or a resume of the first? Recommend resume-the-first (create-or-find keys
   on athlete+day+date).

## Suggested handoff order to Claude Code

1. Step 1 (strip log buttons) — fast subtraction, cleanly separates paths.
2. Steps 2–4 (button, next-day logic, session create-or-find) — the plumbing.
3. Step 5 (the field-logging screen) — the core deliverable.
4. Step 6 (in-progress visibility + finish) — closes the loop.
