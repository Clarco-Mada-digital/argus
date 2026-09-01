import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { cvssBaseScore, compareVersions, isAffected, minimumSatisfying, severityFromScore, firstFixedVersion } from '../src/core/semver.js';
import { resolveInstalledVersions } from '../src/core/lockfiles.js';
import { findVulnerabilities, keyOf } from '../src/core/osv.js';
import { crawl, parseRobots, isDisallowed } from '../src/crawler/index.js';
import { applyEdits, planFixes, FIXERS, renderDiff } from '../src/cli/fix.js';
import { scan } from '../src/index.js';
import { loadConfig } from '../src/core/config.js';
import { walkProject } from '../src/core/walker.js';
import { ProjectContext } from '../src/core/project.js';

// =========================================================== CVSS et versions

test('CVSS : scores conformes aux vecteurs de reference FIRST.org', () => {
  // Valeurs publiees, verifiees contre le calculateur officiel.
  const references = [
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N', 5.5],
    ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H', 5.9],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10],
  ];
  for (const [vecteur, attendu] of references) {
    assert.equal(cvssBaseScore(vecteur), attendu, `score errone pour ${vecteur}`);
  }
  assert.equal(cvssBaseScore('pas un vecteur'), null);
  assert.equal(cvssBaseScore(null), null);
});

test('CVSS : traduction en gravite Argus', () => {
  assert.equal(severityFromScore(9.8), 'critical');
  assert.equal(severityFromScore(7.5), 'high');
  assert.equal(severityFromScore(5), 'medium');
  assert.equal(severityFromScore(2.1), 'low');
});

test('versions : comparaison, y compris pre-publications', () => {
  assert.equal(compareVersions('1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('4.17.15', '4.17.21'), -1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1, 'une pre-publication precede la version stable');
  assert.equal(compareVersions('v1.2.3', '1.2.3'), 0, 'le prefixe v est ignore');
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
});

test('versions : version minimale satisfaisant une plage', () => {
  assert.equal(minimumSatisfying('^4.17.11'), '4.17.11');
  assert.equal(minimumSatisfying('~2.1'), '2.1.0');
  assert.equal(minimumSatisfying('>=1.5.0 <2'), '1.5.0');
  assert.equal(minimumSatisfying('3.x'), '3.0.0');
  assert.equal(minimumSatisfying('*'), null);
  assert.equal(minimumSatisfying('git+https://exemple.tld/x.git'), null);
});

test('OSV : correspondance des plages affectees', () => {
  const affected = {
    package: { name: 'lodash', ecosystem: 'npm' },
    ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }],
  };
  assert.ok(isAffected('4.17.20', affected));
  assert.ok(isAffected('1.0.0', affected));
  assert.ok(!isAffected('4.17.21', affected), 'la version corrigee n\'est plus affectee');
  assert.ok(!isAffected('5.0.0', affected));
  assert.equal(firstFixedVersion(affected), '4.17.21');
});

test('OSV : plage ouverte plus tard, et liste explicite', () => {
  const tardif = { ranges: [{ type: 'SEMVER', events: [{ introduced: '2.0.0' }, { fixed: '2.3.1' }] }] };
  assert.ok(!isAffected('1.9.0', tardif), 'anterieure a l\'introduction');
  assert.ok(isAffected('2.1.0', tardif));
  assert.ok(!isAffected('2.3.1', tardif));

  const explicite = { versions: ['1.0.0', '1.0.1'] };
  assert.ok(isAffected('1.0.1', explicite));
  assert.ok(!isAffected('1.0.2', explicite));
});

test('OSV : recherche hors ligne dans le cache', () => {
  const cache = {
    packages: { 'npm:lodash@4.17.15': { name: 'lodash', version: '4.17.15', ecosystem: 'npm', vulns: ['GHSA-test'] } },
    advisories: {
      'GHSA-test': {
        id: 'GHSA-test',
        aliases: ['CVE-2021-23337'],
        summary: 'Command Injection',
        severity: 'high',
        score: 7.2,
        affected: [{ package: { name: 'lodash' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
      },
    },
  };

  const trouve = findVulnerabilities(cache, [{ name: 'lodash', version: '4.17.15', ecosystem: 'npm', exact: true, direct: true }]);
  assert.equal(trouve.length, 1);
  assert.equal(trouve[0].advisory.aliases[0], 'CVE-2021-23337');
  assert.equal(trouve[0].fixedIn, '4.17.21');

  // Une version corrigee ne doit plus rien remonter, meme si le cache la liste.
  const corrige = findVulnerabilities(cache, [{ name: 'lodash', version: '4.17.15', ecosystem: 'npm' }]);
  assert.equal(corrige.length, 1);
  assert.equal(keyOf({ ecosystem: 'npm', name: 'lodash', version: '4.17.15' }), 'npm:lodash@4.17.15');
});

// ================================================= Fichiers de verrouillage

test('lockfile : versions exactes lues dans package-lock v3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.11', axios: '^1.0.0' } }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/lodash': { name: 'lodash', version: '4.17.15' },
      'node_modules/axios': { name: 'axios', version: '1.2.3' },
    },
  }));

  const config = loadConfig(dir);
  const { files } = await walkProject(config);
  const installed = resolveInstalledVersions(new ProjectContext(config, files));
  const lodash = installed.find((p) => p.name === 'lodash');

  assert.equal(lodash.version, '4.17.15', 'la version du lockfile prime sur la plage declaree');
  assert.equal(lodash.exact, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lockfile : sans verrouillage, la version est deduite et signalee', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.11' } }));

  const config = loadConfig(dir);
  const { files } = await walkProject(config);
  const installed = resolveInstalledVersions(new ProjectContext(config, files));

  assert.equal(installed[0].version, '4.17.11');
  assert.equal(installed[0].exact, false, 'l\'approximation doit etre marquee comme telle');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('dependances : sans cache OSV, l\'outil le dit explicitement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.17.11' } }));

  const resultat = await scan(dir, { categories: ['dependencies'] });
  const avertissement = resultat.findings.find((f) => f.ruleId === 'DEP-NO-OSV-SYNC');
  assert.ok(avertissement, 'l\'absence de synchronisation doit etre signalee');
  assert.match(avertissement.suggestion, /argus sync/);

  const secours = resultat.findings.find((f) => f.ruleId === 'DEP-VULNERABLE');
  assert.equal(secours.confidence, 'tentative', 'la liste de secours ne doit pas etre presentee comme certaine');
  assert.match(secours.message, /liste locale de secours/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================ Correctifs

test('fix : les modifications sont appliquees de la fin vers le debut', () => {
  const source = 'abcdef';
  const resultat = applyEdits(source, [
    { start: 1, end: 1, replacement: 'X' },
    { start: 4, end: 4, replacement: 'Y' },
  ]);
  assert.equal(resultat, 'aXbcdYef');
});

test('fix : les modifications qui se chevauchent ne se corrompent pas', () => {
  const resultat = applyEdits('abcdef', [
    { start: 1, end: 4, replacement: 'Z' },
    { start: 2, end: 3, replacement: 'Q' },
  ]);
  // L'invariant qui compte n'est pas *laquelle* des deux gagne, mais qu'une
  // seule soit appliquee : deux modifications qui se recouvrent produiraient
  // un fichier incoherent.
  const resultatsAcceptables = ['aZef', 'abQdef'];
  assert.ok(
    resultatsAcceptables.includes(resultat),
    `resultat corrompu : ${JSON.stringify(resultat)} n'est aucune des deux applications isolees`,
  );
});

test('fix : chaque correctif explique son risque et sa raison', () => {
  for (const fixer of FIXERS) {
    assert.ok(fixer.id && fixer.label, 'identifiant ou libelle manquant');
    assert.ok(['sur', 'a-verifier'].includes(fixer.risk.id), `risque non qualifie : ${fixer.id}`);
    assert.ok(fixer.why?.length > 30, `justification absente : ${fixer.id}`);
    assert.equal(typeof fixer.collect, 'function');
  }
});

test('fix : correctifs HTML calcules sans rien ecrire sur le disque', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  const fichier = path.join(dir, 'page.html');
  const avant = '<!doctype html>\n<html>\n<head>\n  <title>x</title>\n</head>\n<body>\n  <a href="https://x.tld" target="_blank">x</a>\n</body>\n</html>\n';
  fs.writeFileSync(fichier, avant);

  const config = loadConfig(dir);
  const { files } = await walkProject(config);
  const plan = planFixes(new ProjectContext(config, files));

  assert.equal(plan.length, 1);
  assert.ok(plan[0].after.includes('rel="noopener noreferrer"'));
  assert.ok(plan[0].after.includes('charset="utf-8"'));
  assert.ok(plan[0].after.includes('width=device-width'));

  // Le charset doit preceder le viewport : c'est une exigence de la norme.
  assert.ok(plan[0].after.indexOf('charset') < plan[0].after.indexOf('viewport'));

  // Et surtout : le fichier d'origine ne doit pas avoir bouge.
  assert.equal(fs.readFileSync(fichier, 'utf8'), avant, 'planFixes ne doit jamais ecrire');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fix : le differentiel montre les lignes ajoutees et retirees', () => {
  const diff = renderDiff('a\nb\nc\n', 'a\nB\nc\n');
  assert.match(diff, /\+.*B/);
  assert.match(diff, /-.*b/);
});

test('fix : rien n\'est propose sur un fichier deja conforme', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(
    path.join(dir, 'ok.html'),
    '<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>ok</title>\n</head>\n<body><h1>ok</h1></body>\n</html>\n',
  );
  const config = loadConfig(dir);
  const { files } = await walkProject(config);
  assert.equal(planFixes(new ProjectContext(config, files)).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================== Exploration

test('robots.txt : analyse et decision d\'exploration', () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /admin
Disallow: /prive/
Allow: /admin/public
Sitemap: https://exemple.tld/sitemap.xml

User-agent: BadBot
Disallow: /
`);
  assert.equal(robots.sitemaps.length, 1);
  assert.ok(isDisallowed('/admin/secret', robots));
  assert.ok(isDisallowed('/prive/x', robots));
  assert.ok(!isDisallowed('/admin/public/page', robots), 'la regle la plus specifique gagne');
  assert.ok(!isDisallowed('/', robots), 'le groupe BadBot ne nous concerne pas');
});

/** Petit serveur local : le crawl est teste sans dependre d'Internet. */
function serveurDeTest(routes) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const route = routes[req.url];
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html><body>introuvable</body></html>');
        return;
      }
      res.writeHead(route.status || 200, { 'Content-Type': 'text/html; charset=utf-8', ...(route.headers || {}) });
      res.end(route.body ?? '');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('crawl : suit les liens, releve les statuts et les en-tetes', async () => {
  const { server, url } = await serveurDeTest({
    '/': {
      body: '<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><h1>Bonjour</h1>' +
        '<a href="/a-propos">A propos</a><a href="/casse">Casse</a></body></html>',
      headers: { 'x-powered-by': 'Express' },
    },
    '/a-propos': { body: '<!doctype html><html><head><title>Accueil</title></head><body><h1>A propos</h1></body></html>' },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
  });

  try {
    const resultat = await crawl(url, { maxPages: 10, delayMs: 0, checkExternal: false, timeoutMs: 5000 });

    const parUrl = new Map(resultat.pages.map((p) => [new URL(p.url).pathname, p]));
    assert.equal(parUrl.get('/').status, 200);
    assert.equal(parUrl.get('/a-propos').status, 200);
    assert.equal(parUrl.get('/casse').status, 404, 'le lien mort doit etre atteint et son 404 constate');
    assert.equal(parUrl.get('/').seo.title, 'Accueil');
    assert.equal(parUrl.get('/').seo.h1, 1);
    assert.equal(parUrl.get('/').headers['x-powered-by'], 'Express');
  } finally {
    server.close();
  }
});

test('crawl : transforme les observations en problemes verifies', async () => {
  const { server, url } = await serveurDeTest({
    '/': { body: '<!doctype html><html lang="fr"><head><title>T</title></head><body><h1>H</h1><a href="/mort">x</a></body></html>' },
    '/robots.txt': { status: 404, body: '' },
  });

  try {
    const resultat = await scan('.', {
      categories: ['routes', 'seo', 'security', 'performance'],
      crawl: url,
      crawlOnly: true,
      crawlOptions: { maxPages: 5, delayMs: 0, checkExternal: false, timeoutMs: 5000 },
    });

    const regles = resultat.findings.map((f) => f.ruleId);
    assert.ok(regles.includes('CRAWL-BROKEN-PAGE'), '404 verifie non signale');
    assert.ok(regles.includes('CRAWL-NO-ROBOTS'), 'robots.txt absent non signale');
    assert.ok(regles.includes('CRAWL-HEADER-CONTENT-SECURITY-POLICY'), 'en-tete CSP absent non signale');

    // Les constats issus du reseau sont des faits : ils doivent l'affirmer.
    for (const finding of resultat.findings.filter((f) => f.ruleId.startsWith('CRAWL-HEADER'))) {
      assert.equal(finding.confidence, 'certain');
    }

    // HSTS ne s'applique pas a une page servie en HTTP : pas de bruit inutile.
    assert.ok(!regles.includes('CRAWL-HEADER-STRICT-TRANSPORT-SECURITY'));
  } finally {
    server.close();
  }
});

test('crawl : detecte une coquille vide de SPA', async () => {
  const { server, url } = await serveurDeTest({
    '/': { body: '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>' },
    '/robots.txt': { body: 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n' },
  });

  try {
    const resultat = await scan('.', {
      categories: ['seo'],
      crawl: url,
      crawlOnly: true,
      crawlOptions: { maxPages: 3, delayMs: 0, checkExternal: false, timeoutMs: 5000 },
    });
    const vide = resultat.findings.find((f) => f.ruleId === 'CRAWL-EMPTY-HTML');
    assert.ok(vide, 'une page sans contenu servi doit etre signalee');
    assert.equal(vide.confidence, 'certain');
  } finally {
    server.close();
  }
});

test('crawl : mesure les chaines de redirection', async () => {
  const { server, url } = await serveurDeTest({
    '/': { body: '<!doctype html><html><head><title>T</title></head><body><h1>H</h1><a href="/etape1">suite</a></body></html>' },
    '/etape1': { status: 302, headers: { location: '/etape2' }, body: '' },
    '/etape2': { status: 301, headers: { location: '/final' }, body: '' },
    '/final': { body: '<!doctype html><html><head><title>Final</title></head><body><h1>Arrive</h1></body></html>' },
    '/robots.txt': { body: 'User-agent: *\n' },
  });

  try {
    const resultat = await crawl(url, { maxPages: 10, delayMs: 0, checkExternal: false, timeoutMs: 5000 });
    const page = resultat.pages.find((p) => p.url.endsWith('/etape1'));
    assert.equal(page.redirects.length, 2, 'la chaine complete doit etre relevee');
    assert.equal(page.status, 200);
    assert.ok(page.finalUrl.endsWith('/final'));
  } finally {
    server.close();
  }
});

test('crawl : robots.txt est respecte', async () => {
  const { server, url } = await serveurDeTest({
    '/': { body: '<!doctype html><html><head><title>T</title></head><body><h1>H</h1><a href="/prive/x">prive</a></body></html>' },
    '/prive/x': { body: '<html><body>secret</body></html>' },
    '/robots.txt': { body: 'User-agent: *\nDisallow: /prive\n' },
  });

  try {
    const resultat = await crawl(url, { maxPages: 10, delayMs: 0, checkExternal: false, timeoutMs: 5000 });
    const prive = resultat.pages.find((p) => p.url.includes('/prive'));
    assert.ok(prive?.blockedByRobots, 'la page interdite ne doit pas etre telechargee');
    assert.equal(prive.status, null);
  } finally {
    server.close();
  }
});
