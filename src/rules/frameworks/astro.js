import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack Astro.
 *
 * L'interet d'Astro est de n'envoyer aucun JavaScript par defaut. Les
 * problemes viennent donc de ce qui annule cette propriete : une directive
 * d'hydratation trop large, ou du HTML injecte sans echappement.
 */
export default {
  id: 'astro',
  label: 'Astro',
  appliesTo: (context) => context.has('astro'),

  run(context, report) {
    const pages = context.sources({ languages: ['astro'] });
    const config = context.files.filter((f) => f.readable && /^astro\.config\.(mjs|js|ts)$/.test(f.name));

    for (const file of pages) {
      const index = lineIndexFor(file);

      // --- Injection de HTML brut.
      for (const match of matches(file.content, /set:html\s*=/g)) {
        report({
          ruleId: 'ASTRO-SET-HTML',
          category: 'security',
          severity: 'high',
          title: 'HTML injecte sans echappement',
          message:
            'set:html insere le contenu tel quel dans la page, sans echappement — c\'est l\'equivalent Astro de innerHTML. Si la valeur vient d\'une source externe, c\'est une faille XSS.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Affichez la valeur par interpolation normale. Si du HTML est necessaire, assainissez-le avant (par exemple avec sanitize-html) et documentez la source.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-79', 'astro'],
        });
      }

      // --- Composant jamais rendu cote serveur.
      for (const match of matches(file.content, /client:only(?:=["'][\w-]+["'])?/g)) {
        report({
          ruleId: 'ASTRO-CLIENT-ONLY',
          category: 'seo',
          severity: 'medium',
          title: 'Composant rendu uniquement dans le navigateur',
          message:
            'client:only saute entierement le rendu serveur : le contenu de ce composant est absent du HTML envoye. Les moteurs de recherche et les apercus de partage ne le verront pas.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Preferez client:load ou client:visible, qui rendent le composant cote serveur puis l\'hydratent. Reservez client:only aux composants qui dependent reellement d\'API du navigateur.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['astro', 'seo'],
        });
      }
    }

    // --- `define` injecte la valeur litteralement dans le bundle client.
    for (const file of config) {
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /define\s*:\s*\{[^}]*['"][\w.]*(?:SECRET|TOKEN|KEY|PASSWORD)[\w.]*['"]\s*:/gi)) {
        report({
          ruleId: 'ASTRO-VITE-DEFINE-SECRET',
          category: 'security',
          severity: 'critical',
          title: 'Secret injecte dans le bundle par vite.define',
          message:
            'define remplace litteralement l\'expression par sa valeur au moment de la construction, y compris dans le code envoye au navigateur. La valeur se retrouve en clair dans le fichier JavaScript telecharge.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Ne passez par define que des valeurs publiques. Lisez les secrets cote serveur, dans un endpoint ou une fonction, jamais a la construction.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-200', 'astro'],
        });
      }
    }
  },
};
