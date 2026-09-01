import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { scan } from '../src/index.js';
import { isGitRepository } from '../src/core/git.js';

/** Petit depot : un fichier deja versionne avec sa dette, un fichier nouveau. */
function depotDeTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-git-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

  git('init', '-q');
  git('config', 'user.email', 'test@argus.local');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'ancien.js'), 'export function ancien(x) { eval(x); }\n');
  git('add', '-A');
  git('commit', '-qm', 'dette preexistante');

  return { dir, git };
}

test('differentiel : seuls les fichiers modifies remontent', () => {
  const { dir } = depotDeTest();
  fs.writeFileSync(path.join(dir, 'nouveau.js'), 'export function nouveau(v) {\n  document.body.innerHTML = v;\n}\n');

  return scan(dir, { categories: ['security'] }).then(async (complet) => {
    const fichiersComplets = new Set(complet.findings.map((f) => f.file));
    assert.ok(fichiersComplets.has('ancien.js'), 'le scan complet voit la dette existante');
    assert.ok(fichiersComplets.has('nouveau.js'));

    const differentiel = await scan(dir, { categories: ['security'], since: 'HEAD' });
    const fichiersDiff = new Set(differentiel.findings.map((f) => f.file));
    assert.ok(fichiersDiff.has('nouveau.js'), 'le nouveau probleme doit remonter');
    assert.ok(!fichiersDiff.has('ancien.js'), 'la dette preexistante doit etre masquee');
    assert.equal(differentiel.diff.ref, 'HEAD');
    assert.ok(differentiel.diff.files.includes('nouveau.js'));

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('differentiel : un changement sans probleme donne un rapport vide', async () => {
  const { dir } = depotDeTest();
  fs.writeFileSync(path.join(dir, 'propre.js'), 'export function propre(v) {\n  return String(v).trim();\n}\n');

  const resultat = await scan(dir, { categories: ['security'], since: 'HEAD' });
  assert.equal(resultat.findings.length, 0, 'aucun probleme introduit');
  assert.equal(resultat.scores.global, 100);
  assert.ok(resultat.suppressed > 0, 'la dette existante est comptee comme masquee');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('differentiel : comparaison depuis une branche via l\'ancetre commun', async () => {
  const { dir, git } = depotDeTest();
  git('checkout', '-qb', 'fonctionnalite');
  fs.writeFileSync(path.join(dir, 'ajout.js'), 'export function ajout(x) {\n  return eval(x);\n}\n');
  git('add', '-A');
  git('commit', '-qm', 'nouvelle fonctionnalite');

  const resultat = await scan(dir, { categories: ['security'], since: 'master' }).catch(() =>
    scan(dir, { categories: ['security'], since: 'main' }),
  );
  const fichiers = new Set(resultat.findings.map((f) => f.file));
  assert.ok(fichiers.has('ajout.js'), 'le commit de la branche doit etre analyse');
  assert.ok(!fichiers.has('ancien.js'), 'la base ne doit pas remonter');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('differentiel : hors depot Git, l\'erreur est explicite', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-nogit-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'eval(x);\n');
  assert.equal(isGitRepository(dir), false);

  await assert.rejects(
    () => scan(dir, { since: 'HEAD' }),
    /depot Git/,
    'le message doit expliquer que le mode differentiel exige Git',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
