/**
 * Comparaison de versions et evaluation de plages, sans dependance.
 * Couvre ce dont Argus a besoin : comparer deux versions, savoir si une
 * version tombe dans un intervalle OSV, et deviner la version installee a
 * partir d'une plage declaree.
 */

/**
 * Decoupe une version en { parts, prerelease }.
 * Les suffixes de pre-publication (-beta.1, -rc2) sont conserves : ils
 * comptent comme *inferieurs* a la version stable correspondante.
 */
function parseVersion(input) {
  if (!input) return null;
  const text = String(input).trim().replace(/^[=v]+/, '');
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[.+-]([0-9A-Za-z.-]+))?/.exec(text);
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
    prerelease: match[4] ?? null,
    raw: text,
  };
}

/** @returns {number} -1, 0 ou 1 — ou null si l'une des versions est illisible. */
export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (!left || !right) return null;

  for (let i = 0; i < 3; i++) {
    const diff = (left.parts[i] || 0) - (right.parts[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }

  // 1.0.0-beta < 1.0.0 ; entre deux pre-publications, ordre lexicographique.
  if (left.prerelease && !right.prerelease) return -1;
  if (!left.prerelease && right.prerelease) return 1;
  if (left.prerelease && right.prerelease) {
    return left.prerelease === right.prerelease ? 0 : left.prerelease < right.prerelease ? -1 : 1;
  }
  return 0;
}

function isAtLeast(a, b) {
  const result = compareVersions(a, b);
  return result !== null && result >= 0;
}

/**
 * Version minimale satisfaisant une plage declaree (`^1.2.3`, `>=2.0 <3`,
 * `~4.1`, `1.2.*`). Utilisee quand aucun fichier de verrouillage n'existe :
 * c'est une approximation, signalee comme telle dans le rapport.
 */
export function minimumSatisfying(range) {
  if (!range) return null;
  const text = String(range).trim();
  if (!text || text === '*' || text === 'latest' || /^(https?:|git\+|file:|link:|workspace:)/.test(text)) return null;

  const first = /(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?/.exec(text);
  if (!first) return null;

  const normalize = (value) => (value === undefined || value === 'x' || value === '*' ? '0' : value);
  return `${first[1]}.${normalize(first[2])}.${normalize(first[3])}`;
}

/**
 * Une version tombe-t-elle dans un intervalle OSV ?
 * Les evenements OSV se lisent dans l'ordre : `introduced` ouvre la plage,
 * `fixed` ou `last_affected` la referme.
 */
function isAffectedByRange(version, range) {
  if (!range?.events) return false;
  // OSV n'ordonne pas toujours les evenements : on les trie nous-memes.
  const events = [...range.events].sort((a, b) => {
    const va = a.introduced ?? a.fixed ?? a.last_affected;
    const vb = b.introduced ?? b.fixed ?? b.last_affected;
    if (va === '0') return -1;
    if (vb === '0') return 1;
    return compareVersions(va, vb) ?? 0;
  });

  let vulnerable = false;
  for (const event of events) {
    if (event.introduced !== undefined) {
      if (event.introduced === '0' || isAtLeast(version, event.introduced)) vulnerable = true;
    } else if (event.fixed !== undefined) {
      if (isAtLeast(version, event.fixed)) vulnerable = false;
    } else if (event.last_affected !== undefined) {
      const comparison = compareVersions(version, event.last_affected);
      if (comparison !== null && comparison > 0) vulnerable = false;
    }
  }
  return vulnerable;
}

/**
 * Une version est-elle concernee par une entree `affected` d'un avis OSV ?
 * @param {string} version version exacte installee
 * @param {object} affected entree `affected[]` de l'avis
 */
export function isAffected(version, affected) {
  if (!version || !affected) return false;

  if (Array.isArray(affected.versions) && affected.versions.length > 0) {
    if (affected.versions.includes(version)) return true;
    // Si la liste explicite existe mais sans plage, elle fait autorite.
    if (!affected.ranges || affected.ranges.length === 0) return false;
  }

  for (const range of affected.ranges || []) {
    if (range.type === 'GIT') continue; // non exploitable a partir d'un numero de version
    if (isAffectedByRange(version, range)) return true;
  }
  return false;
}

/**
 * Version corrigee applicable, pour la branche ou se trouve l'installation.
 *
 * Un avis couvre souvent plusieurs branches maintenues en parallele :
 * « 6.0 before 6.0.4, 5.2 before 5.2.13, 4.2 before 4.2.30 ». Les evenements
 * OSV les enumerent dans une seule plage, par paires introduced/fixed.
 *
 * Rendre la plus basse conseillait a un projet en 5.2.6 de passer en 4.2.30 —
 * une *regression* de version majeure presentee comme un correctif. Signale
 * sur un projet reel, ou le message allait jusqu'a proposer de remplacer
 * Django alors que le correctif etait ecrit dans l'avis.
 *
 * @param {object} affected entree `affected` d'un avis OSV
 * @param {string} [versionInstallee] pour choisir la bonne branche
 */
export function firstFixedVersion(affected, versionInstallee = null) {
  const paires = [];

  for (const range of affected?.ranges || []) {
    if (range.type === 'GIT') continue;
    let introduite = null;
    for (const event of range.events || []) {
      if (event.introduced) { introduite = event.introduced; continue; }
      // `last_affected` est l'autre facon d'exprimer une borne : la version
      // corrigee n'est alors pas nommee, mais la branche l'est.
      const fixee = event.fixed ?? null;
      if (fixee) paires.push({ introduite, fixee });
    }
  }

  if (paires.length === 0) return null;

  if (versionInstallee) {
    // La branche qui contient l'installation : borne haute la plus proche
    // au-dessus de la version installee.
    const candidates = paires
      .filter((p) => (compareVersions(versionInstallee, p.fixee) ?? -1) < 0)
      .filter((p) => !p.introduite || (compareVersions(versionInstallee, p.introduite) ?? 1) >= 0)
      .sort((a, b) => compareVersions(a.fixee, b.fixee) ?? 0);

    if (candidates.length > 0) return candidates[0].fixee;
  }

  // Sans version connue, on propose la plus haute : conseiller une version
  // ancienne comme « correctif » est le seul resultat vraiment nuisible.
  return paires.map((p) => p.fixee).sort((a, b) => compareVersions(b, a) ?? 0)[0];
}

/**
 * Score de base CVSS v3.1 a partir de son vecteur.
 * Implementation de la formule officielle (FIRST.org) : le score n'est donc
 * pas estime, il est calcule.
 */
export function cvssBaseScore(vector) {
  if (!vector || !/^CVSS:3\.[01]\//.test(vector)) return null;

  const metrics = {};
  for (const part of vector.split('/').slice(1)) {
    const [key, value] = part.split(':');
    metrics[key] = value;
  }

  const scopeChanged = metrics.S === 'C';
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[metrics.AV];
  const AC = { L: 0.77, H: 0.44 }[metrics.AC];
  const PR = scopeChanged ? { N: 0.85, L: 0.68, H: 0.5 }[metrics.PR] : { N: 0.85, L: 0.62, H: 0.27 }[metrics.PR];
  const UI = { N: 0.85, R: 0.62 }[metrics.UI];
  const impact = { H: 0.56, L: 0.22, N: 0 };
  const C = impact[metrics.C];
  const I = impact[metrics.I];
  const A = impact[metrics.A];

  if ([AV, AC, PR, UI, C, I, A].some((value) => value === undefined)) return null;

  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  const impactScore = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    : 6.42 * iss;
  if (impactScore <= 0) return 0;

  const exploitability = 8.22 * AV * AC * PR * UI;
  const base = scopeChanged
    ? Math.min(1.08 * (impactScore + exploitability), 10)
    : Math.min(impactScore + exploitability, 10);

  return roundUp(base);
}

/** Arrondi CVSS : plus petit multiple de 0,1 superieur ou egal. */
function roundUp(value) {
  const scaled = Math.round(value * 100000);
  return scaled % 10000 === 0 ? scaled / 100000 : (Math.floor(scaled / 10000) + 1) / 10;
}

/** Traduit un score CVSS en niveau de gravite Argus. */
export function severityFromScore(score) {
  if (score === null || score === undefined) return null;
  if (score >= 9) return 'critical';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  if (score > 0) return 'low';
  return 'info';
}
