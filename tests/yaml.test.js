import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../src/index.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Un YAML illisible ne signale rien : il ne s'execute simplement jamais.
 *
 * Nous en avons fait les frais sur notre propre `action.yml` — une equipe ne
 * pouvait pas utiliser l'action en integration continue, et le message du
 * runner ne pointait que la ligne, jamais la cause.
 */

async function analyserYaml(contenu) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-yaml-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t","version":"1.0.0"}');
  fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), contenu);

  const rapport = await scan(dir, { noHistory: true });
  fs.rmSync(dir, { recursive: true, force: true });
  return rapport.findings.filter((f) => f.ruleId === 'QUAL-YAML-ECHAPPEMENT-INVALIDE');
}

test('yaml : une sequence inconnue entre guillemets doubles est signalee', async () => {
  // Le cas exact qui a casse notre action : `\$` pour proteger un `${{ }}`.
  const constats = await analyserYaml('a: "utilisez origin/\\${{ github.base_ref }}"\n');
  assert.equal(constats.length, 1);
  assert.equal(constats[0].severity, 'high');
  assert.match(constats[0].suggestion, /guillemets simples/);
});

test('yaml : un chemin Windows casse le fichier, malgre un echappement connu', async () => {
  // `\U` *est* reconnu, mais exige huit chiffres hexadecimaux. C'est le piege
  // le plus difficile a voir a l'oeil nu.
  const constats = await analyserYaml('a: "C:\\Users\\runner"\n');
  assert.equal(constats.length, 1);
  assert.match(constats[0].message, /8 chiffres hexadecimaux/);
});

test('yaml : les formes valides ne sont pas signalees', async () => {
  const valides = [
    'a: "une \\"citation\\" et un saut\\n"',
    "a: 'aucun \\$ echappement en guillemets simples'",
    'a: "hexa \\x41 et unicode \\u0041 et \\U0001F600"',
    'a: "barre \\\\ doublee"',
    '# un commentaire \\$ n\'est pas un scalaire',
  ].join('\n');

  assert.deepEqual(await analyserYaml(`${valides}\n`), []);
});

test('yaml : un bloc litteral n\'est pas du YAML', async () => {
  // `run: |` contient du shell, ou `\\`` et `\\$` sont l'echappement normal.
  // Nos propres workflows en contiennent, et la regle les a signales des le
  // premier essai — a tort.
  const constats = await analyserYaml(
    [
      'jobs:',
      '  build:',
      '    steps:',
      '      - name: Publier',
      '        run: |',
      '          echo "publie a chaque \\`push\\` sur \\`main\\`"',
      '          echo "C:\\Users\\runner"',
      '      - name: Apres le bloc',
      '        env: "retour au \\$ scalaire"',
    ].join('\n'),
  );

  assert.equal(constats.length, 1, 'seule la ligne hors du bloc compte');
  assert.equal(constats[0].line, 9);
});

test('yaml : notre propre action.yml se charge', async () => {
  // Regression directe : c'est ce fichier qui a rendu l'action inutilisable.
  const rapport = await scan(RACINE, { noHistory: true });
  const casses = rapport.findings.filter((f) => f.ruleId === 'QUAL-YAML-ECHAPPEMENT-INVALIDE');
  assert.deepEqual(
    casses.map((f) => `${f.file}:${f.line}`),
    [],
    'aucun YAML du depot ne doit etre illisible',
  );
});
