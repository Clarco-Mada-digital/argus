import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Ruby on Rails.
 *
 * Rails protege beaucoup par defaut — jetons CSRF, parametres forts,
 * echappement des vues. Les vraies failles viennent donc surtout de la
 * *desactivation* de ces protections : c'est ce que ce pack cherche.
 */
export default {
  id: 'rails',
  label: 'Ruby on Rails',
  appliesTo: (context) => context.has('rails'),

  run(context, report) {
    const ruby = context.sources({ languages: ['ruby'] });
    const vues = context.sources({ languages: ['erb'] });

    verifierCsrf(ruby, report);
    verifierParametresForts(ruby, report);
    verifierInjectionOrm(ruby, report);
    verifierHtmlSafe([...ruby, ...vues], report);
    verifierSecretsVersionnes(context, report);
  },
};

/** Rails verifie le jeton CSRF par defaut : le desactiver est un choix explicite. */
function verifierCsrf(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /skip_before_action\s+:verify_authenticity_token|protect_from_forgery\s+with:\s*:null_session/g)) {
      const ligne = index.lineOf(match.index);
      const portee = index.textOfLine(ligne);
      // `only:` / `except:` indiquent une desactivation ciblee, deja reflechie.
      const cible = /\b(only|except):/.test(portee);

      report({
        ruleId: 'RAILS-CSRF-DISABLED',
        category: 'security',
        severity: cible ? 'medium' : 'high',
        title: 'Verification CSRF desactivee',
        message: cible
          ? 'La protection CSRF est levee sur certaines actions. Verifiez qu\'aucune d\'elles ne modifie de donnees.'
          : 'La protection CSRF est levee pour tout le controleur : n\'importe quel site peut declencher ses actions au nom d\'un utilisateur connecte.',
        file: file.relativePath,
        line: ligne,
        snippet: portee.trim(),
        suggestion:
          'Retirez cette ligne. Pour une API sans session, utilisez plutot ActionController::API, qui n\'active pas la protection CSRF du tout.',
        effort: 'moyen',
        confidence: 'certain',
        tags: ['CWE-352', 'rails'],
      });
    }
  }
}

/** `permit!` autorise tous les parametres : c'est renoncer aux parametres forts. */
function verifierParametresForts(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /\.permit!\s*|params\.to_unsafe_h/g)) {
      report({
        ruleId: 'RAILS-PERMIT-ALL',
        category: 'security',
        severity: 'high',
        title: 'Parametres forts contournes',
        message:
          'permit! accepte n\'importe quel attribut envoye par le client. Un champ cache dans le formulaire suffit alors a modifier admin, role ou user_id.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion: 'Listez les attributs autorises : params.require(:article).permit(:titre, :contenu).',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-915', 'A01:2021', 'rails'],
        docs: 'https://guides.rubyonrails.org/action_controller_overview.html#strong-parameters',
      });
    }
  }
}

/**
 * ActiveRecord protege les requetes passees en parametres, mais pas les
 * chaines interpolees : `where("nom = '#{params[:q]}'")` est une injection.
 */
function verifierInjectionOrm(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /\.(where|find_by_sql|order|group|having|pluck|joins|select)\s*\(?\s*"[^"]*#\{[^}]*\}/g)) {
      report({
        ruleId: 'RAILS-SQL-INTERPOLATION',
        category: 'security',
        severity: 'critical',
        title: 'Interpolation dans une requete ActiveRecord',
        message:
          'La valeur est inseree directement dans le fragment SQL. ActiveRecord ne peut plus l\'echapper : c\'est une injection SQL.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion:
          'Passez la valeur en parametre : where("titre = ?", params[:titre]) ou where(titre: params[:titre]).',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-89', 'A03:2021', 'rails'],
        docs: 'https://guides.rubyonrails.org/security.html#sql-injection',
      });
    }
  }
}

/** `.html_safe` sur une chaine interpolee annule l'echappement de la vue. */
function verifierHtmlSafe(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /(?:"[^"]*#\{[^}]*\}[^"]*"|[\w.[\]]+)\s*\.html_safe\b|\braw\s*\(/g)) {
      const ligne = index.lineOf(match.index);
      report({
        ruleId: 'RAILS-HTML-SAFE',
        category: 'security',
        severity: 'high',
        title: 'Echappement de la vue contourne',
        message:
          'html_safe et raw() marquent la chaine comme sure sans rien verifier. Si elle contient une valeur saisie par un utilisateur, c\'est une faille XSS.',
        file: file.relativePath,
        line: ligne,
        snippet: index.textOfLine(ligne).trim(),
        suggestion:
          'Laissez Rails echapper la valeur. Si du HTML est reellement necessaire, assainissez-le : sanitize(contenu, tags: %w[p a strong]).',
        effort: 'moyen',
        confidence: 'firm',
        tags: ['CWE-79', 'rails'],
      });
    }
  }
}

/** master.key et credentials dechiffrent tous les secrets de l'application. */
function verifierSecretsVersionnes(context, report) {
  const sensibles = context.files.filter((f) =>
    /(^|\/)config\/(master\.key|credentials\/\w+\.key)$/.test(f.relativePath),
  );

  for (const file of sensibles) {
    const gitignore = context.file('.gitignore')?.content || '';
    if (/master\.key|\*\.key/.test(gitignore)) continue;

    report({
      ruleId: 'RAILS-MASTER-KEY-COMMITTED',
      category: 'security',
      severity: 'critical',
      title: 'Clef de dechiffrement Rails presente dans le depot',
      message: `${file.relativePath} dechiffre l'ensemble de vos credentials : cles d'API, acces base, jetons tiers. Sa presence dans le depot annule tout l'interet du chiffrement.`,
      file: file.relativePath,
      line: 1,
      suggestion:
        'Ajoutez config/master.key au .gitignore, retirez-le de l\'historique Git, puis regenerez les credentials : toutes les valeurs qu\'il protegeait sont a considerer comme compromises.',
      effort: 'moyen',
      confidence: 'certain',
      tags: ['CWE-798', 'rails'],
      docs: 'https://guides.rubyonrails.org/security.html#custom-credentials',
    });
  }
}
