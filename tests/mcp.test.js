import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { traiterMessage, OUTILS } from '../src/mcp/serveur.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const appeler = (nom, args = {}) =>
  traiterMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nom, arguments: args } });

test('mcp : la poignee de main annonce les outils', async () => {
  const reponse = await traiterMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });

  assert.equal(reponse.jsonrpc, '2.0');
  assert.equal(reponse.result.protocolVersion, '2025-06-18', 'on repond dans la version demandee');
  assert.deepEqual(reponse.result.capabilities, { tools: {} });
  assert.equal(reponse.result.serverInfo.name, 'argus');
});

test('mcp : une version de protocole inconnue retombe sur une version sure', async () => {
  const reponse = await traiterMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' },
  });
  assert.equal(reponse.result.protocolVersion, '2024-11-05');
});

test('mcp : une notification ne recoit aucune reponse', async () => {
  // Repondre a une notification corromprait le dialogue : le client
  // n'attend rien et prendrait la reponse pour celle d'un autre appel.
  assert.equal(await traiterMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('mcp : les outils declarent un schema exploitable', async () => {
  const reponse = await traiterMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const noms = reponse.result.tools.map((t) => t.name);

  assert.deepEqual(noms, ['argus_scan', 'argus_correctifs', 'argus_regle']);
  for (const outil of reponse.result.tools) {
    assert.equal(outil.inputSchema.type, 'object');
    assert.ok(outil.description.length > 60, `${outil.name} doit se decrire precisement`);
  }
});

test('mcp : l\'outil de correction annonce qu\'il n\'ecrit rien', () => {
  // C'est la garantie centrale : un assistant ne doit jamais croire qu'il
  // peut modifier des fichiers, ni affirmer a l'utilisateur que c'est fait.
  const correctifs = OUTILS.find((o) => o.name === 'argus_correctifs');
  assert.match(correctifs.description, /N'ECRIT RIEN/);
  assert.match(correctifs.description, /argus fix/);
});

test('mcp : le scan retourne une synthese lisible et bornee', async () => {
  const reponse = await appeler('argus_scan', {
    chemin: path.join(FIXTURES, 'demo-site'),
    severiteMin: 'critical',
    limite: 3,
  });

  const texte = reponse.result.content[0].text;
  assert.match(texte, /Score global : \d+\/100/);
  assert.match(texte, /## Scores par categorie/);
  assert.match(texte, /SEC-/, 'les identifiants de regle doivent apparaitre');

  // La limite est respectee : le contexte d'un assistant est une ressource
  // rare, et un rapport de 500 lignes n'apprend rien de plus que 3 bien
  // choisies suivies du nombre restant.
  const constats = texte.split('\n').filter((l) => l.startsWith('- ['));
  assert.ok(constats.length <= 3, `limite depassee : ${constats.length} constats`);
  assert.match(texte, /supplementaire\(s\) non affiches/);
});

test('mcp : la plateforme detectee est transmise a l\'assistant', async () => {
  const reponse = await appeler('argus_scan', { chemin: path.join(FIXTURES, 'electron'), limite: 5 });
  const texte = reponse.result.content[0].text;

  assert.match(texte, /Electron/);
  assert.match(texte, /application bureau/);
});

test('mcp : un chemin inexistant est une erreur, pas un score parfait', async () => {
  // Sans cette verification, l'outil repondait « 100/100, 0 fichiers » et un
  // assistant en concluait que le projet etait exemplaire.
  const reponse = await appeler('argus_scan', { chemin: path.join(os.tmpdir(), 'argus-nexiste-pas-xyz') });

  assert.equal(reponse.result.isError, true);
  assert.match(reponse.result.content[0].text, /n'existe pas/);
});

test('mcp : un dossier vide le dit, plutot que d\'afficher 100/100', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-vide-'));
  const reponse = await appeler('argus_scan', { chemin: dir });

  assert.match(reponse.result.content[0].text, /Aucun fichier analysable/);
  assert.match(reponse.result.content[0].text, /ne conclu/i, 'l\'outil doit desamorcer la mauvaise lecture');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('mcp : les correctifs sont des differentiels, jamais des ecritures', async () => {
  const source = path.join(FIXTURES, 'demo-site');
  const avant = fs.readFileSync(path.join(source, 'index.html'), 'utf8');

  const reponse = await appeler('argus_correctifs', { chemin: source, limite: 2 });
  const texte = reponse.result.content[0].text;

  assert.match(texte, /Aucune n'a ete appliquee/);
  assert.match(texte, /```diff/);
  assert.equal(
    fs.readFileSync(path.join(source, 'index.html'), 'utf8'),
    avant,
    'aucun fichier ne doit avoir ete touche',
  );
});

test('mcp : une regle s\'explique, une regle inconnue le dit', async () => {
  const connue = await appeler('argus_regle', { identifiant: 'SEC-EVAL' });
  assert.match(connue.result.content[0].text, /SEC-EVAL/);
  assert.match(connue.result.content[0].text, /Correction/);

  const inconnue = await appeler('argus_regle', { identifiant: 'SEC-NEXISTE-PAS' });
  assert.match(inconnue.result.content[0].text, /Aucune regle/);

  const liste = await appeler('argus_regle', {});
  assert.match(liste.result.content[0].text, /SEC/);
});

test('mcp : un outil inconnu produit une erreur de protocole', async () => {
  const reponse = await appeler('argus_inexistant');
  assert.equal(reponse.error.code, -32602);
  assert.match(reponse.error.message, /Outil inconnu/);
});

test('mcp : une methode inconnue produit une erreur de protocole', async () => {
  const reponse = await traiterMessage({ jsonrpc: '2.0', id: 1, method: 'ressources/lire' });
  assert.equal(reponse.error.code, -32601);
});
