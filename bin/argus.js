#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, toList } from '../src/cli/args.js';
import { loadConfig, writeBaseline, DEFAULT_CONFIG } from '../src/core/config.js';
import { Engine } from '../src/core/engine.js';
import { renderReport, createSpinner, color } from '../src/report/terminal.js';
import { renderHtml } from '../src/report/html.js';
import { renderCompact, renderGithub, renderJson, renderMarkdown, renderSarif } from '../src/report/formats.js';
import { atLeast, CATEGORY_IDS, SEVERITIES } from '../src/core/severity.js';
import { SECURITY_RULES } from '../src/rules/security.js';
import { startServer } from '../src/server/index.js';
import { syncOsv } from '../src/core/osv.js';
import { renderRevue } from '../src/report/revue.js';
import { definirLangue, resoudreLangue, LANGUES } from '../src/i18n/index.js';
import { resolveInstalledVersions } from '../src/core/lockfiles.js';
import { walkProject } from '../src/core/walker.js';
import { ProjectContext } from '../src/core/project.js';
import { planFixes, confirmAndApply, renderDiff, FIXERS, NON_AUTOMATISABLE } from '../src/cli/fix.js';
import { lireHistorique, enregistrer, comparer, depuis } from '../src/core/history.js';

const VERSION = '1.0.0';

const BOOLEANS = [
  'help', 'version', 'verbose', 'quiet', 'ci', 'open', 'silent',
  'update-baseline', 'no-baseline', 'include-tests', 'dry-run', 'yes', 'no-external', 'no-history', 'mobile', 'tout', 'branche',
];

const ALIASES = {
  h: 'help', v: 'version', o: 'output', f: 'format', p: 'port',
  c: 'config', q: 'quiet', V: 'verbose', s: 'min-severity',
};

async function main() {
  const argv = process.argv.slice(2);
  const { options, positional } = parseArgs(argv, { booleans: BOOLEANS, aliases: ALIASES });
  // `argus ./site` vaut `argus scan ./site` : le premier argument n'est une
  // commande que s'il en porte le nom.
  const COMMANDS = ['scan', 'serve', 'mcp', 'perf', 'fuites', 'init', 'rules', 'baseline', 'sync', 'fix', 'crawl', 'history', 'help'];
  // La langue est fixee avant toute production de texte : un rapport a moitie
  // traduit vient toujours d'un reglage arrive trop tard.
  definirLangue(resoudreLangue({ option: options.lang }));

  const first = positional[0];
  const isCommand = first !== undefined && COMMANDS.includes(first);
  const command = isCommand ? first : 'scan';
  const target = (isCommand ? positional[1] : first) ?? '.';

  if (options.version) {
    process.stdout.write(`argus ${VERSION}\n`);
    return 0;
  }
  if (options.help || command === 'help') {
    printHelp(isCommand && first === 'help' ? positional[1] : (typeof options.help === 'string' ? options.help : undefined));
    return 0;
  }

  switch (command) {
    case 'scan':
      return runScan(target, options);
    case 'serve':
      return runServe(target, options);
    case 'mcp':
      return runMcp();
    case 'perf':
      return runPerf(target, options);
    case 'fuites':
      return runFuites(target, options);
    case 'init':
      return runInit(target);
    case 'rules':
      return runRules(options);
    case 'baseline':
      return runBaseline(target, options);
    case 'sync':
      return runSync(target, options);
    case 'fix':
      return runFix(target, options);
    case 'crawl':
      return runCrawl(target, options);
    case 'history':
      return runHistory(target, options);
    default:
      process.stderr.write(`${color.red('Commande inconnue')} : ${command}\n\n`);
      printHelp();
      return 2;
  }
}

function buildConfig(target, options) {
  const root = path.resolve(process.cwd(), target === true ? '.' : target);
  if (!fs.existsSync(root)) {
    throw new Error(`Le chemin "${root}" n'existe pas.`);
  }

  const overrides = {};
  const only = toList(options.only);
  const skip = toList(options.skip);
  if (only) overrides.categories = only;
  else if (skip) overrides.categories = CATEGORY_IDS.filter((id) => !skip.includes(id));

  if (options['min-severity']) overrides.minSeverity = String(options['min-severity']);
  if (options['fail-on']) overrides.failOn = String(options['fail-on']);
  if (options['fail-under']) overrides.failUnderScore = Number(options['fail-under']);
  if (options['include-tests']) overrides.includeTests = true;
  if (options['site-url']) overrides.siteUrl = String(options['site-url']);
  if (options.ignore) overrides.ignore = toList(options.ignore) || [];
  if (options['no-baseline']) overrides.baseline = null;
  if (options['max-files']) overrides.maxFiles = Number(options['max-files']);
  if (options.crawl && options.crawl !== true) overrides.crawl = String(options.crawl);
  if (options.since) overrides.since = options.since === true ? 'HEAD' : String(options.since);
  if (options['max-pages']) overrides.crawlOptions = { maxPages: Number(options['max-pages']) };
  if (options['no-external']) overrides.crawlOptions = { ...(overrides.crawlOptions || {}), checkExternal: false };

  for (const key of ['minSeverity', 'failOn']) {
    if (overrides[key] && !SEVERITIES.includes(overrides[key])) {
      throw new Error(`Severite invalide "${overrides[key]}". Valeurs possibles : ${SEVERITIES.join(', ')}.`);
    }
  }

  return loadConfig(root, overrides, options.config ? String(options.config) : null);
}

async function runScan(target, options) {
  const config = buildConfig(target, options);
  const quiet = options.quiet || options.silent || options.format === 'json';
  const spinner = quiet ? null : createSpinner();

  if (!quiet) spinner.start('Indexation du projet…');

  const engine = new Engine(config, {
    onEvent: (event) => {
      if (!spinner) return;
      if (event.type === 'phase') spinner.update(event.message);
      if (event.type === 'indexed') spinner.update(`${event.files} fichiers indexes…`);
    },
  });

  const result = await engine.run();
  if (spinner) spinner.stop();

  // L'historique alimente la courbe de tendance du rapport HTML.
  const historique = lireHistorique(config.root);
  result.history = historique;
  const evolution = comparer(historique, result);
  if (options.history !== false && !options['update-baseline']) {
    const entree = enregistrer(config.root, result);
    if (entree) result.history = [...historique, entree];
  }

  if (options['update-baseline']) {
    const file = writeBaseline(config, result.findings);
    process.stdout.write(`${color.green('✔')} Baseline mise a jour : ${path.relative(process.cwd(), file)} (${result.findings.length} empreintes)\n`);
    return 0;
  }

  const format = String(options.format || (options.ci ? 'github' : 'terminal'));
  const written = writeOutputs(result, options, config);

  if (format === 'terminal') {
    if (!options.silent) {
      process.stdout.write(`${renderReport(result, { verbose: Boolean(options.verbose) })}\n`);
      if (evolution) process.stdout.write(`${renderEvolution(evolution, result)}\n`);
    }
  } else {
    process.stdout.write(renderFormat(result, format, options));
  }

  for (const file of written) {
    if (!options.silent && format === 'terminal') {
      process.stdout.write(`  ${color.green('✔')} ${file.label} : ${color.underline(path.relative(process.cwd(), file.path))}\n`);
    }
  }

  if (options.open && written.length > 0) {
    const html = written.find((f) => f.path.endsWith('.html'));
    if (html) await openInBrowser(html.path);
  }

  return exitCode(result, config);
}

/** Une ligne de contexte : le score bouge-t-il dans le bon sens ? */
function renderEvolution(evolution, result) {
  const { delta, deltaTotal, precedent } = evolution;
  const fleche = delta > 0 ? '▲' : delta < 0 ? '▼' : '=';
  const teinte = delta > 0 ? color.green : delta < 0 ? color.red : color.dim;
  const signe = delta > 0 ? '+' : '';

  const lignes = [
    `  ${color.dim('Analyse precedente')}  ${precedent.global}/100 ${color.dim(depuis(evolution.ecoule))}`,
    `  ${color.dim('Evolution')}          ${teinte(`${fleche} ${signe}${delta} pt`)}` +
      color.dim(`  (${deltaTotal > 0 ? '+' : ''}${deltaTotal} probleme${Math.abs(deltaTotal) > 1 ? 's' : ''})`),
  ];

  // On ne cite que les categories qui ont reellement bouge.
  const bougees = Object.entries(evolution.deltaParCategorie)
    .filter(([, d]) => d !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);
  for (const [id, d] of bougees) {
    const nom = result.scores.categories[id]?.label ?? id;
    const paint = d > 0 ? color.green : color.red;
    lignes.push(color.dim(`    ${nom.padEnd(24)} `) + paint(`${d > 0 ? '+' : ''}${d}`));
  }

  return `\n${lignes.join('\n')}\n`;
}

function renderFormat(result, format, options = {}) {
  switch (format) {
    case 'json': return renderJson(result);
    case 'sarif': return renderSarif(result);
    case 'markdown':
    case 'md': return renderMarkdown(result);
    case 'html': return renderHtml(result);
    case 'compact': return renderCompact(result);
    case 'revue': {
      // Une revue peut n'avoir rien a dire : c'est un resultat, pas un vide.
      const revue = renderRevue(result, { base: options.since || 'main' });
      return revue ? revue.corps : '';
    }
    case 'github': return renderGithub(result);
    default: throw new Error(`Format inconnu : ${format}. Formats disponibles : terminal, json, sarif, markdown, html, compact, revue, github.`);
  }
}

function writeOutputs(result, options, config) {
  const written = [];
  const outputs = [
    { flag: 'html', label: 'Rapport HTML', render: () => renderHtml(result), fallback: 'argus-report.html' },
    { flag: 'json', label: 'Rapport JSON', render: () => renderJson(result), fallback: 'argus-report.json' },
    { flag: 'sarif', label: 'Rapport SARIF', render: () => renderSarif(result), fallback: 'argus-report.sarif' },
    { flag: 'markdown', label: 'Rapport Markdown', render: () => renderMarkdown(result), fallback: 'argus-report.md' },
  ];

  for (const output of outputs) {
    const value = options[output.flag];
    if (value === undefined) continue;
    const destination = path.resolve(process.cwd(), value === true ? output.fallback : String(value));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, output.render(), 'utf8');
    written.push({ label: output.label, path: destination });
  }

  if (options.output && !options.format) {
    const destination = path.resolve(process.cwd(), String(options.output));
    const ext = path.extname(destination).slice(1);
    const format = { html: 'html', json: 'json', sarif: 'sarif', md: 'markdown', txt: 'compact' }[ext] || 'json';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, renderFormat(result, format, options), 'utf8');
    written.push({ label: `Rapport ${format}`, path: destination });
  }

  return written;
}

function exitCode(result, config) {
  if (config.failUnderScore > 0 && result.scores.global < config.failUnderScore) {
    process.stderr.write(
      `\n${color.red('✖')} Score global ${result.scores.global} inferieur au seuil requis (${config.failUnderScore}).\n`,
    );
    return 1;
  }
  const blocking = result.findings.filter((f) => atLeast(f.severity, config.failOn));
  if (blocking.length > 0) {
    process.stderr.write(
      `\n${color.red('✖')} ${blocking.length} probleme(s) de gravite "${config.failOn}" ou superieure.\n`,
    );
    return 1;
  }
  return 0;
}

async function runServe(target, options) {
  const config = buildConfig(target, options);
  const port = Number(options.port || 4173);
  const server = await startServer(config, { port, host: options.host ? String(options.host) : '127.0.0.1' });

  process.stdout.write(
    [
      '',
      `  ${color.bold(color.cyan('ARGUS'))} ${color.dim('tableau de bord')}`,
      '',
      `  ${color.green('▸')} ${color.underline(server.url)}`,
      `  ${color.dim(`Projet : ${config.root}`)}`,
      '',
      color.dim('  Ctrl+C pour arreter.'),
      '',
    ].join('\n'),
  );

  if (options.open !== false) await openInBrowser(server.url);

  return new Promise((resolve) => {
    process.on('SIGINT', () => {
      server.close();
      process.stdout.write('\n  Serveur arrete.\n');
      resolve(0);
    });
  });
}

function runInit(target) {
  const root = path.resolve(process.cwd(), target === true ? '.' : target);
  const destination = path.join(root, 'argus.config.json');
  if (fs.existsSync(destination)) {
    process.stderr.write(`${color.yellow('⚠')} argus.config.json existe deja.\n`);
    return 1;
  }

  const template = {
    $schema: 'https://argus-scan.dev/schema.json',
    categories: CATEGORY_IDS,
    ignore: exclusionsSuggerees(root),
    minSeverity: 'info',
    failOn: 'high',
    failUnderScore: 0,
    siteUrl: 'https://votre-domaine.tld',
    disabledRules: [],
    ruleSeverity: {},
    options: DEFAULT_CONFIG.options,
  };

  // Le fichier est relu par un analyseur qui tolere les commentaires : autant
  // s'en servir pour dire ce que chaque reglage fait, plutot que de renvoyer
  // le lecteur a une documentation qu'il n'ouvrira pas.
  const entete =
    '// Configuration Argus.\n' +
    '//\n' +
    '// Les dossiers evidents — node_modules, .venv, dist, build, vendor,\n' +
    '// __pycache__, staticfiles — sont deja ignores sans etre listes ici.\n' +
    '// `ignore` ne sert qu\'a ce qui est propre a ce projet.\n' +
    '//\n' +
    '// `failOn` decide du code de sortie en integration continue ; `minSeverity`\n' +
    '// ne fait que filtrer l\'affichage. Les deux sont independants.\n';

  fs.writeFileSync(destination, `${entete}${JSON.stringify(template, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${color.green('✔')} Configuration creee : ${path.relative(process.cwd(), destination)}\n\n` +
      `  Lancez ensuite : ${color.cyan('argus scan --html rapport.html --open')}\n`,
  );
  return 0;
}

/**
 * Exclusions proposees, verifiees sur le disque.
 *
 * Un premier scan « brut » donnait une impression de projet catastrophique et
 * decourageait avant tout examen. Plutot qu'une liste generique — dont la
 * moitie ne correspondrait a rien ici — on ne propose que des chemins qui
 * existent reellement, et on laisse un exemple commente pour la suite.
 */
function exclusionsSuggerees(root) {
  const candidats = [
    // Ecrits par un outil : les analyser revient a blamer un generateur.
    ['**/migrations/**', 'migrations'],
    ['**/static/**/*.min.css', 'static'],
    ['**/static/**/*.min.js', 'static'],
    ['**/*.generated.*', null],
    ['**/coverage/**', 'coverage'],
    ['**/storybook-static/**', 'storybook-static'],
    ['**/public/build/**', 'public/build'],
    ['**/docs/_build/**', 'docs/_build'],
  ];

  const existe = (relatif) => {
    if (!relatif) return true;
    const direct = path.join(root, relatif);
    if (fs.existsSync(direct)) return true;
    // `migrations` vit dans les applications, pas a la racine.
    try {
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .some((e) => fs.existsSync(path.join(root, e.name, relatif)));
    } catch {
      return false;
    }
  };

  const retenus = candidats.filter(([, sonde]) => existe(sonde)).map(([motif]) => motif);
  return retenus.length > 0 ? [...new Set(retenus)] : ['**/legacy/**'];
}

function runRules(options) {
  const filter = options.category ? String(options.category) : null;
  const lines = [''];
  lines.push(`  ${color.bold('REGLES DE SECURITE')} ${color.dim(`(${SECURITY_RULES.length})`)}`);
  lines.push('');
  for (const rule of SECURITY_RULES) {
    if (filter && !rule.id.toLowerCase().includes(filter.toLowerCase())) continue;
    lines.push(`  ${color.cyan(rule.id.padEnd(24))} ${color.dim(rule.severity.padEnd(9))} ${rule.title}`);
    if (options.verbose) {
      lines.push(color.dim(`    ${rule.message}`));
      lines.push(color.green(`    → ${rule.suggestion}`));
      lines.push('');
    }
  }
  lines.push('');
  lines.push(color.dim('  Les autres categories (SEO, design, routes, code mort, performance, qualite, dependances)'));
  lines.push(color.dim('  generent leurs regles dynamiquement ; lancez un scan pour les voir a l\'oeuvre.'));
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return 0;
}

/**
 * Synchronise la base de vulnerabilites OSV.dev.
 * Seule commande d'Argus qui accede au reseau — et elle n'envoie que des
 * couples (nom de paquet, version), jamais votre code.
 */
async function runSync(target, options) {
  const config = buildConfig(target, options);
  const { files } = await walkProject(config);
  const context = new ProjectContext(config, files);
  const installed = resolveInstalledVersions(context);

  if (installed.length === 0) {
    process.stdout.write(`\n  ${color.yellow('⚠')} Aucune dependance detectee dans ce projet.\n\n`);
    return 0;
  }

  const exactes = installed.filter((p) => p.exact).length;
  process.stdout.write(
    `\n  ${color.bold(color.cyan('ARGUS SYNC'))}\n\n` +
      `  ${installed.length} paquets a verifier ` +
      color.dim(`(${exactes} en version exacte via le fichier de verrouillage, ${installed.length - exactes} deduits de la plage declaree)\n`) +
      color.dim('  Envoi vers osv.dev : uniquement des couples (nom, version). Votre code ne sort pas.\n\n'),
  );

  const spinner = createSpinner();
  spinner.start('Interrogation de la base OSV.dev…');

  let resultat;
  try {
    resultat = await syncOsv(config.root, installed, {
      onProgress: (etat) => {
        if (etat.queried) spinner.update(`Paquets verifies : ${etat.queried}/${etat.total}`);
        if (etat.advisories) spinner.update(`Recuperation des bulletins : ${etat.advisories}/${etat.totalAdvisories}`);
      },
    });
  } catch (error) {
    spinner.stop();
    process.stderr.write(
      `\n  ${color.red('✖')} Synchronisation impossible : ${error.message}\n` +
        color.dim('  Verifiez votre connexion. L\'analyse reste possible : elle utilisera la liste locale de secours.\n\n'),
    );
    return 1;
  }
  spinner.stop();

  const avis = Object.keys(resultat.advisories || {}).length;
  process.stdout.write(
    `  ${color.green('✔')} ${resultat.queried} paquets verifies\n` +
      `  ${avis > 0 ? color.red('▲') : color.green('✔')} ${resultat.vulnerable} paquet(s) concerne(s) par ${avis} bulletin(s)\n` +
      color.dim(`  Cache ecrit : ${path.relative(process.cwd(), resultat.file)}\n`) +
      color.dim('  Les analyses suivantes sont hors ligne. Ajoutez .argus/ a votre .gitignore.\n\n') +
      `  ${color.dim('Etape suivante :')} ${color.cyan('argus scan --only dependances')}\n\n`,
  );

  return 0;
}

/**
 * Applique les correctifs mecaniques — jamais sans accord explicite.
 * Par defaut la commande n'ecrit rien : elle propose, montre le differentiel,
 * et attend une reponse pour chaque fichier.
 */
/**
 * Serveur MCP : le dialogue occupe l'entree et la sortie standard.
 * Aucun affichage n'est possible ici sans corrompre le flux.
 */
/**
 * Mesure un chargement reel dans un navigateur.
 *
 * L'analyse statique dit ce qu'un fichier contient ; elle ne dit pas combien
 * de temps le visiteur attend. Les deux se completent, et cette commande
 * couvre ce que la lecture du code ne peut pas voir.
 */
async function runPerf(target, options) {
  const url = target === '.' ? null : target;
  if (!url || !/^https?:\/\//.test(url)) {
    process.stderr.write('\n  Usage : argus perf <url>\n  Exemple : argus perf https://exemple.com --mobile\n\n');
    return 2;
  }

  const { mesurerChargement, trouverNavigateur } = await import('../src/perf/navigateur.js');
  const { evaluerChargement, SEUILS } = await import('../src/perf/regles.js');

  if (!trouverNavigateur()) {
    process.stderr.write(
      `\n  ${color.yellow('!')} Aucun navigateur Chrome ou Chromium trouve.\n\n` +
        '  Cette commande mesure un chargement reel : elle a besoin d\'un navigateur.\n' +
        '  Installez Chrome ou Chromium, ou indiquez son chemin :\n\n' +
        '    ARGUS_NAVIGATEUR=/chemin/vers/chrome argus perf <url>\n\n' +
        '  Les autres commandes d\'Argus fonctionnent sans navigateur.\n\n',
    );
    return 3;
  }

  const mobile = Boolean(options.mobile);
  process.stdout.write(
    `\n  ${color.bold(color.cyan('ARGUS PERF'))} ${color.dim(mobile ? '· profil mobile' : '· profil bureau')}\n` +
      `  ${color.dim(url)}\n\n  Chargement en cours…\n`,
  );

  let mesures;
  try {
    mesures = await mesurerChargement(url, {
      mobile,
      largeur: mobile ? 390 : 1366,
      hauteur: mobile ? 844 : 768,
      attente: Number(options.attente) || 4000,
    });
  } catch (erreur) {
    process.stderr.write(`\n  ${color.red('✖')} ${erreur.message}\n\n`);
    return 1;
  }

  const constats = evaluerChargement(mesures);
  const note = (valeur, seuil) =>
    valeur > seuil.mauvais ? color.red('mauvais') : valeur > seuil.bon ? color.yellow('a ameliorer') : color.green('bon');

  const ms = (v) => `${(v / 1000).toFixed(2)} s`;
  process.stdout.write(
    `\n  ${color.dim('Titre')}            ${mesures.titre || '—'}\n` +
      `  ${color.dim('Premier octet')}    ${ms(mesures.ttfb).padEnd(9)} ${note(mesures.ttfb, SEUILS.ttfb)}\n` +
      `  ${color.dim('Premiere peinture')} ${ms(mesures.premierePeinture).padEnd(8)} ${note(mesures.premierePeinture, SEUILS.fcp)}\n` +
      `  ${color.dim('Plus grand element')} ${ms(mesures.lcp).padEnd(7)} ${note(mesures.lcp, SEUILS.lcp)}\n` +
      `  ${color.dim('Stabilite (CLS)')}  ${mesures.cls.toFixed(3).padEnd(9)} ${note(mesures.cls, SEUILS.cls)}\n` +
      `  ${color.dim('Poids total')}      ${(mesures.octets / 1048576).toFixed(2)} Mo en ${mesures.requetes} requetes\n\n`,
  );

  if (constats.length === 0) {
    process.stdout.write(`  ${color.green('✔')} Aucun probleme de chargement mesure.\n\n`);
    return 0;
  }

  process.stdout.write(`  ${constats.length} constat(s) :\n\n`);
  for (const constat of constats) {
    const marque = constat.severity === 'high' ? color.red('▲') : constat.severity === 'medium' ? color.yellow('●') : color.dim('○');
    process.stdout.write(`  ${marque} ${color.bold(constat.title)}\n    ${color.dim(constat.message)}\n    ${color.cyan('→')} ${constat.suggestion}\n\n`);
  }

  const bloquants = constats.filter((c) => c.severity === 'high').length;
  return bloquants > 0 && options.failOn !== 'none' ? 1 : 0;
}

/**
 * Cherche les secrets ayant vecu dans l'historique Git.
 *
 * Le scan ordinaire ne lit que l'arbre de travail : une clef sortie du code
 * dans un commit ulterieur en disparait, alors qu'elle reste integralement
 * lisible pour quiconque clone le depot.
 */
async function runFuites(target, options) {
  const racine = path.resolve(target === '.' ? process.cwd() : target);
  const { chercherLesFuites, depuisQuand, ouRevoquer } = await import('../src/core/fuites.js');

  process.stdout.write(
    `\n  ${color.bold(color.cyan('ARGUS FUITES'))}\n  ${color.dim(racine)}\n\n  Lecture de l'historique…\n`,
  );

  let resultat;
  try {
    resultat = await chercherLesFuites(racine, {
      maxCommits: Number(options.maxCommits) || 2000,
      tousLesRefs: !options.branche,
    });
  } catch (erreur) {
    process.stderr.write(`\n  ${color.red('✖')} ${erreur.message}\n\n`);
    return erreur.genre === 'git' ? 2 : 1;
  }

  const { fuites, reelles, donneesDeTest, commitsAnalyses, tronque } = resultat;
  process.stdout.write(`  ${commitsAnalyses} commits analyses.\n\n`);

  // `--tout` doit passer avant ce retour : sinon la seule facon de consulter
  // les valeurs ecartees serait qu'une vraie fuite existe par ailleurs.
  if (reelles.length === 0 && !(options.tout && fuites.length > 0)) {
    process.stdout.write(
      `  ${color.green('✔')} Aucun secret trouve dans l'historique.\n\n` +
        (donneesDeTest > 0
          ? color.dim(`  ${donneesDeTest} valeur(s) reconnue(s) uniquement dans des fichiers de test, ecartee(s).\n  Utilisez --tout pour les afficher.\n\n`)
          : '') +
        (tronque
          ? color.dim(`  Analyse limitee aux ${commitsAnalyses} derniers commits : utilisez --max-commits pour aller plus loin.\n\n`)
          : ''),
    );
    return 0;
  }

  process.stdout.write(
    reelles.length > 0
      ? `  ${color.red(color.bold(`${reelles.length} secret(s) ont vecu dans ce depot.`))}\n\n` +
        color.dim('  Retirer une clef du code ne la retire pas de l\'historique. Elle reste\n') +
        color.dim('  lisible par quiconque clone le depot, aujourd\'hui ou dans cinq ans.\n\n')
      : `  ${color.green('✔')} Aucune vraie fuite. Valeurs de test affichees a votre demande :\n\n`,
  );

  const aMontrer = options.tout ? fuites : reelles;
  for (const fuite of aMontrer) {
    const marque = fuite.donneeDeTest
      ? color.dim('·')
      : fuite.severite === 'critical'
        ? color.red('■')
        : color.yellow('▲');
    const etat = fuite.donneeDeTest
      ? color.dim('chemin de test — probablement une donnee de test')
      : fuite.encorePresente
        ? color.red('encore dans le code')
        : color.dim('retiree du code, toujours dans l\'historique');

    process.stdout.write(
      `  ${marque} ${color.bold(fuite.libelle)}  ${color.dim(fuite.valeur)}\n` +
        `      ${etat}\n` +
        `      introduite ${depuisQuand(fuite.premierCommit.date)} · ${color.dim(fuite.premierCommit.hash.slice(0, 8))} « ${fuite.premierCommit.sujet} »\n` +
        (fuite.fichiers.length > 0 ? `      ${color.dim(fuite.fichiers.slice(0, 3).join(', '))}\n` : ''),
    );

    const { service, adresse } = ouRevoquer(fuite.genre);
    if (service) {
      process.stdout.write(`      ${color.cyan('→')} Revoquez sur ${service}${adresse ? ` : ${adresse}` : ''}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write(
    `  ${color.bold('Dans cet ordre :')}\n` +
      `  1. ${color.bold('Revoquez et remplacez chaque clef.')} C'est la seule action qui ferme\n` +
      '     vraiment la porte — on ne sait pas qui a deja clone le depot.\n' +
      '  2. Verifiez les journaux d\'acces du service sur la periode concernee.\n' +
      '  3. Ensuite seulement, reecrivez l\'historique si vous y tenez\n' +
      `     ${color.dim('(git filter-repo, ou BFG) — cela reecrit tous les commits et')}\n` +
      `     ${color.dim('oblige chaque contributeur a recloner.')}\n\n` +
      (donneesDeTest > 0 && !options.tout
        ? color.dim(`  ${donneesDeTest} valeur(s) trouvee(s) uniquement dans des fichiers de test, ecartee(s) — --tout pour les voir.\n\n`)
        : '') +
      (tronque
        ? color.dim(`  Analyse limitee aux ${commitsAnalyses} derniers commits : --max-commits pour aller plus loin.\n\n`)
        : ''),
  );

  const critiques = reelles.filter((f) => f.severite === 'critical').length;
  return critiques > 0 ? 1 : 0;
}

async function runMcp() {
  const { demarrerServeurMcp } = await import('../src/mcp/serveur.js');
  await demarrerServeurMcp();
  return 0;
}

async function runFix(target, options) {
  const config = buildConfig(target, options);
  const { files } = await walkProject(config);
  const context = new ProjectContext(config, files);

  const plan = planFixes(context, { only: toList(options.only) });

  if (plan.length === 0) {
    process.stdout.write(`\n  ${color.green('✔')} Aucun correctif mecanique a proposer sur ce projet.\n\n`);
    printNonAutomatisable();
    return 0;
  }

  const total = plan.reduce((somme, e) => somme + e.edits.length, 0);
  const aVerifier = plan.filter((e) => e.fixes.some((f) => f.fixer.risk.id === 'a-verifier')).length;

  process.stdout.write(
    `\n  ${color.bold(color.cyan('ARGUS FIX'))}\n\n` +
      `  ${total} modification(s) proposee(s) dans ${plan.length} fichier(s).\n` +
      (aVerifier > 0 ? color.dim(`  ${aVerifier} fichier(s) contiennent au moins un correctif marque « a verifier ».\n`) : '') +
      color.dim('  Rien n\'est ecrit pour l\'instant.\n'),
  );

  if (options['dry-run']) {
    for (const entree of plan) {
      process.stdout.write(`\n${color.bold(color.cyan(entree.path))}\n`);
      for (const { fixer, edits } of entree.fixes) {
        process.stdout.write(`  ${fixer.risk.paint('●')} ${fixer.label} ${color.dim(`(${edits.length}×)`)}\n`);
      }
      process.stdout.write(`\n${renderDiff(entree.before, entree.after)}\n`);
    }
    process.stdout.write(
      `\n  ${color.dim('Apercu uniquement — aucun fichier modifie.')}\n` +
        `  ${color.dim('Pour appliquer :')} ${color.cyan('argus fix')}\n\n`,
    );
    return 0;
  }

  if (!process.stdin.isTTY && !options.yes) {
    process.stderr.write(
      `\n  ${color.yellow('⚠')} Terminal non interactif : impossible de demander votre accord.\n` +
        color.dim('  Utilisez --dry-run pour visualiser, ou --yes pour confirmer explicitement d\'avance.\n\n'),
    );
    return 2;
  }

  process.stdout.write(
    color.dim('\n  Chaque fichier vous sera presente avec son differentiel exact.\n') +
      color.dim('  L\'original est sauvegarde dans .argus/backup/ avant toute ecriture.\n'),
  );

  const resultat = await confirmAndApply(plan, { root: config.root, autoYes: Boolean(options.yes) });

  process.stdout.write(
    `\n  ${color.green('✔')} ${resultat.applied.length} fichier(s) modifie(s)` +
      (resultat.skipped.length > 0 ? color.dim(`, ${resultat.skipped.length} ignore(s)`) : '') +
      '\n',
  );
  if (resultat.backupDir) {
    process.stdout.write(color.dim(`  Sauvegarde des originaux : ${path.relative(process.cwd(), resultat.backupDir)}\n`));
  }
  if (resultat.applied.length > 0) {
    process.stdout.write(
      `\n  ${color.bold('A faire maintenant :')} relancez votre build et vos tests, puis relisez le diff (${color.cyan('git diff')}).\n`,
    );
  }
  process.stdout.write('\n');
  printNonAutomatisable();
  return 0;
}

function printNonAutomatisable() {
  process.stdout.write(`  ${color.dim('Volontairement non automatise — cela demande votre jugement :')}\n`);
  for (const [sujet, raison] of NON_AUTOMATISABLE) {
    process.stdout.write(color.dim(`    · ${sujet} — ${raison}\n`));
  }
  process.stdout.write('\n');
}

/**
 * `argus crawl <url>` : exploration seule, sans code source a analyser.
 * Utile pour auditer un site en ligne dont on n'a pas les sources.
 */
/**
 * Inventaire de l'exploration : ce qui a ete visite, et vers quoi le site
 * pointe.
 *
 * « 10 pages explorees » ne permet pas de verifier la couverture : on ne sait
 * pas *lesquelles*, et la question « a-t-il vu mes pages produits ? » reste
 * sans reponse. La liste y repond, et elle est le premier interet d'un crawl.
 *
 * Les liens sortants sont groupes par domaine : ce qui compte pour le
 * referencement n'est pas « ce lien-ci existe » mais « voila a qui ce site
 * adresse son autorite, et combien de fois ».
 */
function renderInventaire(inventaire, options = {}) {
  if (!inventaire) return '';

  const tout = Boolean(options.tout || options.verbose);
  const maxPages = tout ? Infinity : 25;
  const maxDomaines = tout ? Infinity : 15;
  const lignes = [];

  const pages = inventaire.pages || [];
  if (pages.length > 0) {
    const enErreur = pages.filter((p) => p.statut && p.statut >= 400).length;
    lignes.push(
      '',
      `  ${color.bold('PAGES EXPLOREES')}  ${color.dim(`${pages.length}${enErreur ? ` · ${enErreur} en erreur` : ''}`)}`,
      '',
    );

    const largeur = Math.min(42, Math.max(...pages.slice(0, maxPages).map((p) => p.chemin.length)));
    for (const page of pages.slice(0, maxPages)) {
      const enErreurCette = page.statut && page.statut >= 400;
      const statut = page.erreur
        ? color.red('  ✖ ')
        : enErreurCette
          ? color.red(String(page.statut).padStart(5))
          : color.dim(String(page.statut ?? '—').padStart(5));

      // Pour une page en erreur, c'est la page *source* qu'il faut corriger :
      // afficher son titre d'erreur n'apprendrait rien.
      const detail = enErreurCette || page.erreur
        ? color.dim(page.depuis ? `← lie depuis ${page.depuis}` : '')
        : color.dim(page.titre || '');

      lignes.push(`  ${statut} ${color.dim(`d${page.profondeur}`)}  ${tronquer(page.chemin, largeur).padEnd(largeur)}  ${detail}`);
    }
    if (pages.length > maxPages) {
      lignes.push(color.dim(`        …et ${pages.length - maxPages} autre(s) — --tout pour la liste complete`));
    }
  }

  const domaines = inventaire.domaines || [];
  if (domaines.length > 0) {
    const morts = domaines.filter((d) => d.morts > 0).length;
    lignes.push(
      '',
      `  ${color.bold('LIENS SORTANTS')}  ${color.dim(`${domaines.length} domaine(s)${morts ? ` · ${morts} injoignable(s)` : ''}`)}`,
      '',
    );

    const largeur = Math.min(38, Math.max(...domaines.slice(0, maxDomaines).map((d) => d.domaine.length)));
    for (const domaine of domaines.slice(0, maxDomaines)) {
      const marque = domaine.morts > 0 ? color.red('  ✖') : '   ';
      const compte = `${domaine.liens} lien${domaine.liens > 1 ? 's' : ''}`;
      const sources = domaine.sources.slice(0, 2).join(', ') + (domaine.sources.length > 2 ? `, +${domaine.sources.length - 2}` : '');
      lignes.push(
        `${marque} ${tronquer(domaine.domaine, largeur).padEnd(largeur)}  ${color.dim(compte.padEnd(9))}${color.dim(`depuis ${sources}`)}`,
      );
    }
    if (domaines.length > maxDomaines) {
      lignes.push(color.dim(`        …et ${domaines.length - maxDomaines} autre(s) domaine(s)`));
    }
  }

  return lignes.length > 0 ? `${lignes.join('\n')}\n` : '';
}

function tronquer(texte, largeur) {
  return texte.length <= largeur ? texte : `${texte.slice(0, largeur - 1)}…`;
}

async function runCrawl(target, options) {
  const url = target && /^https?:\/\//.test(target) ? target : options.crawl;
  if (!url || url === true) {
    process.stderr.write(
      `\n  ${color.red('✖')} Indiquez l'URL a explorer.\n\n` +
        `  ${color.cyan('argus crawl https://votre-site.tld')}\n` +
        color.dim('  Ou, pour combiner avec l\'analyse du code source :\n') +
        `  ${color.cyan('argus scan . --crawl https://votre-site.tld')}\n\n`,
    );
    return 2;
  }

  // Sans dossier de code, on analyse un repertoire vide : seul le crawl parle.
  const source = options.source ? String(options.source) : (target && !/^https?:/.test(target) ? target : '.');
  const config = buildConfig(source, options);
  config.crawl = String(url);
  if (!options.source && (!target || /^https?:/.test(target))) {
    // Aucun code source fourni : seul le site en ligne est audite.
    config.crawlOnly = true;
    config.categories = ['routes', 'seo', 'security', 'performance'];
  }

  const spinner = options.quiet ? null : createSpinner();
  config.onCrawlEvent = (event) => {
    if (!spinner) return;
    if (event.type === 'page') spinner.update(`${event.count}/${event.total} — ${event.status ?? '…'} ${event.url.slice(0, 60)}`);
    if (event.type === 'external') spinner.update(`Liens externes verifies : ${event.checked}/${event.total}`);
  };

  process.stdout.write(
    `\n  ${color.bold(color.cyan('ARGUS CRAWL'))}  ${color.dim(url)}\n` +
      color.dim(`  robots.txt respecte · ${config.crawlOptions.maxPages} pages maximum · ${config.crawlOptions.delayMs} ms entre les requetes\n\n`),
  );

  if (spinner) spinner.start('Exploration…');
  const result = await new Engine(config).run();
  if (spinner) spinner.stop();

  const resume = result.insights.crawl;
  if (resume) {
    process.stdout.write(
      `  ${color.dim('Pages explorees')}   ${resume.pagesExplorees}` +
        (resume.enErreur > 0 ? color.red(`  (${resume.enErreur} en erreur)`) : '') + '\n' +
        `  ${color.dim('Liens externes')}    ${resume.liensExternesVerifies} verifies` +
        (resume.liensExternesMorts > 0 ? color.red(`, ${resume.liensExternesMorts} morts`) : '') + '\n' +
        `  ${color.dim('Reponse mediane')}   ${resume.ttfbMedian ?? '—'} ms\n`,
    );
    process.stdout.write(renderInventaire(resume.inventaire, options));
  }

  writeOutputs(result, options, config);
  if (!options.silent) process.stdout.write(`${renderReport(result, { verbose: Boolean(options.verbose) })}\n`);
  return exitCode(result, config);
}

/** Historique local des analyses : la tendance, pas l'instantane. */
function runHistory(target, options) {
  const config = buildConfig(target, options);
  const entrees = lireHistorique(config.root);

  if (entrees.length === 0) {
    process.stdout.write(
      `\n  Aucune analyse enregistree pour ce projet.\n` +
        color.dim('  Chaque `argus scan` alimente l\'historique automatiquement.\n\n'),
    );
    return 0;
  }

  const lignes = ['', `  ${color.bold(color.cyan('HISTORIQUE'))}  ${color.dim(`${entrees.length} analyse(s)`)}`, ''];
  let precedent = null;
  for (const e of entrees.slice(-20)) {
    const delta = precedent === null ? null : e.global - precedent;
    const variation = delta === null ? '     ' : (delta > 0 ? color.green : delta < 0 ? color.red : color.dim)(`${delta > 0 ? '+' : ''}${delta}`.padStart(4) + ' ');
    lignes.push(
      `  ${color.dim(new Date(e.date).toLocaleString('fr-FR').padEnd(20))} ` +
        `${String(e.global).padStart(3)}/100 ${variation} ` +
        color.dim(`${String(e.total).padStart(4)} problemes  ${e.commit || ''}`),
    );
    precedent = e.global;
  }

  const scores = entrees.map((e) => e.global);
  lignes.push('');
  lignes.push(color.dim(`  Minimum ${Math.min(...scores)}  ·  Maximum ${Math.max(...scores)}  ·  Actuel ${scores[scores.length - 1]}`));
  lignes.push('');
  process.stdout.write(lignes.join('\n'));
  return 0;
}

async function runBaseline(target, options) {
  return runScan(target, { ...options, 'update-baseline': true });
}

async function openInBrowser(target) {
  const { spawn } = await import('node:child_process');
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [target], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* l'ouverture automatique est un confort, jamais un blocage */
  }
}

function printHelp(topic) {
  if (topic === 'scan') {
    process.stdout.write(`
  ${color.bold('argus scan [chemin]')}

  ${color.dim('Sorties')}
    --html [fichier]        rapport HTML autonome (defaut : argus-report.html)
    --json [fichier]        rapport JSON complet
    --sarif [fichier]       rapport SARIF 2.1 (GitHub Code Scanning)
    --markdown [fichier]    rapport Markdown
    --format <nom>          terminal | json | sarif | markdown | html | compact | github
    --open                  ouvre le rapport HTML dans le navigateur

  ${color.dim('Perimetre')}
    --only <categories>     securite,routes,deadcode,seo,design,performance,qualite,dependances
    --skip <categories>     categories a exclure
    --ignore <patterns>     patterns additionnels a ignorer
    -c, --config <fichier>  fichier de configuration explicite
    --include-tests         analyse aussi les fichiers de test
    --max-files <n>         limite le nombre de fichiers
    --since <ref>           ne rapporte que ce que vos changements introduisent
                            (ex : --since main, --since HEAD, --since origin/main)

  ${color.dim('Seuils')}
    -s, --min-severity <n>  severite minimale rapportee (defaut : info)
    --fail-on <severite>    code de sortie 1 a partir de cette severite (defaut : high)
    --fail-under <score>    code de sortie 1 si le score global est inferieur
    --no-baseline           ignore le fichier de baseline
    --update-baseline       enregistre l'etat actuel comme reference

  ${color.dim('Affichage')}
    -V, --verbose           affiche tous les problemes
    -q, --quiet             masque la progression
    --ci                    sortie adaptee a l'integration continue
\n`);
    return;
  }

  if (topic === 'fix') {
    process.stdout.write(`
  ${color.bold('argus fix [chemin]')}

  ${color.dim('Applique uniquement des corrections mecaniques et sans ambiguite.')}
  ${color.dim('Rien n\'est jamais ecrit sans votre accord : chaque fichier vous est')}
  ${color.dim('presente avec son differentiel exact, et l\'original est sauvegarde')}
  ${color.dim('dans .argus/backup/ avant toute ecriture.')}

  ${color.dim('Options')}
    --dry-run             affiche les differentiels sans rien demander ni ecrire
    --only <correctifs>   ${FIXERS.map((f) => f.id).join(', ')}
    --yes                 confirme d'avance (pour un terminal non interactif)

  ${color.dim('Reponses possibles pour chaque fichier')}
    o  appliquer      n  ignorer      t  tout accepter      q  arreter
\n`);
    return;
  }

  if (topic === 'crawl') {
    process.stdout.write(`
  ${color.bold('argus crawl <url>')}

  ${color.dim('Demande reellement les pages a votre serveur pour verifier ce qu\'aucune')}
  ${color.dim('analyse du code ne peut affirmer : codes HTTP reels, chaines de')}
  ${color.dim('redirection, en-tetes de securite effectivement envoyes, et le HTML tel')}
  ${color.dim('que le voit un robot d\'indexation.')}

  ${color.dim('Options')}
    --max-pages <n>       nombre de pages a explorer (defaut : 50)
    --no-external         ne pas verifier les liens sortants
    --source <chemin>     analyser aussi le code source de ce dossier

  ${color.dim('robots.txt est respecte, et un delai separe chaque requete.')}
  ${color.dim('Le JavaScript n\'est pas execute — c\'est precisement ce que voient')}
  ${color.dim('la plupart des robots au premier passage.')}
\n`);
    return;
  }

  if (topic === 'sync') {
    process.stdout.write(`
  ${color.bold('argus sync [chemin]')}

  ${color.dim('Interroge la base officielle OSV.dev (GitHub Advisories, CVE, PyPA,')}
  ${color.dim('RustSec, Go vulndb…) et ecrit un cache local dans .argus/.')}
  ${color.dim('Toutes les analyses suivantes restent entierement hors ligne.')}

  ${color.dim('Seuls des couples (nom de paquet, version) sont transmis.')}
  ${color.dim('Votre code ne sort jamais de votre machine.')}

  ${color.dim('Les versions sont lues dans votre fichier de verrouillage quand il')}
  ${color.dim('existe. Sinon elles sont deduites de la plage declaree, et le rapport')}
  ${color.dim('le signale explicitement.')}
\n`);
    return;
  }

  process.stdout.write(`
  ${color.bold(color.cyan('ARGUS'))} ${VERSION} ${color.dim('— analyse de projet : securite, SEO, routes, code mort, design, performance')}

  ${color.bold('UTILISATION')}
    argus <commande> [chemin] [options]

  ${color.bold('COMMANDES')}
    scan [chemin]      analyse le projet et affiche le rapport      ${color.dim('(defaut)')}
    serve [chemin]     tableau de bord interactif dans le navigateur
    fix [chemin]       propose les correctifs mecaniques ${color.dim('(demande toujours votre accord)')}
    crawl <url>        explore le site en ligne et verifie ce qu'il renvoie vraiment
    sync [chemin]      met a jour la base de vulnerabilites depuis OSV.dev
    init [chemin]      cree un fichier argus.config.json
    rules              liste les regles de securite disponibles
    history [chemin]   evolution des scores au fil des analyses\n    baseline [chemin]  enregistre l'etat actuel comme reference
    help [commande]    aide detaillee

  ${color.bold('EXEMPLES')}
    ${color.dim('# Analyse rapide du dossier courant')}
    argus

    ${color.dim('# Rapport HTML complet, ouvert automatiquement')}
    argus scan ./mon-site --html rapport.html --open

    ${color.dim('# Uniquement le SEO et le design, tout afficher')}
    argus scan --only seo,design --verbose

    ${color.dim('# Ce que votre branche ajoute comme dette, rien de plus')}
    argus scan --since main

    ${color.dim('# En integration continue : echec si une faille grave apparait')}
    argus scan --ci --fail-on high --sarif argus.sarif

    ${color.dim('# Tableau de bord en direct')}
    argus serve ./mon-site

    ${color.dim('# Verifier les vraies vulnerabilites des dependances (une requete reseau)')}
    argus sync && argus scan --only dependances

    ${color.dim('# Voir les corrections proposees, sans rien modifier')}
    argus fix --dry-run

    ${color.dim('# Auditer un site en ligne : vrais codes HTTP, en-tetes, redirections')}
    argus crawl https://mon-site.tld

    ${color.dim('# Code source et site en ligne dans un meme rapport')}
    argus scan . --crawl https://mon-site.tld --html rapport.html

  ${color.bold('OPTIONS PRINCIPALES')}
    --html / --json / --sarif / --markdown   generation de rapports
    --only / --skip                          filtrage par categorie
    --crawl <url>                            verifie aussi le site en ligne
    --fail-on / --fail-under                 seuils d'echec pour la CI
    -V, --verbose                            detail complet
    -h, --help                               cette aide

  ${color.dim('Details d\'une commande :')} argus help scan

`);
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    process.stderr.write(`\n${color.red('✖ Erreur')} : ${error.message}\n`);
    if (process.env.ARGUS_DEBUG) process.stderr.write(`${error.stack}\n`);
    process.exitCode = 2;
  });
