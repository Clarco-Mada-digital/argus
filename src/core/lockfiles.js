import fs from 'node:fs';
import path from 'node:path';
import { stripJsonComments } from './config.js';
import { minimumSatisfying } from './semver.js';

/**
 * Lecture des fichiers de verrouillage : ils donnent les versions *reellement*
 * installees, seule base fiable pour une recherche de vulnerabilites.
 *
 * En leur absence, on retombe sur la version minimale satisfaisant la plage
 * declaree — approximation explicitement signalee dans le rapport.
 */

/** @returns {Array<{name:string, version:string, ecosystem:string, exact:boolean, direct:boolean}>} */
export function resolveInstalledVersions(context) {
  const root = context.root;
  const resolved = new Map();

  const add = (entry) => {
    const key = `${entry.ecosystem}:${entry.name}`;
    // Une version exacte l'emporte toujours sur une approximation.
    const existing = resolved.get(key);
    if (existing && existing.exact && !entry.exact) return;
    resolved.set(key, entry);
  };

  for (const [reader, file] of [
    [readPackageLock, 'package-lock.json'],
    [readPackageLock, 'npm-shrinkwrap.json'],
    [readYarnLock, 'yarn.lock'],
    [readPnpmLock, 'pnpm-lock.yaml'],
    [readComposerLock, 'composer.lock'],
    [readPubspecLock, 'pubspec.lock'],
    [readCargoLock, 'Cargo.lock'],
    [readPoetryLock, 'poetry.lock'],
  ]) {
    const full = path.join(root, file);
    // argus-disable-next-line — lecture de configuration, une seule fois au demarrage
    if (!fs.existsSync(full)) continue;
    try {
      for (const entry of reader(fs.readFileSync(full, 'utf8'))) add(entry);
    } catch {
      /* un fichier de verrouillage illisible ne doit pas interrompre l'analyse */
    }
  }

  // Dependances Python epinglees dans requirements.txt (`paquet==1.2.3`).
  for (const dep of context.dependencies.values()) {
    if (dep.ecosystem !== 'pypi') continue;
    const pinned = /^\s*==\s*([\w.+-]+)/.exec(dep.range || '');
    if (pinned) add({ name: dep.name, version: pinned[1], ecosystem: 'PyPI', exact: true, direct: true });
  }

  // Completion par approximation pour tout ce qui n'a pas ete resolu.
  const ecosystems = { npm: 'npm', pypi: 'PyPI', pub: 'Pub' };
  for (const dep of context.dependencies.values()) {
    const ecosystem = ecosystems[dep.ecosystem];
    if (!ecosystem) continue;
    if (resolved.has(`${ecosystem}:${dep.name}`)) continue;
    const guessed = minimumSatisfying(dep.range);
    if (!guessed) continue;
    add({ name: dep.name, version: guessed, ecosystem, exact: false, direct: true });
  }

  // Marque les dependances directes (celles du manifeste) : elles sont
  // actionnables, contrairement aux transitives.
  const direct = new Set([...context.dependencies.keys()]);
  return [...resolved.values()].map((entry) => ({ ...entry, direct: direct.has(entry.name) }));
}

function readPackageLock(content) {
  const data = JSON.parse(stripJsonComments(content));
  const entries = [];

  // Format v2/v3 : carte `packages` indexee par chemin d'installation.
  for (const [location, info] of Object.entries(data.packages || {})) {
    if (!location || !info?.version) continue;
    const name = info.name || location.split('node_modules/').pop();
    if (!name) continue;
    entries.push({ name, version: info.version, ecosystem: 'npm', exact: true });
  }

  // Format v1 : arbre `dependencies` recursif.
  const walk = (tree) => {
    for (const [name, info] of Object.entries(tree || {})) {
      if (info?.version) entries.push({ name, version: info.version, ecosystem: 'npm', exact: true });
      if (info?.dependencies) walk(info.dependencies);
    }
  };
  if (entries.length === 0) walk(data.dependencies);

  return entries;
}

function readYarnLock(content) {
  const entries = [];
  let currentNames = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^["\w@]/.test(line) && line.trimEnd().endsWith(':')) {
      currentNames = line
        .replace(/:$/, '')
        .split(',')
        .map((part) => part.trim().replace(/^"|"$/g, ''))
        .map((spec) => {
          const at = spec.lastIndexOf('@');
          return at > 0 ? spec.slice(0, at) : spec;
        });
      continue;
    }
    const version = /^\s+"?version"?\s*:?\s*"?([\w.+-]+)"?/.exec(line);
    if (version && currentNames.length > 0) {
      for (const name of new Set(currentNames)) {
        entries.push({ name, version: version[1], ecosystem: 'npm', exact: true });
      }
      currentNames = [];
    }
  }
  return entries;
}

function readPnpmLock(content) {
  const entries = [];
  // Entrees de la forme `/paquet@1.2.3:` ou `/@scope/paquet/1.2.3:`.
  const re = /^\s{2}\/?((?:@[\w.-]+\/)?[\w.-]+)[@/](\d[\w.+-]*)\s*:/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    entries.push({ name: match[1], version: match[2], ecosystem: 'npm', exact: true });
  }
  return entries;
}

function readComposerLock(content) {
  const data = JSON.parse(content);
  return [...(data.packages || []), ...(data['packages-dev'] || [])]
    .filter((pkg) => pkg?.name && pkg?.version)
    .map((pkg) => ({ name: pkg.name, version: String(pkg.version).replace(/^v/, ''), ecosystem: 'Packagist', exact: true }));
}

function readPubspecLock(content) {
  const entries = [];
  const re = /^ {2}([\w_]+):\s*$[\s\S]*?^ {4}version:\s*"?([\w.+-]+)"?/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    entries.push({ name: match[1], version: match[2], ecosystem: 'Pub', exact: true });
  }
  return entries;
}

function readCargoLock(content) {
  const entries = [];
  const re = /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    entries.push({ name: match[1], version: match[2], ecosystem: 'crates.io', exact: true });
  }
  return entries;
}

function readPoetryLock(content) {
  const entries = [];
  const re = /\[\[package\]\][\s\S]*?name\s*=\s*"([^"]+)"[\s\S]*?version\s*=\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    entries.push({ name: match[1], version: match[2], ecosystem: 'PyPI', exact: true });
  }
  return entries;
}
