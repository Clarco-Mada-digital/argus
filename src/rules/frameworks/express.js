import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Express.
 *
 * Express ne protege rien par defaut : c'est sa philosophie. Les problemes
 * viennent donc moins de protections desactivees que de protections jamais
 * mises en place — ou de reglages permissifs copies d'un tutoriel.
 */
export default {
  id: 'express',
  label: 'Express',
  appliesTo: (context) => context.has('express'),

  run(context, report) {
    const js = context.sources({ families: ['js'] });
    verifierSession(js, report);
    verifierFichiersStatiques(js, report);
    verifierFuiteDeTrace(js, report);
    verifierTailleDesRequetes(js, report);
  },
};

/** Un cookie de session sans `secure` ni `httpOnly` circule en clair et est lisible en JS. */
function verifierSession(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /session\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/g)) {
      const options = match[1];
      const ligne = index.lineOf(match.index);
      const cookie = /cookie\s*:\s*\{([^}]*)\}/.exec(options)?.[1] ?? '';

      const manquants = [];
      if (!/secure\s*:/.test(cookie)) manquants.push('secure');
      if (!/httpOnly\s*:/.test(cookie)) manquants.push('httpOnly');
      if (!/sameSite\s*:/.test(cookie)) manquants.push('sameSite');

      if (manquants.length > 0) {
        report({
          ruleId: 'EXPRESS-SESSION-COOKIE',
          category: 'security',
          severity: manquants.includes('secure') ? 'high' : 'medium',
          title: 'Cookie de session insuffisamment protege',
          message: `Le cookie de session ne definit pas ${manquants.join(', ')}. Sans secure il transite en HTTP, sans httpOnly il est lisible par n'importe quel script de la page.`,
          file: file.relativePath,
          line: ligne,
          snippet: index.textOfLine(ligne).trim(),
          suggestion:
            'cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true, sameSite: "lax", maxAge: 3600000 }',
          effort: 'rapide',
          confidence: 'certain',
          tags: ['CWE-614', 'express'],
        });
      }

      if (/saveUninitialized\s*:\s*true/.test(options)) {
        report({
          ruleId: 'EXPRESS-SESSION-UNINITIALIZED',
          category: 'performance',
          severity: 'low',
          title: 'Session creee pour chaque visiteur',
          message:
            'saveUninitialized: true enregistre une session des la premiere requete, meme pour un robot d\'indexation. Le magasin de sessions se remplit de sessions vides, et un cookie est depose sans consentement.',
          file: file.relativePath,
          line: ligne,
          suggestion: 'Passez saveUninitialized a false : la session ne sera creee qu\'a la premiere ecriture.',
          effort: 'rapide',
          confidence: 'certain',
          tags: ['express', 'rgpd'],
        });
      }
    }
  }
}

/** `dotfiles: 'allow'` publie .env, .git/config et les clefs SSH du dossier servi. */
function verifierFichiersStatiques(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /dotfiles\s*:\s*['"]allow['"]/g)) {
      report({
        ruleId: 'EXPRESS-STATIC-DOTFILES',
        category: 'security',
        severity: 'critical',
        title: 'Fichiers caches servis publiquement',
        message:
          'dotfiles: "allow" rend accessibles tous les fichiers commencant par un point du dossier servi — dont .env, .git/config et les clefs privees qui s\'y trouveraient.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion: 'Retirez cette option : le comportement par defaut ("ignore") est le bon.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-548', 'express'],
      });
    }
  }
}

/** Renvoyer une trace d'exception decrit l'arborescence et les versions au client. */
function verifierFuiteDeTrace(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /res\s*\.\s*(?:status\s*\([^)]*\)\s*\.\s*)?(?:json|send)\s*\(\s*[^)]{0,200}?\berr(?:or)?\s*\.\s*stack\b/g)) {
      report({
        ruleId: 'EXPRESS-STACK-LEAK',
        category: 'security',
        severity: 'high',
        title: 'Trace d\'exception renvoyee au client',
        message:
          'La reponse contient err.stack : chemins absolus du serveur, noms de modules et numeros de version. C\'est une carte de votre installation offerte a qui provoque une erreur.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion:
          'Journalisez la trace cote serveur et renvoyez un message neutre :\n  console.error(err);\n  res.status(500).json({ erreur: "Erreur interne" });',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-209', 'A05:2021', 'express'],
      });
    }
  }
}

/** Sans limite de taille, un seul corps de requete peut saturer la memoire. */
function verifierTailleDesRequetes(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /express\s*\.\s*(json|urlencoded|raw|text)\s*\(\s*(\{[^}]*\})?\s*\)/g)) {
      const options = match[2] || '';
      if (/limit\s*:/.test(options)) continue;

      report({
        ruleId: 'EXPRESS-NO-BODY-LIMIT',
        category: 'security',
        severity: 'medium',
        title: 'Corps de requete sans limite de taille',
        message: `express.${match[1]}() accepte par defaut jusqu'a 100 ko, mais rien n'est declare ici : le jour ou cette valeur change, ou si un intermediaire la releve, une requete unique peut saturer la memoire du processus.`,
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion: `Declarez la limite explicitement : express.${match[1]}({ limit: "100kb" }).`,
        effort: 'rapide',
        confidence: 'firm',
        tags: ['CWE-400', 'express'],
      });
    }
  }
}
