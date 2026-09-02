import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Pilotage d'un navigateur pour mesurer un chargement reel.
 *
 * L'analyse statique dit ce qu'un fichier *contient* ; elle ne dit pas ce que
 * l'utilisateur *attend*. Une image de 800 Ko est un fait, mais son cout
 * depend de sa place dans la page, du reste qui la precede et de ce qui bloque
 * le rendu. Seul un chargement mesure repond a « combien de temps avant que ce
 * soit lisible ».
 *
 * Le pilotage passe par le protocole DevTools, en direct : pas de dependance,
 * et le meme mecanisme que `scripts/audit-responsive.js` — deja eprouve sur ce
 * projet, y compris ses pieges (un onglet reutilise garde son emulation, et le
 * cache d'un service worker fait mesurer la version precedente).
 */

const CANDIDATS = {
  linux: [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
  ],
};

/** Chemin du navigateur, ou `null` s'il n'y en a pas. */
export function trouverNavigateur() {
  if (process.env.ARGUS_NAVIGATEUR) return process.env.ARGUS_NAVIGATEUR;

  for (const candidat of CANDIDATS[process.platform] || CANDIDATS.linux) {
    if (candidat.includes(path.sep) || candidat.includes('/')) {
      if (fs.existsSync(candidat)) return candidat;
      continue;
    }
    // Nom simple : on s'en remet au PATH, teste par un lancement a vide.
    try {
      const essai = spawn(candidat, ['--version'], { stdio: 'ignore' });
      essai.kill();
      return candidat;
    } catch {
      /* absent du PATH */
    }
  }
  return null;
}

/**
 * Connexion minimale au protocole DevTools.
 * Un identifiant par message, une promesse par identifiant, les evenements
 * distribues a qui les ecoute.
 */
class Connexion {
  constructor(ws) {
    this.ws = ws;
    this.identifiant = 0;
    this.attentes = new Map();
    this.ecouteurs = new Map();

    ws.addEventListener('message', (evenement) => {
      const message = JSON.parse(evenement.data);
      if (message.id && this.attentes.has(message.id)) {
        this.attentes.get(message.id)(message);
        this.attentes.delete(message.id);
        return;
      }
      const ecouteurs = this.ecouteurs.get(message.method);
      if (ecouteurs) for (const ecouteur of ecouteurs) ecouteur(message.params);
    });
  }

  envoyer(method, params = {}) {
    return new Promise((resoudre) => {
      const n = ++this.identifiant;
      this.attentes.set(n, resoudre);
      this.ws.send(JSON.stringify({ id: n, method, params }));
    });
  }

  sur(evenement, ecouteur) {
    if (!this.ecouteurs.has(evenement)) this.ecouteurs.set(evenement, []);
    this.ecouteurs.get(evenement).push(ecouteur);
  }

  fermer() {
    this.ws.close();
  }
}

/**
 * Script injecte avant tout autre : il doit observer le chargement depuis son
 * debut, donc etre en place avant que la page commence a se construire.
 */
const SONDE = `
(() => {
  window.__argus = { lcp: 0, cls: 0, decalages: [] };
  try {
    new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) window.__argus.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) {
        // Un decalage provoque par une interaction de l'utilisateur ne compte
        // pas : c'est une reponse attendue, pas une surprise.
        if (e.hadRecentInput) continue;
        window.__argus.cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {
    /* navigateur sans ces observateurs : les mesures resteront a zero */
  }
})();
`;

/**
 * Charge une page et retourne ses mesures.
 *
 * @param {string} url
 * @param {{ attente?: number, largeur?: number, hauteur?: number, mobile?: boolean }} options
 */
export async function mesurerChargement(url, { attente = 4000, largeur = 1366, hauteur = 768, mobile = false } = {}) {
  const binaire = trouverNavigateur();
  if (!binaire) {
    throw Object.assign(new Error('Aucun navigateur Chrome ou Chromium trouve.'), { genre: 'navigateur' });
  }

  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-perf-'));
  const processus = spawn(binaire, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    `--user-data-dir=${profil}`,
    '--remote-debugging-port=0',
    'about:blank',
  ]);

  const nettoyer = () => {
    try { processus.kill(); } catch { /* deja termine */ }
    try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* rien a nettoyer */ }
  };

  try {
    const adresse = await attendreLePort(processus);
    const cible = await (await fetch(`${adresse}/json/new?about:blank`, { method: 'PUT' })).json();

    const ws = new WebSocket(cible.webSocketDebuggerUrl);
    await new Promise((resoudre, rejeter) => {
      ws.addEventListener('open', resoudre, { once: true });
      ws.addEventListener('error', () => rejeter(new Error('Connexion au navigateur impossible.')), { once: true });
    });

    const cdp = new Connexion(ws);
    const mesures = await collecter(cdp, url, { attente, largeur, hauteur, mobile });

    cdp.fermer();
    await fetch(`${adresse}/json/close/${cible.id}`).catch(() => {});
    return mesures;
  } finally {
    nettoyer();
  }
}

/** Le port de debogage est annonce sur la sortie d'erreur, au demarrage. */
function attendreLePort(processus, delai = 12000) {
  return new Promise((resoudre, rejeter) => {
    let tampon = '';
    const minuteur = setTimeout(() => {
      rejeter(new Error('Le navigateur n\'a pas demarre dans le delai imparti.'));
    }, delai);

    processus.stderr.setEncoding('utf8');
    processus.stderr.on('data', (morceau) => {
      tampon += morceau;
      const trouve = /DevTools listening on ws:\/\/([^/]+)\//.exec(tampon);
      if (trouve) {
        clearTimeout(minuteur);
        resoudre(`http://${trouve[1]}`);
      }
    });

    processus.on('exit', (code) => {
      clearTimeout(minuteur);
      rejeter(new Error(`Le navigateur s'est arrete (code ${code}).`));
    });
  });
}

async function collecter(cdp, url, { attente, largeur, hauteur, mobile }) {
  const requetes = new Map();
  let octets = 0;

  cdp.sur('Network.responseReceived', ({ requestId, response, type }) => {
    requetes.set(requestId, { url: response.url, type, statut: response.status, octets: 0 });
  });
  cdp.sur('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    octets += encodedDataLength || 0;
    const requete = requetes.get(requestId);
    if (requete) requete.octets = encodedDataLength || 0;
  });

  await cdp.envoyer('Page.enable');
  await cdp.envoyer('Network.enable');
  await cdp.envoyer('Runtime.enable');
  // Cache vide : on mesure ce que voit un visiteur qui arrive pour la
  // premiere fois, pas ce que voit celui qui revient.
  await cdp.envoyer('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.envoyer('Emulation.setDeviceMetricsOverride', {
    width: largeur, height: hauteur, deviceScaleFactor: 1, mobile,
  });
  await cdp.envoyer('Page.addScriptToEvaluateOnNewDocument', { source: SONDE });

  const debut = Date.now();
  const navigation = await cdp.envoyer('Page.navigate', { url });
  if (navigation.result?.errorText) {
    throw Object.assign(
      new Error(`Impossible de charger la page : ${navigation.result.errorText}`),
      { genre: 'reseau' },
    );
  }

  await new Promise((r) => setTimeout(r, attente));

  const lecture = await cdp.envoyer('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const n = performance.getEntriesByType('navigation')[0] || {};
      const peintures = Object.fromEntries(
        performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]),
      );
      const t = performance.getEntriesByType('resource');
      return {
        lcp: window.__argus ? window.__argus.lcp : 0,
        cls: window.__argus ? window.__argus.cls : 0,
        ttfb: n.responseStart || 0,
        domContentLoaded: n.domContentLoadedEventEnd || 0,
        chargement: n.loadEventEnd || 0,
        premierePeinture: peintures['first-contentful-paint'] || 0,
        ressources: t.length,
        titre: document.title || '',
        images: document.images.length,
        scripts: document.scripts.length,
      };
    })()`,
  });

  const page = lecture.result?.result?.value || {};
  const parType = {};
  for (const requete of requetes.values()) {
    parType[requete.type] = (parType[requete.type] || 0) + requete.octets;
  }

  const lourdes = [...requetes.values()]
    .filter((r) => r.octets > 100 * 1024)
    .sort((a, b) => b.octets - a.octets)
    .slice(0, 8);

  return {
    url,
    mobile,
    dureeMesure: Date.now() - debut,
    ...page,
    requetes: requetes.size,
    octets,
    parType,
    lourdes,
  };
}
