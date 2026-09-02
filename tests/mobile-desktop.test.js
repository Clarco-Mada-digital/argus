import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scan } from '../src/index.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const analyser = (nom) => scan(path.join(FIXTURES, nom), { noHistory: true });
const ids = (rapport) => rapport.findings.map((f) => f.ruleId);

test('react native : jeton en clair, WebView ouverte, manifestes natifs', async () => {
  const rapport = await analyser('reactnative');
  const trouves = ids(rapport);

  for (const attendu of [
    'RN-STOCKAGE-NON-CHIFFRE',
    'RN-WEBVIEW-ACCES-FICHIER',
    'MOBILE-TRAFIC-EN-CLAIR',
    'MOBILE-DEBUGGABLE',
    'MOBILE-SAUVEGARDE-OUVERTE',
    'MOBILE-ATS-DESACTIVE',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }

  // Les deux jetons sont signales, la preference d'affichage ne l'est pas.
  assert.equal(trouves.filter((id) => id === 'RN-STOCKAGE-NON-CHIFFRE').length, 2);
});

test('une application mobile n\'est pas un site : aucun constat SEO', async () => {
  const rapport = await analyser('reactnative');
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId.startsWith('SEO-')),
    [],
    'React Native depend de react — sans notion de plateforme, le SEO le prenait pour une SPA',
  );
  assert.ok(rapport.project.platforms?.includes('mobile'));
  assert.ok(!rapport.project.platforms?.includes('web'));
});

test('flutter : SharedPreferences et validation TLS', async () => {
  const rapport = await analyser('flutter');
  const trouves = ids(rapport);

  assert.ok(trouves.includes('FLUTTER-TLS-DESACTIVE'));
  // « auth_token » et « refresh_token » oui ; « theme » et « dernier_onglet » non.
  assert.equal(trouves.filter((id) => id === 'FLUTTER-PREFS-NON-CHIFFRE').length, 2);
  // Ce manifeste-ci est correct : allowBackup="false", pas de debuggable.
  assert.deepEqual(trouves.filter((id) => id.startsWith('MOBILE-')), []);
});

test('tauri : allowlist totale, shell, CSP, IPC distant', async () => {
  const trouves = ids(await analyser('tauri'));
  for (const attendu of [
    'TAURI-ALLOWLIST-TOTALE',
    'TAURI-SHELL-OUVERT',
    'TAURI-CSP-ABSENTE',
    'TAURI-IPC-DISTANT',
    'TAURI-GLOBAL-EXPOSE',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }
});

test('electron : les quatre reglages de webPreferences', async () => {
  const rapport = await analyser('electron');
  const trouves = ids(rapport);

  for (const attendu of [
    'ELECTRON-NODE-INTEGRATION',
    'ELECTRON-CONTEXT-ISOLATION',
    'ELECTRON-WEB-SECURITY',
    'ELECTRON-CONTENU-NON-SUR',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }

  assert.ok(rapport.project.platforms.includes('desktop'));
  assert.equal(
    rapport.findings.find((f) => f.ruleId === 'ELECTRON-NODE-INTEGRATION').severity,
    'critical',
  );
});

test('aucun bruit mobile ou bureau sur les projets web', async () => {
  const web = ['django', 'laravel', 'rails', 'spring', 'express', 'nextjs', 'sveltekit', 'react'];
  for (const nom of web) {
    const trouves = ids(await analyser(nom));
    const bruit = trouves.filter((id) => /^(MOBILE|RN|FLUTTER|TAURI|ELECTRON)-/.test(id));
    assert.deepEqual(bruit, [], `${nom} ne doit recevoir aucune regle mobile ou bureau`);
  }
});

test('un pack defaillant est signale, pas avale en silence', async () => {
  const { FRAMEWORK_PACKS } = await import('../src/rules/frameworks/index.js');
  const pack = FRAMEWORK_PACKS.find((p) => p.id === 'electron');
  const original = pack.run;
  pack.run = () => {
    throw new Error('panne simulee');
  };

  try {
    const trouves = ids(await analyser('electron'));
    assert.ok(
      trouves.includes('ARGUS-PACK-EN-ECHEC'),
      'un pack qui casse doit produire un constat visible, sinon le bug reste introuvable',
    );
  } finally {
    pack.run = original;
  }
});

test('android natif : prefs, TrustManager, nom d\'hote, WebView', async () => {
  const rapport = await analyser('android-kotlin');
  const trouves = ids(rapport);

  for (const attendu of [
    'ANDROID-PREFS-NON-CHIFFRE',
    'ANDROID-TRUSTMANAGER-PERMISSIF',
    'ANDROID-HOSTNAME-NON-VERIFIE',
    'ANDROID-WEBVIEW-ACCES-FICHIER',
  ]) {
    assert.ok(trouves.includes(attendu), `${attendu} attendu`);
  }

  // « auth_token » et « refresh_token » oui ; « theme » et « dernier_onglet » non.
  assert.equal(trouves.filter((id) => id === 'ANDROID-PREFS-NON-CHIFFRE').length, 2);
  // Ce manifeste-ci est correct.
  assert.deepEqual(trouves.filter((id) => id.startsWith('MOBILE-')), []);
});

test('ios natif : UserDefaults, trousseau, evaluation du certificat', async () => {
  const trouves = ids(await analyser('ios-swift'));

  assert.ok(trouves.includes('IOS-TLS-NON-EVALUE'));
  assert.ok(trouves.includes('IOS-TROUSSEAU-TOUJOURS-ACCESSIBLE'));
  assert.equal(trouves.filter((id) => id === 'IOS-USERDEFAULTS-SECRET').length, 2);
});

test('code mort : pas de verdict sur les langages a imports par module', async () => {
  // Java, Kotlin, Go, C# et Swift importent des paquets, jamais des chemins :
  // un fichier peut etre utilise partout sans qu'aucun import ne le nomme.
  for (const nom of ['android-kotlin', 'ios-swift']) {
    const morts = (await analyser(nom)).findings.filter((f) => f.ruleId === 'DEAD-FILE');
    assert.deepEqual(morts, [], `${nom} : un graphe de fichiers ne conclut rien ici`);
  }

  // La detection reste active la ou elle est fondee.
  const site = await analyser('demo-site');
  assert.ok(site.findings.some((f) => f.ruleId === 'DEAD-FILE'));
});

test('detection : un script isole ne change pas la nature du projet', async () => {
  // Signale sur un vrai projet Expo : un unique script de publication en
  // Python suffisait a faire classer l'application en projet Python.
  const rapport = await analyser('expo');

  assert.equal(rapport.project.description, 'React Native (Expo)');
  assert.deepEqual(rapport.project.platforms, ['mobile']);
  assert.ok(
    !rapport.project.frameworks.includes('python'),
    'un script utilitaire ne fait pas un projet Python',
  );
  assert.ok(rapport.project.frameworks.includes('expo'));

  // Le fichier reste compte dans la repartition : il existe vraiment.
  assert.ok(rapport.project.stack.some((s) => s.language === 'python'));
  // Mais le JSON ne pese plus dans le classement des langages.
  assert.equal(rapport.project.stack.find((s) => s.language === 'json')?.code, false);
});

test('detection : un vrai projet Python reste un projet Python', async () => {
  const django = await analyser('django');
  assert.ok(django.project.frameworks.includes('python'));
  assert.equal(django.project.description, 'Django');
  assert.deepEqual(django.project.platforms, ['web']);
});

test('detection : chaque fixture est nommee pour ce qu\'elle est', async () => {
  const attendus = {
    flutter: ['Flutter', 'mobile'],
    tauri: ['Tauri', 'desktop'],
    electron: ['Electron', 'desktop'],
    nextjs: ['Next.js', 'web'],
    'android-kotlin': ['Android natif', 'mobile'],
    'ios-swift': ['iOS natif', 'mobile'],
  };

  for (const [nom, [description, plateforme]] of Object.entries(attendus)) {
    const rapport = await analyser(nom);
    assert.equal(rapport.project.description, description, nom);
    assert.ok(rapport.project.platforms.includes(plateforme), `${nom} : ${plateforme} attendu`);
  }
});

test('couverture : l\'outil dit ce qu\'il ne couvre pas', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-couv-'));
  fs.writeFileSync(
    pathMod.join(dir, 'package.json'),
    JSON.stringify({ name: 't', dependencies: { vue: '3.4.21', koa: '2.15.0' } }),
  );
  fs.mkdirSync(pathMod.join(dir, 'src'));
  fs.writeFileSync(pathMod.join(dir, 'src/main.js'), 'import { createApp } from "vue";\nexport default createApp({});\n');

  const rapport = await scan(dir, { noHistory: true });
  const constat = rapport.findings.find((f) => f.ruleId === 'ARGUS-COUVERTURE-PARTIELLE');

  assert.ok(constat, 'un ecosysteme sans pack doit etre annonce');
  assert.match(constat.title, /Vue/);
  assert.match(constat.title, /Koa/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('couverture : rien n\'est annonce quand le pack existe', async () => {
  // Django, Next.js et Expo ont leurs packs : signaler une couverture
  // partielle serait du bruit, et le bruit detruit la valeur du signal.
  for (const nom of ['django', 'nextjs', 'expo', 'flutter']) {
    const rapport = await analyser(nom);
    assert.ok(
      !rapport.findings.some((f) => f.ruleId === 'ARGUS-COUVERTURE-PARTIELLE'),
      `${nom} est couvert par un pack dedie`,
    );
  }
});

test('bureau : une application Electron n\'est pas un site a referencer', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  // Projet Electron moderne : electron-vite, renderer React, `electron` en
  // dependance de developpement seulement.
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-el-'));
  fs.mkdirSync(pathMod.join(dir, 'src/renderer'), { recursive: true });
  fs.writeFileSync(
    pathMod.join(dir, 'package.json'),
    JSON.stringify({
      name: 'bureau',
      main: './out/main/index.js',
      devDependencies: { 'electron-vite': '^2.0.0', 'electron-builder': '^24.9.1', react: '^18.2.0' },
    }),
  );
  fs.writeFileSync(pathMod.join(dir, 'electron-builder.yml'), 'appId: com.exemple.app\n');
  fs.writeFileSync(
    pathMod.join(dir, 'src/renderer/index.html'),
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  );
  fs.mkdirSync(pathMod.join(dir, 'src/renderer/src'), { recursive: true });
  fs.writeFileSync(pathMod.join(dir, 'src/renderer/src/main.jsx'), 'export default function App() { return null; }\n');

  const rapport = await scan(dir, { noHistory: true });

  assert.equal(rapport.project.description, 'Electron');
  assert.deepEqual(rapport.project.platforms, ['desktop']);

  // Le HTML d'une fenetre Electron n'est jamais explore par un robot.
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId.startsWith('SEO-')),
    [],
    'aucune regle SEO ne doit s\'appliquer a une application de bureau',
  );
  assert.ok(
    !rapport.findings.some((f) => f.ruleId === 'SEC-MISSING-HEADERS'),
    'des en-tetes HTTP supposent un serveur HTTP',
  );
  assert.ok(
    !rapport.findings.some((f) => f.ruleId === 'ROUTE-ORPHAN'),
    'la fenetre est chargee par loadFile(), aucun lien ne pointe vers elle',
  );
  // Vite resout `/src/main.jsx` depuis le dossier de son index.html.
  assert.ok(
    !rapport.findings.some((f) => f.ruleId === 'ROUTE-BROKEN-LINK'),
    'un chemin resolu par l\'empaqueteur n\'est pas un lien mort',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('bureau : Electron reconnu meme sans dependance declaree', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  // Cas remonte par un utilisateur : le manifeste ne declare rien, mais le
  // code appelle `require('electron')`. Le projet etait classe site statique
  // et recevait toute l'analyse SEO.
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-eln-'));
  fs.writeFileSync(
    pathMod.join(dir, 'package.json'),
    JSON.stringify({ name: 'vieille-app', main: 'main.js', scripts: { start: 'electron .' } }),
  );
  fs.writeFileSync(
    pathMod.join(dir, 'main.js'),
    "const { app, BrowserWindow } = require('electron');\napp.whenReady().then(() => new BrowserWindow({}).loadFile('index.html'));\n",
  );
  fs.writeFileSync(
    pathMod.join(dir, 'index.html'),
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>App</title></head><body><h1>Bonjour</h1></body></html>',
  );

  const rapport = await scan(dir, { noHistory: true });

  assert.equal(rapport.project.description, 'Electron');
  assert.deepEqual(rapport.project.platforms, ['desktop']);
  assert.deepEqual(rapport.findings.filter((f) => f.ruleId.startsWith('SEO-')), []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('web : des pages HTML nues restent un site a referencer', async () => {
  // Le garde-fou de la correction precedente : sans `index.html`, aucun
  // signal `static-site` n'etait pose et le SEO disparaissait d'un dossier
  // de pages parfaitement servables.
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-html-'));
  fs.writeFileSync(
    pathMod.join(dir, 'a-propos.html'),
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>x</title></head><body><h2>Section</h2></body></html>',
  );

  const rapport = await scan(dir, { noHistory: true, categories: ['seo'] });
  assert.ok(rapport.project.platforms.includes('web'));
  assert.ok(rapport.findings.some((f) => f.ruleId === 'SEO-H1-MISSING'));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('plateforme : la deduction dit sur quoi elle se fonde', async () => {
  const rapport = await analyser('expo');

  assert.equal(rapport.project.identite, 'expo');
  assert.match(
    rapport.project.preuves.expo,
    /expo/,
    'la preuve doit nommer ce qui a decide, pas rester implicite',
  );
  // La preuve affichee est celle du framework qui a donne son nom au projet,
  // pas la premiere venue : « React Native (Expo) d'apres react » serait juste
  // assez faux pour induire en erreur.
  assert.notEqual(rapport.project.preuves[rapport.project.identite], rapport.project.preuves.react);
});

test('plateforme : la configuration l\'emporte sur la deduction', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  // Une interface HTML embarquee dans une application native : rien ne permet
  // a Argus de trancher, et il conclut « site web » — donc SEO partout.
  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-plat-'));
  fs.mkdirSync(pathMod.join(dir, 'ui'));
  fs.writeFileSync(
    pathMod.join(dir, 'ui/index.html'),
    '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Outil</title></head><body><h1>Tableau</h1></body></html>',
  );

  const deduit = await scan(dir, { noHistory: true });
  assert.deepEqual(deduit.project.platforms, ['web']);
  assert.ok(deduit.findings.some((f) => f.ruleId.startsWith('SEO-')));

  // L'utilisateur tranche.
  fs.writeFileSync(pathMod.join(dir, 'argus.config.json'), JSON.stringify({ platforms: ['desktop'] }));
  const impose = await scan(dir, { noHistory: true });

  assert.deepEqual(impose.project.platforms, ['desktop']);
  assert.ok(impose.project.plateformeImposee);
  assert.deepEqual(impose.findings.filter((f) => f.ruleId.startsWith('SEO-')), []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('plateforme : une valeur invalide ne casse pas la deduction', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-plat2-'));
  fs.writeFileSync(pathMod.join(dir, 'index.html'), '<!doctype html><html lang="fr"><head><title>x</title></head><body><h1>y</h1></body></html>');
  fs.writeFileSync(pathMod.join(dir, 'argus.config.json'), JSON.stringify({ platforms: ['bureautique', 42] }));

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(rapport.project.platforms, ['web'], 'on retombe sur la deduction');
  assert.ok(!rapport.project.plateformeImposee);

  fs.rmSync(dir, { recursive: true, force: true });
});
