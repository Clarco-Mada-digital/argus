import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack Angular.
 *
 * Angular assainit tout ce qui entre dans le DOM. Les failles viennent donc
 * presque toujours d'un contournement explicite de ce mecanisme.
 */
export default {
  id: 'angular',
  label: 'Angular',
  appliesTo: (context) => context.has('angular'),

  run(context, report) {
    for (const file of context.sources({ families: ['js', 'markup'] })) {
      const index = lineIndexFor(file);

      for (const match of matches(file.content, /bypassSecurityTrust(Html|Script|Style|Url|ResourceUrl)\s*\(/g)) {
        report({
          ruleId: 'ANGULAR-BYPASS-SECURITY',
          category: 'security',
          severity: match[1] === 'Script' || match[1] === 'Html' ? 'high' : 'medium',
          title: `Assainissement desactive : bypassSecurityTrust${match[1]}`,
          message:
            `Angular assainit tout ce qui entre dans le DOM. bypassSecurityTrust${match[1]} desactive cette protection pour la valeur passee : si elle vient d'une source externe, c'est une faille XSS directe.`,
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'N\'appelez cette methode que sur une valeur dont vous controlez entierement l\'origine — jamais sur une donnee d\'API ou de formulaire. Sinon, laissez Angular assainir.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-79', 'angular'],
          docs: 'https://angular.dev/best-practices/security',
        });
      }

      for (const match of matches(file.content, /\[innerHTML\]\s*=/g)) {
        report({
          ruleId: 'ANGULAR-INNERHTML-BINDING',
          category: 'security',
          severity: 'medium',
          title: 'Liaison [innerHTML]',
          message:
            'Angular assainit cette liaison, mais elle reste la porte d\'entree la plus courante vers un bypassSecurityTrustHtml ajoute plus tard « parce que le rendu etait casse ».',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Preferez l\'interpolation ou des composants dedies. Si du HTML riche est necessaire, assainissez cote serveur avec une liste blanche de balises.',
          effort: 'moyen',
          confidence: 'tentative',
          tags: ['CWE-79', 'angular'],
        });
      }
    }
  },
};
