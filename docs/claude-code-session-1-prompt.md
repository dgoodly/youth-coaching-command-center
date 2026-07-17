# Claude Code — Session 1 kickoff prompt

> **This is Phase 1 / S1 of `BUILD_PLAN.md`.** Phase 0 comes first and has no code in it — go run the rubric past two people who don't do this for a living before you build anything. If that bet fails, none of the below matters.
>
> **Before you paste this**, do four things in the repo:
> 1. Copy `CLAUDE.md` to the repo root and commit it.
> 2. Copy `BUILD_BRIEF_v2.md` and `BUILD_PLAN.md` to the repo root and commit them.
> 3. `git mv BUILD_BRIEF.md docs/archive/BUILD_BRIEF_v1.md` (or delete it) — the name collision will confuse things.
> 4. Skim `CLAUDE.md`'s doc-status table and make sure it still matches reality. It goes stale every time you touch a root `.md`.
>
> Then paste everything below the line.

---

Read `CLAUDE.md` first, then `BUILD_BRIEF_v2.md` in full. Both are at the repo root. `CLAUDE.md` has a table rating every root-level doc — take it seriously, several are outdated in ways that will confidently mislead you.

## Context

This repo is a harness that proved out a training engine. The engine survives and moves into a fresh PWA. The dashboard is being discarded.

We're at **S1 in `BUILD_PLAN.md`** (= step 1 of the build order in `BUILD_BRIEF_v2.md §10`). Read the plan's Phase 1 section for where this sits, but don't work ahead of it.

## The task, and only this task

**Extract a store interface and refactor the existing disk implementation behind it.**

`store/` holds sound logic welded to `fs`. The engine is pure and ports to a browser unchanged; the store does not port at all. Everything downstream sits on this seam, and it's what keeps the PWA decision reversible (`BUILD_BRIEF_v2.md §3, §5.4`).

Concretely:

1. **Read `store/` in full** — `json-store.ts`, `athletes.ts`, `blocks.ts`, `workout.ts`, `setlog.ts`, `query.ts`, `ingest.ts`, `library.ts`, `doctor.ts` — and map every point where persistence is actually touched.
2. **Propose an interface** that covers current usage and is implementable over IndexedDB later. Show it to me before you build it.
3. **Once I've signed off**, refactor the existing disk-backed code to implement it, and update call sites.
4. **Keep every test green.** No behavior changes.

## Explicitly out of scope

- **Do not write the IndexedDB implementation.** That comes with the app. This session is the seam only.
- **Do not touch `engine/`.** No schema changes yet, even the ones the brief specs in §5.1 — those come later and need their own session.
- **Do not touch `dashboard/`** beyond whatever mechanical call-site updates the refactor forces. It's being deleted; don't improve it.
- **Do not add dependencies.** Zero runtime deps is deliberate.
- Nothing else from the brief. It's an 18-decision document, not this session's backlog.

## How I want to work

**Show me the interface before you build it.** That's the one decision in this task and I want to see it first. Don't design and implement in one pass.

Ask when you hit ambiguity rather than picking something plausible. The brief has 18 decisions with reasons attached; a reasonable guess that quietly contradicts one is more expensive than a question.

If you think the interface should be shaped differently than I've implied — say so. You'll have read the store more carefully than I have by then.

## Done means

- Interface defined, reviewed by me, implemented by the disk store
- `npm test` green
- `npm run typecheck` green
- `npm run doctor` still runs clean against `data/`
- No behavior change — this is pure refactor
- A short note on anything you found that contradicts the brief

Start by reading. Don't write code yet.
