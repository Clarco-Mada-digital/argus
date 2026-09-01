/**
 * Echelle de severite partagee par tous les analyseurs.
 * L'ordre est significatif : index 0 = le plus grave.
 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_WEIGHT = {
  critical: 40,
  high: 18,
  medium: 7,
  low: 2.5,
  info: 0.5,
};

export const SEVERITY_LABEL_FR = {
  critical: 'Critique',
  high: 'Eleve',
  medium: 'Moyen',
  low: 'Faible',
  info: 'Info',
};

export function severityRank(severity) {
  const index = SEVERITIES.indexOf(severity);
  return index === -1 ? SEVERITIES.length : index;
}

/** Retourne true si `severity` est au moins aussi grave que `threshold`. */
export function atLeast(severity, threshold) {
  return severityRank(severity) <= severityRank(threshold);
}

export const CATEGORIES = {
  security: { label: 'Securite', icon: 'shield', weight: 3 },
  routes: { label: 'Routes & liens', icon: 'route', weight: 2 },
  deadcode: { label: 'Code mort', icon: 'broom', weight: 1.5 },
  seo: { label: 'SEO', icon: 'search', weight: 2.5 },
  design: { label: 'Design & accessibilite', icon: 'palette', weight: 2 },
  performance: { label: 'Performance', icon: 'bolt', weight: 2 },
  quality: { label: 'Qualite du code', icon: 'code', weight: 1.5 },
  dependencies: { label: 'Dependances', icon: 'package', weight: 2 },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES);
