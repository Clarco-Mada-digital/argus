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
    this.stack = summarizeStack(this);

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
  if (pythonSource.length > 0) found.add('python');

  if (hasFile(/(^|\/)(pages|app)\/.*\.(jsx?|tsx?)$/) && found.has('nextjs')) found.add('nextjs-router');
  if (hasFile(/(^|\/)index\.html$/)) found.add('static-site');
  if (hasFile(/(^|\/)Dockerfile/i)) found.add('docker');
  if (hasFile(/\.github\/workflows\//)) found.add('github-actions');

  return [...found];
}

function summarizeStack(context) {
  const counts = [...context.byLanguage.entries()]
    .filter(([lang]) => lang !== 'unknown')
    .map(([lang, files]) => ({
      language: lang,
      files: files.length,
      lines: files.reduce((sum, f) => sum + (f.readable ? f.lineCount : 0), 0),
      bytes: files.reduce((sum, f) => sum + f.size, 0),
    }))
    .sort((a, b) => b.lines - a.lines);
  return counts;
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
