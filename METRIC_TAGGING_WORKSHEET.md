# Metric Tagging Worksheet — Loggable Exercises

> Confirm or change the suggested metrics for each exercise, then hand the
> finalized list to Claude Code for Phase A step 3 (adding `metrics` to
> `exercise_library.json`). Suggestions are heuristic from slot + movement pattern —
> **you have final say**; the point is to save you starting from a blank page.

---

## The metric catalog (define these once in the durable core)

Every exercise references metric **ids** from this catalog. Units/direction live here,
not on each exercise — so every squat logs load the same way and every sprint's PR
direction is consistent.

| id | label | unit | input | higherIsBetter | used for |
|---|---|---|---|---|---|
| `load` | Load | **lb** | number | ✔ (more = PR) | external weight on lifts/carries/sleds |
| `reps` | Reps | reps | integer | ✔ | completed repetitions |
| `time_s` | Time | s | number | ✘ (**less = PR**) | timed sprint runs |
| `distance_cm` | Distance | cm | number | ✔ | jump distance, carry/sled distance |
| `height_cm` | Height | cm | number | ✔ | vertical jump height, depth box height |
| `duration_s` | Hold | s | number | ✔ *(usually)* | isometric / plank holds |
| `contacts` | Contacts | reps | integer | ✔ | ground contacts on reactive/depth work |

> **Note the two `higherIsBetter: false` cases matter:** `time_s` is the only metric
> where a *lower* value is a PR. Depth-jump and plank direction are judgment calls —
> flagged inline below.

---

## LIFT (29) — load-based unless noted

| id | name | pattern | suggested metrics | dose hint | ✅ confirm / ✏️ change |
|---|---|---|---|---|---|
| l_farmer_carry | Farmer Carry | carry | `load`, `distance_cm` | 2x20yd | |
| l_cossack | Cossack Squat | frontal_strength | `reps` | 0x0 | |
| l_lateral_lunge | Lateral Lunge | frontal_strength | `reps` | 3x6 | |
| l_buddy_curl | Buddy / Nordic Hamstring Curl (assisted) | hamstring | `reps` | 0x0 | |
| l_glute_bridge | Glute Bridge (bilateral) | hamstring | `reps` | 3x10 | |
| l_nordic_full | Nordic Curl (full) | hamstring | `reps` | 0x0 | |
| l_bw_hinge | Bodyweight Hip Hinge | hinge | `reps` | 3x8 | |
| l_kb_rdl | KB / DB Romanian Deadlift | hinge | `load`, `reps` | 0x0 | |
| l_kb_swing | KB Swing | hinge | `load`, `reps` | 0x0 | |
| l_sl_rdl | Single-Leg RDL | hinge | `load`, `reps` | 0x0 | |
| l_rle_lunge_iso | RLE Lunge ISO Hold | iso | `duration_s` | 0x0 | |
| l_wall_sit | Wall Sit | iso | `duration_s` | 2x25s | |
| l_band_row | Standing Band Row | pull | `load`, `reps` | 3x10 | |
| l_pullup_iso | Pull-Up ISO Hold (chin over bar) | pull | `reps` | 0x0 | |
| l_pullup_volume | Neutral-Grip Pull-Up (volume) | pull | `reps` | 0x0 | |
| l_db_press | DB Floor / Bench Press | push | `load`, `reps` | 0x0 | |
| l_hr_pushup | Hand-Release Push-Up | push | `reps` | 3x8 | |
| l_pushup_ecc | Push-Up (4s eccentric) | push | `reps` | 0x0 | |
| l_decel_stepup | Decel Step-Up | sl_squat | `reps` | 0x0 | |
| l_pistol | Pistol Squat | sl_squat | `reps` | 0x0 | |
| l_rle_split_squat | RLE Split Squat | sl_squat | `load`, `reps` | 0x0 | |
| l_sl_squat_box | SL Squat to Box | sl_squat | `reps` | 0x0 | |
| l_split_squat | Split Squat (from lunge) | sl_squat | `reps` | 3x8 | |
| l_sled_drag | Heavy Sled — Backward Drag | sled | `load`, `distance_cm` | 0x0 | |
| l_sled_march | Heavy Sled — High-Handle March | sled | `load`, `distance_cm` | 0x0 | |
| l_box_squat | Box Squat (regression for knee drift) | squat | `reps` | 3x8 | |
| l_bw_squat | Bodyweight Squat | squat | `reps` | 3x8 | |
| l_front_squat | Light Barbell Front Squat | squat | `load`, `reps` | 0x0 | |
| l_goblet_squat | Goblet Squat | squat | `load`, `reps` | 0x0 | |

## SPRINT (14) — timed runs; distance is fixed by the prescription

| id | name | pattern | suggested metrics | dose hint | ✅ confirm / ✏️ change |
|---|---|---|---|---|---|
| s_3point_start | 3-Point Stance Start → Sprint | acceleration | `time_s` | 0x0 | |
| s_falling_start | Falling Start → Sprint | acceleration | `time_s` | 4x15yd | |
| s_ground_start | Ground Start (back / stomach) → Sprint | acceleration | `time_s` | 0x0 | |
| s_half_kneel_start | Half-Kneeling Start → Sprint | acceleration | `time_s` | 4x12yd | |
| s_5105_shuttle | 5-10-5 Pro Agility Shuttle | cod_speed | `time_s` | 0x0 | |
| s_mirror_drill | Mirror Drill (reactive) | cod_speed | `time_s` | 4x20s | |
| s_reactive_cuts | Reactive Cone Cuts (coach calls) | cod_speed | `time_s` | 0x0 | |
| s_buildup | Build-Ups (ramp to ~90%) | max_velocity | `time_s` | 3x30yd | |
| s_flying_sprint | Flying Sprint (build + fly zone) | max_velocity | `time_s` | 0x0 | |
| s_flying_volume | Flying Sprint — Added Exposures (higher volume) | max_velocity | `time_s` | 0x0 | |
| s_resisted_heavy | Resisted Sprint (heavy sled) | resisted_accel | `time_s` | 0x0 | |
| s_resisted_light | Resisted Sprint (light sled) | resisted_accel | `time_s` | 0x0 | |
| s_pogo_to_sprint | Lateral Pogo → Sprint | transition | `time_s` | 0x0 | |
| s_shuffle_to_sprint | Lateral Shuffle → Sprint | transition | `time_s` | 0x0 | |

## JUMP (33) — distance / height / reactive-volume, varies by pattern

| id | name | pattern | suggested metrics | dose hint | ✅ confirm / ✏️ change |
|---|---|---|---|---|---|
| j_bounds_consec | Bounds (consecutive) | bounding | `reps` | 0x0 | |
| j_rle_sl_bound | RLE SL Bound | bounding | `reps` | 0x0 | |
| j_sl_bounds_consec | SL Bounds (consecutive) | bounding | `reps` | 0x0 | |
| j_depth_drop_hold | Depth Drop (stick + hold) | depth | `height_cm`, `contacts` | 0x0 | |
| j_depth_to_hurdle | Depth Drop (stick + hold) → Hurdle Hops | depth | `height_cm`, `contacts` | 0x0 | |
| j_depth_to_sprint | Depth Drop → 10-yd Sprint | depth | `height_cm`, `contacts` | 0x0 | |
| j_approach_broad | Approach Broad Jump (2-step) | horizontal_jump | `distance_cm`, `reps` | 0x0 | |
| j_broad_consec | Broad Jumps (consecutive) | horizontal_jump | `distance_cm`, `reps` | 0x0 | |
| j_broad_stick | Broad Jump (non-consecutive, stick) | horizontal_jump | `distance_cm`, `reps` | 3x3 | |
| j_broad_submax | Broad Jump (submaximal, 70%) | horizontal_jump | `distance_cm`, `reps` | 3x3 | |
| j_hop_stick_fwd | Double-Leg Forward Hop + Stick | horizontal_jump | `distance_cm`, `reps` | 3x4 | |
| j_mb_broad | MB Broad Jump (non-consecutive) | horizontal_jump | `distance_cm`, `reps` | 0x0 | |
| j_hurdle_box | Hurdle Hop → Box Jump (contrast) | hurdle_hop | `reps` | 0x0 | |
| j_hurdle_consec | Continuous Hurdle Hops (2-foot) | hurdle_hop | `reps` | 0x0 | |
| j_hurdle_low | Low Hurdle Hop (2-foot) | hurdle_hop | `reps` | 3x4 | |
| j_sl_hurdle_consec | SL Hurdle Hops (consecutive) | hurdle_hop | `reps` | 0x0 | |
| j_lat_hurdle_box | Lateral Hurdle Hop → Lateral Box Jump (contrast) | lateral_jump | `distance_cm`, `reps` | 0x0 | |
| j_lat_hurdle_consec | Lateral Hurdle Hops (consecutive) | lateral_jump | `distance_cm`, `reps` | 0x0 | |
| j_lat_step_stick | Lateral Step + Stick | lateral_jump | `distance_cm`, `reps` | 3x5 | |
| j_lateral_bound_stick | Lateral Bound + Stick | lateral_jump | `distance_cm`, `reps` | 0x0 | |
| j_skater_bound | Skater Bound (stick) | lateral_jump | `distance_cm`, `reps` | 0x0 | |
| j_pogo_lateral | Lateral Pogo | pogo | `reps` | 2x10 | |
| j_pogo_linear | Linear Pogo | pogo | `reps` | 2x10 | |
| j_pogo_sl | Single-Leg Pogo | pogo | `reps` | 2x6 | |
| j_90_rotational | 90° Rotational Hop + Stick | rotational_jump | `distance_cm`, `reps` | 0x0 | |
| j_quarter_turn_hop | Two-Foot Quarter-Turn Hop + Stick | rotational_jump | `distance_cm`, `reps` | 3x4 | |
| j_sl_multidir | SL Multidirectional Hops (clock, stick each) | rotational_jump | `distance_cm`, `reps` | 0x0 | |
| j_sl_broad | SL Broad Jump (non-consecutive) | sl_horizontal_jump | `distance_cm`, `reps` | 0x0 | |
| j_sl_hops_fwd | SL Hops (forward, non-consecutive, stick) | sl_horizontal_jump | `distance_cm`, `reps` | 0x0 | |
| j_box_jump | Box Jump (2-leg, step down) | vertical_jump | `height_cm`, `reps` | 3x4 | |
| j_seated_box | Seated Box Jump | vertical_jump | `height_cm`, `reps` | 0x0 | |
| j_sl_stick_box | SL Stick Box Jump (2-leg jump, 1-leg land) | vertical_jump | `height_cm`, `reps` | 0x0 | |
| j_vertical_stick | Vertical Jump + Stick | vertical_jump | `height_cm`, `reps` | 3x4 | |

## TRUNK (9) — holds vs. reps, confirm each

| id | name | pattern | suggested metrics | dose hint | ✅ confirm / ✏️ change |
|---|---|---|---|---|---|
| t_dead_bug | Dead Bug | anti_extension | `duration_s` | 2x6 ea | |
| t_hollow_hold | Hollow Body Hold | anti_extension | `duration_s` | 0x0 | |
| t_plank | Plank Hold | anti_extension | `duration_s` | 3x20s | |
| t_suitcase_carry | Suitcase Carry (anti-lateral) | anti_lateral | `duration_s` | 2x20yd ea | |
| t_pallof | Pallof Press (anti-rotation) | anti_rotation | `duration_s` | 3x8 ea | |
| t_plank_reach | Plank — Alternating Arm Reach | anti_rotation | `duration_s` | 0x0 | |
| t_tk_pallof | Tall-Kneeling Pallof Press | anti_rotation | `duration_s` | 0x0 | |
| t_mb_slam | MB Rotational Slam | rotation | `load` | 0x0 | |
| t_mb_throw | MB Rotational Throw (wall) | rotation | `load` | 0x0 | |

---

## MOTOR_SKILL (6) — mixed: 2 loggable throws, 4 non-logged

Med-ball throws are from a **fixed distance into a wall** — so distance isn't the metric;
the **med-ball weight** is the progression variable (heavier ball at the same distance = more
power output, same logic as adding load to a lift). Reuses `load` (lb) only — the ball weight is the whole metric. Throw/catch and
locomotor work is coordination/exposure — no meaningful PR, left non-logged.

| id | name | pattern | suggested metrics | dose hint | ✅ confirm / ✏️ change |
|---|---|---|---|---|---|
| m_rot_scoop_toss | Rotational Scoop Toss (med ball, into wall) | rotational_skill | `load` | 2x6 ea side | |
| m_rot_shuffle_throw | Shuffle → Rotational Throw (med ball) | rotational_skill | `load` | B+ only | |
| m_partner_toss | Partner Toss & Catch | throw_catch | *(none — not logged)* | 2x10 catches | |
| m_reaction_catch | Reactive Catch (partner cues) | throw_catch | *(none — not logged)* | B+ only | |
| m_bear_crawl | Bear Crawl (fwd/back/lateral) | locomotor | *(none — not logged)* | 2x10yd | |
| m_crawl_complex | Animal / Crawl Complex | locomotor | *(none — not logged)* | B+ only | |

> **`load` on a throw = med-ball weight (lb), higherIsBetter: true** — a PR is the heaviest
> ball thrown at the prescribed volume, same axis as a lifting PR. All med-ball throws/slams
> (incl. `t_mb_slam`/`t_mb_throw` in the trunk slot) log ball weight only. Note `m_rot_shuffle_throw`,
> `m_reaction_catch`, `m_crawl_complex` are 0-set at C (B+ only) — a C-tier athlete never sees
> them to log; the logging form must respect the 0-set rule, same as the assembler.

---

## Not logged (confirm)

These slots declare **no metrics** — warm-up base (14), linear funnel (7), CoD funnel
(8), cooldown (7). Assumed not individually logged. (`motor_skill` is handled just above —
two med-ball throws are loggable, the other four are not.) If you ever want to log a
conditioning-style warm-up, say so and we'll add metrics to those too.

---

## Judgment calls I flagged for you

1. **Trunk anti-* movements → `duration_s` (holds).** Many are timed holds (plank,
   hollow, dead-bug variations), but some are rep-based. I defaulted anti-extension/
   rotation/lateral to holds — flip any that are actually counted in reps.
2. **Depth jumps → `height_cm` + `contacts`.** Box height is the load variable; contacts
   is the volume. If you'd rather track these as plain reps, simplify to `reps`.
3. **Pogo / hops / bounds / skips → `reps`.** These are reactive-volume; I kept them
   simple. If you want to track *distance* on bounds specifically, add `distance_cm`.
4. **Iso lifts → `duration_s` + `load`.** Time-under-load. Drop `load` if they're
   bodyweight-only.
5. **Carries / sleds → `load` + `distance_cm`.** Confirm you track distance and not time.

**Applied decisions:** `load` removed from all 18 bodyweight lifts (kept only where loading
equipment is present — DB/KB/barbell/band/sled). Units set to **lb**. `time_s` confirmed as
the only lower-is-better metric. Pull-ups default to bodyweight — add `load` back to
`l_pullup_volume`/`l_pullup_iso` if your older athletes weight them.
