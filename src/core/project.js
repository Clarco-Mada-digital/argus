import path from 'node:path';
import { stripJsonComments } from './config.js';

/**
 * Contexte partage par tous les analyseurs : index des fichiers, manifestes,
 * frameworks detectes, et espace de donnees inter-analyseurs (routes, liens…).
 */
export class ProjectContext {
  constructor(config, files, meta = {}) {
    this.config = config;
    this.root = path.resolve(config.root);
    this.files = files;
    this.meta = meta;

    this.byPath = new Map(files.map((f) => [f.relativePath, f]));
    this.byLanguage = groupBy(files, (f) => f.language);
    this.byFamily = groupBy(files, (f) => f.family);
    this.byExtension = groupBy(files, (f) => f.ext);

    this.manifests = this.#readManifests();
    this.frameworks = detectFrameworks(this);
    this.platforms = detectPlatforms(this.frameworks);
    this.stack = summarizeStack(this);
    this.description = describeProject(this);

    /** Rempli par l'analyseur de routes, consomme par SEO et code mort. */
    this.routes = [];
    this.links = [];
    this.symbols = new Map();
    this.shared = new Map();
  }

  file(relativePath) {
    return this.byPath.get(relativePath) || null;
  }

  /** Fichiers analysables (texte, non generes, hors tests si configure). */
  sources({ includeTests = this.config.includeTests, families = null, languages = null } = {}) {
    return this.files.filter((f) => {
      if (!f.readable) return false;
      if (!includeTests && f.isTest) return false;
      if (families && !families.includes(f.family)) return false;
      if (languages && !languages.includes(f.language)) return false;
      return true;
    });
  }

  /** Le projet vise-t-il l'une de ces plateformes ? (`web`, `mobile`, `desktop`) */
  cible(...plateformes) {
    return plateformes.some((p) => this.platforms.includes(p));
  }

  has(...frameworkIds) {
    return frameworkIds.some((id) => this.frameworks.includes(id));
  }

  #readManifests() {
    const manifests = {};
    const load = (name, parser) => {
      const file = this.byPath.get(name) || this.files.find((f) => f.relativePath.endsWith(`/${name}`));
      if (!file || !file.readable) return;
      try {
        manifests[name] = { file, data: parser(file.content) };
      } catch {
        manifests[name] = { file, data: null, invalid: true };
      }
    };

    load('package.json', (c) => JSON.parse(stripJsonComments(c)));
    load('composer.json', (c) => JSON.parse(stripJsonComments(c)));
    load('tsconfig.json', (c) => JSON.parse(stripJsonComments(c)));
    load('pubspec.yaml', parseSimpleYaml);
    load('requirements.txt', parseRequirements);
    load('pyproject.toml', parseSimpleToml);
    load('pom.xml', (c) => c);
    load('build.gradle', (c) => c);
    load('go.mod', (c) => c);
    load('Gemfile', (c) => c);
    load('Cargo.toml', parseSimpleToml);
    return manifests;
  }

  /** Toutes les dependances declarees, tous ecosystemes confondus. */
  get dependencies() {
    const deps = new Map();
    const pkg = this.manifests['package.json']?.data;
    if (pkg) {
      for (const scope of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(pkg[scope] || {})) {
          deps.set(name, { name, range, scope, ecosystem: 'npm' });
        }
      }
    }
    const reqs = this.manifests['requirements.txt']?.data;
    if (reqs) {
      for (const dep of reqs) deps.set(dep.name, { ...dep, ecosystem: 'pypi', scope: 'dependencies' });
    }
    const pubspec = this.manifests['pubspec.yaml']?.data;
    if (pubspec?.dependencies) {
      for (const [name, range] of Object.entries(pubspec.dependencies)) {
        deps.set(name, { name, range: String(range), scope: 'dependencies', ecosystem: 'pub' });
      }
    }
    return deps;
  }
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * Detection de frameworks par manifeste + presence de fichiers signature.
 * Volontairement large : elle pilote l'activation des regles specialisees.
 */
function detectFrameworks(context) {
  const found = new Set();
  const pkg = context.manifests['package.json']?.data || {};
  const npmDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const hasDep = (name) => Object.hasOwn(npmDeps, name);
  const hasFile = (pattern) => context.files.some((f) => pattern.test(f.relativePath));

  const npmMap = {
    next: 'nextjs',
    nuxt: 'nuxt',
    react: 'react',
    'react-native': 'react-native',
    vue: 'vue',
    svelte: 'svelte',
    '@sveltejs/kit': 'sveltekit',
    '@angular/core': 'angular',
    astro: 'astro',
    express: 'express',
    fastify: 'fastify',
    koa: 'koa',
    '@nestjs/core': 'nestjs',
    'react-router-dom': 'react-router',
    'vue-router': 'vue-router',
    gatsby: 'gatsby',
    remix: 'remix',
    '@remix-run/react': 'remix',
    tailwindcss: 'tailwind',
    'styled-components': 'styled-components',
    electron: 'electron',
    '@tauri-apps/api': 'tauri',
    '@capacitor/core': 'capacitor',
    '@ionic/angular': 'ionic',
    '@ionic/react': 'ionic',
    'expo': 'expo',
    'nativescript': 'nativescript',
    vite: 'vite',
    webpack: 'webpack',
  };
  for (const [dep, id] of Object.entries(npmMap)) if (hasDep(dep)) found.add(id);

  if (context.manifests['package.json']) found.add('node');
  if (context.manifests['pubspec.yaml']) found.add('flutter');
  if (context.manifests['composer.json']) {
    found.add('php');
    const composer = context.manifests['composer.json'].data || {};
    const phpDeps = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
    if (Object.keys(phpDeps).some((d) => d.startsWith('laravel/'))) found.add('laravel');
    if (Object.keys(phpDeps).some((d) => d.startsWith('symfony/'))) found.add('symfony');
  }
  if (context.manifests['go.mod']) found.add('go');
  if (context.manifests['Cargo.toml']) found.add('rust');
  if (context.manifests['Gemfile']) {
    found.add('ruby');
    if (/rails/.test(context.manifests['Gemfile'].data || '')) found.add('rails');
  }
  if (context.manifests['pom.xml'] || context.manifests['build.gradle']) {
    found.add('jvm');
    const build = `${context.manifests['pom.xml']?.data || ''}${context.manifests['build.gradle']?.data || ''}`;
    if (/spring-boot|springframework/.test(build)) found.add('spring');
  }

  const pythonSource = context.byLanguage.get('python') || [];
  const pythonHead = pythonSource.slice(0, 300).map((f) => f.content).join('\n');
  if (/from\s+django|import\s+django/.test(pythonHead) || hasFile(/(^|\/)manage\.py$/)) found.add('django');
  if (/from\s+fastapi|FastAPI\(/.test(pythonHead)) found.add('fastapi');
  if (/from\s+flask|Flask\(/i.test(pythonHead)) found.add('flask');

  // Un script utilitaire ne fait pas un projet Python.
  //
  // La regle etait « au moins un fichier .py ». Un depot React Native qui
  // embarque un script de publication se voyait donc classe Python — constat
  // remonte sur un vrai projet Expo. On demande desormais soit un manifeste
  // Python, soit une presence qui pese reellement dans le code applicatif.
  const manifestePython =
    Boolean(context.manifests['requirements.txt'] || context.manifests['pyproject.toml']) ||
    hasFile(/(^|\/)(Pipfile|setup\.py|setup\.cfg|environment\.yml|conda\.yaml|tox\.ini)$/);
  if (manifestePython || found.has('django') || found.has('flask') || found.has('fastapi')) {
    found.add('python');
  } else if (pythonSource.length >= 3) {
    const lignesPython = pythonSource.reduce((total, f) => total + (f.readable ? f.lineCount : 0), 0);
    const lignesCode = context
      .sources({ includeTests: true })
      .reduce((total, f) => total + (estLangageDeCode(f.language) && f.readable ? f.lineCount : 0), 0);
    if (lignesCode > 0 && lignesPython / lignesCode >= 0.15) found.add('python');
  }

  // Le manifeste natif est parfois le seul indice : un projet Tauri se
  // reconnait a son `src-tauri`, une app Android a son AndroidManifest.
  if (hasFile(/(^|\/)src-tauri\//) || hasFile(/(^|\/)tauri\.conf\.json$/)) found.add('tauri');
  if (hasFile(/(^|\/)AndroidManifest\.xml$/)) found.add('android');
  if (hasFile(/(^|\/)Info\.plist$/) || hasFile(/\.xcodeproj\//)) found.add('ios');
  if (hasFile(/(^|\/)capacitor\.config\.(ts|js|json)$/)) found.add('capacitor');

  if (hasFile(/(^|\/)(pages|app)\/.*\.(jsx?|tsx?)$/) && found.has('nextjs')) found.add('nextjs-router');
  if (hasFile(/(^|\/)index\.html$/)) found.add('static-site');
  if (hasFile(/(^|\/)Dockerfile/i)) found.add('docker');
  if (hasFile(/\.github\/workflows\//)) found.add('github-actions');

  return [...found];
}

/**
 * Plateformes visees par le projet.
 *
 * Distinction indispensable : une application React Native depend de `react`,
 * ce qui suffisait a la faire passer pour un site et a lui reprocher l'absence
 * de robots.txt. Le SEO, les balises meta et le rendu serveur n'ont aucun sens
 * hors du web. Un projet peut viser plusieurs plateformes (Capacitor, Tauri).
 */
const PLATEFORMES = {
  mobile: ['react-native', 'flutter', 'expo', 'capacitor', 'ionic', 'nativescript', 'android', 'ios'],
  desktop: ['electron', 'tauri'],
  web: [
    'static-site', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix',
    'react', 'vue', 'angular', 'svelte', 'react-router', 'vue-router',
    'django', 'flask', 'fastapi', 'laravel', 'symfony', 'rails', 'spring',
    'express', 'fastify', 'koa', 'nestjs',
  ],
};

function detectPlatforms(frameworks) {
  const set = new Set(frameworks);
  const cibles = new Set();
  for (const [plateforme, ids] of Object.entries(PLATEFORMES)) {
    if (ids.some((id) => set.has(id))) cibles.add(plateforme);
  }

  // Une app mobile ou bureau ecrite en React embarque forcement `react` : la
  // presence d'une plateforme native l'emporte, sauf si le projet expose aussi
  // une vraie cible web (un site compagnon, ou une coquille Capacitor servie
  // depuis un index.html — auquel cas les deux sont vraies).
  if ((cibles.has('mobile') || cibles.has('desktop')) && cibles.has('web')) {
    const webPropre = frameworks.some((id) =>
      ['nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix', 'django', 'flask',
       'fastapi', 'laravel', 'symfony', 'rails', 'spring', 'express', 'fastify',
       'koa', 'nestjs'].includes(id),
    );
    if (!webPropre) cibles.delete('web');
  }

  if (cibles.size === 0) cibles.add('inconnu');
  return [...cibles];
}

/**
 * Langages de configuration et de donnees.
 *
 * Les compter dans la repartition fausse la lecture : un projet Expo de neuf
 * fichiers affichait « json 32 % », ce qui ecrasait la part reelle du code
 * applicatif et faisait remonter un script isole a un rang trompeur.
 */
const LANGAGES_DE_CONFIGURATION = new Set([
  'json', 'yaml', 'toml', 'ini', 'dotenv', 'markdown', 'text', 'xml', 'plist',
  'properties', 'lock', 'csv', 'unknown',
]);

function estLangageDeCode(langage) {
  return !LANGAGES_DE_CONFIGURATION.has(langage);
}

function summarizeStack(context) {
  const counts = [...context.byLanguage.entries()]
    .filter(([lang]) => lang !== 'unknown')
    .map(([lang, files]) => ({
      language: lang,
      files: files.length,
      lines: files.reduce((sum, f) => sum + (f.readable ? f.lineCount : 0), 0),
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      code: estLangageDeCode(lang),
    }))
    .sort((a, b) => b.lines - a.lines);
  return counts;
}

/**
 * Ce que le projet *est*, en une ligne.
 *
 * La liste brute des frameworks detectes les met tous sur le meme plan :
 * « react, react-native, expo, node, python » ne dit pas qu'il s'agit d'une
 * application mobile Expo. L'ordre va du plus specifique au plus general,
 * et le premier trouve gagne.
 */
const IDENTITES = [
  { id: 'expo', label: 'React Native (Expo)' },
  { id: 'react-native', label: 'React Native' },
  { id: 'flutter', label: 'Flutter' },
  { id: 'capacitor', label: 'Capacitor' },
  { id: 'ionic', label: 'Ionic' },
  { id: 'tauri', label: 'Tauri' },
  { id: 'electron', label: 'Electron' },
  { id: 'nextjs', label: 'Next.js' },
  { id: 'nuxt', label: 'Nuxt' },
  { id: 'sveltekit', label: 'SvelteKit' },
  { id: 'remix', label: 'Remix' },
  { id: 'gatsby', label: 'Gatsby' },
  { id: 'astro', label: 'Astro' },
  { id: 'angular', label: 'Angular' },
  { id: 'nestjs', label: 'NestJS' },
  { id: 'django', label: 'Django' },
  { id: 'fastapi', label: 'FastAPI' },
  { id: 'flask', label: 'Flask' },
  { id: 'laravel', label: 'Laravel' },
  { id: 'symfony', label: 'Symfony' },
  { id: 'rails', label: 'Ruby on Rails' },
  { id: 'spring', label: 'Spring Boot' },
  { id: 'express', label: 'Express' },
  { id: 'fastify', label: 'Fastify' },
  { id: 'koa', label: 'Koa' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'android', label: 'Android natif' },
  { id: 'ios', label: 'iOS natif' },
  { id: 'static-site', label: 'Site statique' },
];

function describeProject(context) {
  const identite = IDENTITES.find((candidat) => context.frameworks.includes(candidat.id));
  const principal = context.stack.find((s) => s.code);
  if (identite) return identite.label;
  return principal ? `Projet ${principal.language}` : 'Projet';
}

/** Parseur YAML minimal : suffisant pour pubspec.yaml (cles/valeurs, 1 niveau). */
function parseSimpleYaml(text) {
  const result = {};
  const stack = [{ indent: -1, node: result }];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const match = /^([\w.\-/]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (value === '') {
      parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return result;
}

/** Parseur TOML minimal : sections + cles simples. */
function parseSimpleToml(text) {
  const result = {};
  let section = result;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].split('.').reduce((node, part) => {
        node[part] = node[part] || {};
        return node[part];
      }, result);
      continue;
    }
    const kv = /^([\w.\-"']+)\s*=\s*(.+)$/.exec(line);
    if (kv) section[kv[1].replace(/["']/g, '')] = kv[2].replace(/^["']|["'],?$/g, '');
  }
  return result;
}

function parseRequirements(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('#')[0].trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([A-Za-z0-9._\-[\]]+)\s*([<>=!~^].*)?$/.exec(line);
      return match ? { name: match[1], range: (match[2] || '').trim() } : null;
    })
    .filter(Boolean);
}
