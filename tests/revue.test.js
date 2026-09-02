import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRevue, renderRevueResolue, resumerPourLeJournal, MARQUEUR } from '../src/report/revue.js';

const constat = (surcharges) => ({
  ruleId: 'SEC-SQL-CONCAT',
  category: 'security',
  severity: 'critical',
  title: 'Requete SQL construite par concatenation',
  message: 'Une requete SQL est assemblee avec des variables.',
  suggestion: 'Utilisez des requetes parametrees.',
  file: 'src/app.js',
  line: 12,
  ...surcharges,
});

const rapport = (findings) => ({ findings, scores: { global: 70, categories: {} } });

test('revue : rien a dire donne null, pas un commentaire vide', () => {
  // C'est la condition qui permet au workflow de se taire. Un commentaire
  // poste a chaque fois cesse d'etre lu en deux semaines.
  assert.equal(renderRevue(rapport([])), null);
});

test('revue : l\'en-tete annonce ce qui bloque', () => {
  const avecBloquant = renderRevue(rapport([constat()]), { base: 'develop' });
  assert.match(avecBloquant.corps, /1 point\(s\) a regler avant fusion/);
  assert.equal(avecBloquant.bloquant, true);
  assert.match(avecBloquant.corps, /par rapport a `develop`/);

  const sansBloquant = renderRevue(rapport([constat({ severity: 'low' })]));
  assert.match(sansBloquant.corps, /1 remarque\(s\)/);
  assert.equal(sansBloquant.bloquant, false);
  assert.match(sansBloquant.corps, /Aucun point bloquant/);
});

test('revue : le marqueur permet de retrouver le commentaire a mettre a jour', () => {
  // Sans lui, chaque poussee ajouterait un commentaire de plus.
  const revue = renderRevue(rapport([constat()]));
  assert.ok(revue.corps.startsWith(MARQUEUR));
});

test('revue : les fichiers les plus graves passent devant', () => {
  const revue = renderRevue(
    rapport([
      constat({ file: 'src/mineur.js', severity: 'low', ruleId: 'QUAL-X' }),
      constat({ file: 'src/grave.js', severity: 'critical' }),
    ]),
  );

  const posGrave = revue.corps.indexOf('src/grave.js');
  const posMineur = revue.corps.indexOf('src/mineur.js');
  assert.ok(posGrave < posMineur, 'on commence par ce qui compte');
});

test('revue : les lignes vides du Markdown sont preservees', () => {
  // Sans elles, chaque citation se colle au constat suivant et le rendu
  // fusionne tout en un seul bloc illisible.
  const revue = renderRevue(rapport([constat()]));
  assert.match(revue.corps, /\n\n### `src\/app\.js`\n\n/);
  assert.ok(!/\n{3,}/.test(revue.corps), 'pas de vide excessif non plus');
});

test('revue : un fichier tres charge est tronque, en le disant', () => {
  const beaucoup = Array.from({ length: 20 }, (_, i) => constat({ line: i + 1, severity: 'low' }));
  const revue = renderRevue(rapport(beaucoup));

  const affiches = (revue.corps.match(/`SEC-SQL-CONCAT`/g) || []).length;
  assert.ok(affiches <= 8, `${affiches} constats affiches pour un seul fichier`);
  assert.match(revue.corps, /et 12 autre\(s\) dans ce fichier/);
});

test('revue : un constat sans fichier n\'entre pas dans la revue', () => {
  // Une revue porte sur des lignes modifiees : un constat de niveau projet
  // n'a pas ete introduit par cette branche en particulier.
  assert.equal(renderRevue(rapport([constat({ file: null })])), null);
});

test('revue : le message de resolution ferme la boucle', () => {
  const corps = renderRevueResolue('main');
  assert.ok(corps.startsWith(MARQUEUR), 'il doit remplacer le commentaire precedent');
  assert.match(corps, /plus rien a signaler/);
  assert.match(corps, /`main`/);
});

test('revue : le resume du journal tient sur une ligne', () => {
  const resume = resumerPourLeJournal(
    rapport([constat(), constat({ category: 'quality', ruleId: 'QUAL-X' })]),
  );
  assert.match(resume, /Securite|securite/i);
  assert.ok(!resume.includes('\n'));
  assert.equal(resumerPourLeJournal(rapport([])), 'Aucun constat sur les fichiers modifies.');
});
