import { lineIndexFor, maskedSource, matches } from '../../core/scan.js';

/**
 * React Native.
 *
 * Le piege dominant est le stockage : `AsyncStorage` porte un nom rassurant
 * mais ecrit en clair dans le bac a sable de l'application. Sur un appareil
 * root ou jailbreake — et dans toute sauvegarde non chiffree — le contenu se
 * lit sans effort. Un jeton d'authentification n'y a pas sa place ; le
 * trousseau du systeme (Keychain / Keystore) existe pour cela.
 */
const STOCKAGE = /\b(?:AsyncStorage|SecureStore|EncryptedStorage|MMKV)\s*\.\s*(?:setItem|setItemAsync|set|setString)\s*\(\s*(['"`])([^'"`]+)\1/g;
const CLE_SENSIBLE = /(token|jwt|secret|password|passwd|credential|refresh|session|auth|api_?key|apikey)/i;
const STOCKAGE_SUR = /EncryptedStorage|SecureStore|react-native-keychain|Keychain/;

export default {
  id: 'react-native',
  label: 'React Native',
  appliesTo: (context) => context.has('react-native', 'expo'),

  run(context, report) {
    for (const file of context.sources()) {
      if (file.family !== 'js') continue;
      const index = lineIndexFor(file);
      const brut = file.content;

      for (const m of matches(brut, STOCKAGE)) {
        const cle = m[2];
        if (!CLE_SENSIBLE.test(cle)) continue;
        // Le stockage chiffre est precisement la reponse attendue.
        if (STOCKAGE_SUR.test(m[0])) continue;
        const position = index.position(m.index);

        report({
          ruleId: 'RN-STOCKAGE-NON-CHIFFRE',
          severity: 'high',
          title: 'Jeton ecrit dans un stockage non chiffre',
          message: `« ${cle} » est enregistre via AsyncStorage, qui ecrit en clair dans le bac a sable de l'application. Sur un appareil root, jailbreake, ou via une sauvegarde non chiffree, la valeur se lit sans effort.`,
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Passez par le trousseau du systeme : react-native-keychain, expo-secure-store ou react-native-encrypted-storage. AsyncStorage reste bon pour les preferences d\'affichage.',
          effort: 'moyen',
          tags: ['CWE-922', 'M9'],
          docs: 'https://reactnative.dev/docs/security#storing-sensitive-info',
        });
      }

      // WebView : charger une URL distante avec le JavaScript actif et l'acces
      // fichier ouvert, c'est offrir au contenu distant la lecture du disque.
      const masque = maskedSource(file);
      if (!/WebView/.test(masque)) continue;
      for (const m of matches(brut, /allowFileAccess(?:FromFileURLs|FromFileURLs)?\s*=\s*\{?\s*true/g)) {
        const position = index.position(m.index);
        report({
          ruleId: 'RN-WEBVIEW-ACCES-FICHIER',
          severity: 'high',
          title: 'WebView avec acces au systeme de fichiers',
          message:
            'Cette WebView autorise le contenu charge a lire le systeme de fichiers de l\'application. Combine a une URL distante ou a une redirection non maitrisee, cela expose la base de donnees locale et les jetons stockes.',
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Laissez allowFileAccess a false. Si la WebView doit afficher du contenu local, servez-le depuis les assets empaquetes et restreignez la navigation avec onShouldStartLoadWithRequest.',
          effort: 'moyen',
          tags: ['CWE-668'],
        });
      }
    }
  },
};
