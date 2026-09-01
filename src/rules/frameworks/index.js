import django from './django.js';
import laravel from './laravel.js';
import rails from './rails.js';
import spring from './spring.js';

/**
 * Packs de regles specifiques a un framework.
 *
 * Certaines verifications n'ont de sens que pour un framework donne, et ne
 * s'expriment pas par un simple motif : elles croisent plusieurs fichiers ou
 * detectent l'absence d'un element. Les rassembler par framework evite d'en
 * faire porter la complexite aux analyseurs generiques.
 *
 * Pour ajouter un framework : creez un module exportant
 * { id, label, appliesTo(context), run(context, report) } et referencez-le ici.
 */
export const FRAMEWORK_PACKS = [django, laravel, rails, spring];
