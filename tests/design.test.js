import test from 'node:test';
import assert from 'node:assert/strict';

import { contrastRatio, parseColor, toPixels, wcagLevel } from '../src/core/color.js';
import { parseHtml, stripTags, visibleWordCount, isFullPage } from '../src/core/html.js';

// Couleur, contraste et parsing HTML

// ----------------------------------------------------------------- couleur

test('couleur : parsing des formats CSS', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.equal(parseColor('rgb(255, 0, 0)').r, 255);
  assert.equal(parseColor('transparent'), null);
  assert.equal(parseColor('hsl(0, 100%, 50%)').r, 255);
});

test('couleur : ratios de contraste WCAG connus', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  const gris = contrastRatio('#767676', '#ffffff');
  assert.ok(gris >= 4.5 && gris < 5, `attendu ~4.54, obtenu ${gris}`);
});

test('couleur : niveaux WCAG', () => {
  assert.equal(wcagLevel(21), 'AAA');
  assert.equal(wcagLevel(4.6), 'AA');
  assert.equal(wcagLevel(3), 'fail');
  assert.equal(wcagLevel(3, true), 'AA', 'le texte large a un seuil plus bas');
});

test('couleur : conversion des longueurs en pixels', () => {
  assert.equal(toPixels('16px'), 16);
  assert.equal(toPixels('1rem'), 16);
  assert.equal(toPixels('2rem'), 32);
  assert.equal(toPixels('12pt'), 16);
  assert.equal(toPixels('auto'), null);
});

// -------------------------------------------------------------------- HTML

test('html : parsing des balises et attributs', () => {
  const nodes = parseHtml('<div class="a b" id="x"><img src="/i.png" alt=""></div>');
  const div = nodes.find((n) => n.tag === 'div');
  const img = nodes.find((n) => n.tag === 'img');
  assert.deepEqual(div.classes, ['a', 'b']);
  assert.equal(div.id, 'x');
  assert.equal(img.attr('src'), '/i.png');
  assert.ok(img.has('alt'), 'un alt vide reste present');
  assert.ok(img.selfClosing);
});

test('html : le texte d\'un element est capture', () => {
  const nodes = parseHtml('<title>Ma page</title>');
  assert.equal(nodes[0].text, 'Ma page');
});

test('html : le contenu des scripts n\'est pas parse comme du balisage', () => {
  const nodes = parseHtml('<script>if (a < b) { x(); }</script><p>ok</p>');
  assert.ok(nodes.some((n) => n.tag === 'p'));
  assert.ok(!nodes.some((n) => n.tag === 'b'), 'le "< b" du script ne doit pas creer de balise');
});

test('html : detection d\'un document complet', () => {
  assert.ok(isFullPage('<!doctype html><html></html>'));
  assert.ok(!isFullPage('<div>fragment</div>'));
});

test('html : comptage des mots visibles', () => {
  const html = '<style>a{}</style><p>un deux trois</p><script>var x</script>';
  assert.equal(visibleWordCount(html), 3);
  assert.equal(stripTags('<b>gras</b> normal'), 'gras normal');
});
