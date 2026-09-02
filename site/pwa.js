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
  barre.setAttribute('role', 'status');

  const oeil = document.createElement('span');
  oeil.className = 'bandeau-maj-oeil';
  oeil.setAttribute('aria-hidden', 'true');
  // Le meme oeil que la marque, en petit : le bandeau appartient au site.
  const dessin = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  dessin.setAttribute('viewBox', '0 0 32 32');
  const contour = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  contour.setAttribute('d', 'M2.5 16 Q16 3.5 29.5 16 Q16 28.5 2.5 16 Z');
  contour.setAttribute('fill', 'none');
  contour.setAttribute('stroke', 'currentColor');
  contour.setAttribute('stroke-width', '2.4');
  const pupille = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  pupille.setAttribute('cx', '16');
  pupille.setAttribute('cy', '16');
  pupille.setAttribute('r', '4.2');
  pupille.setAttribute('fill', 'currentColor');
  dessin.append(contour, pupille);
  oeil.append(dessin);

  const texte = document.createElement('div');
  texte.className = 'bandeau-maj-texte';
  const titre = document.createElement('b');
  titre.textContent = 'Nouvelle version disponible';
  const detail = document.createElement('span');
  detail.textContent = 'Rechargez pour l\'appliquer. Une analyse en cours ne sera pas interrompue.';
  texte.append(titre, detail);

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'bandeau-maj-action';
  bouton.textContent = 'Recharger';

  const fermer = document.createElement('button');
  fermer.type = 'button';
  fermer.className = 'bandeau-maj-fermer';
  fermer.setAttribute('aria-label', 'Fermer cette annonce');
  fermer.textContent = '✕';
  fermer.addEventListener('click', () => barre.remove());

  barre.append(oeil, texte, bouton, fermer);

  bouton.addEventListener('click', () => {
    bouton.disabled = true;
    bouton.textContent = 'Rechargement…';

    // On ecoute *avant* de demander la bascule : dans l'autre ordre, un
    // worker qui prend la main immediatement declenche `controllerchange`
    // avant que l'ecouteur existe, et le bouton reste sans effet.
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    });
    worker.postMessage('passer-a-la-suite');

    // Filet : si la bascule n'aboutit pas — worker deja actif, navigateur qui
    // n'emet pas l'evenement —, on recharge quand meme. Un bouton qui ne fait
    // rien est pire qu'un rechargement de trop.
    setTimeout(() => location.reload(), 1800);
  });
  document.body.append(barre);
}
