/**
 * `node:child_process` n'a pas d'equivalent dans le navigateur.
 *
 * Les fonctionnalites qui en dependent — mode differentiel Git, historique lie
 * aux commits — sont simplement indisponibles. Elles interceptent deja l'echec
 * et se degradent proprement.
 */
export function execFileSync(commande) {
  const erreur = new Error(`Commande indisponible dans le navigateur : ${commande}`);
  erreur.code = 'ENOENT';
  throw erreur;
}

export function spawn() {
  throw new Error('Lancement de processus indisponible dans le navigateur');
}

export default { execFileSync, spawn };
