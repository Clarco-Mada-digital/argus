import { SECURITY_RULES, CONFIG_SECURITY_RULES } from '../rules/security.js';
import { detectSecrets, redact } from '../rules/secrets.js';
import { dansUnCommentaire, lineIndexFor, maskedSource, matches } from '../core/scan.js';
import { analyserPortees, ORIGINES } from '../lang/js/portees.js';
import { analyserPortees as analyserPorteesPython } from '../lang/python/portees.js';
import { t } from '../i18n/index.js';

/**
 * Analyseur de securite : motifs dangereux, secrets, configuration.
 * Deux passes : une par fichier (motifs + secrets), une globale (projet).
 */
export default {
  id: 'security',
  category: 'security',
  label: 'Analyse de securite',
  order: 10,

  async run(context, report) {
    const files = context.sources({ includeTests: true });
    const rulesByFamily = new Map();

    for (const file of files) {
      if (!file.readable || file.isGenerated || file.isVendored) continue;
      scanSecrets(file, context, report);
      scanPatterns(file, context, report, rulesByFamily);
    }

    scanConfigFiles(context, report);
    scanProjectLevel(context, report);
  },
};

function applicableRules(family, cache) {
  if (!cache.has(family)) {
    cache.set(
      family,
      SECURITY_RULES.filter(
        (rule) => !rule.scope && (rule.families.includes('*') || rule.families.includes(family)),
      ),
    );
  }
  return cache.get(family);
}

/**
 * Langages « documentaires » : on y cherche des secrets (un fichier README
 * peut en contenir un vrai) mais pas des motifs de code — un extrait
 * d'exemple dans une documentation n'est pas une vulnerabilite.
 */
const DOCUMENTATION_LANGUAGES = new Set(['markdown', 'text', 'unknown', 'json']);

/**
 * Plages occupees par des exemples de code dans une page : `<code>` et `<pre>`.
 * Un article qui explique une vulnerabilite en montre le motif — le signaler
 * reviendrait a punir la documentation.
 */
function plagesDExemples(file) {
  if (file.family !== 'markup') return [];
  const plages = [];
  for (const match of matches(file.content, /<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/gi)) {
    plages.push([match.index, match.index + match[0].length]);
  }
  return plages;
}

function scanPatterns(file, context, report, cache) {
  if (DOCUMENTATION_LANGUAGES.has(file.language)) return;
  const family = file.family;
  const rules = applicableRules(family, cache);
  if (rules.length === 0) return;

  const raw = file.content;
  const masked = maskedSource(file);
  const index = lineIndexFor(file);
  const exemples = plagesDExemples(file);
  const estUnExemple = (offset) => exemples.some(([debut, fin]) => offset >= debut && offset < fin);

  for (const rule of rules) {
    const haystack = rule.raw ? raw : masked;
    // Les motifs sur code masque perdent les chaines : on retombe sur le brut
    // quand la regle cible explicitement des litteraux.
    for (const match of matches(haystack, rule.pattern)) {
      if (estUnExemple(match.index)) continue;
      // Une adresse citee dans un commentaire est de la documentation, pas un
      // appel. Sur une bibliotheque HTTP, cela representait la moitie des
      // constats — et les regles `raw` lisent le code d'origine, commentaires
      // compris.
      if (rule.raw && dansUnCommentaire(file, match.index)) continue;
      const position = index.position(match.index);
      const lineText = index.textOfLine(position.line);
      if (rule.ignoreIf && rule.ignoreIf(lineText, file)) continue;
      if (isSuppressed(index, position.line)) continue;

      const flux = rule.fluxDeDonnees
        ? graduerParLeFlux(file, rule, match, index, position)
        : {};
      if (flux === null) continue; // toutes les valeurs sont litterales

      const usage = rule.graduerParLUsage
        ? rule.graduerParLUsage({ ligne: lineText, contexte: contexteDeclaratif(index, position) }) || {}
        : {};

      report({
        ruleId: rule.id,
        severity: usage.severity || adjustSeverity(rule, file),
        title: rule.title,
        message: usage.message || flux.message || rule.message,
        file: file.relativePath,
        line: position.line,
        column: position.column,
        snippet: lineText,
        suggestion: usage.suggestion || rule.suggestion,
        confidence: file.isTest ? 'tentative' : flux.confidence || rule.confidence || 'firm',
        effort: rule.effort || 'rapide',
        docs: rule.cwe ? `https://cwe.mitre.org/data/definitions/${rule.cwe.replace('CWE-', '')}.html` : null,
        tags: [rule.cwe, rule.owasp].filter(Boolean),
        data: { cwe: rule.cwe, owasp: rule.owasp },
      });
    }
  }
}

/**
 * Le voisinage declaratif d'une ligne, pour juger de l'intention.
 *
 * Certains motifs ne sont un defaut que selon l'usage qu'on en fait. MD5
 * calculant une empreinte de cache et MD5 hachant un mot de passe s'ecrivent
 * pareil ; ce qui les separe est le nom de la fonction qui les contient et le
 * commentaire qui l'annonce — jamais la ligne elle-meme.
 *
 * On remonte jusqu'a la declaration englobante, en gardant ce qui la precede
 * immediatement : une docstring ou un commentaire y dit souvent l'intention
 * plus clairement que le code.
 */
const DECLARATION = /^\s*(?:async\s+)?(?:def|function|class|const|let|var|public|private|func|fn|sub)\b|^\s*[\w.$]+\s*[:=]\s*(?:async\s+)?(?:function|\()/;

function contexteDeclaratif(index, position, portee = 14) {
  const morceaux = [index.textOfLine(position.line)];

  for (let ligne = position.line - 1; ligne > 0 && position.line - ligne <= portee; ligne--) {
    const texte = index.textOfLine(ligne);
    morceaux.push(texte);
    if (DECLARATION.test(texte)) {
      // Le commentaire d'intention precede la signature. On ne prend que des
      // commentaires : du code, a cet endroit, appartient a la declaration
      // *precedente* et parlerait d'autre chose.
      for (let k = 1; k <= 3; k++) {
        const avant = index.textOfLine(ligne - k);
        if (!/^\s*(?:\/\/|\/\*|\*|#)/.test(avant)) break;
        morceaux.push(avant);
      }
      break;
    }
  }

  // En Python la docstring suit la signature. On s'arrete a la declaration
  // suivante : sa signature parle d'une autre intention que celle-ci, et la
  // laisser entrer inversait le verdict — un calcul d'etag heritait du
  // « mot_de_passe » de la fonction d'apres.
  for (let k = 1; k <= 3; k++) {
    const apres = index.textOfLine(position.line + k);
    if (DECLARATION.test(apres)) break;
    morceaux.push(apres);
  }

  return morceaux.filter(Boolean).join('\n');
}

/**
 * Portees d'un fichier, calculees une fois.
 *
 * L'analyse coute un balayage de jetons : on la reserve aux fichiers ou une
 * regle sensible au flux a effectivement declenche.
 */
const PORTEES = new WeakMap();

function porteesDe(file) {
  if (!PORTEES.has(file)) {
    try {
      const analyser = file.family === 'python' ? analyserPorteesPython : analyserPortees;
      PORTEES.set(file, analyser(file.content));
    } catch {
      // Une source que le lexeur ne sait pas lire ne doit pas faire echouer
      // l'analyse : on retombe simplement sur le comportement lexical.
      PORTEES.set(file, null);
    }
  }
  return PORTEES.get(file);
}

/**
 * Gradue un constat d'injection selon l'origine des valeurs concatenees.
 *
 * Le motif seul ne distingue pas `req.query.id` d'une constante du module.
 * Les deux produisaient un constat critique ; le second est un faux positif,
 * et les faux positifs critiques sont ceux qui coutent le plus cher — ce sont
 * eux qui poussent a ignorer la categorie entiere.
 *
 * Retourne `null` quand toutes les valeurs sont litterales : il n'y a alors
 * rien a signaler.
 */
function graduerParLeFlux(file, rule, match, index, position) {
  if (file.family !== 'js' && file.family !== 'python') return {};
  const portees = porteesDe(file);
  if (!portees) return {};

  // Le motif d'injection est paresseux : il s'arrete au premier signe de
  // concatenation et tronque l'identifiant. On elargit donc a l'instruction.
  //
  // Pour une affectation, seul le cote droit compte : `btn.innerHTML = '<i>'`
  // n'expose rien, mais lire toute la ligne y voyait `btn` — un parametre —
  // et concluait a un risque. Sur un projet reel, c'etait la totalite des
  // constats de cette regle.
  const masqueComplet = maskedSource(file);
  const finDeLigne = (() => {
    const saut = masqueComplet.indexOf('\n', match.index);
    return saut === -1 ? masqueComplet.length : saut;
  })();
  const affectation = /[^=!<>]=(?![=>])/.exec(masqueComplet.slice(match.index, finDeLigne));
  const debut = affectation ? match.index + affectation.index + affectation[0].length : match.index;
  const finInstruction = (() => {
    for (let i = debut; i < file.content.length; i++) {
      const c = file.content[i];
      if (c === ';' || c === '\n') return i;
    }
    return file.content.length;
  })();

  // Les identifiants sont cherches dans le code *masque* : les mots-cles SQL
  // vivent a l'interieur de la chaine et ne doivent pas etre resolus.
  const masque = masqueComplet.slice(debut, finInstruction);
  const identifiants = [];
  for (const m of matches(masque, /(?<![.\w$])[A-Za-z_$][\w$]*/g)) {
    identifiants.push({ nom: m[0], offset: debut + m.index });
  }
  // Aucun identifiant dans la valeur affectee, alors que le code d'origine y
  // contient quelque chose : c'est une expression purement litterale. Le
  // masquage remplace les chaines par des espaces, il faut donc interroger le
  // brut — sinon on confond « litteral » et « rien a dire ».
  //
  // C'est une conclusion, pas une absence de conclusion :
  // `btn.innerHTML = '<i class="..."></i>'` n'expose rien.
  if (identifiants.length === 0) {
    const brut = file.content.slice(debut, finInstruction).trim().replace(/^[;,)}\]]+|[;,)}\]]+$/g, '');
    return brut.length > 0 ? null : {};
  }

  const origines = identifiants
    .map(({ nom, offset }) => {
      const liaison = portees.resoudre(nom, offset);
      return liaison ? portees.origine(nom, offset) : null;
    })
    .filter(Boolean);

  if (origines.length === 0) return {};
  if (origines.every((o) => o === ORIGINES.litteral)) return null;

  if (origines.includes(ORIGINES.externe)) {
    return {
      confidence: 'firm',
      message: `${rule.message} La valeur provient d'une entree externe (requete, environnement ou URL) : le chemin est complet.`,
    };
  }

  if (origines.includes(ORIGINES.parametre)) {
    return {
      confidence: 'tentative',
      message: `${rule.message} La valeur est un parametre de fonction : verifiez ce que transmettent les appelants.`,
    };
  }

  return {};
}

/**
 * Un fichier de test ou un exemple abaisse la severite.
 *
 * Deux crans pour un fichier de test, un seul pour un exemple. La raison est
 * qu'un test de securite *doit* contenir le motif qu'il verifie : c'est sa
 * donnee d'entree. Le signaler au meme rang qu'en production revient a punir
 * les equipes qui testent leur securite — l'incitation exacte a ne pas le
 * faire. Le constat reste visible en `info`, jamais compte comme un probleme.
 */
function adjustSeverity(rule, file) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const rang = order.indexOf(rule.severity);

  if (file.isTest) return order[Math.min(order.length - 1, rang + 2)];
  if (/\b(example|sample|demo|mock|fixture)/i.test(file.relativePath)) {
    return order[Math.min(order.length - 1, rang + 1)];
  }
  return rule.severity;
}

/** Prise en charge des commentaires `argus-disable-next-line` / `argus-ignore`. */
function isSuppressed(index, line) {
  const current = index.textOfLine(line);
  if (/argus-(ignore|disable)\b/.test(current)) return true;
  const previous = line > 1 ? index.textOfLine(line - 1) : '';
  return /argus-disable-next-line/.test(previous);
}

function scanSecrets(file, context, report) {
  if (file.image || !file.readable) return;
  if (/\.(lock|snap)$/.test(file.name)) return;

  const isExampleFile = /(^|[./-])(example|sample|template|dist)(\.|$)/i.test(file.name);
  const index = lineIndexFor(file);
  const lines = file.lines;
  const seenValues = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    const found = detectSecrets(line, { allowTests: file.isTest, unquoted: estFichierDeConfiguration(file) });

    for (const secret of found) {
      if (seenValues.has(secret.match)) continue;
      seenValues.add(secret.match);
      if (isSuppressed(index, i + 1)) continue;

      const severity = graviteDuSecret(secret, file, isExampleFile);
      report({
        ruleId: `SEC-SECRET-${secret.kind.toUpperCase()}`,
        severity,
        // Le libelle a sa propre clef : sinon le titre serait traduit et
        // son complement resterait en francais, ce qui se voit plus qu'un
        // titre entierement dans l'autre langue.
        title: t('constat.secretExpose', { libelle: t(`secret.${secret.kind}`) }),
        message: `Une valeur sensible (${secret.label}, entropie ${secret.entropy}) est ecrite en dur dans le code : ${redact(secret.match)}`,
        file: file.relativePath,
        line: i + 1,
        column: secret.index + 1,
        snippet: line.replace(secret.match, redact(secret.match)).trim(),
        suggestion:
          'Sortez la valeur du code (variable d\'environnement ou gestionnaire de secrets), puis revoquez et faites tourner la clef : elle doit etre consideree comme compromise des lors qu\'elle a ete versionnee.',
        confidence: secret.confidence,
        effort: 'rapide',
        tags: ['CWE-798', 'A07:2021'],
        data: { kind: secret.kind, entropy: secret.entropy },
        docs: 'https://cwe.mitre.org/data/definitions/798.html',
      });
    }
  }
}

/** Formats de configuration ou les valeurs s'ecrivent sans guillemets. */
function estFichierDeConfiguration(file) {
  return (
    ['dotenv', 'yaml', 'toml'].includes(file.language) ||
    /\.(properties|ini|cfg|conf|env|editorconfig)$/i.test(file.name) ||
    /^(application|bootstrap)[\w.-]*\.(properties|ya?ml)$/i.test(file.name)
  );
}

/**
 * Gravite d'un secret selon l'endroit ou il se trouve.
 *
 * Deux natures de secret, deux traitements.
 *
 * Un identifiant **emis par un fournisseur** — clef Stripe, jeton GitHub,
 * clef AWS — est une vraie fuite ou qu'il soit. Le trouver dans un test ne le
 * rend pas moins valable : il ouvre le meme compte. Un seul cran de moins.
 *
 * Un secret **engendre par le projet** — certificat auto-signe, clef privee de
 * test, URL locale — est du materiel de fixture. Une bibliotheque HTTP
 * versionne des certificats expires *pour tester les certificats expires* ;
 * les signaler au rang le plus grave condamne le projet a n'etre jamais
 * propre, et apprend a ignorer la categorie.
 */
const SECRETS_DE_FOURNISSEUR = new Set([
  'aws-access-key', 'aws-secret', 'github-token', 'gitlab-token', 'slack-token',
  'stripe-key', 'google-api-key', 'firebase-key', 'openai-key', 'anthropic-key',
  'sendgrid-key', 'twilio-sid', 'mailgun-key', 'npm-token',
]);

function graviteDuSecret(secret, file, isExampleFile) {
  if (!file.isTest && !isExampleFile) return secret.severity;
  if (SECRETS_DE_FOURNISSEUR.has(secret.kind)) return downgrade(secret.severity);
  return downgrade(downgrade(secret.severity));
}

function downgrade(severity) {
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  return order[Math.min(order.length - 1, order.indexOf(severity) + 1)];
}

function scanConfigFiles(context, report) {
  for (const rule of CONFIG_SECURITY_RULES) {
    if (rule.scope === 'project') continue;
    for (const file of context.files) {
      if (!file.readable || !rule.files.test(file.relativePath)) continue;
      if (rule.exclude && rule.exclude.test(file.relativePath)) continue;
      const content = file.content;
      let line = 1;

      if (rule.pattern) {
        const match = rule.pattern.exec(content);
        if (!match) continue;
        line = content.slice(0, match.index).split('\n').length;
      } else if (rule.check && !rule.check(content, file)) {
        continue;
      }

      report({
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        message: rule.message,
        file: file.relativePath,
        line,
        suggestion: rule.suggestion,
        effort: 'rapide',
        tags: [rule.cwe].filter(Boolean),
      });
    }
  }
}

/** Verifications transverses : en-tetes de securite, .gitignore, HTTPS. */
function scanProjectLevel(context, report) {
  const allSource = context
    .sources({ includeTests: false })
    .map((f) => f.content)
    .join('\n');

  const headerSignals = /helmet|Content-Security-Policy|Strict-Transport-Security|X-Frame-Options|SecurityMiddleware|secure_headers|add_header\s+X-|SECURE_HSTS_SECONDS|@fastify\/helmet/i;
  // Des en-tetes de securite HTTP supposent un serveur HTTP. Une application
  // Electron ou React Native n'en sert aucun : le constat y etait vide de sens.
  const isWebApp =
    context.cible('web') &&
    context.has('express', 'fastify', 'koa', 'nestjs', 'nextjs', 'nuxt', 'django', 'flask', 'fastapi', 'laravel', 'spring', 'rails', 'static-site');

  if (isWebApp && !headerSignals.test(allSource)) {
    const rule = CONFIG_SECURITY_RULES.find((r) => r.id === 'SEC-MISSING-HEADERS');
    report({
      ruleId: rule.id,
      severity: rule.severity,
      title: rule.title,
      message: rule.message,
      file: context.manifests['package.json']?.file.relativePath || null,
      suggestion: rule.suggestion,
      effort: 'rapide',
      tags: [rule.cwe, rule.owasp],
      docs: 'https://owasp.org/www-project-secure-headers/',
    });
  }

  const gitignore = context.file('.gitignore');
  if (gitignore) {
    const content = gitignore.content;
    const missing = ['.env', 'node_modules', '*.pem', '*.key'].filter(
      (entry) => !content.includes(entry.replace('*', '')),
    );
    if (missing.includes('.env')) {
      report({
        ruleId: 'SEC-GITIGNORE-ENV',
        severity: 'medium',
        title: '.env absent du .gitignore',
        message: 'Le fichier .gitignore ne protege pas les fichiers d\'environnement.',
        file: '.gitignore',
        line: 1,
        suggestion: 'Ajoutez `.env` et `.env.*` (sauf `.env.example`) au .gitignore.',
        effort: 'rapide',
      });
    }
  } else if (context.files.length > 20) {
    report({
      ruleId: 'SEC-NO-GITIGNORE',
      severity: 'low',
      title: 'Aucun .gitignore',
      message: 'Le projet n\'a pas de .gitignore : risque de versionner secrets, dependances et artefacts de build.',
      suggestion: 'Creez un .gitignore adapte a votre stack (voir github/gitignore).',
      effort: 'rapide',
    });
  }

  // Dependances installees mais absentes de tout import : surface inutile.
  const dependencyFiles = context.files.filter((f) => f.name === 'package.json' && f.relativePath.includes('node_modules'));
  if (dependencyFiles.length > 0) {
    report({
      ruleId: 'SEC-VENDOR-COMMITTED',
      severity: 'low',
      title: 'Dependances versionnees',
      message: 'Des dependances installees semblent presentes dans le depot.',
      suggestion: 'Ignorez node_modules/ et reinstallez a partir du lockfile.',
      effort: 'rapide',
    });
  }
}
