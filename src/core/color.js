/**
 * Utilitaires couleur pour les regles de design/accessibilite :
 * parsing CSS, luminance relative et contraste WCAG 2.1.
 */

const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128],
  gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], navy: [0, 0, 128],
  teal: [0, 128, 128], olive: [128, 128, 0], maroon: [128, 0, 0], lime: [0, 255, 0],
  aqua: [0, 255, 255], cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255],
  transparent: null, inherit: null, currentcolor: null, initial: null, unset: null,
};

/** @returns {{r:number,g:number,b:number,a:number}|null} */
export function parseColor(value) {
  if (!value) return null;
  const input = String(value).trim().toLowerCase();

  if (Object.hasOwn(NAMED_COLORS, input)) {
    const rgb = NAMED_COLORS[input];
    return rgb ? { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 } : null;
  }

  const hex = /^#([0-9a-f]{3,8})$/.exec(input);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map((c) => Number.parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const r = Number.parseInt(h.slice(0, 2), 16);
      const g = Number.parseInt(h.slice(2, 4), 16);
      const b = Number.parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(input);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map((p) => p.trim());
    if (parts.length < 3) return null;
    const toByte = (p) => (p.endsWith('%') ? Math.round((Number.parseFloat(p) / 100) * 255) : Number.parseFloat(p));
    const a = parts[3] === undefined ? 1 : (parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]));
    return { r: toByte(parts[0]), g: toByte(parts[1]), b: toByte(parts[2]), a };
  }

  const hsl = /^hsla?\(([^)]+)\)$/.exec(input);
  if (hsl) {
    const parts = hsl[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0]) / 360;
    const s = Number.parseFloat(parts[1]) / 100;
    const l = Number.parseFloat(parts[2]) / 100;
    const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3]);
    const [r, g, b] = hslToRgb(h, s, l);
    return { r, g, b, a };
  }

  return null;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

/** Luminance relative WCAG. */
function relativeLuminance({ r, g, b }) {
  const toLinear = (channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Ratio de contraste WCAG (1 a 21). */
export function contrastRatio(colorA, colorB) {
  const a = typeof colorA === 'string' ? parseColor(colorA) : colorA;
  const b = typeof colorB === 'string' ? parseColor(colorB) : colorB;
  if (!a || !b) return null;
  const flatA = a.a < 1 ? blendOnWhite(a) : a;
  const flatB = b.a < 1 ? blendOnWhite(b) : b;
  const l1 = relativeLuminance(flatA);
  const l2 = relativeLuminance(flatB);
  const [high, low] = l1 > l2 ? [l1, l2] : [l2, l1];
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

function blendOnWhite(color) {
  return {
    r: Math.round(color.r * color.a + 255 * (1 - color.a)),
    g: Math.round(color.g * color.a + 255 * (1 - color.a)),
    b: Math.round(color.b * color.a + 255 * (1 - color.a)),
    a: 1,
  };
}

export function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Niveau WCAG atteint pour un ratio et une taille de texte. */
export function wcagLevel(ratio, isLargeText = false) {
  const aa = isLargeText ? 3 : 4.5;
  const aaa = isLargeText ? 4.5 : 7;
  if (ratio >= aaa) return 'AAA';
  if (ratio >= aa) return 'AA';
  return 'fail';
}

/** Convertit une longueur CSS en pixels (approximation raisonnable). */
export function toPixels(value, { rootFontSize = 16, parentFontSize = 16 } = {}) {
  if (!value) return null;
  const match = /^(-?[\d.]+)\s*(px|rem|em|pt|%|vh|vw)?$/.exec(String(value).trim());
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  switch (match[2]) {
    case 'rem': return number * rootFontSize;
    case 'em': return number * parentFontSize;
    case 'pt': return number * (96 / 72);
    case '%': return (number / 100) * parentFontSize;
    case undefined:
    case 'px': return number;
    default: return null;
  }
}
