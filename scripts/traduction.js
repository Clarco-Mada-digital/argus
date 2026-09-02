#!/usr/bin/env node
/**
 * Etat de la traduction.
 *
 * Une traduction partielle n'est pas un probleme en soi — le repli sur le
 * francais garde l'outil utilisable — mais elle devient un probleme si
 * personne ne sait ce qui reste. Ce script rend l'avancement mesurable, et
 * donc finissable.
 *
 *   node scripts/traduction.js          etat global
 *   node scripts/traduction.js --reste  identifiants non traduits
 */
import fs from 'node:fs';
import path from 'node:path';
import { CATALOGUE_FR } from '../src/i18n/fr.js';
import { CATALOGUE_EN } from '../src/i18n/en.js';
import { REGLES_EN } from '../src/i18n/regles.en.js';

const RACINE = path.resolve(import.meta.dirname, '..');

/** Toutes les regles declarees, avec leur categorie devinee par prefixe. */
function toutesLesRegles() {
  const regles = new Map();

  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name.startsWith('.')) continue;
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(complet); continue; }
      if (!entree.name.endsWith('.js')) continue;

      const source = fs.readFileSync(complet, 'utf8');
      for (const m of source.matchAll(/(?:id|ruleId):\s*'([A-Z][A-Z0-9-]{3,})'/g)) {
        if (!regles.has(m[1])) regles.set(m[1], m[1].split('-')[0]);
      }
    }
  };

  parcourir(path.join(RACINE, 'src'));
  return regles;
}

const regles = toutesLesRegles();
const parPrefixe = new Map();
for (const [id, prefixe] of regles) {
  if (!parPrefixe.has(prefixe)) parPrefixe.set(prefixe, { total: 0, traduites: 0, restantes: [] });
  const groupe = parPrefixe.get(prefixe);
  groupe.total++;
  if (REGLES_EN[id]) groupe.traduites++;
  else groupe.restantes.push(id);
}

const clefsFr = Object.keys(CATALOGUE_FR);
const clefsEn = Object.keys(CATALOGUE_EN);
const interfaceManquante = clefsFr.filter((c) => !CATALOGUE_EN[c]);

const pourcent = (a, b) => (b === 0 ? 100 : Math.round((a / b) * 100));

process.stdout.write('\nEtat de la traduction anglaise\n\n');
process.stdout.write(
  `  Interface   ${String(clefsEn.length).padStart(4)} / ${clefsFr.length}  ${pourcent(clefsEn.length, clefsFr.length)} %\n\n`,
);

const groupes = [...parPrefixe.entries()].sort((a, b) => b[1].total - a[1].total);
let total = 0;
let traduites = 0;

for (const [prefixe, groupe] of groupes) {
  total += groupe.total;
  traduites += groupe.traduites;
  const part = pourcent(groupe.traduites, groupe.total);
  const barre = '█'.repeat(Math.round(part / 10)).padEnd(10, '░');
  process.stdout.write(
    `  ${prefixe.padEnd(11)} ${String(groupe.traduites).padStart(4)} / ${String(groupe.total).padEnd(4)} ${barre} ${part} %\n`,
  );
}

process.stdout.write(
  `\n  Regles      ${String(traduites).padStart(4)} / ${total}  ${pourcent(traduites, total)} %\n\n`,
);

if (interfaceManquante.length > 0) {
  process.stdout.write(`  Clefs d'interface non traduites : ${interfaceManquante.join(', ')}\n\n`);
}

if (process.argv.includes('--reste')) {
  process.stdout.write('Identifiants restants :\n\n');
  for (const [prefixe, groupe] of groupes) {
    if (groupe.restantes.length === 0) continue;
    process.stdout.write(`  ${prefixe}\n    ${groupe.restantes.join('\n    ')}\n\n`);
  }
} else if (total > traduites) {
  process.stdout.write('  --reste pour la liste des identifiants restants.\n\n');
}
