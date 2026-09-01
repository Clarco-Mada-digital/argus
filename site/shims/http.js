/**
 * `node:http` dans le navigateur.
 *
 * Le tableau de bord local (`argus serve`) demarre un serveur HTTP ; cette
 * fonctionnalite n'a evidemment pas de sens dans un onglet. Le module est
 * neanmoins atteint parce que `src/index.js` reexporte `startServer`, et un
 * specificateur absent de la carte d'imports fait echouer *toute* la chaine
 * d'imports, pas seulement la branche inutilisee.
 *
 * D'ou ce bouchon : il laisse le graphe se charger et n'echoue que si
 * quelqu'un tente reellement de s'en servir.
 */
function indisponible() {
  throw new Error(
    'Le serveur local d\'Argus n\'existe pas dans le navigateur : lancez `argus serve` depuis un terminal.',
  );
}

export function createServer() {
  indisponible();
}

export default { createServer };
