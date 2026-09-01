import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack Nuxt.
 *
 * Nuxt expose deux surfaces de configuration qui se ressemblent mais n'ont pas
 * du tout la meme portee : `runtimeConfig` reste sur le serveur,
 * `runtimeConfig.public` part dans le navigateur. La confusion entre les deux
 * est l'erreur la plus couteuse du framework.
 */
export default {
  id: 'nuxt',
  label: 'Nuxt',
  appliesTo: (context) => context.has('nuxt'),

  run(context, report) {
    const config = context.files.filter((f) => f.readable && /^nuxt\.config\.(ts|js|mjs)$/.test(f.name));

    for (const file of config) {
      const index = lineIndexFor(file);
      const contenu = file.content;

      // --- Secret dans la section publique du runtimeConfig.
      const bloc = /public\s*:\s*\{([\s\S]*?)\n\s*\}/.exec(contenu);
      if (bloc) {
        for (const match of matches(bloc[1], /(\w*(?:secret|token|password|private|apiKey|credential)\w*)\s*:/gi)) {
          const decalage = bloc.index + bloc[0].indexOf(bloc[1]) + match.index;
          report({
            ruleId: 'NUXT-PUBLIC-RUNTIME-SECRET',
            category: 'security',
            severity: 'critical',
            title: `« ${match[1]} » est expose au navigateur`,
            message:
              'Tout ce qui figure sous runtimeConfig.public est serialise dans la charge utile envoyee au navigateur. Le nom designe une valeur sensible : elle est lisible par n\'importe quel visiteur.',
            file: file.relativePath,
            line: index.lineOf(decalage),
            snippet: index.textOfLine(index.lineOf(decalage)).trim(),
            suggestion:
              `Deplacez ${match[1]} a la racine de runtimeConfig, hors de public : elle reste alors accessible cote serveur uniquement, via useRuntimeConfig().`,
            effort: 'moyen',
            confidence: 'certain',
            tags: ['CWE-200', 'nuxt'],
            docs: 'https://nuxt.com/docs/guide/going-further/runtime-config',
          });
        }
      }

      // --- Rendu serveur desactive.
      const ssr = /\bssr\s*:\s*false/.exec(contenu);
      if (ssr) {
        report({
          ruleId: 'NUXT-SSR-DISABLED',
          category: 'seo',
          severity: 'high',
          title: 'Rendu serveur desactive',
          message:
            'Avec ssr: false, Nuxt ne sert qu\'une coquille vide : tout le contenu est genere dans le navigateur. Les robots d\'indexation et les apercus de partage voient une page blanche.',
          file: file.relativePath,
          line: index.lineOf(ssr.index),
          snippet: 'ssr: false',
          suggestion:
            'Laissez le rendu serveur actif pour les pages publiques. Si une section doit rester purement cliente, utilisez routeRules pour ne desactiver le rendu que sur ces chemins.',
          effort: 'important',
          confidence: 'certain',
          tags: ['nuxt', 'seo'],
        });
      }

      // --- Outils de developpement laisses actifs.
      const devtools = /devtools\s*:\s*\{[^}]*enabled\s*:\s*true/.exec(contenu);
      if (devtools) {
        report({
          ruleId: 'NUXT-DEVTOOLS-ENABLED',
          category: 'security',
          severity: 'low',
          title: 'Nuxt DevTools active sans condition',
          message: 'Les outils de developpement exposent la configuration et l\'arborescence des composants.',
          file: file.relativePath,
          line: index.lineOf(devtools.index),
          suggestion: 'Conditionnez : devtools: { enabled: process.env.NODE_ENV !== "production" }.',
          effort: 'rapide',
          tags: ['nuxt'],
        });
      }
    }
  },
};
