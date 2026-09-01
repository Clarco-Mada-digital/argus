#!/usr/bin/env node
/**
 * Genere la liste de precache du service worker a partir du site assemble.
 *
 * La liste est produite, jamais ecrite a la main : le site embarque une
 * soixantaine de modules du coeur d'Argus, et un precache incomplet ne casse
 * rien de visible en ligne — il casse le mode hors ligne, c'est-a-dire
 * exactement ce que personne ne teste avant de livrer.
 *
 * La version du cache est l'empreinte du contenu : deux deploiements
 * identiques ne provoquent pas de rechargement, un octet modifie oui.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const racine = process.argv[2] || '_site';

const EXCLUS = /(^|\/)(sw\.js|demo\.html|robots\.txt|sitemap\.xml|og\.png)$/;
const EXTENSIONS = /\.(html|css|js|mjs|json|webmanifest|svg|png|woff2?)$/i;

function parcourir(dossier, prefixe = '') {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name.startsWith('.')) continue;
    const chemin = path.join(dossier, entree.name);
    const relatif = prefixe ? `${prefixe}/${entree.name}` : entree.name;
    if (entree.isDirectory()) trouves.push(...parcourir(chemin, relatif));
    else if (EXTENSIONS.test(entree.name) && !EXCLUS.test(relatif)) trouves.push(relatif);
  }
  return trouves;
}

if (!fs.existsSync(racine)) {
  process.stderr.write(`Site introuvable : ${racine}\n`);
  process.exit(1);
}

const ressources = parcourir(racine).sort();

const empreinte = crypto.createHash('sha1');
for (const relatif of ressources) {
  empreinte.update(relatif);
  empreinte.update(fs.readFileSync(path.join(racine, relatif)));
}
const version = empreinte.digest('hex').slice(0, 12);

// './' est la navigation vers la racine : elle n'est aucun fichier, mais c'est
// l'URL que le navigateur demande, et elle doit etre servie hors ligne.
const liste = ['./', ...ressources.map((r) => `./${r}`)];

const cheminSw = path.join(racine, 'sw.js');
const source = fs.readFileSync(cheminSw, 'utf8');
const remplace = source.replace(
  /\/\/ @generated-debut[\s\S]*?\/\/ @generated-fin/,
  [
    '// @generated-debut — produit par scripts/site-precache.js, ne pas editer',
    `const VERSION = '${version}';`,
    `const RESSOURCES = ${JSON.stringify(liste, null, 2).replace(/\n/g, '\n')};`,
    '// @generated-fin',
  ].join('\n'),
);

if (remplace === source) {
  process.stderr.write('Les marqueurs @generated sont introuvables dans sw.js\n');
  process.exit(1);
}

fs.writeFileSync(cheminSw, remplace);

const octets = ressources.reduce((total, r) => total + fs.statSync(path.join(racine, r)).size, 0);
process.stdout.write(
  `✔ service worker : ${liste.length} ressources precachees (${(octets / 1024).toFixed(0)} Ko), version ${version}\n`,
);
