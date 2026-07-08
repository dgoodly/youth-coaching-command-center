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

import type { Assessment, Tier } from '../engine/types.ts';
import { SCORE_KEYS, TIER_STAGE } from '../engine/types.ts';
import { computeMaturity } from '../engine/maturity.ts';
import { checkVolumeGuardrails, type GuardrailStatus } from '../engine/guardrails.ts';
import {
  allAthletes, assessmentsFor, latestAssessment, heightLogFor, workoutLogFor, wellnessLogFor,
  blockStateFor, daysSince, dueForReassessment,
} from '../store/query.ts';
import { ageFromDob, createAthlete, updateAthlete, findAthlete } from '../store/athletes.ts';
import { readCollection } from '../store/json-store.ts';
import { buildAssessmentRecord, saveAssessment } from '../store/ingest.ts';
import {
  loadExercises, loadDayTemplates, loadAvailableEquipment, planForTier,
} from '../store/library.ts';
import { assembleSession } from '../engine/assembler.ts';
import { page, esc, tierBadge, table, sessionHtml, planTabs } from './render.ts';
import {
  SCORE_LABEL,
  emptyAthleteValues, athleteValuesFromParams, athleteValuesFromProfile, validateAthleteForm, athleteFormPage,
  emptyAssessmentValues, assessmentValuesFromParams, validateAssessmentForm, assessmentFormPage, assessmentRevealPage,
} from './forms.ts';

const PORT = Number(process.env.CC_DASHBOARD_PORT ?? 5173);

function dueCell(days: number): string {
  return days >= 42
    ? `<span class="flag">DUE (${days}d)</span>`
    : `<span class="ok">${days}d ago</span>`;
}

// ---------------------------------------------------------------------------
// Roster overview
// ---------------------------------------------------------------------------

async function rosterPage(): Promise<string> {
  const athletes = await allAthletes();
  const rows: string[][] = [];

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

    const nameCell = `<a class="row" href="/athlete?id=${encodeURIComponent(a.athleteId)}">${esc(a.displayName)}</a>`
      + (a.valgusWatch ? ' <span class="pill">valgus</span>' : '');
    rows.push([
      nameCell,
      age !== null ? String(age) : '<span class="muted">—</span>',
      tierBadge(latest?.finalTier ?? null),
      latest ? esc(latest.date) : '<span class="muted">never</span>',
      latest ? dueCell(daysSince(latest.date)) : '<span class="flag">no assessment</span>',
      maturity.nearPHV
        ? `<span class="flag">PHV ${maturity.velocityCmPerYear?.toFixed(1)} cm/yr</span>`
        : maturity.velocityCmPerYear !== null
          ? `<span class="ok">${maturity.velocityCmPerYear.toFixed(1)} cm/yr</span>`
          : '<span class="muted">—</span>',
      guard.anyExceeded
        ? '<span class="flag">over</span>'
        : guard.anyWatch ? '<span class="pill">watch</span>' : '<span class="muted">—</span>',
      block ? `<span class="pill">block ${block.blockIndex}</span>` : '<span class="muted">—</span>',
    ]);
  }

  const body = `<h1>Roster</h1>
    <p class="sub">${athletes.length} athlete${athletes.length === 1 ? '' : 's'} · tiers &amp; scores are coach-only (§3.3)</p>
    <p><a class="btn" href="/athlete/new">+ New athlete</a></p>
    ${table(
      ['Athlete', 'Age', 'Tier', 'Last assessment', 'Re-assess', 'Height velocity', 'Load', 'Block'],
      rows,
      'No athletes yet. Add one with `npm run enter`.',
    )}
    <p class="muted">Re-assess flag fires at ≥ 6 weeks (spec §6). PHV flag = height velocity ≥ 7 cm/yr → dose pullback (dose only, not tier). Load = specialization/volume guardrails (weekly hours ≤ age · sport &lt; 16 h · ≥ 1–2 rest days).</p>`;
  return page('Roster', body);
}

// ---------------------------------------------------------------------------
// Individual athlete view
// ---------------------------------------------------------------------------

function gutCell(a: Assessment): string {
  if (!a.coachGutCall) return '<span class="muted">—</span>';
  const match = a.coachGutCall === a.finalTier;
  return `${tierBadge(a.coachGutCall)} <span class="${match ? 'match' : 'differ'}">${match ? '✓' : '≠'}</span>`;
}

/**
 * "Current plan" section: the tier-scoped plan the athlete is on, rendered as instant client-side
 * day tabs (Day 1 default). Each day is the fully assembled session for (tier + that day's template
 * + the athlete's block state). Tiers with no explicit plan fall back to the full 4-day split.
 */
async function planSection(athleteId: string, tier: Tier | null, valgusWatch: boolean): Promise<string> {
  if (!tier) return '<p class="empty">No assessment yet — assign a tier to see the athlete\'s plan.</p>';

  const [exercises, templates, equipment, block, plan] = await Promise.all([
    loadExercises(), loadDayTemplates(), loadAvailableEquipment(), blockStateFor(athleteId), planForTier(tier),
  ]);
  const effective = plan ?? { tier, name: 'Full 4-day split', days: templates.map((t) => t.day).sort((a, b) => a - b) };

  const panels = effective.days.map((day) => {
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
        })),
      }));
      const note = `<p class="panel-note">${esc(session.label)} · sprint: ${esc(session.sprintEmphasis)}</p>`;
      return { label: `Day ${day}`, html: note + sessionHtml(blocks) };
    } catch (err) {
      return { label: `Day ${day}`, html: `<p class="flag">Could not assemble Day ${day}: ${esc((err as Error).message)}</p>` };
    }
  });

  return `<p class="sub">On <b>${esc(effective.name)}</b> · ${effective.days.length} day${effective.days.length === 1 ? '' : 's'}/week · tier ${esc(tier)}${plan ? '' : ' <span class="muted">(no tier-specific plan defined — showing full split)</span>'}</p>`
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
  const maturity = computeMaturity(heights, { dob: a.dob, sex: a.sex });
  const age = ageFromDob(a.dob);

  // Tier history (newest first).
  const historyRows = [...assessments].reverse().map((as) => [
    esc(as.date),
    `${as.rawTotal}/18`,
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
        const cls = v <= 1 ? 'flag' : v >= 3 ? 'ok' : '';
        return `<span class="${cls}">${v}</span>`;
      }),
    ]);
    trends = table(['Test', ...dateHeaders], rows);
  }

  const workoutRows = workouts.map((w) => [
    esc(w.date), esc(w.sessionLabel), tierBadge(w.servedForTier),
    w.completed ? '<span class="ok">done</span>' : '<span class="muted">planned</span>',
    esc(w.coachNotes) || '<span class="muted">—</span>',
  ]);

  const heightRows = heights.map((hh) => [
    esc(hh.date),
    `${hh.heightCm} cm`,
    hh.sittingHeightCm != null ? `${hh.sittingHeightCm} cm` : '<span class="muted">—</span>',
    `<span class="pill">${esc(hh.source)}</span>`,
  ]);

  const wellnessRows = wellness.map((w) => [
    esc(w.date),
    w.sleepHours != null ? `${w.sleepHours} h` : '<span class="muted">—</span>',
    w.soreness != null ? String(w.soreness) : '<span class="muted">—</span>',
    w.energy != null ? String(w.energy) : '<span class="muted">—</span>',
    esc(w.notes ?? '') || '<span class="muted">—</span>',
  ]);

  // Specialization / volume guardrails (COACHING_INSTRUCTIONS "SAFETY / DON'T").
  const guard = checkVolumeGuardrails({
    age, weeklySportHours: a.weeklySportHours,
    weeklyTrainingHours: a.weeklyTrainingHours, restDaysPerWeek: a.restDaysPerWeek,
  });
  const GUARD_CLASS: Record<GuardrailStatus, string> = { ok: 'ok', watch: 'pill', exceeded: 'flag', unknown: 'muted' };
  const guardRows = guard.findings.map((f) => [
    `<span class="${GUARD_CLASS[f.status]}">${f.status}</span>`,
    esc(f.message),
  ]);

  // Maturity-offset estimate line (Moore/Fransen), shown when computable.
  const estLine = maturity.maturityOffsetYears !== null
    ? `<p>Maturity estimate: <b>${maturity.phvBand?.toUpperCase()}-PHV</b> · offset ${maturity.maturityOffsetYears >= 0 ? '+' : '−'}${Math.abs(maturity.maturityOffsetYears).toFixed(1)} yr · est. age at PHV ${maturity.estimatedAgeAtPHV!.toFixed(1)} <span class="muted">(${esc(maturity.method ?? '')})</span></p>`
    : `<p class="muted">Maturity estimate unavailable — ${esc(maturity.method ?? 'set DOB, sex, and (for boys) sitting height')}.</p>`;

  const tier = await currentTierOf(id);
  const planHtml = await planSection(id, tier, a.valgusWatch);

  const body = `
    <p><a href="/">← Roster</a></p>
    <h1>${esc(a.displayName)} ${a.valgusWatch ? '<span class="pill">valgus watch</span>' : ''}</h1>
    <p class="sub">
      ${age !== null ? `Age ${age} · ` : ''}${esc(a.sports.join(', ') || 'no sports listed')} ·
      ${a.trainingMonths} mo training · current tier ${tierBadge(tier)}
    </p>
    <div class="actions">
      <a class="btn" href="/assessment/new?athleteId=${encodeURIComponent(a.athleteId)}">+ Enter assessment</a>
      <a class="btn secondary" href="/athlete/edit?id=${encodeURIComponent(a.athleteId)}">Edit athlete</a>
    </div>

    <h2>Maturity (dose axis — independent of tier)</h2>
    <p>${maturity.nearPHV ? '<span class="flag">⚠ ' : '<span class="ok">'}${esc(maturity.note)}</span></p>
    ${estLine}
    ${table(['Date', 'Standing', 'Sitting', 'Source'], heightRows, 'No height entries logged.')}

    <h2>Wellness (weekly load / growth check)</h2>
    ${table(['Date', 'Sleep', 'Soreness (1–5)', 'Energy (1–5)', 'Notes'], wellnessRows, 'No wellness checks logged. Add with `npm run wellness`.')}

    <h2>Training-load guardrails (specialization / volume)</h2>
    ${table(['Status', 'Guardrail'], guardRows, 'No guardrail data.')}

    <h2>Tier history</h2>
    ${table(['Date', 'Raw', 'Base', 'Final', 'Gate', 'Gut-call'], historyRows, 'No assessments yet.')}

    <h2>Score trends (per test, 0–3)</h2>
    ${trends}

    <h2>Current plan</h2>
    ${planHtml}

    <h2>Workout log</h2>
    ${table(['Date', 'Session', 'Tier', 'Status', 'Notes'], workoutRows, 'No sessions logged.')}
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
      esc(a.date), esc(nameOf(a.athleteId)), `${a.rawTotal}/18`,
      tierBadge(a.finalTier), tierBadge(a.coachGutCall),
      match ? '<span class="match">match</span>' : '<span class="differ">DIFFERS</span>',
      a.gateFired === 'none' ? '<span class="muted">—</span>' : `<code>${esc(a.gateFired)}</code>`,
    ];
  });

  // Gate-firing tally.
  const gateCounts = new Map<string, number>();
  for (const a of assessments) gateCounts.set(a.gateFired, (gateCounts.get(a.gateFired) ?? 0) + 1);
  const gateRows = [...gateCounts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([g, n]) => [g === 'none' ? '<span class="muted">none</span>' : `<code>${esc(g)}</code>`, String(n)]);

  const agreement = withGut.length ? Math.round((matches / withGut.length) * 100) : 0;

  const body = `
    <h1>Validation</h1>
    <p class="sub">Calculated tier vs coach gut-call, and which gates fire. This is the surface that
      tunes the score bands &amp; gate thresholds against real athletes (BUILD_BRIEF §3.7).</p>

    <h2>Agreement</h2>
    <p>${withGut.length} assessment${withGut.length === 1 ? '' : 's'} with a gut-call ·
       <span class="match">${matches} match</span> ·
       <span class="differ">${differs} differ</span> ·
       <b>${agreement}% agreement</b></p>

    <h2>Calculated vs gut-call</h2>
    ${table(['Date', 'Athlete', 'Raw', 'Calculated', 'Gut-call', 'Verdict', 'Gate'], compareRows,
      'No gut-calls captured yet — enter assessments with a gut-call for validation data.')}

    <h2>Gate-firing tally</h2>
    ${table(['Gate', 'Count'], gateRows, 'No assessments yet.')}
    <p class="muted">If a gate fires far more/less than a coach expects, that is a signal to tune its
      threshold (spec §4 / §8). <code>capC</code> = squat/drop-stick &lt; 2 · <code>capA</code> =
      drop-stick = 2 · <code>S-&gt;A</code> = S without a perfect stick.</p>
  `;
  return page('Validation', body);
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
      if (path === '/assessment/new') return await handleAssessmentNew(url.searchParams.get('athleteId') ?? '', params, res);
      return sendHtml(res, 404, notFoundPage());
    }

    let html: string;
    if (path === '/') html = await rosterPage();
    else if (path === '/athlete') html = await athletePage(url.searchParams.get('id') ?? '');
    else if (path === '/athlete/new') html = await athleteNewFormPage();
    else if (path === '/athlete/edit') html = await athleteEditFormPage(url.searchParams.get('id') ?? '');
    else if (path === '/assessment/new') html = await assessmentNewFormPage(url.searchParams.get('athleteId') ?? '');
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
