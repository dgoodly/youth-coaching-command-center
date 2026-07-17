# CLAUDE.md

Standing context for this repo. Read fully before doing anything.

---

## What this repo is, right now

A **CLI + local dashboard harness** built to prove out a youth-athlete training engine. The engine works. The harness was scaffolding and is being discarded.

We are mid-transition: the engine and library survive and move into a fresh PWA. The dashboard does not.

**Do not assume the code you're reading is the product.** Check the table in "Status of each area" below before treating anything as load-bearing.

---

## The one principle

> **Immediate changes only ever go down. Going up requires evidence.**

This shows up in three places already: tier gates can only lower a tier; an unreviewed assessment can lower but never raise; the engine can regress an exercise on the spot but never progress it.

It exists because the target user is a coach who does **not** know what they're doing yet — a sport coach out of their depth, or a parent with no S&C background. The fast path must always be the safe path. The risky direction must always cost a measurement.

**Check every proposal against it.** If a change lets something get harder, faster, or higher without a measurement in between, it's wrong — say so rather than building it.

---

## Documentation status — READ THIS BEFORE TRUSTING ANY .md

Several docs at root are stale and **actively wrong**. They will confidently mislead you.

| File | Status |
|---|---|
| `BUILD_BRIEF_v2.md` | ✅ **AUTHORITATIVE.** Current decisions + reasoning. Source of truth for anything forward-looking. |
| `BUILD_PLAN.md` | ✅ Companion to the brief. The brief says *what* and *why*; the plan says in what order and what "done" means per session. |
| `Youth_Tiering_Assessment_Spec.md` | ✅ **AUTHORITATIVE** for the domain. Contains the assessment rubric. Do not paraphrase it — see "Domain content" below. |
| `Field_Form_Data_Contract.md` | ✅ Authoritative for ingestion rules. |
| `EXERCISE_LIBRARY.md`, `*_Athletic_Split_Program.md` | ✅ Domain reference. |
| `COACHING_INSTRUCTIONS.md` | ✅ Philosophy. Note: it is *machine-facing* — the product currently contains zero articulation of the philosophy. That's a known gap (`BUILD_BRIEF_v2.md §4.9`). |
| `FEATURE_IDEAS.md` | ⚠️ Useful, but it's a backlog of guesses, not decisions. Several items are explicitly marked as unvalidated placeholders. |
| `DESIGNER_HANDOFF.md` | ⚠️ **Authoritative for the visual system** — §7 accurately describes the tokenized "Direction B / Field Notes" light theme, and the tier-ramp / maturity-hue invariants in §4 are real product invariants, not styling. **But it predates the current product direction:** it still describes a localhost, single-user, no-auth tool and lists `BUILD_BRIEF.md` as a companion. Trust it on tokens, type, and visual language. `BUILD_BRIEF_v2.md` wins on everything else. Note its `--cc-accent` (`#FF5B04`) fails WCAG AA as text — see `BUILD_BRIEF_v2.md §7` for the split. |
| `docs/archive/BUILD_BRIEF_v1.md` | ❌ **SUPERSEDED** by `BUILD_BRIEF_v2.md`. Archived (was `BUILD_BRIEF.md` at root). Historical only. |
| `AS_BUILT_SPEC.md` | ❌ Describes the harness. Historical only. |
| `PHASE_PLAN_track_workout_screen.md`, `PHASE_PLAN_workout_logging.md` | ❌ Plans for the discarded dashboard. |
| `direction-b-field-notes.md` | ⚠️ Visual direction. The token values in `BUILD_BRIEF_v2.md §7` supersede any color specified here — several fail WCAG AA. |

**If a doc conflicts with `BUILD_BRIEF_v2.md`, the brief wins. If code conflicts with the brief, the brief describes the target — ask before changing code to match.**

---

## Status of each area

| Area | Status |
|---|---|
| `engine/` | **Survives.** Pure functions, no I/O, portable. The moat. Changes need explicit sign-off — see below. |
| `library/` | **Survives.** Versioned JSON, validated at load. New library files are the right pattern for new domain content. |
| `store/` | **Refactor.** Logic is sound; it's welded to `fs` and does not port to a browser. Needs an interface. |
| `dashboard/` | **Discarded.** Do not port, refactor, fix, or add tests to it. It is a reference for *behavior*, not a codebase to evolve. |
| `cli/` | **Keep for now.** Useful for seeding/testing until the app exists. |
| `data/` | Gitignored local data. |

---

## Hard rules

**1. Do not author domain content.**
The assessment rubric already exists, in full, in `Youth_Tiering_Assessment_Spec.md §3`. It is plain-language, it is finished, and it is **safety-critical** — these criteria decide whether a 13-year-old gets loaded plyometrics. When moving it into `library/`, **transcribe it verbatim.** Do not rewrite, improve, condense, or "clarify" it. Same for exercise cues, dose, and difficulty ratings. If content seems wrong, say so — don't fix it.

**2. Do not change engine behavior without sign-off.**
Schema changes to `engine/types.ts` are expected (see `BUILD_BRIEF_v2.md §5`). Changes to scoring, gating, or assembly logic are not. If a task seems to require one, stop and ask.

**3. Stop and ask on anything in `BUILD_BRIEF_v2.md §12` (Open).**
Those are undecided on purpose. Do not resolve them by picking something reasonable and moving on.

**4. Scope discipline.**
This repo is mid-rewrite and the brief is long. It is *not* a to-do list for one session. Do the task asked. If you spot adjacent work, note it and move on — don't do it.

**5. Ask rather than assume.**
The person you're working with knows this domain and has made 18 decisions with reasons attached. A plausible guess that contradicts one of them costs more than a question.

---

## Stack

- Node 22, ESM, TypeScript via `--experimental-strip-types`
- **Zero runtime dependencies.** Keep it that way unless there's a reason worth stating.
- Native `node --test`, not a framework
- `npm test` — engine, store, dashboard *(dashboard tests will be removed with the dashboard)*
- `npm run typecheck` — `tsc --noEmit`
- `npm run doctor` — data integrity check

**Both must be green before anything is done.**

---

## Where this is going

A PWA. On-device only — no server, no hosted data, no athlete accounts. Field-first: assessment and set logging happen on a phone, offline, possibly in a park. Desk is the second home.

Read `BUILD_BRIEF_v2.md §3` before making any architectural decision. The store interface (§5.4) is what keeps the PWA choice reversible; treat it as load-bearing.
