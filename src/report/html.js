import { CATEGORIES, SEVERITIES, SEVERITY_LABEL_FR } from '../core/severity.js';

/**
 * Marque d'Argus : un oeil, en reference a Argus Panoptes.
 *
 * Embarquee en data URI plutot que referencee : le rapport doit rester un
 * fichier unique, ouvrable hors ligne et partageable tel quel. Le fond plein
 * garantit le contraste quel que soit le theme de l'onglet.
 */
export const ICONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#4c8dff"/>' +
  '<path d="M2.5 16 Q16 3.5 29.5 16 Q16 28.5 2.5 16 Z" fill="#fff"/>' +
  '<circle cx="16" cy="16" r="5.4" fill="#4c8dff"/></svg>';

/** Data URI utilisable directement dans un attribut href/src. */
export function iconeDataUri(svg = ICONE_SVG) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Genere un rapport HTML autonome : un seul fichier, aucune dependance
 * reseau, ouvrable hors ligne. Les donnees sont embarquees en JSON et
 * l'interface (filtres, recherche, tri) est rendue cote client.
 */
export function renderHtml(result, { title = 'Rapport Argus' } = {}) {
  const payload = JSON.stringify(compact(result))
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="fr" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${result.scores.global}/100</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${iconeDataUri()}">
<meta name="theme-color" content="#4c8dff">
<style>${STYLES}</style>
</head>
<body>
<div id="app" class="loading">Chargement du rapport…</div>
<script type="application/json" id="argus-data">${payload}</script>
<script>const ICONE = ${JSON.stringify(iconeDataUri())};
${SCRIPT}</script>
</body>
</html>`;
}

/** Reduit la charge utile : on ne garde que ce que l'interface exploite. */
function compact(result) {
  return {
    tool: result.tool,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    root: result.root,
    project: {
      files: result.project.files,
      analyzed: result.project.analyzed,
      skipped: result.project.skipped,
      frameworks: result.project.frameworks,
      stack: result.project.stack.slice(0, 12),
      dependencies: result.project.dependencies.length,
    },
    scores: result.scores,
    findings: result.findings.map((f) => ({
      ruleId: f.ruleId,
      category: f.category,
      severity: f.severity,
      title: f.title,
      message: f.message,
      file: f.file,
      line: f.line,
      snippet: f.snippet,
      suggestion: f.suggestion,
      docs: f.docs,
      effort: f.effort,
      confidence: f.confidence,
      tags: f.tags,
    })),
    actionPlan: result.actionPlan.map((a) => ({
      priority: a.priority,
      ruleId: a.ruleId,
      category: a.category,
      severity: a.severity,
      title: a.title,
      suggestion: a.suggestion,
      count: a.count,
      effort: a.effort,
      files: a.files.slice(0, 10),
    })),
    routes: result.routes.slice(0, 500).map((r) => ({
      method: r.method,
      pattern: r.pattern,
      kind: r.kind,
      framework: r.framework,
      file: r.file,
      line: r.line,
    })),
    insights: result.insights,
    history: (result.history || []).slice(-12).map((h) => ({ date: h.date, global: h.global, total: h.total, commit: h.commit })),
    labels: {
      categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, c]) => [id, c.label])),
      severities: SEVERITY_LABEL_FR,
      severityOrder: SEVERITIES,
    },
  };
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

const STYLES = `
:root {
  --bg: #0e1117; --surface: #161b22; --surface-2: #1c2230; --border: #2a3240;
  --text: #e6edf3; --text-dim: #9aa7b6; --text-faint: #6b7785;
  --accent: #4c8dff; --accent-soft: rgba(76,141,255,.14);
  --critical: #ff5c5c; --high: #ff8a4c; --medium: #ffc148; --low: #4cc4ff; --info: #7d8896;
  --good: #3fd07f;
  /* Texte pose SUR une pastille de couleur. Les teintes ci-dessus sont vives
     en theme sombre et foncees en theme clair : la couleur de texte doit donc
     s'inverser avec le theme, sinon le badge devient illisible. */
  --on-accent: #0e1117;
  --radius: 10px; --radius-sm: 6px;
  --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.22);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px; --space-8: 48px;
}
@media (prefers-color-scheme: light) {
  :root {
    --bg: #f6f8fa; --surface: #ffffff; --surface-2: #f0f3f6; --border: #d8dee4;
    --text: #1f2328; --text-dim: #59636e; --text-faint: #848d97;
    --accent: #0969da; --accent-soft: rgba(9,105,218,.1);
    --critical: #cf222e; --high: #bc4c00; --medium: #9a6700; --low: #0550ae; --info: #6e7781;
    --good: #1a7f37;
    --on-accent: #ffffff;
    --shadow: 0 1px 2px rgba(31,35,40,.08), 0 8px 24px rgba(31,35,40,.06);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: var(--font); font-size: 14px; line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.loading { padding: var(--space-8); text-align: center; color: var(--text-dim); }
a { color: var(--accent); }
/* color: inherit est indispensable : la couleur des boutons n'est PAS heritee
   par defaut (l'agent utilisateur impose ButtonText, du noir). Sans cela, les
   libelles des cartes de categorie restent noirs en theme sombre. */
button { font: inherit; color: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--radius-sm); }

.wrap { max-width: 1180px; margin: 0 auto; padding: 0 var(--space-5); }

header.top {
  border-bottom: 1px solid var(--border); background: var(--surface);
  position: sticky; top: 0; z-index: 20; backdrop-filter: blur(8px);
}
.top-inner { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) 0; flex-wrap: wrap; }
.brand { font-weight: 700; letter-spacing: .12em; font-size: 13px; color: var(--accent); }
.path { font-family: var(--mono); font-size: 12px; color: var(--text-faint); flex: 1; min-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta { font-size: 12px; color: var(--text-dim); }

.hero { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: var(--space-6); padding: var(--space-6) 0; align-items: center; }
@media (max-width: 800px) { .hero { grid-template-columns: 1fr; } }

.gauge { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); }
.gauge svg { width: 180px; height: 180px; }
.gauge-value { font-size: 44px; font-weight: 700; line-height: 1; }
.gauge-label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .1em; }
.grade { font-weight: 700; font-size: 13px; padding: 2px 10px; border-radius: 999px; }

.cats { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--space-3); }
.cat {
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-3) var(--space-4); text-align: left; width: 100%;
  transition: border-color .15s, transform .15s;
}
.cat:hover { border-color: var(--accent); transform: translateY(-1px); }
.cat[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.cat-head { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.cat-name { font-weight: 600; font-size: 13px; }
.cat-score { font-weight: 700; font-size: 16px; }
.bar { height: 5px; border-radius: 999px; background: var(--surface-2); margin: var(--space-2) 0 var(--space-1); overflow: hidden; }
.bar > i { display: block; height: 100%; border-radius: 999px; transition: width .5s cubic-bezier(.4,0,.2,1); }
.cat-counts { display: flex; gap: var(--space-2); font-size: 11px; color: var(--text-dim); }

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border); margin: var(--space-6) 0 0; overflow-x: auto; }
.tab {
  background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-dim);
  padding: var(--space-3) var(--space-4); font-size: 13px; font-weight: 500; white-space: nowrap;
}
.tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.tab:hover { color: var(--text); }
.tab .count { font-size: 11px; color: var(--text-faint); margin-left: 4px; }

.panel { padding: var(--space-5) 0 var(--space-8); }
.toolbar { display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center; margin-bottom: var(--space-4); }
input[type="search"], select {
  background: var(--surface); border: 1px solid var(--border); color: var(--text);
  border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); font: inherit; font-size: 13px;
}
input[type="search"] { flex: 1; min-width: 200px; }
.chip {
  background: var(--surface); border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 999px; padding: 3px 11px; font-size: 12px; font-weight: 500;
}
.chip[aria-pressed="true"] { color: var(--text); border-color: currentColor; }
.chip.critical[aria-pressed="true"] { color: var(--critical); background: color-mix(in srgb, var(--critical) 12%, transparent); }
.chip.high[aria-pressed="true"] { color: var(--high); background: color-mix(in srgb, var(--high) 12%, transparent); }
.chip.medium[aria-pressed="true"] { color: var(--medium); background: color-mix(in srgb, var(--medium) 12%, transparent); }
.chip.low[aria-pressed="true"] { color: var(--low); background: color-mix(in srgb, var(--low) 12%, transparent); }
.chip.info[aria-pressed="true"] { color: var(--info); background: color-mix(in srgb, var(--info) 12%, transparent); }

.group { margin-bottom: var(--space-4); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); overflow: hidden; }
.group > summary {
  padding: var(--space-3) var(--space-4); cursor: pointer; display: flex; align-items: center; gap: var(--space-3);
  list-style: none; user-select: none;
}
.group > summary::-webkit-details-marker { display: none; }
.group > summary:hover { background: var(--surface-2); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.group-title { font-weight: 600; flex: 1; }
.badge { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-dim); font-variant-numeric: tabular-nums; }
.rule-id { font-family: var(--mono); font-size: 11px; color: var(--text-faint); }

.finding { border-top: 1px solid var(--border); padding: var(--space-4); }
.finding-loc { font-family: var(--mono); font-size: 12px; color: var(--accent); word-break: break-all; }
.finding-msg { margin: var(--space-2) 0; color: var(--text); }
.snippet {
  font-family: var(--mono); font-size: 12px; background: var(--bg); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); overflow-x: auto;
  white-space: pre; color: var(--text-dim); margin: var(--space-2) 0;
}
.fix {
  border-left: 3px solid var(--good); background: color-mix(in srgb, var(--good) 7%, transparent);
  padding: var(--space-2) var(--space-3); border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 13px; margin-top: var(--space-2); white-space: pre-wrap;
}
.fix strong { color: var(--good); }
.tags { display: flex; gap: var(--space-1); flex-wrap: wrap; margin-top: var(--space-2); }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--surface-2); color: var(--text-faint); font-family: var(--mono); }

.plan-item { display: grid; grid-template-columns: 40px 1fr; gap: var(--space-3); padding: var(--space-4); border-top: 1px solid var(--border); }
.plan-item:first-child { border-top: none; }
.plan-num { font-size: 20px; font-weight: 700; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.plan-title { font-weight: 600; }
.plan-meta { font-size: 12px; color: var(--text-dim); margin-top: 2px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
/* Les colonnes de nombres, elles, doivent s'aligner verticalement. */
td.num { font-variant-numeric: tabular-nums; text-align: right; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim); font-weight: 600; }
td.mono { font-family: var(--mono); font-size: 12px; }
.method { font-family: var(--mono); font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: var(--surface-2); }

/* Tuile de tendance : valeur + delta + sparkline, la forme recommandee pour
   « une valeur courante accompagnee d'une evolution ». Ce n'est pas un
   graphique a part entiere — la jauge reste l'unique figure principale. */
.trend { display: flex; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.trend-figure { display: flex; align-items: baseline; gap: var(--space-2); }
.trend-value { font-size: 20px; font-weight: 600; }
.trend-delta { font-size: 13px; font-weight: 600; }
.trend-label { font-size: 12px; color: var(--text-dim); }
.spark { position: relative; }
.spark svg { display: block; overflow: visible; }
.spark-hit { fill: transparent; cursor: crosshair; }
.spark-tip {
  position: absolute; pointer-events: none; opacity: 0; transition: opacity .12s;
  background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 4px 8px; font-size: 12px; white-space: nowrap; box-shadow: var(--shadow);
  transform: translate(-50%, -130%); z-index: 5;
}
.spark-tip[data-open="true"] { opacity: 1; }
.empty { text-align: center; padding: var(--space-8); color: var(--text-dim); }
.empty .big { font-size: 40px; margin-bottom: var(--space-3); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-3); margin-bottom: var(--space-5); }
.stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-3) var(--space-4); }
.stat-v { font-size: 22px; font-weight: 700; }
.stat-l { font-size: 12px; color: var(--text-dim); }
footer { border-top: 1px solid var(--border); padding: var(--space-5) 0; color: var(--text-faint); font-size: 12px; }
@media print { .tabs, .toolbar, header.top { display: none; } .group { break-inside: avoid; } details { open: true; } }
`;

const SCRIPT = String.raw`
(function () {
  const data = JSON.parse(document.getElementById('argus-data').textContent);
  const SEV = data.labels.severityOrder;
  const state = {
    tab: 'findings',
    categories: new Set(),
    severities: new Set(),
    query: '',
    sort: 'severity',
  };

  const el = (tag, attrs, children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children || [])) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  };

  const sevColor = (s) => 'var(--' + s + ')';
  const scoreColor = (n) => (n >= 90 ? 'var(--good)' : n >= 70 ? 'var(--medium)' : 'var(--critical)');

  function filtered() {
    return data.findings.filter((f) => {
      if (state.categories.size && !state.categories.has(f.category)) return false;
      if (state.severities.size && !state.severities.has(f.severity)) return false;
      if (state.query) {
        const hay = (f.title + ' ' + f.message + ' ' + (f.file || '') + ' ' + f.ruleId + ' ' + (f.suggestion || '')).toLowerCase();
        if (!hay.includes(state.query)) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ Header
  function header() {
    return el('header', { class: 'top' }, [
      el('div', { class: 'wrap' }, [
        el('div', { class: 'top-inner' }, [
          el('span', { class: 'brand' }, [
            el('img', { src: ICONE, width: 18, height: 18, alt: '', style: 'vertical-align:-4px;margin-right:7px' }),
            'ARGUS',
          ]),
          el('span', { class: 'path', text: data.root }),
          el('span', { class: 'meta', text: new Date(data.startedAt).toLocaleString('fr-FR') + ' · ' + (data.durationMs / 1000).toFixed(2) + ' s' }),
        ]),
      ]),
    ]);
  }

  function gauge(score, grade) {
    const r = 70, c = 2 * Math.PI * r;
    const svg =
      '<svg viewBox="0 0 180 180" role="img" aria-label="Score global ' + score + ' sur 100">' +
      '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="var(--surface-2)" stroke-width="12"/>' +
      '<circle cx="90" cy="90" r="' + r + '" fill="none" stroke="' + scoreColor(score) + '" stroke-width="12" stroke-linecap="round" ' +
      'stroke-dasharray="' + c + '" stroke-dashoffset="' + (c - (c * score) / 100) + '" transform="rotate(-90 90 90)"/>' +
      '<text x="90" y="86" text-anchor="middle" font-size="42" font-weight="700" fill="var(--text)">' + score + '</text>' +
      '<text x="90" y="108" text-anchor="middle" font-size="12" fill="var(--text-dim)">/ 100</text>' +
      '</svg>';
    return el('div', { class: 'gauge' }, [
      el('div', { html: svg }),
      el('div', { class: 'grade', text: 'Note ' + grade, style: 'background:' + scoreColor(score) + ';color:var(--on-accent)' }),
      el('div', { class: 'gauge-label', text: data.scores.total + ' problemes' }),
    ]);
  }

  /**
   * Tuile de tendance : valeur courante, delta signe, et sparkline 12 points.
   * La forme recommandee pour « une valeur + son evolution » — la jauge reste
   * l'unique figure principale de la page.
   */
  function trendTile() {
    const h = data.history || [];
    if (h.length < 2) return null;

    const scores = h.map((e) => e.global);
    const courant = scores[scores.length - 1];
    const precedent = scores[scores.length - 2];
    const delta = courant - precedent;

    // Un score qui monte est une bonne nouvelle : la couleur suit le sens.
    const couleurDelta = delta > 0 ? 'var(--good)' : delta < 0 ? 'var(--critical)' : 'var(--text-dim)';
    const signe = delta > 0 ? '+' : '';

    const L = 168, H = 36, P = 4;
    const min = Math.min(...scores), max = Math.max(...scores);
    const etendue = Math.max(max - min, 1);
    const x = (i) => P + (i * (L - 2 * P)) / Math.max(scores.length - 1, 1);
    const y = (v) => H - P - ((v - min) / etendue) * (H - 2 * P);
    const chemin = scores.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');

    const svgNS = 'http://www.w3.org/2000/svg';
    const el2 = (tag, attrs) => {
      const n = document.createElementNS(svgNS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };

    const svg = el2('svg', { width: L, height: H, role: 'img',
      'aria-label': scores.length + ' analyses, de ' + scores[0] + ' a ' + courant + ' sur 100' });
    // Trace en teinte attenuee, 2px : la ligne situe, elle ne crie pas.
    svg.appendChild(el2('path', { d: chemin, fill: 'none', stroke: 'var(--text-faint)',
      'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    // Seul le point courant porte l'accent.
    svg.appendChild(el2('circle', { cx: x(scores.length - 1), cy: y(courant), r: '4',
      fill: scoreColor(courant), stroke: 'var(--surface)', 'stroke-width': '2' }));

    const infobulle = el('div', { class: 'spark-tip' });
    // Zones de survol larges : viser un point de 8px au pixel pres est hostile.
    for (let i = 0; i < scores.length; i++) {
      const zone = el2('rect', {
        class: 'spark-hit', x: x(i) - (L / scores.length) / 2, y: 0,
        width: L / scores.length, height: H,
      });
      const e = h[i];
      zone.addEventListener('mouseenter', () => {
        infobulle.textContent = e.global + '/100 · ' + e.total + ' problemes · ' +
          new Date(e.date).toLocaleDateString('fr-FR') + (e.commit ? ' · ' + e.commit : '');
        infobulle.style.left = x(i) + 'px';
        infobulle.dataset.open = 'true';
      });
      zone.addEventListener('mouseleave', () => { infobulle.dataset.open = 'false'; });
      svg.appendChild(zone);
    }

    return el('div', { class: 'group', style: 'padding:16px' }, [
      el('div', { class: 'trend' }, [
        el('div', {}, [
          el('div', { class: 'trend-label', text: 'Evolution du score' }),
          el('div', { class: 'trend-figure' }, [
            el('span', { class: 'trend-value', text: courant + '/100' }),
            el('span', { class: 'trend-delta', text: signe + delta + ' pt', style: 'color:' + couleurDelta }),
          ]),
          el('div', { class: 'trend-label', text: 'depuis l\'analyse precedente' }),
        ]),
        el('div', { class: 'spark' }, [svg, infobulle]),
      ]),
    ]);
  }

  function categoryCards() {
    const cards = Object.values(data.scores.categories).map((cat) =>
      el('button', {
        class: 'cat',
        type: 'button',
        'aria-pressed': state.categories.has(cat.id),
        onclick: () => { toggle(state.categories, cat.id); render(); },
      }, [
        el('div', { class: 'cat-head' }, [
          el('span', { class: 'cat-name', text: cat.label }),
          el('span', { class: 'cat-score', text: cat.score, style: 'color:' + scoreColor(cat.score) }),
        ]),
        el('div', { class: 'bar' }, [el('i', { style: 'width:' + cat.score + '%;background:' + scoreColor(cat.score) })]),
        el('div', { class: 'cat-counts' }, SEV.filter((s) => cat.counts[s] > 0).map((s) =>
          el('span', { text: cat.counts[s] + ' ' + data.labels.severities[s].toLowerCase(), style: 'color:' + sevColor(s) })
        ).concat(cat.total === 0 ? [el('span', { text: 'aucun probleme' })] : []))
      ])
    );
    return el('div', { class: 'cats' }, cards);
  }

  function toggle(set, value) { set.has(value) ? set.delete(value) : set.add(value); }

  // ------------------------------------------------------------------- Tabs
  const TABS = [
    { id: 'plan', label: 'Plan d\'action', count: () => data.actionPlan.length },
    { id: 'findings', label: 'Problemes', count: () => filtered().length },
    { id: 'routes', label: 'Routes', count: () => data.routes.length },
    { id: 'project', label: 'Projet', count: () => null },
  ];

  function tabs() {
    return el('div', { class: 'tabs', role: 'tablist' }, TABS.map((t) =>
      el('button', {
        class: 'tab', role: 'tab', type: 'button',
        'aria-selected': state.tab === t.id,
        onclick: () => { state.tab = t.id; render(); },
      }, [t.label, t.count() != null ? el('span', { class: 'count', text: t.count() }) : null])
    ));
  }

  // --------------------------------------------------------------- Panneaux
  function panelPlan() {
    if (!data.actionPlan.length) return emptyState('Rien a prioriser', 'Aucun probleme n\'a ete detecte.');
    return el('div', { class: 'group' }, data.actionPlan.map((item) =>
      el('div', { class: 'plan-item' }, [
        el('div', { class: 'plan-num', text: String(item.priority).padStart(2, '0') }),
        el('div', {}, [
          el('div', { class: 'plan-title', text: item.title }),
          el('div', { class: 'plan-meta' }, [
            el('span', { text: data.labels.severities[item.severity], style: 'color:' + sevColor(item.severity) }),
            el('span', { text: ' · ' + item.count + ' occurrence' + (item.count > 1 ? 's' : '') }),
            el('span', { text: ' · effort ' + item.effort }),
            el('span', { text: ' · ' + data.labels.categories[item.category] }),
          ]),
          item.suggestion ? el('div', { class: 'fix' }, [el('strong', { text: 'Que faire — ' }), item.suggestion]) : null,
          item.files.length ? el('div', { class: 'tags' }, item.files.slice(0, 6).map((f) => el('span', { class: 'tag', text: f }))) : null,
        ]),
      ])
    ));
  }

  function panelFindings() {
    const list = filtered();
    const toolbar = el('div', { class: 'toolbar' }, [
      el('input', {
        type: 'search', placeholder: 'Rechercher un fichier, une regle, un message…',
        value: state.query, 'aria-label': 'Rechercher',
        oninput: (e) => { state.query = e.target.value.toLowerCase(); renderPanel(); },
      }),
      ...SEV.map((s) => el('button', {
        class: 'chip ' + s, type: 'button', 'aria-pressed': state.severities.has(s),
        onclick: () => { toggle(state.severities, s); renderPanel(); },
        text: data.labels.severities[s] + ' ' + data.scores.counts[s],
      })),
      (state.categories.size || state.severities.size || state.query)
        ? el('button', { class: 'chip', type: 'button', text: 'Reinitialiser', onclick: () => { state.categories.clear(); state.severities.clear(); state.query = ''; render(); } })
        : null,
    ]);

    if (!list.length) return el('div', {}, [toolbar, emptyState('Aucun resultat', 'Aucun probleme ne correspond aux filtres actifs.')]);

    const groups = new Map();
    for (const f of list) {
      if (!groups.has(f.ruleId)) groups.set(f.ruleId, []);
      groups.get(f.ruleId).push(f);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const d = SEV.indexOf(a[1][0].severity) - SEV.indexOf(b[1][0].severity);
      return d !== 0 ? d : b[1].length - a[1].length;
    });

    return el('div', {}, [toolbar].concat(ordered.map(([ruleId, items]) => {
      const first = items[0];
      return el('details', { class: 'group', open: items.length <= 3 && SEV.indexOf(first.severity) <= 1 }, [
        el('summary', {}, [
          el('span', { class: 'dot', style: 'background:' + sevColor(first.severity) }),
          el('span', { class: 'group-title', text: first.title }),
          el('span', { class: 'rule-id', text: ruleId }),
          el('span', { class: 'badge', text: items.length }),
        ]),
        ...items.slice(0, 200).map((f) => el('div', { class: 'finding' }, [
          f.file ? el('div', { class: 'finding-loc', text: f.file + (f.line ? ':' + f.line : '') }) : el('div', { class: 'finding-loc', text: 'Projet' }),
          el('div', { class: 'finding-msg', text: f.message }),
          f.snippet ? el('pre', { class: 'snippet', text: f.snippet }) : null,
          f.suggestion ? el('div', { class: 'fix' }, [el('strong', { text: 'Correction — ' }), f.suggestion]) : null,
          el('div', { class: 'tags' }, (f.tags || []).concat(f.docs ? [] : []).map((t) => el('span', { class: 'tag', text: t }))
            .concat(f.docs ? [el('a', { class: 'tag', href: f.docs, target: '_blank', rel: 'noopener noreferrer', text: 'documentation ↗' })] : [])),
        ])),
        items.length > 200 ? el('div', { class: 'finding', text: (items.length - 200) + ' occurrences supplementaires non affichees.' }) : null,
      ]);
    })));
  }

  function panelRoutes() {
    if (!data.routes.length) return emptyState('Aucune route detectee', 'Aucun routeur reconnu dans ce projet.');
    const stats = data.insights.routeStats || {};
    return el('div', {}, [
      el('div', { class: 'stats' }, [
        stat(stats.total ?? data.routes.length, 'routes'),
        stat(stats.dynamic ?? 0, 'dynamiques'),
        stat(stats.internalLinks ?? 0, 'liens internes'),
        stat(Object.keys(stats.byFramework || {}).length, 'routeurs'),
      ]),
      el('div', { class: 'group' }, [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Methode' }), el('th', { text: 'Chemin' }), el('th', { text: 'Type' }), el('th', { text: 'Source' }),
          ])]),
          el('tbody', {}, data.routes.map((r) => el('tr', {}, [
            el('td', {}, [el('span', { class: 'method', text: r.method })]),
            el('td', { class: 'mono', text: r.pattern }),
            el('td', { text: r.kind + ' · ' + r.framework }),
            el('td', { class: 'mono', text: (r.file || '') + (r.line ? ':' + r.line : '') }),
          ]))),
        ]),
      ]),
    ]);
  }

  function panelProject() {
    const totalLines = data.project.stack.reduce((s, x) => s + x.lines, 0) || 1;
    return el('div', {}, [
      el('div', { class: 'stats' }, [
        stat(data.project.analyzed, 'fichiers analyses'),
        stat(totalLines.toLocaleString('fr-FR'), 'lignes de code'),
        stat(data.project.dependencies, 'dependances'),
        stat(data.project.frameworks.length, 'technologies'),
      ]),
      el('div', { class: 'group' }, [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [el('th', { text: 'Langage' }), el('th', { text: 'Fichiers' }), el('th', { text: 'Lignes' }), el('th', { text: 'Part' })])]),
          el('tbody', {}, data.project.stack.map((s) => el('tr', {}, [
            el('td', { text: s.language }),
            el('td', { text: s.files }),
            el('td', { text: s.lines.toLocaleString('fr-FR') }),
            el('td', {}, [el('div', { class: 'bar', style: 'width:120px' }, [el('i', { style: 'width:' + Math.round((s.lines / totalLines) * 100) + '%;background:var(--accent)' })])]),
          ]))),
        ]),
      ]),
      data.project.frameworks.length ? el('div', { class: 'tags', style: 'margin-top:16px' }, data.project.frameworks.map((f) => el('span', { class: 'tag', text: f }))) : null,
      (data.history || []).length > 1
        ? el('div', { class: 'group', style: 'margin-top:24px' }, [
            el('table', {}, [
              el('thead', {}, [el('tr', {}, [el('th', { text: 'Analyse' }), el('th', { text: 'Score' }), el('th', { text: 'Problemes' }), el('th', { text: 'Commit' })])]),
              el('tbody', {}, [...data.history].reverse().map((e) => el('tr', {}, [
                el('td', { text: new Date(e.date).toLocaleString('fr-FR') }),
                el('td', { class: 'num', text: e.global }),
                el('td', { class: 'num', text: e.total }),
                el('td', { class: 'mono', text: e.commit || '—' }),
              ]))),
            ]),
          ])
        : null,
    ]);
  }

  function stat(value, label) {
    return el('div', { class: 'stat' }, [el('div', { class: 'stat-v', text: value }), el('div', { class: 'stat-l', text: label })]);
  }

  function emptyState(title, message) {
    return el('div', { class: 'empty' }, [
      el('div', { class: 'big', text: '✓' }),
      el('div', { style: 'font-weight:600', text: title }),
      el('div', { text: message }),
    ]);
  }

  // ---------------------------------------------------------------- Montage
  const app = document.getElementById('app');
  let panelHost = null;

  function renderPanel() {
    const body = state.tab === 'plan' ? panelPlan()
      : state.tab === 'routes' ? panelRoutes()
      : state.tab === 'project' ? panelProject()
      : panelFindings();
    panelHost.replaceChildren(body);
  }

  function render() {
    app.className = '';
    panelHost = el('div', { class: 'panel' });
    app.replaceChildren(
      header(),
      el('div', { class: 'wrap' }, [
        el('div', { class: 'hero' }, [gauge(data.scores.global, data.scores.grade), categoryCards()]),
        trendTile(),
        tabs(),
        panelHost,
        el('footer', { text: 'Argus ' + data.tool.version + ' — rapport genere le ' + new Date(data.startedAt).toLocaleString('fr-FR') + '. Ce fichier est autonome : il fonctionne hors ligne et peut etre partage tel quel.' }),
      ])
    );
    renderPanel();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      const input = document.querySelector('input[type="search"]');
      if (input) input.focus();
    }
  });

  render();
})();
`;
