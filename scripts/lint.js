#!/usr/bin/env node
/**
 * Verification statique du projet, sans dependance externe.
 *
 * Trois controles, tous issus de regressions reellement vecues :
 *   1. syntaxe de chaque module (`node --check`) ;
 *   2. invariants du rapport HTML — les couleurs de texte doivent passer par
 *      des variables, sinon elles cassent en theme clair ;
 *   3. hygiene generale : pas de `debugger`, pas de `.only` oublie dans un test ;
 *   4. aucun fichier necessaire aux tests n'est exclu de Git.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const problemes = [];

function fichiers(dossier, filtre = /\.js$/) {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) trouves.push(...fichiers(complet, filtre));
    else if (filtre.test(entree.name)) trouves.push(complet);
  }
  return trouves;
}

const modules = ['src', 'bin', 'tests', 'scripts']
  .map((d) => path.join(RACINE, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => fichiers(d));

// 1. Syntaxe.
for (const fichier of modules) {
  try {
    execFileSync(process.execPath, ['--check', fichier], { stdio: 'pipe' });
  } catch (erreur) {
    problemes.push(`${relatif(fichier)} : syntaxe invalide\n${erreur.stderr?.toString().trim()}`);
  }
}

// 2. Invariants du rapport HTML.
const rapport = fs.readFileSync(path.join(RACINE, 'src/report/html.js'), 'utf8');
if (/;color:#[0-9a-f]{3,8}/i.test(rapport)) {
  problemes.push('src/report/html.js : couleur de texte codee en dur sur un fond colore — utilisez var(--on-accent).');
}
if (!/button\s*\{[^}]*color:\s*inherit/.test(rapport)) {
  problemes.push('src/report/html.js : le reset des boutons doit forcer color: inherit.');
}

// 3. Hygiene.
for (const fichier of modules) {
  const contenu = fs.readFileSync(fichier, 'utf8');
  const lignes = contenu.split('\n');
  lignes.forEach((ligne, i) => {
    if (/^\s*debugger\b/.test(ligne)) problemes.push(`${relatif(fichier)}:${i + 1} : instruction debugger oubliee.`);
    if (/\b(test|describe|it)\.only\s*\(/.test(ligne)) problemes.push(`${relatif(fichier)}:${i + 1} : .only oublie — le reste de la suite serait ignore.`);
  });
}

// 4. Un fichier de test *ignore* par Git est invisible : les tests passent en
//    local et echouent sur un clone frais. C'est arrive avec la regle `*.key`
//    du .gitignore, qui masquait une fixture Rails.
//    On interroge Git sur ce qu'il ignore, et non sur ce qu'il suit : un
//    fichier simplement pas encore ajoute n'est pas un probleme.
try {
  const ignores = execFileSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'tests'],
    { cwd: RACINE, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  if (ignores.length > 0) {
    problemes.push(
      'fichiers de test exclus par le .gitignore — ils manqueront sur un clone ' +
        `frais :\n      ${ignores.join('\n      ')}\n      ` +
        'Construisez ce scenario a l\'execution plutot que d\'ajouter une exception.',
    );
  }
} catch {
  /* hors depot Git : la verification ne s'applique pas */
}

function relatif(fichier) {
  return path.relative(RACINE, fichier);
}

if (problemes.length > 0) {
  process.stderr.write(`\n${problemes.length} probleme(s) :\n\n${problemes.map((p) => `  • ${p}`).join('\n')}\n\n`);
  process.exit(1);
}

process.stdout.write(`✔ ${modules.length} modules verifies, aucun probleme.\n`);
