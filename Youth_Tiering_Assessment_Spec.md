# Youth Athlete Tiering Assessment — Specification

> Authoritative spec for the assessment: test battery, scoring engine, tier→program
> mapping, maturity axis, and data model. Referenced by `BUILD_BRIEF.md`. Implement
> the scoring engine and data model directly from this document.
>
> **Status:** Design draft — score bands and gate thresholds are reasoned defaults,
> NOT yet validated. Pressure-test with real youth athletes and tune.

---

## 1. Purpose & Core Design Principle

This assessment determines which tier of workout programming a youth athlete receives
on entry. A parent administers a short physical screen; the app converts results into a
tier (S/A/B/C) that routes the athlete to appropriately advanced programming. **The tier
is internal logic — never shown to the user.**

### The two-axis model (critical)
Tier and maturity are independent and MUST be stored as separate fields.

| Axis | What it governs | Set by |
|---|---|---|
| **TIER (S/A/B/C)** | Movement SELECTION and risk — which exercises are safe/appropriate (depth drops, plyo density, max-velocity volume, loaded progressions) | This assessment (competency & control) |
| **MATURITY** | DOSE — volume, absolute load, recovery, within whatever tier the athlete is in | Biological maturity (height-velocity tracking — see §7) |

An athlete is described by BOTH axes, e.g. "A-tier movement, low maturity" = advanced
movement selection served at trimmed volume. Tier decides WHICH work; maturity decides
HOW MUCH. This preserves the program rule: scale dose to biological maturity, not skill.

### Non-negotiable: landing integrity is the gate
The assessment is weighted so that an athlete who is powerful and well-balanced but
cannot control landings is routed DOWN, not up. Athletic output never overrides movement
control. Encoded as hard gates (§4) that can only lower a tier, never raise it.

---

## 2. Administration

| Parameter | Spec |
|---|---|
| Administered by | Parent or guardian (non-coach). All judging criteria must be plain-language. |
| Duration | ~20 minutes |
| Equipment | Step or low box (6–12 in; stairs work), tape measure, open space (~10 yds), phone for filming |
| Filming | Film tests 1, 2, 5 from the FRONT. Front-on video is what lets a non-coach judge knee cave reliably. |
| Frequency | Initial entry, then re-assess every 4–6 weeks (see §6) |
| Order | Run in listed order 1→6. Warm-up precedes test 1. |

**Pre-test:** light general warm-up (jog + a few dynamic movements), 3–4 min. An
unwarmed athlete will under-score and may be hurt. This is NOT maximal conditioning.

**Safety:** movement-quality screen, not a medical assessment. If anything causes pain,
stop. Does not replace professional clearance, especially after injury.

---

## 3. Test Battery — 6 tests, scored 0–3 (max raw = 18)

### Test 1 — Bodyweight Squat  *(film from front)*
- **Setup:** 5 slow bodyweight squats, hands out front for balance.
- **Watch:** depth, heels flat, chest tall, knees track OUT over toes (no inward cave).

| Score | Criteria |
|---|---|
| 0 | Cannot reach depth, OR knees cave inward hard |
| 1 | Partial depth, OR slight knee cave, OR heels lift |
| 2 | Good depth with only minor faults |
| 3 | Full depth, heels flat, chest tall, knees track perfectly |

### Test 2 — Drop-and-Stick Landing  *(film from front)*
- **Setup:** step off 6–12 in box, land two feet, freeze 2s. Then one foot, each leg.
- **Watch:** soft quiet landing; knees stay OUT; sticks with no extra hop.

| Score | Criteria |
|---|---|
| 0 | Knees cave, OR crashes / cannot stick |
| 1 | Noticeable wobble or slight knee cave (two-foot) |
| 2 | Two-foot stick clean; single-leg landing shaky |
| 3 | Two-foot AND single-leg landings stuck quiet, knees out |

### Test 3 — Single-Leg Balance
- **Setup:** one leg, hands on hips, slight knee bend. Best of 2 per leg; **score the WEAKER leg.**
- **Watch:** steady quiet standing foot; minimal hop or arm flail.

| Score | Criteria |
|---|---|
| 0 | Under 5 seconds |
| 1 | 5–14 seconds |
| 2 | 15–29 seconds |
| 3 | 30 seconds, steady |

### Test 4 — Push-Ups (quality reps)
- **Setup:** max push-ups with good form. Stop counting when form breaks.
- **Watch:** straight body line, chest to ~fist height, full lockout.

| Score | Criteria |
|---|---|
| 0 | 0 quality reps |
| 1 | 1–4 |
| 2 | 5–9 |
| 3 | 10 or more |

### Test 5 — Broad Jump (relative to height)  *(film from front)*
- **Setup:** best of 3 standing broad jumps. Compare distance to athlete's OWN height.
- **Watch:** distance vs height AND a controlled landing.

| Score | Criteria |
|---|---|
| 0 | Short distance, OR uncontrolled landing |
| 1 | ~0.75x their height, lands acceptably |
| 2 | ~1.0x their height, controlled landing |
| 3 | Over 1.2x their height, landing stuck clean |

> **CAP RULE:** if the landing is uncontrolled OR knees cave, the score is capped at **1**
> regardless of distance. This test measures control of power, not raw output. Scoring
> relative to height prevents an early-maturing (bigger) child from auto-scoring high on
> size alone.

### Test 6 — Continuous Pogo Hops
- **Setup:** 10 continuous pogo hops in place — stiff ankles, quick contacts, minimal knee bend.
- **Watch:** stiff springy ankles, quick repeated contacts, steady rhythm.

| Score | Criteria |
|---|---|
| 0 | Cannot sustain, collapses, or very heavy/soft |
| 1 | A few reps, heavy or soft contacts |
| 2 | Rhythmic 10, mostly stiff |
| 3 | Crisp, stiff, effortless 10 |

---

## 4. Scoring Engine

Two-step: (1) sum raw score → base tier; (2) apply hard gates that can only LOWER.

### Step 1 — Base tier from raw total (max 18)
| Raw Total | Base Tier | Stage |
|---|---|---|
| 17–18 | S | Advanced |
| 13–16 | A | Proficient |
| 8–12 | B | Developing |
| 0–7 | C | Foundational |

### Step 2 — Hard gates (lower only, never raise)
| Condition | Effect | Rationale |
|---|---|---|
| Test 1 (Squat) < 2  OR  Test 2 (Drop-stick) < 2 | Cap at C | Build foundational control before any reactive or loaded work |
| Test 2 (Drop-stick) = 2 | Cap at A | Single-leg landing not solid enough for S-tier depth drops / high-density SL plyos |
| S-tier requires Test 2 = 3 | else drop to A | Makes S appropriately rare; depth drops demand elite landing control |

### Reference implementation (pseudocode)
```
function assignTier(scores) {
  // scores = { squat, dropStick, balance, pushup, broad, pogo }  each 0..3
  const raw = sum(scores);

  // Step 1: base tier
  let tier;
  if (raw >= 17) tier = "S";
  else if (raw >= 13) tier = "A";
  else if (raw >= 8)  tier = "B";
  else                tier = "C";

  // Step 2: hard gates (can only lower)
  if (scores.squat < 2 || scores.dropStick < 2)  tier = "C";
  else if (scores.dropStick === 2)               tier = min(tier, "A");
  if (tier === "S" && scores.dropStick < 3)      tier = "A";

  return tier;   // min(a,b) ranks C<B<A<S and returns the lower
}
```

**Impl note:** apply gates AFTER the base tier; they only ever reduce it. Order: cap-at-C,
then cap-at-A, then S-requires-perfect-stick. Store raw scores, base tier, final tier, and
which gate fired — for later validation against real athletes.

---

## 5. Tier → Program Mapping

All tiers share the same skeleton — Jump → Sprint → Lift and the base+funnel warm-up.
Tier changes WHICH movements populate the skeleton and how much complexity/density/volume
is unlocked. Tag each movement in the library by minimum tier so the app assembles any
tier's session from one library.

| Tier | Stage | Movement selection unlocked |
|---|---|---|
| **C** | Foundational | Bodyweight + iso/eccentric strength; double-leg landings emphasized; low-amplitude jumps; ACCELERATION sprints only (no max-velocity volume); NO depth drops; primary focus = teach the stick |
| **B** | Developing | Light external load (goblet/DBs); single-leg work introduced; low-level contrast chains; short max-velocity exposure; stick training still central |
| **A** | Proficient | Full contrast chains; single-leg plyometrics; max-velocity at distance; loaded progressions; fuller volume |
| **S** | Advanced | Depth drops; high plyo density; full max-velocity volume; heavier loading; rotational/multidirectional complexity — essentially the full 4-day split as designed |

**Anchor:** the existing 4-day split (experienced 9-year-old, valgus) is an A/S-tier
program. A C-tier athlete gets a structurally identical session — same Jump→Sprint→Lift
order, same base+funnel warm-up — with simpler movements, double-leg landings, no depth
drops, acceleration-only sprinting.

Within a tier, the maturity axis (§7) scales the dose.

---

## 6. Dynamic Re-Tiering

Re-assessment every 4–6 weeks; athletes move in BOTH directions.
- **Up:** as competency improves, unlock the next tier of movements.
- **Down (temporary):** after layoff, illness, or return from injury, scores drop and the
  athlete is routed to safer programming until control returns.
- **Gates re-run every assessment** — a regression in drop-stick control immediately pulls
  complexity back regardless of other scores.

Re-assessment should be low-friction and framed positively in-app ("Let's see what you
improved"). Never surface tier labels or raw scores to the athlete.

**Training history (context input, not a scored test):** capture "months of consistent
training" as a profile field. NOT part of the 18-point battery (kept objective), but used
as a tie-breaker between adjacent tiers and as an input to maturity/dose logic.

---

## 7. Maturity Axis  (concept — later build)

Tier sets movement selection; maturity scales dose within that tier.

**Simplest viable signal: standing height tracking.**
- Parent logs standing height every ~3 months (one tracked measurable, no clinical tools).
- App computes rate of change. A rapid increase flags near peak height velocity (the
  growth-spurt window).
- Near peak height velocity: coordination temporarily regresses ("adolescent awkwardness")
  and injury risk rises → app triggers a temporary DOSE PULLBACK (reduced volume,
  conservative loading, extra landing-quality emphasis) regardless of tier.

**Rule:** maturity NEVER changes the tier (movement selection) — it only modulates
volume/load/recovery. A growth spurt pulls the dose back; it does not strip movements the
athlete has demonstrated they can control. Keep the two axes fully decoupled in code.

Future enrichment (optional, not required for v1): sitting-height vs standing-height ratio,
weight trend, shoe-size change can sharpen spurt detection; height velocity alone is enough
to ship.

---

## 8. Data Model & Product Notes

### Minimum fields to persist per assessment
| Field | Type | Notes |
|---|---|---|
| assessment_id | uuid | |
| athlete_id | uuid | Links to profile (DOB, sport[s], training-months, height log) |
| date | date | Drives the 4–6 week re-assessment prompt |
| scores | int[6] | squat, dropStick, balance, pushup, broad, pogo (each 0–3) |
| raw_total | int | 0–18 |
| base_tier | enum | S/A/B/C before gates |
| final_tier | enum | S/A/B/C after gates — the value the app routes on |
| gate_fired | enum/null | Which gate (if any) lowered the tier — for validation |
| coach_gut_call | enum/null | Coach's independent tier judgment — for validation tuning |
| video_refs | uri[] | Optional clips for tests 1, 2, 5 |
| height_cm | float | For the maturity axis; logged ~quarterly |

### Product guardrails
- Tier and raw scores are **non-user-facing.** Surface only "today's workout" and positive,
  improvement-framed feedback. A youth athlete seeing "C-tier" or a low number undercuts the
  long-term-development goal.
- Store the gate that fired — tells you whether gates are doing the intended work or are
  too aggressive/lenient when validating with real athletes.
- Keep one movement library tagged by minimum tier, not four separate programs.
- Decouple tier and maturity in code from day one, even though maturity ships later.

> **OPEN VALIDATION QUESTION:** the raw-score bands (17–18 = S, etc.) and gate thresholds
> are reasoned defaults, not validated numbers. Next step: run real youth athletes through
> the battery, compare assigned tiers against experienced-coach judgment (the
> `coach_gut_call` field), and tune the bands/gates. The data model captures exactly what
> that tuning needs.
