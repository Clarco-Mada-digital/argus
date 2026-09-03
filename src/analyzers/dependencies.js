import fs from 'node:fs';
import path from 'node:path';
import { readCache, cacheIsStale, findVulnerabilities } from '../core/osv.js';
import { resolveInstalledVersions } from '../core/lockfiles.js';
import { compareVersions } from '../core/semver.js';
import { t } from '../i18n/index.js';

/**
 * Analyseur de dependances : versions non epinglees, paquets abandonnes ou
 * connus comme vulnerables, dependances declarees mais jamais importees,
 * et coherence du fichier de verrouillage.
 *
 * Source des vulnerabilites, par ordre de fiabilite decroissante :
 *   1. le cache OSV.dev produit par `argus sync` (base officielle, versions
 *      exactes issues du fichier de verrouillage) ;
 *   2. un rapport `npm audit --json` depose dans .argus/npm-audit.json ;
 *   3. a defaut, une courte liste locale de secours, explicitement signalee
 *      comme telle dans le rapport.
 *
 * L'analyse elle-meme reste toujours hors ligne : seule la commande `sync`
 * accede au reseau.
 */

/** Paquets abandonnes ou remplaces, avec la migration recommandee. */
const DEPRECATED_PACKAGES = {
  request: 'Non maintenu depuis 2020. Utilisez fetch (natif) ou undici.',
  'node-sass': 'Deprecie. Remplacez par sass (Dart Sass).',
  moment: 'En mode maintenance. Preferez date-fns, day.js ou Temporal.',
  tslint: 'Remplace par ESLint avec @typescript-eslint.',
  'left-pad': 'Utilisez String.prototype.padStart.',
  bower: 'Obsolete. Utilisez npm/pnpm.',
  gulp: 'Ecosysteme en declin ; les outils modernes (Vite, esbuild) couvrent ces besoins.',
  istanbul: 'Remplace par nyc / c8.',
  'babel-eslint': 'Remplace par @babel/eslint-parser.',
  querystring: 'Deprecie en Node. Utilisez URLSearchParams.',
  'core-js@2': 'Version obsolete de core-js.',
  faker: 'Le paquet original a ete sabote. Utilisez @faker-js/faker.',
  colors: 'Le paquet a ete sabote en 2022. Utilisez chalk ou picocolors.',
  'event-stream': 'A heberge une backdoor. A eviter.',
  vue2: 'Vue 2 est en fin de vie depuis fin 2023.',
};

/**
 * Liste de secours, utilisee uniquement si aucun cache OSV n'existe.
 * Volontairement courte et generaliste : elle ne pretend pas etre exhaustive
 * ni parfaitement a jour. Lancez `argus sync` pour la remplacer par la base
 * officielle OSV.dev.
 */
const FALLBACK_VULNERABLE = [
  { name: 'lodash', below: '4.17.21', note: 'Pollution de prototype (CVE-2021-23337).' },
  { name: 'axios', below: '1.6.0', note: 'SSRF et fuite de credentials sur redirection.' },
  { name: 'minimist', below: '1.2.6', note: 'Pollution de prototype (CVE-2021-44906).' },
  { name: 'node-fetch', below: '2.6.7', note: 'Fuite d\'en-tetes lors des redirections.' },
  { name: 'express', below: '4.19.2', note: 'Redirection ouverte dans express.static.' },
  { name: 'next', below: '14.2.10', note: 'Plusieurs correctifs de securite du middleware.' },
  { name: 'vite', below: '5.4.6', note: 'Contournement de restriction du serveur de dev.' },
  { name: 'ws', below: '8.17.1', note: 'Deni de service par en-tetes HTTP.' },
  { name: 'tar', below: '6.2.1', note: 'Traversee de chemin a l\'extraction.' },
  { name: 'braces', below: '3.0.3', note: 'Deni de service par expansion.' },
  { name: 'jsonwebtoken', below: '9.0.0', note: 'Verification de signature contournable.' },
  { name: 'semver', below: '7.5.2', note: 'ReDoS.' },
  { name: 'django', below: '4.2.11', note: 'Plusieurs correctifs de securite.' },
  { name: 'flask', below: '2.3.2', note: 'Fuite de cookie de session.' },
  { name: 'requests', below: '2.32.0', note: 'Fuite de certificat client.' },
  { name: 'pillow', below: '10.3.0', note: 'Depassement de tampon.' },
  { name: 'urllib3', below: '2.2.2', note: 'Fuite d\'en-tete Proxy-Authorization.' },
];

export default {
  id: 'dependencies',
  category: 'dependencies',
  label: 'Dependances',
  order: 80,

  async run(context, report) {
    const dependencies = context.dependencies;
    if (dependencies.size === 0) return;

    context.shared.set('dependencyCount', dependencies.size);

    const installed = resolveInstalledVersions(context);
    context.shared.set('installedPackages', installed.length);

    checkDeprecated(dependencies, context, report);
    checkVulnerable(dependencies, installed, context, report);
    checkVersionRanges(dependencies, context, report);
    checkUnused(dependencies, context, report);
    checkLockfile(context, report);
    checkAuditReport(context, report);
  },
};

function manifestPath(context, ecosystem) {
  const map = { npm: 'package.json', pypi: 'requirements.txt', pub: 'pubspec.yaml' };
  return context.manifests[map[ecosystem]]?.file.relativePath ?? null;
}

function checkDeprecated(dependencies, context, report) {
  for (const dep of dependencies.values()) {
    const note = DEPRECATED_PACKAGES[dep.name];
    if (!note) continue;
    report({
      ruleId: 'DEP-DEPRECATED',
      severity: dep.scope === 'dependencies' ? 'medium' : 'low',
      title: `Dependance abandonnee : ${dep.name}`,
      message: note,
      file: manifestPath(context, dep.ecosystem),
      line: 1,
      suggestion: `Planifiez le remplacement de ${dep.name}. Une dependance non maintenue ne recevra aucun correctif de securite.`,
      effort: 'moyen',
      data: { package: dep.name, range: dep.range },
    });
  }
}

/**
 * La gravite d'un cache perime croit avec son age.
 *
 * A une semaine, c'est un detail. A six mois, l'absence de constat est une
 * fausse assurance : plusieurs milliers d'avis ont ete publies entre-temps,
 * et le rapport affiche pourtant une categorie au vert.
 */
function graviteDeLObsolescence(jours) {
  if (jours >= 180) return 'high';
  if (jours >= 90) return 'medium';
  if (jours >= 30) return 'low';
  return 'info';
}

function describeStaleRisk(jours) {
  if (jours >= 180) return 'Plus de six mois : la couverture est largement perimee.';
  if (jours >= 90) return 'Plus de trois mois de nouveaux avis manquent.';
  if (jours >= 30) return 'Un mois d\'avis n\'est pas couvert.';
  return 'De nouveaux avis ont pu etre publies depuis.';
}

function checkVulnerable(dependencies, installed, context, report) {
  const cache = readCache(context.root);

  if (cache) {
    reportFromOsv(cache, installed, context, report);
    if (cacheIsStale(cache)) {
      const jours = Math.round(cache.ageDays);
      report({
        ruleId: 'DEP-CACHE-STALE',
        severity: graviteDeLObsolescence(jours),
        title: 'Base de vulnerabilites datee',
        message:
          `Le cache OSV a ${jours} jours. ${describeStaleRisk(jours)} ` +
          'Le danger n\'est pas le cache en soi : c\'est qu\'une analyse sans constat ' +
          'ressemble a un projet sain alors qu\'elle ne prouve plus rien.',
        file: manifestPath(context, 'npm'),
        line: 1,
        suggestion: 'Relancez `argus sync` pour rafraichir la base (une requete reseau, puis tout redevient hors ligne). En integration continue, planifiez-le : voir docs/veille.md.',
        effort: 'rapide',
      });
    }
    return;
  }

  reportFromFallback(dependencies, context, report);
}

/** Source privilegiee : la base officielle OSV.dev. */
function reportFromOsv(cache, installed, context, report) {
  const vulnerabilities = findVulnerabilities(cache, installed);

  // Un meme paquet peut cumuler plusieurs avis : on les regroupe pour ne pas
  // noyer le rapport sous dix lignes pour une seule mise a jour a faire.
  const byPackage = new Map();
  for (const item of vulnerabilities) {
    const key = `${item.ecosystem}:${item.package}`;
    if (!byPackage.has(key)) byPackage.set(key, []);
    byPackage.get(key).push(item);
  }

  for (const [, items] of byPackage) {
    const worst = items.reduce((a, b) => (severityRank(b.advisory.severity) < severityRank(a.advisory.severity) ? b : a));
    const fixes = items.map((i) => i.fixedIn).filter(Boolean);
    const cible = fixes.length > 0 ? fixes.sort((a, b) => compareVersions(b, a) ?? 0)[0] : null;
    const identifiants = items.map((i) => i.advisory.aliases.find((a) => a.startsWith('CVE-')) || i.advisory.id);

    const precision = worst.exact
      ? 'version issue du fichier de verrouillage'
      : 'version deduite de la plage declaree — installez le fichier de verrouillage pour un resultat exact';

    report({
      ruleId: 'DEP-VULNERABLE',
      severity: worst.advisory.severity,
      title: `${worst.package}@${worst.version} : ${items.length} vulnerabilite${items.length > 1 ? 's' : ''} connue${items.length > 1 ? 's' : ''}`,
      message:
        `${worst.advisory.summary}` +
        (worst.advisory.score ? ` (CVSS ${worst.advisory.score})` : '') +
        `. Reference${identifiants.length > 1 ? 's' : ''} : ${identifiants.slice(0, 4).join(', ')}. Source : OSV.dev, ${precision}.`,
      file: manifestPath(context, ecosystemKey(worst.ecosystem)),
      line: 1,
      suggestion: cible
        ? `Mettez a jour ${worst.package} vers ${cible} ou une version superieure, puis relancez vos tests.` +
          (worst.direct ? '' : ' Ce paquet est une dependance transitive : forcez la version (npm "overrides", pnpm "resolutions") ou mettez a jour le paquet parent.')
        : `Aucun correctif publie a ce jour. Evaluez le remplacement du paquet, ou isolez son usage et surveillez ${identifiants[0]}.`,
      effort: worst.direct ? 'rapide' : 'moyen',
      confidence: worst.exact ? 'certain' : 'firm',
      tags: ['A06:2021', ...identifiants.slice(0, 2)],
      docs: worst.advisory.references?.[0] || `https://osv.dev/vulnerability/${worst.advisory.id}`,
      data: {
        package: worst.package,
        installed: worst.version,
        fixedIn: cible,
        exactVersion: worst.exact,
        direct: worst.direct,
        advisories: identifiants,
        source: 'osv.dev',
      },
    });
  }
}

/** Repli hors ligne quand aucune synchronisation n'a encore eu lieu. */
function reportFromFallback(dependencies, context, report) {
  let signaled = 0;

  for (const entry of FALLBACK_VULNERABLE) {
    const dep = dependencies.get(entry.name);
    if (!dep) continue;
    const installed = extractVersion(dep.range);
    if (!installed) continue;
    if ((compareVersions(installed, entry.below) ?? 0) >= 0) continue;
    signaled++;

    report({
      ruleId: 'DEP-VULNERABLE',
      severity: 'high',
      title: t('constat.versionVulnerable', { paquet: `${dep.name}@${dep.range}` }),
      message: `${entry.note} La version corrigee est ${entry.below} ou superieure. Source : liste locale de secours — a confirmer.`,
      file: manifestPath(context, dep.ecosystem),
      line: 1,
      suggestion: `Lancez \`argus sync\` pour verifier ce paquet contre la base officielle OSV.dev, puis mettez a jour vers ${entry.name} >= ${entry.below}.`,
      effort: 'rapide',
      // La liste de secours est indicative : elle ne doit pas peser autant
      // qu'un avis OSV verifie.
      confidence: 'tentative',
      tags: ['A06:2021'],
      data: { package: dep.name, installed, fixed: entry.below, source: 'liste-locale' },
      docs: 'https://osv.dev/',
    });
  }

  if (dependencies.size > 0) {
    report({
      ruleId: 'DEP-NO-OSV-SYNC',
      severity: signaled > 0 ? 'medium' : 'low',
      title: 'Base de vulnerabilites non synchronisee',
      message:
        `Aucun cache OSV.dev n'a ete trouve. L'analyse s'appuie sur une liste locale de ${FALLBACK_VULNERABLE.length} paquets, qui ne couvre qu'une infime partie des vulnerabilites connues.`,
      file: manifestPath(context, 'npm') || manifestPath(context, 'pypi'),
      line: 1,
      suggestion:
        'Lancez `argus sync` une fois : Argus interroge la base officielle OSV.dev (GitHub Advisories, CVE, PyPA, RustSec…) et ecrit un cache local. Les analyses suivantes restent entierement hors ligne.',
      effort: 'rapide',
    });
  }
}

function severityRank(severity) {
  return ['critical', 'high', 'medium', 'low', 'info'].indexOf(severity);
}

function ecosystemKey(ecosystem) {
  return { npm: 'npm', PyPI: 'pypi', Pub: 'pub' }[ecosystem] || 'npm';
}

function checkVersionRanges(dependencies, context, report) {
  const loose = [];
  for (const dep of dependencies.values()) {
    if (dep.ecosystem !== 'npm') continue;
    const range = String(dep.range || '');
    if (range === '*' || range === 'latest' || range === '' || /^https?:|^git\+/.test(range)) {
      loose.push(dep);
    }
  }

  if (loose.length > 0) {
    report({
      ruleId: 'DEP-UNPINNED',
      severity: 'medium',
      title: 'Dependances non contraintes',
      message: `${loose.length} dependance(s) sans contrainte de version (${loose.slice(0, 5).map((d) => d.name).join(', ')}). Deux installations peuvent produire deux applications differentes.`,
      file: manifestPath(context, 'npm'),
      line: 1,
      suggestion: 'Fixez une plage explicite (^1.2.3) et versionnez le fichier de verrouillage.',
      effort: 'rapide',
    });
  }
}

function checkUnused(dependencies, context, report) {
  const jsFiles = context.sources({ families: ['js'], includeTests: true });
  if (jsFiles.length === 0) return;
  const haystack = jsFiles.map((f) => f.content).join('\n');
  const configText = context.files
    .filter((f) => /config|rc$|\.json$|\.ya?ml$/i.test(f.name))
    .map((f) => f.content)
    .join('\n');

  const unused = [];
  for (const dep of dependencies.values()) {
    if (dep.ecosystem !== 'npm') continue;
    if (dep.scope !== 'dependencies') continue;
    if (/^@types\//.test(dep.name)) continue;
    if (haystack.includes(dep.name) || configText.includes(dep.name)) continue;
    // Certains paquets sont utilises implicitement (plugins, presets).
    if (/^(eslint|babel|postcss|tailwind|vite|webpack|rollup|jest|vitest)/.test(dep.name)) continue;
    unused.push(dep.name);
  }

  for (const name of unused.slice(0, 25)) {
    report({
      ruleId: 'DEP-UNUSED',
      severity: 'low',
      title: `Dependance jamais importee : ${name}`,
      message: `${name} est declaree en dependance de production mais n'apparait dans aucun import du projet.`,
      file: manifestPath(context, 'npm'),
      line: 1,
      suggestion:
        'Verifiez qu\'elle n\'est pas utilisee via un plugin ou un binaire, puis desinstallez-la. Chaque dependance inutile est du poids de bundle et de la surface d\'attaque en plus.',
      effort: 'rapide',
      confidence: 'tentative',
      data: { package: name },
    });
  }
}

function checkLockfile(context, report) {
  if (!context.manifests['package.json']) return;
  // Les fichiers de verrouillage sont exclus de l'indexation (volumineux et
  // sans interet pour l'analyse de code) : on interroge donc le disque.
  const hasLock = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'npm-shrinkwrap.json'].some((name) =>
    // argus-disable-next-line — lecture ponctuelle hors boucle d'evenements, pendant l'analyse
    fs.existsSync(path.join(context.root, name)),
  );
  if (hasLock) return;

  report({
    ruleId: 'DEP-NO-LOCKFILE',
    severity: 'medium',
    title: 'Fichier de verrouillage absent',
    message: 'Aucun package-lock.json / yarn.lock / pnpm-lock.yaml : les installations ne sont pas reproductibles et une version transitive compromise peut arriver silencieusement.',
    file: 'package.json',
    line: 1,
    suggestion: 'Lancez npm install et versionnez le fichier de verrouillage genere. En CI, utilisez npm ci.',
    effort: 'rapide',
    confidence: 'tentative',
  });
}

/** Integre un rapport `npm audit --json` s'il a ete depose dans .argus/. */
function checkAuditReport(context, report) {
  const auditFile = context.files.find((f) => /npm-audit\.json$/.test(f.relativePath));
  if (!auditFile) return;

  let data;
  try {
    data = JSON.parse(auditFile.content);
  } catch {
    return;
  }

  const vulnerabilities = data.vulnerabilities || {};
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    const severity = { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'info' }[entry.severity] || 'medium';
    report({
      ruleId: 'DEP-AUDIT',
      severity,
      title: `Vulnerabilite signalee : ${name}`,
      message: `npm audit signale une vulnerabilite ${entry.severity} sur ${name}${entry.via?.[0]?.title ? ` — ${entry.via[0].title}` : ''}.`,
      file: 'package.json',
      line: 1,
      suggestion: entry.fixAvailable
        ? 'Un correctif est disponible : lancez npm audit fix (ou npm audit fix --force si un changement majeur est necessaire).'
        : 'Aucun correctif automatique : evaluez le remplacement du paquet ou l\'isolement de son usage.',
      effort: 'rapide',
      confidence: 'certain',
      data: { package: name, severity: entry.severity },
    });
  }
}

function extractVersion(range) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(range || ''));
  return match ? match[0] : null;
}
