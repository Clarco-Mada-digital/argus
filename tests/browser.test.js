import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { monter, readFileSync, existsSync, readdirSync, statSync } from '../site/shims/fs.js';
import { createHash as createHashNavigateur } from '../site/shims/crypto.js';
import * as chemin from '../site/shims/path.js';

/**
 * La version navigateur n'est pas un portage : c'est le meme coeur, avec
 * `node:fs`, `node:path` et `node:crypto` rediriges par une carte d'imports.
 * Ces tests verifient que les shims se comportent comme leurs equivalents Node
 * — sans quoi l'analyse divergerait silencieusement d'une plateforme a l'autre.
 */

test('shim crypto : empreintes identiques a celles de Node', () => {
  for (const texte of ['', 'a', 'Argus', 'x'.repeat(1000), 'accents éàü — et ponctuation']) {
    assert.equal(
      createHashNavigateur('sha1').update(texte).digest(),
      createHash('sha1').update(texte).digest('hex'),
      `divergence sur ${JSON.stringify(texte.slice(0, 20))}`,
    );
  }
});

test('shim crypto : un algorithme non gere est signale', () => {
  assert.throws(() => createHashNavigateur('sha256'), /non disponible/);
});

test('shim path : memes resultats que node:path pour nos usages', async () => {
  const node = await import('node:path');
  const cas = [
    ['join', ['a', 'b', 'c.js']],
    ['join', ['a/b', '../c.js']],
    ['dirname', ['a/b/c.js']],
    ['basename', ['a/b/c.js']],
    ['extname', ['a/b/c.blade.php']],
    ['extname', ['sans-extension']],
    ['normalize', ['a//b/./c/../d']],
    ['relative', ['/x/a/b', '/x/a/c/d.js']],
    ['relative', ['/x/a', '/x/a/b/c.js']],
  ];

  for (const [methode, args] of cas) {
    assert.equal(chemin[methode](...args), node[methode](...args), `${methode}(${args.join(', ')})`);
  }
});

test('shim fs : le systeme de fichiers virtuel se comporte comme un disque', () => {
  monter([
    ['projet/package.json', '{"name":"x"}'],
    ['projet/src/index.js', 'export const a = 1;\n'],
    ['projet/src/outils.js', 'export const b = 2;\n'],
  ]);

  assert.ok(existsSync('/projet/package.json'));
  assert.ok(existsSync('/projet/src'), 'les dossiers intermediaires doivent exister');
  assert.ok(!existsSync('/projet/absent.js'));
  assert.equal(readFileSync('/projet/package.json'), '{"name":"x"}');

  assert.deepEqual(readdirSync('/projet').sort(), ['package.json', 'src']);
  const entrees = readdirSync('/projet', { withFileTypes: true });
  assert.equal(entrees.find((e) => e.name === 'src').isDirectory(), true);
  assert.equal(entrees.find((e) => e.name === 'package.json').isFile(), true);

  assert.equal(statSync('/projet/src').isDirectory(), true);
  assert.throws(() => readFileSync('/projet/absent.js'), /ENOENT/);
});

test('navigateur : chaque module Node atteint depuis la page a son shim', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');

  const RACINE = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

  // Carte d'imports declaree dans la page.
  const page = fs.readFileSync(path.join(RACINE, 'site/analyser.html'), 'utf8');
  const carte = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(page)[1]);
  const shims = new Set(Object.keys(carte.imports));

  // Parcours des modules reellement charges depuis site/app.js.
  const vus = new Set();
  const requis = new Set();
  const suivre = (fichier) => {
    if (vus.has(fichier) || !fs.existsSync(fichier)) return;
    vus.add(fichier);
    const contenu = fs.readFileSync(fichier, 'utf8');
    for (const m of contenu.matchAll(/from\s+'([^']+)'/g)) {
      const cible = m[1];
      if (cible.startsWith('node:')) requis.add(cible);
      else if (cible.startsWith('.')) suivre(path.resolve(path.dirname(fichier), cible));
    }
  };
  suivre(path.join(RACINE, 'site/app.js'));

  const manquants = [...requis].filter((m) => !shims.has(m));
  assert.deepEqual(
    manquants,
    [],
    `modules Node sans shim dans la carte d'imports : ${manquants.join(', ')} — la page echouerait au chargement`,
  );
  assert.ok(vus.size > 20, `le parcours doit atteindre le coeur d'Argus (${vus.size} modules vus)`);
});

test('navigateur : les fonctionnalites liees a Git se degradent proprement', async () => {
  const { execFileSync } = await import('../site/shims/child_process.js');
  assert.throws(() => execFileSync('git', ['status']), /indisponible dans le navigateur/);
});
