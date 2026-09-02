import { CATEGORIES, SEVERITIES, SEVERITY_LABEL_FR } from '../core/severity.js';

/**
 * Couleurs ANSI, desactivees automatiquement hors TTY ou avec NO_COLOR.
 *
 * L'acces passe par `globalThis` : ce module est atteint depuis le navigateur
 * via `src/index.js`, ou `process` n'existe pas. Un rendu de rapport n'a pas a
 * echouer *a l'import* selon l'environnement — et l'erreur qui en resultait ne
 * nommait meme pas ce fichier.
 */
const processus = globalThis.process;
const enabled = Boolean(
  processus?.stdout?.isTTY && !processus.env.NO_COLOR && processus.env.TERM !== 'dumb',
);

const code = (open, close) => (text) => (enabled ? `[${open}m${text}[${close}m` : String(text));

export const color = {
  reset: code(0, 0),
  bold: code(1, 22),
  dim: code(2, 22),
  italic: code(3, 23),
  underline: code(4, 24),
  red: code(31, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  blue: code(34, 39),
  magenta: code(35, 39),
  cyan: code(36, 39),
  gray: code(90, 39),
  white: code(97, 39),
  bgRed: code(41, 49),
  bgGreen: code(42, 49),
  bgYellow: code(43, 49),
  bgBlue: code(44, 49),
};

const SEVERITY_COLOR = {
  critical: color.red,
  high: color.red,
  medium: color.yellow,
  low: color.blue,
  info: color.gray,
};

const SEVERITY_ICON = {
  critical: '■',
  high: '▲',
  medium: '●',
  low: '○',
  info: '·',
};

export function renderReport(result, { verbose = false, maxPerRule = 3, maxFindings = 60 } = {}) {
  const out = [];
  out.push(renderHeader(result));
  out.push(renderScores(result));
  out.push(renderActionPlan(result));
  out.push(renderFindings(result, { verbose, maxPerRule, maxFindings }));
  out.push(renderFooter(result));
  return out.filter(Boolean).join('\n');
}

/**
 * Un monorepo merite d'etre montre projet par projet : c'est la seule facon
 * de voir d'un coup d'oeil que `apps/mobile` est bien analysee comme une
 * application mobile et non comme un site.
 */
/**
 * La preuve du framework le plus specifique detecte.
 *
 * On ne montre que celle-la : lister toutes les preuves noierait la seule qui
 * compte, celle qui a decide de la plateforme et donc des regles appliquees.
 */
function preuvePrincipale(project) {
  return project.preuves?.[project.identite] ?? null;
}

function renderSousProjets(project) {
  const sous = project.sousProjets || [];
  if (sous.length === 0) return [];

  const noms = { web: 'web', mobile: 'mobile', desktop: 'bureau' };
  const largeur = Math.max(...sous.map((p) => p.chemin.length));

  return sous.map((p) => {
    const cibles = (p.platforms || []).map((c) => noms[c]).filter(Boolean).join(', ');
    const detail = [p.description, cibles].filter(Boolean).join(' · ');
    return `  ${color.dim('  └')} ${p.chemin.padEnd(largeur)}  ${color.dim(detail)}`;
  });
}

function renderHeader(result) {
  const { project } = result;
  // On ne classe que le code applicatif : compter le JSON et le YAML ecrasait
  // la part reelle des langages et faisait remonter des scripts isoles.
  const code = (project.stack || []).filter((s) => s.code !== false);
  const totalCode = code.reduce((somme, s) => somme + s.lines, 0);
  const stack = code
    .slice(0, 4)
    .map((s) => `${s.language} ${percent(s.lines, totalCode)}`)
    .join('  ');

  const plateformes = { web: 'web', mobile: 'mobile', desktop: 'bureau', inconnu: null };
  const cibles = (project.platforms || []).map((p) => plateformes[p]).filter(Boolean);

  // La preuve qui a fait conclure. Sans elle, une deduction fausse est
  // invisible : l'utilisateur voit « site statique » sur son application de
  // bureau sans savoir quoi corriger, ni meme qu'il y a quelque chose a
  // corriger.
  const justification = project.plateformeImposee
    ? 'plateforme imposee par la configuration'
    : preuvePrincipale(project) && `d'apres ${preuvePrincipale(project)}`;

  const identite = [
    project.description,
    cibles.join(' et '),
    justification ? color.dim(justification) : null,
  ]
    .filter(Boolean)
    .join(color.dim(' · '));
  const lines = [
    '',
    `${color.bold(color.cyan('  ARGUS'))} ${color.dim('· analyse de projet')}`,
    color.dim(`  ${result.root}`),
    '',
    `  ${color.dim('Fichiers')}      ${project.analyzed} analyses ${color.dim(`(${project.files} indexes, ${project.skipped} ignores)`)}`,
    project.description ? `  ${color.dim('Projet')}        ${identite}` : null,
    ...renderSousProjets(project),
    stack ? `  ${color.dim('Langages')}      ${stack}` : null,
    project.frameworks.length ? `  ${color.dim('Detecte')}       ${project.frameworks.slice(0, 8).join(', ')}` : null,
    `  ${color.dim('Duree')}         ${(result.durationMs / 1000).toFixed(2)} s`,
  ];

  if (result.diff) {
    lines.push('');
    lines.push(
      `  ${color.bold(color.cyan('MODE DIFFERENTIEL'))}  ${color.dim(`depuis ${result.diff.ref}`)}`,
    );
    lines.push(
      `  ${result.diff.files.length} fichier(s) modifie(s) — seuls les problemes qui s'y trouvent sont rapportes.`,
    );
    if (result.suppressed > 0) {
      lines.push(color.dim(`  ${result.suppressed} probleme(s) preexistant(s) masque(s).`));
    }
  }

  return lines.filter(Boolean).join('\n');
}

function totalLines(project) {
  return project.stack.reduce((sum, s) => sum + s.lines, 0) || 1;
}

function percent(value, total) {
  return color.dim(`${Math.round((value / total) * 100)}%`);
}

function renderScores(result) {
  const { scores } = result;
  const lines = ['', divider(), '', `  ${color.bold('SCORE GLOBAL')}   ${bigScore(scores.global)} ${gradeBadge(scores.grade)}`, ''];

  for (const id of Object.keys(scores.categories)) {
    const category = scores.categories[id];
    const label = (CATEGORIES[id]?.label || id).padEnd(24, ' ');
    const bar = scoreBar(category.score);
    const counts = SEVERITIES.filter((s) => category.counts[s] > 0)
      .map((s) => SEVERITY_COLOR[s](`${category.counts[s]}${SEVERITY_ICON[s]}`))
      .join(' ');
    lines.push(`  ${label} ${bar} ${scoreText(category.score)}  ${counts || color.dim('—')}`);
  }

  lines.push('');
  const summary = SEVERITIES.map((s) =>
    scores.counts[s] > 0 ? SEVERITY_COLOR[s](`${scores.counts[s]} ${SEVERITY_LABEL_FR[s].toLowerCase()}`) : null,
  )
    .filter(Boolean)
    .join(color.dim('  ·  '));
  lines.push(`  ${color.bold(`${scores.total} probleme${scores.total > 1 ? 's' : ''}`)}   ${summary}`);
  if (result.suppressed > 0) lines.push(color.dim(`  ${result.suppressed} masques (baseline, regles desactivees, seuil de severite)`));

  return lines.join('\n');
}

function bigScore(score) {
  const text = String(score).padStart(3, ' ');
  if (score >= 90) return color.bold(color.green(text));
  if (score >= 70) return color.bold(color.yellow(text));
  return color.bold(color.red(text));
}

function scoreText(score) {
  const text = String(score).padStart(3, ' ');
  if (score >= 90) return color.green(text);
  if (score >= 70) return color.yellow(text);
  return color.red(text);
}

function gradeBadge(grade) {
  const paint = grade.startsWith('A') ? color.bgGreen : grade === 'B' || grade === 'C' ? color.bgYellow : color.bgRed;
  return paint(color.bold(` ${grade} `));
}

function scoreBar(score, width = 24) {
  const filled = Math.round((score / 100) * width);
  const paint = score >= 90 ? color.green : score >= 70 ? color.yellow : color.red;
  return `${paint('█'.repeat(filled))}${color.dim('░'.repeat(width - filled))}`;
}

function renderActionPlan(result) {
  if (result.actionPlan.length === 0) return '';
  const lines = ['', divider(), '', `  ${color.bold('PLAN D\'ACTION')} ${color.dim('— par impact decroissant')}`, ''];

  for (const item of result.actionPlan.slice(0, 8)) {
    const paint = SEVERITY_COLOR[item.severity];
    const badge = paint(`${SEVERITY_ICON[item.severity]}`);
    const count = item.count > 1 ? color.dim(` ×${item.count}`) : '';
    const effort = color.dim(`[${item.effort}]`);
    lines.push(`  ${color.bold(String(item.priority).padStart(2))}. ${badge} ${item.title}${count} ${effort}`);
    if (item.suggestion) {
      lines.push(color.dim(`      → ${wrap(item.suggestion, 100, '        ')}`));
    }
    if (item.files.length > 0) {
      const files = item.files.slice(0, 3).join(', ');
      lines.push(color.gray(`      ${files}${item.files.length > 3 ? ` +${item.files.length - 3}` : ''}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderFindings(result, { verbose, maxPerRule, maxFindings }) {
  if (result.findings.length === 0) {
    return `\n${divider()}\n\n  ${color.green('✔')} Aucun probleme detecte.\n`;
  }

  const lines = ['', divider(), '', `  ${color.bold('DETAIL')}`, ''];
  const byCategory = new Map();
  for (const finding of result.findings) {
    if (!byCategory.has(finding.category)) byCategory.set(finding.category, []);
    byCategory.get(finding.category).push(finding);
  }

  let shown = 0;
  for (const [categoryId, findings] of byCategory) {
    lines.push(`  ${color.bold(color.cyan((CATEGORIES[categoryId]?.label || categoryId).toUpperCase()))} ${color.dim(`(${findings.length})`)}`);
    lines.push('');

    const perRule = new Map();
    for (const finding of findings) {
      const count = perRule.get(finding.ruleId) || 0;
      if (!verbose && count >= maxPerRule) {
        perRule.set(finding.ruleId, count + 1);
        continue;
      }
      perRule.set(finding.ruleId, count + 1);
      if (!verbose && shown >= maxFindings) break;
      shown++;

      const paint = SEVERITY_COLOR[finding.severity];
      const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : 'projet';
      lines.push(`  ${paint(SEVERITY_ICON[finding.severity])} ${color.bold(finding.title)} ${color.dim(finding.ruleId)}`);
      lines.push(`    ${color.underline(color.gray(location))}`);
      lines.push(`    ${wrap(finding.message, 100, '    ')}`);
      if (finding.snippet) lines.push(color.dim(`    │ ${finding.snippet.slice(0, 110)}`));
      if (finding.suggestion) lines.push(color.green(`    → ${wrap(finding.suggestion, 100, '      ')}`));
      lines.push('');
    }

    for (const [ruleId, count] of perRule) {
      if (!verbose && count > maxPerRule) {
        lines.push(color.dim(`    … ${count - maxPerRule} autre(s) occurrence(s) de ${ruleId}`));
      }
    }
    lines.push('');
  }

  if (!verbose && result.findings.length > shown) {
    lines.push(color.dim(`  ${result.findings.length - shown} probleme(s) non affiche(s). Utilisez --verbose ou generez le rapport HTML.`));
  }

  return lines.join('\n');
}

function renderFooter(result) {
  const lines = ['', divider(), ''];
  if (result.errors.length > 0) {
    lines.push(`  ${color.yellow('⚠')} ${result.errors.length} analyseur(s) en erreur : ${result.errors.map((e) => e.analyzer).join(', ')}`);
  }
  lines.push(color.dim('  argus scan --html rapport.html    rapport interactif complet'));
  lines.push(color.dim('  argus serve                       tableau de bord dans le navigateur'));
  lines.push('');
  return lines.join('\n');
}

function divider() {
  const width = Math.min(process.stdout.columns || 80, 100);
  return color.dim(`  ${'─'.repeat(width - 4)}`);
}

/** Retour a la ligne propre avec indentation de continuation. */
export function wrap(text, width, indent = '') {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join(`\n${indent}`);
}

/** Barre de progression pour le scan en direct. */
export function createSpinner(stream = process.stderr) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let index = 0;
  let timer = null;
  let label = '';
  const active = stream.isTTY && !process.env.NO_COLOR;

  return {
    start(text) {
      label = text;
      if (!active) return;
      timer = setInterval(() => {
        stream.write(`\r  ${color.cyan(frames[index++ % frames.length])} ${label}${' '.repeat(20)}`);
      }, 80);
    },
    update(text) {
      label = text;
      if (!active) return;
    },
    stop(finalText) {
      if (timer) clearInterval(timer);
      if (active) stream.write(`\r${' '.repeat((label.length || 0) + 30)}\r`);
      if (finalText) stream.write(`${finalText}\n`);
    },
  };
}
