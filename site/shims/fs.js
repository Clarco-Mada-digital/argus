/**
 * Systeme de fichiers virtuel, en memoire.
 *
 * Le navigateur ne donne pas d'acces synchrone au disque. On charge donc une
 * fois le dossier choisi par l'utilisateur, puis on sert `node:fs` depuis cette
 * carte — ce qui laisse le coeur d'Argus inchange : config.js, lockfiles.js et
 * les analyseurs continuent d'appeler readFileSync sans rien savoir du contexte.
 */
const fichiers = new Map();   // chemin absolu -> contenu texte
const dossiers = new Set(['/']);

export function monter(entrees) {
  fichiers.clear();
  dossiers.clear();
  dossiers.add('/');
  for (const [chemin, contenu] of entrees) {
    const absolu = chemin.startsWith('/') ? chemin : `/${chemin}`;
    fichiers.set(absolu, contenu);
    let parent = absolu.slice(0, absolu.lastIndexOf('/')) || '/';
    while (parent && !dossiers.has(parent)) {
      dossiers.add(parent);
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    }
  }
  return fichiers.size;
}

export function existsSync(chemin) {
  const c = normaliser(chemin);
  return fichiers.has(c) || dossiers.has(c);
}

export function readFileSync(chemin) {
  const c = normaliser(chemin);
  if (!fichiers.has(c)) {
    const erreur = new Error(`ENOENT: no such file or directory, open '${chemin}'`);
    erreur.code = 'ENOENT';
    throw erreur;
  }
  return fichiers.get(c);
}

export function statSync(chemin) {
  const c = normaliser(chemin);
  const estFichier = fichiers.has(c);
  if (!estFichier && !dossiers.has(c)) {
    const erreur = new Error(`ENOENT: ${chemin}`);
    erreur.code = 'ENOENT';
    throw erreur;
  }
  return {
    size: estFichier ? fichiers.get(c).length : 0,
    mtimeMs: 0,
    isFile: () => estFichier,
    isDirectory: () => !estFichier,
  };
}

export function readdirSync(chemin, options = {}) {
  const base = normaliser(chemin).replace(/\/$/, '');
  const enfants = new Map();
  for (const c of [...fichiers.keys(), ...dossiers]) {
    if (c === base || !c.startsWith(`${base}/`)) continue;
    const reste = c.slice(base.length + 1);
    const nom = reste.split('/')[0];
    if (!nom) continue;
    enfants.set(nom, fichiers.has(`${base}/${nom}`));
  }
  const noms = [...enfants.keys()].sort();
  if (!options.withFileTypes) return noms;
  return noms.map((nom) => ({
    name: nom,
    isFile: () => enfants.get(nom),
    isDirectory: () => !enfants.get(nom),
    isSymbolicLink: () => false,
  }));
}

/* Ecritures : sans objet dans le navigateur, mais appelees par le coeur. */
export function mkdirSync() {}
export function writeFileSync(chemin, contenu) { fichiers.set(normaliser(chemin), contenu); }
export function rmSync() {}

function normaliser(chemin) {
  const texte = String(chemin);
  return texte.startsWith('/') ? texte.replace(/\/+/g, '/') : `/${texte}`.replace(/\/+/g, '/');
}

export const promises = {
  readdir: async (c, o) => readdirSync(c, o),
  stat: async (c) => statSync(c),
  realpath: async (c) => normaliser(c),
  readFile: async (c) => readFileSync(c),
};

export default { existsSync, readFileSync, statSync, readdirSync, mkdirSync, writeFileSync, rmSync, promises, monter };
