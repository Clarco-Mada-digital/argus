import { SECURITY_RULES, CONFIG_SECURITY_RULES } from '../rules/security.js';
import { detectSecrets, redact } from '../rules/secrets.js';
import { lineIndexFor, maskedSource, matches } from '../core/scan.js';

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

function scanPatterns(file, context, report, cache) {
  if (DOCUMENTATION_LANGUAGES.has(file.language)) return;
  const family = file.family;
  const rules = applicableRules(family, cache);
  if (rules.length === 0) return;

  const raw = file.content;
  const masked = maskedSource(file);
  const index = lineIndexFor(file);

  for (const rule of rules) {
    const haystack = rule.raw ? raw : masked;
    // Les motifs sur code masque perdent les chaines : on retombe sur le brut
    // quand la regle cible explicitement des litteraux.
    for (const match of matches(haystack, rule.pattern)) {
      const position = index.position(match.index);
      const lineText = index.textOfLine(position.line);
      if (rule.ignoreIf && rule.ignoreIf(lineText, file)) continue;
      if (isSuppressed(index, position.line)) continue;

      report({
        ruleId: rule.id,
        severity: adjustSeverity(rule, file),
        title: rule.title,
        message: rule.message,
        file: file.relativePath,
        line: position.line,
        column: position.column,
        snippet: lineText,
        suggestion: rule.suggestion,
        confidence: file.isTest ? 'tentative' : rule.confidence || 'firm',
        effort: rule.effort || 'rapide',
        docs: rule.cwe ? `https://cwe.mitre.org/data/definitions/${rule.cwe.replace('CWE-', '')}.html` : null,
        tags: [rule.cwe, rule.owasp].filter(Boolean),
        data: { cwe: rule.cwe, owasp: rule.owasp },
      });
    }
  }
}

/** Un fichier de test ou un exemple abaisse la severite d'un cran. */
function adjustSeverity(rule, file) {
  if (!file.isTest && !/\b(example|sample|demo|mock|fixture)/i.test(file.relativePath)) return rule.severity;
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const next = order[Math.min(order.length - 1, order.indexOf(rule.severity) + 1)];
  return next;
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

      const severity = isExampleFile || file.isTest ? downgrade(secret.severity) : secret.severity;
      report({
        ruleId: `SEC-SECRET-${secret.kind.toUpperCase()}`,
        severity,
        title: `Secret expose : ${secret.label}`,
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
  const isWebApp = context.has('express', 'fastify', 'koa', 'nestjs', 'nextjs', 'nuxt', 'django', 'flask', 'fastapi', 'laravel', 'spring', 'rails', 'static-site');

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
