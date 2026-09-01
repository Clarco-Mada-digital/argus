/**
 * Micro moteur de glob (sous-ensemble de gitignore) sans dependance.
 * Supporte : *, **, ?, [abc], {a,b}, prefixe ! (negation), suffixe / (dossier).
 */

const cache = new Map();

export function globToRegExp(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);

  let source = '';
  let i = 0;
  const anchored = pattern.includes('/') && !pattern.startsWith('**/');

  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` consomme zero ou plusieurs segments.
        if (pattern[i + 2] === '/') {
          source += '(?:[^/]*\\/)*';
          i += 3;
        } else {
          source += '.*';
          i += 2;
        }
      } else {
        source += '[^/]*';
        i += 1;
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }

    if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        i += 1;
      } else {
        let body = pattern.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        source += `[${body}]`;
        i = close + 1;
      }
      continue;
    }

    if (char === '{') {
      const close = pattern.indexOf('}', i + 1);
      if (close === -1) {
        source += '\\{';
        i += 1;
      } else {
        const options = pattern.slice(i + 1, close).split(',');
        source += `(?:${options.map(escapeLiteral).join('|')})`;
        i = close + 1;
      }
      continue;
    }

    source += escapeLiteral(char);
    i += 1;
  }

  const prefix = anchored ? '^' : '^(?:.*\\/)?';
  const regex = new RegExp(`${prefix}${source}$`);
  cache.set(pattern, regex);
  return regex;
}

function escapeLiteral(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Ensemble de patterns avec gestion des negations, comme un .gitignore.
 */
export class Matcher {
  constructor(patterns = []) {
    this.rules = [];
    this.add(patterns);
  }

  add(patterns) {
    for (const raw of patterns) {
      if (!raw) continue;
      const trimmed = String(raw).trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const negated = trimmed.startsWith('!');
      let pattern = negated ? trimmed.slice(1) : trimmed;
      const dirOnly = pattern.endsWith('/');
      if (dirOnly) pattern = pattern.slice(0, -1);
      if (pattern.startsWith('./')) pattern = pattern.slice(2);
      if (pattern.startsWith('/')) pattern = pattern.slice(1);
      if (!pattern) continue;

      this.rules.push({ regex: globToRegExp(pattern), negated, dirOnly });
      // Un pattern de dossier doit aussi capturer tout son contenu.
      this.rules.push({ regex: globToRegExp(`${pattern}/**`), negated, dirOnly: false });
    }
    return this;
  }

  /** @param {string} relativePath chemin POSIX relatif a la racine du projet */
  matches(relativePath, isDirectory = false) {
    let result = false;
    for (const rule of this.rules) {
      if (rule.dirOnly && !isDirectory) continue;
      if (rule.regex.test(relativePath)) result = !rule.negated;
    }
    return result;
  }

  get size() {
    return this.rules.length;
  }
}
