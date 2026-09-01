import test from 'node:test';
import assert from 'node:assert/strict';

import { Matcher, globToRegExp } from '../src/core/glob.js';
import { LineIndex, maskCommentsAndStrings, countIdentifier, estimateComplexity } from '../src/core/scan.js';

// Glob, index de lignes et masquage lexical

// --------------------------------------------------------------------- glob

test('glob : correspondances de base', () => {
  assert.ok(globToRegExp('*.js').test('app.js'));
  assert.ok(globToRegExp('**/node_modules/**').test('a/b/node_modules/c/d.js'));
  assert.ok(globToRegExp('src/*.ts').test('src/index.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/nested/index.ts'));
  assert.ok(globToRegExp('*.{js,ts}').test('a.ts'));
});

test('glob : negation facon gitignore', () => {
  const matcher = new Matcher(['dist/**', '!dist/keep.js']);
  assert.ok(matcher.matches('dist/bundle.js'));
  assert.ok(!matcher.matches('dist/keep.js'));
});

test('glob : un pattern de dossier capture son contenu', () => {
  const matcher = new Matcher(['coverage/']);
  assert.ok(matcher.matches('coverage/lcov.info'));
});

// ---------------------------------------------------------------- LineIndex

test('LineIndex : offset vers ligne et colonne', () => {
  const index = new LineIndex('un\ndeux\ntrois');
  assert.equal(index.lineOf(0), 1);
  assert.equal(index.lineOf(3), 2);
  assert.equal(index.lineOf(8), 3);
  assert.equal(index.columnOf(4), 2);
  assert.equal(index.textOfLine(2), 'deux');
});

// -------------------------------------------------------------- masquage

test('masquage : neutralise commentaires et chaines', () => {
  const source = `const a = "eval(x)"; // eval(y)\nconst b = eval(z);`;
  const masked = maskCommentsAndStrings(source, 'js');
  assert.equal(masked.length, source.length, 'les offsets doivent etre preserves');
  assert.equal((masked.match(/eval\(/g) || []).length, 1, 'seul le vrai appel subsiste');
});

test('masquage : conserve les interpolations de gabarit', () => {
  const source = 'const nom = "x";\nconst msg = `bonjour ${nom} !`;';
  const masked = maskCommentsAndStrings(source, 'js');
  assert.equal(countIdentifier(masked, 'nom'), 2, 'une variable interpolee reste utilisee');
});

test('masquage : commentaire de bloc', () => {
  const masked = maskCommentsAndStrings('/* password = "secret" */\nlet x = 1;', 'js');
  assert.ok(!masked.includes('password'));
  assert.ok(masked.includes('let x = 1;'));
});

test('complexite : compte les points de decision', () => {
  assert.equal(estimateComplexity('function f() { return 1; }'), 1);
  assert.ok(estimateComplexity('if (a) { for (b) { while (c) {} } }') >= 4);
});
