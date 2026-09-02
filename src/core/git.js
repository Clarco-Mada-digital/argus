import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Acces minimal a Git, pour le mode differentiel.
 *
 * Objectif : ne rapporter que ce qu'une modification introduit. Sur un projet
 * existant, la dette accumulee noie systematiquement les nouveautes — et une
 * revue qui affiche 400 problemes preexistants n'est pas lue.
 */

export function isGitRepository(root) {
  let dossier = path.resolve(root);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dossier, '.git'))) return true;
    const parent = path.dirname(dossier);
    if (parent === dossier) return false;
    dossier = parent;
  }
  return false;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Fichiers modifies par rapport a une reference.
 *
 * `main` compare depuis l'ancetre commun (comportement attendu sur une branche
 * de travail) ; `HEAD` compare l'arbre de travail. Les fichiers supprimes sont
 * ecartes : il n'y a plus rien a y analyser.
 *
 * @returns {{files: Set<string>, ref: string, base: string|null}}
 */
export function changedFiles(root, ref = 'HEAD') {
  if (!isGitRepository(root)) {
    throw new Error(`${root} n'est pas un depot Git : le mode differentiel a besoin de l'historique.`);
  }

  let base = null;
  const sorties = [];

  if (ref === 'HEAD' || ref === 'working') {
    // Modifications non encore validees, indexees ou non, plus les nouveaux fichiers.
    sorties.push(safeGit(root, ['diff', '--name-only', '--diff-filter=d', 'HEAD']));
    sorties.push(safeGit(root, ['diff', '--name-only', '--diff-filter=d', '--cached']));
    sorties.push(safeGit(root, ['ls-files', '--others', '--exclude-standard']));
  } else {
    // Une reference inexistante ne doit pas passer pour un diff vide.
    // `--since main` sur un depot dont la branche s'appelle `master` renvoyait
    // « 0 fichier modifie » : l'auteur en concluait que son changement etait
    // propre, alors que rien n'avait ete compare.
    if (!safeGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) {
      const branches = safeGit(root, ['branch', '--format=%(refname:short)'])
        .split('\n')
        .filter(Boolean)
        .slice(0, 6);
      throw Object.assign(
        new Error(
          `La reference « ${ref} » n'existe pas dans ce depot.` +
            (branches.length ? ` Branches disponibles : ${branches.join(', ')}.` : ''),
        ),
        { genre: 'ref' },
      );
    }

    // Sur une branche, on compare depuis l'ancetre commun : les commits
    // arrives sur la base entre-temps ne sont pas de notre fait.
    base = safeGit(root, ['merge-base', 'HEAD', ref]) || ref;
    sorties.push(safeGit(root, ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`]));
    sorties.push(safeGit(root, ['diff', '--name-only', '--diff-filter=d', 'HEAD']));
    sorties.push(safeGit(root, ['ls-files', '--others', '--exclude-standard']));
  }

  const racineDepot = safeGit(root, ['rev-parse', '--show-toplevel']);
  const prefixe = racineDepot ? path.relative(racineDepot, path.resolve(root)) : '';

  const files = new Set();
  for (const sortie of sorties) {
    for (const ligne of sortie.split('\n')) {
      const chemin = ligne.trim();
      if (!chemin) continue;
      // Les chemins de Git sont relatifs a la racine du depot, pas au dossier analyse.
      const relatif = prefixe ? path.relative(prefixe, chemin) : chemin;
      if (relatif.startsWith('..')) continue; // hors du perimetre analyse
      files.add(relatif.split(path.sep).join('/'));
    }
  }

  return { files, ref, base };
}

function safeGit(root, args) {
  try {
    return git(root, args);
  } catch {
    return '';
  }
}

/** Description courte de la reference, pour l'en-tete du rapport. */
export function describeRef(root, ref) {
  const sujet = safeGit(root, ['log', '-1', '--format=%h %s', ref === 'working' ? 'HEAD' : ref]);
  return sujet || ref;
}
