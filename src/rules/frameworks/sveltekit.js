import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack SvelteKit.
 *
 * Le piege propre au framework : ce que retourne une fonction `load` de
 * `+page.server.js` est **serialise et envoye au navigateur**. Le nom du
 * fichier rassure — « server » — mais son retour ne reste pas sur le serveur.
 */
export default {
  id: 'sveltekit',
  label: 'SvelteKit',
  appliesTo: (context) => context.has('sveltekit'),

  run(context, report) {
    const composants = context.sources({ languages: ['svelte'] });
    const serveur = context.sources({ families: ['js'] }).filter((f) => /\+(page|layout)\.server\.[jt]s$/.test(f.name));

    // --- Echappement contourne dans un composant.
    for (const file of composants) {
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /\{@html\s+/g)) {
        report({
          ruleId: 'SVELTE-HTML-TAG',
          category: 'security',
          severity: 'high',
          title: 'Echappement contourne par {@html}',
          message:
            'Svelte echappe tout par defaut ; {@html} est la seule facon d\'y echapper. Si la valeur provient d\'un utilisateur ou d\'une API, c\'est une faille XSS.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion: 'Affichez la valeur normalement, ou assainissez le HTML avant de l\'injecter.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-79', 'sveltekit'],
        });
      }
    }

    // --- Secret renvoye par une fonction `load`.
    for (const file of serveur) {
      const index = lineIndexFor(file);
      const charge = /export\s+(?:async\s+)?function\s+load\s*\([\s\S]*?\n\}/.exec(file.content);
      if (!charge) continue;

      for (const match of matches(charge[0], /\breturn\s*\{[\s\S]{0,400}?\}/g)) {
        const retour = match[0];
        // Le nom du champ peut etre anodin (`cleAdmin`) alors que la valeur ne
        // l'est pas (`process.env.ADMIN_SECRET`) : on regarde les deux.
        const sensible = /(?:secret|token|password|passwd|apiKey|api_key|credential|private_?key)/i;
        const champs = [...retour.matchAll(/(\w+)\s*:\s*([^,}\n]+)/g)]
          .filter(([, nom, valeur]) => sensible.test(nom) || sensible.test(valeur));
        const sensibles = champs.map(([, nom]) => nom);
        if (sensibles.length === 0) continue;

        report({
          ruleId: 'SVELTEKIT-SERVER-DATA-LEAK',
          category: 'security',
          severity: 'critical',
          title: 'Valeur sensible renvoyee par load()',
          message:
            `Le retour de load() est serialise et envoye au navigateur, malgre le nom « .server ». Les champs ${sensibles.join(', ')} seront lisibles dans le code source de la page.`,
          file: file.relativePath,
          line: index.lineOf(charge.index + match.index),
          snippet: index.textOfLine(index.lineOf(charge.index + match.index)).trim(),
          suggestion:
            'Ne renvoyez que ce que la page doit afficher. Gardez la valeur dans la fonction serveur, ou exposez uniquement le resultat de son utilisation.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-200', 'sveltekit'],
          docs: 'https://svelte.dev/docs/kit/load',
        });
      }
    }
  },
};
