# Command Center — Build Brief v2

**Status:** Supersedes `ux-critique-command-center.md`. See §11 for what's retracted from it.
**Context:** The existing `dashboard/` is the engine's test harness and will be discarded. The engine is sound *for the engine that was specced*; §5 lists what this brief changes about it.
**Source:** 18 decisions made in review session, July 2026. Reasoning preserved so future-you can overturn them on purpose rather than by accident.

---

## 1. The constitutional principle

> **Immediate changes only ever go down. Going up requires evidence.**

This wasn't designed. It emerged — the same rule was independently chosen three times before anyone noticed it was one rule:

| Where | Rule |
|---|---|
| Tier gates | can only **lower** a tier, never raise |
| Provisional tier (§4.3) | an unreviewed film can **lower**, never raise |
| Deviation (§4.5) | the engine can **regress** on the spot; progressing needs a re-assessment |

It's what makes the app safe in the hands of someone who doesn't know what they're doing yet: **the fast path is always the safe path, and the risky direction always costs you a measurement.**

Check every future feature against it. If a new feature lets something get harder, faster, or higher without a measurement in between, it's wrong.

---

## 2. Who this is for

**Primary:** a sport coach (soccer, track) who is out of their depth on strength, and a dedicated parent with no S&C background. Some experienced S&C coaches in the mix.

**The load-bearing insight:** experienced S&C coaches like to own their own development process. They are the persona who could *validate* the engine and the persona least likely to *buy* it. **Everyone who'll buy this can't validate it.** That asymmetry drives most of what follows.

**What they're actually buying:** not programming. *Not being out of their depth.* The education layer isn't a feature bolted onto the product — for these personas it substantially **is** the product.

**Consequences already absorbed:**
- Deviation is not a validation signal (§4.5). A novice's disagreement is a support ticket, not evidence.
- `coachGutCall` is not a tuning signal. It's a **teaching** signal (§4.4). It was always a teaching feature that got filed under validation.
- Who tunes the thresholds is now an open question (§12).

---

## 3. Architecture

**PWA.** Not native. One codebase, no App Store, no review cycles, fast iteration — correct for a solo dev with unvalidated demand.

**Why the usual iOS objections don't bite here:**
- *No background sync* — the canonical iOS PWA dealbreaker. Irrelevant: nothing uploads (§4.6).
- *7-day storage eviction* — Safari-only. Home-screen web apps are outside that regime; they have their own days-of-use counter.
- *No Bluetooth/NFC/USB/sensors* — none needed.
- *Storage quotas* — Safari 17+ allows up to ~60% of disk per origin. The 50MB figure still circulating is stale.

**Three non-negotiable conditions:**

1. **Store behind an interface.** The engine is portable (pure functions, no I/O). `store/` is welded to `fs` and does not port. Define a store interface with two implementations — disk for tests, IndexedDB for the app. This single seam pays for: engine reuse, test fixtures, and the Capacitor escape hatch if PWA ever stops being viable. **Without it, PWA is irreversible.** With it, it's a Tuesday.
2. **Gate film capture on install.** Everything else works in a browser tab. Capture doesn't — uninstalled means Safari's 7-day cap applies and films die. There is no `beforeinstallprompt` on iOS; your instruction UX *is* the install prompt. Copy: *"Add Command Center to your home screen first — that's what keeps your films from being cleared."*
3. **One permission moment.** Safari's Persistent Storage API requires notification permission to work. Notifications also power the re-assess prompt. Ask once, explain both. Don't nag twice.

**Residual risk (accepted):** every iOS browser runs WebKit, so PWA capability is entirely at Apple's discretion, and Apple removed standalone PWA support in the EU in the iOS 17.4 beta before reversing three weeks later under backlash. Tail risk, known mitigation (Capacitor), not worth native's cost this year.

---

## 4. The decisions

### 4.1 Field-first

Assessment happens in a garage or a park, on a phone, with filming. Set logging happens at a field, offline. Desk is a comfortable second home for programming and review — not the primary context.

This got decided by accumulation across four answers rather than as a decision. It's recorded here so it stops being implicit.

### 4.2 The assessment is administered by whoever's there

The spec line — *"Administered by: Parent or guardian (non-coach). All judging criteria must be plain-language"* — is **not a role assignment.** It's the worst-case administrator that generates the plain-language requirement. Design for the least-trained plausible administrator and it works for everyone.

**No handoff. No second role. No permissions model.**

But: `tester: string` already exists on `Assessment`, and the live→reviewed delta is only "your eye is improving" **if it's the same eye on both ends.** Parent scores live, coach reviews → that delta is two people disagreeing, which is a different (also interesting) measurement. Averaging them together ruins the one stat that makes this compelling to a novice.

So: `tester` (live) + `reviewedBy` (review). Provenance, not permissions. Defaults to the account holder, editable. The calibration stat only counts rows where they match.

### 4.3 Live scoring, then film review

Score at the field with the kid in front of you. Review and revise from film afterward.

**Why this is the best thing in the product:** it's the second *commit-then-compare* loop, and it's better than the first.

| Loop | Commit | Reveal | Teaches |
|---|---|---|---|
| Gut-call (built) | coach guesses the tier | engine computes it | tier intuition |
| **Live → film (new)** | coach scores at the field | film shows what was really there | **the eye** |

The live-vs-reviewed delta, per test, over time, is a coach's eye getting calibrated — and you can show it to them:

> *"Six months ago your live drop-stick scores were off by a full point half the time. Now you're within a point on 9 of 10."*

For a soccer coach out of their depth, that's the whole product. Not a workout app — *"I'm becoming competent, and here's the receipt."*

**The delta survives film deletion** (§4.7). It's a number computed at review time. The pedagogy loop doesn't depend on hoarding video.

### 4.4 Provisional tier — can lower, never raise

**Why it's needed:** the film says drop-stick was a 1, not the 2 scored live. The gate fires (`dropStick < 2 → C`). The kid was A this afternoon — and *he already trained this afternoon*, doing A-tier work on landing mechanics that couldn't support it. That's exactly what the drop-stick gate exists to prevent, and live scoring walks around it.

**Why the cap is drop-stick-shaped, not a flat haircut:** the risk isn't spread evenly.

```js
if (scores.squat < 2 || scores.dropStick < 2)  tier = "C";
else if (scores.dropStick === 2)               tier = min(tier, "A");
if (tier === "S" && scores.dropStick < 3)      tier = "A";
```

A point off on pogo nudges a band. A point off on **drop-stick** moves a kid from S to C. And drop-stick is — per the spec — the exact test that can't be judged live: *"Front-on video is what lets a non-coach judge knee cave reliably."* The most consequential input is the one already documented as unreliable without film.

**Rules:**

| # | Rule | Why |
|---|---|---|
| 1 | An unreviewed assessment **can lower** a tier, immediately. | Safe direction. If the kid regressed, you want that today. |
| 2 | An unreviewed assessment **can never raise** a tier. Promotion waits for film. | Over-tiering is the harm. Under-tiering is a boring Tuesday. |
| 3 | First assessment (nothing to lower from) → compute with `dropStick` treated as `min(scored, 2)`, firing the existing `capA`. | **Nobody trains at S on an unreviewed eye.** |
| 4 | On review: recompute. Promotion lands now. Demotion lands now. | Film is truth. |

Rules 1–2 are *"gates only lower"* applied to **provenance** instead of movement quality. Not a new concept — the same concept pointed at a new kind of uncertainty.

**Common case has zero friction:** re-assessment where the kid regressed catches instantly; promotion waits a day or two.

**Copy (athlete page):**

> **Provisional — A (capped from S)**
> Scored live 12 Jul. Drop-stick is hard to call without film, so we're holding at A until you review it. `[ Review film ]`

Not "unverified," not a warning. States the reason, hands over the action — the education product doing its job inside a status badge.

**Audit already exists:** `WorkoutLogEntry.servedForTier` means you can answer *"did this kid ever train above his real tier?"* The field was built before the question existed. Worth a Lab view eventually.

### 4.5 Deviation — engine responds immediately, regress-only

**The shape:** the coach reports a fact; the engine picks the response. Facts in, decisions out. The coach never chooses an exercise.

- *"Too hard"* → engine offers `regression_to` (already in the library)
- *"No trap bar"* → equipment update, engine re-assembles
- *"Don't know how"* → show the demo (§9), no program change
- *"Injury/pain"* → flag
- *"Too easy"* → **logged only.** Feeds the re-assess clock (§4.8). No immediate change — that's the constitutional principle.

**Why immediate:** "we'll fix it next session" is a non-answer when a 13-year-old is standing there waiting. The session is happening now; a Thursday response means the coach improvises, and improvisation from a novice is the thing this product exists to prevent.

**Guardrails:**

- **Reason-shopping is bounded and self-reporting.** Instant reward for "too hard" teaches coaches it's the difficulty dial. But `regression_to` is a chain — each tap is one notch down a ladder you designed, not a free choice. And the abuse case *becomes signal*: same slot regressed 3 sessions running is evidence the tier is overstated → re-assess trigger. The failure mode feeds the fix.
- **Re-assembly can only touch blocks not yet started.** Never rewrite something with set logs against it or the workout log starts lying.
- **Never savable.** Per-`workoutId`, expires at midnight, never touches tomorrow's assembly. **Nothing a coach does in the field is allowed to become a template.** The moment a coach can save "my version of Day 2," this is a program builder with extra steps and the moat is gone.

**Equipment is the odd one out.** "Too hard" is a fact about today; equipment is a fact about the gym. Ask: *"just today, or is it gone?"* Default **just today**, "always" on a second tap. Cheap to get wrong in the safe direction.

**Friction asymmetry is the enforcement mechanism.** Following the plan: 0 taps. Deviating: `···` → action → reason → confirm. That asymmetry *is* the philosophy, enforced by cost rather than by absence of controls.

### 4.6 Video lives on-device only

Never leaves. Export to back up.

**Why:** solo, pre-revenue. Hosting video of children is the single heaviest obligation available in this product — breach exposure, retention policy, deletion requests, insurer questionnaires. It's the one mistake you can't take back. On-device gives the review screen at full quality, costs nothing, works offline (needed anyway), and keeps custody with the coach where it already legally sits. Add sync when someone's paying for it. **You cannot un-become a custodian of kids' video.**

**Requirements:**
- `navigator.storage.persist()` on first write (needs notification permission on Safari — see §3, condition 3)
- Install gate on capture (§3, condition 2)
- **Handle missing files gracefully.** Detect the gap, say *"this film is no longer on this device,"* keep the scores — they're small, they're in the store, they survive. Never let a missing clip break the review screen.
- `navigator.storage.estimate()` surfaced honestly. ~30MB per assessment (6 clips); a 20-athlete roster at 4/year ≈ 2.4GB.

**Export is now infrastructure, not a nicety.** It's the only backup that exists. Zip: `assessments.json` + clips named by athlete and date, plus a matching import. **If export is a stub, "on-device only" quietly means "one dropped phone from zero."**

### 4.7 Deletion is independent of history; retention purges at next assessment

**Deleting a film never deletes an assessment.** Scores live in the store; clips live in OPFS; `films` is the join. The assessment record — `date`, `scores`, `tier`, `gateFired` — is a few hundred bytes and never moves.

| Deleted | Kept | Consequence |
|---|---|---|
| One clip | scores, tier, history, calibration delta | that test can't be reviewed |
| One assessment's films | all of the above | can't be reviewed *if it wasn't already* |
| An athlete's films, all | **full history — every score, tier, trend, PR** | no review, no compare-to-last-time |

**The conflict:** deleting an *unreviewed* film means that assessment can never be reviewed, so the provisional cap can never be released. **Leave it capped until the next assessment** — safe direction, consistent with the gates, self-heals in six weeks. The dialog must say so; a silently permanent cap is a bug report.

```
Delete Marcus's films from 12 Jul?

The assessment stays. Scores, tier, and his full history are kept —
only the video is removed. This can't be undone.

⚠ These haven't been reviewed yet. Marcus stays capped at A
  until his next assessment.

              [ Cancel ]   [ Delete films ]
```

**Lead with what survives.** The person asking is afraid they're erasing their kid's progress. Tell them they aren't before you tell them anything else.

**Retention: purge at next assessment.** Not keep-forever-with-a-delete-button — that's a hoard with a nominal control, and a delete button nobody presses is the same theater as a checkbox nobody reads. The film's purpose (score this assessment, compare to the last one) is discharged at the next assessment. Data minimization with the one real use case preserved, storage bounded, and *"we don't keep your kid's video"* becomes a property of the system rather than a promise.

**But surprise deletion is its own betrayal.** So: state the expiry on the card, before it happens.

```
┌─ Assessment · 12 Jul ────────────────────────────┐
│  Tier A · reviewed 13 Jul                        │
│  Films: 3 · 📌 kept until Marcus's next assessment│
│                        [ Keep longer ]  [ Delete ]│
└──────────────────────────────────────────────────┘
```

`Keep longer` is the pin for the genuinely rare case (landmark, injury workup). **The escape hatch is what makes the default legitimate.**

**Consent: no checkbox.** In a local-only tool a consent form protects nobody and creates false coverage. Fast, obvious, honest deletion *is* the consent mechanism. Control beats a form.

**Design for the awkward version — a parent standing right there.** The delete affordance lives on the assessment card, findable in five seconds, doable while someone watches. A coach who can say *"yeah, of course — here, watch"* will trust you with the next kid. Leave a minimal tombstone (`No films`), not a reason. The coach needs to know why review is unavailable. Nobody needs a log saying a parent got nervous.

### 4.8 Re-assess: signals move the clock, they don't ring the bell

**Rejected:** five independent triggers. Fifteen athletes on a bare calendar is ~2.5 prompts/week. Add "PRs up on ≥3 exercises" and consider who the athlete is — a 13-year-old in his first block PRs on *everything*, for weeks. The smartest-sounding trigger fires for nearly every athlete nearly always, for the first three months, which is exactly when the coach decides whether to keep the app.

And an assessment isn't a click — it's 20 minutes plus filming plus review. Over-prompt and it either gets done too often or gets ignored. **When prompts get ignored they all get ignored, including the 42-day floor, which is the one that protects the kid. Over-prompting doesn't add safety; it spends the attention budget the safety trigger runs on.**

**The shape: one state, many inputs.** Same as `computeTier` — six scores in, one tier out, not six alerts.

| Signal | Effect on the clock |
|---|---|
| Base | 42d |
| Near PHV | ×0.67 → **28d** |
| PRs up on ≥3 exercises | ×0.8 |
| Persistent regression (same slot, 3+ sessions) | ×0.7 |
| "Too easy" ×2 | ×0.8 |
| **Hard floor** | **never below ~21d** |

Every signal counts. **One prompt per athlete**, arriving with reasons stacked. Multiple signals make it *earlier and better-argued*, not louder and more numerous. The floor makes spam structurally impossible rather than a thing you hope doesn't happen — same move as the provisional cap: make safe behavior a property of the system, not a discipline.

**Near-PHV is the most important signal.** Movement quality *regresses* through a growth spurt — limbs lengthen faster than coordination catches up. It's the one time six weeks is too long, and the one time a stale tier is most dangerous.

**Snooze: one tap, writes `snoozedUntil`.** Mandatory. A prompt with no dismissal is wallpaper in three weeks, and then the floor means nothing.

**The prompt:**

```
┌─ Re-assess Marcus? ────────────────────────────────────────┐
│  Last assessed 44d ago · tier A                            │
│                                                             │
│  Since then:                                                │
│    Trap Bar Deadlift    PR 52 → 68 kg    ▁▂▄▅▇             │
│    Broad Jump           PR 198 → 214 cm  ▁▃▄▆▇             │
│    Pogo (contact time)  no change        ▄▄▄▄▄             │
│                                                             │
│  ▲ Circa-PHV · grew 3.1 cm since last assessment            │
│                                                             │
│  Loading is up but movement quality hasn't been             │
│  re-tested since he started growing.                        │
│                                                             │
│         [ Enter assessment ]   [ Not yet · remind in 2wk ]  │
└─────────────────────────────────────────────────────────────┘
```

**Copy discipline:** *"movement quality hasn't been re-tested"* — **never** *"his movement quality has declined."* You don't know that. The prompt's job is to make the coach curious, not to make a claim the data can't support.

**Free bridge you already have:** exercises are tagged `SL` and `stick`, which map onto the `balance` and `dropStick` tests. So for those two you can say something narrower and truer: *"He's been doing stick-landing work for six weeks and his drop-stick score predates it."* Better than a calendar nudge, and the connection is already encoded.

**Note the honest constraint:** the assessment measures *movement quality* (0–3, human-judged); the set log measures *performance* (height, reps, load). A kid can add 20lb to his squat while his squat pattern degrades. Set-log trends can never *predict* an assessment score — they can only give the prompt a reason to exist beyond a calendar. But that gap **is the risk state the whole product is built around**: load rising + quality stale = getting strong faster than getting competent. A prompt firing on that isn't calendar hygiene, it's the safety system working.

### 4.9 Rationale: session-level, two-tier

**One panel per session.** Plain by default, expandable to technical.

**Why session-level:** ~15 exercises × a *Why this* panel isn't education, it's noise, and it gets permanently collapsed in week two. Most of the assembler's reasoning is session-level anyway — *"Marcus is on valgus watch, so landings today are stick variants"* explains four exercises in one sentence. Slot rotation is the only genuinely per-exercise reason; it lives in the technical tier.

**Why two-tier:** a stated goal is that using the app makes you educated on youth training. Concept first, label second — you learn *"jumps come first so his legs are fresh for the runs,"* then you learn that's called a max-velocity day. Meeting a term attached to a concept you already hold is how anyone learns a field's language. Label-first is how you learn to nod along.

**The trap:** two-tier only educates if the expand gets pressed. `▸ Details` gets pressed by nobody, ever. **The label must promise insight, not information** — *"The thinking behind today"* gets opened; *"Details"* does not. The technical tier is where vocabulary is introduced and defined, not the same sentence with harder words.

**Register warning.** This is wrong for this audience:

> ~~"Day 1 is a max-velocity day — the runs come after this block, so jumps prime the system rather than tax it. Total jump difficulty today is capped at 5; this block is at 4."~~

Four pieces of jargon in two sentences. That's the plain tier for persona 1 and the *technical* tier for personas 2–3.

**Why it matters:** the philosophy currently exists only in `COACHING_INSTRUCTIONS.md` and `BUILD_BRIEF.md` — machine-facing docs in a private repo. **The running product contains zero articulation of the philosophy.** You can't recruit believers to an invisible thesis. Rationale panels *are* the philosophy made visible, distributed across the screens where it applies, exactly when it's relevant. You don't need a manifesto page; you need `assembleSession` to explain itself.

### 4.10 Demo media: video + annotated stills

**The problem:** `Exercise` has no media field. Zero media keys across 127 exercises. The entire teaching apparatus is `cue: "land quiet, stick 2 seconds"`. A parent-coach who mis-scores a drop-stick gets one wrong tier — and the provisional model now catches it. A parent-coach who can't teach a depth jump gets a kid doing depth jumps wrong, 18 times a block, with nothing to catch it.

**Not redundant — used at different moments:**

| | Shows | When |
|---|---|---|
| **Video** | the movement in time — tempo, rhythm, shape | at the desk, prepping; once before the block |
| **Annotated still** | the frozen moment where the fault lives — knee at landing, hip at the bottom | at the field, kid mid-rep, three seconds |

**Prepare rich, execute glanceable.** Same rhythm as live-score-then-review-film. The product has a spine.

**It solves the precache problem, which field-first created:**
- Stills: ~60KB × 127 ≈ **8MB. Precache all, forever.** Every exercise has something offline, always.
- Video: ~2MB × ~20 in the current block ≈ **40MB**, fetched at block assignment.
- Fallback chain: video → stills → `cue`. Never a dead end.

Glanceable layer universal, rich layer scoped — only possible because both were taken.

**Production is one pipeline.** Stills are frames from the video. Shoot once, pull frames, annotate. Marginal cost of stills given video is annotation labor, not another shoot.

**Shoot list priority:** `valgus_relevant: true` ∩ `min_tier: "C"` — bad form means a knee, *and* a brand-new athlete with a brand-new coach hits it in week one. Not an arbitrary top 20. `variation_family` lets you shoot a family in one session and show the progression in one clip.

### 4.11 `Today` is the home

**The problem it solves:** nav was `Roster | Validation` — two places you *look*. Nothing was a thing you *do*. Starting a session cost four navigations through the most expensive page in the app (assembling 2–4 full sessions, maturity offsets, guardrails, PRs) to reach a screen where you type `3` in a box. Meanwhile Validation — a monthly task — held 50% of the nav. **Nav real estate was inversely proportional to frequency.**

Field-first makes it decisive: a coach at a park with a phone needs *who's next*, not an eight-column sortable table.

**Rejected — separate IAs per breakpoint.** Sounds sophisticated, isn't: two things to maintain, two mental models for the same coach who uses both devices, and a *"wait, where's that button"* moment on every switch. Phone and desk want different **densities of the same surface**, not different surfaces.

**Zero engine work.** Everything needed already exists in `store/query.ts`: `nextTrackDay`, `dueForReassessment`, `daysSince`, `blockStateFor`/`splitOf`, `computeMaturity`→`nearPHV`, `checkVolumeGuardrails`→`anyExceeded`, `setLogFor`/`workoutLogFor`. It's a re-projection of data you already compute.

```
┌──────────────────────────────────────────────────────────────┐
│ Command Center       Today · Roster · Lab                     │
├──────────────────────────────────────────────────────────────┤
│  Today                                          Tue 15 Jul    │
│  3 sessions in progress · 2 athletes need re-assessing        │
│                                                               │
│  ┌─ IN PROGRESS ───────────────────────────────────────────┐  │
│  │  Marcus T.        Day 2 · Plyo Density      [ Resume ]  │  │
│  │  ● 7 sets logged · started 4:12pm                       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ UP NEXT ───────────────────────────────────────────────┐  │
│  │  Jordan K.  [B]   Day 3 · Accel/Multidir     [ Start ]  │  │
│  │  ▲ near PHV — dose pulled back                          │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │  Sam W.     [—]   No assessment on file   [ Assess → ]  │  │
│  │  Can't build a plan without a tier                      │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ NEEDS ATTENTION ───────────────────────────────────────┐  │
│  │  ● Chris L. — 48d since last assessment  [ Assess → ]   │  │
│  │  ● Marcus T. — 3 films to review · capped at A [ Review ]│ │
│  │  ● Tyler M. — load over: 15h/wk vs age 13   [ View → ]   │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

**Design notes:**
- **In progress above Up next.** An abandoned half-session is the most expensive state in the product — data already paid for that will rot.
- **`Start` goes straight to track**, skipping the athlete page. One tap from landing to logging.
- **Flags are inline reasons, not badges.** *"near PHV — dose pulled back"* gives the consequence, not the datum. Nobody remembers what a triangle means at 4:15pm on a Tuesday.
- **Ordering in Up next:** blocked (no assessment) first, then near-PHV, then by name. Blocked is an action, not a footnote.

**States:**

| State | Treatment |
|---|---|
| Empty roster | *"No athletes yet."* + `＋ New athlete`. No empty section headers. |
| Roster exists, nothing scheduled | Hide In progress / Up next. Show Needs attention if non-empty, else *"Nothing needs you today."* **Never three empty cards.** |
| Athlete with no assessment | Never `Start` — `assembleSession` requires a tier. `Assess →` and say why. |

### 4.12 Handout: athlete screen first, parent summary later

**Two features share the word "export." They're unrelated:**

| | What | For |
|---|---|---|
| **Backup export** (§4.6) | zip of scores + clips + import | the coach. Infrastructure. |
| **The handout** | filtered view, `COACH_ONLY_FIELDS` stripped | the athlete or parent |

The second is what `isVisibleTo` and `Audience` were built for — the invariant that's had no counterparty since athlete accounts were closed.

**Athlete screen (first).** Coach finishes at the field, taps `Show Marcus`, hands over the phone. Marcus sees his PRs and today's work; tier and raw scores aren't in the DOM. A filtered render — `isVisibleTo` already exists and this is its exact intended use. Zero infrastructure, works offline, and it lands on the moment that actually happens: the kid asking *"how'd I do?"* while still catching his breath. **The most emotionally weighted moment in the product, and it's nearly free.**

**Parent summary (later).** End of block, via the share sheet. Different audience, different content, different room — the same field/desk split this product keeps producing. Real work (layout, generation, "what does a parent even want"), and much easier to design after watching a coach hand a kid a phone and seeing what the kid looks for.

**Note:** a share *link* is off the table. No server, nothing leaves the device.

### 4.13 Film review: queue for batches, card for one-offs

**Two-speed athlete page: withdrawn.** It existed because the page did two jobs — *"what do I do now"* and *"how has this kid developed."* `Today` took the first. The athlete page is no longer a waypoint on the hot path, so the expensive-page problem is gone. What's left is the record plus assessment management. One job. It doesn't need two speeds; it needs to be good at being the record.

**Film review took its place, and had no home.** Every decision pushes on it: provisional tiers mean unreviewed films actively cap athletes; live-then-review means every assessment generates review debt. A sport coach assessing a squad of twelve in one evening walks away with **36 clips**. Athlete-by-athlete through twelve pages is a chore, chores don't get done, and un-done reviews mean twelve kids stuck at a provisional cap.

**The provisional cap is the queue's own motivation.** *"Marcus is capped at A until you review his landing"* is a reason to sit down and clear it. The incentive was built before the surface.

**One screen, two entry points.** The review screen is one component either way — clip, exemplar, criteria, score. What differs is how you arrive and whether it advances to a next item. Queue wrapper around a shared screen, not two builds. `Today` gets the nudge (Needs attention), the athlete page gets the direct link, the queue opens from either when there's a stack.

```
┌─ Review · Marcus T. · Drop-and-Stick ·  3 of 12 ─────────────┐
│                                                               │
│  ┌─────────────────────┐   ┌─────────────────────┐           │
│  │                     │   │                     │           │
│  │   [ his film ]      │   │  [ exemplar: 2 ]    │           │
│  │   ▶ ──────○─────    │   │  ▶ ──────○─────     │           │
│  └─────────────────────┘   └─────────────────────┘           │
│                              ◂ 0  1  2  3 ▸                   │
│                                                               │
│  0  Knees cave, OR crashes / cannot stick                     │
│  1  Noticeable wobble or slight knee cave (two-foot)          │
│  2  Two-foot stick clean; single-leg landing shaky            │
│  3  Two-foot AND single-leg stuck quiet, knees out            │
│                                                               │
│  You scored 2 live.                                           │
│                          [ Confirm 2 ]   [ Change to… ]       │
└───────────────────────────────────────────────────────────────┘
```

Criteria on screen, exemplar scrubable next to his film, live score shown *after* the criteria (not before — it'd anchor). Confirm is one tap because most reviews confirm.

---

## 5. Engine & schema changes

The engine is sound for the engine that was specced. This brief specs a different one.

### 5.1 `Assessment`

```diff
  export interface Assessment {
    assessmentId: string;
    athleteId: string;
    date: string;
    tester: string;              // already exists — this is scoredLiveBy
-   scores: Scores;
+   scoresLive: Scores;
+   scoresReviewed: Scores | null;
+   reviewedAt: string | null;
+   reviewedBy: string | null;
+   // canonical = scoresReviewed ?? scoresLive
    rawTotal: number;
    baseTier: Tier;
    finalTier: Tier;
    gateFired: GateFired;
+   provisional: boolean;        // true until reviewed
    coachGutCall: Tier | null;
    heightCm: number | null;
-   videoRefs: string[];
+   films: Partial<Record<ScoreKey, FilmRef>>;
    notes: string;
    paperMismatch?: PaperMismatch;
+   filmsPurgeAt?: string | null;   // null = pinned (§4.7)
  }
```

**`videoRefs: string[]` cannot support this.** It's an unordered bag — it can't say which clip is the drop-stick, which is exactly what review needs ("this clip, next to *that* exemplar"). Per-clip deletion needs per-clip identity. The spec says film tests 1, 2, 5 — key it.

### 5.2 `computeTier`

Needs prior-tier context it doesn't currently receive, to implement can-lower-never-raise. Signature changes.

### 5.3 `assembleSession` — return reasons

The assembler knows why it picked everything and throws it all away at the return boundary. It knows Day 1 is max-velocity so the jump block is prime-only under a summed-difficulty ceiling; it knows the exercise came from slot rotation at `blockIndex: 2`; it knows d6 sits in tier A's 4–6 band; it knows the stick variant is there because of `valgusWatch`. The coach sees three cryptic pills and a dose.

**Don't emit prose from the engine** — that welds copy to the engine and you'll redeploy the engine to fix a typo.

```ts
reasons: Array<{
  code: 'prime_before_sprint' | 'valgus_stick_sub' | 'phv_dose_pullback'
      | 'difficulty_ceiling' | 'slot_rotation' | ...
  data: Record<string, unknown>
}>
```

A copy layer maps `code + data` → plain string and technical string. **Engine owns the reasoning; the copy layer owns the words.** Rewrite education copy without touching the thing that decides what kids do. Localizes later for free.

### 5.4 `store/`

Reads JSON off disk. A client app needs IndexedDB. **The engine ports fine (pure functions, no I/O); the store doesn't port at all.** Interface + two implementations — disk for tests, IDB for the app. This is the first thing to build and the one that's invisible until it isn't. If the fresh build reaches for the engine first, this seam is where it snags.

### 5.5 `AthleteProfile`

No consent field needed (§4.7 — deletion is the mechanism). But `films` deletion and purge need to be reachable from the athlete record.

### 5.6 New library files

Same pattern as `exercise_library.json` — versioned, validated at load, tested.

- **`library/assessment_rubric.json`** — six tests × setup, watch-for, four score criteria, CAP flags. **The content already exists** in `Youth_Tiering_Assessment_Spec.md §3` and it's genuinely novice-legible. It just lives in a Markdown file a coach will never open. This feeds the *form*, not the engine — additive, breaks nothing. **Cheapest high-value item in the whole brief.**
- **`library/glossary.json`** — terms for the technical tier (§4.9). Terms define themselves on tap.
- **`Exercise.media`** — optional, absent-tolerant so the library ships incomplete:
  ```ts
  media?: {
    video?:  { ref: string; durationMs: number };
    stills?: Array<{ ref: string; caption: string }>;  // "knees out, not in"
  }
  ```

---

## 6. Surfaces

| Surface | Context | Job |
|---|---|---|
| **Today** | phone, field | who's next, what's in progress, what needs you |
| **Track** | phone, field, offline | log sets, deviate, glance at stills |
| **Review queue** | desk | clear film debt, release provisional caps |
| **Athlete** | desk | the record + assessment management |
| **Roster** | desk | management, add/edit |
| **Athlete screen** | phone, handed over | filtered view for the kid |
| **Lab** | desk, monthly | pedagogy (gut-call gap), `servedForTier` audit |

**Validation → Lab, and its purpose inverted.** It was built to tune thresholds against coach gut-call. For personas 2–3 that's tuning your bands against novice intuition — actively harmful. Same UI, opposite purpose: it's now where a coach sees their own calibration improving. Monthly task, so it doesn't get nav parity with Today.

---

## 7. Design system

The token layer is good. `DESIGNER_HANDOFF.md §7` describing it as "ad-hoc dark theme, hardcoded hex, no design tokens" is **stale and wrong** — it's the first doc a designer reads. Fix or delete it.

**One conflation causes every accessibility failure.** `--cc-accent` is doing *fill* duty (3:1 vs adjacent surfaces) and *text* duty (4.5:1). One hex can't do both.

Measured against `--cc-bg: #F7F6F2`:

| Token | Used for | Ratio | |
|---|---|---|---|
| `--cc-accent` `#FF5B04` as text | urgent flags, `.score-low`, PR values, `DIFFERS` | **2.88** | ❌ needs 4.5 |
| `--cc-accent` as focus ring | every `:focus-visible` | **2.88** | ❌ needs 3.0 |
| `--cc-tier-s-fg` on `-bg` | the S badge (12px/700) | **2.88** | ❌ |
| `--cc-quiet` `#B7B3A8` | "ok", "match", "done" | **1.94** | ❌ |
| `--cc-tier-none-fg` | "no assessment" badge | **2.08** | ❌ |
| `--cc-border` `#D3DBDD` | **every input border** | **1.30** | ❌ needs 3.0 |
| `--cc-ink` / `--cc-muted` / `--cc-maturity` / tiers C·B·A | | 12.52 / 5.43 / 8.48 / 6.15·5.13·6.07 | ✅ |

The comment in the CSS reads `/* the PR value — the one number that matters */`. It's painted in the one color that can't be read.

**Fix — split the accent:**

```css
--cc-accent:      #FF5B04;   /* FILLS + MARKS: tier-S bg, load-over bg, bar-fill,
                                left rules, dots. Judged vs adjacent surface. */
--cc-accent-ink:  #B83600;   /* TEXT + FOCUS RINGS. 5.45:1 on --cc-bg. */
```

| Change | New ratio |
|---|---|
| `.flag-accent` color, `.score-low`, `.prog-pr b` → `--cc-accent-ink` | 5.45 ✅ |
| `.flag-accent::before` background → **keep** `--cc-accent` | *the dot is a mark — leave the brightness where it works* |
| `:focus-visible` outline → `--cc-accent-ink` | 5.45 ✅ |
| `--cc-tier-s-fg` `#F7F6F2` → `#231000` | 5.89 ✅ |
| `--cc-over-fg` `#F7F6F2` → `#231000` | 5.89 ✅ |
| `--cc-quiet` → `#736E61` | 4.70 ✅ |
| `--cc-tier-none-fg` → `#666256` | 5.02 ✅ |
| **new** `--cc-border-input: #78848A` (inputs/buttons only) | 3.55 ✅ |
| `--cc-border` `#D3DBDD` — **keep** for decorative table rules | *1.4.11 doesn't apply to decorative dividers, and it's why the tables breathe* |

**Cost, stated honestly:** `#B83600` is a darker, more serious orange. Some of the "field manual with one loud marker" energy is in the brightness. It survives everywhere it works (fills, dots, rules, bars, tier-S background) and retreats only where it's illegible. Look at it before taking my word.

**Keep:** three orthogonal axes with three visual languages (tier = orange ramp, maturity = Midnight Green triangle, load = badge) so a coach can never read "more mature = better." Status as dot + text, never color alone. `@media (pointer: coarse)` target bumps. 16px track inputs (stops iOS zoom). `prefers-reduced-motion` at the top of the sheet.

**Accessibility patterns for the rebuild** (the old fixes were `render.ts` archaeology; the *requirements* survive):
- Autosave/sync status needs `aria-live="polite"` — WCAG 4.1.3. The old build had zero live regions on the one screen where *"did that save?"* is the whole question.
- Tabs → **links** (`?day=2`). Fixes the ARIA gap *and* means assembling one day per request instead of four. Free.
- Filter controls need `aria-pressed` + a live result count.
- Scrollable regions need `tabindex="0"` + `role="region"` + a label — WCAG 2.1.1.
- Form errors need `aria-invalid` + `aria-describedby`.
- Error banners need `role="alert"` + focus.

---

## 8. Set row sync states

The highest-stakes element in the product. The old build's entire failure handling was:

```js
.catch(function(){ setState(row,'Offline — retry','err'); });
```

**Lies twice.** Says "Offline" for any fetch rejection (server down, 500, CORS, DNS). Says "retry" when nothing retries — the value sits in an uncontrolled DOM input until the coach happens to fire another `change` on that field. Phone sleeps, set's gone. **The one state where you most need to not lose data is the one that loses it silently.**

| State | Text | Color | ARIA | Persistence |
|---|---|---|---|---|
| Empty | `—` | `--cc-quiet` | — | nothing written |
| Saving | `Saving…` | `--cc-muted` | polite | in IDB queue |
| Logged | `Logged` ✓ | `--cc-maturity` | polite | confirmed |
| **Queued** | `Queued` ↑ | `--cc-muted` | polite | **in IDB, will send** |
| **Retrying** | `Retrying…` ↻ | `--cc-muted` | polite | in IDB, backoff |
| **Failed** | `Won't save — tap to retry` ⚠ | `--cc-accent-ink` | `role="alert"` | in IDB, needs a human |
| **Rejected** | the validation message ⚠ | `--cc-bad` | `role="alert"` | not queued — the *value* is wrong |

**`Queued` is not an error.** Offline at a field is the *expected condition*. It should be a calm gray that says "I've got it." A coach should be able to log a whole session in airplane mode and see nothing alarming.

**`Rejected` ≠ `Failed`.** "4000kg is not a plausible squat" and "the network is gone" are opposite problems with opposite fixes — one wants the coach to change the number, the other wants them to keep going.

**Header summary**, `aria-live="polite"`: `All 12 sets saved` · `9 saved · 3 waiting to send` · `⚠ 1 set won't save`

**Finish gate — never block:**

```
3 sets haven't sent yet. They'll go out when you're back online —
they're saved on this phone.
              [ Wait ]   [ Finish anyway ]
```

The session *is* over. The coach knows something the app doesn't.

---

## 9. Microcopy rules

Every string in the old build was the only spec for what the real app says. They'd get copied forward verbatim.

| Don't | Do |
|---|---|
| `"tiers & scores are coach-only (§3.3)"` | *"Tiers and raw scores stay coach-only — athletes and parents never see them."* The coach has never read your specs. |
| 60-word footnote explaining PHV, gates, and guardrails under every roster load | Tooltip on the column header it explains. Needed once, in month one — not on every page view forever. |
| `"No wellness checks logged yet. Capture them with npm run wellness."` | Give wellness a form (four fields) or cut the card. A card that tells a coach to open a terminal is worse than no card. |
| `"Save-as-you-go is automatic. This button saves everything at once (needed only without JavaScript)."` | Explains your implementation to a user who doesn't know if they have JavaScript. `<noscript>` it. |
| `"Offline — retry"` | §8. |
| `"Could not assemble Day 2: <raw err.message>"` | *"Day 2 couldn't be built — the template and this athlete's tier don't fit together. Days 1 and 3 are fine."* + collapsed detail. |

---

## 10. Build order

1. **Store interface** + IDB implementation. Everything sits on it; it's the seam that keeps PWA reversible.
2. **`library/assessment_rubric.json`** — copy-paste from your own spec. Cheapest high-value item here.
3. **Schema migration** (§5.1) — `scoresLive`/`scoresReviewed`, `films`, `provisional`.
4. **Assessment form** with criteria on screen. The rubric, in the place judgment happens.
5. **Capture + install gate + `persist()`.**
6. **Review queue + review screen.** Releases provisional caps; without it every athlete is stuck.
7. **`Today`.**
8. **Track screen** + offline queue + honest sync states.
9. **`assembleSession` reasons** + copy layer + rationale panel.
10. **Demo media** — shoot `valgus_relevant ∩ min_tier C` first.
11. **Deviation.**
12. **Re-assess clock.**
13. **Athlete screen (handout).**
14. **Export/import.** *(Move this earlier the moment anyone other than you has data.)*
15. Lab, parent summary.

---

## 11. Retracted from `ux-critique-command-center.md`

That doc was written against the harness. **Dead:**

- Every ARIA fix in §5.2 — tabs pattern, `tablewrap` tabindex, `aria-invalid` in `field()`. All `render.ts` archaeology.
- Component specs keyed to `.trksaved`, `.trk-ex`, `.tab` selectors.
- The §7 priority order — it opens with *"do these before any more surface gets built"* on a codebase now classified as disposable.
- *"Fix it now, it's 10× cheaper than after a React migration"* — argued for work on a codebase you're not migrating.
- **The deviation recommendation as written.** It argued deviation gives the coach agency back and produces assembler-validation data. Both were reasoning about persona 1. See §4.5 for what replaced it.
- The two-speed athlete page (§4.13).

**Survives** (design, not implementation): the token split and ratios, the rubric-as-library-file, `Today` as an IA, the state tables (the *states* are real, the selectors aren't), the accessibility *requirements*, and the microcopy rewrites.

---

## 12. Open

- **Who tunes the thresholds?** `/validation` assumed the coach's gut-call was worth something. For personas 2–3 it isn't. The assembler runs on 127 "unvalidated defaults," a Day-1 plyo ceiling your own notes mark as *"a placeholder ~5 — TODO tune,"* per-tier difficulty bands, and an 8–10 week rotation cadence that's a guess. **You validate the part the coach could have done by eye; you don't validate the part you've asked them to trust completely.** With persona 1 out, there's no in-product mechanism. Probably: a small number of expert design partners, out of band.
- **Wellness** has no front door. CLI-only. Form or cut.
- **Parent summary** — deferred (§4.12).
- **Equipment persistence** — "just today" default is a lean, not a tested decision.
- **Data posture if hosting ever happens.** Roster is names, DOB, sex, standing and sitting height, injury flags, sleep, soreness — a body-measurement dataset on children. On-device makes it moot today. It stops being moot the moment anything syncs.
