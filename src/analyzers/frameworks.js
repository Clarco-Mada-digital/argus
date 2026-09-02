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
    signalerLesAnglesMorts(context, report);
  },
};

/**
 * Frameworks pour lesquels un pack dedie aurait du sens, mais n'existe pas.
 *
 * La liste est explicite plutot que deduite : `vite`, `docker` ou `tailwind`
 * sont detectes eux aussi, mais un « pack Vite » n'aurait pas de sens et le
 * signaler serait du bruit.
 */
const SANS_PACK_DEDIE = {
  vue: 'Vue',
  svelte: 'Svelte',
  nestjs: 'NestJS',
  fastify: 'Fastify',
  koa: 'Koa',
  gatsby: 'Gatsby',
  remix: 'Remix',
  symfony: 'Symfony',
  capacitor: 'Capacitor',
  ionic: 'Ionic',
  nativescript: 'NativeScript',
  go: 'Go',
  rust: 'Rust',
};

/**
 * Dire ce qu'on ne couvre pas.
 *
 * Le silence d'un analyseur est ambigu : « aucun probleme dans votre code
 * Svelte » peut vouloir dire que le code est propre, ou qu'aucune regle Svelte
 * n'existe. Les deux s'affichent pareil, et c'est une faiblesse de conception
 * plutot qu'un detail d'affichage — l'utilisateur croit avoir ete verifie.
 *
 * L'analyse generique (secrets, injections, code mort, qualite, dependances)
 * s'applique de toute facon : ce constat porte sur les pieges *propres* a
 * l'outil, ceux qu'un pack dedie connaitrait.
 */
function signalerLesAnglesMorts(context, report) {
  const decouverts = context.frameworks
    .filter((id) => SANS_PACK_DEDIE[id])
    .map((id) => SANS_PACK_DEDIE[id]);

  if (decouverts.length === 0) return;

  report({
    ruleId: 'ARGUS-COUVERTURE-PARTIELLE',
    severity: 'info',
    category: 'quality',
    title: `Pas de regles dediees : ${decouverts.join(', ')}`,
    message:
      `Argus a reconnu ${decouverts.join(', ')} mais n'a pas de pack de regles specifique. ` +
      'L\'analyse generique s\'applique quand meme — secrets, injections, code mort, qualite, ' +
      'dependances — mais les pieges propres a ces outils ne sont pas verifies. Une categorie ' +
      'sans constat ne veut donc pas dire « rien a signaler » pour cette partie du code.',
    suggestion:
      'Ce constat existe pour que l\'absence de resultat ne soit pas prise pour un satisfecit. ' +
      'Un pack se contribue en un module dans src/rules/frameworks/ ; la methode est dans CONTRIBUTING.md.',
    confidence: 'firm',
    effort: 'long',
  });
}
