import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CATEGORY_IDS } from './severity.js';

/**
 * Historique des scores.
 *
 * Un score isole ne dit pas grand-chose : ce qui compte, c'est le sens dans
 * lequel il bouge. On conserve donc une trace de chaque analyse, en local,
 * pour repondre a « est-ce que ca s'ameliore ? ».
 *
 * Le fichier vit dans .argus/ (ignore par Git) : c'est une mesure locale, pas
 * une donnee de projet a partager.
 */

const FICHIER = '.argus/history.json';
const MAX_ENTREES = 200;

export function cheminHistorique(root) {
  return path.join(root, FICHIER);
}

/** @returns {Array<{date, global, categories, counts, files, commit}>} */
export function lireHistorique(root) {
  const fichier = cheminHistorique(root);
  if (!fs.existsSync(fichier)) return [];
  try {
    const donnees = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    return Array.isArray(donnees.entries) ? donnees.entries : [];
  } catch {
    return [];
  }
}

/**
 * Ajoute le resultat courant a l'historique.
 * N'enregistre rien en mode differentiel ou exploration seule : ces scores
 * portent sur un perimetre reduit et fausseraient la courbe.
 */
export function enregistrer(root, result) {
  if (result.diff || result.config?.crawlOnly) return null;

  const entrees = lireHistorique(root);
  const entree = {
    date: result.startedAt,
    global: result.scores.global,
    grade: result.scores.grade,
    categories: Object.fromEntries(
      CATEGORY_IDS.filter((id) => result.scores.categories[id]).map((id) => [id, result.scores.categories[id].score]),
    ),
    counts: result.scores.counts,
    total: result.scores.total,
    files: result.project.analyzed,
    commit: commitCourant(root),
  };

  entrees.push(entree);
  const conservees = entrees.slice(-MAX_ENTREES);

  const fichier = cheminHistorique(root);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, `${JSON.stringify({ entries: conservees }, null, 2)}\n`, 'utf8');
  return entree;
}

/**
 * Compare le resultat courant a la derniere analyse enregistree.
 * @returns {{precedent, delta, deltaParCategorie, ecoule}|null}
 */
export function comparer(historique, result) {
  const precedent = historique[historique.length - 1];
  if (!precedent) return null;

  const deltaParCategorie = {};
  for (const [id, score] of Object.entries(precedent.categories || {})) {
    const actuel = result.scores.categories[id]?.score;
    if (actuel !== undefined) deltaParCategorie[id] = actuel - score;
  }

  // Ce qui a *reellement* bouge. Une equipe a vu son score de performance
  // baisser apres avoir ramene 125 requetes SQL a 34 : le score seul ne
  // pouvait pas raconter ca. Le decompte par severite, si.
  const deltaParSeverite = {};
  for (const severite of Object.keys({ ...precedent.counts, ...result.scores.counts })) {
    const ecart = (result.scores.counts[severite] || 0) - (precedent.counts?.[severite] || 0);
    if (ecart !== 0) deltaParSeverite[severite] = ecart;
  }

  return {
    precedent,
    delta: result.scores.global - precedent.global,
    deltaTotal: result.scores.total - precedent.total,
    deltaParCategorie,
    deltaParSeverite,
    ecoule: Date.now() - new Date(precedent.date).getTime(),
  };
}

function commitCourant(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null; // hors depot Git : l'historique reste utilisable
  }
}

/** Duree en francais lisible, pour « il y a … ». */
export function depuis(ms) {
  // Arrondi vers le bas : une analyse vieille de 30 secondes doit se lire
  // « a l'instant », pas « il y a 1 min ».
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'a l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return jours === 1 ? 'hier' : `il y a ${jours} jours`;
}
