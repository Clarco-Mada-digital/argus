import { CATEGORIES, SEVERITIES, SEVERITY_LABEL_FR } from '../core/severity.js';

/**
 * Commentaire de revue pour une pull request.
 *
 * La difference avec le rapport complet n'est pas cosmetique, elle est de
 * nature. Un rapport dresse l'etat d'un projet ; une revue repond a une seule
 * question : **ce changement-ci ameliore-t-il ou degrade-t-il les choses ?**
 *
 * D'ou trois partis pris.
 *
 * On ne montre que ce que la branche introduit. Afficher les cinq cents
 * constats preexistants sur une pull request de trois lignes ferait fermer
 * l'onglet, et le seul constat qui comptait serait perdu avec les autres.
 * C'est le mode differentiel qui s'en charge.
 *
 * On se tait quand il n'y a rien a dire. Un commentaire automatique poste a
 * chaque fois, meme pour dire « rien a signaler », cesse d'etre lu en deux
 * semaines — et c'est celui qui comptait qu'on rate.
 *
 * On met a jour au lieu d'empiler. Une pull request qui recoit dix
 * commentaires identiques a chaque `push` devient illisible, et son auteur
 * finit par desactiver l'outil.
 */

/** Marqueur invisible qui permet de retrouver le commentaire a mettre a jour. */
export const MARQUEUR = '<!-- argus-revue -->';

const ICONES = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
  info: 'ℹ️',
};

/**
 * @param {object} resultat rapport produit en mode differentiel
 * @param {{ base?: string, commit?: string, lienRapport?: string }} contexte
 * @returns {{ corps: string, bloquant: boolean, nombre: number } | null}
 *   `null` quand il n'y a rien a dire : l'appelant ne doit alors rien poster.
 */
export function renderRevue(resultat, { base = 'main', commit = null, lienRapport = null } = {}) {
  const constats = resultat.findings.filter((f) => f.file);
  const bloquants = constats.filter((f) => ['critical', 'high'].includes(f.severity));

  if (constats.length === 0) return null;

  const parGravite = Object.fromEntries(
    SEVERITIES.map((s) => [s, constats.filter((f) => f.severity === s)]),
  );

  const lignes = [MARQUEUR, ''];

  // ------------------------------------------------------------- en-tete
  lignes.push(
    bloquants.length > 0
      ? `## Argus — ${bloquants.length} point(s) a regler avant fusion`
      : `## Argus — ${constats.length} remarque(s) sur ce changement`,
    '',
    `Analyse des fichiers modifies par rapport a \`${base}\`${commit ? ` (\`${commit.slice(0, 7)}\`)` : ''}.`,
    '',
  );

  // ------------------------------------------------------------- resume
  const resume = SEVERITIES.filter((s) => parGravite[s].length > 0)
    .map((s) => `${ICONES[s]} ${parGravite[s].length} ${SEVERITY_LABEL_FR[s].toLowerCase()}`)
    .join(' · ');
  lignes.push(resume, '');

  // -------------------------------------------------- constats par fichier
  const parFichier = new Map();
  for (const constat of constats) {
    if (!parFichier.has(constat.file)) parFichier.set(constat.file, []);
    parFichier.get(constat.file).push(constat);
  }

  // Les fichiers les plus problematiques d'abord : c'est par la qu'on
  // commence quand on n'a que dix minutes.
  const rang = (s) => SEVERITIES.indexOf(s);
  const fichiers = [...parFichier.entries()].sort(
    (a, b) => Math.min(...a[1].map((f) => rang(f.severity))) - Math.min(...b[1].map((f) => rang(f.severity))),
  );

  for (const [fichier, dedans] of fichiers.slice(0, 15)) {
    lignes.push(`### \`${fichier}\``, '');
    for (const constat of dedans.slice(0, 8)) {
      const ligne = constat.line ? `L${constat.line}` : '';
      lignes.push(
        `${ICONES[constat.severity]} **${constat.title}** ${ligne ? `· ${ligne}` : ''} · \`${constat.ruleId}\``,
      );
      lignes.push(`> ${constat.message.replace(/\n/g, ' ')}`);
      if (constat.suggestion) lignes.push(`> `, `> **Correction :** ${constat.suggestion.replace(/\n/g, ' ')}`);
      lignes.push('');
    }
    if (dedans.length > 8) lignes.push(`_…et ${dedans.length - 8} autre(s) dans ce fichier._`, '');
  }

  if (fichiers.length > 15) {
    lignes.push(`_…et ${fichiers.length - 15} autre(s) fichier(s)._`, '');
  }

  // -------------------------------------------------------------- pied
  lignes.push(
    '---',
    '',
    bloquants.length > 0
      ? '**Ces points sont de gravite haute ou critique.** Ils font echouer la verification ; ' +
        'si l\'un d\'eux est un faux positif, `argus-ignore` sur la ligne concernee le documente pour la prochaine fois.'
      : 'Aucun point bloquant. Ces remarques sont a votre appreciation.',
    '',
  );

  if (lienRapport) lignes.push(`[Rapport complet](${lienRapport})`, '');

  lignes.push(
    `<sub>Seuls les fichiers modifies par cette branche sont analyses. ` +
      `Relancer en local : \`npx github:Clarco-Mada-digital/argus scan . --since ${base}\`</sub>`,
  );

  // Les lignes vides sont significatives en Markdown : elles separent les
  // blocs. Les supprimer collerait chaque citation au constat suivant. On se
  // contente donc de replier les sauts multiples.
  return {
    corps: `${lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`,
    bloquant: bloquants.length > 0,
    nombre: constats.length,
  };
}

/**
 * Message court quand une revue precedente signalait des problemes desormais
 * resolus. Poster un commentaire neuf pour dire « c'est bon » serait du bruit ;
 * remplacer l'ancien par cette ligne ferme la boucle proprement.
 */
export function renderRevueResolue(base = 'main') {
  return [
    MARQUEUR,
    '',
    '## Argus — plus rien a signaler',
    '',
    `Les points releves precedemment sur les fichiers modifies par rapport a \`${base}\` ont ete traites.`,
  ].join('\n');
}

/** Categories concernees, pour un resume d'une ligne dans le journal du job. */
export function resumerPourLeJournal(resultat) {
  const constats = resultat.findings.filter((f) => f.file);
  if (constats.length === 0) return 'Aucun constat sur les fichiers modifies.';

  const parCategorie = new Map();
  for (const constat of constats) {
    parCategorie.set(constat.category, (parCategorie.get(constat.category) || 0) + 1);
  }

  return [...parCategorie]
    .sort((a, b) => b[1] - a[1])
    .map(([categorie, nombre]) => `${CATEGORIES[categorie]?.label || categorie} : ${nombre}`)
    .join(' · ');
}
