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
import { renderJson, renderMarkdown, renderSarif } from './src/report/formats.js';

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

/**
 * Nom de fichier deduit d'une adresse.
 *
 * Le nom compte : plusieurs regles s'appuient sur la convention
 * (`index.html` est une page d'accueil, `404.html` une page d'erreur), et
 * l'attribuer au hasard fausserait l'analyse.
 */
function nomDeFichier(url) {
  try {
    const chemin = new URL(url).pathname;
    if (!chemin || chemin === '/') return 'index.html';
    const dernier = chemin.replace(/\/$/, '').split('/').pop();
    if (!dernier) return 'index.html';
    return /\.[a-z0-9]+$/i.test(dernier) ? dernier : `${dernier}.html`;
  } catch {
    return 'index.html';
  }
}

/**
 * Recupere une page distante.
 *
 * Le navigateur interdit de lire librement un autre site : c'est la politique
 * de meme origine, et c'est une protection, pas un defaut. Un serveur
 * intermediaire la contournerait — au prix d'envoyer l'adresse de
 * l'utilisateur a un tiers, ce qui renierait la promesse de cette page. On
 * essaie donc directement et on explique quand ca ne passe pas.
 */
export async function recupererPage(url) {
  let adresse;
  try {
    adresse = new URL(url);
  } catch {
    throw Object.assign(new Error('Cette adresse n\'est pas valide.'), { genre: 'adresse' });
  }

  if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
    throw Object.assign(new Error('Seules les adresses http et https sont lisibles.'), { genre: 'adresse' });
  }

  let reponse;
  try {
    reponse = await fetch(adresse.href, { redirect: 'follow' });
  } catch {
    throw Object.assign(
      new Error(
        'Ce site n\'autorise pas la lecture depuis un autre domaine. ' +
          'C\'est le comportement par defaut du web et il protege ses visiteurs.',
      ),
      { genre: 'cors' },
    );
  }

  if (!reponse.ok) {
    throw Object.assign(new Error(`Le serveur a repondu ${reponse.status}.`), { genre: 'http' });
  }

  const type = reponse.headers.get('content-type') || '';
  if (type && !/html|xml|text\/plain/i.test(type)) {
    throw Object.assign(
      new Error(`Cette adresse renvoie « ${type.split(';')[0]} », pas une page HTML.`),
      { genre: 'type' },
    );
  }

  return reponse.text();
}

/**
 * Analyse une page unique, recuperee ou collee.
 *
 * Les categories sont restreintes a ce qu'un document isole permet de juger.
 * Le code mort et les dependances demandent un projet ; les affirmer sur une
 * seule page produirait des constats faux.
 */
export async function analyserPage({ html, url = '' }, onEvent = () => {}) {
  if (!html || !html.trim()) throw new Error('Aucun contenu a analyser.');

  const nom = nomDeFichier(url);
  monter([[`page/${nom}`, html]]);

  const config = loadConfig('/page', {
    baseline: null,
    useGitignore: false,
    categories: ['seo', 'design', 'performance', 'routes', 'security'],
    siteUrl: url || undefined,
  });

  return new Engine(config, { onEvent }).run();
}

export { renderHtml, renderMarkdown, renderJson, renderSarif };

/** Le navigateur prend-il en charge le choix d'un dossier ? */
export const supporteChoixDeDossier = typeof globalThis.showDirectoryPicker === 'function';
