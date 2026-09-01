import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from '../src/index.js';
import { renderHtml } from '../src/report/html.js';
import { contrastRatio } from '../src/core/color.js';
import { renderSarif, renderMarkdown, renderCompact } from '../src/report/formats.js';
import { startServer } from '../src/server/index.js';
import { loadConfig, writeBaseline } from '../src/core/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(HERE, 'fixtures/demo-site');
const POLYGLOT = path.join(HERE, 'fixtures/polyglot');

/** Un scan est reutilise par plusieurs tests : il coute quelques centaines de ms. */
const demo = await scan(DEMO);
const polyglot = await scan(POLYGLOT);

const has = (result, ruleId) => result.findings.some((f) => f.ruleId === ruleId);
const at = (result, ruleId) => result.findings.find((f) => f.ruleId === ruleId);

// -------------------------------------------------------------- Structure

test('le scan produit un rapport complet et coherent', () => {
  assert.equal(demo.tool.name, 'Argus');
  assert.ok(demo.project.analyzed > 0);
  assert.ok(demo.durationMs >= 0);
  assert.equal(demo.errors.length, 0, `analyseurs en erreur : ${JSON.stringify(demo.errors)}`);
  assert.ok(demo.scores.global >= 0 && demo.scores.global <= 100);
  assert.equal(demo.findings.length, demo.scores.total);
});

test('chaque probleme porte les champs necessaires a l\'action', () => {
  for (const finding of demo.findings) {
    assert.ok(finding.ruleId, 'ruleId manquant');
    assert.ok(finding.title, `titre manquant pour ${finding.ruleId}`);
    assert.ok(finding.message, `message manquant pour ${finding.ruleId}`);
    assert.ok(finding.suggestion, `aucune suggestion pour ${finding.ruleId}`);
    assert.ok(finding.fingerprint, 'empreinte manquante');
    assert.ok(['critical', 'high', 'medium', 'low', 'info'].includes(finding.severity));
  }
});

test('les problemes sont tries par gravite decroissante', () => {
  const ordre = ['critical', 'high', 'medium', 'low', 'info'];
  const positions = demo.findings.map((f) => ordre.indexOf(f.severity));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] >= positions[i - 1], 'tri par gravite rompu');
  }
});

// --------------------------------------------------------------- Securite

test('securite : les secrets codes en dur sont detectes', () => {
  // Les motifs de fournisseurs sont couverts en unitaire (tests/secrets.test.js),
  // ou les valeurs sont assemblees a l'execution : une clef de paiement ecrite
  // en clair dans un depot public serait interceptee par les protections de la
  // plateforme, meme factice — et elle aurait raison de l'etre.
  assert.ok(has(demo, 'SEC-SECRET-DB-URL'), 'URL de base avec identifiants non detectee');
  assert.ok(has(demo, 'SEC-SECRET-GENERIC-SECRET'), 'affectation a haute entropie non detectee');

  const secret = at(demo, 'SEC-SECRET-GENERIC-SECRET');
  assert.ok(!secret.snippet.includes('aB3xK9mQ7pL2vN8wR4tY6uZ1cD5eF0gH'), 'le secret doit etre masque dans le rapport');
  assert.match(secret.snippet, /\*{4,}/, 'la valeur doit apparaitre caviardee');
});

test('securite : injections detectees dans plusieurs langages', () => {
  assert.ok(has(demo, 'SEC-EXEC-SHELL'), 'injection de commande (JS)');
  assert.ok(has(polyglot, 'SEC-SQL-CONCAT'), 'injection SQL (Python/PHP)');
  assert.ok(has(polyglot, 'SEC-PICKLE'), 'deserialisation Python');
  assert.ok(has(polyglot, 'SEC-JAVA-DESERIALIZE'), 'deserialisation Java');
  assert.ok(has(polyglot, 'SEC-PHP-UNSERIALIZE'), 'deserialisation PHP');
});

test('securite : XSS et configuration', () => {
  assert.ok(has(demo, 'SEC-INNERHTML'));
  assert.ok(has(demo, 'SEC-CORS-WILDCARD'));
  assert.ok(has(demo, 'SEC-JWT-NONE'));
  assert.ok(has(demo, 'SEC-PATH-TRAVERSAL'));
});

test('securite : le commentaire de suppression fonctionne', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'eval(x);\n');
  fs.writeFileSync(path.join(dir, 'b.js'), '// argus-disable-next-line\neval(x);\n');

  const result = await scan(dir, { categories: ['security'] });
  const fichiers = result.findings.filter((f) => f.ruleId === 'SEC-EVAL').map((f) => f.file);
  assert.deepEqual(fichiers, ['a.js'], 'seul le fichier non supprime doit remonter');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----------------------------------------------------------------- Routes

test('routes : extraction multi-frameworks', () => {
  const patterns = polyglot.routes.map((r) => `${r.framework} ${r.method} ${r.pattern}`);
  assert.ok(patterns.includes('flask GET /search'), 'route Flask manquante');
  assert.ok(patterns.includes('spring POST /api/utilisateurs'), 'route Spring manquante');
  assert.ok(patterns.includes('laravel GET /produits/{id}'), 'route Laravel manquante');
  assert.ok(patterns.includes('go_router PAGE /profil'), 'route go_router manquante');
});

test('routes : liens morts et ressources manquantes', () => {
  const casse = demo.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK');
  assert.ok(casse.some((f) => f.data.target === '/page-qui-nexiste-pas'));
  assert.ok(has(demo, 'ROUTE-MISSING-ASSET'), 'image inexistante non detectee');
});

test('routes : un lien valide ne remonte pas', () => {
  const casse = demo.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK').map((f) => f.data.target);
  assert.ok(!casse.includes('/tarifs'), '/tarifs existe (tarifs.html) et ne doit pas etre signale');
  assert.ok(!casse.includes('https://exemple.com'), 'les liens externes ne sont pas verifies hors ligne');
});

test('routes : doublons et absence de page 404', () => {
  assert.ok(has(demo, 'ROUTE-DUPLICATE'));
  assert.ok(has(demo, 'ROUTE-NO-404'));
  assert.ok(has(demo, 'ROUTE-TARGET-BLANK'));
});

// -------------------------------------------------------------------- SEO

test('seo : diagnostics on-page', () => {
  for (const rule of ['SEO-DESC-MISSING', 'SEO-LANG-MISSING', 'SEO-VIEWPORT-MISSING', 'SEO-IMG-ALT-MISSING', 'SEO-CANONICAL-MISSING', 'SEO-OG-MISSING', 'SEO-STRUCTURED-DATA', 'SEO-HEADING-SKIP', 'SEO-ANCHOR-GENERIC']) {
    assert.ok(has(demo, rule), `regle ${rule} attendue`);
  }
});

test('seo : titre et hierarchie de titres', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'sans-h1.html'), '<!doctype html><html lang="fr"><head><title>x</title></head><body><h2>Section</h2></body></html>');
  fs.writeFileSync(path.join(dir, 'sans-titre.html'), '<!doctype html><html lang="fr"><head></head><body><h1>Titre</h1></body></html>');

  const result = await scan(dir, { categories: ['seo'] });
  const parFichier = (rule) => result.findings.filter((f) => f.ruleId === rule).map((f) => f.file);
  assert.deepEqual(parFichier('SEO-H1-MISSING'), ['sans-h1.html']);
  assert.deepEqual(parFichier('SEO-TITLE-MISSING'), ['sans-titre.html']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('seo : fichiers de crawl manquants', () => {
  assert.ok(has(demo, 'SEO-ROBOTS-MISSING'));
  assert.ok(has(demo, 'SEO-SITEMAP-MISSING'));
});

test('seo : titres dupliques entre pages', () => {
  const doublon = at(demo, 'SEO-TITLE-DUPLICATED-PAGES');
  assert.ok(doublon, 'les deux pages partagent le titre "Accueil"');
  assert.equal(doublon.data.pages.length, 2);
});

test('seo : le h1 present n\'est pas signale sur la bonne page', () => {
  const manquants = demo.findings.filter((f) => f.ruleId === 'SEO-H1-MISSING').map((f) => f.file);
  assert.ok(!manquants.includes('tarifs.html'), 'tarifs.html a bien un h1');
});

// ------------------------------------------------------- Design & a11y

test('design : contraste et accessibilite', () => {
  const contraste = at(demo, 'A11Y-CONTRAST');
  assert.ok(contraste, 'contraste insuffisant non detecte');
  assert.ok(contraste.data.ratio < 4.5);
  assert.ok(contraste.suggestion.includes('#'), 'la suggestion doit proposer une couleur concrete');

  for (const rule of ['A11Y-INPUT-NO-LABEL', 'A11Y-NO-ACCESSIBLE-NAME', 'A11Y-CLICKABLE-DIV', 'A11Y-FOCUS-REMOVED', 'A11Y-TABLE-NO-HEADERS']) {
    assert.ok(has(demo, rule), `regle ${rule} attendue`);
  }
});

test('design : coherence du systeme de design', () => {
  assert.ok(has(demo, 'DESIGN-TYPE-SCALE'));
  assert.ok(has(demo, 'DESIGN-ZINDEX-CHAOS'));
  assert.ok(has(demo, 'DESIGN-NO-TOKENS'));
  assert.ok(has(demo, 'DESIGN-FIXED-WIDTH'));
});

test('design : le balisage cite dans du JavaScript est ignore', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'gabarit.js'), 'const modele = `<button></button><a>x</a>`;\nexport default modele;\n');
  const result = await scan(dir, { categories: ['design'] });
  assert.equal(result.findings.length, 0, `faux positifs : ${result.findings.map((f) => f.ruleId).join(', ')}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

// -------------------------------------------------------------- Code mort

test('code mort : fichiers, exports et code inatteignable', () => {
  assert.ok(has(demo, 'DEAD-FILE'));
  assert.ok(has(demo, 'DEAD-UNREACHABLE'));
  assert.ok(has(demo, 'DEAD-IMPORT'));
  assert.ok(has(demo, 'DEAD-COMMENTED-CODE'));
});

test('code mort : un symbole seulement interpole reste vivant', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'index.js'), 'const VERSION = "1.0";\nconsole.log(`v${VERSION}`);\n');
  const result = await scan(dir, { categories: ['deadcode'] });
  assert.ok(!result.findings.some((f) => f.data?.symbol === 'VERSION'), 'VERSION est utilise dans un gabarit');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('code mort : un gestionnaire decore n\'est pas mort', () => {
  const morts = polyglot.findings.filter((f) => f.ruleId === 'DEAD-EXPORT').map((f) => f.data.symbol);
  assert.ok(!morts.includes('home'), 'une vue Flask decoree est appelee par le framework');
  assert.ok(!morts.includes('liste'), 'une methode Spring annotee est appelee par le framework');
  assert.ok(morts.includes('fonction_jamais_appelee'), 'la vraie fonction morte doit remonter');
});

// ------------------------------------------------------- Perf & dependances

test('performance : ressources et anti-patterns', () => {
  assert.ok(has(demo, 'PERF-BLOCKING-SCRIPT'));
  assert.ok(has(demo, 'PERF-AWAIT-IN-LOOP'));
  assert.ok(has(demo, 'PERF-MOMENT'));
});

test('dependances : versions vulnerables et paquets abandonnes', () => {
  const vulnerables = demo.findings.filter((f) => f.ruleId === 'DEP-VULNERABLE').map((f) => f.data.package);
  assert.ok(vulnerables.includes('lodash'));
  assert.ok(vulnerables.includes('express'));
  assert.ok(has(demo, 'DEP-DEPRECATED'));
  assert.ok(has(polyglot, 'DEP-VULNERABLE'), 'les dependances Python sont aussi verifiees');
});

// ------------------------------------------------------------- Filtrage

test('configuration : filtrage par categorie', async () => {
  const result = await scan(DEMO, { categories: ['seo'] });
  assert.ok(result.findings.length > 0);
  assert.ok(result.findings.every((f) => f.category === 'seo'));
});

test('configuration : seuil de gravite minimal', async () => {
  const result = await scan(DEMO, { minSeverity: 'high' });
  assert.ok(result.findings.every((f) => ['critical', 'high'].includes(f.severity)));
  assert.ok(result.suppressed > 0);
});

test('configuration : desactivation de regles par prefixe', async () => {
  const result = await scan(DEMO, { disabledRules: ['SEC-'] });
  assert.ok(!result.findings.some((f) => f.ruleId.startsWith('SEC-')));
});

test('configuration : surcharge de gravite', async () => {
  const result = await scan(DEMO, { ruleSeverity: { 'SEO-TITLE-SHORT': 'critical' } });
  const finding = result.findings.find((f) => f.ruleId === 'SEO-TITLE-SHORT');
  assert.equal(finding.severity, 'critical');
});

test('configuration : la baseline masque les problemes connus', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'eval(danger);\n');

  const avant = await scan(dir, { categories: ['security'] });
  assert.ok(avant.findings.length > 0);

  writeBaseline(loadConfig(dir), avant.findings);
  const apres = await scan(dir, { categories: ['security'] });
  assert.equal(apres.findings.length, 0, 'tout doit etre masque par la baseline');
  assert.equal(apres.suppressed, avant.findings.length);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------- Rapports

test('rapport HTML : autonome et donnees exploitables', () => {
  const html = renderHtml(demo);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/<script[^>]+src=/.test(html), 'aucune ressource externe : le rapport doit fonctionner hors ligne');
  assert.ok(html.includes('lang="fr"'));

  const payload = /<script type="application\/json" id="argus-data">([\s\S]*?)<\/script>/.exec(html);
  const data = JSON.parse(payload[1]);
  assert.equal(data.findings.length, demo.findings.length);
  assert.equal(data.scores.global, demo.scores.global);
});

test('rapport HTML : texte lisible sur les pastilles de couleur, dans les deux themes', () => {
  const html = renderHtml(demo);

  // Regression vecue : la note etait affichee en #0e1117 sur une pastille
  // coloree. En theme clair, ces teintes sont foncees — le texte devenait
  // illisible (3,5:1, sous le minimum WCAG de 4,5:1).
  assert.ok(!/;color:#[0-9a-f]{3,8}/i.test(html), 'aucune couleur de texte ne doit etre codee en dur sur un fond colore');
  assert.ok(html.includes('color:var(--on-accent)'), 'la pastille de note doit utiliser --on-accent');
  assert.match(html, /--on-accent: #0e1117/, 'valeur du theme sombre absente');
  assert.match(html, /--on-accent: #ffffff/, 'valeur du theme clair absente');

  // Regression vecue : les cartes de categorie sont des <button>. La couleur
  // d'un bouton n'est pas heritee par defaut — sans `color: inherit`, l'agent
  // utilisateur impose du noir, illisible en theme sombre.
  assert.match(html, /button\s*\{[^}]*color:\s*inherit/, 'le reset des boutons doit forcer color: inherit');
  assert.match(html, /\.cat\s*\{[^}]*color:\s*var\(--text\)/, 'les cartes doivent fixer explicitement leur couleur de texte');

  // Verification du contraste reel, avec le module de couleur d'Argus.
  const themeClair = { texte: '#ffffff', fonds: ['#1a7f37', '#9a6700', '#cf222e'] };
  const themeSombre = { texte: '#0e1117', fonds: ['#3fd07f', '#ffc148', '#ff5c5c'] };
  for (const { texte, fonds } of [themeClair, themeSombre]) {
    for (const fond of fonds) {
      const ratio = contrastRatio(texte, fond);
      assert.ok(ratio >= 4.5, `contraste insuffisant : ${texte} sur ${fond} = ${ratio}:1`);
    }
  }
});

test('rapport SARIF : conforme au schema attendu', () => {
  const sarif = JSON.parse(renderSarif(demo));
  assert.equal(sarif.version, '2.1.0');
  const run = sarif.runs[0];
  assert.equal(run.tool.driver.name, 'Argus');
  assert.ok(run.tool.driver.rules.length > 0);
  assert.equal(run.results.length, demo.findings.length);
  for (const resultat of run.results) {
    assert.ok(['error', 'warning', 'note'].includes(resultat.level));
    assert.ok(resultat.locations[0].physicalLocation.artifactLocation.uri);
  }
});

test('rapport Markdown et compact', () => {
  const markdown = renderMarkdown(demo);
  assert.ok(markdown.includes('# Rapport d\'analyse'));
  assert.ok(markdown.includes('## Plan d\'action'));

  const compact = renderCompact(demo).trim().split('\n');
  assert.equal(compact.length, demo.findings.length);
  assert.match(compact[0], /^.+:\d+: \[\w+\] [A-Z]/);
});

// -------------------------------------------------------------- Serveur

test('serveur : sert le rapport et l\'API', async () => {
  const server = await startServer(loadConfig(DEMO), { port: 0 });
  try {
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    const html = await page.text();
    assert.ok(html.includes('argus-rescan'), 'les controles du mode serveur doivent etre injectes');

    const api = await fetch(`${server.url}/api/report`);
    const rapport = await api.json();
    assert.equal(rapport.scores.global, demo.scores.global);

    const sante = await (await fetch(`${server.url}/health`)).json();
    assert.equal(sante.status, 'ok');

    const inconnu = await fetch(`${server.url}/inexistant`);
    assert.equal(inconnu.status, 404);
  } finally {
    server.close();
  }
});

// ------------------------------------------------------------- Robustesse

test('robustesse : un dossier vide ne provoque pas d\'erreur', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  const result = await scan(dir);
  assert.equal(result.findings.length, 0);
  assert.equal(result.scores.global, 100);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('robustesse : fichiers malformes ou binaires', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.writeFileSync(path.join(dir, 'casse.json'), '{ ceci n\'est pas du json');
  fs.writeFileSync(path.join(dir, 'casse.html'), '<div><p>non ferme <img src=');
  fs.writeFileSync(path.join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  fs.writeFileSync(path.join(dir, 'vide.js'), '');

  const result = await scan(dir);
  assert.equal(result.errors.length, 0, `erreurs : ${JSON.stringify(result.errors)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('robustesse : les exclusions sont respectees', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-'));
  fs.mkdirSync(path.join(dir, 'node_modules/paquet'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'legacy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/paquet/index.js'), 'eval(a);\n');
  fs.writeFileSync(path.join(dir, 'legacy/vieux.js'), 'eval(b);\n');
  fs.writeFileSync(path.join(dir, 'index.js'), 'eval(c);\n');

  const result = await scan(dir, { categories: ['security'], ignore: ['legacy/**'] });
  const fichiers = result.findings.filter((f) => f.ruleId === 'SEC-EVAL').map((f) => f.file);
  assert.deepEqual(fichiers, ['index.js']);
  fs.rmSync(dir, { recursive: true, force: true });
});
