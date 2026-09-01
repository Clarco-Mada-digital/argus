import { FRAMEWORK_PACKS } from '../rules/frameworks/index.js';

/**
 * Execute les packs de regles correspondant aux frameworks detectes.
 *
 * Les constats sont repartis dans les categories habituelles : un formulaire
 * sans jeton CSRF releve de la securite, un nom de route inconnu des routes.
 * L'utilisateur n'a pas a savoir quel pack a produit quel resultat.
 */
export default {
  id: 'frameworks',
  category: 'security',
  categories: ['security', 'routes', 'quality', 'seo', 'performance'],
  label: 'Regles specifiques aux frameworks',
  order: 35,

  appliesTo: (context) => FRAMEWORK_PACKS.some((pack) => pack.appliesTo(context)),

  async run(context, report) {
    const actifs = [];
    for (const pack of FRAMEWORK_PACKS) {
      if (!pack.appliesTo(context)) continue;
      actifs.push(pack.label);
      try {
        pack.run(context, report);
      } catch (erreur) {
        // Un pack defaillant ne doit pas interrompre l'analyse du projet, mais
        // le silence complet rend le bug introuvable : on le remonte comme un
        // constat de faible severite, visible sans etre bloquant.
        report({
          ruleId: 'ARGUS-PACK-EN-ECHEC',
          severity: 'low',
          category: 'quality',
          title: `Le pack ${pack.label} n'a pas pu s'executer`,
          message: `Une erreur interne a interrompu les regles ${pack.label} : ${erreur.message}. Les autres analyses restent valides, mais ce framework n'a pas ete verifie.`,
          suggestion: 'Signalez ce message : il s\'agit d\'un defaut d\'Argus, pas de votre code.',
          confidence: 'firm',
          effort: 'rapide',
        });
      }
    }
    context.shared.set('frameworkPacks', actifs);
  },
};
