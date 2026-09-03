import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';
import { renderReport } from '../src/report/terminal.js';

/**
 * Defauts remontes par une equipe apres usage sur un ERP Django en production
 * (~120 000 lignes). Chacun avait ete verifie dans leur code avant d'etre
 * signale ; chacun est fige ici.
 */

function projetDjango(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-terrain-'));
  fs.writeFileSync(path.join(dir, 'requirements.txt'), 'Django==5.2.6\n');
  fs.writeFileSync(path.join(dir, 'manage.py'), 'import django\n');

  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, chemin);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

test('terrain : un fichier test_*.py est bien un fichier de test', async () => {
  // La convention Python place le mot avant un underscore ; il ne figurait pas
  // parmi les separateurs. Trois fichiers representaient quinze pour cent des
  // constats d'un projet reel qui les avait pourtant exclus.
  const dir = projetDjango({
    'argus.config.json': JSON.stringify({ includeTests: false }),
    'core/test_journal.py': 'import hashlib\n\ndef test_x():\n    return hashlib.md5(b"a").hexdigest()\n',
    'core/views.py': 'import hashlib\n\ndef vue(request):\n    return hashlib.sha256(b"a").hexdigest()\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.file?.includes('test_journal')),
    [],
    'includeTests: false est une consigne explicite',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un CSS compile par Tailwind n\'a pas d\'auteur a blamer', async () => {
  // 84 constats de duplication sur `static/css/output.css`. La marque
  // `@generated` est une convention que peu d'outils suivent.
  const dir = projetDjango({
    'static/css/output.css':
      '/*! tailwindcss v3.4.1 | MIT License | https://tailwindcss.com*/\n' +
      Array.from({ length: 200 }, (_, i) => `.c${i}{color:#111;background:#fff;padding:4px}`).join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const surLeCss = rapport.findings.filter((f) => f.file?.includes('output.css') && f.category === 'design');
  assert.deepEqual(surLeCss, [], 'un fichier produit par un outil est ecarte');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un champ enveloppe par son label est correctement associe', async () => {
  // `<label><input type="checkbox"> Texte</label>` est valide, et c'est meme
  // la forme recommandee pour les cases a cocher.
  const dir = projetDjango({
    'gabarits/page.html': [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion au portail</title>',
      '<meta name="description" content="Connectez-vous a votre espace pour gerer vos commandes et vos preferences."></head>',
      '<body><main><h1>Connexion</h1><form method="post">',
      '  <label><input type="checkbox" name="se_souvenir"> Se souvenir de moi</label>',
      '  <label>Telephone</label>',
      '  <input type="tel" name="telephone">',
      '</form></main></body></html>',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const sansLabel = rapport.findings.filter((f) => f.ruleId === 'A11Y-INPUT-NO-LABEL');

  assert.equal(sansLabel.length, 1, 'seul le champ reellement sans etiquette');
  assert.match(sansLabel[0].snippet, /tel/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : innerHTML litteral n\'expose rien', async () => {
  // Les six constats du projet portaient tous sur une chaine constante. Le
  // risque vient de la donnee variable, pas de `innerHTML` en soi.
  const dir = projetDjango({
    'static/app.js': [
      'export function init(btn, donnees) {',
      "  btn.innerHTML = '<i class=\"fa fa-chevron-left\"></i>';",
      "  document.getElementById('titre').innerHTML = donnees.titre;",
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const html = rapport.findings.filter((f) => f.ruleId === 'SEC-INNERHTML');

  assert.equal(html.length, 1, 'seule la valeur variable doit remonter');
  assert.match(html[0].snippet, /donnees\.titre/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : du JSON interpole dans un <script> est une faille', async () => {
  // Faille reelle qu'Argus n'avait pas vue. Un JSON valide n'est pas sur
  // dans un <script> : la chaine « </script » y ferme la balise.
  const dir = projetDjango({
    'gabarits/tableau.html': [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tableau de bord</title>',
      '<meta name="description" content="Vue d ensemble de vos indicateurs et de votre activite recente."></head>',
      '<body><main><h1>Tableau</h1>',
      '<script>window.sons = {{ preferences_json|safe }};</script>',
      '</main></body></html>',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constat = rapport.findings.find((f) => f.ruleId === 'SEC-DONNEES-DANS-SCRIPT');

  assert.ok(constat, 'l\'interpolation dans un script doit etre signalee');
  assert.equal(constat.severity, 'high');
  assert.match(constat.suggestion, /json_script/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : un defaut de developpement surcharge en production', async () => {
  // Un projet correctement durci etait declare non durci, au rang le plus
  // grave. La valeur qui compte est la derniere evaluee.
  const avecSurcharge = projetDjango({
    'monsite/settings.py': [
      'import os',
      '',
      'DEBUG = os.environ.get("DEBUG", "0") == "1"',
      'SESSION_COOKIE_SECURE = False',
      '',
      'if not DEBUG:',
      '    SESSION_COOKIE_SECURE = True',
    ].join('\n'),
  });

  const rapport = await scan(avecSurcharge, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'SEC-SECURE-FLAG-OFF'),
    [],
    'la surcharge en production doit etre vue',
  );
  fs.rmSync(avecSurcharge, { recursive: true, force: true });

  // Sans surcharge, le constat reste.
  const sansSurcharge = projetDjango({
    'monsite/settings.py': 'SESSION_COOKIE_SECURE = False\n',
  });
  const rapport2 = await scan(sansSurcharge, { noHistory: true });
  assert.ok(rapport2.findings.some((f) => f.ruleId === 'SEC-SECURE-FLAG-OFF'));
  fs.rmSync(sansSurcharge, { recursive: true, force: true });
});

test('terrain : un constat critique n\'est jamais tronque', async () => {
  // « 820 probleme(s) non affiches » masquait leur unique constat critique :
  // le budget d'affichage se consommait dans l'ordre des categories, et la
  // sienne venait tard.
  const bruit = Array.from(
    { length: 80 },
    (_, i) => `<div><img src="i${i}.png"><input type="text" name="f${i}"></div>`,
  ).join('\n');

  const dir = projetDjango({
    'page.html': bruit,
    'monsite/secrets.py': 'AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"\n',
  });

  const rapport = await scan(dir, { noHistory: true });
  const critiques = rapport.findings.filter((f) => f.severity === 'critical');
  assert.ok(critiques.length > 0, 'le decor du test doit produire un critique');

  const sortie = renderReport(rapport);
  for (const constat of critiques) {
    assert.ok(
      sortie.includes(constat.ruleId),
      `${constat.ruleId} doit apparaitre malgre la troncature`,
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
});

test('terrain : le rapport dit sur quelle base la veille a conclu', async () => {
  // Deux scans consecutifs, sans toucher aux dependances, avaient donne 2 puis
  // 8 constats : la synchronisation OSV s'etait faite en silence entre les
  // deux. Un score qui bouge sans que le code bouge fait douter du reste.
  const dir = projetDjango({});

  const sans = await scan(dir, { noHistory: true });
  assert.equal(sans.veille.source, 'embarquee');
  assert.match(renderReport(sans), /liste embarquee/);

  fs.mkdirSync(path.join(dir, '.argus'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.argus', 'osv-cache.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), packages: { 'PyPI:django@5.2.6': [] } }),
  );

  const avec = await scan(dir, { noHistory: true });
  assert.equal(avec.veille.source, 'osv');
  assert.equal(avec.veille.entrees, 1);
  assert.match(renderReport(avec), /base OSV, 1 paquet/);

  fs.rmSync(dir, { recursive: true, force: true });
});
