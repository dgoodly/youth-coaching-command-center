/**
 * Local dashboard server — DISPOSABLE surface (BUILD_BRIEF Phase 3). Plain node:http, no deps,
 * server-rendered HTML read live from the JSON store. Three views:
 *   /            roster overview — tier, last assessment, due-for-reassessment, PHV flag
 *   /athlete?id= individual — tier history, per-test score trends, height/maturity, workout log
 *   /validation  calculated tier vs coach gut-call across the roster + gate-firing tally
 *
 * Run: `npm run dashboard` then open http://localhost:5173
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { Assessment, AthleteProfile, SetLogEntry, Tier } from '../engine/types.ts';
import { SCORE_KEYS, TIER_STAGE } from '../engine/types.ts';
import { computeMaturity } from '../engine/maturity.ts';
import { checkVolumeGuardrails, type GuardrailStatus } from '../engine/guardrails.ts';
import {
  allAthletes, assessmentsFor, latestAssessment, heightLogFor, workoutLogFor, wellnessLogFor,
  setLogFor, setLogForExercise, setLogForWorkout, groupSetsByExercise, blockStateFor,
  daysSince, dueForReassessment, nextTrackDay, parseDayLabel,
} from '../store/query.ts';
import { ageFromDob, createAthlete, updateAthlete, findAthlete } from '../store/athletes.ts';
import { readCollection } from '../store/json-store.ts';
import { buildAssessmentRecord, saveAssessment } from '../store/ingest.ts';
import { getOrCreateWorkout, setWorkoutCompleted } from '../store/workout.ts';
import { saveSetLog, upsertSet, removeSet, type NewSetLog } from '../store/setlog.ts';
import { validateSetValues } from '../engine/metrics.ts';
import {
  splitOf, SPLIT_DAYS, getOrInitBlockState, saveBlockState, switchSplit,
} from '../store/blocks.ts';
import {
  loadExercises, loadDayTemplates, loadAvailableEquipment,
} from '../store/library.ts';
import { tierDose, doseLabel, isAvailableAtTier, type Exercise } from '../engine/program.ts';
import { assembleSession } from '../engine/assembler.ts';
import { computeExerciseProgress, type ExerciseProgress, type MetricProgress } from '../engine/progress.ts';
import {
  page, esc, tierBadge, table, sessionHtml, planTabs, sparkline,
  rosterTable, triageCards, statCard, statStrip, card, num, statusFlag, maturityMarker, bar,
  type RosterRow, type TriageCard,
} from './render.ts';
import {
  SCORE_LABEL, SPLIT_LABEL, SPLIT_SHORT, splitSwitchForm, validateSplitSwitch,
  emptyAthleteValues, athleteValuesFromParams, athleteValuesFromProfile, validateAthleteForm, athleteFormPage,
  emptyAssessmentValues, assessmentValuesFromParams, validateAssessmentForm, assessmentFormPage, assessmentRevealPage,
  resolveMetrics, todayIso, trackPage, parseTrackSave,
  type TrackContext, type TrackNode, type TrackBlockView,
} from './forms.ts';

const PORT = Number(process.env.CC_DASHBOARD_PORT ?? 5173);

/** Re-assess cell: accent dot+text when due/never, quiet when recent. */
function reassessCell(latest: Assessment | null): string {
  if (!latest) return statusFlag('accent', 'no assessment');
  const days = daysSince(latest.date);
  return days >= 42
    ? statusFlag('accent', `due · ${days}d`)
    : statusFlag('quiet', `${days}d ago`);
}

// ---------------------------------------------------------------------------
// Roster overview — a triage surface: who needs re-assessing, who's near PHV, who's over-loaded.
// ---------------------------------------------------------------------------

async function rosterPage(): Promise<string> {
  const athletes = await allAthletes();
  const rows: RosterRow[] = [];
  let needReassess = 0;
  let nearPHVCount = 0;
  let overLoad = 0;

  for (const a of athletes) {
    const latest = await latestAssessment(a.athleteId);
    const heights = await heightLogFor(a.athleteId);
    const maturity = computeMaturity(heights, { dob: a.dob, sex: a.sex });
    const block = await blockStateFor(a.athleteId);
    const age = ageFromDob(a.dob);
    const guard = checkVolumeGuardrails({
      age, weeklySportHours: a.weeklySportHours,
      weeklyTrainingHours: a.weeklyTrainingHours, restDaysPerWeek: a.restDaysPerWeek,
    });

    // Triage flags — the actionable-now states (drive the wash + the filter cards).
    const reassess = !latest || daysSince(latest.date) >= 42;
    const load: 'over' | 'watch' | null = guard.anyExceeded ? 'over' : guard.anyWatch ? 'watch' : null;
    if (reassess) needReassess++;
    if (maturity.nearPHV) nearPHVCount++;
    if (load === 'over') overLoad++;

    const nameCell = `<a class="row" href="/athlete?id=${encodeURIComponent(a.athleteId)}">${esc(a.displayName)}</a>`
      + (a.valgusWatch ? ' <span class="pill">valgus</span>' : '');
    const velocityCell = maturity.velocityCmPerYear !== null
      ? maturityMarker(`${maturity.velocityCmPerYear.toFixed(1)} cm/yr${maturity.nearPHV ? ' · PHV' : ''}`, maturity.nearPHV)
      : '<span class="muted">—</span>';
    const loadCell = load === 'over'
      ? '<span class="load-over">over</span>'
      : load === 'watch' ? '<span class="load-watch">watch</span>' : '<span class="muted">—</span>';

    rows.push({
      cells: [
        nameCell,
        age !== null ? num(String(age)) : '<span class="muted">—</span>',
        tierBadge(latest?.finalTier ?? null),
        latest ? num(latest.date) : '<span class="muted">never</span>',
        reassessCell(latest),
        velocityCell,
        loadCell,
        `<span class="pill data">block ${block ? block.blockIndex : 0} · ${SPLIT_SHORT[splitOf(block)]}</span>`,
      ],
      reassess,
      nearPHV: maturity.nearPHV,
      load,
      urgent: reassess || load === 'over',
    });
  }

  const cards: TriageCard[] = [
    { filter: 'all', count: athletes.length, label: 'All athletes' },
    { filter: 'reassess', count: needReassess, label: 'Needs re-assessing', tone: 'accent' },
    { filter: 'phv', count: nearPHVCount, label: 'Near PHV', tone: 'maturity' },
    { filter: 'load-over', count: overLoad, label: 'Load over', tone: 'accent' },
  ];

  const body = `<h1>Roster</h1>
    <p class="sub">${athletes.length} athlete${athletes.length === 1 ? '' : 's'} · tiers &amp; scores are coach-only (§3.3)</p>
    ${triageCards(cards)}
    <p class="actions"><a class="btn" href="/athlete/new">+ New athlete</a></p>
    ${rosterTable(
      ['Athlete', 'Age', 'Tier', 'Last assessment', 'Re-assess', 'Height velocity', 'Load', 'Block'],
      rows,
      'No athletes yet. Add one with `npm run enter`.',
    )}
    <p class="muted" style="margin-top:14px">Re-assess fires at ≥ 6 weeks (spec §6). Height velocity ≥ 7 cm/yr = near-PHV → dose pullback (dose only, not tier; shown in Midnight Green, a separate axis). Load = specialization/volume guardrails (weekly hours ≤ age · sport &lt; 16 h · ≥ 1–2 rest days).</p>`;
  return page('Roster', body, 'roster');
}

// ---------------------------------------------------------------------------
// Individual athlete view
// ---------------------------------------------------------------------------

function gutCell(a: Assessment): string {
  if (!a.coachGutCall) return '<span class="muted">—</span>';
  const match = a.coachGutCall === a.finalTier;
  const verdict = match
    ? '<span class="flag flag-quiet">match</span>'
    : '<span class="flag flag-accent">differs</span>';
  return `${tierBadge(a.coachGutCall)} ${verdict}`;
}

/** Inline mark-done / reopen control for a session row (the coach's explicit completion action). */
function completeToggleForm(workoutId: string, completed: boolean): string {
  const target = completed ? '0' : '1';
  const label = completed ? 'Reopen' : 'Mark done';
  return `<form class="inlineform" method="post" action="/workout/complete?workoutId=${encodeURIComponent(workoutId)}">`
    + `<input type="hidden" name="completed" value="${target}">`
    + `<button class="btn secondary mini" type="submit">${label}</button></form>`;
}

/** One exercise's PR + per-session trend row for the Progress card (only metrics with data show). */
function progressExerciseHtml(name: string, prog: ExerciseProgress): string {
  const rows = prog.metrics.filter((m) => m.best !== null).map((m) => {
    const values = m.series.map((pt) => pt.value);
    const pr = `<span class="prog-pr">PR <b>${esc(String(m.best))} ${esc(m.unit)}</b></span>`;
    const last = m.last !== null ? `<span class="prog-last">last ${esc(String(m.last))} ${esc(m.unit)}</span>` : '';
    const spark = sparkline(values, `${m.label}: ${values.join(' → ')} ${m.unit}`);
    return `<div class="prog-metric"><span class="prog-lab">${esc(m.label)}</span>${pr}${last}${spark}</div>`;
  }).join('');
  if (!rows) return '';
  return `<div class="prog-ex"><div class="prog-ex-head"><b>${esc(name)}</b>`
    + `<span class="sessions">${prog.sessionCount} session${prog.sessionCount === 1 ? '' : 's'}</span></div>${rows}</div>`;
}

/** "Progress & PRs" card body — one row per logged exercise, most recently trained first. */
function progressCardBody(setEntries: SetLogEntry[], exercises: Exercise[]): string {
  const groups = groupSetsByExercise(setEntries);
  if (groups.size === 0) return '<p class="empty">No sets logged yet — use “Log” on a plan exercise to start tracking PRs.</p>';
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const rows: { html: string; lastAt: number }[] = [];
  for (const [exId, sets] of groups) {
    const ex = byId.get(exId);
    if (!ex) continue;
    const html = progressExerciseHtml(ex.name, computeExerciseProgress(exId, ex.metrics, sets));
    if (html) rows.push({ html, lastAt: Math.max(...sets.map((s) => Date.parse(s.loggedAt))) });
  }
  rows.sort((a, b) => b.lastAt - a.lastAt);
  return rows.map((r) => r.html).join('') || '<p class="empty">No logged metrics yet.</p>';
}

/**
 * "Current plan" section: the athlete's active training split (2/3/4-day, from `splitOf`),
 * rendered as instant client-side day tabs (Day 1 default). Each day is the fully assembled
 * session for (tier + that day's template + the athlete's block state). The day COUNT comes from
 * the split (coach's per-athlete choice); the tier still governs the content/dose inside each day.
 * A compact split-switch form sits above the tabs.
 */
async function planSection(athleteId: string, tier: Tier | null, valgusWatch: boolean, exercises: Exercise[]): Promise<string> {
  const [templates, equipment, block] = await Promise.all([
    loadDayTemplates(), loadAvailableEquipment(), blockStateFor(athleteId),
  ]);
  const split = splitOf(block);
  const switchForm = splitSwitchForm(athleteId, split);

  if (!tier) {
    return `<p class="sub">Split: <b>${esc(SPLIT_LABEL[split])}</b></p>${switchForm}`
      + '<p class="empty">No assessment yet — assign a tier to see the assembled plan.</p>';
  }

  // Only assemble days the split runs AND that have an authored template.
  const days = SPLIT_DAYS[split].filter((d) => templates.some((t) => t.day === d));

  const panels = days.map((day) => {
    const template = templates.find((t) => t.day === day);
    // Assembling a day can throw (e.g. a misconfigured template hits the hard sequencing guard).
    // Contain it to this one panel so the athlete page still renders instead of 500ing.
    try {
      if (!template) throw new Error(`no day template for day ${day}`);
      const { session } = assembleSession({
        tier, day, exercises, template, valgusWatch, equipment,
        blockIndex: block?.blockIndex ?? 0, slotVariants: block?.slotVariants,
      });
      // Plan view is READ-ONLY reference (PHASE_PLAN_track_workout_screen.md Step 1): no inline
      // logging affordance. Field-logging lives on the dedicated Track-workout screen, so logging
      // never lives in two places. Reviewing a prescription and logging a session are different
      // jobs that want opposite designs — this view scans, the track screen inputs.
      const blocks = session.blocks.map((b) => ({
        title: b.title,
        items: b.items.map((it) => ({
          name: it.exercise.name,
          doseText: it.doseText,
          tags: [
            it.exercise.laterality === 'unilateral' ? 'SL' : null,
            it.exercise.stick ? 'stick' : null,
            `d${it.exercise.difficulty}`,
          ].filter((x): x is string => x !== null),
          cue: it.exercise.cue,
        })),
      }));
      const note = `<p class="panel-note">${esc(session.label)} · sprint: ${esc(session.sprintEmphasis)}</p>`;
      return { label: `Day ${day}`, html: note + sessionHtml(blocks) };
    } catch (err) {
      return { label: `Day ${day}`, html: `<p class="flag">Could not assemble Day ${day}: ${esc((err as Error).message)}</p>` };
    }
  });

  return `<p class="sub">On <b>${esc(SPLIT_LABEL[split])}</b> · ${days.length} day${days.length === 1 ? '' : 's'}/week · tier ${esc(tier)}</p>`
    + switchForm
    + planTabs(panels);
}

async function athletePage(id: string): Promise<string> {
  const athletes = await allAthletes();
  const a = athletes.find((x) => x.athleteId === id);
  if (!a) return page('Not found', '<h1>Athlete not found</h1><p><a href="/">← Roster</a></p>');

  const assessments = await assessmentsFor(id); // oldest → newest
  const heights = await heightLogFor(id);
  const workouts = await workoutLogFor(id);
  const wellness = await wellnessLogFor(id);
  const setEntries = await setLogFor(id);
  const exerciseLib = await loadExercises();
  const maturity = computeMaturity(heights, { dob: a.dob, sex: a.sex });
  const age = ageFromDob(a.dob);

  // Tier history (newest first).
  const historyRows = [...assessments].reverse().map((as) => [
    num(as.date),
    num(`${as.rawTotal}/18`),
    tierBadge(as.baseTier),
    tierBadge(as.finalTier),
    as.gateFired === 'none' ? '<span class="muted">none</span>' : `<code>${esc(as.gateFired)}</code>`,
    gutCell(as),
  ]);

  // Per-test score trends (columns = assessment dates, rows = tests).
  let trends = '<p class="empty">No assessments yet.</p>';
  if (assessments.length > 0) {
    const dateHeaders = assessments.map((as) => esc(as.date));
    const rows = SCORE_KEYS.map((k) => [
      SCORE_LABEL[k]!,
      ...assessments.map((as) => {
        const v = as.scores[k];
        const cls = v <= 1 ? 'num score-low' : v >= 3 ? 'num score-high' : 'num';
        return `<span class="${cls}">${v}</span>`;
      }),
    ]);
    trends = table(['Test', ...dateHeaders], rows);
  }

  // Set counts per session — the "has data / in progress" signal (distinct from `completed`,
  // which is only ever the coach's explicit "done"). A half-logged session must NOT read as done.
  const setsByWorkout = new Map<string, number>();
  for (const s of setEntries) setsByWorkout.set(s.workoutId, (setsByWorkout.get(s.workoutId) ?? 0) + 1);

  const today = todayIso();
  const workoutRows = workouts.map((w) => {
    const n = setsByWorkout.get(w.workoutId) ?? 0;
    const status = w.completed
      ? statusFlag('quiet', 'done')
      : n > 0
        ? statusFlag('accent', 'in progress')
        : '<span class="muted">planned</span>';
    // Step 6: an in-progress session picked up TODAY can be resumed in the track screen (it resumes
    // by today's date). Older in-progress sessions stay visible but have no in-place resume.
    const day = parseDayLabel(w.sessionLabel);
    const resume = !w.completed && n > 0 && w.date === today && day !== null
      ? `<a class="btn secondary mini" href="/athlete/track?id=${encodeURIComponent(id)}&day=${day}">Resume</a> `
      : '';
    return [
      num(w.date), esc(w.sessionLabel), tierBadge(w.servedForTier),
      status,
      n > 0 ? num(String(n)) : '<span class="muted">—</span>',
      esc(w.coachNotes) || '<span class="muted">—</span>',
      resume + completeToggleForm(w.workoutId, w.completed),
    ];
  });

  const heightRows = heights.map((hh) => [
    num(hh.date),
    num(`${hh.heightCm} cm`),
    hh.sittingHeightCm != null ? num(`${hh.sittingHeightCm} cm`) : '<span class="muted">—</span>',
    `<span class="pill data">${esc(hh.source)}</span>`,
  ]);

  const wellnessRows = wellness.map((w) => [
    num(w.date),
    w.sleepHours != null ? num(`${w.sleepHours} h`) : '<span class="muted">—</span>',
    w.soreness != null ? num(String(w.soreness)) : '<span class="muted">—</span>',
    w.energy != null ? num(String(w.energy)) : '<span class="muted">—</span>',
    esc(w.notes ?? '') || '<span class="muted">—</span>',
  ]);

  // Specialization / volume guardrails (COACHING_INSTRUCTIONS "SAFETY / DON'T").
  const guard = checkVolumeGuardrails({
    age, weeklySportHours: a.weeklySportHours,
    weeklyTrainingHours: a.weeklyTrainingHours, restDaysPerWeek: a.restDaysPerWeek,
  });
  const guardCell: Record<GuardrailStatus, string> = {
    ok: statusFlag('quiet', 'ok'),
    watch: '<span class="load-watch">watch</span>',
    exceeded: '<span class="load-over">exceeded</span>',
    unknown: '<span class="muted">unknown</span>',
  };
  const guardRows = guard.findings.map((f) => [guardCell[f.status], esc(f.message)]);

  // Maturity-offset estimate line (Moore/Fransen), shown when computable.
  const estLine = maturity.maturityOffsetYears !== null
    ? `<p>Maturity estimate: <b>${esc(maturity.phvBand?.toUpperCase() ?? '')}-PHV</b> · offset ${num(`${maturity.maturityOffsetYears >= 0 ? '+' : '−'}${Math.abs(maturity.maturityOffsetYears).toFixed(1)} yr`)} · est. age at PHV ${num(maturity.estimatedAgeAtPHV!.toFixed(1))} <span class="muted">(${esc(maturity.method ?? '')})</span></p>`
    : `<p class="muted">Maturity estimate unavailable — ${esc(maturity.method ?? 'set DOB, sex, and (for boys) sitting height')}.</p>`;

  const noteLine = maturity.nearPHV
    ? `<p>${maturityMarker('near PHV', true)} ${esc(maturity.note)}</p>`
    : `<p class="muted">${esc(maturity.note)}</p>`;

  const tier = await currentTierOf(id);
  const planHtml = await planSection(id, tier, a.valgusWatch, exerciseLib);

  // At-a-glance summary strip — the three axes kept visually distinct (tier ramp vs Midnight Green).
  const maturityBand = maturity.phvBand ? `${maturity.phvBand.toUpperCase()}-PHV` : null;
  const maturitySub = maturity.maturityOffsetYears !== null
    ? `offset ${maturity.maturityOffsetYears >= 0 ? '+' : '−'}${Math.abs(maturity.maturityOffsetYears).toFixed(1)} yr`
    : maturity.velocityCmPerYear !== null ? `${maturity.velocityCmPerYear.toFixed(1)} cm/yr` : 'needs 2 height entries';
  const loadValue = guard.anyExceeded
    ? '<span class="load-over">over</span>'
    : guard.anyWatch ? '<span class="load-watch">watch</span>' : statusFlag('quiet', 'ok');
  const summary = statStrip([
    statCard('Current tier', tierBadge(tier), tier ? esc(TIER_STAGE[tier]) : 'No assessment on file'),
    statCard('Maturity (dose axis)',
      maturityBand ? maturityMarker(maturityBand, maturity.nearPHV) : '<span class="muted">—</span>',
      maturitySub),
    statCard('Training load', loadValue, guard.anyExceeded ? 'guardrail exceeded' : guard.anyWatch ? 'watch a guardrail' : 'within guardrails'),
  ]);

  const body = `
    <p class="sub"><a href="/">← Roster</a></p>
    <h1>${esc(a.displayName)} ${a.valgusWatch ? '<span class="pill">valgus watch</span>' : ''}</h1>
    <p class="sub">
      ${age !== null ? `Age ${num(String(age))} · ` : ''}${esc(a.sports.join(', ') || 'no sports listed')} ·
      ${num(String(a.trainingMonths))} mo training
    </p>
    <div class="actions">
      <a class="btn" href="/athlete/track?id=${encodeURIComponent(a.athleteId)}">Track workout</a>
      <a class="btn secondary" href="/assessment/new?athleteId=${encodeURIComponent(a.athleteId)}">+ Enter assessment</a>
      <a class="btn secondary" href="/athlete/edit?id=${encodeURIComponent(a.athleteId)}">Edit athlete</a>
    </div>

    ${summary}

    ${card('Current plan', planHtml)}

    ${card('Maturity — dose axis, independent of tier', `${noteLine}${estLine}
      ${table(['Date', 'Standing', 'Sitting', 'Source'], heightRows, 'No height entries logged.')}`)}

    ${card('Tier history', table(['Date', 'Raw', 'Base', 'Final', 'Gate', 'Gut-call'], historyRows, 'No assessments yet.'))}

    ${card('Score trends — per test, 0–3', trends)}

    ${card('Training-load guardrails — specialization / volume', table(['Status', 'Guardrail'], guardRows, 'No guardrail data.'))}

    ${card('Wellness — weekly load / growth check', table(['Date', 'Sleep', 'Soreness (1–5)', 'Energy (1–5)', 'Notes'], wellnessRows, 'No wellness checks logged. Add with `npm run wellness`.'))}

    ${card('Progress & PRs — per exercise, coach-only', progressCardBody(setEntries, exerciseLib))}

    ${card('Workout log', `${table(['Date', 'Session', 'Tier', 'Status', 'Sets', 'Notes', ''], workoutRows, 'No sessions logged.')}
      <p class="muted" style="margin-bottom:0"><b>In progress</b> = sets logged but not yet marked done. <b>Done</b> is an explicit coach action, not a side effect of logging.</p>`)}
  `;
  return page(a.displayName, body);
}

async function currentTierOf(id: string): Promise<Tier | null> {
  const latest = await latestAssessment(id);
  return latest?.finalTier ?? null;
}

// ---------------------------------------------------------------------------
// Validation view — the threshold-tuning surface (BUILD_BRIEF §3.7)
// ---------------------------------------------------------------------------

async function validationPage(): Promise<string> {
  const assessments = await readCollection('assessments');
  const athletes = await allAthletes();
  const nameOf = (aid: string) => athletes.find((x) => x.athleteId === aid)?.displayName ?? aid;

  const withGut = assessments.filter((a) => a.coachGutCall !== null);
  const matches = withGut.filter((a) => a.coachGutCall === a.finalTier).length;
  const differs = withGut.length - matches;

  const compareRows = withGut.map((a) => {
    const match = a.coachGutCall === a.finalTier;
    return [
      num(a.date), esc(nameOf(a.athleteId)), num(`${a.rawTotal}/18`),
      tierBadge(a.finalTier), tierBadge(a.coachGutCall),
      match ? statusFlag('quiet', 'match') : statusFlag('accent', 'DIFFERS'),
      a.gateFired === 'none' ? '<span class="muted">—</span>' : `<code>${esc(a.gateFired)}</code>`,
    ];
  });

  // Gate-firing tally, rendered as bars (this is an analysis screen — deltas over tables).
  const gateCounts = new Map<string, number>();
  for (const a of assessments) gateCounts.set(a.gateFired, (gateCounts.get(a.gateFired) ?? 0) + 1);
  const sortedGates = [...gateCounts.entries()].sort((x, y) => y[1] - x[1]);
  const maxGate = sortedGates.reduce((m, [, n]) => Math.max(m, n), 0);
  const gateRows = sortedGates.map(([g, n]) => [
    g === 'none' ? '<span class="muted">none</span>' : `<code>${esc(g)}</code>`,
    bar(maxGate ? (n / maxGate) * 100 : 0, String(n), g !== 'none'),
  ]);

  const agreement = withGut.length ? Math.round((matches / withGut.length) * 100) : 0;

  const summary = statStrip([
    statCard('With a gut-call', num(String(withGut.length)), `of ${assessments.length} assessment${assessments.length === 1 ? '' : 's'}`),
    statCard('Agreement', `${num(String(agreement))}%`, `${matches} match · ${differs} differ`),
    statCard('Agreement rate', bar(agreement, `${agreement}%`, agreement < 60), 'computed vs coach gut-call'),
  ]);

  const body = `
    <h1>Validation</h1>
    <p class="sub">Calculated tier vs coach gut-call, and which gates fire — the surface that tunes the
      score bands &amp; gate thresholds against real athletes (BUILD_BRIEF §3.7).</p>

    ${summary}

    ${card('Gate-firing tally', `${table(['Gate', 'Count'], gateRows, 'No assessments yet.')}
      <p class="muted" style="margin-bottom:0">If a gate fires far more/less than expected, that is a signal to tune its
      threshold (spec §4 / §8). <code>capC</code> = squat/drop-stick &lt; 2 · <code>capA</code> =
      drop-stick = 2 · <code>S-&gt;A</code> = S without a perfect stick.</p>`)}

    ${card('Calculated vs gut-call', table(['Date', 'Athlete', 'Raw', 'Calculated', 'Gut-call', 'Verdict', 'Gate'], compareRows,
      'No gut-calls captured yet — enter assessments with a gut-call for validation data.'))}
  `;
  return page('Validation', body, 'validation');
}

// ---------------------------------------------------------------------------
// Write surface (Phase 2) — forms, server-side validation, POST handlers
// ---------------------------------------------------------------------------
//
// Boundary rule (BUILD_BRIEF §1): these handlers parse+validate browser input and then call
// the SAME store write functions the CLIs use (`createAthlete`/`updateAthlete`/`saveAssessment`).
// They never recompute a tier, apply the CAP rule, or assemble a session inline — that logic
// lives in `store/*` and `engine/*` behind the existing interfaces. The browser is a thin,
// untrusted front door to the trusted engine.

/** Read a urlencoded request body (plain forms only — no framework, no multipart). Bounded. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendHtml(res: ServerResponse, code: number, html: string): void {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location }); // 303 → GET the target after a write (PRG pattern)
  res.end();
}
function notFoundPage(): string {
  return page('Not found', '<h1>404</h1><p><a href="/">← Roster</a></p>');
}

// --- athlete create / edit ---

async function athleteNewFormPage(): Promise<string> {
  return athleteFormPage('new', emptyAthleteValues(), {});
}
async function athleteEditFormPage(id: string): Promise<string> {
  const a = await findAthlete(id);
  if (!a) return notFoundPage();
  return athleteFormPage('edit', athleteValuesFromProfile(a), {}, id);
}
async function handleAthleteNew(params: URLSearchParams, res: ServerResponse): Promise<void> {
  const values = athleteValuesFromParams(params);
  const { input, errors } = validateAthleteForm(values);
  if (!input) return sendHtml(res, 400, athleteFormPage('new', values, errors));
  const created = await createAthlete(input);
  redirect(res, `/athlete?id=${encodeURIComponent(created.athleteId)}`);
}
async function handleAthleteEdit(id: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  if (!(await findAthlete(id))) return sendHtml(res, 404, notFoundPage());
  const values = athleteValuesFromParams(params);
  const { input, errors } = validateAthleteForm(values);
  if (!input) return sendHtml(res, 400, athleteFormPage('edit', values, errors, id));
  await updateAthlete(id, input);
  redirect(res, `/athlete?id=${encodeURIComponent(id)}`);
}

// --- assessment entry (gut-call BEFORE reveal, §3.7) ---

async function assessmentNewFormPage(athleteId: string): Promise<string> {
  const a = await findAthlete(athleteId);
  if (!a) return notFoundPage();
  return assessmentFormPage(a, emptyAssessmentValues(), {});
}
async function handleAssessmentNew(athleteId: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const athlete = await findAthlete(athleteId);
  if (!athlete) return sendHtml(res, 404, notFoundPage());
  const values = assessmentValuesFromParams(params);
  const { input, errors } = validateAssessmentForm(athleteId, values);
  if (!input) return sendHtml(res, 400, assessmentFormPage(athlete, values, errors));
  const built = buildAssessmentRecord(input); // engine recomputes tier — never done inline here
  const saved = await saveAssessment(built);
  sendHtml(res, 200, assessmentRevealPage(athlete, built.warnings, saved));
}

// --- split switch (Phase 3) ---

async function handleSplitSwitch(id: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  if (!(await findAthlete(id))) return sendHtml(res, 404, notFoundPage());
  const parsed = validateSplitSwitch(params);
  if (!parsed) return sendHtml(res, 400, page('Bad request', '<h1>Invalid split choice</h1><p><a href="/">← Roster</a></p>'));
  // getOrInit → apply the switch (fresh resets rotation, carry keeps it) → persist as one write.
  const next = switchSplit(await getOrInitBlockState(id), parsed.split, parsed.mode);
  await saveBlockState(next);
  redirect(res, `/athlete?id=${encodeURIComponent(id)}`);
}

// --- Track-workout screen (PHASE_PLAN_track_workout_screen.md Steps 2–6) ---

/** A helper page for the track/log guard rails (no tier yet, unknown exercise, etc.). */
function logGuardPage(athleteId: string, heading: string, msg: string): string {
  const back = athleteId ? `/athlete?id=${encodeURIComponent(athleteId)}` : '/';
  return page('Track', `<p class="sub"><a href="${esc(back)}">← Back</a></p><h1>${esc(heading)}</h1><p>${esc(msg)}</p>`);
}

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/**
 * Resolve the pre-conditions a single-set write shares: athlete exists, has a tier, the exercise
 * exists, is individually loggable, and is prescribed at this tier. Reused by the autosave endpoint
 * so a stale/hand-built request can't log a movement the athlete's tier doesn't run (mirrors
 * `isAvailableAtTier`, the same gate the assembler uses).
 */
async function resolveLogTarget(
  athleteId: string, dayStr: string, exerciseId: string,
): Promise<{ ok: true; athlete: AthleteProfile; day: number; exercise: Exercise; tier: Tier }
  | { ok: false; code: number; html: string }> {
  const athlete = await findAthlete(athleteId);
  if (!athlete) return { ok: false, code: 404, html: notFoundPage() };
  const day = Number(dayStr);
  if (!Number.isInteger(day)) return { ok: false, code: 404, html: notFoundPage() };
  const tier = await currentTierOf(athleteId);
  if (!tier) return { ok: false, code: 400, html: logGuardPage(athleteId, 'No tier on file', 'Enter an assessment before tracking a session — the prescription comes from the athlete’s tier.') };
  const exercise = (await loadExercises()).find((e) => e.id === exerciseId);
  if (!exercise) return { ok: false, code: 404, html: notFoundPage() };
  if (exercise.metrics.length === 0) return { ok: false, code: 400, html: logGuardPage(athleteId, 'Not a logged movement', `${exercise.name} isn’t individually logged (warm-up / funnel / cooldown / motor-skill).`) };
  if (!isAvailableAtTier(exercise, tier)) {
    return { ok: false, code: 400, html: logGuardPage(athleteId, 'Not prescribed at this tier', `${exercise.name} isn’t in tier ${tier}’s program, so there’s no target to log against.`) };
  }
  return { ok: true, athlete, day, exercise, tier };
}

/**
 * Assemble everything the Track-workout screen renders: the chosen day (an explicit valid `day`
 * param wins, else the next-day default from `nextTrackDay`), its full assembled session split into
 * read-only reference slots and trackable movement cards, each trackable movement pre-filled from
 * PRIOR sessions (today's excluded, so "last time" means the previous session) and resumed with any
 * sets already logged for this day today. No write happens here — the session record is created
 * lazily on the first set save.
 */
async function buildTrackContext(
  athleteId: string, dayStr: string,
): Promise<{ ok: true; ctx: TrackContext } | { ok: false; code: number; html: string }> {
  const athlete = await findAthlete(athleteId);
  if (!athlete) return { ok: false, code: 404, html: notFoundPage() };
  const tier = await currentTierOf(athleteId);
  if (!tier) return { ok: false, code: 400, html: logGuardPage(athleteId, 'No tier on file', 'Enter an assessment before tracking a session — the prescription comes from the athlete’s tier.') };

  const [templates, equipment, block, exercises, allSets, workouts] = await Promise.all([
    loadDayTemplates(), loadAvailableEquipment(), blockStateFor(athleteId), loadExercises(),
    setLogFor(athleteId), workoutLogFor(athleteId),
  ]);
  const split = splitOf(block);
  const days = SPLIT_DAYS[split].filter((d) => templates.some((t) => t.day === d));
  if (days.length === 0) return { ok: false, code: 400, html: logGuardPage(athleteId, 'No plan days', 'No authored day templates for this athlete’s split.') };

  // Explicit valid day wins; otherwise the next-day default (which reads only real sessions).
  let day = Number(dayStr);
  if (!Number.isInteger(day) || !days.includes(day)) {
    day = await nextTrackDay(athleteId);
    if (!days.includes(day)) day = days[0]!;
  }
  const template = templates.find((t) => t.day === day)!;
  const date = todayIso();

  // Resume today's session for this day if it exists — WITHOUT creating one (lazy creation).
  const workout = workouts.find((w) => w.date === date && w.sessionLabel === `Day ${day}`) ?? null;
  const savedByExercise = workout ? await setLogForWorkout(workout.workoutId) : new Map<string, SetLogEntry[]>();
  const loggedSetCount = [...savedByExercise.values()].reduce((n, a) => n + a.length, 0);

  // Pre-fill source = history EXCLUDING today's session, so the "last time" hint is the prior session.
  const priorByExercise = groupSetsByExercise(workout ? allSets.filter((s) => s.workoutId !== workout.workoutId) : allSets);

  try {
    const { session } = assembleSession({
      tier, day, exercises, template, valgusWatch: athlete.valgusWatch, equipment,
      blockIndex: block?.blockIndex ?? 0, slotVariants: block?.slotVariants,
    });
    const blocks: TrackBlockView[] = session.blocks.map((b) => ({
      title: b.title,
      nodes: b.items.map((it): TrackNode => {
        const ex = it.exercise;
        const tags = [
          ex.laterality === 'unilateral' ? 'SL' : null,
          ex.stick ? 'stick' : null,
          `d${ex.difficulty}`,
        ].filter((x): x is string => x !== null);
        if (ex.metrics.length === 0) {
          return { kind: 'reference', name: ex.name, doseText: it.doseText, tags, cue: ex.cue };
        }
        const dose = tierDose(ex, tier);
        const saved = (savedByExercise.get(ex.id) ?? []).map((s) => ({
          setIndex: s.setIndex, values: s.values, ...(s.note ? { note: s.note } : {}),
        }));
        return {
          kind: 'track',
          ex: {
            exerciseId: ex.id, name: ex.name, targetText: doseLabel(ex, tier),
            prescribedSets: dose?.sets ?? 1, ...(dose ? { prescribedReps: dose.reps } : {}),
            metrics: resolveMetrics(ex.metrics),
            priors: computeExerciseProgress(ex.id, ex.metrics, priorByExercise.get(ex.id) ?? []).metrics,
            savedSets: saved,
          },
        };
      }),
    }));
    const ctx: TrackContext = {
      athleteId, athleteName: athlete.displayName, day, days, date, tier,
      sessionSubtitle: `${session.label} · sprint: ${session.sprintEmphasis}`,
      blocks, workoutId: workout?.workoutId ?? null, completed: workout?.completed ?? false, loggedSetCount,
    };
    return { ok: true, ctx };
  } catch (err) {
    return { ok: false, code: 500, html: logGuardPage(athleteId, 'Could not assemble session', (err as Error).message) };
  }
}

async function trackScreen(athleteId: string, dayStr: string): Promise<{ code: number; html: string }> {
  const r = await buildTrackContext(athleteId, dayStr);
  if (!r.ok) return { code: r.code, html: r.html };
  return { code: 200, html: trackPage(r.ctx) };
}

/** Read one set's typed values from the params (`val~<metricId>`), skipping blanks. */
function readSetValues(metricIds: string[], params: URLSearchParams): { values: Record<string, number>; hasValue: boolean } {
  const values: Record<string, number> = {};
  let hasValue = false;
  for (const mid of metricIds) {
    const raw = (params.get(`val~${mid}`) ?? '').trim();
    if (raw === '') continue;
    hasValue = true;
    values[mid] = Number(raw);
  }
  return { values, hasValue };
}

/**
 * Autosave ONE set (save-as-you-go). Lazily create-or-finds the session on the first real set, then
 * upserts by (workout, exercise, setIndex) so a re-save corrects rather than duplicates. A cleared
 * row (no values) removes any previously-saved set at that identity — the honest log holds an
 * actual only while the coach keeps a value in it. JSON in, JSON out (the client shows "Logged").
 */
async function handleTrackSet(athleteId: string, dayStr: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const r = await resolveLogTarget(athleteId, dayStr, params.get('exerciseId') ?? '');
  if (!r.ok) return sendJson(res, r.code, { ok: false, error: 'This movement can’t be logged here.' });
  const setIndex = Number(params.get('setIndex'));
  if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > 50) return sendJson(res, 400, { ok: false, error: 'Bad set number.' });

  const date = todayIso();
  const { values, hasValue } = readSetValues(r.exercise.metrics, params);
  if (!hasValue) {
    // Emptied row → drop any set previously logged at this identity (find, don't create).
    const workout = (await workoutLogFor(athleteId)).find((w) => w.date === date && w.sessionLabel === `Day ${r.day}`);
    if (workout) await removeSet({ workoutId: workout.workoutId, exerciseId: r.exercise.id, setIndex });
    return sendJson(res, 200, { ok: true, empty: true });
  }
  const errs = validateSetValues(r.exercise.metrics, values);
  if (errs.length) return sendJson(res, 400, { ok: false, error: errs.join('; ') });

  const dose = tierDose(r.exercise, r.tier);
  const prescribed = dose ? { sets: dose.sets, reps: dose.reps, rest_sec: dose.rest_sec } : undefined;
  const workout = await getOrCreateWorkout({ athleteId, date, sessionLabel: `Day ${r.day}` }, r.tier); // lazy create
  const note = (params.get('note') ?? '').trim();
  const saved = await upsertSet({
    workoutId: workout.workoutId, athleteId, exerciseId: r.exercise.id, setIndex, values,
    ...(prescribed ? { prescribed } : {}), ...(note ? { note } : {}),
  });
  return sendJson(res, 200, { ok: true, setLogId: saved.setLogId });
}

/** Remove one set (coach cut it, or unchecked its Log toggle). Finds the session, never creates. */
async function handleTrackSetRemove(athleteId: string, dayStr: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const day = Number(dayStr);
  const exerciseId = params.get('exerciseId') ?? '';
  const setIndex = Number(params.get('setIndex'));
  if (!Number.isInteger(day) || !exerciseId || !Number.isInteger(setIndex)) return sendJson(res, 400, { ok: false });
  const date = todayIso();
  const workout = (await workoutLogFor(athleteId)).find((w) => w.date === date && w.sessionLabel === `Day ${day}`);
  if (workout) await removeSet({ workoutId: workout.workoutId, exerciseId, setIndex });
  return sendJson(res, 200, { ok: true });
}

/**
 * No-JS fallback: the whole-session submit. Writes every TICKED, valid set (untouched rows carry no
 * "on" flag, so they're skipped — the honest-log rule without JS), then optionally finishes. With JS
 * these sets were already autosaved; the upsert makes re-writing them idempotent.
 */
async function handleTrackSave(athleteId: string, dayStr: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const r = await buildTrackContext(athleteId, dayStr);
  if (!r.ok) return sendHtml(res, r.code, r.html);
  const { ctx } = r;

  const exercises = ctx.blocks
    .flatMap((b) => b.nodes)
    .filter((n): n is Extract<TrackNode, { kind: 'track' }> => n.kind === 'track')
    .map((n) => ({ exerciseId: n.ex.exerciseId, metrics: n.ex.metrics }));
  const { sets } = parseTrackSave(params, exercises);

  if (sets.length > 0) {
    const lib = await loadExercises();
    const byId = new Map(lib.map((e) => [e.id, e]));
    const workout = await getOrCreateWorkout({ athleteId, date: ctx.date, sessionLabel: `Day ${ctx.day}` }, ctx.tier);
    for (const s of sets) {
      const ex = byId.get(s.exerciseId);
      const dose = ex ? tierDose(ex, ctx.tier) : undefined;
      const prescribed = dose ? { sets: dose.sets, reps: dose.reps, rest_sec: dose.rest_sec } : undefined;
      await upsertSet({
        workoutId: workout.workoutId, athleteId, exerciseId: s.exerciseId, setIndex: s.setIndex, values: s.values,
        ...(prescribed ? { prescribed } : {}), ...(s.note ? { note: s.note } : {}),
      });
    }
    if (params.get('finish') === '1') await setWorkoutCompleted(workout.workoutId, true);
  }
  redirect(res, `/athlete?id=${encodeURIComponent(athleteId)}`);
}

/**
 * Finish (or reopen) the session — the coach's explicit "done", never a side effect of logging
 * (Step 6). Toggles `completed` on today's session for this day; a session with no logged sets has
 * no record to finish, so it's a no-op.
 */
async function handleTrackFinish(athleteId: string, dayStr: string, res: ServerResponse): Promise<void> {
  const day = Number(dayStr);
  if (!Number.isInteger(day)) return sendHtml(res, 404, notFoundPage());
  const date = todayIso();
  const workout = (await workoutLogFor(athleteId)).find((w) => w.date === date && w.sessionLabel === `Day ${day}`);
  if (workout) await setWorkoutCompleted(workout.workoutId, !workout.completed);
  redirect(res, `/athlete?id=${encodeURIComponent(athleteId)}`);
}

async function handleWorkoutComplete(workoutId: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const updated = await setWorkoutCompleted(workoutId, params.get('completed') === '1');
  if (!updated) return sendHtml(res, 404, notFoundPage());
  redirect(res, `/athlete?id=${encodeURIComponent(updated.athleteId)}`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;

    if ((req.method ?? 'GET') === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      if (path === '/athlete/new') return await handleAthleteNew(params, res);
      if (path === '/athlete/edit') return await handleAthleteEdit(url.searchParams.get('id') ?? '', params, res);
      if (path === '/athlete/split') return await handleSplitSwitch(url.searchParams.get('id') ?? '', params, res);
      if (path === '/assessment/new') return await handleAssessmentNew(url.searchParams.get('athleteId') ?? '', params, res);
      if (path === '/athlete/track/set') return await handleTrackSet(url.searchParams.get('id') ?? '', url.searchParams.get('day') ?? '', params, res);
      if (path === '/athlete/track/set/remove') return await handleTrackSetRemove(url.searchParams.get('id') ?? '', url.searchParams.get('day') ?? '', params, res);
      if (path === '/athlete/track/save') return await handleTrackSave(url.searchParams.get('id') ?? '', url.searchParams.get('day') ?? '', params, res);
      if (path === '/athlete/track/finish') return await handleTrackFinish(url.searchParams.get('id') ?? '', url.searchParams.get('day') ?? '', res);
      if (path === '/workout/complete') return await handleWorkoutComplete(url.searchParams.get('workoutId') ?? '', params, res);
      return sendHtml(res, 404, notFoundPage());
    }

    let html: string;
    if (path === '/') html = await rosterPage();
    else if (path === '/athlete') html = await athletePage(url.searchParams.get('id') ?? '');
    else if (path === '/athlete/new') html = await athleteNewFormPage();
    else if (path === '/athlete/edit') html = await athleteEditFormPage(url.searchParams.get('id') ?? '');
    else if (path === '/assessment/new') html = await assessmentNewFormPage(url.searchParams.get('athleteId') ?? '');
    else if (path === '/athlete/track') {
      const { code, html: trackHtml } = await trackScreen(url.searchParams.get('id') ?? '', url.searchParams.get('day') ?? '');
      return sendHtml(res, code, trackHtml);
    }
    else if (path === '/validation') html = await validationPage();
    else return sendHtml(res, 404, notFoundPage());

    sendHtml(res, 200, html);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Dashboard error: ${(err as Error).message}`);
  }
});

server.listen(PORT, () => {
  process.stdout.write(`\nCoaching Command Center dashboard → http://localhost:${PORT}\n(Ctrl+C to stop)\n\n`);
});
