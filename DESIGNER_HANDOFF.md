# Designer Handoff — Coaching Command Center frontend

> **Read this first.** You are designing the **real app's frontend**. The existing dashboard
> (`dashboard/*.ts`) is a deliberately disposable, server-rendered reference build — treat it as the
> **functional & behavioral spec**, not a visual target. Everything it *does* is intentional; how it
> *looks* is placeholder. The durable core (data model + engine) below is the fixed contract you
> design against; the UI is green-field.
>
> Companion docs: [`AS_BUILT_SPEC.md`](AS_BUILT_SPEC.md) (what's implemented), `BUILD_BRIEF.md`
> (intent), `Youth_Tiering_Assessment_Spec.md`, `COACHING_INSTRUCTIONS.md`. Where a doc and the code
> disagree, the code wins.

---

## 1. What this product is

A **local, single-coach command center** for youth athletic development. The coach:
1. Manages a small roster (a few dozen athletes max).
2. Enters a completed paper **assessment** (six movement-quality tests, scored 0–3).
3. The engine computes a non-athlete-facing **tier** (C/B/A/S) that governs movement selection/risk.
4. Assembles tier-appropriate training sessions; tracks **growth** (height → maturity/PHV) and
   **rotation** (training blocks); picks each athlete's **training split** (2/3/4 days/week).
5. Uses a **validation** screen to tune the scoring thresholds against real athletes.

It is **coach-facing, localhost, single-user, no auth** today. Designing an athlete/parent surface or
a networked/multi-user product changes hard constraints — see §8.

---

## 2. Fixed vs yours

**Fixed (the contract — don't redesign these):**
- The **data model** (`engine/types.ts`) — the shape of every record (§6). This is built to outlive
  this tool and transfer into the app unchanged.
- The **engine behavior** — tiering, gates, assembly, maturity, guardrails are pure functions the UI
  *reads*. The UI must never recompute a tier or assemble a session client-side; it renders what the
  engine returns.
- The **coach-only visibility policy** (§4) and the **UX invariants** (§4).

**Yours (green-field):**
- Visual language, layout, typography, spacing, component system, iconography.
- Framework/stack, build tooling, responsiveness, motion, dark/light theming.
- Information hierarchy and navigation (the current flat three-tab nav is placeholder).

---

## 3. The domain in five concepts

Getting these right *is* the design. They are easy to conflate and must not be.

| Concept | What it is | Design implications |
|---|---|---|
| **Tier** (C/B/A/S) | Movement-competency / safety gate from the assessment. Ranked C<B<A<S. | **Coach-only** — never shown to an athlete/parent. Has an existing color language. Stages: C Foundational · B Developing · A Proficient · S Advanced. |
| **Split** (2/3/4-day) | How many days/week the athlete trains. A per-athlete coach choice. | **Independent of tier.** Drives day count in the plan view; switching it is a distinct action with a "fresh vs carry block" choice. |
| **Maturity / PHV** | Growth signal from the height log (velocity + Moore/Fransen offset). Governs **dose only**. | **Orthogonal to tier — never visually imply "more mature = higher tier."** Flags a "near-PHV" dose-pullback state. |
| **Gut-call → reveal** | The coach records their own tier guess *before* the computed tier is shown. | A **hard UX ordering** (see §4). The computed tier must be hidden on the entry form and revealed only after submit. |
| **Validation** | Computed tier vs coach gut-call, aggregated. | This is the threshold-tuning surface; it's about *agreement/disagreement*, not individual athletes. |

---

## 4. Non-negotiable UX invariants

These are behavioral requirements, not styling. Any redesign must preserve them:

1. **Gut-call before reveal.** On assessment entry, the six scores + the coach's gut-call tier are
   captured with **no computed tier visible anywhere on the form**. The computed tier appears only on
   a post-submit reveal. (Protects clean validation data — if the coach sees the answer first, the
   gut-call is worthless.)
2. **Coach-only fields.** `finalTier`, `baseTier`, `rawTotal`, `gateFired`, `coachGutCall`, and raw
   `scores` are coach-only by policy (`COACH_ONLY_FIELDS` / `isVisibleTo` in `engine/types.ts`). An
   athlete/parent view must filter these to improvement-framed feedback. The current dashboard is
   coach-only, so it shows them freely — an app with any athlete surface must not.
3. **The engine is the source of truth.** Never compute or "preview" a tier client-side from the
   scores. Submit to the server; render the returned record. Tiers are recomputed server-side even if
   a paper form disagreed (mismatches are surfaced as provenance, see `paperMismatch`).
4. **Tier and maturity never merge.** Two independent axes; a shared badge/color that implies
   correlation is a design bug.
5. **User input is untrusted.** Whatever stack you choose, all user-entered strings (names, notes,
   cues, video refs) are escaped on render; no raw HTML injection from stored data.

---

## 5. Screen-by-screen spec

The reference app has three read views + a set of forms. Routes are listed so you can open each in the
running reference (§9).

### 5.1 Roster — `GET /`
Purpose: the coach's at-a-glance list. One row per athlete.
- **Per row:** name (+ "valgus" flag pill), age, **tier badge**, last-assessment date, **re-assess
  flag** (fires at ≥ 6 weeks / 42 days since last assessment), **height velocity** (cm/yr, flagged
  when ≥ 7 = near-PHV), a volume-guardrail **"Load" badge** (`over` / `watch` / `—`), and **block +
  split** (e.g. `block 0 · 2d`).
- **Entry point:** "＋ New athlete".
- **Empty state:** "No athletes yet."
- Design opportunity: this is a dense status table today; it's really a triage surface (who needs
  re-assessing, who's near PHV, who's over-loaded) and could be designed as such.

### 5.2 Athlete detail — `GET /athlete?id=`
Purpose: everything about one athlete. Currently a long vertical stack of sections — a prime candidate
for real information hierarchy. Sections, in order:
- **Header:** name, valgus-watch flag, age · sports · training months · **current tier**.
- **Actions:** "＋ Enter assessment", "Edit athlete".
- **Maturity (dose axis):** a plain-language note; a maturity-offset estimate line when computable
  (`PRE`/`CIRCA`/`POST`-PHV band, offset in years, est. age at PHV, method); the **height log** table
  (date, standing, sitting, source).
- **Wellness:** weekly sleep/soreness/energy/notes log.
- **Training-load guardrails:** per-rule status (`ok`/`watch`/`exceeded`/`unknown`) + message.
- **Tier history:** newest-first (date, raw /18, base, final, gate, gut-call ✓/≠).
- **Score trends:** the six tests × assessment dates grid (low values flagged).
- **Current plan:** the **split-switch form** + instant **day tabs** (Day 1 default). Day count comes
  from the athlete's split; each tab is a fully assembled session (warm-up → funnel → jump → sprint →
  lift → trunk → motor-skill → cooldown, with dose + cues + tags like `SL`/`stick`/`d5`).
- **Workout log:** served sessions (date, label, tier, status, notes).

Key states: **no assessment yet** (no tier → plan shows split only, prompts to assess); **no height**
(maturity unavailable, with reason); **one height entry** (velocity needs two); a **day that fails to
assemble** is contained to its own panel rather than breaking the page.

### 5.3 Validation — `GET /validation`
Purpose: threshold tuning. Computed tier vs coach gut-call across all assessments with a gut-call.
- **Agreement summary:** N assessments · X match · Y differ · **% agreement**.
- **Compare table:** date, athlete, raw, calculated tier, gut-call, verdict (match / **DIFFERS**), gate.
- **Gate-firing tally:** how often each gate (`capC`/`capA`/`S->A`/none) fired.
- Design note: this is an analysis screen — it wants charts/deltas more than tables.

### 5.4 Forms

| Form | Route(s) | Notes |
|---|---|---|
| **New athlete** | `GET/POST /athlete/new` | displayName (required), dob, sex (maturity only), sports (comma-sep), training months, valgus watch, weekly sport/training hours, rest days, notes. Server-side validation re-renders with per-field errors. |
| **Edit athlete** | `GET/POST /athlete/edit?id=` | Same fields, pre-filled. |
| **Assessment entry** | `GET/POST /assessment/new?athleteId=` | Six scores (0–3), tester, date, a **broad-jump landing-failed** flag (CAP rule), the **gut-call tier**, height + sitting height, video refs, notes. **No computed tier on this form** (invariant #1). |
| **Assessment reveal** | (POST response) | First reveal of computed tier: final + base + raw + gate, gut-call match/differ, any warnings (CAP applied, paper mismatch), suggested re-assess date (+5 wks). |
| **Split switch** | `POST /athlete/split?id=` | Pick split (2/3/4-day) + block treatment: **start fresh** (reset rotation & variants) or **carry** (keep block index/variants). Per-switch choice, not a global setting. |

Form conventions today: labelled fields, top-of-form error banner + per-field errors, redirect-after-
POST, cancel returns to context. All placeholder styling.

---

## 6. Data contract (bind screens to these)

`engine/types.ts` is the **single source of truth**; summary here so you can design without reading
TypeScript. Enums: `Tier = 'C'|'B'|'A'|'S'` (ranked), `SplitChoice = '2day'|'3day'|'4day'`,
`GateFired = 'none'|'capC'|'capA'|'S->A'`, `Audience = 'coach'|'athlete'`.

- **AthleteProfile** — `athleteId, displayName, dob (nullable → age derived), sex?, sports[],
  trainingMonths, valgusWatch, weeklySportHours?, weeklyTrainingHours?, restDaysPerWeek?, createdAt,
  notes`.
- **Assessment** — `assessmentId, athleteId, date, tester, scores{squat,dropStick,balance,pushup,
  broad,pogo (0–3)}, rawTotal (0–18), baseTier, finalTier, gateFired, coachGutCall (nullable),
  heightCm (nullable), videoRefs[], notes, paperMismatch?`. **The last six-plus outputs are
  coach-only.**
- **HeightLogEntry** — `athleteId, date, heightCm, sittingHeightCm?, source ('assessment'|'manual')`.
- **WellnessLogEntry** — `athleteId, date, sleepHours?, soreness? (1–5), energy? (1–5), notes?`.
- **BlockState** — `athleteId, blockStartDate, blockIndex (0-based), slotVariants{}, activeSplit?`.
- **WorkoutLogEntry** — `workoutId, athleteId, date, servedForTier, sessionLabel, completed, coachNotes`.
- **Computed signals (read-only, from the engine):**
  - *Maturity* — `velocityCmPerYear (nullable), nearPHV (bool), note, maturityOffsetYears?, phvBand?
    ('pre'|'circa'|'post'), estimatedAgeAtPHV?, method`.
  - *Guardrails* — `findings[{ status: 'ok'|'watch'|'exceeded'|'unknown', message }], anyExceeded,
    anyWatch`.
  - *Assembled session* — ordered blocks of `{ title, items[{ name, doseText, cue, tags }] }`.

---

## 7. Current visual language (starting point, not a mandate)

The reference uses an ad-hoc dark theme with **hardcoded hex** (no design tokens) in the `CSS` constant
of [`dashboard/render.ts`](dashboard/render.ts). Carry forward or discard deliberately — but the
**tier color semantics** are worth preserving as a recognizable language:

| Token | Value | Use |
|---|---|---|
| bg / surface / input | `#0f1216` / `#151a21` / `#0b0e12` | page / header & cards / fields |
| border | `#232a33` | dividers, inputs |
| text / heading / muted | `#e6e9ee` / `#b9c2cf` / `#8b95a3` | body / labels / secondary |
| link / focus | `#8ab4ff` | links, focus ring |
| **tier S** | `#3b2a5c` bg / `#d7c3ff` fg | advanced (purple) |
| **tier A** | `#12402f` bg / `#86efac` fg | proficient (green) |
| **tier B** | `#3a3512` bg / `#fde68a` fg | developing (amber) |
| **tier C** | `#3a2317` bg / `#fdba74` fg | foundational (orange) |
| flag / ok / muted | `#fca5a5` / `#86efac` / `#8b95a3` | alert / good / n-a |
| primary btn | `#12402f` / `#86efac` / border `#1c5a3f` | actions |

Type: `14px/1.5 ui-sans-serif, system-ui`. Radii: 5px badges · 8px inputs/buttons · 9px pills.

**Known gaps to fix in the real app** (don't inherit these):
- No tokens — colors are scattered literals.
- **Status is color-only** (`flag`/`ok`) — contrast/colorblind risk; add text/icon affordances.
- **Table-heavy**, minimal information hierarchy on the athlete page.
- **Barely responsive** — viewport meta + a max-width, but not designed for mobile.

---

## 8. Decisions the team should make with you

- **Athlete/parent surface?** The `Audience` split (`coach` vs `athlete`) is modeled but no athlete
  view exists. If in scope, it's a whole second visual system that must hide all coach-only fields.
- **Leaving localhost?** Any networked/multi-user version makes **auth a hard prerequisite** and
  reopens data-privacy questions (roster data is private, currently git-ignored).
- **Stack & tokens.** The reference is dependency-free by philosophy; the real app can choose
  otherwise — decide the framework and a real token system up front.
- **Motion / real-time.** None today; the day-tab toggle is the only interaction.

---

## 9. Run the reference

```
npm run dashboard        # → http://localhost:5173  (no build step)
```
Routes to walk through: `/` · `/athlete?id=<id>` · `/validation` · `/athlete/new` ·
`/athlete/edit?id=<id>` · `/assessment/new?athleteId=<id>`. To get data on screen, add an athlete and
enter an assessment (or ask the team for a sample data dir). Everything is server-rendered HTML read
live from JSON files under `/data`.
