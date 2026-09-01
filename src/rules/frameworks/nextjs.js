import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Next.js.
 *
 * La fuite par prefixe NEXT_PUBLIC_ est traitee par une regle generale
 * (variables-publiques.js) : le mecanisme est identique dans Nuxt, Vite,
 * SvelteKit, Astro et les autres. Ce pack couvre le reste.
 */
export default {
  id: 'nextjs',
  label: 'Next.js',
  appliesTo: (context) => context.has('nextjs'),

  run(context, report) {
    const js = context.sources({ families: ['js'], includeTests: false });
    const config = context.files.filter((f) => /^next\.config\.(js|mjs|ts)$/.test(f.name));

    verifierConfig(config, report);
    verifierMethodesApi(js, report);
  },
};

/** Reglages de next.config.js aux consequences disproportionnees. */
const REGLAGES_CONFIG = [
  {
    motif: /eslint\s*:\s*\{[^}]*ignoreDuringBuilds\s*:\s*true/,
    id: 'NEXTJS-IGNORE-LINT',
    severity: 'medium',
    titre: 'Erreurs de lint ignorees a la construction',
    message:
      'ignoreDuringBuilds: true laisse passer en production du code que le linter refuse. Le garde-fou existe encore, mais plus personne ne le voit.',
    quoi: 'Corrigez les erreurs, ou desactivez les regles precises qui genent dans .eslintrc — pas le linter entier.',
  },
  {
    motif: /typescript\s*:\s*\{[^}]*ignoreBuildErrors\s*:\s*true/,
    id: 'NEXTJS-IGNORE-TYPES',
    severity: 'high',
    titre: 'Erreurs TypeScript ignorees a la construction',
    message:
      'ignoreBuildErrors: true publie du code dont le compilateur affirme qu\'il est incorrect. Les erreurs de type deviennent des erreurs a l\'execution, chez vos visiteurs.',
    quoi: 'Corrigez les types. En transition, isolez les fichiers concernes avec // @ts-expect-error, qui documente la dette au lieu de l\'effacer.',
  },
  {
    motif: /images\s*:\s*\{[^}]*domains\s*:\s*\[[^\]]*['"]\*['"]/,
    id: 'NEXTJS-IMAGE-WILDCARD',
    severity: 'high',
    titre: 'Optimiseur d\'images ouvert a tous les domaines',
    message:
      'Avec domains: ["*"], /_next/image accepte n\'importe quelle URL : votre serveur telecharge et sert le contenu de tiers. C\'est un relais ouvert, utilisable pour du contournement de filtrage ou pour saturer votre bande passante.',
    quoi: 'Listez les domaines reellement utilises, ou utilisez remotePatterns pour un controle plus fin.',
  },
];

function verifierConfig(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    const contenu = file.content;

    for (const reglage of REGLAGES_CONFIG) {
      const match = reglage.motif.exec(contenu);
      if (!match) continue;
      report({
        ruleId: reglage.id,
        category: reglage.id === 'NEXTJS-IMAGE-WILDCARD' ? 'security' : 'quality',
        severity: reglage.severity,
        title: reglage.titre,
        message: reglage.message,
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion: reglage.quoi,
        effort: 'moyen',
        confidence: 'certain',
        tags: ['nextjs'],
      });
    }

    if (!/headers\s*\(/.test(contenu)) {
      report({
        ruleId: 'NEXTJS-NO-HEADERS',
        category: 'security',
        severity: 'medium',
        title: 'Aucun en-tete de securite configure',
        message:
          'next.config.js ne definit pas de fonction headers() : le site est servi sans CSP, sans HSTS et sans protection contre l\'affichage en iframe.',
        file: file.relativePath,
        line: 1,
        suggestion:
          'Ajoutez une fonction headers() renvoyant Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options et Referrer-Policy pour la route "/:path*".',
        effort: 'moyen',
        tags: ['A05:2021', 'nextjs'],
        docs: 'https://nextjs.org/docs/app/api-reference/next-config-js/headers',
      });
    }
  }
}

/**
 * Une route d'API qui ne verifie pas req.method traite un GET comme un POST.
 * Une action de paiement ou de suppression devient alors declenchable par un
 * simple lien — ou par le prechargement d'un navigateur.
 */
function verifierMethodesApi(fichiers, report) {
  for (const file of fichiers) {
    if (!/(^|\/)pages\/api\/|(^|\/)app\/api\//.test(file.relativePath)) continue;
    // Le routeur `app/` declare une fonction par methode : la question ne se pose pas.
    if (/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(file.content)) continue;
    if (/req\s*\.\s*method|request\s*\.\s*method/.test(file.content)) continue;

    const index = lineIndexFor(file);
    const match = /export\s+default\s+(async\s+)?function\s+(\w+)/.exec(file.content);
    if (!match) continue;

    report({
      ruleId: 'NEXTJS-API-NO-METHOD-CHECK',
      category: 'security',
      severity: 'medium',
      title: 'Route d\'API sans verification de methode',
      message:
        'Le gestionnaire traite toutes les methodes de la meme facon. Une action destinee a un POST devient declenchable par un GET — donc par un lien, une image, ou le prechargement d\'un navigateur.',
      file: file.relativePath,
      line: index.lineOf(match.index),
      snippet: index.textOfLine(index.lineOf(match.index)).trim(),
      suggestion:
        'Commencez par filtrer :\n  if (req.method !== "POST") return res.status(405).json({ erreur: "Methode non autorisee" });',
      effort: 'rapide',
      confidence: 'firm',
      tags: ['CWE-352', 'nextjs'],
    });
  }
}
