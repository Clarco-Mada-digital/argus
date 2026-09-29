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

test('electron : RegExp.exec n\'est pas child_process.exec', async () => {
  // Trouve sur notre propre code. Le masquage lexical vidant les gabarits, le
  // motif ne voyait *jamais* la vraie construction de commande — le seul
  // constat qu'il produisait etait l'homonyme.
  const dir = projetElectron({
    'src/deploy.js': [
      "const { exec } = require('node:child_process');",
      '',
      'export function deployer(branche) {',
      // argus-ignore SEC-EXEC-SHELL : c'est la donnee du test, pas un appel.
      '  exec(`git push origin ${branche}`, (e) => e && console.error(e));',
      '}',
      '',
      'export function extraire(source) {',
      '  return /(\\w+)-(\\d+)/.exec(source.slice(0, 40 + 10));',
      '}',
      '',
      'export function sur(cible) {',
      "  // Forme tableau : c'est le remede que la regle recommande.",
      "  return exec('git', ['push', 'origin', `${cible}`]);",
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'SEC-EXEC-SHELL');

  assert.equal(constats.length, 1, `lignes signalees : ${constats.map((f) => f.line)}`);
  assert.equal(constats[0].line, 4, 'seule la commande construite par gabarit');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('electron : un prop `action` de composant React n\'est pas un lien', async () => {
  // `action` ne designe une cible de navigation que sur un <form>. En JSX,
  // c'est un nom de prop tres courant — un menu contextuel decrit ses gestes
  // ainsi. Les cinq « liens internes morts » d'Orbit etaient tous de ce genre.
  const dir = projetElectron({
    'src/GuestContextMenu.jsx': [
      'export default function Menu() {',
      '  return (',
      '    <div>',
      '      <IconAction label="Precedent" action="back" />',
      '      <IconAction label="Suivant" action="forward" />',
      '      <IconAction label="Copier" action="copyPageUrl" />',
      '    </div>',
      '  );',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir);
  const morts = rapport.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK');
  assert.deepEqual(morts, [], 'un prop JSX ne doit pas etre lu comme une URL');
});

test('electron : `action` sur un vrai <form> reste verifie', async () => {
  // Le correctif ne doit pas rendre la regle aveugle : sur un <form>, une
  // cible qui ne mene nulle part reste un lien mort.
  const dir = projetElectron({
    'public/index.html': [
      '<!doctype html>',
      '<html><body>',
      '  <form action="/page-qui-nexiste-pas" method="post"></form>',
      '</body></html>',
    ].join('\n'),
    'src/routes.jsx': "export const routes = [{ path: '/', element: null }];",
  });

  const rapport = await scan(dir);
  const morts = rapport.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK');
  assert.ok(
    morts.some((f) => String(f.message).includes('/page-qui-nexiste-pas')),
    'un <form action> vers le vide doit rester signale',
  );
});

test('electron : openExternal garde un schema verifie', async () => {
  // La suggestion de la regle decrit ce garde-fou : le signaler quand meme
  // apprend a l'ignorer. Neuf des dix constats d'Orbit etaient de ce type.
  const dir = projetElectron({
    'main.js': [
      "const { shell } = require('electron');",
      '',
      'function ouvrirRegex(url) {',
      '  if (/^https?:\\/\\//i.test(url)) shell.openExternal(url);',
      '}',
      '',
      'function ouvrirStartsWith(url) {',
      "  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {",
      '    shell.openExternal(url);',
      '  }',
      '}',
      '',
      'function ouvrirViaAide(params) {',
      '  if (estUneUrlWeb(params.linkURL)) shell.openExternal(params.linkURL);',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir);
  const constats = rapport.findings.filter((f) => f.ruleId === 'ELECTRON-OPEN-EXTERNAL');
  assert.deepEqual(constats, [], 'un appel deja garde ne doit pas etre signale');
});

test('electron : openExternal SANS garde reste signale', async () => {
  // Le contre-exemple qui donne sa valeur au test precedent : sans
  // verification, `file://` ou un chemin executable passent au systeme.
  const dir = projetElectron({
    'main.js': [
      "const { shell } = require('electron');",
      '',
      'function menu(params) {',
      '  return [{ label: "Ouvrir", click: () => shell.openExternal(params.linkURL) }];',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir);
  const constats = rapport.findings.filter((f) => f.ruleId === 'ELECTRON-OPEN-EXTERNAL');
  assert.equal(constats.length, 1, 'un appel non garde doit rester signale');
});

test('electron : un prefixe litteral fixe le schema', async () => {
  // `shell.openExternal('https://…/q=' + encodeURIComponent(x))` : la partie
  // variable ne peut plus changer le protocole. Signale tel quel, ce constat
  // pousse a envelopper du code deja sur.
  const dir = projetElectron({
    'main.js': [
      "const { shell } = require('electron');",
      '',
      'function rechercher(selection) {',
      "  shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(selection));",
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir);
  const constats = rapport.findings.filter((f) => f.ruleId === 'ELECTRON-OPEN-EXTERNAL');
  assert.deepEqual(constats, [], 'un prefixe litteral en https fixe le schema');
});
