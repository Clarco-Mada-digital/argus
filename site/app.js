/**
 * Point d'entree navigateur d'Argus.
 *
 * Le coeur d'Argus n'est pas modifie : une carte d'imports redirige `node:fs`,
 * `node:path` et consorts vers les shims, et le dossier choisi par
 * l'utilisateur est charge dans un systeme de fichiers en memoire.
 *
 * `./src` est un lien symbolique vers le coeur du projet. La disposition du
 * site publie est ainsi identique a celle du depot : ce qui fonctionne en
 * ouvrant le fichier en local fonctionne une fois deploye — sans reecriture
 * de chemins a l'assemblage, donc sans divergence possible.
 *
 * Rien ne quitte la machine : il n'y a pas de serveur. La page lit les fichiers
 * localement et affiche le resultat.
 */
import { monter } from './shims/fs.js';
import { loadConfig } from './src/core/config.js';
import { Engine } from './src/core/engine.js';
import { renderHtml } from './src/report/html.js';

/** Extensions volumineuses et sans interet pour l'analyse : on ne les lit pas. */
const IGNORER = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|vendor|__pycache__|\.venv|target|\.dart_tool)\//;
const BINAIRE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|mp4|webm|mp3|wav|woff2?|ttf|otf|eot|zip|gz|tar|pdf|so|dll|exe|jar|wasm|pyc|class)$/i;
const TAILLE_MAX = 2 * 1024 * 1024;

/**
 * Parcourt un dossier choisi via l'API d'acces au systeme de fichiers.
 * @returns {Promise<Array<[string, string]>>} couples (chemin, contenu)
 */
export async function lireDossier(handle, onProgress = () => {}) {
  const entrees = [];
  const racine = handle.name;

  async function descendre(dossier, prefixe) {
    for await (const [nom, enfant] of dossier.entries()) {
      const chemin = prefixe ? `${prefixe}/${nom}` : nom;
      if (IGNORER.test(`${chemin}/`)) continue;

      if (enfant.kind === 'directory') {
        await descendre(enfant, chemin);
        continue;
      }

      const fichier = await enfant.getFile();
      // Les binaires comptent pour leur taille (regles de performance) mais
      // leur contenu n'est jamais lu.
      const contenu = BINAIRE.test(nom) || fichier.size > TAILLE_MAX ? '' : await fichier.text();
      entrees.push([`${racine}/${chemin}`, contenu]);
      if (entrees.length % 50 === 0) onProgress(entrees.length);
    }
  }

  await descendre(handle, '');
  return { entrees, racine };
}

/** Repli pour les navigateurs sans API d'acces : <input webkitdirectory>. */
export async function lireDepuisInput(fileList, onProgress = () => {}) {
  const entrees = [];
  const racine = fileList[0]?.webkitRelativePath.split('/')[0] || 'projet';

  for (const fichier of fileList) {
    const chemin = fichier.webkitRelativePath;
    if (IGNORER.test(`${chemin}/`)) continue;
    const contenu = BINAIRE.test(fichier.name) || fichier.size > TAILLE_MAX ? '' : await fichier.text();
    entrees.push([chemin, contenu]);
    if (entrees.length % 50 === 0) onProgress(entrees.length);
  }

  return { entrees, racine };
}

/** Lance l'analyse sur le dossier charge en memoire. */
export async function analyser({ entrees, racine }, onEvent = () => {}) {
  monter(entrees);

  const config = loadConfig(`/${racine}`, {
    // Ces fonctionnalites supposent un disque accessible en ecriture ou Git.
    baseline: null,
    useGitignore: true,
  });

  const resultat = await new Engine(config, { onEvent }).run();
  return resultat;
}

export { renderHtml };

/** Le navigateur prend-il en charge le choix d'un dossier ? */
export const supporteChoixDeDossier = typeof globalThis.showDirectoryPicker === 'function';
