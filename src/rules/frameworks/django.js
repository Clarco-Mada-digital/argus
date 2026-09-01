import { parseHtml } from '../../core/html.js';
import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Django.
 *
 * Ces verifications ne sont pas exprimables comme de simples motifs : elles
 * demandent de croiser plusieurs fichiers (un nom de route declare dans
 * urls.py et employe dans un gabarit) ou de raisonner sur l'absence d'un
 * element (un reglage de securite qui n'est nulle part).
 *
 * Chaque regle a ete validee contre un projet Django reel avant d'etre
 * ajoutee : une regle qui produit du bruit coute plus qu'elle ne rapporte.
 */
export default {
  id: 'django',
  label: 'Django',
  appliesTo: (context) => context.has('django'),

  run(context, report) {
    const settings = context.files.filter((f) => /(^|\/)settings(\/|\.py$)|settings\/\w+\.py$/.test(f.relativePath) && f.language === 'python');
    const templates = context.sources({ languages: ['html'] });
    const modeles = context.sources({ languages: ['python'] }).filter((f) => /models\.py$/.test(f.name) || /models\//.test(f.relativePath));

    verifierJetonCsrf(templates, report);
    verifierNomsDeRoutes(templates, context, report);
    verifierReglagesSecurite(settings, report);
    verifierCleSecrete(settings, report);
    verifierModeles(modeles, report);
  },
};

/**
 * Un formulaire POST sans {% csrf_token %} est rejete par Django en
 * production : c'est a la fois une faille de conception et un bug fonctionnel.
 */
function verifierJetonCsrf(templates, report) {
  for (const file of templates) {
    const contenu = file.content;
    if (!/\{%/.test(contenu)) continue; // pas un gabarit Django
    const index = lineIndexFor(file);

    for (const noeud of parseHtml(contenu).filter((n) => n.tag === 'form')) {
      const methode = (noeud.attr('method') || '').toLowerCase();
      if (methode !== 'post') continue;

      const corps = contenu.slice(noeud.start, noeud.closeStart ?? contenu.length);
      if (/\{%\s*csrf_token\s*%\}/.test(corps)) continue;

      report({
        ruleId: 'DJANGO-CSRF-TOKEN-MISSING',
        category: 'security',
        severity: 'high',
        title: 'Formulaire POST sans {% csrf_token %}',
        message:
          'Ce formulaire envoie une requete POST sans jeton CSRF. Django le refusera avec une erreur 403 : le formulaire est donc aussi casse fonctionnellement.',
        file: file.relativePath,
        line: index.lineOf(noeud.start),
        snippet: contenu.slice(noeud.start, noeud.end),
        suggestion: 'Ajoutez {% csrf_token %} comme premier element a l\'interieur de la balise <form>.',
        effort: 'rapide',
        confidence: 'firm',
        tags: ['CWE-352', 'django'],
        docs: 'https://docs.djangoproject.com/fr/stable/ref/csrf/',
      });
    }
  }
}

/**
 * `{% url 'nom' %}` renvoie vers un nom declare par `name=` dans urls.py.
 * Une faute de frappe leve NoReverseMatch a l'execution — jamais a la
 * construction, donc souvent decouverte par un visiteur.
 */
function verifierNomsDeRoutes(templates, context, report) {
  const nomsDeclares = new Set();
  const espacesDeNoms = new Set();

  for (const file of context.sources({ languages: ['python'] })) {
    for (const match of matches(file.content, /\bname\s*=\s*['"]([\w.-]+)['"]/g)) {
      nomsDeclares.add(match[1]);
    }
    for (const match of matches(file.content, /\bapp_name\s*=\s*['"](\w+)['"]/g)) {
      espacesDeNoms.add(match[1]);
    }
  }

  // Sans aucun nom declare, la verification n'a rien sur quoi s'appuyer.
  if (nomsDeclares.size === 0) return;

  const signales = new Set();
  for (const file of templates) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /\{%\s*url\s+['"]([\w.:-]+)['"]/g)) {
      const cible = match[1];
      // Un nom qualifie `espace:vue` : on ne verifie que la partie finale.
      const [prefixe, nom] = cible.includes(':') ? cible.split(':') : [null, cible];
      if (prefixe && !espacesDeNoms.has(prefixe) && !nomsDeclares.has(nom)) continue;
      if (nomsDeclares.has(nom)) continue;
      if (signales.has(cible)) continue;
      signales.add(cible);

      report({
        ruleId: 'DJANGO-URL-UNKNOWN',
        category: 'routes',
        severity: 'high',
        title: 'Nom de route inconnu dans un gabarit',
        message: `{% url '${cible}' %} ne correspond a aucun name= declare dans les urls.py du projet. Django levera NoReverseMatch au moment du rendu.`,
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0],
        suggestion: `Verifiez l'orthographe du nom, ou ajoutez name='${nom}' a la route correspondante dans urls.py.`,
        effort: 'rapide',
        confidence: 'firm',
        tags: ['django'],
      });
    }
  }
}

/** Reglages de durcissement que Django n'active pas par defaut. */
const REGLAGES_ATTENDUS = [
  ['SECURE_SSL_REDIRECT', 'redirige automatiquement le HTTP vers le HTTPS', 'SECURE_SSL_REDIRECT = True'],
  ['SECURE_HSTS_SECONDS', 'demande au navigateur de n\'utiliser que le HTTPS', 'SECURE_HSTS_SECONDS = 31536000'],
  ['X_FRAME_OPTIONS', 'empeche l\'affichage du site dans une iframe (clickjacking)', 'X_FRAME_OPTIONS = "DENY"'],
  ['SECURE_CONTENT_TYPE_NOSNIFF', 'empeche le navigateur de deviner le type des fichiers', 'SECURE_CONTENT_TYPE_NOSNIFF = True'],
];

function verifierReglagesSecurite(settings, report) {
  if (settings.length === 0) return;
  const contenu = settings.map((f) => f.content).join('\n');
  const manquants = REGLAGES_ATTENDUS.filter(([nom]) => !new RegExp(`\\b${nom}\\s*=`).test(contenu));
  if (manquants.length === 0) return;

  report({
    ruleId: 'DJANGO-HARDENING-MISSING',
    category: 'security',
    severity: manquants.length >= 3 ? 'medium' : 'low',
    title: 'Reglages de durcissement Django absents',
    message: `${manquants.length} reglage(s) de securite ne sont definis nulle part : ${manquants.map(([n]) => n).join(', ')}. Django ne les active pas par defaut.`,
    file: settings[0].relativePath,
    line: 1,
    suggestion:
      `Ajoutez a settings.py, en les conditionnant a la production :\n${manquants.map(([, role, exemple]) => `  ${exemple}  # ${role}`).join('\n')}\nPuis verifiez le tout avec : python manage.py check --deploy`,
    effort: 'rapide',
    tags: ['django', 'A05:2021'],
    docs: 'https://docs.djangoproject.com/fr/stable/howto/deployment/checklist/',
  });
}

/** La clef secrete signe les sessions et les jetons : elle ne doit pas etre en dur. */
function verifierCleSecrete(settings, report) {
  for (const file of settings) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /^[ \t]*SECRET_KEY\s*=\s*(.+)$/gm)) {
      const valeur = match[1].trim();
      if (/os\.environ|getenv|env\(|config\(|Path\(|decouple/.test(valeur)) continue;
      if (!/^['"]/.test(valeur)) continue;

      report({
        ruleId: 'DJANGO-SECRET-KEY-HARDCODED',
        category: 'security',
        severity: 'critical',
        title: 'SECRET_KEY ecrite en dur',
        message:
          'La clef secrete signe les cookies de session, les jetons de reinitialisation de mot de passe et les messages. Versionnee, elle permet de forger une session d\'administrateur.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        suggestion:
          'Lisez-la depuis l\'environnement : SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]. Puis regenerez-la — celle-ci est a considerer comme compromise.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-798', 'django'],
      });
    }
  }
}

function verifierModeles(modeles, report) {
  for (const file of modeles) {
    const index = lineIndexFor(file);
    const lignes = file.lines;

    for (const match of matches(file.content, /^class\s+(\w+)\s*\(\s*(?:models\.)?Model\s*\)\s*:/gm)) {
      const debutLigne = index.lineOf(match.index);
      // Le corps de la classe court jusqu'a la prochaine declaration au meme niveau.
      let fin = debutLigne;
      while (fin < lignes.length && !/^\S/.test(lignes[fin] || '')) fin++;
      const corps = lignes.slice(debutLigne, fin).join('\n');

      if (!/def\s+__str__\s*\(/.test(corps)) {
        report({
          ruleId: 'DJANGO-MODEL-NO-STR',
          category: 'quality',
          severity: 'low',
          title: `Modele ${match[1]} sans __str__`,
          message: `Sans methode __str__, l'administration Django et les journaux affichent « ${match[1]} object (1) » au lieu d'une valeur reconnaissable.`,
          file: file.relativePath,
          line: debutLigne,
          snippet: match[0],
          suggestion: `Ajoutez :\n    def __str__(self):\n        return self.titre  # ou tout champ identifiant`,
          effort: 'rapide',
          tags: ['django'],
        });
      }

      for (const champ of matches(corps, /^[ \t]*(\w+)\s*=\s*models\.(CharField|TextField|SlugField|EmailField|URLField)\([^)]*null\s*=\s*True/gm)) {
        report({
          ruleId: 'DJANGO-CHARFIELD-NULL',
          category: 'quality',
          severity: 'low',
          title: 'null=True sur un champ texte',
          message: `Le champ « ${champ[1]} » peut valoir NULL *et* la chaine vide : deux facons de representer « pas de valeur », que vos requetes devront gerer separement.`,
          file: file.relativePath,
          line: debutLigne + corps.slice(0, champ.index).split('\n').length - 1,
          snippet: champ[0].trim(),
          suggestion: 'Sur un champ texte, utilisez blank=True seul et laissez null a False : l\'absence de valeur est representee par "".',
          effort: 'rapide',
          confidence: 'firm',
          tags: ['django'],
          docs: 'https://docs.djangoproject.com/fr/stable/ref/models/fields/#null',
        });
      }
    }
  }
}
