import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

// Projet Django realiste : conventions du framework et defauts classiques.
const DJANGO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/django');
const resultat = await scan(DJANGO);

const regles = new Set(resultat.findings.map((f) => f.ruleId));
const fichiersPour = (id) => resultat.findings.filter((f) => f.ruleId === id).map((f) => f.file);

test('django : le framework est reconnu', () => {
  assert.ok(resultat.project.frameworks.includes('django'));
});

test('django : les routes sont extraites, y compris via include()', () => {
  const chemins = resultat.routes.map((r) => r.pattern);
  assert.ok(chemins.includes('/'), 'route racine');
  assert.ok(chemins.includes('/articles/<int:pk>'), 'segment type');
  assert.ok(chemins.includes('/archives'), 'route d\'une application incluse');
  assert.ok(chemins.includes('/Contact'), 'route a corriger');
  assert.ok(regles.has('ROUTE-UPPERCASE'), 'majuscule dans l\'URL non signalee');
});

test('django : les defauts de settings.py sont detectes', () => {
  for (const attendu of ['SEC-ALLOWED-HOSTS-WILDCARD', 'SEC-SECURE-FLAG-OFF', 'SEC-DEBUG-ON']) {
    assert.ok(regles.has(attendu), `${attendu} attendu`);
  }
  // SECRET_KEY et le mot de passe de base, y compris comme clef de dictionnaire.
  const secrets = resultat.findings.filter((f) => f.ruleId.startsWith('SEC-SECRET'));
  assert.ok(secrets.length >= 2, `deux secrets attendus, ${secrets.length} trouve(s)`);
});

test('django : injections et deserialisation dans les vues', () => {
  for (const attendu of ['SEC-SQL-CONCAT', 'SEC-PICKLE', 'SEC-CSRF-OFF', 'SEC-WEAK-HASH', 'SEC-TEMPLATE-AUTOESCAPE']) {
    assert.ok(regles.has(attendu), `${attendu} attendu`);
  }
});

test('django : le probleme N+1 de l\'ORM est vu malgre l\'indentation', () => {
  assert.ok(regles.has('PERF-NESTED-LOOP-QUERY'), 'boucle avec .objects.get() non signalee');
});

test('django : les gabarits du framework sont analyses comme du HTML', () => {
  assert.ok(regles.has('SEO-LANG-MISSING'));
  assert.ok(regles.has('A11Y-INPUT-NO-LABEL'));
  assert.ok(regles.has('ROUTE-BROKEN-LINK'), 'lien interne mort dans le gabarit');
});

test('django : aucun bruit sur les fichiers de convention du framework', () => {
  // settings.py, views.py, models.py sont charges par Django, jamais importes.
  assert.deepEqual(fichiersPour('DEAD-FILE'), [], 'un fichier de convention est signale comme mort');
  const exports = fichiersPour('DEAD-EXPORT');
  assert.ok(
    !exports.some((f) => /settings\.py$/.test(f)),
    'les constantes de settings.py sont lues par reflexion, pas mortes',
  );
});

test('django : le decorateur importe ne compte pas comme une desactivation', () => {
  const csrf = resultat.findings.filter((f) => f.ruleId === 'SEC-CSRF-OFF');
  assert.ok(csrf.every((f) => f.line !== 7), 'la ligne d\'import ne doit pas etre signalee');
});

// ------------------------------------------------- Pack de regles Django

test('django : formulaire POST sans jeton CSRF', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'DJANGO-CSRF-TOKEN-MISSING');
  assert.ok(finding, 'un formulaire POST sans {% csrf_token %} doit etre signale');
  assert.match(finding.file, /accueil\.html$/);
});

test('django : nom de route errone dans un gabarit', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'DJANGO-URL-UNKNOWN');
  assert.ok(finding, 'la faute de frappe dans {% url %} doit etre vue');
  assert.match(finding.message, /liste-artciles/);

  // Et surtout : le nom correct ne doit produire aucun bruit.
  const signales = resultat.findings.filter((f) => f.ruleId === 'DJANGO-URL-UNKNOWN');
  assert.ok(!signales.some((f) => f.message.includes("'detail-article'")), 'un nom valide ne doit pas remonter');
});

test('django : SECRET_KEY en dur, avec le bon numero de ligne', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'DJANGO-SECRET-KEY-HARDCODED');
  assert.ok(finding);
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.line, 5, 'la ligne pointee doit etre celle de SECRET_KEY');
});

test('django : reglages de durcissement absents', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'DJANGO-HARDENING-MISSING');
  assert.ok(finding);
  assert.match(finding.suggestion, /check --deploy/);
  assert.match(finding.message, /SECURE_SSL_REDIRECT/);
});

test('django : conventions de modeles', () => {
  const sansStr = resultat.findings.filter((f) => f.ruleId === 'DJANGO-MODEL-NO-STR');
  assert.equal(sansStr.length, 2, 'les deux modeles sont sans __str__');

  const champNul = resultat.findings.find((f) => f.ruleId === 'DJANGO-CHARFIELD-NULL');
  assert.ok(champNul, 'null=True sur un CharField doit etre signale');
  assert.match(champNul.message, /resume/);
});

test('django : le pack ne se declenche que sur un projet Django', async () => {
  const autre = await scan(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/demo-site'));
  assert.ok(!autre.findings.some((f) => f.ruleId.startsWith('DJANGO-')), 'aucune regle Django hors projet Django');
});
