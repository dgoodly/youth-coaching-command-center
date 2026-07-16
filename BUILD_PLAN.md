# Command Center — Build Plan

**Companion to `BUILD_BRIEF_v2.md`.** The brief says *what* and *why*. This says *in what order, and how do I know it worked.*

---

## The two rules this sequence is built on

**1. Get to real use as fast as possible.** The worst outcome available to you is three months of building followed by the discovery that the assessment flow doesn't work on an actual 13-year-old. Everything below is ordered so you can run a real assessment on a real kid at the earliest possible moment — and then keep using it while you build the rest.

**2. Test the riskiest assumption first, and it isn't code.** Your entire product rests on one bet: *a person with no S&C background can score six movement-quality tests correctly if the criteria are in front of them.* If that's false, nothing downstream matters — the engine gets garbage input and rigor downstream can't fix it. That bet is testable this weekend, on paper, for free. Do that before you write anything.

---

## Phase 0 — Validate the bet (no code, ~2 hours)

**Goal:** find out whether a novice can score the assessment.

1. Print the rubric from `Youth_Tiering_Assessment_Spec.md §3`. Just the criteria — no app, no explanation from you.
2. Find a kid and two people who don't do this for a living. A parent. A sport coach. Ideally someone with genuinely zero background.
3. Run the battery. **Everyone scores independently. Film tests 1, 2, 5 front-on.**
4. Score it yourself, separately.
5. Compare — per test, not in aggregate.
6. Then everyone watches the film and re-scores.

**What you're looking for:**

| Result | Meaning |
|---|---|
| Novices within a point of you on most tests | The bet holds. Build. |
| Novices within a point *after film*, not before | The bet holds and **film review is load-bearing, not a nicety.** Prioritize Phase 3 hard. |
| Drop-stick is where they diverge | Expected — it's the test the spec already flags as needing film. Confirms the provisional cap design. |
| Divergence everywhere, film doesn't fix it | **Stop.** The rubric needs work before any of this is worth building. Cheapest possible time to learn it. |

**Also watch:** did they need to ask you anything? Every question is a gap in the rubric, and the rubric is about to become the app.

> This is the highest-value two hours in the entire project. It's also the one step you'll be most tempted to skip, because writing code feels like progress and standing in a garage with a clipboard doesn't.

**Phase 0 result (July 2026):** run. Novices scored. The finding was a question, not a divergence: *"is it ok that the knees fall inward a little bit — is there room to still score higher?"* See Phase 0.5.

---

## Phase 0.5 — Shoot the boundaries (half a day, no code)

**Goal:** answer the question Phase 0 surfaced. By demonstration, not by sentence.

**Why this runs before S3.** *"How much inward knee travel is too much"* is a quantity. Prose is bad at quantities — that's why the question came up, and no rewording fully fixes it. But you can point at it. **The shoot is how you decide the line. The §3 wording is the transcript.** So it happens before the rubric gets transcribed into `library/`, not after.

**The question generalizes — it isn't just drop-stick.** Both gated tests have the same hole in the same place:

| | Score 1 | Score 2 | Score 3 |
|---|---|---|---|
| **Test 1 · Squat** | "slight knee cave" | "only minor faults" | "knees track perfectly" |
| **Test 2 · Drop-stick** | "slight knee cave" | "two-foot stick clean" | "knees out" |

Knee position is named at 0, 1, and 3. **Score 2 is the only level that's silent on it — in both tests. And score 2 is the gate** (`squat < 2 || dropStick < 2 → C`). Your novice would have asked the same question at Test 1. Whatever line you draw, draw it in both places or you'll get the question again.

**Why the format invites it.** The engine treats these as **gates** — binary, disqualifying, no weighing. The rubric presents them as **scales** — four prose descriptions where the reader's job is to find the best match, with knee cave sitting inline next to "wobble" as though a stability fault and an injury-risk fault were comparable. A kid who sticks it two-foot with slight cave matches *part* of 1 and *part* of 2, so the novice asks you to adjudicate. **The content already answers it. The format invited a weighing where the engine permits none.** Consider whether the criteria should read as a check before a scale ("any inward travel → max 1") rather than four descriptions to choose between. That's a format decision, and it's yours.

**And watch the direction of the ask.** They didn't ask *"should this be a 1?"* They asked *"is there room to score higher?"* Someone with a kid in front of them — maybe their own — wants to be generous. If that's the population and not just this person, every fuzzy call rounds up, the C gate under-fires exactly when it matters, and a kid with valgus gets reactive work. That's the failure the product exists to prevent, arriving on day one. It's the argument for a tiebreaker instruction — *when torn between two scores, give the lower one* — as error correction, not philosophy.

**Scope: not 24 clips.** Four of the six tests barely need them:

| Test | Judgment? | Clips |
|---|---|---|
| **1 · Squat** | high — **gated** | **4** |
| **2 · Drop-stick** | high — **gated** | **4** |
| 3 · Balance | none — it's a stopwatch | 0 |
| 4 · Push-ups | "quality rep" is undefined | 1–2 |
| 5 · Broad jump | distance is measured; landing isn't | 2 |
| 6 · Pogo | "stiff," "crisp" — hard in words | 4 |

**Four clips do most of the work:** Test 1 and Test 2, each at the **1↔2 boundary**. Both gates. Not "what a 2 looks like" — *what the line looks like.* Shoot those first and you could stop there and still have answered the question you got.

**Consent is a different animal here, and I missed it earlier.** Every other film in this product stays on the coach's phone. **Exemplars ship** — they're distributed to every install. That's a model release, not a checkbox, and *"we don't keep your kid's video"* doesn't cover a clip of your kid that lives in everyone's app. Use volunteers who consented to that specific use, or your own kids. **Do not harvest them from real assessments**, however tempting once you've filmed forty.

**Two outputs, one shoot.** Clips for the review screen (S12). Stills for the live form (S7) — the field wants glanceable, the desk wants scrubable. Same rhythm as everything else in this product.

**Done:**
- The line is decided, and it's decided in both Test 1 and Test 2
- Your wording is added to `Youth_Tiering_Assessment_Spec.md §3` — **before S3 transcribes it**
- Boundary clips shot and labeled, with releases
- Stills pulled from the clips

---

## Phase 1 — Foundations (4 sessions, no UI)

**Goal:** the durable core, ported and reshaped. Nothing visible ships.

### S1 · Store interface
The seam. Everything sits on it; it's what keeps PWA reversible.
→ *Prompt already written: `claude-code-session-1-prompt.md`*
**Done:** interface reviewed by you, disk impl behind it, `npm test` + `npm run typecheck` green, zero behavior change.

### S2 · IndexedDB implementation
Second implementation of the S1 interface. Test with `fake-indexeddb` (dev dep only — runtime stays zero-dep).
**Done:** both impls pass the same test suite. That shared suite is the contract; keep it.

### S3 · Rubric → `library/assessment_rubric.json`
Six tests × setup, watch-for, four score criteria, CAP flags. Same pattern as `exercise_library.json` — versioned, validated at load, tested.
**⚠️ Blocked on Phase 0.5.** Do not transcribe a rubric with a known hole in it. The score-2 knee-position gap in Tests 1 and 2 must be resolved in `Youth_Tiering_Assessment_Spec.md §3` first — otherwise you're about to ship the ambiguity into the app and every future coach hits it.
**⚠️ Verbatim transcription.** The content is safety-critical. The model will want to tighten the wording and harmonize the bands. Don't let it. Diff the output against the spec yourself, by eye.
**Done:** loader + validation + test, and a manual read-through confirming every string matches §3 — including the new wording.

### S4 · Schema migration
`Assessment`: `scoresLive` / `scoresReviewed` / `reviewedAt` / `reviewedBy` / `provisional`, `films` keyed by test (replacing `videoRefs: string[]`), `filmsPurgeAt`. `computeTier` gains prior-tier context for can-lower-never-raise. Migration for existing `data/`.
This one touches `engine/`. Review it properly.
**Done:** brief §5.1 satisfied, provisional rules unit-tested (all four in §4.4), existing data migrates clean, `npm run doctor` green.

**Stop and look:** you have no UI, but you have a store that runs in a browser, the rubric as data, and a tier engine that knows what it doesn't know. That's the whole durable core.

---

## Phase 2 — Walking skeleton (5 sessions)

**Goal:** the thinnest end-to-end path. Add a kid → assess him → see his tier → see his plan → log a session. **No film, no review, no Today, no rationale.**

This is the phase where you start using it for real.

### S5 · PWA scaffold
Manifest, service worker, app shell, routing, install detection. **Establish the token set here** — `BUILD_BRIEF_v2.md §7`, with the accent split. Never build UI on the broken palette; retrofitting contrast is miserable and you already know the answer.
**Done:** installs to home screen, app shell loads offline, tokens defined, `display-mode: standalone` detectable.

### S6 · Roster + add athlete
List, add, edit. `AthleteProfile` as-is.
**Done:** you can add a real kid.

### S7 · Assessment form — with criteria on screen
**The most important screen in the app.** Not six number spinners. Each test shows setup, what to watch for, and all four score criteria — from `library/assessment_rubric.json`, on screen, at the moment of judgment. **Plus the Phase 0.5 boundary stills** on Tests 1 and 2, where words demonstrably aren't enough. Gut-call before reveal (keep the invariant). Tier computes, provisional flag sets.
**Done:** a person who's never seen the app can score a test without asking you a question. *Test this against a human, not a checklist* — and specifically against the question Phase 0 produced. If they still ask it, you haven't fixed it.

### S8 · Athlete page + plan
Tier (with provisional state and its copy), the assembled plan read-only, history. Desk-leaning. The record.
**Done:** `assembleSession` output renders; provisional cap shows its reason.

### S9 · Track screen + offline queue
Log sets. IDB write queue. The seven sync states from brief §8 — `Queued` is calm gray, not red.
**Done:** log a full session in airplane mode, see nothing alarming, watch it flush on reconnect.

**Stop and look — and actually stop.** Use it. Run three real athletes through it for two weeks. Everything after this is enhancement, and two weeks of real use will reorder your priorities more accurately than I can.

---

## Phase 3 — Safety (4 sessions)

**Goal:** the film loop. This is what makes it safe in a stranger's hands.

### S10 · Export / import
**Before capture, not after.** The moment you film a real kid, that data is precious and irreplaceable, and export is the only backup that exists. Zip: `assessments.json` + clips named by athlete and date. Import too — an export you've never restored isn't a backup.
**Done:** export, wipe the device, import, everything's back. Do this for real once.

### S11 · Film capture + install gate + `persist()`
`<input capture>` per test. Gate on `display-mode: standalone`. One permission moment for notifications + persistent storage.
**Done:** refuses to capture uninstalled with honest copy; `navigator.storage.persist()` granted; storage estimate visible somewhere.

### S12 · Review screen
Clip + exemplar side by side (**exemplars from Phase 0.5**), criteria on screen, live score revealed *after* the criteria. Confirm-is-one-tap. Releases provisional.
**Done:** review changes a score → tier recomputes → cap releases. All four §4.4 rules exercised end-to-end.

### S13 · Review queue + deletion + retention
Queue wrapper around S12's screen. Deletion on the assessment card — five seconds, parent watching. Purge-at-next-assessment, expiry stated, `Keep longer` pin.
**Done:** twelve outstanding reviews clear without leaving the queue; deleting an unreviewed film warns about the permanent cap.

**Stop and look:** hand it to one of your Phase 0 novices. Watch, don't help.

---

## Phase 4 — Field (2 sessions)

### S14 · `Today`
The home. `Start` → straight to track. In-progress above up-next. Zero engine work — it's a re-projection of `nextTrackDay`, `dueForReassessment`, `nearPHV`, guardrails.
**Done:** one tap from launch to logging a set.

### S15 · Nav restructure
`Today · Roster · Lab`. Validation moves to Lab and inverts — it's the calibration/pedagogy surface now, not threshold tuning.
**Done:** nav real estate proportional to frequency.

---

## Phase 5 — Education (3 sessions + content)

**This is the product for personas 2 and 3.** It's fifth because it needs real sessions to be written against — you can't write "why today looks like this" well until you've watched the assembler produce a few dozen real days.

### S16 · `assembleSession` returns reasons
Structured codes + data, not prose. Copy layer maps to plain/technical strings.
**Done:** engine emits no user-facing English. Typo fixes never touch the engine.

### S17 · Rationale panel + `library/glossary.json`
Session-level, plain default, technical on expand. Label promises insight — *"The thinking behind today."* Not "Details."
**Done:** a soccer coach reads the plain tier and understands why. Expands and learns a word.

### S18 · `Exercise.media` + stills precache
Schema (optional, absent-tolerant), fallback chain video → stills → `cue`. Precache all stills (~8MB); fetch block video at assignment (~40MB).
**Done:** every exercise shows *something* offline. Missing media degrades silently.

### S19 · Shoot (not a coding session)
`valgus_relevant: true` ∩ `min_tier: "C"` first. One shoot, two outputs — stills are frames. `variation_family` lets you shoot a family together.

---

## Phase 6 — The rest (4 sessions)

### S20 · Deviation
Skip / adjust dose. Engine responds immediately, regresses only. Per-`workoutId`, expires at midnight, never savable. Equipment asks *"just today, or is it gone?"*

### S21 · Re-assess clock
Signals multiply the 42-day base. Hard floor 21d. One prompt, reasons stacked. Snooze writes `snoozedUntil`.

### S22 · Athlete screen (handout)
`Show Marcus` → filtered render. `isVisibleTo` already exists; this is its intended use. Coach-only fields not in the DOM.

### S23 · Housekeeping
Delete `dashboard/`. Fix `npm test`'s glob (it still targets `dashboard/**/*.test.ts` — it'll break the moment the dashboard goes). Archive stale docs.

---

## Sequencing notes

**Why not tackle the whole brief in fewer, bigger sessions?** Every session above is one reviewable decision. A capable model given an 18-decision brief will produce a lot of good code pointed in a direction you didn't choose. Small sessions aren't about model capability — they're about your ability to catch a wrong turn while it's still cheap.

**Why is export in Phase 3 rather than last?** Because Phase 3 is when the data becomes irreplaceable. Before films, everything is regenerable JSON. After the first real film, you're one dropped phone from zero.

**Why is education fifth if it's "the product"?** Because rationale written before you've watched fifty real assembled sessions will be written against your imagination. Write it against the output.

**Why do the tokens land in S5 and not later?** Retrofitting contrast is miserable and you already know the answer. Do it once, at the start, and never think about it again.

**Why does a film shoot come before any code?** Because Phase 0 asked a question that words can't answer. *How much* is a quantity; you can point at a quantity but you can't reliably write one down. The clip is the definition and the sentence is the transcript — so the clip has to exist before the sentence gets frozen into `library/`.

**What can move:** Phases 4, 5, and 6 are reorderable. Phase 0 → 0.5 → 1 → 2 → 3 is not — each genuinely blocks the next.

---

## The stop-and-look moments

Four of them, and they're where the plan earns out:

1. **After Phase 0.** Does the rubric work in a stranger's hands? *(Done — it produced a real finding.)*
2. **After Phase 0.5.** Re-run the boundary question past the same people, with the clips. If they still have to ask, the line isn't drawn yet.
3. **After Phase 2.** Two weeks of real use before you build anything else.
4. **After Phase 3.** Hand it to a novice and watch without helping.

Each one is a chance to discover you're wrong while it's cheap. Skip them and you'll discover it anyway, later, expensively.

---

## What's still open going in

From `BUILD_BRIEF_v2.md §12` — none of these block the build, but don't let them resolve by default:

- **Who tunes the assembler's thresholds?** 127 unvalidated difficulty defaults, a plyo ceiling your notes call a placeholder, an 8–10 week cadence that's a guess. Persona 1 was the answer and persona 1 won't buy. This probably needs three or four S&C coaches you trust, out of band, before it goes near a stranger's kid.
- **Wellness** has no front door. Form or cut.
- **Parent summary** deferred.
- **Equipment persistence** — "just today" is a lean, not a tested decision.
