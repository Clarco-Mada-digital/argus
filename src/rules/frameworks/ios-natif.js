import { lineIndexFor, maskedSource, matches } from '../../core/scan.js';

/**
 * iOS natif — Swift et Objective-C.
 *
 * `UserDefaults` est le pendant exact de SharedPreferences : un fichier
 * plist en clair dans le conteneur de l'application. Le trousseau existe a
 * cote pour ce qui doit rester secret — mais il a lui aussi son piege, sous
 * la forme d'un niveau d'accessibilite trop large.
 */
const CLE_SENSIBLE = /(token|jwt|secret|password|passwd|mot_?de_?passe|credential|refresh|session|auth|api_?key|apikey|pin)/i;

export default {
  id: 'ios-natif',
  label: 'iOS natif (Swift, Objective-C)',
  appliesTo: (context) =>
    context.cible('mobile') ||
    (context.byLanguage.get('swift') || []).length > 0,

  run(context, report) {
    for (const file of context.sources()) {
      if (file.language !== 'swift' && file.language !== 'objective-c') continue;
      const index = lineIndexFor(file);
      const brut = file.content;
      const masque = maskedSource(file);

      const emettre = (constat, offset) => {
        const position = index.position(offset);
        report({
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          effort: 'moyen',
          ...constat,
        });
      };

      for (const m of matches(brut, /UserDefaults[^\n]*?\.set\s*\([^)]*?forKey:\s*"([^"]+)"/g)) {
        if (!CLE_SENSIBLE.test(m[1])) continue;
        emettre(
          {
            ruleId: 'IOS-USERDEFAULTS-SECRET',
            severity: 'high',
            title: 'Secret dans UserDefaults',
            message: `« ${m[1] }» est enregistre dans UserDefaults, ecrit en clair dans un fichier plist du conteneur de l'application. Il ressort tel quel d'une sauvegarde iTunes ou iCloud non chiffree.`,
            suggestion:
              'Rangez la valeur dans le trousseau (Keychain Services, ou une surcouche comme KeychainAccess). UserDefaults convient au theme choisi ou au dernier onglet ouvert.',
            tags: ['CWE-922', 'M9'],
            docs: 'https://developer.apple.com/documentation/security/keychain-services',
          },
          m.index,
        );
      }

      for (const m of matches(masque, /kSecAttrAccessibleAlways(?:ThisDeviceOnly)?/g)) {
        emettre(
          {
            ruleId: 'IOS-TROUSSEAU-TOUJOURS-ACCESSIBLE',
            severity: 'medium',
            title: 'Element du trousseau lisible appareil verrouille',
            message:
              'kSecAttrAccessibleAlways rend l\'element lisible meme lorsque l\'appareil est verrouille, donc sans que le code de deverrouillage soit jamais entre. Apple a deprecie cette constante pour cette raison.',
            suggestion:
              'Passez a kSecAttrAccessibleWhenUnlockedThisDeviceOnly, ou a kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly si un traitement en arriere-plan doit y acceder apres redemarrage.',
            effort: 'rapide',
            tags: ['CWE-311'],
          },
          m.index,
        );
      }

      // La validation TLS se contourne ici en repondant a la demande
      // d'authentification par le trust propose, sans jamais l'evaluer.
      if (/didReceive\s+challenge|URLAuthenticationChallenge/.test(masque)) {
        for (const m of matches(masque, /URLCredential\s*\(\s*trust:/g)) {
          // SecTrustEvaluateWithError signale une evaluation reelle du trust.
          if (/SecTrustEvaluate(?:WithError)?/.test(masque)) continue;
          emettre(
            {
              ruleId: 'IOS-TLS-NON-EVALUE',
              severity: 'critical',
              title: 'Certificat serveur accepte sans evaluation',
              message:
                'La demande d\'authentification est resolue en renvoyant directement le trust propose par le serveur, sans jamais l\'evaluer. N\'importe quel certificat est donc accepte, y compris celui d\'un intercepteur.',
              suggestion:
                'Evaluez le trust avec SecTrustEvaluateWithError avant de construire l\'identifiant, et repondez .cancelAuthenticationChallenge en cas d\'echec. Pour de l\'epinglage, comparez la clef publique apres evaluation.',
              tags: ['CWE-295', 'A02:2021'],
              docs: 'https://developer.apple.com/documentation/security/preventing-insecure-network-connections',
            },
            m.index,
          );
        }
      }
    }
  },
};
