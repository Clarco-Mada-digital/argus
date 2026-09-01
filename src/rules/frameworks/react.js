import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack React.
 *
 * React protege de l'injection HTML par defaut. Les problemes viennent de ce
 * qui se glisse a cote : un jeton range dans le stockage du navigateur, une
 * liste sans clef, un lien construit a partir d'une valeur externe.
 *
 * Ces regles valent pour React seul comme pour Next.js, Remix ou Vite.
 */
export default {
  id: 'react',
  label: 'React',
  appliesTo: (context) => context.has('react', 'nextjs', 'remix', 'gatsby', 'react-native'),

  run(context, report) {
    for (const file of context.sources({ families: ['js'] })) {
      if (!/\.(jsx|tsx)$/.test(file.name) && !/<[A-Z]|useState|useEffect/.test(file.content)) continue;
      const index = lineIndexFor(file);

      verifierStockageDeJeton(file, index, report);
      verifierClefsDeListe(file, index, report);
      verifierLienDynamique(file, index, report);
    }
  },
};

/**
 * Un jeton dans localStorage est lisible par tout script de la page : une seule
 * faille XSS, une dependance compromise, et la session part.
 */
function verifierStockageDeJeton(file, index, report) {
  const motif = /(localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*['"`]([^'"`]*(?:token|jwt|auth|session|refresh|credential|password)[^'"`]*)['"`]/gi;

  for (const match of matches(file.content, motif)) {
    report({
      ruleId: 'REACT-TOKEN-IN-STORAGE',
      category: 'security',
      severity: 'high',
      title: `Jeton d'authentification dans ${match[1]}`,
      message:
        `« ${match[2]} » est range dans le stockage du navigateur, accessible a tout script de la page. Une seule faille XSS — ou une dependance compromise — suffit alors a exfiltrer la session.`,
      file: file.relativePath,
      line: index.lineOf(match.index),
      snippet: index.textOfLine(index.lineOf(match.index)).trim(),
      suggestion:
        'Faites porter la session par un cookie httpOnly, secure et SameSite : le navigateur l\'envoie automatiquement, et aucun script ne peut le lire.',
      effort: 'important',
      confidence: 'firm',
      tags: ['CWE-522', 'A07:2021', 'react'],
    });
  }
}

/**
 * Sans clef stable, React reassocie les elements par position : au tri ou a la
 * suppression, l'etat interne (champ saisi, case cochee) suit la mauvaise ligne.
 */
function verifierClefsDeListe(file, index, report) {
  const motif = /\.map\s*\(\s*\(?[^)=]{0,60}?\)?\s*=>\s*[({]?\s*<([A-Za-z][\w.]*)((?:\s+[^>]*?)?)>/g;

  for (const match of matches(file.content, motif)) {
    const attributs = match[2] || '';
    if (/\bkey\s*=/.test(attributs)) continue;
    // Un fragment court peut porter la clef plus loin : on limite aux cas nets.
    if (match[1] === 'Fragment' || match[1] === '') continue;

    report({
      ruleId: 'REACT-LIST-NO-KEY',
      category: 'quality',
      severity: 'medium',
      title: `Liste rendue sans attribut key sur <${match[1]}>`,
      message:
        'Sans clef stable, React reassocie les elements par position. Au tri ou apres une suppression, l\'etat interne — champ saisi, case cochee, focus — suit la mauvaise ligne.',
      file: file.relativePath,
      line: index.lineOf(match.index),
      snippet: index.textOfLine(index.lineOf(match.index)).trim(),
      suggestion:
        'Ajoutez key={element.id}. Evitez l\'index du tableau : il change des que la liste est reordonnee, ce qui reproduit exactement le probleme.',
      effort: 'rapide',
      confidence: 'firm',
      tags: ['react'],
      docs: 'https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key',
    });
  }
}

/** Un href construit depuis une valeur externe peut porter `javascript:`. */
function verifierLienDynamique(file, index, report) {
  for (const match of matches(file.content, /href\s*=\s*\{\s*(?!['"`])[^}]{0,80}\}/g)) {
    const expression = match[0];
    if (!/\b(props|data|item|user|article|post|result|response|params)\b/.test(expression)) continue;
    if (/^href=\{`?\/|^href=\{['"]/.test(expression)) continue;

    report({
      ruleId: 'REACT-DYNAMIC-HREF',
      category: 'security',
      severity: 'medium',
      title: 'Lien construit a partir d\'une valeur externe',
      message:
        'React n\'echappe pas les URL : une valeur commencant par javascript: devient du code executable au clic.',
      file: file.relativePath,
      line: index.lineOf(match.index),
      snippet: index.textOfLine(index.lineOf(match.index)).trim(),
      suggestion:
        'Verifiez le schema avant affichage : n\'acceptez que http, https, mailto et les chemins relatifs commencant par « / ».',
      effort: 'rapide',
      confidence: 'tentative',
      tags: ['CWE-79', 'react'],
    });
  }
}
