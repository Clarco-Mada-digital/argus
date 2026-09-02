import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';
import { constatDansSonDomaine, domaineDeLaRegle } from '../src/core/domaines.js';

/** Application de bureau realiste : interface HTML, CSS, script de preload. */
function appDeBureau() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-dom-'));
  fs.mkdirSync(path.join(dir, 'src/main'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/renderer/styles'), { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'atelier', main: 'src/main/index.js', devDependencies: { electron: '^28.2.0' } }),
  );
  fs.writeFileSync(
    path.join(dir, 'src/main/index.js'),
    "const { app, BrowserWindow } = require('electron');\nconst { join } = require('path');\napp.whenReady().then(() => {\n  new BrowserWindow({ webPreferences: { preload: join(__dirname, 'preload.js') } });\n});\n",
  );
  fs.writeFileSync(path.join(dir, 'src/main/preload.js'), "const { contextBridge } = require('electron');\ncontextBridge.exposeInMainWorld('api', {});\n");
  fs.writeFileSync(
    path.join(dir, 'src/renderer/index.html'),
    [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Atelier</title>',
      '<link rel="stylesheet" href="https://cdn.exemple.com/police.css">',
      '<link rel="stylesheet" href="./styles/app.css"></head>',
      '<body><h1>Atelier</h1><input type="text" aria-label="Rechercher"></body></html>',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'src/renderer/styles/app.css'), '.panneau { width: 340px; }\n.b { color: #eee; background: #111; }\n');
  return dir;
}

test('domaines : la table declare une raison pour chaque restriction', () => {
  // Une liste sans justification devient un fourre-tout ou l'on ajoute par
  // reflexe. Chaque entree doit dire pourquoi elle restreint.
  for (const id of ['SEO-DESC-MISSING', 'PERF-NO-PRECONNECT', 'ROUTE-NO-404', 'DESIGN-FIXED-WIDTH']) {
    const domaine = domaineDeLaRegle(id);
    assert.ok(domaine, `${id} doit avoir un domaine`);
    assert.ok(domaine.raison.length > 20, `${id} doit expliquer sa restriction`);
  }
});

test('domaines : sans entree, une regle vaut partout', () => {
  // Le defaut est permissif : une regle muette a tort coute plus cher qu'une
  // regle bavarde a tort, parce que la seconde se voit.
  assert.equal(domaineDeLaRegle('A11Y-CONTRAST'), null);
  assert.ok(constatDansSonDomaine('A11Y-CONTRAST', ['desktop']));
  assert.ok(constatDansSonDomaine('SEC-SQL-CONCAT', ['mobile']));
});

test('domaines : une plateforme sur plusieurs suffit a garder la regle', () => {
  // Un monorepo web + mobile doit garder le SEO pour sa partie web.
  assert.ok(constatDansSonDomaine('SEO-DESC-MISSING', ['web', 'mobile']));
  assert.ok(!constatDansSonDomaine('SEO-DESC-MISSING', ['mobile']));
});

test('bureau : les regles propres au web ne s\'appliquent plus', async () => {
  const dir = appDeBureau();
  const rapport = await scan(dir, { noHistory: true });
  const trouves = rapport.findings.map((f) => f.ruleId);

  for (const horsDomaine of [
    'A11Y-NO-SKIP-LINK',      // repond a une navigation repetee entre pages
    'UX-NO-AUTOCOMPLETE',     // pilote le remplissage du navigateur
    'DESIGN-FIXED-WIDTH',     // un panneau fixe est la norme en bureau
    'DESIGN-NO-BREAKPOINTS',  // pas de diversite d'ecrans a couvrir
    'PERF-NO-PRECONNECT',     // indication de reseau
    'ROUTE-NO-404',
    'ROUTE-ORPHAN',
  ]) {
    assert.ok(!trouves.includes(horsDomaine), `${horsDomaine} ne devrait pas s'appliquer`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('bureau : l\'accessibilite, elle, reste verifiee', async () => {
  // Une application de bureau doit etre utilisable au clavier et au lecteur
  // d'ecran autant qu'un site. Restreindre le domaine ne doit pas servir de
  // pretexte a ne plus rien verifier.
  const dir = appDeBureau();
  const rapport = await scan(dir, { noHistory: true });
  const categories = new Set(rapport.findings.map((f) => f.category));

  assert.ok(categories.has('design'), 'les regles de design et d\'accessibilite restent actives');
  assert.ok(rapport.findings.some((f) => f.ruleId.startsWith('A11Y-') || f.ruleId.startsWith('DESIGN-')));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('bureau : une ressource distante casse l\'application hors ligne', async () => {
  const dir = appDeBureau();
  const rapport = await scan(dir, { noHistory: true });
  const constat = rapport.findings.find((f) => f.ruleId === 'APP-RESSOURCE-DISTANTE');

  assert.ok(constat, 'un CDN dans une application installee doit etre signale');
  assert.match(constat.title, /cdn\.exemple\.com/);
  assert.equal(constat.category, 'security');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('bureau : le script de preload n\'est pas du code mort', async () => {
  // Il est designe par `preload: join(__dirname, 'preload.js')` : aucun import
  // ne le mentionne, alors qu'il est le pont entre la fenetre et le systeme.
  const dir = appDeBureau();
  const rapport = await scan(dir, { noHistory: true });

  assert.ok(
    !rapport.findings.some((f) => f.ruleId === 'DEAD-FILE' && f.file.includes('preload')),
    'le preload est charge par le runtime',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('web : aucune regle web ne disparait d\'un vrai site', async () => {
  const demo = path.join(import.meta.dirname, 'fixtures', 'demo-site');
  const rapport = await scan(demo, { noHistory: true });
  const trouves = new Set(rapport.findings.map((f) => f.ruleId));

  assert.ok([...trouves].some((id) => id.startsWith('SEO-')), 'le SEO reste actif sur un site');
  assert.ok([...trouves].some((id) => id.startsWith('PERF-')), 'la performance reste active');
});

test('web : une ressource distante sur un site n\'est pas signalee', async () => {
  // Un CDN sur une page web est un arbitrage courant, pas un defaut.
  const demo = path.join(import.meta.dirname, 'fixtures', 'demo-site');
  const rapport = await scan(demo, { noHistory: true });
  assert.deepEqual(rapport.findings.filter((f) => f.ruleId === 'APP-RESSOURCE-DISTANTE'), []);
});
