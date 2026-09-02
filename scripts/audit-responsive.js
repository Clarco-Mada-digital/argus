#!/usr/bin/env node
/**
 * Audit de mise en page adaptative, mesure par un vrai navigateur.
 *
 * Relire une feuille de style pour juger de son adaptabilite ne marche pas :
 * les deux bogues trouves ici etaient invisibles a la lecture.
 *
 *   1. Un enfant de grille ou de flex a `min-width: auto` par defaut. Il
 *      refuse de descendre sous la largeur de son contenu, donc le conteneur
 *      grandit — meme si `overflow-x: auto` est bien pose sur l'enfant, ce
 *      qui donne l'illusion que le probleme est traite.
 *   2. `minmax(380px, 1fr)` ne descend jamais sous 380 px. Sur un ecran de
 *      320 px, la colonne deborde au lieu de se replier. Le correctif tient
 *      en un mot : `minmax(min(380px, 100%), 1fr)`.
 *
 * On demande donc au navigateur, a plusieurs largeurs, quels elements sortent
 * du cadre. Les elements ecretes par un ancetre defilable sont ecartes : le
 * conteneur gere, ce ne sont pas eux qui font deborder la page.
 *
 * Usage :
 *   node scripts/audit-responsive.js [url-de-base]
 *
 * Prerequis : Chrome accessible en mode debogage.
 *   google-chrome --headless=new --remote-debugging-port=9223 about:blank
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const PORT_DEBOGAGE = Number(process.env.PORT_DEBOGAGE || 9223);
const PAGES = ['index.html', 'analyser.html', 'demo.html', '404.html'];
const LARGEURS = [320, 360, 414, 480, 600, 720, 768, 900, 1024, 1180, 1280, 1440, 1700];

const SONDE = `(() => {
  const largeur = document.documentElement.clientWidth;
  const coupables = [];

  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (getComputedStyle(el).position === 'fixed') continue;

    // Un element ecrete ou defilable par un ancetre ne fait pas deborder la
    // page. Les compter noyait le vrai coupable sous du bruit.
    let ecrete = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (style.overflowX !== 'visible' || style.overflow !== 'visible') { ecrete = true; break; }
    }
    if (ecrete) continue;

    if (r.right > largeur + 1 || r.left < -1) {
      const classe = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
        : '';
      coupables.push(
        el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + classe
        + ' [' + Math.round(r.left) + '→' + Math.round(r.right) + ']',
      );
    }
  }

  // Cibles tactiles trop petites : 44 px est le minimum recommande.
  const petites = [];
  for (const el of document.querySelectorAll('a, button, input, select, [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.left < 0) continue; // lien d'evitement, hors ecran a dessein
    if (r.height < 32) petites.push(el.tagName.toLowerCase() + ' ' + Math.round(r.height) + 'px');
  }

  // Marge laterale du *contenu*, pas du conteneur.
  //
  // getBoundingClientRect renvoie la boite avec son remplissage : un
  // conteneur pleine largeur muni d'un padding interne y parait colle au
  // bord alors qu'il ne l'est pas. On mesure donc les enfants visibles,
  // c'est-a-dire ce que l'oeil voit reellement.
  const marges = [];
  for (const sel of ['.bandeau-i', '.pied-grille', '.pied-bas', 'main .zone', '.hero-grille']) {
    const conteneur = document.querySelector(sel);
    if (!conteneur) continue;

    const enfants = [...conteneur.children].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (enfants.length === 0) continue;

    const gauche = Math.round(Math.min(...enfants.map((c) => c.getBoundingClientRect().left)));
    const droite = Math.round(largeur - Math.max(...enfants.map((c) => c.getBoundingClientRect().right)));
    if (gauche < 10 || droite < 10) marges.push(sel + ' ' + gauche + '/' + droite + 'px');
  }

  return JSON.stringify({
    marges,
    deborde: document.documentElement.scrollWidth > largeur + 1,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: largeur,
    coupables: [...new Set(coupables)].slice(0, 6),
    petites: [...new Set(petites)].slice(0, 4),
  });
})()`;

// L'audit travaille dans son *propre* onglet, cree ici et referme a la fin.
// Reutiliser l'onglet courant marchait une fois puis bloquait : l'emulation
// de taille et le contournement du service worker restent poses sur la cible,
// et la deuxieme execution partait d'un etat qu'elle n'avait pas choisi.
let page;
try {
  page = await (await fetch(`http://127.0.0.1:${PORT_DEBOGAGE}/json/new?about:blank`, { method: 'PUT' })).json();
} catch {
  process.stderr.write(
    `Chrome n'ecoute pas sur le port ${PORT_DEBOGAGE}.\n` +
      `Lancez : google-chrome --headless=new --remote-debugging-port=${PORT_DEBOGAGE} about:blank\n`,
  );
  process.exit(2);
}

if (!page?.webSocketDebuggerUrl) {
  process.stderr.write('Impossible de creer un onglet de travail.\n');
  process.exit(2);
}

const fermerLOnglet = async () => {
  try {
    await fetch(`http://127.0.0.1:${PORT_DEBOGAGE}/json/close/${page.id}`);
  } catch {
    /* Chrome a peut-etre deja disparu : ce n'est pas un echec d'audit */
  }
};

const ws = new WebSocket(page.webSocketDebuggerUrl);
let identifiant = 0;
const attentes = new Map();

const envoyer = (method, params = {}) =>
  new Promise((resoudre) => {
    const n = ++identifiant;
    attentes.set(n, resoudre);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

ws.addEventListener('message', (evenement) => {
  const message = JSON.parse(evenement.data);
  if (message.id && attentes.has(message.id)) attentes.get(message.id)(message);
});

await new Promise((r) => ws.addEventListener('open', r));
await envoyer('Page.enable');
await envoyer('Runtime.enable');
// Sans cela, le service worker du site sert la version precedente du CSS et
// l'audit mesure le passe — ce qui est arrive, et a coute une correction
// pourtant deja juste.
await envoyer('Network.enable');
await envoyer('Network.setCacheDisabled', { cacheDisabled: true });
// `ServiceWorker.enable` ne repond jamais sur une cible de page : il faut
// passer par le domaine Network, qui contourne le worker sans l'activer.
await envoyer('Network.setBypassServiceWorker', { bypass: true });

let echecs = 0;

for (const chemin of PAGES) {
  process.stdout.write(`\n${chemin}\n`);

  for (const largeur of LARGEURS) {
    await envoyer('Emulation.setDeviceMetricsOverride', {
      width: largeur, height: 800, deviceScaleFactor: 1, mobile: largeur < 768,
    });
    await envoyer('Page.navigate', { url: `${BASE}/${chemin}` });
    await new Promise((r) => setTimeout(r, 900));

    const reponse = await envoyer('Runtime.evaluate', { expression: SONDE, returnByValue: true });
    const valeur = reponse.result?.result?.value;
    if (!valeur) {
      process.stdout.write(`  ${String(largeur).padStart(4)}px  page illisible\n`);
      echecs++;
      continue;
    }

    const mesure = JSON.parse(valeur);
    if (mesure.deborde) {
      echecs++;
      process.stdout.write(
        `  ${String(largeur).padStart(4)}px  DEBORDE : ${mesure.scrollWidth}px pour ${mesure.clientWidth}px\n`,
      );
      for (const coupable of mesure.coupables) process.stdout.write(`            ${coupable}\n`);
    } else {
      process.stdout.write(`  ${String(largeur).padStart(4)}px  ok\n`);
    }

    if (mesure.marges?.length) {
      process.stdout.write(`            colle au bord : ${mesure.marges.join(', ')}\n`);
      echecs++;
    }

    if (largeur < 768 && mesure.petites.length > 0) {
      process.stdout.write(`            cibles tactiles courtes : ${mesure.petites.join(', ')}\n`);
    }
  }
}

ws.close();
await fermerLOnglet();

if (echecs > 0) {
  process.stdout.write(`\n${echecs} largeur(s) en echec.\n`);
  process.exit(1);
}

process.stdout.write(`\n✔ ${PAGES.length} pages × ${LARGEURS.length} largeurs : aucun debordement.\n`);
process.exit(0);
