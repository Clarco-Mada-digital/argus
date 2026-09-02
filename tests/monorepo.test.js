import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';
import { decouvrirSousProjets, attribuer } from '../src/core/workspaces.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const analyser = (nom) => scan(path.join(FIXTURES, nom), { noHistory: true });
const ids = (rapport) => rapport.findings.map((f) => f.ruleId);

test('monorepo : chaque application est jugee sur ce qu\'elle declare', async () => {
  const rapport = await analyser('monorepo');
  const projets = Object.fromEntries(rapport.project.sousProjets.map((p) => [p.chemin, p]));

  assert.ok(rapport.project.monorepo);
  assert.equal(rapport.project.sousProjets.length, 3);

  assert.equal(projets['apps/web'].description, 'Next.js');
  assert.deepEqual(projets['apps/web'].platforms, ['web']);

  assert.equal(projets['apps/mobile'].description, 'React Native (Expo)');
  assert.deepEqual(projets['apps/mobile'].platforms, ['mobile']);

  assert.equal(projets['packages/ui'].description, 'React');
});

test('monorepo : la racine herite des frameworks de ses sous-projets', async () => {
  // Le manifeste racine ne declare que turbo. Sans union, aucune regle
  // specialisee ne s'activait et le depot restait de fait non analyse.
  const rapport = await analyser('monorepo');

  for (const attendu of ['nextjs', 'react-native', 'expo', 'react']) {
    assert.ok(rapport.project.frameworks.includes(attendu), `${attendu} attendu`);
  }
  assert.deepEqual([...rapport.project.platforms].sort(), ['mobile', 'web']);
});

test('monorepo : les regles mobiles atteignent l\'application mobile', async () => {
  const trouves = ids(await analyser('monorepo'));
  assert.ok(trouves.includes('RN-STOCKAGE-NON-CHIFFRE'));
  assert.ok(trouves.includes('MOBILE-TRAFIC-EN-CLAIR'));
});

test('monorepo : une page Next.js n\'est pas du code mort', async () => {
  // `apps/web/pages/contact.jsx` est chargee par le routeur. Les conventions
  // etaient testees depuis la racine du depot, donc jamais reconnues.
  const rapport = await analyser('monorepo');
  const morts = rapport.findings.filter(
    (f) => (f.ruleId === 'DEAD-FILE' || f.ruleId === 'DEAD-EXPORT') && f.file?.includes('pages/'),
  );
  assert.deepEqual(morts, [], 'une page de routeur est vivante');
});

test('monorepo : le SEO vise l\'application web, pas le depot', async () => {
  const rapport = await analyser('monorepo');
  const robots = rapport.findings.filter((f) => f.ruleId === 'SEO-ROBOTS-MISSING');

  // Une seule fois : packages/ui est une bibliotheque, pas un site.
  assert.equal(robots.length, 1);
  assert.match(
    robots[0].suggestion,
    /apps\/web\/public\/robots\.txt/,
    'le conseil doit dire ou creer le fichier, pas laisser deviner',
  );
});

test('espaces de travail : attribution au sous-projet le plus profond', () => {
  const sousProjets = ['apps/mobile', 'apps', 'packages/ui'].sort((a, b) => b.length - a.length);

  assert.equal(attribuer('apps/mobile/app/index.tsx', sousProjets), 'apps/mobile');
  assert.equal(attribuer('apps/autre/x.js', sousProjets), 'apps');
  assert.equal(attribuer('packages/ui/src/index.js', sousProjets), 'packages/ui');
  assert.equal(attribuer('README.md', sousProjets), null);
});

test('espaces de travail : un dossier de plateforme native n\'est pas un projet', () => {
  const fichiers = [
    { name: 'package.json', relativePath: 'apps/mobile/package.json' },
    { name: 'build.gradle', relativePath: 'apps/mobile/android/build.gradle' },
    { name: 'package.json', relativePath: 'apps/web/package.json' },
  ];

  const trouves = decouvrirSousProjets(fichiers);
  assert.ok(trouves.includes('apps/mobile'));
  assert.ok(trouves.includes('apps/web'), '« web » est un nom d\'application, pas un dossier de plateforme');
  assert.ok(
    !trouves.includes('apps/mobile/android'),
    'android/ est une cible de compilation ; l\'en separer priverait le pack mobile de son contexte',
  );
});

test('un projet simple ne devient pas un monorepo', async () => {
  for (const nom of ['django', 'nextjs', 'expo', 'flutter', 'laravel']) {
    const rapport = await analyser(nom);
    assert.ok(!rapport.project.monorepo, `${nom} ne doit pas etre vu comme un monorepo`);
    assert.deepEqual(rapport.project.sousProjets, []);
  }
});

test('un dossier avec manifeste mais sans code n\'est pas compte', async () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-mono-'));
  fs.writeFileSync(path.join(racine, 'package.json'), JSON.stringify({ name: 'r', workspaces: ['*'] }));

  // Un paquet reel…
  fs.mkdirSync(path.join(racine, 'api'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '4.18.2' } }));
  fs.writeFileSync(path.join(racine, 'api/serveur.js'), 'import express from "express";\nconst app = express();\napp.listen(3000);\n');

  // …et une coquille vide, qui n'apprend rien.
  fs.mkdirSync(path.join(racine, 'vide'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'vide/package.json'), JSON.stringify({ name: 'vide' }));

  const rapport = await scan(racine, { noHistory: true });
  const chemins = rapport.project.sousProjets.map((p) => p.chemin);
  assert.deepEqual(chemins, ['api']);

  fs.rmSync(racine, { recursive: true, force: true });
});
