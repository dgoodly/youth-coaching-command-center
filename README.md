# Youth Coaching Command Center — Project Seed

This folder is the starting point for building the command center in Claude Code. It
contains the build brief, the coaching/persona instructions, the assessment spec, the
reference program, and the field-form data contract — all in Markdown.

## Read order
1. **`BUILD_BRIEF.md`** — start here. What to build, why, and in what sequence. Includes
   the "Library Update" section (§2A) covering the exercise library.
2. **`Youth_Tiering_Assessment_Spec.md`** — the assessment + scoring engine + data model.
3. **`COACHING_INSTRUCTIONS.md`** — the coaching logic the program assembler must respect.
4. **`4Day_Athletic_Split_Program.md`** — the A/S-tier reference session shape + library seed.
5. **`Field_Form_Data_Contract.md`** — how a completed paper form maps into stored data.
6. **`EXERCISE_LIBRARY.md`** — schema, difficulty model, assembler selection + rotation logic.
7. **`exercise_library.json`** — the populated 116-exercise library (this IS `movements.json`).

## What to build (summary)
A local, single-coach tool: track athletes → run the assessment → assign a non-user-facing
tier (S/A/B/C) → serve the right workout → dashboard across the roster. Build the durable
core (data model, scoring engine, program assembler) clean; the dashboard can be rough.
Local files only (JSON or SQLite); a few dozen athletes max. See the brief for the full
phased sequence and the explicit "do not build yet" list.

## Recommended additions as you go
- **`FEATURE_IDEAS.md`** — append to it whenever you (the coach) wish the dashboard did
  something. These become validated feature requests for the future app.

## Note on formats
If `.docx`/`.pdf` versions of the spec, program, or field form are also dropped in here,
they're the polished human-facing copies. The Markdown files are the machine-facing source
of truth for building.
