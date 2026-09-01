import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';

const RAILS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/rails');
const resultat = await scan(RAILS);
const regles = new Set(resultat.findings.map((f) => f.ruleId));

test('rails : le framework est reconnu et les routes extraites', () => {
  assert.ok(resultat.project.frameworks.includes('rails'));
  const chemins = resultat.routes.map((r) => r.pattern);
  assert.ok(chemins.includes('/articles'));
  assert.ok(regles.has('ROUTE-UPPERCASE'), '/Archives doit etre signalee');
});

test('rails : la clef de dechiffrement versionnee est critique', async () => {
  // Ce scenario se construit a l'execution plutot que d'etre livre en fixture :
  // un fichier nomme master.key est justement ce qu'un .gitignore correct doit
  // exclure. Le livrer obligerait a y creuser une exception — et exposerait la
  // prochaine personne a y deposer une vraie clef par inadvertance.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-rails-'));
  fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Gemfile'), "source 'https://rubygems.org'\ngem 'rails', '~> 7.0'\n");
  fs.writeFileSync(path.join(dir, 'config', 'routes.rb'), "Rails.application.routes.draw do\n  root 'accueil#index'\nend\n");
  fs.writeFileSync(path.join(dir, 'config', 'master.key'), '0000000000000000000000000000cafe\n');

  const r = await scan(dir);
  const finding = r.findings.find((f) => f.ruleId === 'RAILS-MASTER-KEY-COMMITTED');
  assert.ok(finding, 'config/master.key dans le depot doit remonter');
  assert.equal(finding.severity, 'critical');
  assert.match(finding.suggestion, /regenerez/);

  // Un projet dont le .gitignore protege deja la clef ne doit rien remonter.
  fs.writeFileSync(path.join(dir, '.gitignore'), 'config/master.key\n');
  const protege = await scan(dir);
  assert.ok(
    !protege.findings.some((f) => f.ruleId === 'RAILS-MASTER-KEY-COMMITTED'),
    'une clef deja ignoree par Git ne doit pas etre signalee',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('rails : protections du framework desactivees', () => {
  assert.ok(regles.has('RAILS-CSRF-DISABLED'), 'skip_before_action :verify_authenticity_token');
  assert.ok(regles.has('RAILS-PERMIT-ALL'), 'params.permit!');
});

test('rails : injection SQL par interpolation ActiveRecord', () => {
  const finding = resultat.findings.find((f) => f.ruleId === 'RAILS-SQL-INTERPOLATION');
  assert.ok(finding, 'where("... #{params[...]}") est une injection');
  assert.equal(finding.severity, 'critical');
  assert.match(finding.suggestion, /where\("titre = \?"/);
});

test('rails : html_safe signale dans le controleur comme dans la vue', () => {
  const fichiers = resultat.findings.filter((f) => f.ruleId === 'RAILS-HTML-SAFE').map((f) => f.file);
  assert.ok(fichiers.some((f) => f.endsWith('.rb')), 'controleur');
  assert.ok(fichiers.some((f) => f.endsWith('.erb')), 'vue ERB');
});

test('rails : N+1 detecte malgre la syntaxe .each do |x|', () => {
  assert.ok(regles.has('PERF-NESTED-LOOP-QUERY'));
});

test('rails : redirection ouverte sans parentheses', () => {
  assert.ok(regles.has('SEC-OPEN-REDIRECT'), 'redirect_to params[:retour]');
});

test('rails : aucun bruit sur les conventions du framework', () => {
  const morts = resultat.findings.filter((f) => f.ruleId.startsWith('DEAD-'));
  assert.deepEqual(morts, [], `faux positifs : ${morts.map((f) => `${f.ruleId} ${f.file}`).join(', ')}`);
});

test('rails : la vue ERB bien formee ne genere aucun bruit SEO', () => {
  const surVue = resultat.findings.filter((f) => f.file?.endsWith('.erb') && f.category === 'seo');
  assert.deepEqual(surVue, [], 'une vue correcte ne doit rien remonter en SEO');
});
