import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRoute, routeToRegExp, fileToRoutePattern } from '../src/lang/routes.js';

// Normalisation et correspondance des routes

// ------------------------------------------------------------------ routes

test('routes : normalisation des chemins', () => {
  assert.equal(normalizeRoute('users'), '/users');
  assert.equal(normalizeRoute('/users/'), '/users');
  assert.equal(normalizeRoute('//a//b'), '/a/b');
  assert.equal(normalizeRoute('/a?x=1#y'), '/a');
  assert.equal(normalizeRoute(''), '/');
});

test('routes : les motifs dynamiques deviennent des expressions', () => {
  assert.ok(routeToRegExp('/users/:id').test('/users/42'));
  assert.ok(routeToRegExp('/users/{id}').test('/users/42'));
  assert.ok(routeToRegExp('/users/<int:id>').test('/users/42'));
  assert.ok(!routeToRegExp('/users/:id').test('/users/42/edit'));
  assert.ok(routeToRegExp('/files/**').test('/files/a/b/c'));
});

test('routes : conversion des chemins de fichiers Next.js', () => {
  assert.equal(fileToRoutePattern('index.tsx', 'nextjs'), '/');
  assert.equal(fileToRoutePattern('blog/[slug].tsx', 'nextjs'), '/blog/:slug');
  assert.equal(fileToRoutePattern('blog/[...all].tsx', 'nextjs'), '/blog/*');
  assert.equal(fileToRoutePattern('blog/page.tsx', 'nextjs-app'), '/blog');
  assert.equal(fileToRoutePattern('blog/layout.tsx', 'nextjs-app'), null, 'un layout n\'est pas une route');
});

test('routes : un lien vers l\'index d\'un dossier est valide', async () => {
  const { scan } = await import('../src/index.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-liens-'));
  fs.mkdirSync(pathMod.join(dir, 'blog'), { recursive: true });

  const page = (corps) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>t</title></head><body><main><h1>T</h1>${corps}</main></body></html>`;
  fs.writeFileSync(pathMod.join(dir, 'index.html'), page('<a href="./blog/">Le blog</a>'));
  fs.writeFileSync(pathMod.join(dir, 'blog', 'index.html'), page('<a href="./">Racine du blog</a><a href="../">Accueil</a><a href="../absent/">Manquant</a>'));

  const r = await scan(dir, { categories: ['routes'] });
  const morts = r.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK').map((f) => f.data.target);

  assert.ok(!morts.includes('./'), '"./" designe l\'index du dossier courant');
  assert.ok(!morts.includes('../'), '"../" designe l\'index du dossier parent');
  assert.ok(!morts.includes('./blog/'), 'un dossier avec index.html est une cible valide');
  assert.ok(morts.includes('../absent/'), 'un dossier sans index doit rester signale');

  fs.rmSync(dir, { recursive: true, force: true });
});
