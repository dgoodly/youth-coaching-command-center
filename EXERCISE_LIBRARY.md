# Exercise Library — Schema, Difficulty & Rotation Logic

> Companion to `exercise_library.json` (the canonical data). This doc explains the
> schema, the **degree-of-difficulty** model, how the assembler should select and dose
> exercises, and the **variation/rotation system** that keeps workouts from going stale
> after 8–10 weeks. Governed by `COACHING_INSTRUCTIONS.md`; tier definitions come from
> `Youth_Tiering_Assessment_Spec.md` §5. The JSON is the source of truth — if this doc
> and the JSON disagree, the JSON wins.

---

## 1. Why two ratings, not one

A workout plan factors in more than sets/reps/distance. Each exercise carries **two
independent ratings**, and keeping them separate is the whole point:

- **`min_tier` (C/B/A/S)** — the **safety / competency gate.** "Is this athlete cleared
  to be prescribed this movement at all?" Driven by the assessment. A depth drop is gated
  to S because it demands elite landing control, full stop.
- **`difficulty` (1–10)** — the **inherent demand** of the movement, used to *balance a
  session's total load* and to *order progressions within a family*. Two A-tier exercises
  can have different difficulty (a goblet squat is 3; sprint-with-intent is 6).

Think of it as: **min_tier decides what's allowed; difficulty decides how hard what's
allowed actually is.** This mirrors the program's core rule — tier governs selection,
maturity governs dose — and it's what lets you answer "factor in degree of difficulty"
separately from sets/reps/distance.

### Difficulty scale
| Band | Meaning |
|---|---|
| 1–2 | Foundational — bodyweight/iso, double-leg, low amplitude/complexity |
| 3–4 | Developing — light load or single-leg introduction, low contrast |
| 5–6 | Proficient — single-leg plyo, loaded, max-velocity, full contrast chains |
| 7–8 | Advanced — depth drops, high density, heavier load, reactive single-leg |
| 9–10 | Elite reserve — beyond current youth scope (placeholder for older athletes) |

---

## 2. The schema (per exercise)

```json
{
  "id": "j_broad_stick",
  "name": "Broad Jump (non-consecutive, stick)",
  "slot": "jump",
  "pattern": "horizontal_jump",
  "plane": "sagittal",
  "laterality": "bilateral",
  "min_tier": "C",
  "difficulty": 3,
  "variation_family": "horizontal_jump_bilat",
  "stick": true,
  "valgus_relevant": true,
  "equipment": ["none"],
  "dose": {
    "C": {"sets": 3, "reps": 3, "rest_sec": 75},
    "B": {"sets": 3, "reps": 4, "rest_sec": 75},
    "A": {"sets": 4, "reps": 3, "rest_sec": 90},
    "S": {"sets": 4, "reps": 4, "rest_sec": 90}
  },
  "cue": "Jump far, land soft, knees out, freeze",
  "progression_to": "j_broad_consec",
  "regression_to": "j_broad_submax",
  "notes": ""
}
```

| Field | Purpose |
|---|---|
| `slot` | Where it goes in the session skeleton: `warmup_base`, `funnel_linear`, `funnel_cod`, `jump`, `sprint`, `lift`, `trunk`, `cooldown` |
| `pattern` | The quality/movement trained (e.g. `horizontal_jump`, `hinge`, `max_velocity`) — used to ensure a session covers the right qualities |
| `plane` | `sagittal` / `frontal` / `transverse` / `mixed` — lets the assembler hit all three planes and load frontal/transverse on lateral days |
| `laterality` | `bilateral` / `unilateral` — supports the single-leg bias |
| `min_tier` | Safety gate (selection) |
| `difficulty` | Inherent demand 1–10 (session balancing + progression order) |
| `variation_family` | The rotation group — members are swappable for the same job (see §4) |
| `stick` | Whether a landing/catch is trained (valgus + landing-integrity theme) |
| `valgus_relevant` | Flags knee-tracking exercises — prioritized for athletes with a valgus watch |
| `equipment` | Filter to what the coach has on hand |
| `dose` | Per-tier `{sets, reps, rest_sec}`, OR `{"all": "..."}` for warm-up/funnel/cooldown (scale by trimming for lower maturity). `reps` may be a string like `"3+1"` for contrast chains or `"40-50yd"` for distance |
| `progression_to` / `regression_to` | Links up/down the difficulty chain within the family — drives both rotation and on-the-fly regression |

> **Dose note:** a tier with `{"sets": 0, ...}` means the exercise is **not prescribed at
> that tier** (it's above or below that tier's level). The assembler should treat a
> 0-set dose as "not available at this tier," distinct from `min_tier` gating.

---

## 3. How the assembler selects exercises

For a given athlete + day template, fill each required slot:

1. **Gate by tier.** Keep only exercises where `athlete.tier >= min_tier` AND the
   per-tier dose isn't 0-set.
2. **Filter by equipment** the coach has.
3. **Match the day's plane/pattern needs.** E.g., Day 4 (lateral/rotational) requires
   `frontal`/`transverse` jumps; a max-velocity day requires a `max_velocity` sprint.
4. **Apply valgus priority** (if the athlete has the flag): prefer `valgus_relevant` and
   `stick: true` options, and always include the CoD funnel on lateral days.
5. **Rotate** within each slot's family (see §4) so the same athlete isn't repeating
   identical exercises block over block.
6. **Balance difficulty.** Sum the `difficulty` of the day's main-work exercises and keep
   it within a target band for the tier (rough guide below). This is how difficulty
   factors into planning *beyond* sets/reps — it prevents a session that's all 6s (too
   taxing) or all 2s (too easy) for the athlete's level.

| Tier | Target main-work difficulty band (rough) | Reasoning |
|---|---|---|
| C | mostly 1–3 | Foundational control, low CNS cost |
| B | mostly 2–4 | Developing, introduce single-leg/light load |
| A | mostly 4–6 | Proficient, full contrast + max-V |
| S | 5–8 | Advanced, depth/density — but never ALL 8s in one session |

7. **Enforce the hard rules** from `COACHING_INSTRUCTIONS.md`: Jump → Sprint → Lift
   order; max-velocity sprint never downstream of a heavy plyo block; warm-up = base +
   the day's funnel; trunk folds into the back of lift days; no dedicated conditioning.

---

## 4. The variation / rotation system (anti-staleness)

**The problem:** the body accommodates. Run the identical session for 8–10 weeks and the
stimulus goes stale — progress flattens and the athlete gets bored. **The fix is NOT to
change the structure** (the chassis is sacred). It's to **rotate the exercise that fills
each slot while keeping the slot, the pattern, and the order identical.**

### How it works
- Every exercise belongs to a `variation_family` — a group that trains the **same
  quality in the same slot** and is therefore swappable. Example family
  `horizontal_jump_bilat`: broad jump (submax) → broad jump (stick) → MB broad jump →
  consecutive broad jumps → approach broad jump.
- A **training block = 8–10 weeks.** Within a block, an athlete's session uses one member
  of each family. At the block boundary, **rotate each slot to a different family member**
  — usually the `progression_to` if the athlete's competency/tier has advanced, or a
  lateral swap at similar difficulty if you just want novelty without more load.
- The **pattern stays the same, the expression changes.** The athlete still does a
  bilateral horizontal jump every block; it's just a different one. Structure constant,
  stimulus fresh.

### Worked example — one slot, three blocks
Slot: **Day 1 Jump (bilateral horizontal), B-tier athlete**

| Block | Weeks | Exercise (family `horizontal_jump_bilat`) | Difficulty |
|---|---|---|---|
| 1 | 1–9 | Broad Jump (stick) `j_broad_stick` | 3 |
| 2 | 10–18 | MB Broad Jump `j_mb_broad` | 4 |
| 3 | 19–27 | (athlete now A-tier) Approach Broad Jump `j_approach_broad` | 6 |

Same slot, same pattern, same Jump→Sprint→Lift session — but three distinct stimuli over
~6 months, with difficulty climbing as the athlete earns it. Then cycle back to block 1's
variant (now easy = a deload) or keep climbing.

### Rotation rules of thumb
- Rotate **at block boundaries (8–10 wks)**, not mid-block — let an adaptation finish
  before changing it.
- Prefer `progression_to` when the athlete has re-tiered up or clearly mastered the
  current variant; use a same-difficulty family swap when you just want novelty.
- Keep the **base warm-up stable** (it doesn't rotate — it's the general primer). Rotate
  the **funnels, jumps, sprints, and lifts.**
- Don't rotate more than one variable per slot at a time — if you bump difficulty, hold
  the rest; if you just want freshness, hold difficulty and swap laterally.
- Log which variant an athlete is on per block (the command center should persist this),
  so rotation is deliberate, not random, and you never accidentally repeat a stale block.

---

## 5. Coverage in this library (v1)

| Slot | Count |
|---|---|
| warmup_base | 14 |
| funnel_linear | 7 |
| funnel_cod | 8 |
| jump | 30 |
| sprint | 14 |
| lift | 27 |
| trunk | 9 |
| cooldown | 7 |
| **Total** | **116** |

31 variation families across the library. Every `progression_to` / `regression_to`
reference resolves to a real exercise (validated at build).

This is a working v1 seed, not a finished universe — it covers every slot, tier, and the
main families with enough depth to rotate 2–3 blocks. Expand families as the assembler
needs them (the brief's Phase 2 hand-curation step). Add new exercises by following the
schema in §2; keep `min_tier` and `difficulty` distinct, and always set
`variation_family` + progression links so the new movement plugs into rotation.

---

## 6. For the command center build

- Drop `exercise_library.json` into `/library/` (the brief's `movements.json` slot — rename
  or symlink as preferred; this is that file, enriched).
- The assembler (brief Phase 2) consumes this. The selection logic in §3 and the rotation
  logic in §4 are the spec for it.
- Persist **per-athlete, per-block variant choices** so rotation is tracked over time and
  feeds the progress dashboard.
- This library is also a natural **feature-discovery surface**: as you assemble real
  sessions you'll find missing variants or want finer difficulty control — log those in
  `FEATURE_IDEAS.md`.
