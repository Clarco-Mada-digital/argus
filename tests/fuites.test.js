import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chercherLesFuites, depuisQuand, ouRevoquer } from '../src/core/fuites.js';
import { scan } from '../src/index.js';

/**
 * L'historique est construit ici, jamais versionne.
 *
 * Un depot de test contenant de vraies clefs serait refuse au push par la
 * protection de GitHub — et il aurait tort de ne pas l'etre. Les valeurs sont
 * donc assemblees a l'execution, comme pour les tests de detection de secrets.
 */
function depotAvecFuite() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-fuite-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

  git('init', '-q');
  git('config', 'user.email', 'test@exemple.com');
  git('config', 'user.name', 'Test');

  // Assemblage a l'execution : la chaine complete n'existe nulle part.
  const stripe = `sk_${'live'}_4eC39HqLyjWDarjtT1zdp7dcABCDEFGH`;
  const github = `ghp_${'aBcDeFgHiJkLmNoPqRsTuVwXyZ'}0123456789`;

  fs.writeFileSync(path.join(dir, 'config.js'), `export const CLE = "${stripe}";\n`);
  git('add', '-A');
  git('commit', '-qm', 'configuration initiale');

  fs.appendFileSync(path.join(dir, 'config.js'), `export const JETON = "${github}";\n`);
  git('add', '-A');
  git('commit', '-qm', 'ajout du jeton');

  // Le geste habituel : sortir la clef du code. Le fichier redevient propre.
  fs.writeFileSync(
    path.join(dir, 'config.js'),
    'export const CLE = process.env.STRIPE_KEY;\nexport const JETON = process.env.GH_TOKEN;\n',
  );
  git('add', '-A');
  git('commit', '-qm', 'sortir les secrets du code');

  return dir;
}

test('fuites : une clef retiree du code reste dans l\'historique', async () => {
  const dir = depotAvecFuite();

  // L'arbre de travail est propre : le scan ordinaire ne voit rien.
  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId.startsWith('SEC-SECRET')),
    [],
    'le code d\'aujourd\'hui ne contient plus rien',
  );

  // L'historique, lui, les contient toujours.
  const resultat = await chercherLesFuites(dir, { maxCommits: 50 });
  const genres = resultat.fuites.map((f) => f.genre);

  assert.ok(genres.includes('stripe-key'), 'la clef Stripe doit etre retrouvee');
  assert.ok(genres.includes('github-token'), 'le jeton GitHub doit etre retrouve');
  assert.equal(resultat.commitsAnalyses, 3);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : la valeur est masquee, jamais restituee en clair', async () => {
  const dir = depotAvecFuite();
  const { fuites } = await chercherLesFuites(dir, { maxCommits: 50 });

  for (const fuite of fuites) {
    assert.match(fuite.valeur, /\*/, 'la valeur doit etre masquee');
    assert.ok(
      !/4eC39HqLyjWDarjtT1zdp7dc/.test(fuite.valeur),
      'le rapport ne doit pas recopier le secret en clair',
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : chaque fuite designe le commit qui l\'a introduite', async () => {
  const dir = depotAvecFuite();
  const { fuites } = await chercherLesFuites(dir, { maxCommits: 50 });

  const stripe = fuites.find((f) => f.genre === 'stripe-key');
  const github = fuites.find((f) => f.genre === 'github-token');

  // `git log` remonte du plus recent au plus ancien : le suivi doit malgre
  // tout designer le *premier* commit ou la valeur apparait, seul utile pour
  // savoir depuis quand la clef circule.
  assert.equal(stripe.premierCommit.sujet, 'configuration initiale');
  assert.equal(github.premierCommit.sujet, 'ajout du jeton');
  assert.match(stripe.premierCommit.hash, /^[0-9a-f]{40}$/);
  assert.ok(stripe.fichiers.includes('config.js'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : une meme clef dans plusieurs commits ne compte qu\'une fois', async () => {
  // C'est une seule clef a revoquer. La repeter par commit noierait le
  // nombre reel d'actions a mener.
  const dir = depotAvecFuite();
  const { fuites } = await chercherLesFuites(dir, { maxCommits: 50 });

  const empreintes = fuites.map((f) => f.empreinte);
  assert.equal(new Set(empreintes).size, empreintes.length, 'aucun doublon');

  const stripe = fuites.find((f) => f.genre === 'stripe-key');
  assert.ok(stripe.commits >= 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : un depot sans secret ne remonte rien', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-propre-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@exemple.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'app.js'), 'export const CLE = process.env.API_KEY;\n');
  git('add', '-A');
  git('commit', '-qm', 'depart propre');

  const { fuites } = await chercherLesFuites(dir, { maxCommits: 50 });
  assert.deepEqual(fuites, []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : un dossier hors depot Git le dit clairement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-nogit-'));
  await assert.rejects(() => chercherLesFuites(dir), /depot Git/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fuites : chaque genre detectable porte un conseil de revocation', async () => {
  // Constater une fuite sans dire ou la fermer laisse le travail a moitie
  // fait — et c'est la moitie difficile.
  const source = fs.readFileSync(
    path.join(import.meta.dirname, '..', 'src', 'rules', 'secrets.js'),
    'utf8',
  );
  const genres = [...new Set([...source.matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]))];

  const sansConseil = genres.filter((genre) => !ouRevoquer(genre).service);
  assert.deepEqual(sansConseil, [], `genres sans conseil : ${sansConseil.join(', ')}`);
});

test('fuites : l\'age se lit en francais', () => {
  const jour = 86400000;
  assert.equal(depuisQuand(Date.now()), "aujourd'hui");
  assert.equal(depuisQuand(Date.now() - jour), 'hier');
  assert.equal(depuisQuand(Date.now() - 5 * jour), 'il y a 5 jours');
  assert.match(depuisQuand(Date.now() - 60 * jour), /il y a 2 mois/);
  assert.equal(depuisQuand(Date.now() - 400 * jour), 'il y a un an');
  assert.match(depuisQuand(Date.now() - 800 * jour), /il y a 2 ans/);
});

test('fuites : une donnee de test n\'est pas rangee avec les vraies fuites', async () => {
  // Une suite qui verifie la detection de secrets doit en contenir : c'est son
  // entree. Les melanger aux vraies fuites noierait les secondes, et une
  // alerte de securite noyee est une alerte ignoree.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-mixte-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@exemple.com');
  git('config', 'user.name', 'Test');

  const vraie = `sk_${'live'}_4eC39HqLyjWDarjtT1zdp7dcABCDEFGH`;
  const dansUnTest = `ghp_${'aBcDeFgHiJkLmNoPqRsTuVwXyZ'}0123456789`;

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests/fixtures'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/paiement.js'), `const cle = "${vraie}";\n`);
  fs.writeFileSync(path.join(dir, 'tests/fixtures/exemple.js'), `const faux = "${dansUnTest}";\n`);
  git('add', '-A');
  git('commit', '-qm', 'depart');

  const resultat = await chercherLesFuites(dir, { maxCommits: 20 });

  assert.equal(resultat.reelles.length, 1, 'une seule vraie fuite');
  assert.equal(resultat.reelles[0].genre, 'stripe-key');
  assert.equal(resultat.donneesDeTest, 1);

  // Elles ne sont pas perdues pour autant : une vraie clef finit parfois
  // dans un test, et c'est a l'utilisateur de trancher.
  const test = resultat.fuites.find((f) => f.donneeDeTest);
  assert.equal(test.genre, 'github-token');
  // Les vraies passent devant.
  assert.equal(resultat.fuites[0].donneeDeTest, false);

  fs.rmSync(dir, { recursive: true, force: true });
});
