import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const express = await scan(path.join(FIXTURES, 'express'));
const nextjs = await scan(path.join(FIXTURES, 'nextjs'));

const regles = (r) => new Set(r.findings.map((f) => f.ruleId));

function projet(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-web-'));
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, nom);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

// ------------------------------------------------------------------ Express

test('express : cookie de session insuffisamment protege', () => {
  const f = express.findings.find((x) => x.ruleId === 'EXPRESS-SESSION-COOKIE');
  assert.ok(f);
  assert.match(f.message, /secure/);
  assert.match(f.suggestion, /httpOnly: true/);
});

test('express : fichiers caches servis est critique', () => {
  const f = express.findings.find((x) => x.ruleId === 'EXPRESS-STATIC-DOTFILES');
  assert.ok(f, 'dotfiles: "allow" expose .env et .git');
  assert.equal(f.severity, 'critical');
});

test('express : trace d\'exception renvoyee au client', () => {
  assert.ok(regles(express).has('EXPRESS-STACK-LEAK'));
});

test('express : corps de requete sans limite', () => {
  const trouves = express.findings.filter((x) => x.ruleId === 'EXPRESS-NO-BODY-LIMIT');
  assert.equal(trouves.length, 2, 'express.json() et express.urlencoded()');
});

test('express : une configuration correcte ne produit aucun bruit', async () => {
  const dir = projet({
    'package.json': '{"name":"api","dependencies":{"express":"^4.19.2","express-session":"^1.17.3"}}',
    'server.js': [
      "const express = require('express');",
      "const session = require('express-session');",
      'const app = express();',
      "app.use(express.json({ limit: '100kb' }));",
      'app.use(session({',
      "  secret: process.env.SESSION_SECRET,",
      '  resave: false,',
      '  saveUninitialized: false,',
      "  cookie: { secure: true, httpOnly: true, sameSite: 'lax' },",
      '}));',
      "app.use((err, req, res, next) => {",
      '  console.error(err);',
      "  res.status(500).json({ erreur: 'Erreur interne' });",
      '});',
      'module.exports = app;',
    ].join('\n'),
  });

  const r = await scan(dir, { categories: ['security', 'performance'] });
  const bruit = r.findings.filter((f) => f.ruleId.startsWith('EXPRESS-'));
  assert.deepEqual(bruit, [], `faux positifs : ${bruit.map((f) => f.ruleId).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ Next.js

test('nextjs : NEXT_PUBLIC_ sur une valeur sensible est critique', () => {
  const trouves = nextjs.findings.filter((f) => f.ruleId === 'NEXTJS-PUBLIC-SECRET');
  assert.ok(trouves.length >= 2, 'detectee dans le code comme dans le fichier .env');
  assert.ok(trouves.every((f) => f.severity === 'critical'));
  assert.match(trouves[0].message, /bundle telecharge par chaque visiteur/);
});

test('nextjs : NEXT_PUBLIC_ sur une valeur anodine ne remonte pas', () => {
  const trouves = nextjs.findings.filter((f) => f.ruleId === 'NEXTJS-PUBLIC-SECRET');
  assert.ok(
    !trouves.some((f) => f.title.includes('NEXT_PUBLIC_API_URL')),
    'une URL publique est precisement ce que le prefixe sert a exposer',
  );
});

test('nextjs : reglages de next.config.js', () => {
  const r = regles(nextjs);
  for (const attendu of ['NEXTJS-IGNORE-TYPES', 'NEXTJS-IGNORE-LINT', 'NEXTJS-IMAGE-WILDCARD', 'NEXTJS-NO-HEADERS']) {
    assert.ok(r.has(attendu), `${attendu} attendu`);
  }
});

test('nextjs : route d\'API sans verification de methode', () => {
  const f = nextjs.findings.find((x) => x.ruleId === 'NEXTJS-API-NO-METHOD-CHECK');
  assert.ok(f);
  assert.match(f.file, /pages\/api\//);
});

test('nextjs : une route qui verifie sa methode ne remonte pas', async () => {
  const dir = projet({
    'package.json': '{"name":"site","dependencies":{"next":"14.2.10","react":"^18.2.0"}}',
    'next.config.js': 'module.exports = { async headers() { return []; } };\n',
    'pages/api/ok.js': [
      'export default function handler(req, res) {',
      "  if (req.method !== 'POST') return res.status(405).end();",
      '  res.json({ ok: true });',
      '}',
    ].join('\n'),
    // Le routeur `app/` declare une fonction par methode.
    'app/api/route.js': 'export async function POST(request) {\n  return Response.json({ ok: true });\n}\n',
  });

  const r = await scan(dir, { categories: ['security', 'quality'] });
  const bruit = r.findings.filter((f) => f.ruleId.startsWith('NEXTJS-'));
  assert.deepEqual(bruit, [], `faux positifs : ${bruit.map((f) => `${f.ruleId} ${f.file}`).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('nextjs : un fichier de modele .env n\'est pas un .env versionne', async () => {
  // Ce scenario se construit a l'execution : `.env.local.example` correspond a
  // la regle `.env.*` du .gitignore, et ne survivrait pas a un clone.
  const dir = projet({
    'package.json': '{"name":"site","dependencies":{"next":"14.2.10"}}',
    '.env.local.example': 'NEXT_PUBLIC_API_URL=https://api.exemple.com\nDATABASE_URL=postgres://user:pass@localhost/db\n',
  });

  const r = await scan(dir, { categories: ['security'] });
  assert.ok(
    !r.findings.some((f) => f.ruleId === 'SEC-ENV-COMMITTED'),
    'un fichier d\'exemple, meme suffixe, n\'est pas un fichier d\'environnement',
  );
  assert.ok(
    !r.findings.some((f) => f.ruleId === 'SEC-SECRET-DB-URL'),
    'user:pass@localhost est un couple manifestement fictif',
  );

  // Le vrai fichier, lui, doit bien remonter.
  fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=postgres://reel:Xk9mQ2pL7vN4@db.prod.tld/app\n');
  const reel = await scan(dir, { categories: ['security'] });
  assert.ok(reel.findings.some((f) => f.ruleId === 'SEC-ENV-COMMITTED'), 'un .env reel doit etre signale');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('packs : chacun reste dans son perimetre', () => {
  assert.ok(![...regles(express)].some((r) => r.startsWith('NEXTJS-')));
  assert.ok(![...regles(nextjs)].some((r) => r.startsWith('EXPRESS-')));
});
