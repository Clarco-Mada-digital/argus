import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scan } from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const analyser = (nom) => scan(path.join(FIXTURES, nom), { noHistory: true });
const ids = (rapport) => rapport.findings.map((f) => f.ruleId);

test('react native : jeton en clair, WebView ouverte, manifestes natifs', async () => {
  const rapport = await analyser('reactnative');
  const trouves = ids(rapport);

  for (const attendu of [
    'RN-STOCKAGE-NON-CHIFFRE',
    'RN-WEBVIEW-ACCES-FICHIER',
    'MOBILE-TRAFIC-EN-CLAIR',
    'MOBILE-DEBUGGABLE',
    'MOBILE-SAUVEGARDE-OUVERTE',
    'MOBILE-ATS-DESACTIVE',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }

  // Les deux jetons sont signales, la preference d'affichage ne l'est pas.
  assert.equal(trouves.filter((id) => id === 'RN-STOCKAGE-NON-CHIFFRE').length, 2);
});

test('une application mobile n\'est pas un site : aucun constat SEO', async () => {
  const rapport = await analyser('reactnative');
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId.startsWith('SEO-')),
    [],
    'React Native depend de react — sans notion de plateforme, le SEO le prenait pour une SPA',
  );
  assert.ok(rapport.project.platforms?.includes('mobile'));
  assert.ok(!rapport.project.platforms?.includes('web'));
});

test('flutter : SharedPreferences et validation TLS', async () => {
  const rapport = await analyser('flutter');
  const trouves = ids(rapport);

  assert.ok(trouves.includes('FLUTTER-TLS-DESACTIVE'));
  // « auth_token » et « refresh_token » oui ; « theme » et « dernier_onglet » non.
  assert.equal(trouves.filter((id) => id === 'FLUTTER-PREFS-NON-CHIFFRE').length, 2);
  // Ce manifeste-ci est correct : allowBackup="false", pas de debuggable.
  assert.deepEqual(trouves.filter((id) => id.startsWith('MOBILE-')), []);
});

test('tauri : allowlist totale, shell, CSP, IPC distant', async () => {
  const trouves = ids(await analyser('tauri'));
  for (const attendu of [
    'TAURI-ALLOWLIST-TOTALE',
    'TAURI-SHELL-OUVERT',
    'TAURI-CSP-ABSENTE',
    'TAURI-IPC-DISTANT',
    'TAURI-GLOBAL-EXPOSE',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }
});

test('electron : les quatre reglages de webPreferences', async () => {
  const rapport = await analyser('electron');
  const trouves = ids(rapport);

  for (const attendu of [
    'ELECTRON-NODE-INTEGRATION',
    'ELECTRON-CONTEXT-ISOLATION',
    'ELECTRON-WEB-SECURITY',
    'ELECTRON-CONTENU-NON-SUR',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }

  assert.ok(rapport.project.platforms.includes('desktop'));
  assert.equal(
    rapport.findings.find((f) => f.ruleId === 'ELECTRON-NODE-INTEGRATION').severity,
    'critical',
  );
});

test('aucun bruit mobile ou bureau sur les projets web', async () => {
  const web = ['django', 'laravel', 'rails', 'spring', 'express', 'nextjs', 'sveltekit', 'react'];
  for (const nom of web) {
    const trouves = ids(await analyser(nom));
    const bruit = trouves.filter((id) => /^(MOBILE|RN|FLUTTER|TAURI|ELECTRON)-/.test(id));
    assert.deepEqual(bruit, [], `${nom} ne doit recevoir aucune regle mobile ou bureau`);
  }
});

test('un pack defaillant est signale, pas avale en silence', async () => {
  const { FRAMEWORK_PACKS } = await import('../src/rules/frameworks/index.js');
  const pack = FRAMEWORK_PACKS.find((p) => p.id === 'electron');
  const original = pack.run;
  pack.run = () => {
    throw new Error('panne simulee');
  };

  try {
    const trouves = ids(await analyser('electron'));
    assert.ok(
      trouves.includes('ARGUS-PACK-EN-ECHEC'),
      'un pack qui casse doit produire un constat visible, sinon le bug reste introuvable',
    );
  } finally {
    pack.run = original;
  }
});
