/**
 * HTML render helpers for the dashboard.
 *
 * Visual system: **Direction B — "Field Notes"** (see `direction-b-field-notes.md`). A sports-science
 * field manual: off-white + ink, one warm accent (Orange Pantone) spent deliberately, Midnight Green
 * reserved for the maturity axis so it can never be confused with the tier ramp. Flat surfaces,
 * hairline rules, no shadows.
 *
 * Purity contract (DESIGNER_HANDOFF §2): every function here is `data in → HTML string out`. No I/O,
 * no engine calls, no tier recompute. The token layer below is a static constant. Colours live ONLY
 * as CSS custom properties (`--cc-*`) — no scattered hex in markup — so the system is retunable in one
 * place and transfers into the real app as a token set.
 *
 * NOTE (§3.3): this dashboard is COACH-FACING, so it may show tiers and raw scores. An athlete/parent
 * surface must NOT — that visibility boundary lives in engine/types.ts (`isVisibleTo`).
 */

/** HTML-escape a value for safe interpolation. */
export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Design tokens + component styles (Direction B). Single source of truth for colour.
// ---------------------------------------------------------------------------

const CSS = `
  :root {
    color-scheme: light;

    /* — Surfaces — */
    --cc-canvas: #ECE9E2;      /* outer wrapper behind the app frame (not the product) */
    --cc-bg: #F7F6F2;          /* app background + card fills — deliberately neutral */
    --cc-row-tint: #F2F0EA;    /* table header + row hover */
    --cc-urgent: #F7F0EB;      /* urgent row wash — desaturated toward the accent, not an alarm */
    --cc-urgent-hover: #F1E4DA;

    /* — Ink + text — */
    --cc-ink: #233038;         /* Gunmetal: headings, primary labels, primary buttons, nav */
    --cc-muted: #5C666D;       /* secondary labels, timestamps, helper copy */

    /* — Lines — */
    --cc-border: #D3DBDD;      /* Light Silver: dividers, input borders, table rules */
    --cc-border-faint: #EAE7DF;/* row dividers inside dense tables */

    /* — Accent (spent deliberately: "this matters most") — */
    --cc-accent: #FF5B04;      /* Orange Pantone */
    --cc-accent-ink: #F7F6F2;

    /* — Maturity axis — its own hue, never the tier family (hard invariant §4) — */
    --cc-maturity: #075056;    /* Midnight Green */

    /* — Tier ramp: one hue, rising saturation. Letter stays as redundant signal. — */
    --cc-tier-c-bg: #FCE0CC; --cc-tier-c-fg: #8A3B0A;
    --cc-tier-b-bg: #FAB37D; --cc-tier-b-fg: #7A3306;
    --cc-tier-a-bg: #FF8B45; --cc-tier-a-fg: #4A1F02;
    --cc-tier-s-bg: #FF5B04; --cc-tier-s-fg: #F7F6F2;
    --cc-tier-none-bg: #EDE9DC; --cc-tier-none-fg: #A6A39A;

    /* — Status — */
    --cc-over-bg: #FF5B04; --cc-over-fg: #F7F6F2;      /* shares accent w/ tier S: "maximum signal" */
    --cc-watch-bg: #FBEFCF; --cc-watch-fg: #6B4E12;    /* Sand Yellow tint */
    --cc-quiet: #B7B3A8;                                /* ok / n-a — quiet by design */
    --cc-valgus-bg: #E6EAEB; --cc-valgus-fg: #233038;  /* neutral chip: a note, not a severity */
    --cc-bad: #B4534F;                                  /* form field error */

    /* — Type — */
    --cc-font-display: 'Archivo', ui-sans-serif, system-ui, sans-serif;
    --cc-font-body: 'Inter', ui-sans-serif, system-ui, sans-serif;
    --cc-font-mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', monospace;

    /* — Radii — */
    --cc-r-card: 12px; --cc-r-btn: 8px; --cc-r-badge: 6px; --cc-r-pill: 20px;
  }

  * { box-sizing: border-box; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
  html { background: var(--cc-canvas); }
  body {
    margin: 0; background: var(--cc-canvas); color: var(--cc-ink);
    font: 400 13px/1.55 var(--cc-font-body);
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }

  /* App frame — a manual sitting on a desk. */
  .app { max-width: 1180px; margin: 0 auto; background: var(--cc-bg); min-height: 100vh;
    border-left: 1px solid var(--cc-border); border-right: 1px solid var(--cc-border); }

  header.cc-head {
    display: flex; align-items: baseline; gap: 22px;
    padding: 16px 32px; background: var(--cc-bg);
    border-bottom: 1px solid var(--cc-border); position: sticky; top: 0; z-index: 10;
  }
  header.cc-head .brand { font: 800 15px/1 var(--cc-font-display); letter-spacing: -.01em; }
  header.cc-head nav { display: flex; gap: 18px; }
  header.cc-head nav a {
    font: 600 12px/1 var(--cc-font-body); color: var(--cc-muted); text-decoration: none;
    padding-bottom: 2px; border-bottom: 2px solid transparent;
  }
  header.cc-head nav a:hover { color: var(--cc-ink); }
  header.cc-head nav a.active { color: var(--cc-ink); border-bottom-color: var(--cc-accent); }
  header.cc-head .eyebrow { margin-left: auto; }

  main { padding: 28px 32px 48px; }

  /* — Typography — */
  h1 { font: 800 27px/1.15 var(--cc-font-display); letter-spacing: -.015em; margin: 0 0 4px; }
  h2 { font: 700 12px/1.2 var(--cc-font-body); text-transform: uppercase; letter-spacing: .08em;
    color: var(--cc-muted); margin: 30px 0 12px; }
  h4 { font: 600 11px/1.2 var(--cc-font-body); text-transform: uppercase; letter-spacing: .08em;
    color: var(--cc-muted); margin: 14px 0 6px; }
  .eyebrow { font: 600 11px/1 var(--cc-font-body); text-transform: uppercase; letter-spacing: .08em;
    color: var(--cc-muted); }
  .sub { color: var(--cc-muted); margin: 0 0 20px; }
  .muted { color: var(--cc-muted); }
  .num { font-family: var(--cc-font-mono); font-feature-settings: 'tnum' 1; }
  a { color: var(--cc-ink); }
  code { font-family: var(--cc-font-mono); font-size: 12px; background: var(--cc-row-tint);
    border: 1px solid var(--cc-border-faint); padding: 0 5px; border-radius: 4px; }

  /* — Cards — */
  .card { background: var(--cc-bg); border: 1px solid var(--cc-border); border-radius: var(--cc-r-card);
    padding: 18px; margin: 0 0 16px; }
  .card > h2:first-child, .card > h4:first-child { margin-top: 0; }
  /* card-title is a real <h2> for document outline, restyled off the eyebrow default. */
  h2.card-title { font: 600 15px/1.2 var(--cc-font-body); text-transform: none; letter-spacing: normal;
    color: var(--cc-ink); margin: 0 0 12px; }

  /* — Stat strip (hero numbers) — */
  .stats { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 22px; }
  .stat { flex: 1 1 160px; background: var(--cc-bg); border: 1px solid var(--cc-border);
    border-radius: var(--cc-r-card); padding: 16px 18px; }
  .stat .stat-label { font: 600 11px/1 var(--cc-font-body); text-transform: uppercase;
    letter-spacing: .08em; color: var(--cc-muted); margin: 0 0 8px; }
  .stat .stat-value { font: 800 36px/1 var(--cc-font-display); letter-spacing: -.02em; }
  .stat .stat-sub { font-size: 12px; color: var(--cc-muted); margin-top: 6px; }

  /* — Triage cards (clickable filters above the roster) — */
  .triage { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 20px; }
  .triage-card { appearance: none; text-align: left; cursor: pointer; font: inherit;
    background: var(--cc-bg); border: 1px solid var(--cc-border); border-radius: var(--cc-r-card);
    padding: 14px 16px; min-width: 150px; transition: border-color .12s ease, background .12s ease; }
  .triage-card:hover { border-color: var(--cc-ink); }
  .triage-card.active { border-color: var(--cc-accent); background: var(--cc-urgent); }
  .triage-card .tc-count { font: 800 30px/1 var(--cc-font-display); letter-spacing: -.02em; }
  .triage-card .tc-count.accent { color: var(--cc-accent); }
  .triage-card .tc-count.maturity { color: var(--cc-maturity); }
  .triage-card .tc-label { display: block; font: 600 11px/1.3 var(--cc-font-body);
    text-transform: uppercase; letter-spacing: .06em; color: var(--cc-muted); margin-top: 8px; }

  /* — Tables — */
  table { border-collapse: collapse; width: 100%; margin: 4px 0 8px; }
  thead th { text-align: left; font: 600 10px/1.2 var(--cc-font-body); text-transform: uppercase;
    letter-spacing: .08em; color: var(--cc-muted); background: var(--cc-row-tint);
    padding: 8px 12px; border-bottom: 1px solid var(--cc-border); }
  tbody td { padding: 9px 12px; border-bottom: 1px solid var(--cc-border-faint); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--cc-row-tint); }
  tbody tr.urgent td { background: var(--cc-urgent); }
  tbody tr.urgent:hover td { background: var(--cc-urgent-hover); }
  a.row { color: var(--cc-ink); text-decoration: none; font-weight: 600; }
  a.row:hover { text-decoration: underline; text-decoration-color: var(--cc-accent);
    text-underline-offset: 3px; }
  .empty { color: var(--cc-muted); font-style: italic; padding: 14px 2px; }

  /* — Tier badge: fixed rounded-square chip, letter centred, from the ramp — */
  .tier { display: inline-flex; align-items: center; justify-content: center; min-width: 24px;
    height: 22px; padding: 0 7px; border-radius: var(--cc-r-badge);
    font: 700 12px/1 var(--cc-font-display); }
  .tier-S { background: var(--cc-tier-s-bg); color: var(--cc-tier-s-fg); }
  .tier-A { background: var(--cc-tier-a-bg); color: var(--cc-tier-a-fg); }
  .tier-B { background: var(--cc-tier-b-bg); color: var(--cc-tier-b-fg); }
  .tier-C { background: var(--cc-tier-c-bg); color: var(--cc-tier-c-fg); }
  .tier-none { background: var(--cc-tier-none-bg); color: var(--cc-tier-none-fg); }

  /* — Chips / pills — */
  .pill { display: inline-block; padding: 2px 9px; border-radius: var(--cc-r-pill);
    font: 600 12px/1.5 var(--cc-font-body); background: var(--cc-valgus-bg); color: var(--cc-valgus-fg); }
  .pill.data { font-family: var(--cc-font-mono); font-size: 11px; background: var(--cc-row-tint);
    border: 1px solid var(--cc-border-faint); color: var(--cc-ink); }

  /* — Status flags: icon/dot + text, never a bare colour swatch (§4 invariant) — */
  .flag { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .flag::before { content: ""; width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .flag-accent { color: var(--cc-accent); } .flag-accent::before { background: var(--cc-accent); }
  .flag-quiet { color: var(--cc-quiet); font-weight: 400; } .flag-quiet::before { background: var(--cc-quiet); }
  .load-over { display: inline-block; padding: 2px 9px; border-radius: var(--cc-r-badge);
    font: 600 12px/1.5 var(--cc-font-body); background: var(--cc-over-bg); color: var(--cc-over-fg); }
  .load-watch { display: inline-block; padding: 2px 9px; border-radius: var(--cc-r-badge);
    font: 600 12px/1.5 var(--cc-font-body); background: var(--cc-watch-bg); color: var(--cc-watch-fg); }

  /* — Maturity marker: triangle + mono value, Midnight Green, never near the tier family — */
  .maturity { display: inline-flex; align-items: center; gap: 6px; font-family: var(--cc-font-mono);
    font-size: 12px; color: var(--cc-muted); }
  .maturity .tri { width: 0; height: 0; border-left: 5px solid transparent;
    border-right: 5px solid transparent; border-bottom: 8px solid var(--cc-quiet); flex: none; }
  .maturity.near { color: var(--cc-maturity); font-weight: 600; }
  .maturity.near .tri { border-bottom-color: var(--cc-maturity); }

  /* — Score-trend cells — */
  .score-low { color: var(--cc-accent); font-weight: 700; }
  .score-high { color: var(--cc-maturity); font-weight: 600; }

  /* — Bars (validation gate tally + agreement) — */
  .bar { display: flex; align-items: center; gap: 10px; }
  .bar-track { flex: 1; height: 8px; background: var(--cc-row-tint); border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: var(--cc-ink); border-radius: 4px; }
  .bar-fill.accent { background: var(--cc-accent); }
  .bar-val { font-family: var(--cc-font-mono); font-size: 12px; color: var(--cc-muted); min-width: 26px; }

  /* — Plan day-tabs — */
  .tabs { display: flex; gap: 4px; margin: 10px 0 14px; flex-wrap: wrap; border-bottom: 1px solid var(--cc-border); }
  .tab { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--cc-muted);
    padding: 8px 14px; font: 600 12px/1 var(--cc-font-body); cursor: pointer; margin-bottom: -1px; }
  .tab:hover { color: var(--cc-ink); }
  .tab.active { color: var(--cc-ink); border-bottom-color: var(--cc-accent); }
  .hidden { display: none; }
  .panel-note { color: var(--cc-muted); margin: 0 0 12px; font-size: 12px; }
  .blk { margin: 0 0 14px; }
  ul.ex { list-style: none; padding: 0; margin: 0; }
  ul.ex li { padding: 8px 2px; border-bottom: 1px solid var(--cc-border-faint); }
  ul.ex li:last-child { border-bottom: 0; }
  ul.ex .cue { font-size: 12px; color: var(--cc-muted); }

  /* — Buttons: primary is solid Gunmetal (accent stays reserved). One filled per screen. — */
  .btn { display: inline-block; background: var(--cc-ink); color: var(--cc-bg); border: 1px solid var(--cc-ink);
    padding: 9px 18px; border-radius: var(--cc-r-btn); font: 600 13px/1 var(--cc-font-body);
    cursor: pointer; text-decoration: none; }
  .btn:hover { background: #1a242b; }
  .btn.secondary { background: transparent; color: var(--cc-ink); border-color: var(--cc-border); }
  .btn.secondary:hover { border-color: var(--cc-ink); }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 8px; }

  /* — Forms — */
  form.cc { max-width: 640px; }
  .field { margin: 0 0 14px; }
  .field > label { display: block; font: 600 11px/1.2 var(--cc-font-body); text-transform: uppercase;
    letter-spacing: .06em; color: var(--cc-muted); margin: 0 0 5px; }
  .field .hint { display: block; font-size: 12px; color: var(--cc-muted); margin: 4px 0 0; }
  input[type=text], input[type=date], input[type=number], select, textarea {
    width: 100%; background: var(--cc-bg); color: var(--cc-ink); border: 1px solid var(--cc-border);
    border-radius: var(--cc-r-btn); padding: 9px 11px; font: 400 13px/1.4 var(--cc-font-body); }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--cc-accent); outline-offset: 1px;
    border-color: var(--cc-accent); }
  textarea { min-height: 64px; resize: vertical; }
  .field.bad input, .field.bad select, .field.bad textarea { border-color: var(--cc-bad); }
  .field .fieldErr { display: block; color: var(--cc-bad); font-size: 12px; margin: 5px 0 0; font-weight: 600; }
  .check { display: flex; align-items: center; gap: 8px; }
  .check input { width: auto; }
  .check label { text-transform: none; letter-spacing: 0; margin: 0; font-weight: 500; color: var(--cc-ink); }
  .scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
  .split-switch { max-width: 520px; background: var(--cc-row-tint); border: 1px solid var(--cc-border);
    border-radius: var(--cc-r-card); padding: 16px; margin: 0 0 16px; }

  /* — Banners — */
  .banner { padding: 12px 16px; border-radius: var(--cc-r-btn); margin: 0 0 16px; border: 1px solid; }
  .banner.err { background: #FBECEA; border-color: #E7C3BE; color: #7A2E28; }
  .banner.ok { background: #FBEFE6; border-color: #F3C9A6; color: #7A3306; }
  .banner ul { margin: 6px 0 0; padding-left: 18px; }
`;

/** Wrap page body in the shared shell with nav. `active` highlights the current top-level view. */
export function page(title: string, body: string, active?: 'roster' | 'validation'): string {
  const nav = (href: string, label: string, key: 'roster' | 'validation') =>
    `<a href="${href}"${active === key ? ' class="active"' : ''}>${esc(label)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Coaching Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body><div class="app"><header class="cc-head">
  <span class="brand">Command Center</span>
  <nav>${nav('/', 'Roster', 'roster')}${nav('/validation', 'Validation', 'validation')}</nav>
  <span class="eyebrow">coach-only</span>
</header><main>${body}</main></div></body></html>`;
}

/** Human stage name for a tier (Foundational/Developing/Proficient/Advanced). */
const TIER_STAGE_LABEL: Record<string, string> = {
  C: 'Foundational', B: 'Developing', A: 'Proficient', S: 'Advanced',
};

/** Tier badge — the rounded-square chip. `null` renders the distinct "none" state. */
export function tierBadge(tier: string | null): string {
  if (!tier) return '<span class="tier tier-none" title="No assessment on file">—</span>';
  const stage = TIER_STAGE_LABEL[tier] ?? '';
  return `<span class="tier tier-${esc(tier)}"${stage ? ` title="${esc(stage)}"` : ''}>${esc(tier)}</span>`;
}

/** Build a table from headers + row-arrays of pre-rendered cells. */
export function table(headers: string[], rows: string[][], emptyMsg = 'Nothing yet.'): string {
  if (rows.length === 0) return `<p class="empty">${esc(emptyMsg)}</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** One roster row: pre-rendered cells + triage flags used for wash + click-to-filter. */
export interface RosterRow {
  cells: string[];
  reassess?: boolean; // needs re-assessing (never / due)
  nearPHV?: boolean;
  load?: 'over' | 'watch' | null;
  urgent?: boolean; // gets the warm row wash
}

/** Roster table: like {@link table} but each row carries data-flags for the triage filter. */
export function rosterTable(headers: string[], rows: RosterRow[], emptyMsg: string): string {
  if (rows.length === 0) return `<p class="empty">${esc(emptyMsg)}</p>`;
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows.map((r) => {
    const attrs = [
      r.reassess ? 'data-reassess="1"' : '',
      r.nearPHV ? 'data-phv="1"' : '',
      r.load ? `data-load="${r.load}"` : '',
    ].filter(Boolean).join(' ');
    const cells = r.cells.map((c) => `<td>${c}</td>`).join('');
    return `<tr class="roster-row${r.urgent ? ' urgent' : ''}" ${attrs}>${cells}</tr>`;
  }).join('');
  return `<table id="roster"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** A triage/filter card: a count + label that filters the roster table below when clicked. */
export interface TriageCard {
  filter: 'all' | 'reassess' | 'phv' | 'load-over';
  count: number;
  label: string;
  tone?: 'accent' | 'maturity';
}

/**
 * Row of clickable triage cards above the roster — "what needs me today" before the table does.
 * Clicking filters `.roster-row` by the matching data-flag; "All" resets. Inline JS, no reload;
 * with JS off every row is simply visible (progressive enhancement).
 */
export function triageCards(cards: TriageCard[]): string {
  const cardHtml = cards.map((c, i) => {
    const toneClass = c.tone ? ` ${c.tone}` : '';
    return `<button class="triage-card${i === 0 ? ' active' : ''}" data-filter="${esc(c.filter)}" onclick="ccTriage(this)">`
      + `<span class="tc-count${toneClass}">${c.count}</span>`
      + `<span class="tc-label">${esc(c.label)}</span></button>`;
  }).join('');
  const js = `<script>function ccTriage(btn){`
    + `document.querySelectorAll('.triage-card').forEach(function(c){c.classList.toggle('active',c===btn);});`
    + `var f=btn.getAttribute('data-filter');`
    + `document.querySelectorAll('#roster tbody tr.roster-row').forEach(function(r){`
    + `var show=f==='all'||(f==='reassess'&&r.getAttribute('data-reassess')==='1')`
    + `||(f==='phv'&&r.getAttribute('data-phv')==='1')`
    + `||(f==='load-over'&&r.getAttribute('data-load')==='over');`
    + `r.classList.toggle('hidden',!show);});}</script>`;
  return `<div class="triage">${cardHtml}</div>${js}`;
}

/** A stat card (hero number + label + optional sub-line) for summary strips. */
export function statCard(label: string, valueHtml: string, sub?: string): string {
  return `<div class="stat"><p class="stat-label">${esc(label)}</p>`
    + `<div class="stat-value">${valueHtml}</div>`
    + (sub ? `<p class="stat-sub">${sub}</p>` : '')
    + `</div>`;
}

/** Wrap stat cards in a flex strip. */
export function statStrip(cards: string[]): string {
  return `<div class="stats">${cards.join('')}</div>`;
}

/** Wrap a section in a titled card (real information hierarchy on the athlete page). */
export function card(title: string, body: string): string {
  return `<section class="card"><h2 class="card-title">${esc(title)}</h2>${body}</section>`;
}

/** Mono numeric span (dates, cm/yr, raw totals — digit alignment matters). */
export function num(value: string): string {
  return `<span class="num">${esc(value)}</span>`;
}

/** Status flag: dot + text, never a bare colour. `tone` picks the semantic colour. */
export function statusFlag(tone: 'accent' | 'quiet', text: string): string {
  return `<span class="flag flag-${tone}">${esc(text)}</span>`;
}

/**
 * Maturity marker — triangle + mono value in Midnight Green, deliberately outside the tier family
 * so the two axes can never read as one signal (§4). `near` = at/near PHV (dose-pullback state).
 */
export function maturityMarker(text: string, near: boolean): string {
  return `<span class="maturity${near ? ' near' : ''}"><span class="tri"></span>${esc(text)}</span>`;
}

/** A labelled horizontal bar (validation gate tally / agreement). `pct` is 0–100. */
export function bar(pct: number, valueText: string, accent = false): string {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="bar"><span class="bar-track"><span class="bar-fill${accent ? ' accent' : ''}" style="width:${w}%"></span></span>`
    + `<span class="bar-val">${esc(valueText)}</span></div>`;
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
          const tags = it.tags.length ? ` <span class="pill data">${esc(it.tags.join(' · '))}</span>` : '';
          const cue = it.cue ? `<br><span class="cue">${esc(it.cue)}</span>` : '';
          return `<li><b>${esc(it.name)}</b> <span class="num muted">${esc(it.doseText)}</span>${tags}${cue}</li>`;
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
