import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack Flask.
 *
 * Flask ne fournit presque rien par defaut — c'est son principe. Les problemes
 * viennent donc de protections jamais mises en place, la ou un framework plus
 * complet les aurait imposees.
 */
export default {
  id: 'flask',
  label: 'Flask',
  appliesTo: (context) => context.has('flask'),

  run(context, report) {
    const python = context.sources({ languages: ['python'] });
    const tout = python.map((f) => f.content).join('\n');

    for (const file of python) {
      const index = lineIndexFor(file);

      // --- Clef de session en dur : elle signe les cookies.
      for (const match of matches(file.content, /^[ \t]*(?:app\.(?:config\[['"]SECRET_KEY['"]\]|secret_key)|SECRET_KEY)\s*=\s*(['"][^'"]{4,}['"])/gm)) {
        if (/os\.environ|getenv|config\(/.test(match[0])) continue;
        report({
          ruleId: 'FLASK-SECRET-KEY-HARDCODED',
          category: 'security',
          severity: 'critical',
          title: 'SECRET_KEY ecrite en dur',
          message:
            'Cette clef signe les cookies de session. Versionnee, elle permet de forger une session valide pour n\'importe quel utilisateur, administrateur compris.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Lisez-la depuis l\'environnement : app.secret_key = os.environ["FLASK_SECRET_KEY"]. Puis regenerez-la — celle-ci est compromise.',
          effort: 'rapide',
          confidence: 'certain',
          tags: ['CWE-798', 'flask'],
        });
      }

      // --- Envoi de fichier construit depuis la requete.
      for (const match of matches(file.content, /send_(?:file|from_directory)\s*\([^)]*request\.(?:args|form|values|json)/g)) {
        report({
          ruleId: 'FLASK-SEND-FILE-TRAVERSAL',
          category: 'security',
          severity: 'high',
          title: 'Chemin de fichier issu de la requete',
          message:
            'Le chemin servi depend directement d\'une valeur envoyee par le client : une suite de « ../ » permet de sortir du dossier prevu et de lire n\'importe quel fichier lisible par le processus.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Utilisez send_from_directory avec un dossier fixe et passez le nom par werkzeug.utils.secure_filename. Mieux : servez un identifiant, et faites la correspondance cote serveur.',
          effort: 'moyen',
          confidence: 'firm',
          tags: ['CWE-22', 'A01:2021', 'flask'],
        });
      }
    }

    // --- Aucune protection CSRF a l'echelle du projet.
    const formulairesPost = /methods\s*=\s*\[[^\]]*['"]POST['"]/.test(tout);
    const protection = /CSRFProtect|csrf\.init_app|flask_wtf|FlaskForm|WTF_CSRF/.test(tout);
    if (formulairesPost && !protection) {
      const cible = python.find((f) => /methods\s*=\s*\[[^\]]*['"]POST['"]/.test(f.content));
      report({
        ruleId: 'FLASK-NO-CSRF',
        category: 'security',
        severity: 'high',
        title: 'Aucune protection CSRF',
        message:
          'Des routes acceptent des requetes POST, mais aucune protection CSRF n\'a ete trouvee. Flask n\'en fournit aucune par defaut : n\'importe quel site peut declencher ces actions au nom d\'un utilisateur connecte.',
        file: cible?.relativePath ?? null,
        line: 1,
        suggestion:
          'Installez Flask-WTF et activez la protection globale :\n  from flask_wtf.csrf import CSRFProtect\n  CSRFProtect(app)\nPuis ajoutez {{ csrf_token() }} dans chaque formulaire.',
        effort: 'moyen',
        confidence: 'firm',
        tags: ['CWE-352', 'flask'],
      });
    }
  },
};
