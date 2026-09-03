import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripJsonComments } from '../src/core/config.js';
import { scan } from '../src/index.js';

/**
 * Ces tests figent les defauts trouves en analysant de vrais projets.
 *
 * Aucun n'aurait ete trouve par les fixtures : elles ont toutes ete ecrites
 * apres la regle qu'elles declenchent. C'est la raison d'etre du corpus, et
 * ces cas sont sa retombee.
 */

test('json : un joker d\'export ne doit pas etre pris pour un commentaire', () => {
  // Trouve sur axios. `"./unsafe/*": "./lib/*"` : le `/*` etait lu comme une
  // ouverture de commentaire, et tout ce qui suivait disparaissait. Le
  // manifeste devenait illisible — en silence : plus aucune dependance
  // analysee, plus aucun framework reconnu, et un rapport d'apparence normale.
  const manifeste = JSON.stringify({
    name: 'paquet',
    main: './dist/index.js',
    exports: { './unsafe/*': './lib/*', '.': './dist/index.js' },
    dependencies: { express: '^4.18.0' },
  });

  const analyse = JSON.parse(stripJsonComments(manifeste));
  assert.equal(analyse.main, './dist/index.js');
  assert.deepEqual(analyse.dependencies, { express: '^4.18.0' });
});

test('json : les commentaires sont retires, les chaines preservees', () => {
  const cas = [
    ['{"a":1, // note\n "b":2}', { a: 1, b: 2 }],
    ['{/* bloc */"a":1}', { a: 1 }],
    ['{"url":"https://exemple.fr/a"}', { url: 'https://exemple.fr/a' }],
    ['{"a":1,}', { a: 1 }],
    ['{"motif":"/* pas un commentaire */"}', { motif: '/* pas un commentaire */' }],
  ];

  for (const [brut, attendu] of cas) {
    assert.deepEqual(JSON.parse(stripJsonComments(brut)), attendu, brut);
  }
});

test('bibliotheque : ses exports sont son produit, pas du code mort', async () => {
  // Trouve sur `requests` : soixante-dix exports de sa surface publique
  // signales comme morts. Ils ne sont pas importes en interne pour la meme
  // raison qu'une porte d'entree ne s'ouvre pas depuis l'interieur.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-lib-'));
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'ma-lib', version: '1.0.0', main: 'lib/index.js' }),
  );
  fs.writeFileSync(
    path.join(dir, 'lib/index.js'),
    'export const TAILLE_PAR_DEFAUT = 10;\nexport function calculer(a, b) { return a + b; }\n',
  );

  const rapport = await scan(dir, { noHistory: true });
  assert.ok(rapport.project.estBibliotheque, 'le paquet declare un point d\'entree');
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'DEAD-EXPORT'),
    [],
    'la surface publique d\'une bibliotheque n\'est pas morte',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('bibliotheque : `files` suffit, meme sans `main`', async () => {
  // Express ne declare aucun `main` — il s'en remet au index.js par defaut.
  // Il etait decrit comme « Site statique » a cause de ses pages d'exemple.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-lib2-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'lib', version: '1.0.0', files: ['index.js', 'lib/'] }),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), 'export function faire() { return 1; }\n');
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Exemple</title></head><body><h1>Exemple</h1></body></html>',
  );

  const rapport = await scan(dir, { noHistory: true });
  assert.ok(rapport.project.estBibliotheque);
  assert.match(rapport.project.description, /Biblioth/, `decrit comme « ${rapport.project.description} »`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('python : un import relatif designe le paquet, pas un fichier cache', async () => {
  // `from .adapters import X` etait resolu en `paquet/.adapters` — un fichier
  // cache. Tout le coeur d'une bibliotheque Python passait pour mort.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-py-'));
  fs.mkdirSync(path.join(dir, 'src/paquet'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'requests==2.31.0\n');
  fs.writeFileSync(
    path.join(dir, 'src/paquet/__init__.py'),
    'from .adaptateurs import Adaptateur\n\n__all__ = ["Adaptateur"]\n',
  );
  fs.writeFileSync(
    path.join(dir, 'src/paquet/adaptateurs.py'),
    'class Adaptateur:\n    def envoyer(self):\n        return True\n',
  );

  const rapport = await scan(dir, { noHistory: true });
  assert.ok(
    !rapport.findings.some((f) => f.ruleId === 'DEAD-FILE' && f.file.includes('adaptateurs')),
    'le module importe relativement est bien vivant',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('manifeste illisible : le silence serait le pire des cas', async () => {
  // Un rapport sans constat de dependance doit dire s'il n'a rien pu lire,
  // faute de quoi il ressemble a un projet sain.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-json-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "casse", ');
  fs.writeFileSync(path.join(dir, 'index.js'), 'export const a = 1;\n');

  const rapport = await scan(dir, { noHistory: true });
  const constat = rapport.findings.find((f) => f.ruleId === 'DEP-MANIFESTE-ILLISIBLE');

  assert.ok(constat, 'un manifeste illisible doit etre signale');
  assert.equal(constat.severity, 'high');
  assert.match(constat.message, /ne signifie pas ici que tout va bien/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('domaines d\'exemple : example.com n\'est pas une ressource en clair', async () => {
  // 265 constats sur la suite de tests d'une bibliotheque HTTP — tous faux,
  // et assez nombreux pour noyer les vrais.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-http-'));
  fs.writeFileSync(
    path.join(dir, 'app.js'),
    [
      'const a = "http://example.com/api";',
      'const b = "http://localhost:3000";',
      'const c = "http://monsite.test/x";',
      'const reel = "http://api.production-reelle.fr/v1";',
    ].join('\n'),
  );

  const rapport = await scan(dir, { noHistory: true });
  const http = rapport.findings.filter((f) => f.ruleId === 'SEC-HTTP-URL');

  assert.equal(http.length, 1, 'seule l\'adresse reelle doit remonter');
  assert.match(http[0].snippet, /production-reelle/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('sous-projets : un harnais de test n\'est pas un composant du produit', async () => {
  // Axios etait decrit comme « monorepo de 6 projets », dont cinq dossiers de
  // test qui portent un package.json pour s'isoler.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-mono2-'));
  fs.mkdirSync(path.join(dir, 'tests/smoke/esm'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages/coeur'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'r', private: true, workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(dir, 'tests/smoke/esm/package.json'), JSON.stringify({ name: 'fumee', type: 'module' }));
  fs.writeFileSync(path.join(dir, 'tests/smoke/esm/index.js'), 'import "../../../packages/coeur/index.js";\n');
  fs.writeFileSync(path.join(dir, 'packages/coeur/package.json'), JSON.stringify({ name: 'coeur', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'packages/coeur/index.js'), 'export const version = 1;\n');

  const rapport = await scan(dir, { noHistory: true });
  const chemins = rapport.project.sousProjets.map((p) => p.chemin);

  assert.ok(chemins.includes('packages/coeur'));
  assert.ok(!chemins.some((c) => c.startsWith('tests/')), `harnais compte : ${chemins.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});
