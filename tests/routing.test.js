import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeRoute, routeToRegExp, fileToRoutePattern } from '../src/lang/routes.js';

// Normalisation et correspondance des routes

// ------------------------------------------------------------------ routes

test('routes : normalisation des chemins', () => {
  assert.equal(normalizeRoute('users'), '/users');
  assert.equal(normalizeRoute('/users/'), '/users');
  assert.equal(normalizeRoute('//a//b'), '/a/b');
  assert.equal(normalizeRoute('/a?x=1#y'), '/a');
  assert.equal(normalizeRoute(''), '/');
});

test('routes : les motifs dynamiques deviennent des expressions', () => {
  assert.ok(routeToRegExp('/users/:id').test('/users/42'));
  assert.ok(routeToRegExp('/users/{id}').test('/users/42'));
  assert.ok(routeToRegExp('/users/<int:id>').test('/users/42'));
  assert.ok(!routeToRegExp('/users/:id').test('/users/42/edit'));
  assert.ok(routeToRegExp('/files/**').test('/files/a/b/c'));
});

test('routes : conversion des chemins de fichiers Next.js', () => {
  assert.equal(fileToRoutePattern('index.tsx', 'nextjs'), '/');
  assert.equal(fileToRoutePattern('blog/[slug].tsx', 'nextjs'), '/blog/:slug');
  assert.equal(fileToRoutePattern('blog/[...all].tsx', 'nextjs'), '/blog/*');
  assert.equal(fileToRoutePattern('blog/page.tsx', 'nextjs-app'), '/blog');
  assert.equal(fileToRoutePattern('blog/layout.tsx', 'nextjs-app'), null, 'un layout n\'est pas une route');
});
