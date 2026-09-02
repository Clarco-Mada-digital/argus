import test from 'node:test';
import assert from 'node:assert/strict';

import { buildScores, gradeOf, buildActionPlan } from '../src/core/scoring.js';
import { parseArgs, toList } from '../src/cli/args.js';
import { createFinding } from '../src/core/finding.js';
import { detectLanguage, familyOf } from '../src/core/languages.js';

// Scores, empreintes et arguments de la CLI

// ------------------------------------------------------------------ scores

test('scores : un projet sain obtient 100', () => {
  const scores = buildScores([], { fileCount: 50, categories: ['security', 'seo'] });
  assert.equal(scores.global, 100);
  assert.equal(scores.grade, 'A+');
});

test('scores : une faille critique fait chuter la categorie', () => {
  const findings = [createFinding({ ruleId: 'X', category: 'security', severity: 'critical', title: 't', message: 'm' })];
  const scores = buildScores(findings, { fileCount: 9, categories: ['security'] });
  assert.ok(scores.categories.security.score < 70, `score obtenu : ${scores.categories.security.score}`);
});

test('scores : la penalite est amortie sur les gros projets', () => {
  const findings = Array.from({ length: 5 }, (_, i) =>
    createFinding({ ruleId: `R${i}`, category: 'quality', severity: 'medium', title: 't', message: 'm', file: `f${i}.js` }),
  );
  const petit = buildScores(findings, { fileCount: 9, categories: ['quality'] });
  const gros = buildScores(findings, { fileCount: 900, categories: ['quality'] });
  assert.ok(gros.categories.quality.score > petit.categories.quality.score);
});

test('scores : notes attribuees', () => {
  assert.equal(gradeOf(100), 'A+');
  assert.equal(gradeOf(85), 'B');
  assert.equal(gradeOf(10), 'F');
});

test('plan d\'action : trie par impact', () => {
  const findings = [
    ...Array.from({ length: 10 }, () => createFinding({ ruleId: 'LOW', category: 'seo', severity: 'low', title: 'petit', message: 'm' })),
    createFinding({ ruleId: 'CRIT', category: 'security', severity: 'critical', title: 'grave', message: 'm' }),
  ];
  const plan = buildActionPlan(findings);
  assert.equal(plan[0].ruleId, 'CRIT');
  assert.equal(plan[0].priority, 1);
});

// --------------------------------------------------------------- empreintes

test('empreinte : stable malgre un decalage de ligne', () => {
  const base = { ruleId: 'R', category: 'security', severity: 'high', title: 't', message: 'm', file: 'a.js', snippet: 'const x = 1;' };
  const a = createFinding({ ...base, line: 10 });
  const b = createFinding({ ...base, line: 250 });
  assert.equal(a.fingerprint, b.fingerprint);
});

test('empreinte : differente pour un autre fichier', () => {
  const base = { ruleId: 'R', category: 'security', severity: 'high', title: 't', message: 'm', snippet: 'x' };
  assert.notEqual(createFinding({ ...base, file: 'a.js' }).fingerprint, createFinding({ ...base, file: 'b.js' }).fingerprint);
});

// ---------------------------------------------------------------- arguments

test('CLI : analyse des arguments', () => {
  const { options, positional } = parseArgs(
    ['scan', './site', '--html', 'r.html', '--only=seo,design', '--verbose', '--no-baseline', '-s', 'high'],
    { booleans: ['verbose'], aliases: { s: 'min-severity' } },
  );
  assert.deepEqual(positional, ['scan', './site']);
  assert.equal(options.html, 'r.html');
  assert.equal(options.only, 'seo,design');
  assert.equal(options.verbose, true);
  assert.equal(options.baseline, false);
  assert.equal(options['min-severity'], 'high');
});

test('CLI : conversion en liste', () => {
  assert.deepEqual(toList('a, b ,c'), ['a', 'b', 'c']);
  assert.equal(toList(undefined), null);
});

// ----------------------------------------------------------------- langages

test('langages : detection par extension et nom', () => {
  assert.equal(detectLanguage('src/app.tsx'), 'typescript');
  assert.equal(detectLanguage('main.dart'), 'dart');
  assert.equal(detectLanguage('Dockerfile'), 'dockerfile');
  assert.equal(detectLanguage('.env.local'), 'dotenv');
  assert.equal(familyOf('typescript'), 'js');
  assert.equal(familyOf('kotlin'), 'jvm');
});

test('suppression : le commentaire argus-ignore vaut pour toutes les regles', async () => {
  const { scan } = await import('../src/index.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(
    pathMod.join(dir, 'index.js'),
    [
      'export const a = 1; // TODO garder celui-ci',
      '// argus-disable-next-line',
      'export const b = 2; // TODO masque par la ligne precedente',
      'export const c = 3; // TODO masque sur place  argus-ignore',
    ].join('\n'),
  );

  const resultat = await scan(dir, { categories: ['quality'] });
  const todos = resultat.findings.filter((f) => f.ruleId === 'QUAL-TODO');
  assert.equal(todos.length, 1, 'seul le premier TODO doit remonter');
  assert.equal(todos[0].line, 1);
  assert.ok(resultat.suppressed >= 2, 'les deux autres doivent etre comptes comme masques');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('scores : a densite egale, la note ne depend pas de la taille du projet', async () => {
  const { buildScores } = await import('../src/core/scoring.js');

  const constat = (i) => ({
    category: 'quality',
    severity: 'low',
    ruleId: 'QUAL-X',
    file: `f${i}.js`,
    confidence: 'firm',
  });

  // Un constat mineur pour dix fichiers, quelle que soit la taille.
  const notes = [10, 50, 200, 1000].map((fichiers) => {
    const findings = Array.from({ length: fichiers / 10 }, (_, i) => constat(i));
    return buildScores(findings, { fileCount: fichiers, categories: ['quality'] })
      .categories.quality.score;
  });

  assert.equal(
    new Set(notes).size,
    1,
    `la note doit etre stable a densite egale, obtenu : ${notes.join(', ')}`,
  );
});

test('scores : une faille critique coute cher, meme dans un gros depot', async () => {
  const { buildScores } = await import('../src/core/scoring.js');

  const critique = [{
    category: 'security', severity: 'critical', ruleId: 'SEC-X', file: 'a.js', confidence: 'firm',
  }];

  // L'amortissement plafonne : sans cela, un depot suffisamment gros
  // absorbait n'importe quelle injection sans que la note bouge.
  const petit = buildScores(critique, { fileCount: 20, categories: ['security'] });
  const enorme = buildScores(critique, { fileCount: 20000, categories: ['security'] });

  assert.ok(petit.categories.security.score <= 75);
  assert.ok(
    enorme.categories.security.score <= 91,
    `une critique doit toujours couter au moins 9 points, obtenu ${enorme.categories.security.score}`,
  );
});

test('scores : la densite fait la difference entre deux projets de meme taille', async () => {
  const { buildScores } = await import('../src/core/scoring.js');
  const bruit = (n) => Array.from({ length: n }, (_, i) => ({
    category: 'quality', severity: 'low', ruleId: 'QUAL-X', file: `f${i}.js`, confidence: 'firm',
  }));

  const propre = buildScores(bruit(5), { fileCount: 200, categories: ['quality'] });
  const charge = buildScores(bruit(200), { fileCount: 200, categories: ['quality'] });

  assert.ok(
    propre.categories.quality.score - charge.categories.quality.score > 20,
    'a taille egale, la densite doit se voir',
  );
});
