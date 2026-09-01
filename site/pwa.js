/**
 * Installation et mise a jour hors ligne.
 *
 * Le bouton n'apparait que si le navigateur declare l'installation possible :
 * afficher « Installer » a quelqu'un qui ne peut pas installer, ou qui l'a
 * deja fait, est une promesse en l'air.
 */
const bouton = document.getElementById('installer');
let invite = null;

window.addEventListener('beforeinstallprompt', (evenement) => {
  evenement.preventDefault();
  invite = evenement;
  if (bouton) bouton.hidden = false;
});

if (bouton) {
  bouton.addEventListener('click', async () => {
    if (!invite) return;
    bouton.disabled = true;
    invite.prompt();
    const { outcome } = await invite.userChoice;
    invite = null;
    if (outcome === 'accepted') bouton.hidden = true;
    else bouton.disabled = false;
  });
}

window.addEventListener('appinstalled', () => {
  invite = null;
  if (bouton) bouton.hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const enregistrement = await navigator.serviceWorker.register('./sw.js', { scope: './' });

      enregistrement.addEventListener('updatefound', () => {
        const arrivant = enregistrement.installing;
        if (!arrivant) return;
        arrivant.addEventListener('statechange', () => {
          // Un worker installe alors qu'un autre controle deja la page signale
          // une nouvelle version : on previent au lieu de recharger d'autorite,
          // une analyse peut etre en cours.
          if (arrivant.state === 'installed' && navigator.serviceWorker.controller) {
            annoncerMiseAJour(arrivant);
          }
        });
      });
    } catch {
      /* pas de service worker (file://, mode prive) : le site fonctionne quand meme */
    }
  });
}

function annoncerMiseAJour(worker) {
  const barre = document.createElement('div');
  barre.className = 'bandeau-maj';

  const texte = document.createElement('span');
  texte.textContent = 'Une nouvelle version d\'Argus est prête.';

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.textContent = 'Recharger';

  barre.append(texte, bouton);
  bouton.addEventListener('click', () => {
    worker.postMessage('passer-a-la-suite');
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  });
  document.body.append(barre);
}
