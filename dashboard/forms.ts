/**
 * Dashboard write-surface forms (Phase 2) — DISPOSABLE surface. Pure form-value shaping,
 * server-side validation, and HTML rendering for the athlete + assessment forms. No I/O and
 * no server boot, so these are directly unit-testable (server.ts wires them to the store).
 *
 * Boundary rule (BUILD_BRIEF §1): validation here is only about well-formed INPUT (required
 * fields, ranges, date shape). It never computes a tier, applies the CAP rule, or assembles a
 * session — that trusted logic stays in `store/ingest.ts` / `engine/*`. `validateAssessmentForm`
 * hands a `FieldFormInput` to the same ingest path the CLI uses; the engine recomputes the tier.
 *
 * XSS: every value below is browser-sourced and rendered back into HTML, so it all flows through
 * `esc()`. No user string is ever interpolated raw.
 */

import type { AthleteProfile, Assessment, Scores, SplitChoice, TestScore, Tier } from '../engine/types.ts';
import { SCORE_KEYS, SPLIT_CHOICES, TIER_STAGE, isSplitChoice, isTier } from '../engine/types.ts';
import { type Metric, metricById, validateSetValues } from '../engine/metrics.ts';
import { type MetricProgress } from '../engine/progress.ts';
import type { NewAthleteInput } from '../store/athletes.ts';
import { type SplitSwitchMode } from '../store/blocks.ts';
import { type FieldFormInput, nextAssessmentDate } from '../store/ingest.ts';
import {
  page, esc, tierBadge, textField, textAreaField, selectField, checkboxField,
  errorBanner, card, statStrip, statCard, num, statusFlag, type FieldErrors,
} from './render.ts';

export const SCORE_LABEL: Record<string, string> = {
  squat: 'Squat', dropStick: 'Drop-stick', balance: 'Balance',
  pushup: 'Push-up', broad: 'Broad', pogo: 'Pogo',
};

// ---------------------------------------------------------------------------
// Shared parse / validation helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in strict YYYY-MM-DD form (rejects e.g. 2026-13-40). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Parse an optional non-negative integer; '' → undefined; invalid → records an error. */
function parseOptInt(raw: string, name: string, label: string, errors: FieldErrors): number | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    errors[name] = `${label} must be a whole number ≥ 0.`;
    return undefined;
  }
  return n;
}

/** Parse an optional non-negative number in [0, max]; '' → null; invalid → records an error. */
function parseOptNum(raw: string, name: string, label: string, max: number, errors: FieldErrors): number | null {
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    errors[name] = `${label} must be a number between 0 and ${max}.`;
    return null;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Athlete form
// ---------------------------------------------------------------------------

export interface AthleteFormValues {
  displayName: string; dob: string; sex: string; sports: string; trainingMonths: string;
  valgusWatch: boolean; weeklySportHours: string; weeklyTrainingHours: string;
  restDaysPerWeek: string; notes: string;
}

export function emptyAthleteValues(): AthleteFormValues {
  return {
    displayName: '', dob: '', sex: '', sports: '', trainingMonths: '', valgusWatch: false,
    weeklySportHours: '', weeklyTrainingHours: '', restDaysPerWeek: '', notes: '',
  };
}

export function athleteValuesFromParams(p: URLSearchParams): AthleteFormValues {
  const g = (k: string) => (p.get(k) ?? '').trim();
  return {
    displayName: g('displayName'), dob: g('dob'), sex: g('sex'), sports: g('sports'),
    trainingMonths: g('trainingMonths'), valgusWatch: p.get('valgusWatch') === '1',
    weeklySportHours: g('weeklySportHours'), weeklyTrainingHours: g('weeklyTrainingHours'),
    restDaysPerWeek: g('restDaysPerWeek'), notes: g('notes'),
  };
}

export function athleteValuesFromProfile(a: AthleteProfile): AthleteFormValues {
  const s = (n: number | null | undefined) => (n != null ? String(n) : '');
  return {
    displayName: a.displayName, dob: a.dob ?? '', sex: a.sex ?? '', sports: a.sports.join(', '),
    trainingMonths: s(a.trainingMonths), valgusWatch: a.valgusWatch,
    weeklySportHours: s(a.weeklySportHours), weeklyTrainingHours: s(a.weeklyTrainingHours),
    restDaysPerWeek: s(a.restDaysPerWeek), notes: a.notes ?? '',
  };
}

/** Server-side validation — never trust the browser. Returns a store input or per-field errors. */
export function validateAthleteForm(v: AthleteFormValues): { input: NewAthleteInput | null; errors: FieldErrors } {
  const errors: FieldErrors = {};

  if (!v.displayName) errors.displayName = 'Name is required.';

  let dob: string | null = null;
  if (v.dob) {
    if (!isIsoDate(v.dob)) errors.dob = 'Use a valid date (YYYY-MM-DD).';
    else if (v.dob > todayIso()) errors.dob = 'Date of birth is in the future.';
    else dob = v.dob;
  }

  let sex: 'M' | 'F' | null = null;
  if (v.sex === 'M' || v.sex === 'F') sex = v.sex;
  else if (v.sex) errors.sex = 'Pick M, F, or leave blank.';

  const sports = v.sports ? v.sports.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const trainingMonths = parseOptInt(v.trainingMonths, 'trainingMonths', 'Training months', errors);
  const weeklySportHours = parseOptNum(v.weeklySportHours, 'weeklySportHours', 'Weekly sport hours', 168, errors);
  const weeklyTrainingHours = parseOptNum(v.weeklyTrainingHours, 'weeklyTrainingHours', 'Weekly training hours', 168, errors);
  const restDaysPerWeek = parseOptNum(v.restDaysPerWeek, 'restDaysPerWeek', 'Rest days/week', 7, errors);

  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      displayName: v.displayName, dob, sex, sports, trainingMonths: trainingMonths ?? 0,
      valgusWatch: v.valgusWatch, weeklySportHours, weeklyTrainingHours, restDaysPerWeek, notes: v.notes,
    },
    errors,
  };
}

export function athleteFormPage(
  mode: 'new' | 'edit', v: AthleteFormValues, errors: FieldErrors, athleteId?: string,
): string {
  const action = mode === 'new' ? '/athlete/new' : `/athlete/edit?id=${encodeURIComponent(athleteId ?? '')}`;
  const back = mode === 'edit' && athleteId ? `/athlete?id=${encodeURIComponent(athleteId)}` : '/';
  const heading = mode === 'new' ? 'New athlete' : `Edit ${v.displayName || 'athlete'}`;
  const body = `
    <p class="sub"><a href="${esc(back)}">← Back</a></p>
    <h1>${esc(heading)}</h1>
    ${errorBanner(Object.values(errors))}
    <form class="cc" method="post" action="${esc(action)}">
      ${card('Athlete', `
        ${textField('displayName', 'Display name', v.displayName, errors, { placeholder: 'e.g. Maya R.' })}
        ${textField('dob', 'Date of birth', v.dob, errors, { type: 'date', hint: 'Optional — drives age and the maturity estimate.' })}
        ${selectField('sex', 'Sex (maturity estimate only)', v.sex, [['', '—'], ['M', 'M'], ['F', 'F']], errors, 'Used only for the Moore/Fransen maturity offset — never affects tier (§3.1).')}
        ${textField('sports', 'Sports', v.sports, errors, { placeholder: 'soccer, track', hint: 'Comma-separated.' })}
        ${textField('trainingMonths', 'Training months', v.trainingMonths, errors, { type: 'number', min: 0, hint: 'Context, not a scored point.' })}
        ${checkboxField('valgusWatch', 'Valgus watch — prioritise knee-cave-safe options in assembly', v.valgusWatch)}
      `)}
      ${card('Training load — optional (feeds the volume guardrails)', `
        <div class="scores">
          ${textField('weeklySportHours', 'Weekly sport hrs', v.weeklySportHours, errors, { type: 'number', min: 0, step: '0.5' })}
          ${textField('weeklyTrainingHours', 'Weekly training hrs', v.weeklyTrainingHours, errors, { type: 'number', min: 0, step: '0.5' })}
          ${textField('restDaysPerWeek', 'Rest days/week', v.restDaysPerWeek, errors, { type: 'number', min: 0, max: 7 })}
        </div>
      `)}
      ${card('Notes', textAreaField('notes', 'Notes', v.notes, errors))}
      <div class="actions">
        <button class="btn" type="submit">${mode === 'new' ? 'Create athlete' : 'Save changes'}</button>
        <a class="btn secondary" href="${esc(back)}">Cancel</a>
      </div>
    </form>`;
  return page(heading, body);
}

// ---------------------------------------------------------------------------
// Assessment entry form (gut-call BEFORE reveal, §3.7)
// ---------------------------------------------------------------------------

type ScoreKey = (typeof SCORE_KEYS)[number];

export interface AssessmentFormValues {
  date: string; tester: string; scores: Record<ScoreKey, string>;
  broadLandingFailed: boolean; coachGutCall: string;
  heightCm: string; sittingHeightCm: string; videoRefs: string; notes: string;
}

export function emptyAssessmentValues(): AssessmentFormValues {
  const scores = Object.fromEntries(SCORE_KEYS.map((k) => [k, ''])) as Record<ScoreKey, string>;
  return {
    date: todayIso(), tester: '', scores, broadLandingFailed: false, coachGutCall: '',
    heightCm: '', sittingHeightCm: '', videoRefs: '', notes: '',
  };
}

export function assessmentValuesFromParams(p: URLSearchParams): AssessmentFormValues {
  const g = (k: string) => (p.get(k) ?? '').trim();
  const scores = Object.fromEntries(SCORE_KEYS.map((k) => [k, g(k)])) as Record<ScoreKey, string>;
  return {
    date: g('date'), tester: g('tester'), scores,
    broadLandingFailed: p.get('broadLandingFailed') === '1', coachGutCall: g('coachGutCall'),
    heightCm: g('heightCm'), sittingHeightCm: g('sittingHeightCm'), videoRefs: g('videoRefs'), notes: g('notes'),
  };
}

export function validateAssessmentForm(
  athleteId: string, v: AssessmentFormValues,
): { input: FieldFormInput | null; errors: FieldErrors } {
  const errors: FieldErrors = {};

  if (!isIsoDate(v.date)) errors.date = 'Use a valid date (YYYY-MM-DD).';
  else if (v.date > todayIso()) errors.date = 'Assessment date is in the future.';
  if (!v.tester) errors.tester = 'Tester is required.';

  const scores = {} as Scores;
  for (const k of SCORE_KEYS) {
    const raw = v.scores[k];
    if (raw === '') { errors[k] = 'Required (0–3).'; continue; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 3) errors[k] = 'Must be 0–3.';
    else scores[k] = n as TestScore;
  }

  let coachGutCall: Tier | null = null;
  if (v.coachGutCall) {
    if (isTier(v.coachGutCall)) coachGutCall = v.coachGutCall;
    else errors.coachGutCall = 'Pick S/A/B/C or leave as no gut-call.';
  }

  const heightCm = parseOptNum(v.heightCm, 'heightCm', 'Standing height (cm)', 260, errors);
  const sittingHeightCm = parseOptNum(v.sittingHeightCm, 'sittingHeightCm', 'Sitting height (cm)', 200, errors);
  const videoRefs = v.videoRefs ? v.videoRefs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean) : [];

  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      athleteId, date: v.date, tester: v.tester, scores,
      broadLandingFailed: v.broadLandingFailed, coachGutCall, heightCm,
      sittingHeightCm, videoRefs, notes: v.notes,
    },
    errors,
  };
}

export function assessmentFormPage(athlete: AthleteProfile, v: AssessmentFormValues, errors: FieldErrors): string {
  const back = `/athlete?id=${encodeURIComponent(athlete.athleteId)}`;
  const scoreFields = SCORE_KEYS
    .map((k) => textField(k, SCORE_LABEL[k] ?? k, v.scores[k], errors, { type: 'number', min: 0, max: 3 }))
    .join('');
  const body = `
    <p class="sub"><a href="${esc(back)}">← ${esc(athlete.displayName)}</a></p>
    <h1>New assessment — ${esc(athlete.displayName)}</h1>
    <p class="sub">Enter the six scores and your gut-call. The computed tier is revealed only <b>after</b> you save,
      so the gut-call stays an independent read (clean validation data, §3.7).</p>
    ${errorBanner(Object.values(errors))}
    <form class="cc" method="post" action="/assessment/new?athleteId=${encodeURIComponent(athlete.athleteId)}">
      ${card('When', `
        ${textField('date', 'Date', v.date, errors, { type: 'date' })}
        ${textField('tester', 'Tester', v.tester, errors, { placeholder: 'e.g. Coach D' })}
      `)}
      ${card('Scores & gut-call', `
        <h4>Six tests (0–3)</h4>
        <div class="scores">${scoreFields}</div>
        ${checkboxField('broadLandingFailed', 'Broad-jump landing was uncontrolled (CAP rule → broad capped at 1)', v.broadLandingFailed)}
        ${selectField('coachGutCall', 'Your gut-call tier — enter BEFORE saving', v.coachGutCall, [['', '— no gut-call —'], ['S', 'S'], ['A', 'A'], ['B', 'B'], ['C', 'C']], errors, 'Your independent read, captured before the computed tier is shown. This is the threshold-tuning signal (validation view).')}
      `)}
      ${card('Growth & context — optional', `
        <div class="scores">
          ${textField('heightCm', 'Standing height (cm)', v.heightCm, errors, { type: 'number', min: 0, step: '0.1' })}
          ${textField('sittingHeightCm', 'Sitting height (cm)', v.sittingHeightCm, errors, { type: 'number', min: 0, step: '0.1' })}
        </div>
      `)}
      ${card('Notes & video', `
        ${textAreaField('videoRefs', 'Video refs', v.videoRefs, errors, 'One per line or comma-separated.')}
        ${textAreaField('notes', 'Notes', v.notes, errors)}
      `)}
      <div class="actions">
        <button class="btn" type="submit">Save &amp; reveal tier</button>
        <a class="btn secondary" href="${esc(back)}">Cancel</a>
      </div>
    </form>`;
  return page('New assessment', body);
}

// ---------------------------------------------------------------------------
// Training-split switch (Phase 3)
// ---------------------------------------------------------------------------

/** Human labels for each split. */
export const SPLIT_LABEL: Record<SplitChoice, string> = {
  '2day': '2-day (Tue · Fri)',
  '3day': '3-day (Tue · Wed · Fri)',
  '4day': '4-day (full split)',
};

/** Short badge code for compact places (roster). */
export const SPLIT_SHORT: Record<SplitChoice, string> = { '2day': '2d', '3day': '3d', '4day': '4d' };

/**
 * Compact split-switch form for the athlete page: pick a split, then choose what to do with the
 * current block (start fresh vs carry over) — a per-switch decision, not a fixed policy. The
 * current split is pre-selected; "fresh" is the default block treatment.
 */
export function splitSwitchForm(athleteId: string, current: SplitChoice): string {
  const opts = SPLIT_CHOICES
    .map((s) => `<option value="${s}"${s === current ? ' selected' : ''}>${esc(SPLIT_LABEL[s])}</option>`)
    .join('');
  return `<form class="cc split-switch" method="post" action="/athlete/split?id=${encodeURIComponent(athleteId)}">
      <div class="field">
        <label for="f_split">Switch training split</label>
        <select id="f_split" name="split">${opts}</select>
      </div>
      <div class="field">
        <label>Current block on switch</label>
        <div class="check"><input type="radio" id="f_mode_fresh" name="mode" value="fresh" checked><label for="f_mode_fresh">Start a fresh block — reset rotation &amp; variants</label></div>
        <div class="check"><input type="radio" id="f_mode_carry" name="mode" value="carry"><label for="f_mode_carry">Carry the current block index &amp; variants over</label></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Apply split</button></div>
    </form>`;
}

/** Validate a split-switch POST. Returns the parsed choice or null (reject — never trust input). */
export function validateSplitSwitch(params: URLSearchParams): { split: SplitChoice; mode: SplitSwitchMode } | null {
  const split = params.get('split');
  const mode = params.get('mode');
  if (!isSplitChoice(split)) return null;
  if (mode !== 'fresh' && mode !== 'carry') return null;
  return { split, mode };
}

// ---------------------------------------------------------------------------
// Per-set workout logging form (Phase C)
// ---------------------------------------------------------------------------

/** Upper bound on set rows parsed from one submission (guards a hostile/huge setCount). */
const MAX_SET_ROWS = 50;

/** One set row as raw strings: metricId → raw input, plus an optional note. */
export interface SetRowValues {
  values: Record<string, string>;
  note: string;
}

export interface LogFormValues {
  date: string;
  sets: SetRowValues[];
}

/** A validated set ready to persist — typed values in canonical units + a 1-based index. */
export interface ParsedSet {
  setIndex: number;
  values: Record<string, number>;
  note?: string;
}

/** Non-input context the form needs: which exercise, its metrics, and the prescribed target. */
export interface LogFormContext {
  athleteId: string;
  day: number;
  exerciseId: string;
  exerciseName: string;
  /** Human target line, e.g. "3 × 8 (rest 90s)". */
  targetText: string;
  /** Prescribed reps for the reps-input placeholder (may be a distance string like "15yd"). */
  prescribedReps?: number | string;
  /** Resolved metric descriptors, in the exercise's declared order. */
  metrics: Metric[];
  /** Prior progress per metric (last-session value + PR) — the target to beat. Optional. */
  priors?: MetricProgress[];
}

/** "Last time / PR" prompt from prior logs — the target to beat. Empty on a first-ever log. */
function priorPrompt(priors: MetricProgress[] | undefined): string {
  const withData = (priors ?? []).filter((p) => p.best !== null);
  if (withData.length === 0) return '';
  const rows = withData.map((p) => {
    const last = p.last !== null ? `<span class="prior-val">last ${esc(String(p.last))} ${esc(p.unit)}</span>` : '';
    const pr = `<span class="prior-val">PR <b>${esc(String(p.best))} ${esc(p.unit)}</b></span>`;
    return `<div class="prior"><span class="prior-lab">${esc(p.label)}</span>${last}${pr}</div>`;
  }).join('');
  return card('Last time · PR — the target to beat', rows);
}

/** Resolve an exercise's metric ids to descriptors, dropping any that don't resolve (defensive). */
export function resolveMetrics(metricIds: string[]): Metric[] {
  return metricIds.map(metricById).filter((m): m is Metric => m !== undefined);
}

/** An empty log form: today's date and `prescribedSets` blank rows (at least one). */
export function emptyLogValues(prescribedSets: number, metricIds: string[]): LogFormValues {
  const rows = Math.max(1, Math.min(MAX_SET_ROWS, prescribedSets || 1));
  const sets: SetRowValues[] = [];
  for (let i = 0; i < rows; i++) {
    sets.push({ values: Object.fromEntries(metricIds.map((m) => [m, ''])), note: '' });
  }
  return { date: todayIso(), sets };
}

/** Rebuild the submitted rows from params so a rejected form re-renders with entries intact. */
export function logValuesFromParams(p: URLSearchParams, metricIds: string[]): LogFormValues {
  const count = Math.max(0, Math.min(MAX_SET_ROWS, Number(p.get('setCount')) || 0));
  const sets: SetRowValues[] = [];
  for (let i = 0; i < count; i++) {
    const values = Object.fromEntries(metricIds.map((m) => [m, (p.get(`set${i}_${m}`) ?? '').trim()]));
    sets.push({ values, note: (p.get(`set${i}_note`) ?? '').trim() });
  }
  return { date: (p.get('date') ?? '').trim(), sets };
}

/**
 * Validate a logging submission. Well-formed INPUT only (date shape + per-metric typing via the
 * shared `validateSetValues`) — it never touches the store or snapshots the prescription; the
 * server does that. Fully-empty rows are skipped (the coach added a row and left it blank, or cut
 * a set short); at least one non-empty set is required.
 */
export function validateLogForm(
  metricIds: string[], v: LogFormValues,
): { sets: ParsedSet[] | null; errors: FieldErrors } {
  const errors: FieldErrors = {};

  if (!isIsoDate(v.date)) errors.date = 'Use a valid date (YYYY-MM-DD).';
  else if (v.date > todayIso()) errors.date = 'Log date is in the future.';

  const parsed: ParsedSet[] = [];
  let anyRow = false;
  v.sets.forEach((row, i) => {
    const values: Record<string, number> = {};
    let hasValue = false;
    for (const m of metricIds) {
      const raw = (row.values[m] ?? '').trim();
      if (raw === '') continue;
      hasValue = true;
      values[m] = Number(raw); // NaN if non-numeric — validateSetValues flags it below
    }
    if (!hasValue) return; // fully-empty row → skip (a note alone isn't a set)
    anyRow = true;
    const logical = parsed.length + 1;
    const rowErrs = validateSetValues(metricIds, values);
    if (rowErrs.length) {
      errors[`set${i}`] = `Set ${logical}: ${rowErrs.join('; ')}`;
      return;
    }
    parsed.push({ setIndex: logical, values, ...(row.note ? { note: row.note } : {}) });
  });

  if (!anyRow) errors._sets = 'Log at least one set — enter a value in a row.';

  if (Object.keys(errors).length > 0) return { sets: null, errors };
  return { sets: parsed, errors };
}

/**
 * One set row. `idxName` is the stable field-name index (`set{idxName}_load`…); `displayNum` is the
 * visible set number (renumbered client-side as rows are added/removed). Rendered both for the live
 * rows and — with `__i__`/`__n__` placeholder tokens — as the JS clone template for "+ Add set".
 */
function setRow(idxName: string, displayNum: string, ctx: LogFormContext, row: SetRowValues | undefined, errors: FieldErrors): string {
  const cells = ctx.metrics.map((m) => {
    const raw = row?.values[m.id] ?? '';
    const step = m.input === 'integer' ? '1' : 'any';
    const ph = m.id === 'reps' && ctx.prescribedReps != null ? ` placeholder="${esc(String(ctx.prescribedReps))}"` : '';
    return `<label class="setcell"><span class="setcell-lab">${esc(m.label)} <span class="unit">${esc(m.unit)}</span></span>`
      + `<input type="number" name="set${esc(idxName)}_${esc(m.id)}" value="${esc(raw)}" min="0" step="${step}" inputmode="decimal"${ph}></label>`;
  }).join('');
  const err = errors[`set${idxName}`] ? `<span class="fieldErr">${esc(errors[`set${idxName}`])}</span>` : '';
  return `<div class="setrow" data-row="${esc(idxName)}">`
    + `<span class="setnum">Set <b class="setnum-n">${esc(displayNum)}</b></span>`
    + `<div class="setcells">${cells}</div>`
    + `<label class="setcell setnote"><span class="setcell-lab">Note</span>`
    + `<input type="text" name="set${esc(idxName)}_note" value="${esc(row?.note ?? '')}" placeholder="optional"></label>`
    + `<button type="button" class="btn secondary setremove" onclick="ccRemoveSet(this)">Remove</button>`
    + err
    + `</div>`;
}

/** Inline JS: add a set (clone the template), remove a set (clear+hide), renumber visible rows. */
function logFormJs(): string {
  return `<script>
function ccRenum(){var n=0;document.querySelectorAll('#setrows .setrow').forEach(function(r){if(r.classList.contains('hidden'))return;n++;var b=r.querySelector('.setnum-n');if(b)b.textContent=n;});}
function ccAddSet(){var c=document.getElementById('setCount');var i=parseInt(c.value||'0',10);
  var tpl=document.getElementById('setrowtpl').innerHTML.replace(/__i__/g,i).replace(/__n__/g,i+1);
  var wrap=document.createElement('div');wrap.innerHTML=tpl.trim();var row=wrap.firstElementChild;
  document.getElementById('setrows').appendChild(row);c.value=i+1;ccRenum();}
function ccRemoveSet(btn){var row=btn.closest('.setrow');row.classList.add('hidden');
  row.querySelectorAll('input').forEach(function(inp){inp.value='';});ccRenum();}
</script>`;
}

/** The per-exercise logging form: prescribed target up top, one input row per set, add/remove. */
export function logFormPage(athlete: AthleteProfile, ctx: LogFormContext, v: LogFormValues, errors: FieldErrors): string {
  const back = `/athlete?id=${encodeURIComponent(athlete.athleteId)}`;
  const action = `/log/new?athleteId=${encodeURIComponent(ctx.athleteId)}&day=${encodeURIComponent(String(ctx.day))}&exerciseId=${encodeURIComponent(ctx.exerciseId)}`;
  const rows = v.sets.map((row, i) => setRow(String(i), String(i + 1), ctx, row, errors)).join('');
  const template = setRow('__i__', '__n__', ctx, undefined, {});
  const metricList = ctx.metrics.map((m) => `${m.label} (${m.unit})`).join(' · ') || 'no metrics';
  const body = `
    <p class="sub"><a href="${esc(back)}">← ${esc(athlete.displayName)}</a></p>
    <h1>Log — ${esc(ctx.exerciseName)}</h1>
    <p class="sub">Day ${esc(String(ctx.day))} · prescribed <b>${esc(ctx.targetText)}</b> · logging ${esc(metricList)}</p>
    ${priorPrompt(ctx.priors)}
    ${errorBanner(Object.values(errors))}
    <form class="cc log-form" method="post" action="${esc(action)}">
      ${card('When', textField('date', 'Date', v.date, errors, { type: 'date' }))}
      ${card('Sets — actuals against the prescribed target', `
        <div id="setrows">${rows}</div>
        <input type="hidden" name="setCount" id="setCount" value="${esc(String(v.sets.length))}">
        <div class="actions"><button type="button" class="btn secondary" onclick="ccAddSet()">+ Add set</button></div>
        <template id="setrowtpl">${template}</template>
      `)}
      <div class="actions">
        <button class="btn" type="submit">Save log</button>
        <a class="btn secondary" href="${esc(back)}">Cancel</a>
      </div>
      ${logFormJs()}
    </form>`;
  return page(`Log — ${ctx.exerciseName}`, body);
}

/** The post-save reveal — the FIRST time the computed tier is shown for this entry (§3.7). */
export function assessmentRevealPage(athlete: AthleteProfile, warnings: string[], a: Assessment): string {
  const back = `/athlete?id=${encodeURIComponent(athlete.athleteId)}`;
  const gut = a.coachGutCall;
  const match = gut !== null && gut === a.finalTier;
  const gateHtml = a.gateFired === 'none' ? '<span class="muted">none</span>' : `<code>${esc(a.gateFired)}</code>`;
  const warnHtml = warnings.length
    ? `<div class="banner err"><b>Warnings:</b><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';
  // Hero reveal: computed tier, the gut-call verdict (the validation signal), and the raw math.
  const gutSub = gut !== null
    ? (match ? 'matched the engine' : 'differs — validation signal')
    : 'no gut-call recorded';
  const summary = statStrip([
    statCard('Computed tier', tierBadge(a.finalTier), esc(TIER_STAGE[a.finalTier])),
    statCard('Your gut-call',
      gut !== null
        ? `${tierBadge(gut)} ${match ? statusFlag('quiet', 'match') : statusFlag('accent', 'differs')}`
        : '<span class="muted">—</span>',
      gutSub),
    statCard('Raw score', num(`${a.rawTotal}/18`), `base ${tierBadge(a.baseTier)} · gate ${gateHtml}`),
  ]);
  const body = `
    <p class="sub"><a href="${esc(back)}">← ${esc(athlete.displayName)}</a></p>
    <h1>Assessment saved</h1>
    ${warnHtml}
    ${summary}
    <p>Suggested re-assessment: <b>${num(nextAssessmentDate(a.date))}</b> (+5 weeks).</p>
    <div class="actions">
      <a class="btn" href="${esc(back)}">View athlete</a>
      <a class="btn secondary" href="/assessment/new?athleteId=${encodeURIComponent(athlete.athleteId)}">Enter another</a>
    </div>`;
  return page('Assessment saved', body);
}
