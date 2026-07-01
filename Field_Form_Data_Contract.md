# Field Form — Data Contract

> Defines the data-entry contract between the paper field score sheet
> (`Tiering_Assessment_Field_Form.pdf`) and the command center. Whatever the coach
> writes on paper must map 1:1 into a stored assessment record. Referenced by
> `BUILD_BRIEF.md`. The scoring logic itself lives in `Youth_Tiering_Assessment_Spec.md`
> §4 — this file is only the input/field mapping.

## Purpose
The paper form is filled rink-side by a parent/coach. The tool ingests a completed form
as one assessment record. This contract guarantees every field on paper has a home in the
data model, and that nothing the coach captures is lost in transcription.

## Identity / session fields (page 1 header)
| Form field | Data field | Type | Notes |
|---|---|---|---|
| Athlete name / ID | athlete_id (+ display name) | string / uuid | Links to roster profile |
| Date | date | date | Drives the 4–6 week re-assessment prompt |
| Tester (parent/guardian) | tester | string | Free text |
| Age | age | int | Derivable from DOB if profile holds it |
| Standing height | height_cm | float | Feeds broad-jump scoring AND the maturity height-log |
| Sport(s) | sports | string[] | |
| Months training | training_months | int | Context input — tie-breaker, not a scored test |

## Test scores (the six)
Each captured as an integer 0–3. Order is fixed and must match the spec.

| # | Form test | Data field | Range | Validation |
|---|---|---|---|---|
| 1 | Bodyweight Squat | scores.squat | 0–3 | required |
| 2 | Drop-and-Stick Landing | scores.dropStick | 0–3 | required (gate-critical) |
| 3 | Single-Leg Balance | scores.balance | 0–3 | required; scored on WEAKER leg |
| 4 | Push-Ups | scores.pushup | 0–3 | required |
| 5 | Broad Jump (rel. to height) | scores.broad | 0–3 | required; apply CAP RULE (see note) |
| 6 | Continuous Pogo Hops | scores.pogo | 0–3 | required |

> **CAP RULE reminder (Test 5):** if the landing was uncontrolled or knees caved, the
> recorded score is capped at 1 regardless of distance. The coach applies this on paper;
> the tool should also re-validate it isn't above 1 when a "landing failed" flag is set, if
> that flag is captured.

## Scoring outputs (page 2 — worked by hand, then entered)
The coach computes these on paper; the tool should ALSO recompute them from the six scores
and flag any mismatch (catches arithmetic/transcription errors).

| Form field | Data field | Type | Notes |
|---|---|---|---|
| RAW total | raw_total | int (0–18) | Recompute = sum(scores); warn on mismatch |
| Base tier (from bands) | base_tier | enum S/A/B/C | Recompute from raw_total |
| Final tier (after gates) | final_tier | enum S/A/B/C | Recompute via spec §4 engine; this is the routing value |
| Gate fired? | gate_fired | enum {none, capC, capA, S→A} | Store for validation tuning |
| Re-assess on | next_assessment_date | date | date + 4–6 weeks |

## Coach gut-call (validation)
Not on the current paper form's main flow but REQUIRED in the data model. Add a capture
point — ideally entered BEFORE the calculated tier is revealed, for clean validation data.

| Field | Data field | Type | Notes |
|---|---|---|---|
| Coach's gut-call tier | coach_gut_call | enum S/A/B/C / null | Independent judgment; compared to final_tier to tune bands/gates |

## Optional
| Form field | Data field | Type | Notes |
|---|---|---|---|
| Video clips (tests 1, 2, 5) | video_refs | uri[] | Local file paths if stored |
| Notes | notes | string | Free text observations |

## Ingestion rules
1. All six scores required before a record can compute a tier.
2. Always recompute raw_total, base_tier, final_tier from the six scores — treat the
   paper-written values as a cross-check, not the source of truth. On mismatch, surface
   both and let the coach reconcile (usually a paper arithmetic slip).
3. Persist base_tier, final_tier, AND gate_fired even though final_tier is the routing
   value — the other two are needed for validation analysis.
4. Append height_cm to the athlete's height_log as well as the assessment record (one
   entry serves both the broad-jump reference and the maturity axis).
5. Capture coach_gut_call when available; it's the key to threshold tuning.
