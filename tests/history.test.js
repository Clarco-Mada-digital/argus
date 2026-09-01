import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { scan } from '../src/index.js';
import { renderHtml } from '../src/report/html.js';
import { lireHistorique, enregistrer, comparer, depuis } from '../src/core/history.js';

function projetTemporaire(contenu = 'eval(x);\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-hist-'));
  fs.writeFileSync(path.join(dir, 'index.js'), contenu);
  return dir;
}

test('historique : enregistrement puis relecture', async () => {
  const dir = projetTemporaire();
  assert.deepEqual(lireHistorique(dir), [], 'vide au depart');

  const resultat = await scan(dir, { categories: ['security'] });
  const entree = enregistrer(dir, resultat);

  assert.ok(entree);
  assert.equal(entree.global, resultat.scores.global);
  assert.equal(lireHistorique(dir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historique : le delta reflete une amelioration reelle', async () => {
  const dir = projetTemporaire();
  const avant = await scan(dir, { categories: ['security'] });
  enregistrer(dir, avant);

  // On corrige le probleme, puis on recompare.
  fs.writeFileSync(path.join(dir, 'index.js'), 'export const x = 1;\n');
  const apres = await scan(dir, { categories: ['security'] });
  const evolution = comparer(lireHistorique(dir), apres);

  assert.ok(evolution, 'une comparaison doit exister');
  assert.ok(evolution.delta > 0, `le score doit monter, delta = ${evolution.delta}`);
  assert.ok(evolution.deltaTotal < 0, 'le nombre de problemes doit baisser');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historique : rien n\'est enregistre en mode differentiel', async () => {
  const dir = projetTemporaire();
  const resultat = await scan(dir, { categories: ['security'] });
  // Un score differentiel porte sur un perimetre reduit : il fausserait la courbe.
  resultat.diff = { ref: 'HEAD', files: ['index.js'] };
  assert.equal(enregistrer(dir, resultat), null);
  assert.deepEqual(lireHistorique(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historique : la courbe apparait dans le rapport HTML', async () => {
  const dir = projetTemporaire();
  const resultat = await scan(dir, { categories: ['security'] });
  resultat.history = [
    { date: '2026-08-01T10:00:00Z', global: 60, total: 20, commit: 'aaa1111' },
    { date: '2026-08-15T10:00:00Z', global: 75, total: 12, commit: 'bbb2222' },
    { date: '2026-09-01T10:00:00Z', global: 88, total: 5, commit: 'ccc3333' },
  ];

  const html = renderHtml(resultat);
  const donnees = JSON.parse(/<script type="application\/json" id="argus-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(donnees.history.length, 3);
  assert.deepEqual(donnees.history.map((h) => h.global), [60, 75, 88]);

  // Specs de marques : trace fin, point de fin visible, survol qui enrichit.
  assert.match(html, /'stroke-width': '2'/, 'le trace doit rester fin');
  assert.match(html, /spark-tip/, 'une infobulle doit exister');
  // La valeur reste lisible sans survol : l'onglet Projet en donne le tableau.
  assert.match(html, /text: 'Analyse'/, 'une vue tableau doit exister');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rapport : tabular-nums reserve aux colonnes de nombres', () => {
  const html = renderHtml({
    tool: { name: 'Argus', version: '1' }, startedAt: new Date().toISOString(), durationMs: 1, root: '/x',
    project: { files: 1, analyzed: 1, skipped: 0, frameworks: [], stack: [], dependencies: [] },
    scores: { global: 100, grade: 'A+', categories: {}, counts: {}, total: 0 },
    findings: [], actionPlan: [], routes: [], insights: {}, history: [],
  });
  // Sur une grande valeur isolee, la chasse fixe fait paraitre le nombre desserre.
  assert.ok(!/\.stat-v \{[^}]*tabular-nums/.test(html), 'pas de chasse fixe sur une valeur isolee');
  assert.ok(!/\.cat-score \{[^}]*tabular-nums/.test(html), 'idem sur le score de categorie');
  assert.match(html, /td\.num \{[^}]*tabular-nums/, 'mais bien dans les colonnes de tableau');
});

test('historique : formulation des durees', () => {
  assert.equal(depuis(30_000), 'a l\'instant');
  assert.equal(depuis(600_000), 'il y a 10 min');
  assert.equal(depuis(7_200_000), 'il y a 2 h');
  assert.equal(depuis(86_400_000), 'hier');
});

// ------------------------------------------------------------- Identite visuelle

test('icone : le rapport porte un favicon et reste autonome', () => {
  const html = renderHtml({
    tool: { name: 'Argus', version: '1' }, startedAt: new Date().toISOString(), durationMs: 1, root: '/x',
    project: { files: 1, analyzed: 1, skipped: 0, frameworks: [], stack: [], dependencies: [] },
    scores: { global: 100, grade: 'A+', categories: {}, counts: {}, total: 0 },
    findings: [], actionPlan: [], routes: [], insights: {}, history: [],
  });

  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/, 'favicon embarque attendu');
  assert.match(html, /<meta name="theme-color"/, 'couleur de theme attendue');
  // Le rapport doit rester un fichier unique : aucune ressource distante.
  assert.ok(!/<(script|img|link)[^>]+(src|href)="https?:/.test(html), 'aucune ressource externe');
});

test('icone : le SVG est minimal et sans dependance', async () => {
  const { ICONE_SVG, iconeDataUri } = await import('../src/report/html.js');
  assert.ok(ICONE_SVG.length < 400, `SVG trop lourd pour un data URI : ${ICONE_SVG.length} octets`);
  assert.match(ICONE_SVG, /viewBox="0 0 32 32"/);
  // Fond plein : l'icone garde son contraste sur un onglet clair comme sombre.
  assert.match(ICONE_SVG, /<rect[^>]*fill="#4c8dff"/);
  assert.ok(!/<image|xlink:href|url\(/.test(ICONE_SVG), 'aucune ressource externe dans le SVG');
  assert.ok(iconeDataUri().startsWith('data:image/svg+xml,'));
});
