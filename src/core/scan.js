import { COMMENT_SYNTAX } from './languages.js';

/**
 * Index des debuts de ligne : convertit un offset en ligne en O(log n).
 * Indispensable, les analyseurs font des milliers de conversions.
 */
export class LineIndex {
  constructor(source) {
    this.source = source;
    this.starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  lineOf(offset) {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  columnOf(offset) {
    return offset - this.starts[this.lineOf(offset) - 1] + 1;
  }

  position(offset) {
    const line = this.lineOf(offset);
    return { line, column: offset - this.starts[line - 1] + 1 };
  }

  textOfLine(line) {
    const start = this.starts[line - 1];
    if (start === undefined) return '';
    const end = this.starts[line] ?? this.source.length + 1;
    return this.source.slice(start, end - 1).replace(/\r$/, '');
  }
}

const indexCache = new WeakMap();

/** Index memorise par fichier (les analyseurs se le partagent). */
export function lineIndexFor(file) {
  let index = indexCache.get(file);
  if (!index || index.source !== file.content) {
    index = new LineIndex(file.content);
    indexCache.set(file, index);
  }
  return index;
}

const maskCache = new WeakMap();

/**
 * Remplace le contenu des commentaires et des chaines par des espaces, en
 * conservant les offsets. Permet de chercher du code sans matcher du texte
 * commente : la premiere cause de faux positifs en analyse par motifs.
 */
export function maskedSource(file) {
  const cached = maskCache.get(file);
  if (cached && cached.source === file.content) return cached.masked;
  const masked = maskCommentsAndStrings(file.content, file.family);
  maskCache.set(file, { source: file.content, masked });
  return masked;
}

/**
 * Plages occupees par des commentaires.
 *
 * Distincte du masquage complet, qui blanchit aussi les chaines : une regle
 * qui cherche un litteral a besoin des chaines mais pas des commentaires.
 * Sans cette distinction, `# exemple : "http://domaine.tld/x"` etait signale
 * comme un appel en clair — sur une bibliotheque HTTP, cela representait la
 * moitie des constats.
 *
 * L'analyse est volontairement simple : elle ne suit pas les chaines, donc un
 * `#` a l'interieur d'un litteral ouvre une fausse plage. Le risque est
 * asymetrique et assume — au pire on ignore un constat, jamais on n'en invente.
 */
const PLAGES_DE_COMMENTAIRE = new WeakMap();

export function plagesDeCommentaire(file) {
  if (PLAGES_DE_COMMENTAIRE.has(file)) return PLAGES_DE_COMMENTAIRE.get(file);

  const syntaxe = COMMENT_SYNTAX[file.language] || COMMENT_SYNTAX[file.family] || null;
  const plages = [];

  if (syntaxe) {
    const source = file.content;
    const { line, block } = syntaxe;

    if (line) {
      let i = 0;
      while ((i = source.indexOf(line, i)) !== -1) {
        const fin = source.indexOf('\n', i);
        plages.push([i, fin === -1 ? source.length : fin]);
        i = fin === -1 ? source.length : fin;
      }
    }

    if (block) {
      const [ouvre, ferme] = block;
      let i = 0;
      while ((i = source.indexOf(ouvre, i)) !== -1) {
        const fin = source.indexOf(ferme, i + ouvre.length);
        const borne = fin === -1 ? source.length : fin + ferme.length;
        plages.push([i, borne]);
        i = borne;
      }
    }
  }

  PLAGES_DE_COMMENTAIRE.set(file, plages);
  return plages;
}

/** Cet emplacement tombe-t-il dans un commentaire ? */
export function dansUnCommentaire(file, offset) {
  return plagesDeCommentaire(file).some(([debut, fin]) => offset >= debut && offset < fin);
}

export function maskCommentsAndStrings(source, family = 'js', { keepStrings = false } = {}) {
  const syntax = COMMENT_SYNTAX[family] || COMMENT_SYNTAX.js;
  const out = source.split('');
  const len = source.length;
  let i = 0;

  const blank = (from, to) => {
    for (let k = from; k < to && k < len; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };

  while (i < len) {
    const rest = source.slice(i, i + 3);

    if (syntax.block && source.startsWith(syntax.block[0], i)) {
      const end = source.indexOf(syntax.block[1], i + syntax.block[0].length);
      const stop = end === -1 ? len : end + syntax.block[1].length;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (syntax.line && source.startsWith(syntax.line, i)) {
      let end = source.indexOf('\n', i);
      if (end === -1) end = len;
      blank(i, end);
      i = end;
      continue;
    }

    // Litteral d'expression reguliere : c'est du texte, pas du code executable
    // a analyser. Une base de regles contenant /SELECT .* FROM/ ne doit pas se
    // signaler elle-meme.
    if (!keepStrings && family === 'js' && rest[0] === '/' && startsRegExp(source, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < len) {
        const char = source[j];
        if (char === '\\') {
          j += 2;
          continue;
        }
        if (char === '\n') break; // non terminee : ce n'etait pas une regex
        if (char === '[') inClass = true;
        else if (char === ']') inClass = false;
        else if (char === '/' && !inClass) break;
        j++;
      }
      if (j < len && source[j] === '/') {
        while (j + 1 < len && /[dgimsuvy]/.test(source[j + 1])) j++;
        blank(i, j + 1);
        i = j + 1;
        continue;
      }
    }

    if (!keepStrings && (rest[0] === '"' || rest[0] === "'" || rest[0] === '`')) {
      const quote = rest[0];
      let j = i + 1;
      // Dans un gabarit, `${…}` contient du vrai code : le neutraliser ferait
      // passer pour inutilisee toute variable seulement interpolee.
      const holes = [];
      while (j < len) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (quote === '`' && source[j] === '$' && source[j + 1] === '{') {
          const start = j + 2;
          let depth = 1;
          j += 2;
          while (j < len && depth > 0) {
            if (source[j] === '{') depth++;
            else if (source[j] === '}') depth--;
            if (depth === 0) break;
            j++;
          }
          holes.push([start, j]);
          continue;
        }
        if (source[j] === quote) break;
        if (quote !== '`' && source[j] === '\n') break; // chaine non terminee
        j++;
      }
      const stop = Math.min(j + 1, len);
      blank(i, stop);
      for (const [from, to] of holes) {
        for (let k = from; k < to && k < len; k++) out[k] = source[k];
      }
      i = stop;
      continue;
    }

    i++;
  }

  return out.join('');
}

/**
 * Itere sur les correspondances d'une expression reguliere globale.
 * @param {string} source
 * @param {RegExp} regex doit porter le flag `g`
 */
export function* matches(source, regex) {
  const re = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
  re.lastIndex = 0;
  let match;
  let guard = 0;
  while ((match = re.exec(source)) !== null) {
    if (match[0] === '') re.lastIndex++;
    if (++guard > 50000) break;
    yield match;
  }
}

const REGEXP_PRECEDING_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

/**
 * Un `/` ouvre-t-il une expression reguliere plutot qu'une division ?
 * On regarde le dernier caractere significatif qui precede : apres une valeur
 * (identifiant, parenthese fermante, litteral) c'est une division.
 */
function startsRegExp(source, index) {
  let k = index - 1;
  while (k >= 0 && /\s/.test(source[k])) k--;
  if (k < 0) return true;
  const previous = source[k];
  if ('(,=:[!&|?{};+-*%~^<>'.includes(previous)) return true;
  if (/[\w$)\]]/.test(previous)) {
    return REGEXP_PRECEDING_KEYWORDS.test(source.slice(Math.max(0, k - 12), k + 1));
  }
  return false;
}

/**
 * Un offset tombe-t-il dans une chaine ou un commentaire ?
 * Sert a ignorer le balisage cite dans du code (un `<button>` ecrit dans une
 * chaine JavaScript n'est pas un bouton de l'interface).
 */
export function isQuoted(file, offset) {
  const masked = maskedSource(file);
  return masked[offset] !== file.content[offset];
}

/** Compte les occurrences d'un identifiant en tant que mot entier. */
export function countIdentifier(source, name) {
  if (!name) return 0;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'g');
  let count = 0;
  while (re.exec(source) !== null) count++;
  return count;
}

/**
 * Complexite cyclomatique approximative d'un bloc de code, tous langages :
 * on compte les points de decision.
 */
const DECISION_POINTS = /\b(if|else\s+if|elif|for|foreach|while|case|when|catch|rescue|and|or)\b|(\?\?|\?\.|&&|\|\||\?[^.:]*:)/g;

export function estimateComplexity(code) {
  let count = 1;
  for (const _ of matches(code, DECISION_POINTS)) count++;
  return count;
}

/** Longueur d'indentation d'une ligne (espaces, tab = 4). */
export function indentOf(line) {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width++;
    else if (char === '\t') width += 4;
    else break;
  }
  return width;
}

/**
 * Trouve la fin d'un bloc delimite par accolades a partir d'un offset.
 * Retourne l'offset de l'accolade fermante, ou -1.
 */
export function matchBrace(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Fin d'un bloc indente (Python, YAML…) a partir d'une ligne donnee. */
export function indentBlockEnd(lines, startLine) {
  const baseIndent = indentOf(lines[startLine] || '');
  let end = startLine + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() && indentOf(line) <= baseIndent) break;
    end++;
  }
  return end;
}
