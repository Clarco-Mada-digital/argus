import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scan } from '../src/index.js';

/**
 * L'index d'identifiants remplace un balayage complet du code par symbole.
 * Ces tests verifient que le raccourci ne change pas les reponses.
 */

function projet(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-idx-'));
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, nom);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

test('index : un symbole utilise dans un autre fichier reste vivant', async () => {
  const dir = projet({
    'src/outils.js': 'export function calculerTotal(x) {\n  return x * 2;\n}\n',
    'src/page.js': 'import { calculerTotal } from "./outils.js";\nexport const p = () => calculerTotal(2);\n',
  });

  const r = await scan(dir, { categories: ['deadcode'] });
  const morts = r.findings.filter((f) => f.ruleId === 'DEAD-EXPORT').map((f) => f.data.symbol);
  assert.ok(!morts.includes('calculerTotal'), 'un symbole importe ailleurs n\'est pas mort');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('index : un symbole utilise seulement chez lui est mort', async () => {
  const dir = projet({
    'src/outils.js':
      'export function jamaisAilleurs(x) {\n  return x + 1;\n}\n' +
      'export function utilisee(x) {\n  return jamaisAilleurs(x) * 2;\n}\n',
    'src/page.js': 'import { utilisee } from "./outils.js";\nexport const p = () => utilisee(1);\n',
  });

  const r = await scan(dir, { categories: ['deadcode'] });
  const morts = r.findings.filter((f) => f.ruleId === 'DEAD-EXPORT').map((f) => f.data.symbol);
  assert.ok(morts.includes('jamaisAilleurs'), 'utilise uniquement dans son fichier : export inutile');
  assert.ok(!morts.includes('utilisee'), 'utilisee est importee ailleurs');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('index : un prefixe commun ne compte pas comme une utilisation', async () => {
  const dir = projet({
    'src/outils.js': 'export function traiter(x) {\n  return x;\n}\n',
    // `traiterTout` contient `traiter` : la delimitation de mot doit tenir.
    'src/autre.js': 'export function traiterTout(v) {\n  return v.map((x) => x);\n}\n',
    'src/index.js': 'import { traiterTout } from "./autre.js";\nexport default traiterTout;\n',
  });

  const r = await scan(dir, { categories: ['deadcode'] });
  const morts = r.findings.filter((f) => f.ruleId === 'DEAD-EXPORT').map((f) => f.data.symbol);
  assert.ok(morts.includes('traiter'), 'traiter n\'est utilise nulle part malgre traiterTout');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('index : le cout croit lineairement, pas de facon quadratique', async () => {
  const construire = (n) => {
    const fichiers = { 'src/index.js': 'import { f0 } from "./f0.js";\nexport default f0;\n' };
    for (let i = 0; i < n; i++) {
      const suivant = i + 1 < n ? `import { f${i + 1} } from "./f${i + 1}.js";\n` : '';
      fichiers[`src/f${i}.js`] = `${suivant}export function f${i}(v) {\n  return v;\n}\n`;
    }
    return projet(fichiers);
  };

  const mesurer = async (dir) => {
    const debut = performance.now();
    await scan(dir, { categories: ['deadcode'] });
    return performance.now() - debut;
  };

  const petit = construire(150);
  const grand = construire(600); // quatre fois plus de fichiers
  const tPetit = await mesurer(petit);
  const tGrand = await mesurer(grand);

  // Un algorithme quadratique donnerait un facteur proche de 16. On laisse une
  // marge large : le test protege contre une regression d'ordre, pas contre
  // les variations de charge de la machine.
  const facteur = tGrand / Math.max(tPetit, 1);
  assert.ok(facteur < 10, `croissance suspecte : x${facteur.toFixed(1)} pour 4x les fichiers`);

  fs.rmSync(petit, { recursive: true, force: true });
  fs.rmSync(grand, { recursive: true, force: true });
});

// ------------------------------------------------------- Configuration explicite

test('config : un fichier designe par --config est pris en compte', async () => {
  const { loadConfig } = await import('../src/core/config.js');
  const dir = projet({
    'a.js': 'eval(x);\n',
    'argus.config.json': '{"disabledRules":[]}',
    'strict.json': '{"categories":["security"],"disabledRules":["SEC-EVAL"]}',
  });

  const parDefaut = await scan(dir, { categories: ['security'] });
  assert.ok(parDefaut.findings.some((f) => f.ruleId === 'SEC-EVAL'));

  const explicite = loadConfig(dir, {}, path.join(dir, 'strict.json'));
  const { Engine } = await import('../src/core/engine.js');
  const resultat = await new Engine(explicite).run();
  assert.ok(!resultat.findings.some((f) => f.ruleId === 'SEC-EVAL'), 'la regle desactivee ne doit pas remonter');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('config : un fichier introuvable est signale clairement', async () => {
  const { loadConfig } = await import('../src/core/config.js');
  assert.throws(
    () => loadConfig(os.tmpdir(), {}, '/chemin/qui/nexiste/pas.json'),
    /introuvable/,
    'le message doit dire ce qui manque',
  );
});
