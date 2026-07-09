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

import type { Assessment, AthleteProfile, Tier } from '../engine/types.ts';
import { SCORE_KEYS, TIER_STAGE } from '../engine/types.ts';
import { computeMaturity } from '../engine/maturity.ts';
import { checkVolumeGuardrails, type GuardrailStatus } from '../engine/guardrails.ts';
import {
  allAthletes, assessmentsFor, latestAssessment, heightLogFor, workoutLogFor, wellnessLogFor,
  setLogFor, blockStateFor, daysSince, dueForReassessment,
} from '../store/query.ts';
import { ageFromDob, createAthlete, updateAthlete, findAthlete } from '../store/athletes.ts';
import { readCollection } from '../store/json-store.ts';
import { buildAssessmentRecord, saveAssessment } from '../store/ingest.ts';
import { getOrCreateWorkout, setWorkoutCompleted } from '../store/workout.ts';
import { saveSetLog, type NewSetLog } from '../store/setlog.ts';
import {
  splitOf, SPLIT_DAYS, getOrInitBlockState, saveBlockState, switchSplit,
} from '../store/blocks.ts';
import {
  loadExercises, loadDayTemplates, loadAvailableEquipment,
} from '../store/library.ts';
import { tierDose, doseLabel, type Exercise } from '../engine/program.ts';
import { assembleSession } from '../engine/assembler.ts';
import {
  page, esc, tierBadge, table, sessionHtml, planTabs,
  rosterTable, triageCards, statCard, statStrip, card, num, statusFlag, maturityMarker, bar,
  type RosterRow, type TriageCard,
} from './render.ts';
import {
  SCORE_LABEL, SPLIT_LABEL, SPLIT_SHORT, splitSwitchForm, validateSplitSwitch,
  emptyAthleteValues, athleteValuesFromParams, athleteValuesFromProfile, validateAthleteForm, athleteFormPage,
  emptyAssessmentValues, assessmentValuesFromParams, validateAssessmentForm, assessmentFormPage, assessmentRevealPage,
  emptyLogValues, logValuesFromParams, validateLogForm, logFormPage, resolveMetrics, type LogFormContext,
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

/**
 * "Current plan" section: the athlete's active training split (2/3/4-day, from `splitOf`),
 * rendered as instant client-side day tabs (Day 1 default). Each day is the fully assembled
 * session for (tier + that day's template + the athlete's block state). The day COUNT comes from
 * the split (coach's per-athlete choice); the tier still governs the content/dose inside each day.
 * A compact split-switch form sits above the tabs.
 */
async function planSection(athleteId: string, tier: Tier | null, valgusWatch: boolean): Promise<string> {
  const [exercises, templates, equipment, block] = await Promise.all([
    loadExercises(), loadDayTemplates(), loadAvailableEquipment(), blockStateFor(athleteId),
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
          // Loggable movements (those that declare metrics) get a per-exercise "Log" link;
          // warm-up/funnel/cooldown/non-throw motor-skill declare none and get nothing.
          ...(it.exercise.metrics.length > 0
            ? { logHref: `/log/new?athleteId=${encodeURIComponent(athleteId)}&day=${day}&exerciseId=${encodeURIComponent(it.exercise.id)}` }
            : {}),
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

  const workoutRows = workouts.map((w) => {
    const n = setsByWorkout.get(w.workoutId) ?? 0;
    const status = w.completed
      ? statusFlag('quiet', 'done')
      : n > 0
        ? statusFlag('accent', 'in progress')
        : '<span class="muted">planned</span>';
    return [
      num(w.date), esc(w.sessionLabel), tierBadge(w.servedForTier),
      status,
      n > 0 ? num(String(n)) : '<span class="muted">—</span>',
      esc(w.coachNotes) || '<span class="muted">—</span>',
      completeToggleForm(w.workoutId, w.completed),
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
  const planHtml = await planSection(id, tier, a.valgusWatch);

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
      <a class="btn" href="/assessment/new?athleteId=${encodeURIComponent(a.athleteId)}">+ Enter assessment</a>
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

// --- per-set workout logging (Phase C) ---

/** A helper page for the log-flow guard rails (no tier yet, unknown exercise, etc.). */
function logGuardPage(athleteId: string, heading: string, msg: string): string {
  const back = athleteId ? `/athlete?id=${encodeURIComponent(athleteId)}` : '/';
  return page('Log', `<p class="sub"><a href="${esc(back)}">← Back</a></p><h1>${esc(heading)}</h1><p>${esc(msg)}</p>`);
}

/** Build the non-input context the log form needs (metrics, prescribed target) — pure-ish. */
function logContext(athleteId: string, day: number, exercise: Exercise, tier: Tier): LogFormContext {
  const dose = tierDose(exercise, tier);
  return {
    athleteId, day, exerciseId: exercise.id, exerciseName: exercise.name,
    targetText: doseLabel(exercise, tier),
    ...(dose ? { prescribedReps: dose.reps } : {}),
    metrics: resolveMetrics(exercise.metrics),
  };
}

/**
 * Resolve the shared pre-conditions for both the GET form and the POST handler: athlete exists,
 * has a tier, the exercise exists and is loggable, and `day` is an integer. Returns either a ready
 * bundle or an error page to send.
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
  if (!tier) return { ok: false, code: 400, html: logGuardPage(athleteId, 'No tier on file', 'Enter an assessment before logging a session — the prescribed target comes from the athlete’s tier.') };
  const exercise = (await loadExercises()).find((e) => e.id === exerciseId);
  if (!exercise) return { ok: false, code: 404, html: notFoundPage() };
  if (exercise.metrics.length === 0) return { ok: false, code: 400, html: logGuardPage(athleteId, 'Not a logged movement', `${exercise.name} isn’t individually logged (warm-up / funnel / cooldown / motor-skill).`) };
  return { ok: true, athlete, day, exercise, tier };
}

async function logNewFormPage(athleteId: string, dayStr: string, exerciseId: string): Promise<{ code: number; html: string }> {
  const r = await resolveLogTarget(athleteId, dayStr, exerciseId);
  if (!r.ok) return { code: r.code, html: r.html };
  const dose = tierDose(r.exercise, r.tier);
  const values = emptyLogValues(dose?.sets ?? 1, r.exercise.metrics);
  return { code: 200, html: logFormPage(r.athlete, logContext(athleteId, r.day, r.exercise, r.tier), values, {}) };
}

async function handleLogNew(athleteId: string, dayStr: string, exerciseId: string, params: URLSearchParams, res: ServerResponse): Promise<void> {
  const r = await resolveLogTarget(athleteId, dayStr, exerciseId);
  if (!r.ok) return sendHtml(res, r.code, r.html);

  const ctx = logContext(athleteId, r.day, r.exercise, r.tier);
  const values = logValuesFromParams(params, r.exercise.metrics);
  const { sets, errors } = validateLogForm(r.exercise.metrics, values);
  if (!sets) return sendHtml(res, 400, logFormPage(r.athlete, ctx, values, errors));

  // Snapshot the prescription as it is NOW, so a later dose edit can't rewrite this history.
  const dose = tierDose(r.exercise, r.tier);
  const prescribed = dose ? { sets: dose.sets, reps: dose.reps, rest_sec: dose.rest_sec } : undefined;

  // Atomic find-or-create of the session record (completed stays false — logging never marks done).
  const workout = await getOrCreateWorkout({ athleteId, date: values.date, sessionLabel: `Day ${r.day}` }, r.tier);

  const inputs: NewSetLog[] = sets.map((s) => ({
    workoutId: workout.workoutId, athleteId, exerciseId,
    setIndex: s.setIndex, values: s.values,
    ...(prescribed ? { prescribed } : {}),
    ...(s.note ? { note: s.note } : {}),
  }));
  await saveSetLog(inputs);
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
      if (path === '/log/new') return await handleLogNew(url.searchParams.get('athleteId') ?? '', url.searchParams.get('day') ?? '', url.searchParams.get('exerciseId') ?? '', params, res);
      if (path === '/workout/complete') return await handleWorkoutComplete(url.searchParams.get('workoutId') ?? '', params, res);
      return sendHtml(res, 404, notFoundPage());
    }

    let html: string;
    if (path === '/') html = await rosterPage();
    else if (path === '/athlete') html = await athletePage(url.searchParams.get('id') ?? '');
    else if (path === '/athlete/new') html = await athleteNewFormPage();
    else if (path === '/athlete/edit') html = await athleteEditFormPage(url.searchParams.get('id') ?? '');
    else if (path === '/assessment/new') html = await assessmentNewFormPage(url.searchParams.get('athleteId') ?? '');
    else if (path === '/log/new') {
      const { code, html: logHtml } = await logNewFormPage(url.searchParams.get('athleteId') ?? '', url.searchParams.get('day') ?? '', url.searchParams.get('exerciseId') ?? '');
      return sendHtml(res, code, logHtml);
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
