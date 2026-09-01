import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const scanner = (nom) => scan(path.join(FIXTURES, nom));

const [react, angular, nuxt, astro, sveltekit, flask, fastapi] = await Promise.all(
  ['react', 'angular', 'nuxt', 'astro', 'sveltekit', 'flask', 'fastapi'].map(scanner),
);

const regles = (r) => new Set(r.findings.map((f) => f.ruleId));
const trouve = (r, id) => r.findings.find((f) => f.ruleId === id);

function projet(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-fw-'));
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, nom);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

// ------------------------------------------------------------------- React

test('react : un jeton dans le stockage du navigateur', () => {
  const f = trouve(react, 'REACT-TOKEN-IN-STORAGE');
  assert.ok(f, 'localStorage.setItem("auth_token", …)');
  assert.match(f.suggestion, /httpOnly/);
});

test('react : liste sans key et lien dynamique', () => {
  assert.ok(regles(react).has('REACT-LIST-NO-KEY'));
  assert.ok(regles(react).has('REACT-DYNAMIC-HREF'));
});

test('react : du code correct ne produit aucun bruit', async () => {
  const dir = projet({
    'package.json': '{"name":"a","dependencies":{"react":"^18.2.0"}}',
    'src/Liste.jsx': [
      'export default function Liste({ items }) {',
      '  return (',
      '    <ul>',
      '      {items.map((item) => (',
      '        <li key={item.id}>{item.nom}</li>',
      '      ))}',
      '    </ul>',
      '  );',
      '}',
    ].join('\n'),
  });
  const r = await scan(dir, { categories: ['security', 'quality'] });
  const bruit = r.findings.filter((f) => f.ruleId.startsWith('REACT-'));
  assert.deepEqual(bruit, [], `faux positifs : ${bruit.map((f) => f.ruleId).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------- Angular

test('angular : contournement de l\'assainissement', () => {
  const f = trouve(angular, 'ANGULAR-BYPASS-SECURITY');
  assert.ok(f);
  assert.equal(f.severity, 'high');
  assert.ok(regles(angular).has('ANGULAR-INNERHTML-BINDING'));
});

// -------------------------------------------------------------------- Nuxt

test('nuxt : secret dans runtimeConfig.public', () => {
  const f = trouve(nuxt, 'NUXT-PUBLIC-RUNTIME-SECRET');
  assert.ok(f, 'un secret sous public part dans le navigateur');
  assert.equal(f.severity, 'critical');
  assert.match(f.message, /serialise/);
});

test('nuxt : rendu serveur desactive et devtools', () => {
  assert.ok(regles(nuxt).has('NUXT-SSR-DISABLED'));
  assert.ok(regles(nuxt).has('NUXT-DEVTOOLS-ENABLED'));
});

// ------------------------------------------------------------------- Astro

test('astro : injection HTML et hydratation sans rendu serveur', () => {
  assert.ok(regles(astro).has('ASTRO-SET-HTML'));
  const f = trouve(astro, 'ASTRO-CLIENT-ONLY');
  assert.ok(f);
  assert.match(f.suggestion, /client:visible/);
});

test('astro : secret injecte par vite.define', () => {
  const f = trouve(astro, 'ASTRO-VITE-DEFINE-SECRET');
  assert.ok(f);
  assert.equal(f.severity, 'critical');
});

// --------------------------------------------------------------- SvelteKit

test('sveltekit : le retour de load() part dans le navigateur', () => {
  const f = trouve(sveltekit, 'SVELTEKIT-SERVER-DATA-LEAK');
  assert.ok(f, 'malgre le nom « .server », le retour est serialise');
  assert.equal(f.severity, 'critical');
  assert.match(f.message, /malgre le nom/);
});

test('sveltekit : {@html} et routage par convention', () => {
  assert.ok(regles(sveltekit).has('SVELTE-HTML-TAG'));
  // `+page.svelte` designe le dossier, `+page.server.js` n'est pas une route.
  assert.deepEqual(sveltekit.routes.map((r) => r.pattern), ['/']);
});

// ------------------------------------------------------------------- Flask

test('flask : clef de session, CSRF et traversee de chemin', () => {
  const cle = trouve(flask, 'FLASK-SECRET-KEY-HARDCODED');
  assert.ok(cle);
  assert.equal(cle.severity, 'critical');
  assert.ok(regles(flask).has('FLASK-NO-CSRF'), 'Flask n\'en fournit aucune par defaut');
  assert.ok(regles(flask).has('FLASK-SEND-FILE-TRAVERSAL'));
});

test('flask : un projet protege par Flask-WTF ne remonte pas', async () => {
  const dir = projet({
    'requirements.txt': 'Flask==3.0.0\nFlask-WTF==1.2.1\n',
    'app.py': [
      'import os',
      'from flask import Flask, request',
      'from flask_wtf.csrf import CSRFProtect',
      '',
      'app = Flask(__name__)',
      'app.secret_key = os.environ["FLASK_SECRET_KEY"]',
      'CSRFProtect(app)',
      '',
      "@app.route('/contact', methods=['POST'])",
      'def contact():',
      '    return "ok"',
    ].join('\n'),
  });
  const r = await scan(dir, { categories: ['security'] });
  const bruit = r.findings.filter((f) => f.ruleId.startsWith('FLASK-'));
  assert.deepEqual(bruit, [], `faux positifs : ${bruit.map((f) => f.ruleId).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------- FastAPI

test('fastapi : CORS ouvert combine aux identifiants', () => {
  const f = trouve(fastapi, 'FASTAPI-CORS-CREDENTIALS');
  assert.ok(f);
  assert.equal(f.severity, 'critical');
  assert.match(f.message, /specification interdit/);
});

test('fastapi : response_model manquant, sans signaler les endpoints simples', () => {
  const sans = fastapi.findings.filter((f) => f.ruleId === 'FASTAPI-NO-RESPONSE-MODEL');
  assert.equal(sans.length, 1, 'seul l\'endpoint qui renvoie un objet de base doit remonter');
});

// ------------------------------------------------- Regle transverse et bruit

test('variables publiques : une seule regle couvre tous les outils', () => {
  const outils = new Set();
  for (const r of [nuxt, astro, sveltekit]) {
    for (const f of r.findings.filter((x) => x.ruleId === 'ENV-PUBLIC-SECRET')) outils.add(f.data.outil);
  }
  assert.ok(outils.size >= 2, `plusieurs ecosystemes attendus, vus : ${[...outils].join(', ')}`);
});

test('variables publiques : une valeur manifestement publique ne remonte pas', async () => {
  const dir = projet({
    'package.json': '{"name":"a","dependencies":{"vite":"^5.4.6"}}',
    '.env': [
      'VITE_API_URL=https://api.exemple.com',
      'VITE_STRIPE_PUBLISHABLE_KEY=pk_test_visible',
      'VITE_SENTRY_PUBLIC_KEY=abc',
      'VITE_APP_VERSION=1.2.3',
    ].join('\n'),
  });
  const r = await scan(dir, { categories: ['security'] });
  const bruit = r.findings.filter((f) => f.ruleId === 'ENV-PUBLIC-SECRET');
  assert.deepEqual(bruit, [], `une clef publiable n'est pas une fuite : ${bruit.map((f) => f.title).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('packs : chacun reste dans son perimetre', () => {
  const paires = [[react, 'ANGULAR-'], [angular, 'REACT-'], [nuxt, 'ASTRO-'], [flask, 'FASTAPI-'], [fastapi, 'FLASK-']];
  for (const [resultat, prefixe] of paires) {
    assert.ok(![...regles(resultat)].some((r) => r.startsWith(prefixe)), `${prefixe} ne doit pas fuiter`);
  }
});

test('packs : aucun bruit de code mort sur les conventions de framework', () => {
  for (const [nom, r] of Object.entries({ react, angular, nuxt, astro, sveltekit, flask, fastapi })) {
    const morts = r.findings.filter((f) => f.ruleId === 'DEAD-FILE' || f.ruleId === 'ROUTE-ORPHAN');
    assert.deepEqual(morts, [], `${nom} : ${morts.map((f) => `${f.ruleId} ${f.file}`).join(', ')}`);
  }
});
