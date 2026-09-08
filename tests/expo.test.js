import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../src/index.js';

/**
 * Retour d'une equipe apres usage sur BASY EKY, deux applications React Native
 * / Expo SDK 54. Leur releve distingue soigneusement ce qui etait vrai — huit
 * fichiers morts et treize `console.log` reellement supprimes — de ce qui ne
 * l'etait pas. Ce fichier fige la seconde categorie.
 */

function projetExpo(fichiers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-expo-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'basy-eky',
      version: '1.0.0',
      main: 'expo-router/entry',
      dependencies: {
        expo: '~54.0.0',
        'expo-router': '~4.0.0',
        react: '19.0.0',
        'react-native': '0.79.0',
      },
    }),
  );

  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const complet = path.join(dir, chemin);
    fs.mkdirSync(path.dirname(complet), { recursive: true });
    fs.writeFileSync(complet, contenu);
  }
  return dir;
}

const ECRAN = (nom) => `import React from 'react';\nexport default function ${nom}() { return null; }\n`;

test('expo : les conventions du routeur de fichiers sont comprises', async () => {
  // Vingt-cinq navigations signalees comme mortes, alors que chaque fichier
  // cible existait. Trois conventions manquaient : les groupes entre
  // parentheses, `_layout`, et les routes prefixees de `+`.
  const dir = projetExpo({
    'app/_layout.tsx': [
      "import React from 'react';",
      "import { router } from 'expo-router';",
      '',
      'export function ouvrir() { router.push(\'/modal\'); }',
      'export function accueil() { router.replace(\'/home\'); }',
    ].join('\n'),

    'app/+not-found.tsx': [
      "import React from 'react';",
      "import { Link } from 'expo-router';",
      'export default function NotFound() { return <Link href="/">Accueil</Link>; }',
    ].join('\n'),

    'app/(tabs)/settings.tsx': [
      "import React from 'react';",
      "import { router } from 'expo-router';",
      'export default function Settings() {',
      "  router.push('/(auth)/login');",
      "  router.push('/settings/profile');",
      "  router.push('/list?initialStatus=pending');",
      '  return null;',
      '}',
    ].join('\n'),

    'app/index.tsx': ECRAN('Index'),
    'app/home.tsx': ECRAN('Home'),
    'app/modal.tsx': ECRAN('Modal'),
    'app/(tabs)/list.tsx': ECRAN('List'),
    'app/(auth)/login.tsx': ECRAN('Login'),
    'app/settings/profile.tsx': ECRAN('Profile'),
  });

  const rapport = await scan(dir, { noHistory: true });

  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK').map((f) => f.snippet),
    [],
    'chaque cible existe : groupe, sous-dossier, parametres de requete',
  );

  // Les groupes ne sont pas des segments d'URL, `_layout` et `+not-found`
  // ne sont pas des ecrans.
  const chemins = rapport.routes.map((r) => r.pattern).sort();
  assert.deepEqual(chemins, [
    '/', '/home', '/list', '/login', '/modal', '/settings', '/settings/profile',
  ]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : une cible inexistante reste signalee', async () => {
  // Le correctif ne doit pas revenir a se taire : sans routes extraites, une
  // vraie faute de frappe passait inapercue.
  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'app/index.tsx': [
      "import React from 'react';",
      "import { router } from 'expo-router';",
      "export default function Index() { router.push('/reglages'); return null; }",
    ].join('\n'),
    'app/settings.tsx': ECRAN('Settings'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const morts = rapport.findings.filter((f) => f.ruleId === 'ROUTE-BROKEN-LINK');

  assert.equal(morts.length, 1, '/reglages n\'existe pas, /settings oui');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : import React inutile avec le transform automatique', async () => {
  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'app/ecran.tsx': [
      "import React from 'react';",
      "import { View, Text } from 'react-native';",
      '',
      'export default function Ecran() { return <View />; }',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const morts = rapport.findings.filter((f) => f.ruleId === 'DEAD-IMPORT').map((f) => f.data.symbol);

  // `React` est inutile mais inoffensif ; `Text` est reellement mort.
  assert.deepEqual(morts, ['Text']);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : une clef nommee continue n\'est pas une sortie de boucle', async () => {
  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'constants/Translations.ts': [
      'export const fr = {',
      "  accueil: 'Accueil',",
      "  continue: 'Continuer',",
      "  retour: 'Retour',",
      '};',
    ].join('\n'),
    'components/vraiMort.ts': [
      'export function f(xs) {',
      '  for (const x of xs) {',
      '    continue;',
      '    console.log(x);',
      '  }',
      '  return 1;',
      "  console.log('mort');",
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'DEAD-UNREACHABLE');

  assert.deepEqual(
    constats.map((f) => path.basename(f.file)),
    ['vraiMort.ts', 'vraiMort.ts'],
    'le dictionnaire est du texte, la boucle est du code',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : dangerouslySetInnerHTML sur une constante locale', async () => {
  // `+html.tsx` est le motif que la documentation Expo recommande pour le
  // theme sombre sur le web : du CSS constant, declare juste au-dessus.
  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'app/+html.tsx': [
      "import React from 'react';",
      '',
      'const responsiveBackground = `',
      '  body { background-color: #fff; }',
      '`;',
      '',
      'export default function Root({ children }) {',
      '  return <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />;',
      '}',
    ].join('\n'),
    'components/Fiche.tsx': [
      "import React from 'react';",
      'export default function Fiche({ description }) {',
      '  return <div dangerouslySetInnerHTML={{ __html: description }} />;',
      '}',
    ].join('\n'),
  });

  const rapport = await scan(dir, { noHistory: true });
  const constats = rapport.findings.filter((f) => f.ruleId === 'SEC-DANGEROUS-HTML');

  assert.equal(constats.length, 1, 'seule la valeur venue d\'une prop compte');
  assert.match(constats[0].file, /Fiche\.tsx$/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : une feuille de styles n\'est pas du code duplique', async () => {
  const ecran = (nom) => [
    "import { StyleSheet, View } from 'react-native';",
    '',
    `export default function ${nom}() {`,
    "  const styles = getStyles('clair');",
    '  return <View style={styles.conteneur} />;',
    '}',
    '',
    'const getStyles = (theme) =>',
    '  StyleSheet.create({',
    "    conteneur: { flex: 1, padding: 16, backgroundColor: '#fff' },",
    "    titre: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: '#111' },",
    "    champ: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12 },",
    "    bouton: { backgroundColor: '#0a7', paddingVertical: 14, borderRadius: 8 },",
    "    texteBouton: { color: '#fff', textAlign: 'center', fontWeight: '600' },",
    '  });',
  ].join('\n');

  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'app/signalement-anonyme.tsx': ecran('Anonyme'),
    'app/signalement-identifie.tsx': ecran('Identifie'),
  });

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'QUAL-DUPLICATION').map((f) => `${f.file}:${f.line}`),
    [],
    'deux ecrans qui posent flex:1 partagent une convention, pas du code',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('expo : une surcouche de plateforme n\'est jamais importee sous son nom', async () => {
  const dir = projetExpo({
    'app/_layout.tsx': ECRAN('Layout'),
    'components/notifier.android.ts': "export function notifier() { return 'android'; }\n",
    'components/notifier.ios.ts': "export function notifier() { return 'ios'; }\n",
  });

  const rapport = await scan(dir, { noHistory: true });
  assert.deepEqual(
    rapport.findings.filter((f) => f.ruleId === 'DEAD-FILE').map((f) => f.file),
    [],
    'l\'empaqueteur choisit la variante selon la cible',
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
