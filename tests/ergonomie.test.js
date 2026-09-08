import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARGUS = path.join(RACINE, 'bin', 'argus.js');

/** Trois demandes d'ergonomie du retour Orbit. */

function argus(arguments_, cwd) {
  try {
    return execFileSync(process.execPath, [ARGUS, ...arguments_], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (erreur) {
    // Argus sort en 1 des qu'il trouve un constat grave : la sortie reste valide.
    return erreur.stdout ?? '';
  }
}

function petitProjet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-ergo-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t","version":"1.0.0"}');
  fs.writeFileSync(path.join(dir, 'app.js'), "export const cle = 'AKIAIOSFODNN7EXAMPLE';\n");
  return dir;
}

test('ergonomie : --summary donne les scores et rien d\'autre', async () => {
  const dir = petitProjet();
  const sortie = argus(['scan', dir, '--no-history', '--summary'], RACINE);

  // Une ligne par dimension, analysable sans analyseur JSON.
  assert.match(sortie, /^global \d+ [A-F][+-]?$/m);
  assert.match(sortie, /^security \d+ \d+$/m);
  assert.match(sortie, /^critical \d+$/m);
  assert.match(sortie, /^fichiers \d+$/m);
  // Aucun constat individuel : c'est tout l'interet.
  assert.doesNotMatch(sortie, /SEC-|app\.js/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ergonomie : un chemin hors de l\'arborescence s\'affiche en absolu', () => {
  // `../../../../tmp/rapport.html` est moins lisible que `/tmp/rapport.html`,
  // et impossible a copier-coller sans compter les remontees.
  const dir = petitProjet();
  const rapport = path.join(dir, 'rapport.html');
  const sortie = argus(['scan', dir, '--no-history', '--html', rapport], RACINE);

  assert.ok(sortie.includes(rapport), `chemin absolu attendu, obtenu :\n${sortie.slice(-300)}`);
  assert.doesNotMatch(sortie, /\.\.\/\.\.\//);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ergonomie : argus ignore ecarte un constat sans toucher au code', async () => {
  const dir = petitProjet();
  const avant = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

  argus(['init', dir], RACINE);
  const sortie = argus(['ignore', 'SEC-SECRET-AWS-KEY', 'app.js:1', '--raison', 'clef d\'exemple'], dir);
  assert.match(sortie, /ecarte sur/);

  // Le code analyse est intact : c'est celui de l'utilisateur.
  assert.equal(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), avant);

  // La raison est conservee — une suppression sans motif devient
  // indechiffrable, et plus personne n'ose la retirer.
  const config = JSON.parse(
    fs.readFileSync(path.join(dir, 'argus.config.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  );
  assert.deepEqual(config.suppressions, [
    { regle: 'SEC-SECRET-AWS-KEY', fichier: 'app.js', ligne: 1, raison: "clef d'exemple" },
  ]);

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(rapport.findings.filter((f) => f.ruleId === 'SEC-SECRET-AWS-KEY'), []);

  // Deux fois la meme commande n'empile pas deux entrees.
  argus(['ignore', 'SEC-SECRET-AWS-KEY', 'app.js:1'], dir);
  const relu = JSON.parse(
    fs.readFileSync(path.join(dir, 'argus.config.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  );
  assert.equal(relu.suppressions.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
