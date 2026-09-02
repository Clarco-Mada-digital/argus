/**
 * Domaine de validite des regles, par plateforme.
 *
 * Le probleme, mesure sur une application Electron reelle : Argus appliquait
 * des regles hors de leur domaine. Une balise canonique sur la fenetre d'une
 * application de bureau, un `preconnect` dans un fichier charge depuis le
 * disque, une profondeur d'URL dans un logiciel qui n'a pas d'URL.
 *
 * Corriger cas par cas aurait produit une dizaine de `if (cible('web'))`
 * disperses dans les analyseurs — invisibles, jamais relus, et oublies a la
 * regle suivante. La contrainte est donc declaree ici, en un seul endroit, et
 * appliquee centralement par le moteur.
 *
 * Regle de lecture : **l'absence d'entree signifie « valide partout »**. On
 * ne restreint que ce dont on peut justifier la restriction, parce qu'une
 * regle muette a tort coute plus cher qu'une regle bavarde a tort — la
 * seconde se voit, la premiere non.
 */

/**
 * Regles qui n'ont de sens que sur le web.
 *
 * Chaque entree porte sa raison : sans elle, la liste devient un fourre-tout
 * ou l'on ajoute par reflexe.
 */
export const DOMAINE_WEB_UNIQUEMENT = {
  // Referencement : suppose un robot d'indexation.
  'SEO-': 'aucun robot n\'explore une application locale',

  // En-tetes HTTP : supposent un serveur HTTP.
  'SEC-MISSING-HEADERS': 'des en-tetes HTTP supposent un serveur HTTP',

  // Performance reseau : ces regles optimisent un *telechargement*. Les
  // fichiers d'une application installee sont lus depuis le disque.
  'PERF-NO-PRECONNECT': 'preconnect est une indication de reseau',
  'PERF-BLOCKING-SCRIPT': 'le rendu bloquant se paie au premier chargement reseau',
  'PERF-TOO-MANY-CSS': 'le nombre de requetes ne compte que sur le reseau',
  'PERF-FONT-FORMAT': 'le format de police optimise le poids telecharge',
  'PERF-FONT-DISPLAY': 'font-display evite le texte invisible pendant un telechargement',

  // Hygiene d'URL : un logiciel de bureau n'a pas d'URL a partager ni a
  // faire indexer.
  'ROUTE-UPPERCASE': 'une application locale n\'a pas d\'URL publique',
  'ROUTE-UNDERSCORE': 'une application locale n\'a pas d\'URL publique',
  'ROUTE-TOO-DEEP': 'une application locale n\'a pas d\'URL publique',
  'ROUTE-NO-404': 'aucun serveur ne sert de page d\'erreur ici',
  'ROUTE-ORPHAN': 'la fenetre est chargee par le code, aucun lien ne pointe vers elle',

  // Conventions de page web.
  'A11Y-NO-SKIP-LINK': 'le lien d\'evitement repond a une navigation repetee entre pages',
  'UX-NO-AUTOCOMPLETE': 'autocomplete pilote le remplissage automatique du navigateur',

  // Mise en page adaptative : une fenetre d'application se redimensionne,
  // mais elle n'a pas a se replier sur 320 px, et un panneau de largeur fixe
  // y est la norme plutot qu'un defaut.
  'DESIGN-NO-BREAKPOINTS': 'les points de rupture repondent a la diversite des ecrans du web',
  'DESIGN-TOO-MANY-BREAKPOINTS': 'les points de rupture repondent a la diversite des ecrans du web',
  'DESIGN-FIXED-WIDTH': 'un panneau de largeur fixe est la norme dans une interface de bureau',
};

/**
 * Le domaine d'une regle, ou `null` si elle vaut partout.
 * La correspondance accepte un prefixe (`SEO-`) comme un identifiant complet.
 */
export function domaineDeLaRegle(ruleId) {
  if (!ruleId) return null;
  if (DOMAINE_WEB_UNIQUEMENT[ruleId]) return { plateformes: ['web'], raison: DOMAINE_WEB_UNIQUEMENT[ruleId] };

  for (const [cle, raison] of Object.entries(DOMAINE_WEB_UNIQUEMENT)) {
    if (cle.endsWith('-') && ruleId.startsWith(cle)) return { plateformes: ['web'], raison };
  }
  return null;
}

/**
 * Ce constat est-il valide pour les plateformes visees ?
 *
 * Un projet qui vise plusieurs plateformes conserve la regle des qu'*une*
 * d'entre elles la justifie : un monorepo web + mobile doit garder le SEO
 * pour sa partie web.
 */
export function constatDansSonDomaine(ruleId, plateformes) {
  const domaine = domaineDeLaRegle(ruleId);
  if (!domaine) return true;
  if (!plateformes || plateformes.length === 0) return true;
  return domaine.plateformes.some((p) => plateformes.includes(p));
}
