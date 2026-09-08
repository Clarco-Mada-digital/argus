import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';

/**
 * Retour d'une equipe apres usage sur Orbit, une application de bureau
 * Electron + React + Vite d'une centaine de fichiers. Score 85/100, tire vers
 * le bas presque uniquement par des faux positifs.
 */

function projetElectron(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-electron-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'orbit',
      version: '1.0.0',
      main: 'main.js',
      dependencies: { react: '^18.3.1', electron: '^32.0.0' },
    }),
  );

  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, chemin);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

test('electron : une destructuration de tableau n\'est pas un acces indexe', async () => {
  // `const [query, setQuery] = useState('')` est la ligne la plus courante
  // d'un composant React. Elle etait signalee au rang le plus grave.
  const dir = projetElectron({
    'src/FindBar.jsx': [
      "import { useState } from 'react';",
      '',
      'export function FindBar() {',
      "  const [query, setQuery] = useState('');",
      '  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;',
      '}',
    ].join('\n'),

    // Le vrai motif, lui, doit rester detecte : le crochet colle a l'objet.
    'src/serveur.js': [
      "export function appliquer(req) {",
      '  const cible = {};',
      '  cible[req.body.clef] = req.body.valeur;',
      '  return cible;',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'SEC-PROTOTYPE-POLLUTION');

  assert.equal(constats.length, 1, 'seule l\'affectation par clef externe compte');
  assert.match(constats[0].file, /serveur\.js$/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('electron : wc.debugger est une propriete, pas une instruction', async () => {
  // L'API Electron webContents.debugger — le protocole DevTools de Chrome.
  const dir = projetElectron({
    'main.js': [
      "const { BrowserWindow } = require('electron');",
      '',
      'export function attacher(wc) {',
      '  const dbg = wc.debugger;',
      "  dbg.attach('1.3');",
      '  return dbg;',
      '}',
      '',
      'export function oubli() {',
      '  debugger;',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'DEAD-DEBUG-INSTRUCTION-DEBUGGER');

  assert.equal(constats.length, 1, 'seule l\'instruction compte');
  assert.equal(constats[0].line, 10);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('electron : une URL de polices n\'est pas un identifiant', async () => {
  // `family=Inter:wght@400;500` : le `:…@` de la requete etait lu comme
  // `user:pass@host`, sur le <link> d'a peu pres tous les projets.
  const dir = projetElectron({
    'index.html': [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Orbit</title>',
      '<meta name="description" content="Navigateur de bureau pour organiser vos espaces.">',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">',
      '</head><body><main><h1>Orbit</h1></main></body></html>',
    ].join('\n'),

    // Une vraie URL avec identifiants reste signalee.
    'src/api.js': "export const base = 'https://admin:motdepasse123@interne.example.com/api';\n",
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'SEC-SECRET-BASIC-AUTH-URL');

  assert.equal(constats.length, 1);
  assert.match(constats[0].file, /api\.js$/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('electron : sans routeur, un chemin n\'est pas une adresse', async () => {
  // Tous les « liens internes morts » de leur projet etaient de cette nature.
  // Une ressource absente, elle, manque autant sur le bureau que sur le web.
  const dir = projetElectron({
    'src/Menu.jsx': [
      'export function Menu({ aller }) {',
      '  return (',
      '    <div>',
      '      <a href="/settings" onClick={() => aller(\'/settings\')}>Preferences</a>',
      '      <img src="./icones/manquante.png" alt="" />',
      '    </div>',
      '  );',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });

  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK'),
    [],
    'aucun routeur : /settings est une clef, pas une URL',
  );
  assert.ok(
    rapport.findings.some((f) => f.ruleId === 'ROUTE-MISSING-ASSET'),
    'une image absente reste absente',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('electron : un fond de modale n\'est pas un bouton', async () => {
  const modale = (touche) => [
    "import { useEffect } from 'react';",
    '',
    'export function Modale({ fermer, enfants }) {',
    '  useEffect(() => {',
    `    const surTouche = (e) => { if (e.key === '${touche}') fermer(); };`,
    "    window.addEventListener('keydown', surTouche);",
    "    return () => window.removeEventListener('keydown', surTouche);",
    '  }, [fermer]);',
    '',
    '  return (',
    '    <div className="fixed inset-0 bg-black/50" onClick={fermer}>',
    '      <div className="panneau" onClick={(e) => e.stopPropagation()}>{enfants}</div>',
    '    </div>',
    '  );',
    '}',
    '',
    'export function Carte({ ouvrir }) {',
    '  return <div className="carte" onClick={ouvrir}>Ouvrir la fiche</div>;',
    '}',
  ].join('\n');

  const avecEchap = projetElectron({ 'src/Modale.jsx': modale('Escape') });
  const rapport = await scan(avecEchap, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'A11Y-CLICKABLE-DIV');

  assert.equal(constats.length, 1, `seule la carte cliquable compte : ${constats.map((f) => f.line)}`);
  assert.equal(constats[0].line, 18);
  fs.rmSync(avecEchap, { recursive: true, force: true });

  // Sans fermeture au clavier, le fond remonte — mais avec le bon conseil.
  const sansEchap = projetElectron({ 'src/Modale.jsx': modale('Enter') });
  const rapport2 = await scan(sansEchap, { noHistory: true });
  const fond = rapport2.findings.find((f) => f.ruleId === 'A11Y-CLICKABLE-DIV' && f.line === 11);

  assert.ok(fond, 'le fond doit remonter quand rien ne ferme au clavier');
  assert.equal(fond.severity, 'low');
  assert.match(fond.suggestion, /Echap/);
  assert.doesNotMatch(fond.suggestion, /Utilisez <button/);
  fs.rmSync(sansEchap, { recursive: true, force: true });
});

test('electron : les quatre regles de securite ajoutees', async () => {
  const dir = projetElectron({
    'src/fenetre.js': [
      "const { BrowserWindow, shell } = require('electron');",
      '',
      'export function creer(urlDemandee) {',
      '  const win = new BrowserWindow({',
      '    webPreferences: { sandbox: false },',
      '  });',
      "  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });",
      '  shell.openExternal(urlDemandee);',
      '  return win;',
      '}',
    ].join('\n'),

    'src/nu.js': [
      "const { BrowserWindow, shell } = require('electron');",
      "export const win = new BrowserWindow({ webPreferences: { preload: 'p.js' } });",
      "shell.openExternal('https://exemple.test/aide');",
    ].join('\n'),

    'vue.html': '<webview src="https://exemple.test" nodeintegration></webview>\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  const parRegle = (id) => rapport.findings.filter((f) => f.ruleId === id);

  assert.equal(parRegle('ELECTRON-SANDBOX').length, 1);
  assert.equal(parRegle('ELECTRON-WEBVIEW-NODE').length, 1);

  // Une URL variable est signalee ; une URL litterale ne l'est pas.
  //
  // Les deux constats de `fenetre.js` sont fondes, y compris celui pose sur
  // le `setWindowOpenHandler` : l'URL y vient de la page affichee, et la
  // deleguer sans verifier son schema est precisement la faille. Notre propre
  // suggestion recommandait ce motif — elle montre desormais la verification.
  const externes = parRegle('ELECTRON-OPEN-EXTERNAL');
  assert.deepEqual(
    externes.map((f) => path.basename(f.file)),
    ['fenetre.js', 'fenetre.js'],
    'seules les valeurs non litterales comptent',
  );

  // La fenetre encadree se tait, celle qui ne l'est pas remonte.
  const ouvertures = parRegle('ELECTRON-WINDOW-OPEN-HANDLER');
  assert.equal(ouvertures.length, 1);
  assert.match(ouvertures[0].file, /nu\.js$/);

  fs.rmSync(dir, { recursive: true, force: true });
});
