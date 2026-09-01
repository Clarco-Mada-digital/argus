/**
 * `node:readline/promises` dans le navigateur.
 *
 * `argus fix` demande confirmation avant chaque ecriture — au terminal. Dans
 * un onglet, il n'y a ni terminal ni fichier a reecrire : le module n'est la
 * que pour que le graphe d'imports se charge entierement.
 */
function indisponible() {
  throw new Error(
    'La confirmation interactive n\'existe pas dans le navigateur : lancez `argus fix` depuis un terminal.',
  );
}

export function createInterface() {
  indisponible();
}

export default { createInterface };
