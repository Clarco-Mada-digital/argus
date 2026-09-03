import django from './django.js';
import laravel from './laravel.js';
import rails from './rails.js';
import spring from './spring.js';
import express from './express.js';
import nextjs from './nextjs.js';
import nuxt from './nuxt.js';
import astro from './astro.js';
import sveltekit from './sveltekit.js';
import react from './react.js';
import angular from './angular.js';
import flask from './flask.js';
import fastapi from './fastapi.js';
import variablesPubliques from './variables-publiques.js';
import reactNative from './react-native.js';
import flutter from './flutter.js';
import tauri from './tauri.js';
import electron from './electron.js';
import manifestesNatifs from './manifestes-natifs.js';
import ressourcesDistantes from './ressources-distantes.js';
import jsonDansScript from './json-dans-script.js';
import androidNatif from './android-natif.js';
import iosNatif from './ios-natif.js';

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
export const FRAMEWORK_PACKS = [
  // Serveur
  django, flask, fastapi, laravel, rails, spring, express,
  // Front et rendu
  react, nextjs, nuxt, astro, sveltekit, angular,
  // Mobile et bureau
  reactNative, flutter, tauri, electron, androidNatif, iosNatif,
  // Transverse : ces pieges ne dependent pas du framework choisi.
  variablesPubliques, manifestesNatifs, ressourcesDistantes, jsonDansScript,
];
