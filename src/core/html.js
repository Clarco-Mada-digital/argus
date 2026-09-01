/**
 * Mini parseur HTML tolerant, sans dependance.
 * Il ne construit pas un DOM complet : il produit une liste plate de balises
 * avec leurs attributs, offsets et profondeur — largement suffisant pour le
 * SEO et l'accessibilite, et robuste face aux templates (Jinja, Blade, EJS…).
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:_.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

class HtmlNode {
  constructor(tag, attrs, start, end, depth) {
    this.tag = tag;
    this.attrs = attrs;
    this.start = start;
    this.end = end;
    this.depth = depth;
    this.text = '';
    this.parents = [];
    this.selfClosing = false;
  }

  attr(name) {
    return this.attrs[name.toLowerCase()] ?? null;
  }

  has(name) {
    return Object.hasOwn(this.attrs, name.toLowerCase());
  }

  get id() {
    return this.attr('id');
  }

  get classes() {
    return (this.attr('class') || '').split(/\s+/).filter(Boolean);
  }

  /** Est-ce que la balise est dans un template conditionnel/dynamique ? */
  get isDynamic() {
    return Object.values(this.attrs).some((v) => typeof v === 'string' && /\{\{|\{%|<%|\$\{|\{\w/.test(v));
  }
}

export function parseHtml(source) {
  const nodes = [];
  const stack = [];
  let match;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(source)) !== null) {
    const [full, closing, rawTag, rawAttrs, selfClose] = match;
    const tag = rawTag.toLowerCase();
    const start = match.index;
    const end = start + full.length;

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) {
          const node = stack[i];
          node.closeStart = start;
          node.text = decodeEntities(stripTags(source.slice(node.end, start)));
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const node = new HtmlNode(tag, parseAttributes(rawAttrs), start, end, stack.length);
    node.parents = stack.map((n) => n.tag);
    node.selfClosing = Boolean(selfClose) || VOID_ELEMENTS.has(tag);
    nodes.push(node);

    if (!node.selfClosing) {
      stack.push(node);
      if (RAW_TEXT_ELEMENTS.has(tag)) {
        // On saute le contenu brut pour ne pas parser du JS comme du HTML.
        const closeIndex = source.toLowerCase().indexOf(`</${tag}`, end);
        if (closeIndex !== -1) {
          node.closeStart = closeIndex;
          node.text = source.slice(end, closeIndex);
          stack.pop();
          TAG_RE.lastIndex = closeIndex;
        }
      }
    }
  }

  return nodes;
}

function parseAttributes(raw) {
  const attrs = {};
  if (!raw) return attrs;
  const re = /([a-zA-Z_@:#$[\](){}.*-][a-zA-Z0-9_@:#$[\](){}.*-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'e',
  egrave: 'e', agrave: 'a', ccedil: 'c', ugrave: 'u', ocirc: 'o', copy: '(c)',
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, code) => {
    if (code[0] === '#') {
      const value = code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : full;
    }
    return ENTITIES[code.toLowerCase()] ?? full;
  });
}

/** Compte les mots du contenu visible : base des regles SEO de densite. */
export function visibleWordCount(source) {
  const text = stripTags(source);
  return text ? text.split(/\s+/).filter((w) => w.length > 1).length : 0;
}

/**
 * Un fichier HTML « page » (document complet) plutot qu'un fragment/partial.
 * Les regles SEO ne s'appliquent qu'aux pages completes.
 */
export function isFullPage(source) {
  return /<html[\s>]/i.test(source) || /<!doctype\s+html/i.test(source) || /<head[\s>]/i.test(source);
}
