import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

const LARAVEL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/laravel');
const resultat = await scan(LARAVEL);
const regles = new Set(resultat.findings.map((f) => f.ruleId));

test('laravel : le framework est reconnu', () => {
  assert.ok(resultat.project.frameworks.includes('laravel'));
});

test('laravel : les routes sont extraites', () => {
  const chemins = resultat.routes.map((r) => r.pattern);
  assert.ok(chemins.includes('/produits/{id}'), 'segment dynamique');
  assert.ok(chemins.includes('/commander'));
  assert.ok(regles.has('ROUTE-UPPERCASE'), '/Promotions doit etre signalee');
});

test('laravel : formulaire Blade sans @csrf', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'LARAVEL-CSRF-MISSING');
  assert.ok(finding, 'Laravel renverrait une erreur 419');
  assert.match(finding.file, /\.blade\.php$/);
});

test('laravel : env() hors des fichiers de configuration', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'LARAVEL-ENV-OUTSIDE-CONFIG');
  assert.ok(finding, 'env() dans un controleur renvoie null apres config:cache');
  assert.match(finding.file, /Controllers/);
  // config/services.php utilise env() legitimement : aucun bruit attendu.
  const signales = resultat.findings.filter((f) => f.ruleId === 'LARAVEL-ENV-OUTSIDE-CONFIG');
  assert.ok(!signales.some((f) => f.file.startsWith('config/')), 'env() est legitime dans config/');
});

test('laravel : protections Eloquent', () => {
  assert.ok(regles.has('LARAVEL-GUARDED-EMPTY'), '$guarded = [] doit etre signale');
  const cache = resultat.findings.find((f) => f.ruleId === 'LARAVEL-MODEL-NO-HIDDEN');
  assert.ok(cache, 'password dans $fillable sans $hidden');
  assert.match(cache.message, /password/);
});

test('laravel : injections et anti-patterns generiques', () => {
  for (const attendu of ['SEC-SQL-CONCAT', 'SEC-MASS-ASSIGNMENT', 'SEC-OPEN-REDIRECT', 'PERF-NESTED-LOOP-QUERY', 'SEC-TEMPLATE-AUTOESCAPE']) {
    assert.ok(regles.has(attendu), `${attendu} attendu`);
  }
});

test('laravel : les vues Blade sont auditees comme du HTML', () => {
  const surBlade = resultat.findings.filter((f) => f.file?.endsWith('.blade.php')).map((f) => f.ruleId);
  assert.ok(surBlade.includes('SEO-VIEWPORT-MISSING'), 'le SEO doit s\'appliquer aux gabarits');
  assert.ok(surBlade.includes('SEO-OG-MISSING'));
});

test('laravel : aucun bruit sur les conventions du framework', () => {
  const morts = resultat.findings.filter((f) => f.ruleId.startsWith('DEAD-'));
  assert.deepEqual(morts, [], `faux positifs : ${morts.map((f) => `${f.ruleId} ${f.file}`).join(', ')}`);
});

test('laravel : le pack ne se declenche pas ailleurs', async () => {
  const django = await scan(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/django'));
  assert.ok(!django.findings.some((f) => f.ruleId.startsWith('LARAVEL-')));
});
