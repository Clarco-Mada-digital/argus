import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Matcher } from './glob.js';
import { detectLanguage, familyOf, isBinary, isImage } from './languages.js';

/**
 * Represente un fichier du projet. Le contenu est charge paresseusement puis
 * memorise : plusieurs analyseurs lisent le meme fichier.
 */
class SourceFile {
  constructor(absolutePath, relativePath, stat) {
    this.path = absolutePath;
    this.relativePath = relativePath;
    this.name = path.basename(relativePath);
    this.ext = path.extname(relativePath).toLowerCase();
    this.dir = path.dirname(relativePath);
    this.size = stat.size;
    this.mtime = stat.mtimeMs;
    this.language = detectLanguage(relativePath);
    this.family = familyOf(this.language);
    this.binary = isBinary(relativePath);
    this.image = isImage(relativePath);
    this._content = null;
    this._lines = null;
    this.readable = !this.binary;
  }

  get content() {
    if (this._content === null && this.readable) {
      try {
        // argus-disable-next-line — lecture memorisee et paresseuse : la version asynchrone impliquerait de rendre asynchrone toute la chaine d'analyse
        this._content = fs.readFileSync(this.path, 'utf8');
      } catch {
        this._content = '';
        this.readable = false;
      }
    }
    return this._content || '';
  }

  get lines() {
    if (this._lines === null) {
      this._lines = this.content.split(/\r?\n/);
    }
    return this._lines;
  }

  get lineCount() {
    return this.binary ? 0 : this.lines.length;
  }

  /** Libere la memoire une fois le fichier analyse. */
  release() {
    this._content = null;
    this._lines = null;
  }

  get isTest() {
    return /(^|[./\\-])(test|tests|spec|specs|__tests__|__mocks__|e2e|cypress|fixtures?)([./\\-]|$)/i.test(
      this.relativePath,
    );
  }

  get isVendored() {
    return /(^|\/)(vendor|third_party|thirdparty|external|libs?)\//i.test(this.relativePath);
  }

  get isGenerated() {
    if (/\.(g|freezed|generated|pb|gen)\.[a-z]+$/i.test(this.name)) return true;
    if (!this.readable) return false;
    const head = this.content.slice(0, 400);
    return /@generated|GENERATED FILE|DO NOT EDIT|auto-generated/i.test(head);
  }
}

/**
 * Parcourt recursivement le projet en respectant les patterns d'exclusion.
 * @returns {Promise<{files: SourceFile[], skipped: number, totalBytes: number}>}
 */
export async function walkProject(config, { onProgress } = {}) {
  const root = path.resolve(config.root);
  const matcher = new Matcher(config.ignore);
  const files = [];
  let skipped = 0;
  let totalBytes = 0;

  const queue = [root];
  const seen = new Set();

  while (queue.length > 0 && files.length < config.maxFiles) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // argus-disable-next-line — parcours en largeur : le contenu du dossier alimente la file
      const absolute = path.join(dir, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (!relative || relative.startsWith('..')) continue;

      if (entry.isSymbolicLink()) {
        // On suit les liens mais on evite les boucles.
        let real;
        try {
          real = await fsp.realpath(absolute);
        } catch {
          continue;
        }
        if (seen.has(real) || !real.startsWith(root)) continue;
        seen.add(real);
      }

      const isDir = entry.isDirectory();
      if (matcher.matches(relative, isDir)) {
        skipped++;
        continue;
      }

      if (isDir) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;

      let stat;
      try {
        stat = await fsp.stat(absolute);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const file = new SourceFile(absolute, relative, stat);
      if (stat.size > config.maxFileSize) {
        file.readable = false;
        file.tooLarge = true;
      }
      totalBytes += stat.size;
      files.push(file);
      if (onProgress && files.length % 200 === 0) onProgress(files.length);
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, skipped, totalBytes, truncated: files.length >= config.maxFiles };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}
