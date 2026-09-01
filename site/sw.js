/**
 * Service worker d'Argus.
 *
 * Le site n'a pas de serveur applicatif : la page d'analyse charge le coeur
 * d'Argus sous forme de modules ES et fait tourner l'analyse dans l'onglet.
 * Tout est donc precachable, et l'outil reste entierement fonctionnel hors
 * ligne — ce qui n'est pas un simple confort ici : analyser un dossier prive
 * sans aucune connexion est une garantie verifiable par l'utilisateur.
 *
 * La liste des ressources est *generee* au deploiement par
 * `scripts/site-precache.js`. Soixante modules maintenus a la main auraient
 * pourri au premier fichier ajoute, et un precache incomplet casse
 * silencieusement l'application hors ligne.
 */

// @generated-debut
const VERSION = 'dev';
const RESSOURCES = ['./', './index.html', './analyser.html', './style.css', './app.js'];
// @generated-fin

const CACHE = `argus-${VERSION}`;

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` court-circuite le cache HTTP du navigateur : sans cela, une
      // version perimee peut etre recopiee telle quelle dans le nouveau cache.
      await cache.addAll(RESSOURCES.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    (async () => {
      const noms = await caches.keys();
      await Promise.all(
        noms.filter((nom) => nom.startsWith('argus-') && nom !== CACHE).map((nom) => caches.delete(nom)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;

  // Navigation : on sert la page depuis le cache, et on retombe sur l'accueil
  // si l'adresse demandee est inconnue hors ligne.
  if (requete.mode === 'navigate') {
    evenement.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const enCache = await cache.match(requete, { ignoreSearch: true });
        if (enCache) {
          rafraichirEnFond(cache, requete);
          return enCache;
        }
        try {
          return await fetch(requete);
        } catch {
          return (await cache.match('./index.html')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Le reste — modules, styles, icones — est immuable pour une version donnee :
  // cache d'abord, reseau seulement en secours.
  evenement.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const enCache = await cache.match(requete);
      if (enCache) return enCache;

      try {
        const reponse = await fetch(requete);
        if (reponse.ok && reponse.type === 'basic') cache.put(requete, reponse.clone());
        return reponse;
      } catch {
        return Response.error();
      }
    })(),
  );
});

/** Met a jour une page en arriere-plan, sans retarder l'affichage. */
function rafraichirEnFond(cache, requete) {
  fetch(requete)
    .then((reponse) => {
      if (reponse.ok) cache.put(requete, reponse);
    })
    .catch(() => {
      /* hors ligne : la version en cache reste la bonne reponse */
    });
}

self.addEventListener('message', (evenement) => {
  if (evenement.data === 'passer-a-la-suite') self.skipWaiting();
});
