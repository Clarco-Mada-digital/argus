import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lexer, TYPES } from '../src/lang/js/lexer.js';
import { analyserPortees, ORIGINES } from '../src/lang/js/portees.js';
import { scan } from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const types = (source) => lexer(source).map((j) => `${j.type}:${j.valeur}`);

test('lexeur : la barre oblique est une division ou une regex selon le contexte', () => {
  // Apres une valeur, c'est une division.
  const division = lexer('const x = a / b / c;');
  assert.equal(division.filter((j) => j.type === TYPES.regex).length, 0);

  // Apres un operateur ou un mot-cle, c'est un litteral.
  const regex = lexer('const r = /ab+c/gi; return /x/.test(s);');
  assert.equal(regex.filter((j) => j.type === TYPES.regex).length, 2);

  // Le cas piegeux : une classe de caracteres contenant une barre oblique.
  const classe = lexer('const r = /[/]/;');
  assert.equal(classe.filter((j) => j.type === TYPES.regex).length, 1);
});

test('lexeur : gabarits imbriques et chaines echappees', () => {
  const jetons = lexer('const s = `a ${ `b ${ c }` } d`; const t = "il dit \\"oui\\"";');
  const gabarits = jetons.filter((j) => j.type === TYPES.gabarit);
  assert.equal(gabarits.length, 1, 'un gabarit imbrique reste un seul jeton');
  assert.ok(gabarits[0].valeur.endsWith('`'));

  const chaines = jetons.filter((j) => j.type === TYPES.chaine);
  assert.equal(chaines.length, 1);
  assert.ok(chaines[0].valeur.includes('\\"oui\\"'));
});

test('lexeur : les commentaires disparaissent, le code autour survit', () => {
  assert.deepEqual(types('a // b\nc /* d */ e'), [
    'identifiant:a', 'identifiant:c', 'identifiant:e',
  ]);
});

test('lexeur : un point apres un nombre n\'est decimal que devant un chiffre', () => {
  assert.deepEqual(types('1.5'), ['nombre:1.5']);
  assert.deepEqual(types('x.toFixed'), ['identifiant:x', 'ponctuation:.', 'identifiant:toFixed']);
});

test('portees : un parametre masque une constante du module', () => {
  const source = [
    "const table = 'users';",
    'function lister(table) {',
    '  utiliser(table);',
    '}',
  ].join('\n');

  const a = analyserPortees(source);
  const dansLaFonction = source.indexOf('utiliser(table)') + 'utiliser('.length;
  const auModule = source.indexOf("const table") + 'const '.length;

  assert.equal(a.origine('table', dansLaFonction), ORIGINES.parametre);
  assert.equal(a.origine('table', auModule), ORIGINES.litteral);
});

test('portees : une reaffectation depuis la requete empoisonne la liaison', () => {
  const source = [
    'function gerer(requete) {',
    "  let critere = 'defaut';",
    '  critere = requete.body.critere;',
    '  utiliser(critere);',
    '}',
  ].join('\n');

  const a = analyserPortees(source);
  const usage = source.lastIndexOf('critere');
  assert.equal(a.origine('critere', usage), ORIGINES.externe);

  const liaison = a.resoudre('critere', usage);
  assert.ok(liaison.reaffecte, 'la reaffectation doit etre enregistree');
});

test('portees : la decomposition lie bien les noms, pas les cles', () => {
  const source = [
    'function gerer(requete) {',
    '  const { slug } = requete.params;',
    '  const { a: renomme } = objet;',
    '  const [premier, , troisieme] = liste;',
    '}',
  ].join('\n');

  const a = analyserPortees(source);
  const fin = source.length - 2;

  assert.equal(a.origine('slug', fin), ORIGINES.externe);
  assert.ok(a.resoudre('renomme', fin), '`a: renomme` lie « renomme »');
  assert.equal(a.resoudre('a', fin), null, '« a » est une cle, pas une liaison');
  assert.ok(a.resoudre('premier', fin));
  assert.ok(a.resoudre('troisieme', fin), 'un trou de tableau ne decale pas les noms');
});

test('portees : `var` porte sur la fonction, `let` sur le bloc', () => {
  const source = [
    'function f() {',
    '  if (x) {',
    '    var visible = 1;',
    '    let cachee = 2;',
    '  }',
    '  utiliser();',
    '}',
  ].join('\n');

  const a = analyserPortees(source);
  const apresLeBloc = source.indexOf('utiliser()');

  assert.ok(a.resoudre('visible', apresLeBloc), '`var` remonte a la fonction');
  assert.equal(a.resoudre('cachee', apresLeBloc), null, '`let` reste dans son bloc');
});

test('portees : les parametres de fonction flechee sont lies a leur corps', () => {
  const source = 'const f = (requete, reponse) => { utiliser(requete.query.id); };';
  const a = analyserPortees(source);
  const dansLeCorps = source.indexOf('utiliser(') + 'utiliser('.length;

  assert.equal(a.resoudre('requete', dansLeCorps)?.genre, 'param');
  assert.equal(a.resoudre('reponse', dansLeCorps)?.genre, 'param');
});

test('portees : une source illisible ne fait rien exploser', () => {
  // Ce n'est pas du JavaScript valide : le lexeur doit rendre la main
  // proprement plutot que de boucler ou de lever.
  for (const source of ['const a = `non terminé', 'function ( { [ /', '"', '`${']) {
    assert.doesNotThrow(() => analyserPortees(source));
  }
});

test('injection : la gravite suit l\'origine reelle de la valeur', async () => {
  const rapport = await scan(path.join(FIXTURES, 'portee'), { noHistory: true });
  const sql = rapport.findings.filter((f) => f.ruleId === 'SEC-SQL-CONCAT');
  const parLigne = Object.fromEntries(sql.map((f) => [f.line, f]));

  // Ligne 16 : la valeur est une constante litterale du module. Signaler une
  // injection critique la-dessus est le faux positif le plus couteux — c'est
  // celui qui fait ignorer la categorie entiere.
  assert.equal(parLigne[16], undefined, 'une constante litterale n\'est pas une injection');

  assert.equal(parLigne[9].confidence, 'firm');
  assert.match(parLigne[9].message, /entree externe/);

  assert.equal(parLigne[29].confidence, 'firm', 'reaffectee depuis req.body');
  assert.equal(parLigne[35].confidence, 'firm', 'decomposee depuis req.params');

  // Un parametre reste signale, mais son appelant est inconnu.
  assert.equal(parLigne[22].confidence, 'tentative');
  assert.match(parLigne[22].message, /parametre de fonction/);
});

test('injection : le flux ne fait perdre aucun constat existant', async () => {
  // Les fixtures serveur contiennent de vraies injections : la graduation ne
  // doit rien retirer de ce qui etait deja juste.
  for (const nom of ['demo-site', 'polyglot']) {
    const rapport = await scan(path.join(FIXTURES, nom), { noHistory: true });
    const injections = rapport.findings.filter((f) =>
      /^SEC-(SQL-CONCAT|EVAL|PATH-TRAVERSAL|SSRF|NOSQL)/.test(f.ruleId),
    );
    assert.ok(injections.length > 0, `${nom} doit conserver ses injections`);
  }
});

test('portees python : l\'indentation suffit, il n\'y a pas de portee de bloc', async () => {
  const { analyserPortees: py, ORIGINES: O } = await import('../src/lang/python/portees.js');

  const source = [
    'def gerer(request):',
    "    role = 'admin'",
    '    if actif:',
    '        identifiant = request.GET.get("id")',
    '    utiliser(identifiant, role)',
    '',
    'def autre(nom_table):',
    '    utiliser(nom_table)',
    '',
    'role_global = 3',
  ].join('\n');

  const a = py(source);
  const dansGerer = source.indexOf('utiliser(identifiant');

  // Un `if` n'introduit rien : la variable reste visible apres le bloc.
  assert.equal(a.origine('identifiant', dansGerer), O.externe);
  assert.equal(a.origine('role', dansGerer), O.litteral);

  const dansAutre = source.indexOf('utiliser(nom_table)');
  assert.equal(a.origine('nom_table', dansAutre), O.parametre);
  assert.equal(a.resoudre('identifiant', dansAutre), null, 'les fonctions ne se voient pas');
});

test('portees python : self et cls ne sont pas des parametres utiles', async () => {
  const { analyserPortees: py } = await import('../src/lang/python/portees.js');
  const source = ['class A:', '    def m(self, valeur):', '        utiliser(valeur)'].join('\n');
  const a = py(source);
  const dedans = source.indexOf('utiliser(');

  assert.equal(a.resoudre('self', dedans), null);
  assert.equal(a.resoudre('valeur', dedans)?.genre, 'param');
});

test('injection python : la gravite suit l\'origine, comme en JavaScript', async () => {
  const rapport = await scan(path.join(FIXTURES, 'portee-python'), { noHistory: true });
  const sql = rapport.findings.filter((f) => f.ruleId === 'SEC-SQL-CONCAT');
  const parLigne = Object.fromEntries(sql.map((f) => [f.line, f]));

  assert.equal(parLigne[13], undefined, "role = 'admin' n'est pas une injection");
  assert.equal(parLigne[7].confidence, 'firm');
  assert.equal(parLigne[18].confidence, 'tentative', 'parametre : appelant inconnu');
  assert.equal(parLigne[26].confidence, 'firm', 'reaffecte depuis request.POST');
});

test('portees python : une source mal indentee ne fait rien exploser', async () => {
  const { analyserPortees: py } = await import('../src/lang/python/portees.js');
  for (const source of ['def f(', '    x = ', 'class', 'if:\n\tx=1\n  y=2']) {
    assert.doesNotThrow(() => py(source));
  }
});
