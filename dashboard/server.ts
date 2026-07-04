/**
 * Local dashboard server — DISPOSABLE surface (BUILD_BRIEF Phase 3). Plain node:http, no deps,
 * server-rendered HTML read live from the JSON store. Three views:
 *   /            roster overview — tier, last assessment, due-for-reassessment, PHV flag
 *   /athlete?id= individual — tier history, per-test score trends, height/maturity, workout log
 *   /validation  calculated tier vs coach gut-call across the roster + gate-firing tally
 *
 * Run: `npm run dashboard` then open http://localhost:5173
 */

import { createServer } from 'node:http';

import type { Assessment, Tier } from '../engine/types.ts';
import { SCORE_KEYS, TIER_STAGE } from '../engine/types.ts';
import { computeMaturity } from '../engine/maturity.ts';
import {
  allAthletes, assessmentsFor, latestAssessment, heightLogFor, workoutLogFor, wellnessLogFor,
  blockStateFor, daysSince, dueForReassessment,
} from '../store/query.ts';
import { ageFromDob } from '../store/athletes.ts';
import { readCollection } from '../store/json-store.ts';
import { page, esc, tierBadge, table } from './render.ts';

const PORT = Number(process.env.CC_DASHBOARD_PORT ?? 5173);

const SCORE_LABEL: Record<string, string> = {
  squat: 'Squat', dropStick: 'Drop-stick', balance: 'Balance',
  pushup: 'Push-up', broad: 'Broad', pogo: 'Pogo',
};

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
      block ? `<span class="pill">block ${block.blockIndex}</span>` : '<span class="muted">—</span>',
    ]);
  }

  const body = `<h1>Roster</h1>
    <p class="sub">${athletes.length} athlete${athletes.length === 1 ? '' : 's'} · tiers &amp; scores are coach-only (§3.3)</p>
    ${table(
      ['Athlete', 'Age', 'Tier', 'Last assessment', 'Re-assess', 'Height velocity', 'Block'],
      rows,
      'No athletes yet. Add one with `npm run enter`.',
    )}
    <p class="muted">Re-assess flag fires at ≥ 6 weeks (spec §6). PHV flag = height velocity ≥ 7 cm/yr → dose pullback (dose only, not tier).</p>`;
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

  // Maturity-offset estimate line (Moore/Fransen), shown when computable.
  const estLine = maturity.maturityOffsetYears !== null
    ? `<p>Maturity estimate: <b>${maturity.phvBand?.toUpperCase()}-PHV</b> · offset ${maturity.maturityOffsetYears >= 0 ? '+' : '−'}${Math.abs(maturity.maturityOffsetYears).toFixed(1)} yr · est. age at PHV ${maturity.estimatedAgeAtPHV!.toFixed(1)} <span class="muted">(${esc(maturity.method ?? '')})</span></p>`
    : `<p class="muted">Maturity estimate unavailable — ${esc(maturity.method ?? 'set DOB, sex, and (for boys) sitting height')}.</p>`;

  const body = `
    <p><a href="/">← Roster</a></p>
    <h1>${esc(a.displayName)} ${a.valgusWatch ? '<span class="pill">valgus watch</span>' : ''}</h1>
    <p class="sub">
      ${age !== null ? `Age ${age} · ` : ''}${esc(a.sports.join(', ') || 'no sports listed')} ·
      ${a.trainingMonths} mo training · current tier ${tierBadge(await currentTierOf(id))}
    </p>

    <h2>Maturity (dose axis — independent of tier)</h2>
    <p>${maturity.nearPHV ? '<span class="flag">⚠ ' : '<span class="ok">'}${esc(maturity.note)}</span></p>
    ${estLine}
    ${table(['Date', 'Standing', 'Sitting', 'Source'], heightRows, 'No height entries logged.')}

    <h2>Wellness (weekly load / growth check)</h2>
    ${table(['Date', 'Sleep', 'Soreness (1–5)', 'Energy (1–5)', 'Notes'], wellnessRows, 'No wellness checks logged. Add with `npm run wellness`.')}

    <h2>Tier history</h2>
    ${table(['Date', 'Raw', 'Base', 'Final', 'Gate', 'Gut-call'], historyRows, 'No assessments yet.')}

    <h2>Score trends (per test, 0–3)</h2>
    ${trends}

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
// Server
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    let html: string;
    if (url.pathname === '/') html = await rosterPage();
    else if (url.pathname === '/athlete') html = await athletePage(url.searchParams.get('id') ?? '');
    else if (url.pathname === '/validation') html = await validationPage();
    else {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Not found', '<h1>404</h1><p><a href="/">← Roster</a></p>'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Dashboard error: ${(err as Error).message}`);
  }
});

server.listen(PORT, () => {
  process.stdout.write(`\nCoaching Command Center dashboard → http://localhost:${PORT}\n(Ctrl+C to stop)\n\n`);
});
