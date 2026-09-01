/**
 * Implementation POSIX minimale de `node:path`, pour le navigateur.
 * Argus manipule exclusivement des chemins relatifs en avant-slash : le
 * sous-ensemble couvert ici suffit, et evite d'embarquer une bibliotheque.
 */
function normalizeSegments(parts, allowAboveRoot) {
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (allowAboveRoot) out.push('..');
    } else out.push(part);
  }
  return out;
}

export function normalize(chemin) {
  const absolu = chemin.startsWith('/');
  const segments = normalizeSegments(chemin.split('/'), !absolu);
  const resultat = segments.join('/');
  if (absolu) return `/${resultat}`;
  return resultat || '.';
}

export function join(...morceaux) {
  const assemble = morceaux.filter(Boolean).join('/');
  return assemble ? normalize(assemble) : '.';
}

export function resolve(...morceaux) {
  let chemin = '';
  for (let i = morceaux.length - 1; i >= 0 && !chemin.startsWith('/'); i--) {
    const morceau = morceaux[i];
    if (!morceau) continue;
    chemin = chemin ? `${morceau}/${chemin}` : morceau;
  }
  if (!chemin.startsWith('/')) chemin = `/${chemin}`;
  return normalize(chemin);
}

export function relative(depuis, vers) {
  const a = resolve(depuis).split('/').filter(Boolean);
  const b = resolve(vers).split('/').filter(Boolean);
  let commun = 0;
  while (commun < a.length && commun < b.length && a[commun] === b[commun]) commun++;
  return [...Array(a.length - commun).fill('..'), ...b.slice(commun)].join('/');
}

export function dirname(chemin) {
  const i = chemin.replace(/\/+$/, '').lastIndexOf('/');
  if (i === -1) return '.';
  return i === 0 ? '/' : chemin.slice(0, i);
}

export function basename(chemin, suffixe) {
  const nom = chemin.replace(/\/+$/, '').split('/').pop() || '';
  return suffixe && nom.endsWith(suffixe) ? nom.slice(0, -suffixe.length) : nom;
}

export function extname(chemin) {
  const nom = basename(chemin);
  const i = nom.lastIndexOf('.');
  return i <= 0 ? '' : nom.slice(i);
}

export const sep = '/';
export const posix = { normalize, join, resolve, relative, dirname, basename, extname, sep };
export default { normalize, join, resolve, relative, dirname, basename, extname, sep, posix };
