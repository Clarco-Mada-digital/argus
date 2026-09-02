/**
 * Internationalisation.
 *
 * Le francais est la langue d'origine et le reste : les messages y ont ete
 * ecrits, pas traduits, et c'est la version de reference. L'anglais est un
 * calque pose par-dessus.
 *
 * Ce choix a une consequence pratique importante : **une chaine sans
 * traduction s'affiche en francais plutot que de disparaitre ou d'exposer sa
 * clef**. Un message dans la mauvaise langue reste lisible et actionnable ;
 * un `rules.SEC_EVAL.message` affiche a l'utilisateur ne l'est pas. La
 * traduction peut donc avancer par morceaux sans jamais casser l'outil.
 *
 * Deux mecanismes, parce que les chaines sont de deux natures :
 *
 *   - l'**interface** (libelles, en-tetes, commandes) passe par `t()`, avec
 *     des clefs stables ;
 *   - les **regles** passent par un calque `regle(id, champ)`, qui remplace
 *     le texte au moment du rendu. Cela evite de reecrire trois cents
 *     definitions de regles pour y injecter des clefs — et surtout, la
 *     definition reste lisible telle quelle dans le code.
 *
 * Les messages construits par interpolation (« la valeur « x » provient de… »)
 * ne peuvent pas passer par le calque : ils sont assembles au moment de la
 * detection. Ils appellent `t()` directement, avec leurs parametres.
 */

import { CATALOGUE_FR } from './fr.js';
import { CATALOGUE_EN } from './en.js';
import { REGLES_EN } from './regles.en.js';

const CATALOGUES = { fr: CATALOGUE_FR, en: CATALOGUE_EN };
const CALQUES_DE_REGLES = { en: REGLES_EN };

export const LANGUES = Object.keys(CATALOGUES);

let langueCourante = 'fr';

/**
 * Determine la langue a utiliser.
 *
 * L'ordre va du plus explicite au plus implicite : ce que l'utilisateur
 * demande sur la ligne de commande l'emporte sur ce que son systeme suppose.
 */
export function resoudreLangue({ option = null, config = null, env = process.env } = {}) {
  const candidats = [
    option,
    config,
    env.ARGUS_LANG,
    // `fr_FR.UTF-8` ou `en_US` : seules les deux premieres lettres comptent.
    (env.LC_ALL || env.LANGUAGE || env.LANG || '').slice(0, 2).toLowerCase(),
  ];

  for (const candidat of candidats) {
    if (!candidat) continue;
    const code = String(candidat).slice(0, 2).toLowerCase();
    if (CATALOGUES[code]) return code;
  }
  return 'fr';
}

export function definirLangue(langue) {
  langueCourante = CATALOGUES[langue] ? langue : 'fr';
  return langueCourante;
}

export function langue() {
  return langueCourante;
}

/**
 * Traduit une clef d'interface.
 *
 * Les parametres sont interpoles sur `{nom}`. Une clef absente du catalogue
 * cible retombe sur le francais, puis sur la clef elle-meme — visible, donc
 * corrigeable, plutot que silencieusement vide.
 */
export function t(cle, parametres = {}) {
  const texte =
    CATALOGUES[langueCourante]?.[cle] ??
    CATALOGUES.fr[cle] ??
    cle;

  return texte.replace(/\{(\w+)\}/g, (complet, nom) =>
    Object.hasOwn(parametres, nom) ? String(parametres[nom]) : complet,
  );
}

/**
 * Traduction d'un champ de regle, ou `null` si elle n'existe pas.
 *
 * Retourner `null` plutot qu'une chaine vide est deliberé : l'appelant garde
 * ainsi le texte francais d'origine, qui vaut toujours mieux que rien.
 */
export function regle(identifiant, champ) {
  return CALQUES_DE_REGLES[langueCourante]?.[identifiant]?.[champ] ?? null;
}

/**
 * Applique le calque de traduction a un constat.
 * Sans effet en francais, et sans effet sur une regle non encore traduite.
 */
export function traduireConstat(constat) {
  if (langueCourante === 'fr' || !constat.ruleId) return constat;

  const titre = regle(constat.ruleId, 'title');
  const message = regle(constat.ruleId, 'message');
  const suggestion = regle(constat.ruleId, 'suggestion');
  if (!titre && !message && !suggestion) return constat;

  return {
    ...constat,
    title: titre ?? constat.title,
    message: message ?? constat.message,
    suggestion: suggestion ?? constat.suggestion,
  };
}

/** Etat de la traduction, pour le script de suivi et la documentation. */
export function couverture(langue_ = 'en') {
  const catalogue = CATALOGUES[langue_] || {};
  const calque = CALQUES_DE_REGLES[langue_] || {};
  return {
    interface: {
      traduites: Object.keys(catalogue).length,
      total: Object.keys(CATALOGUES.fr).length,
    },
    regles: Object.keys(calque).length,
  };
}
