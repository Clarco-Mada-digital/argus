import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Next.js.
 *
 * La particularite de Next.js est la frontiere serveur/navigateur : le meme
 * fichier peut contenir du code qui reste sur le serveur et du code qui part
 * dans le navigateur. Les erreurs les plus couteuses viennent de la confusion
 * entre les deux — a commencer par le prefixe NEXT_PUBLIC_.
 */
export default {
  id: 'nextjs',
  label: 'Next.js',
  appliesTo: (context) => context.has('nextjs'),

  run(context, report) {
    const js = context.sources({ families: ['js'], includeTests: false });
    const config = context.files.filter((f) => /^next\.config\.(js|mjs|ts)$/.test(f.name));
    const env = context.files.filter((f) => f.readable && /(^|\/)\.env/.test(f.relativePath));

    verifierVariablesPubliques([...js, ...env], report);
    verifierConfig(config, report);
    verifierMethodesApi(js, report);
  },
};

/**
 * Tout ce qui commence par NEXT_PUBLIC_ est remplace par sa valeur au moment
 * de la construction et se retrouve **dans le fichier JavaScript telecharge par
 * le navigateur**. Le prefixe n'est pas un espace de noms : c'est une
 * publication.
 */
const NOM_SENSIBLE = /(secret|token|password|passwd|private|api_?key|apikey|credential|signing|webhook)/i;

function verifierVariablesPubliques(fichiers, report) {
  const signales = new Set();

  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /\bNEXT_PUBLIC_([A-Z0-9_]+)/g)) {
      const nom = `NEXT_PUBLIC_${match[1]}`;
      if (!NOM_SENSIBLE.test(match[1])) continue;
      if (signales.has(nom)) continue;
      signales.add(nom);

      report({
        ruleId: 'NEXTJS-PUBLIC-SECRET',
        category: 'security',
        severity: 'critical',
        title: `${nom} est publiee dans le navigateur`,
        message:
          'Next.js remplace toute variable prefixee NEXT_PUBLIC_ par sa valeur au moment de la construction, et l\'inclut dans le bundle telecharge par chaque visiteur. Le nom indique une valeur sensible : elle est donc lisible par n\'importe qui, via « afficher le code source ».',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion:
          `Retirez le prefixe : ${nom.replace('NEXT_PUBLIC_', '')} reste alors cote serveur. Consommez-la depuis une route d'API, getServerSideProps ou un composant serveur — et considerez la valeur actuelle comme compromise.`,
        effort: 'moyen',
        confidence: 'certain',
        tags: ['CWE-200', 'A01:2021', 'nextjs'],
        docs: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables',
      });
    }
  }
}

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
