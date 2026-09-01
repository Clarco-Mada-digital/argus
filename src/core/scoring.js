import { CATEGORIES, CATEGORY_IDS, SEVERITIES, SEVERITY_WEIGHT } from './severity.js';

/**
 * Score par categorie : 100 moins la penalite cumulee, amortie par la taille du
 * projet. Un depot de 5 fichiers et un depot de 5000 ne sont pas comparables :
 * on normalise la penalite par la racine du nombre de fichiers analyses.
 */
function scoreCategory(findings, fileCount) {
  if (findings.length === 0) return 100;
  const raw = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity] * confidenceFactor(f), 0);
  const scale = Math.max(1, Math.sqrt(Math.max(fileCount, 1)) / 3);
  const penalty = raw / scale;
  return clamp(Math.round(100 - penalty), 0, 100);
}

function confidenceFactor(finding) {
  if (finding.confidence === 'tentative') return 0.5;
  if (finding.confidence === 'certain') return 1.2;
  return 1;
}

export function buildScores(findings, { fileCount, categories = CATEGORY_IDS }) {
  const perCategory = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const id of categories) {
    const categoryFindings = findings.filter((f) => f.category === id);
    const score = scoreCategory(categoryFindings, fileCount);
    const counts = countBySeverity(categoryFindings);
    perCategory[id] = {
      id,
      label: CATEGORIES[id]?.label || id,
      score,
      grade: gradeOf(score),
      total: categoryFindings.length,
      counts,
    };
    const weight = CATEGORIES[id]?.weight ?? 1;
    weightedSum += score * weight;
    weightTotal += weight;
  }

  const global = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 100;
  return {
    global,
    grade: gradeOf(global),
    categories: perCategory,
    counts: countBySeverity(findings),
    total: findings.length,
  };
}

function countBySeverity(findings) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] || 0) + 1;
  return counts;
}

export function gradeOf(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 55) return 'D';
  if (score >= 40) return 'E';
  return 'F';
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Plan d'action : regroupe les problemes par regle et les ordonne par impact
 * (severite x nombre d'occurrences) puis par effort croissant.
 */
const EFFORT_ORDER = { rapide: 0, moyen: 1, important: 2 };

export function buildActionPlan(findings, limit = 12) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.ruleId)) {
      groups.set(finding.ruleId, {
        ruleId: finding.ruleId,
        category: finding.category,
        severity: finding.severity,
        title: finding.title,
        suggestion: finding.suggestion,
        docs: finding.docs,
        effort: finding.effort || 'moyen',
        count: 0,
        files: new Set(),
        titles: new Set(),
        samples: [],
      });
    }
    const group = groups.get(finding.ruleId);
    group.count++;
    group.titles.add(finding.title);
    if (finding.file) group.files.add(finding.file);
    if (group.samples.length < 5) group.samples.push({ file: finding.file, line: finding.line, message: finding.message });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Un groupe qui melange plusieurs cas concrets (deux paquets vulnerables,
      // deux secrets differents) ne doit pas porter le titre du premier.
      title: group.titles.size > 1 ? genericTitle(group) : group.title,
      titles: [...group.titles],
      files: [...group.files],
      impact: Math.round(SEVERITY_WEIGHT[group.severity] * Math.log2(group.count + 1) * 10) / 10,
    }))
    .sort((a, b) => {
      if (b.impact !== a.impact) return b.impact - a.impact;
      return (EFFORT_ORDER[a.effort] ?? 1) - (EFFORT_ORDER[b.effort] ?? 1);
    })
    .slice(0, limit)
    .map((group, index) => ({ ...group, priority: index + 1 }));
}

/** Titre commun a plusieurs occurrences : on garde le prefixe partage. */
function genericTitle(group) {
  const titles = [...group.titles];
  const separator = titles.every((t) => t.includes(':')) ? ':' : null;
  if (separator) {
    const prefixes = new Set(titles.map((t) => t.split(separator)[0].trim()));
    if (prefixes.size === 1) return `${[...prefixes][0]} (${group.count} cas)`;
  }
  return `${titles[0]} — et ${titles.length - 1} autre(s) cas`;
}
