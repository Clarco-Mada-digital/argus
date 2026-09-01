import { parseHtml } from '../../core/html.js';
import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Laravel.
 *
 * Meme principe que le pack Django : uniquement ce qu'un motif isole ne peut
 * pas exprimer, et uniquement ce qui a ete valide contre un projet reel.
 */
export default {
  id: 'laravel',
  label: 'Laravel',
  appliesTo: (context) => context.has('laravel'),

  run(context, report) {
    const vues = context.sources({ languages: ['blade'] });
    const php = context.sources({ languages: ['php'] });
    const modeles = php.filter((f) => /(^|\/)app\/Models\//.test(f.relativePath) || /extends\s+(Model|Authenticatable)\b/.test(f.content));

    verifierJetonCsrf(vues, report);
    verifierEnvHorsConfig(php, report);
    verifierAffectationDeMasse(modeles, report);
    verifierChampsCaches(modeles, report);
  },
};

/**
 * Laravel rejette toute requete POST sans jeton CSRF (erreur 419).
 * Un formulaire sans @csrf est donc casse, en plus d'etre vulnerable.
 */
function verifierJetonCsrf(vues, report) {
  for (const file of vues) {
    const contenu = file.content;
    const index = lineIndexFor(file);

    for (const noeud of parseHtml(contenu).filter((n) => n.tag === 'form')) {
      const methode = (noeud.attr('method') || '').toLowerCase();
      if (methode !== 'post') continue;

      const corps = contenu.slice(noeud.start, noeud.closeStart ?? contenu.length);
      // `@csrf` ou l'ecriture longue `<input name="_token">`.
      if (/@csrf\b|csrf_field\s*\(|name\s*=\s*["']_token["']/.test(corps)) continue;

      report({
        ruleId: 'LARAVEL-CSRF-MISSING',
        category: 'security',
        severity: 'high',
        title: 'Formulaire POST sans @csrf',
        message:
          'Laravel refusera cette requete avec une erreur 419 (Page Expired) : le formulaire est casse fonctionnellement, en plus d\'etre expose au CSRF.',
        file: file.relativePath,
        line: index.lineOf(noeud.start),
        snippet: contenu.slice(noeud.start, noeud.end),
        suggestion: 'Ajoutez @csrf comme premiere ligne a l\'interieur de la balise <form>.',
        effort: 'rapide',
        confidence: 'firm',
        tags: ['CWE-352', 'laravel'],
        docs: 'https://laravel.com/docs/csrf',
      });
    }
  }
}

/**
 * `env()` ne fonctionne que tant que la configuration n'est pas mise en cache.
 * Apres `php artisan config:cache` — pratique standard en production — tout
 * appel a env() hors des fichiers de config renvoie null, silencieusement.
 */
function verifierEnvHorsConfig(php, report) {
  for (const file of php) {
    if (/(^|\/)config\//.test(file.relativePath)) continue;
    const index = lineIndexFor(file);
    let premiere = null;
    let total = 0;

    for (const match of matches(file.content, /(?<![\w>$])env\s*\(\s*['"]/g)) {
      total++;
      if (premiere === null) premiere = match.index;
    }
    if (total === 0) continue;

    report({
      ruleId: 'LARAVEL-ENV-OUTSIDE-CONFIG',
      category: 'quality',
      severity: 'high',
      title: 'Appel a env() hors d\'un fichier de configuration',
      message: `${total} appel(s) a env() dans ce fichier. Des que la configuration est mise en cache (php artisan config:cache, standard en production), env() renvoie null — sans erreur, sans avertissement.`,
      file: file.relativePath,
      line: index.lineOf(premiere),
      snippet: index.textOfLine(index.lineOf(premiere)).trim(),
      suggestion:
        'Declarez la valeur dans config/services.php (ou un autre fichier de config), puis lisez-la avec config("services.stripe.key"). env() ne doit apparaitre que dans config/.',
      effort: 'rapide',
      confidence: 'certain',
      tags: ['laravel'],
      docs: 'https://laravel.com/docs/configuration#configuration-caching',
    });
  }
}

/** `$guarded = []` desactive toute protection contre l'affectation de masse. */
function verifierAffectationDeMasse(modeles, report) {
  for (const file of modeles) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /\$guarded\s*=\s*\[\s*\]/g)) {
      report({
        ruleId: 'LARAVEL-GUARDED-EMPTY',
        category: 'security',
        severity: 'high',
        title: 'Protection d\'affectation de masse desactivee',
        message:
          '$guarded = [] autorise l\'ecriture de n\'importe quel champ depuis une requete. Un client peut alors forcer is_admin, role ou prix via un simple champ de formulaire.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0],
        suggestion:
          'Remplacez par $fillable = ["nom", "email", …] en n\'y listant que les champs qu\'un utilisateur a le droit de modifier.',
        effort: 'moyen',
        confidence: 'certain',
        tags: ['CWE-915', 'A01:2021', 'laravel'],
        docs: 'https://laravel.com/docs/eloquent#mass-assignment',
      });
    }
  }
}

/** Un champ sensible dans $fillable sans $hidden fuite dans les reponses JSON. */
const CHAMPS_SENSIBLES = /(password|mot_de_passe|remember_token|api_token|secret|two_factor)/i;

function verifierChampsCaches(modeles, report) {
  for (const file of modeles) {
    const index = lineIndexFor(file);
    const match = /\$fillable\s*=\s*\[([^\]]*)\]/.exec(file.content);
    if (!match) continue;
    if (!CHAMPS_SENSIBLES.test(match[1])) continue;
    if (/\$hidden\s*=\s*\[/.test(file.content)) continue;

    const sensibles = match[1].split(',').map((c) => c.trim().replace(/['"]/g, '')).filter((c) => CHAMPS_SENSIBLES.test(c));

    report({
      ruleId: 'LARAVEL-MODEL-NO-HIDDEN',
      category: 'security',
      severity: 'high',
      title: 'Champ sensible non masque dans les reponses',
      message: `Le modele expose ${sensibles.join(', ')} sans declarer $hidden. Toute serialisation JSON du modele — reponse d'API, retour de route, journal — inclura ce champ.`,
      file: file.relativePath,
      line: index.lineOf(match.index),
      snippet: match[0].slice(0, 120),
      suggestion: `Ajoutez : protected $hidden = [${sensibles.map((c) => `'${c}'`).join(', ')}];`,
      effort: 'rapide',
      confidence: 'firm',
      tags: ['CWE-359', 'laravel'],
    });
  }
}
