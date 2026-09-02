import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  t, definirLangue, langue, regle, traduireConstat, resoudreLangue, couverture,
} from '../src/i18n/index.js';
import { CATALOGUE_FR } from '../src/i18n/fr.js';
import { CATALOGUE_EN } from '../src/i18n/en.js';
import { scan } from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

test('langue : l\'explicite l\'emporte sur l\'implicite', () => {
  const env = { LANG: 'fr_FR.UTF-8', ARGUS_LANG: 'en' };
  assert.equal(resoudreLangue({ option: 'en', config: 'fr', env }), 'en');
  assert.equal(resoudreLangue({ config: 'fr', env }), 'fr');
  assert.equal(resoudreLangue({ env }), 'en', 'ARGUS_LANG passe devant LANG');
  assert.equal(resoudreLangue({ env: { LANG: 'en_US.UTF-8' } }), 'en');
});

test('langue : une langue inconnue retombe sur le francais', () => {
  assert.equal(resoudreLangue({ option: 'de' }), 'fr');
  assert.equal(resoudreLangue({ env: { LANG: 'ja_JP.UTF-8' } }), 'fr');
  assert.equal(resoudreLangue({ env: {} }), 'fr');
});

test('catalogue : les deux langues ont exactement les memes clefs', () => {
  // Une clef presente d'un cote seulement est soit un oubli, soit un reste.
  const fr = Object.keys(CATALOGUE_FR).sort();
  const en = Object.keys(CATALOGUE_EN).sort();
  assert.deepEqual(en, fr);
});

test('catalogue : les parametres sont interpoles', () => {
  definirLangue('fr');
  assert.match(t('entete.fichiersDetail', { analyses: 12, indexes: 15, ignores: 3 }), /12 analyses/);

  definirLangue('en');
  assert.match(t('entete.fichiersDetail', { analyses: 12, indexes: 15, ignores: 3 }), /12 analysed/);
  definirLangue('fr');
});

test('catalogue : une clef absente est visible, pas silencieuse', () => {
  // Afficher la clef permet de la corriger ; une chaine vide se remarque trop
  // tard, une fois le rapport lu par quelqu'un d'autre.
  definirLangue('en');
  assert.equal(t('clef.qui.nexiste.pas'), 'clef.qui.nexiste.pas');
  definirLangue('fr');
});

test('regles : le calque remplace le texte, jamais l\'identifiant', () => {
  definirLangue('en');

  const constat = {
    ruleId: 'SEC-EVAL',
    title: 'Execution de code dynamique (eval)',
    message: 'Appel a eval()…',
    suggestion: 'Remplacez eval…',
    severity: 'high',
    file: 'a.js',
  };

  const traduit = traduireConstat(constat);
  assert.equal(traduit.ruleId, 'SEC-EVAL', 'l\'identifiant est une clef, il ne se traduit pas');
  assert.equal(traduit.severity, 'high');
  assert.match(traduit.title, /Dynamic code execution/);
  assert.match(traduit.message, /executable code/);

  definirLangue('fr');
});

test('regles : une regle non traduite garde son texte francais', () => {
  // Le francais est la version de reference : un message dans la mauvaise
  // langue reste lisible et actionnable, une chaine vide non.
  definirLangue('en');

  const constat = { ruleId: 'REGLE-QUI-NEXISTE-PAS', title: 'Titre francais', message: 'Message francais' };
  assert.deepEqual(traduireConstat(constat), constat);
  assert.equal(regle('REGLE-QUI-NEXISTE-PAS', 'title'), null);

  definirLangue('fr');
});

test('regles : en francais, le calque ne fait rien du tout', () => {
  definirLangue('fr');
  const constat = { ruleId: 'SEC-EVAL', title: 'Execution de code dynamique (eval)' };
  assert.equal(traduireConstat(constat), constat, 'meme objet : aucune copie inutile');
});

test('scan : --lang en traduit les constats couverts', async () => {
  definirLangue('en');
  const rapport = await scan(path.join(FIXTURES, 'demo-site'), { noHistory: true });

  const sql = rapport.findings.find((f) => f.ruleId === 'SEC-SQL-CONCAT');
  assert.ok(sql, 'la fixture doit contenir une injection SQL');
  assert.match(sql.title, /SQL query built by concatenation/);

  definirLangue('fr');
  const enFrancais = await scan(path.join(FIXTURES, 'demo-site'), { noHistory: true });
  const sqlFr = enFrancais.findings.find((f) => f.ruleId === 'SEC-SQL-CONCAT');
  assert.match(sqlFr.title, /Requete SQL construite par concatenation/);
});

test('couverture : l\'etat de la traduction est mesurable', () => {
  // Une traduction partielle n'est un probleme que si personne ne sait ce
  // qui reste. Le chiffre rend l'avancement finissable.
  const etat = couverture('en');
  assert.equal(etat.interface.traduites, etat.interface.total, 'interface complete');
  assert.ok(etat.regles > 40, `seulement ${etat.regles} regles traduites`);
});

test('langue : la langue courante est bien celle qu\'on a posee', () => {
  assert.equal(definirLangue('en'), 'en');
  assert.equal(langue(), 'en');
  assert.equal(definirLangue('klingon'), 'fr', 'une langue inconnue ne casse rien');
  assert.equal(langue(), 'fr');
});
