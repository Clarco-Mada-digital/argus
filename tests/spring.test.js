import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

const SPRING = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/spring');
const resultat = await scan(SPRING);
const regles = new Set(resultat.findings.map((f) => f.ruleId));

test('spring : le framework est reconnu et les routes extraites', () => {
  assert.ok(resultat.project.frameworks.includes('spring'));
  const chemins = resultat.routes.map((r) => r.pattern);
  assert.ok(chemins.includes('/api/produits'), 'le prefixe @RequestMapping doit etre pris en compte');
  assert.ok(regles.has('ROUTE-UPPERCASE'), '/api/Promotions doit etre signalee');
});

test('spring : Actuator entierement expose est critique', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'SPRING-ACTUATOR-EXPOSED');
  assert.ok(finding);
  assert.equal(finding.severity, 'critical');
  assert.match(finding.message, /heapdump/, 'la consequence concrete doit etre expliquee');
});

test('spring : console H2 activee', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'SPRING-H2-CONSOLE');
  assert.ok(finding);
  assert.equal(finding.severity, 'critical');
});

test('spring : chaine de securite ouverte', () => {
  assert.ok(regles.has('SPRING-PERMIT-ALL'), 'anyRequest().permitAll()');
  assert.ok(regles.has('SEC-CSRF-OFF'), 'csrf().disable() — syntaxe Java');
  assert.ok(regles.has('SEC-CORS-WILDCARD'), '@CrossOrigin(origins = "*")');
});

test('spring : mot de passe non quote dans application.properties', () => {
  const secret = resultat.findings.find((f) => f.ruleId === 'SEC-SECRET-CONFIG-SECRET');
  assert.ok(secret, 'les fichiers de configuration n\'utilisent pas de guillemets');
  assert.match(secret.file, /application\.properties$/);
  assert.ok(!secret.snippet.includes('Pr0dPassw0rd!2024'), 'la valeur doit etre masquee');
});

test('spring : aucun bruit sur les conventions du framework', () => {
  const morts = resultat.findings.filter((f) => f.ruleId.startsWith('DEAD-'));
  assert.deepEqual(morts, [], `faux positifs : ${morts.map((f) => `${f.ruleId} ${f.file}`).join(', ')}`);

  // Un URI d'espace de noms XML n'est pas un appel reseau en clair.
  const http = resultat.findings.filter((f) => f.ruleId === 'SEC-HTTP-URL');
  assert.ok(!http.some((f) => f.file.endsWith('pom.xml')), 'xmlns ne doit pas etre signale');
});

test('spring : le pack ne se declenche pas ailleurs', async () => {
  const autre = await scan(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/rails'));
  assert.ok(!autre.findings.some((f) => f.ruleId.startsWith('SPRING-')));
});
