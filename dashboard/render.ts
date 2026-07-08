/**
 * HTML render helpers for the dashboard — DISPOSABLE surface (BUILD_BRIEF §1). Deliberately
 * dependency-free, server-rendered plain HTML with inline CSS. Will be rebuilt for the app;
 * kept boring on purpose.
 *
 * NOTE (§3.3): this dashboard is COACH-FACING, so it may show tiers and raw scores. An
 * athlete/parent-facing surface must NOT — that visibility boundary lives in engine/types.ts
 * (`isVisibleTo`) and is the app's concern, not this tool's.
 */

/** HTML-escape a value for safe interpolation. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; background: #0f1216; color: #e6e9ee; }
  header { padding: 14px 22px; background: #151a21; border-bottom: 1px solid #232a33; position: sticky; top: 0; }
  header a { color: #8ab4ff; text-decoration: none; margin-right: 18px; font-weight: 600; }
  header a:hover { text-decoration: underline; }
  main { padding: 22px; max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 26px 0 10px; color: #b9c2cf; }
  .sub { color: #8b95a3; margin: 0 0 18px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0 18px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #232a33; }
  th { color: #8b95a3; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  tr:hover td { background: #141922; }
  a.row { color: #e6e9ee; text-decoration: none; font-weight: 600; }
  a.row:hover { color: #8ab4ff; }
  .tier { display: inline-block; min-width: 22px; text-align: center; padding: 1px 8px; border-radius: 5px; font-weight: 700; }
  .tier-S { background: #3b2a5c; color: #d7c3ff; }
  .tier-A { background: #12402f; color: #86efac; }
  .tier-B { background: #3a3512; color: #fde68a; }
  .tier-C { background: #3a2317; color: #fdba74; }
  .flag { color: #fca5a5; font-weight: 700; }
  .ok { color: #86efac; }
  .muted { color: #8b95a3; }
  .pill { display:inline-block; padding:1px 7px; border-radius:9px; font-size:12px; background:#232a33; color:#b9c2cf; }
  .match { color:#86efac; } .differ { color:#fca5a5; font-weight:700; }
  .empty { color:#8b95a3; font-style: italic; padding: 12px 0; }
  code { background:#1b222b; padding:1px 5px; border-radius:4px; }
  .tabs { display:flex; gap:6px; margin:6px 0 14px; flex-wrap:wrap; }
  .tab { background:#1b222b; color:#b9c2cf; border:1px solid #232a33; padding:6px 14px; border-radius:8px; cursor:pointer; font:inherit; font-weight:600; }
  .tab:hover { background:#232a33; }
  .tab.active { background:#12402f; color:#86efac; border-color:#1c5a3f; }
  .hidden { display:none; }
  .blk { margin:0 0 12px; }
  .blk h4 { margin:12px 0 6px; font-size:12px; color:#8b95a3; text-transform:uppercase; letter-spacing:.04em; }
  ul.ex { list-style:none; padding:0; margin:0; }
  ul.ex li { padding:6px 2px; border-bottom:1px solid #1b222b; }
  ul.ex .cue { font-size:12px; color:#8b95a3; }
  .panel-note { color:#8b95a3; margin:0 0 10px; }
  form.cc { max-width: 640px; }
  .field { margin: 0 0 14px; }
  .field > label { display:block; font-size:12px; color:#b9c2cf; font-weight:600; margin:0 0 4px; text-transform:uppercase; letter-spacing:.03em; }
  .field .hint { display:block; font-size:12px; color:#8b95a3; margin:3px 0 0; }
  input[type=text], input[type=date], input[type=number], select, textarea {
    width:100%; background:#0b0e12; color:#e6e9ee; border:1px solid #2a323d; border-radius:8px;
    padding:8px 10px; font:inherit; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:#8ab4ff; }
  textarea { min-height:64px; resize:vertical; }
  .field.bad input, .field.bad select, .field.bad textarea { border-color:#b4534f; }
  .field .fieldErr { display:block; color:#fca5a5; font-size:12px; margin:4px 0 0; font-weight:600; }
  .check { display:flex; align-items:center; gap:8px; }
  .check input { width:auto; }
  .check label { text-transform:none; letter-spacing:0; margin:0; }
  .scores { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; }
  .btn { display:inline-block; background:#12402f; color:#86efac; border:1px solid #1c5a3f; padding:8px 16px;
    border-radius:8px; font:inherit; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn:hover { background:#164d38; }
  .btn.secondary { background:#1b222b; color:#b9c2cf; border-color:#2a323d; }
  .btn.secondary:hover { background:#232a33; }
  .actions { display:flex; gap:10px; align-items:center; margin-top:6px; }
  .banner { padding:10px 14px; border-radius:8px; margin:0 0 16px; }
  .banner.err { background:#341b1b; border:1px solid #5a2a2a; color:#fca5a5; }
  .banner.ok { background:#12291f; border:1px solid #1c5a3f; color:#86efac; }
  .banner ul { margin:6px 0 0; padding-left:18px; }
`;

/** Wrap page body in the shared shell with nav. */
export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Coaching Command Center</title><style>${CSS}</style></head>
<body><header>
  <a href="/">Roster</a><a href="/validation">Validation</a>
  <span class="muted">Coaching Command Center · coach-only</span>
</header><main>${body}</main></body></html>`;
}

/** Tier badge. */
export function tierBadge(tier: string | null): string {
  if (!tier) return '<span class="muted">—</span>';
  return `<span class="tier tier-${esc(tier)}">${esc(tier)}</span>`;
}

/** Build a table from headers + row-arrays of pre-rendered cells. */
export function table(headers: string[], rows: string[][], emptyMsg = 'Nothing yet.'): string {
  if (rows.length === 0) return `<p class="empty">${esc(emptyMsg)}</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// One block (warm-up / jump / lift / …) of an assembled session — its title + exercise items.
interface RenderBlock {
  title: string;
  items: { name: string; doseText: string; tags: string[]; cue: string }[];
}

/** Render one assembled session (its blocks + exercises) to HTML for a plan-day panel. */
export function sessionHtml(blocks: RenderBlock[]): string {
  return blocks
    .map((b) => {
      const items = b.items
        .map((it) => {
          const tags = it.tags.length ? ` <span class="pill">${esc(it.tags.join(' · '))}</span>` : '';
          const cue = it.cue ? `<br><span class="cue">${esc(it.cue)}</span>` : '';
          return `<li><b>${esc(it.name)}</b> <span class="muted">${esc(it.doseText)}</span>${tags}${cue}</li>`;
        })
        .join('');
      return `<div class="blk"><h4>${esc(b.title)}</h4><ul class="ex">${items}</ul></div>`;
    })
    .join('');
}

/**
 * Client-side tab component: `Day N` buttons + one panel each, all rendered server-side with only
 * the first visible. Toggling is instant inline JS (no reload). Panels are `{ label, html }`.
 */
export function planTabs(panels: { label: string; html: string }[]): string {
  const tabs = panels
    .map((p, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-tab="${i}" onclick="ccTab(this)">${esc(p.label)}</button>`)
    .join('');
  const bodies = panels
    .map((p, i) => `<div class="tabpanel${i === 0 ? '' : ' hidden'}" data-panel="${i}">${p.html}</div>`)
    .join('');
  const js = `<script>function ccTab(btn){var root=btn.closest('.plan');var i=btn.getAttribute('data-tab');`
    + `root.querySelectorAll('.tab').forEach(function(t){t.classList.toggle('active',t.getAttribute('data-tab')===i);});`
    + `root.querySelectorAll('.tabpanel').forEach(function(p){p.classList.toggle('hidden',p.getAttribute('data-panel')!==i);});}</script>`;
  return `<div class="plan"><div class="tabs">${tabs}</div>${bodies}${js}</div>`;
}

// ---------------------------------------------------------------------------
// Form helpers (Phase 2 write surface). Every value is `esc()`d — these fields are now
// browser-sourced, so this is a real XSS surface even on localhost.
// ---------------------------------------------------------------------------

/** Per-field validation messages, keyed by input name. */
export type FieldErrors = Record<string, string>;

/** Wrap a labelled input + optional hint + optional error into a field row. */
function field(name: string, label: string, control: string, errors: FieldErrors, hint?: string): string {
  const err = errors[name];
  const hintHtml = hint ? `<span class="hint">${esc(hint)}</span>` : '';
  const errHtml = err ? `<span class="fieldErr">${esc(err)}</span>` : '';
  return `<div class="field${err ? ' bad' : ''}"><label for="f_${esc(name)}">${esc(label)}</label>${control}${hintHtml}${errHtml}</div>`;
}

/** Text / date / number input field. */
export function textField(
  name: string, label: string, value: string, errors: FieldErrors,
  opts: { type?: 'text' | 'date' | 'number'; placeholder?: string; hint?: string; min?: number; max?: number; step?: string } = {},
): string {
  const attrs = [
    `id="f_${esc(name)}"`, `name="${esc(name)}"`, `type="${opts.type ?? 'text'}"`,
    `value="${esc(value)}"`,
    opts.placeholder ? `placeholder="${esc(opts.placeholder)}"` : '',
    opts.min !== undefined ? `min="${opts.min}"` : '',
    opts.max !== undefined ? `max="${opts.max}"` : '',
    opts.step ? `step="${esc(opts.step)}"` : '',
  ].filter(Boolean).join(' ');
  return field(name, label, `<input ${attrs}>`, errors, opts.hint);
}

/** Textarea field. */
export function textAreaField(name: string, label: string, value: string, errors: FieldErrors, hint?: string): string {
  return field(name, label, `<textarea id="f_${esc(name)}" name="${esc(name)}">${esc(value)}</textarea>`, errors, hint);
}

/** Select field. `options` are `[value, label]`; the current `value` is preselected. */
export function selectField(
  name: string, label: string, value: string, options: [string, string][], errors: FieldErrors, hint?: string,
): string {
  const opts = options
    .map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
  return field(name, label, `<select id="f_${esc(name)}" name="${esc(name)}">${opts}</select>`, errors, hint);
}

/** Checkbox field (renders label to the right of the box). */
export function checkboxField(name: string, label: string, checked: boolean): string {
  return `<div class="field check"><input id="f_${esc(name)}" name="${esc(name)}" type="checkbox" value="1"${checked ? ' checked' : ''}><label for="f_${esc(name)}">${esc(label)}</label></div>`;
}

/** A top-of-form error banner listing the messages that blocked the save. */
export function errorBanner(messages: string[]): string {
  if (messages.length === 0) return '';
  const items = messages.map((m) => `<li>${esc(m)}</li>`).join('');
  return `<div class="banner err"><b>Couldn't save — fix the fields below:</b><ul>${items}</ul></div>`;
}

/** A success/info banner (e.g. the post-save tier reveal). */
export function okBanner(html: string): string {
  return `<div class="banner ok">${html}</div>`;
}
