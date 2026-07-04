# Feature Ideas & Tunable Defaults

Running log of (a) wishes that surface while using the command center — each becomes a
validated feature request for the future app (BUILD_BRIEF §6) — and (b) **reasoned-default
numbers that need tuning against real athletes** (same status as the assessment's score
bands/gates; EXERCISE_LIBRARY.md §5, BUILD_BRIEF §2A.7).

## Tunable defaults — validate against real athletes

These are starting points, NOT tested values. Log real-world gaps against them.

### Assessment scoring (spec §4)
- **Raw-score bands** (17–18 S · 13–16 A · 8–12 B · 0–7 C) — reasoned defaults.
- **Hard gate thresholds** (squat/drop-stick < 2 → cap C; drop-stick = 2 → cap A; S requires
  drop-stick = 3) — reasoned defaults. The `coach_gut_call` vs `final_tier` gap is the tuning signal.

### Difficulty balancing (EXERCISE_LIBRARY.md §3 step 6)
Per-tier target main-work difficulty bands, used to keep a session from being all-hard or
all-easy for the athlete's level:
- **C:** mostly 1–3
- **B:** mostly 2–4
- **A:** mostly 4–6
- **S:** 5–8 (never all 8s in one session)

The `difficulty` (1–10) ratings on individual exercises are themselves unvalidated defaults.

### Per-day plyo-difficulty budgets (hard sequencing rule)
The max-velocity-vs-plyo protection is enforced as a **session-level ceiling on SUMMED jump
difficulty** per day (not a per-exercise cap) — the rule guards against *accumulated* plyo
load upstream of the runs. Anchored to the reference program's real design:

| Day | Sprint emphasis | Summed-jump-difficulty ceiling | Rationale |
|---|---|---|---|
| 1 (Max Velocity) | max_velocity | **LOW** (≈ ≤ 5, prime-only) | Runs stay fresh; jump block primes, never taxes |
| 2 (Plyo Density / SL) | accel only | high (no max-V present) | High plyo is safe because no max-V downstream |
| 3 (Accel / Multidir) | accel + CoD | moderate | No max-V; moderate plyo |
| 4 (Lateral / Rotational) | reactive only | high (no max-V present) | Frontal/transverse density; no max-V downstream |

- Backstop assertion: if a session ever contains BOTH a `max_velocity` sprint AND summed jump
  difficulty above the day's ceiling, the assembler **refuses to emit** (no silent reordering).
- **TODO tune:** the exact numeric ceiling for Day 1 (currently a placeholder ~5) needs
  real-session validation — is "prime-only" 4, 5, or 6 summed difficulty?

### Rotation cadence (EXERCISE_LIBRARY.md §4)
- **Training block = 8–10 weeks** before rotating a slot's family variant. Cadence is a
  reasoned default; validate whether 8–10 wks is the right accommodation window for youth.

### Re-assessment cadence (spec §6)
- **4–6 weeks** between assessments (tool flags due at ≥ 6 wks / 42 days). Default; tune.

### Maturity / PHV flag (spec §7)
- **PHV trigger = height velocity ≥ 7 cm/yr** (`PHV_FLAG_CM_PER_YEAR` in engine/maturity.ts) →
  dose pullback. Reasoned default (boys' peak ~8–9 cm/yr); validate against real growth logs.
- **✅ APPLIED:** alongside velocity, `computeMaturity` now also returns a **Moore/Fransen (2015)
  maturity-offset estimate** (years-from-PHV band) from sitting height + sex + DOB. The `±1yr`
  circa-PHV band and the velocity flag are two independent spurt signals — tune both against real
  growth logs (esp. the ±1yr band width and how the offset estimate agrees with observed velocity).
- Remaining enrichment (spec §7): weight/shoe-size trend and Khamis-Roche
  (%-of-predicted-adult-height, needs parental heights) for sharper/second-opinion spurt detection.

## Library coverage gaps — families needing C-tier members

Found by running the assembler across every tier × day. When a day-template family pool has no
member available at a tier, the assembler omits that slot (with a coach note).

- **✅ APPLIED — all five HIGH/MED gaps below now have a real C-tier member** (all `difficulty: 1`,
  `min_tier: "C"`, 0-set at B/A/S, `progression_to` wired to the existing B member):
  - `hamstring` → added `l_glute_bridge` (progresses to `l_buddy_curl`). Day 1's lift `hamstring`
    fill now surfaces this directly, so the earlier `["hamstring","hinge"]` pool fallback to
    `l_bw_hinge` is no longer needed to cover the gap (left in place — it's harmless and still adds
    rotation variety across blocks for higher tiers).
  - `pull` → added `l_band_row` (progresses to `l_pullup_volume`). C now gets pulling on Day 2 & 4.
  - `horizontal_jump_sl` → added `j_hop_stick_fwd`, a bilateral hop+stick that bridges into the SL
    family (progresses to `j_sl_hops_fwd`).
  - `lateral_jump` → added `j_lat_step_stick` (progresses to `j_skater_bound`).
  - `rotational_jump` → added `j_quarter_turn_hop` (progresses to `j_90_rotational`).
  - Verified by assembling all 4 day templates at tier C: every previously-omitted slot now
    populates, and the only remaining C-tier omission notes are `depth_contrast` (A/S only, by
    design), `resisted_sprint`, `transition_sprint`, and `sled` (out of scope for this pass).
- **`depth_contrast` is A/S only** — correct by design (depth drops demand elite landing control);
  C/B omit it intentionally, NOT a gap to fill.

## Assembler behavior notes (v1 decisions to revisit)

- **Difficulty balancing is ADVISORY in v1** — the assembler notes when > half a session's
  main-work items fall outside the tier band, but does not force rebalancing. Consider making it
  actively swap variants to hit the band.
- **Entry selection = lowest member ≥ tier band floor** (jumps on max-velocity days excepted —
  they stay lowest to respect the ceiling). Revisit whether advanced athletes should enter a
  family higher than its band floor.
- **Funnels & cooldown are not family-rotated in v1** (include all tier-available drills). §4
  says "rotate the funnels" — a future refinement could rotate funnel subsets across blocks.

## Feature wishes (append as they surface)

- _(none yet — add "I wish the dashboard showed X" items here as they come up)_
