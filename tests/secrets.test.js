import test from 'node:test';
import assert from 'node:assert/strict';

import { detectSecrets, shannonEntropy, redact } from '../src/rules/secrets.js';

// Detection de secrets

// ----------------------------------------------------------------- secrets

test('secrets : detection des fournisseurs connus', () => {
  // Les valeurs sont assemblees a l'execution plutot qu'ecrites en clair : un
  // depot public fait analyser ses fichiers par les detecteurs de la
  // plateforme, qui bloquent le format d'une clef de paiement meme factice.
  // Le comportement teste reste rigoureusement le meme.
  const faux = (prefixe, longueur) => prefixe + 'A1b2C3d4E5f6G7h8'.repeat(4).slice(0, longueur);
  const cas = [
    [`const k = "${'AKIA' + 'IOSFODNN7EXAMPLE'}";`, 'aws-access-key'],
    [`token: "${faux('gh' + 'p_', 36)}"`, 'github-token'],
    [`cle = "${faux('s' + 'k_live_', 24)}"`, 'stripe-key'],
    [`cle = "${faux('s' + 'k-ant-', 24)}"`, 'anthropic-key'],
    [`DB = "${'post' + 'gres'}://u:motdepasse@h:5432/d"`, 'db-url'],
  ];
  for (const [ligne, type] of cas) {
    const found = detectSecrets(ligne);
    assert.ok(found.some((s) => s.kind === type), `${type} attendu dans : ${ligne}`);
  }
});

test('secrets : les placeholders ne sont pas signales', () => {
  const inoffensifs = [
    'password = "changeme"',
    'const apiKey = process.env.API_KEY',
    'api_key: "your-api-key-here"',
    'password = os.environ["PWD"]',
    'const token = "<votre-token>"',
    'secret: "${SECRET}"',
  ];
  for (const ligne of inoffensifs) {
    assert.equal(detectSecrets(ligne).length, 0, `faux positif sur : ${ligne}`);
  }
});

test('secrets : entropie et masquage', () => {
  assert.ok(shannonEntropy('aaaaaaaa') < 1);
  assert.ok(shannonEntropy('aB3xK9mQ7pL2vN8w') > 3.5);
  assert.equal(redact('abcdefghijklmnop'), 'abcd********mnop');
  assert.equal(redact('court'), '*****');
});
