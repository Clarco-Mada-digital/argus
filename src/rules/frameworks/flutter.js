import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Flutter et Dart.
 *
 * Meme piege qu'en React Native, autre nom : `SharedPreferences` est un
 * fichier XML en clair sous Android et un plist sous iOS. Le paquet
 * `flutter_secure_storage` existe pour ce qui doit rester secret.
 *
 * S'y ajoute une specialite Dart : `badCertificateCallback` qui renvoie
 * `true` desactive toute la validation TLS de l'application. On le voit
 * ecrit « en attendant » pour un certificat auto-signe de developpement,
 * puis livre tel quel.
 */
export default {
  id: 'flutter',
  label: 'Flutter',
  appliesTo: (context) => context.has('flutter'),

  run(context, report) {
    for (const file of context.sources()) {
      if (file.language !== 'dart') continue;
      const index = lineIndexFor(file);
      const brut = file.content;

      for (const m of matches(
        brut,
        /(?:prefs|preferences|sharedPreferences|_prefs)\s*[.?]*\s*set(?:String|Int|Bool|Double|StringList)\s*\(\s*(['"])([^'"]+)\1/gi,
      )) {
        const cle = m[2];
        if (!/(token|jwt|secret|password|mot_?de_?passe|credential|refresh|session|api_?key|pin)/i.test(cle)) continue;
        const position = index.position(m.index);

        report({
          ruleId: 'FLUTTER-PREFS-NON-CHIFFRE',
          severity: 'high',
          title: 'Secret dans SharedPreferences',
          message: `« ${cle} » passe par SharedPreferences, stocke en clair (XML sous Android, plist sous iOS). Rien n'y est chiffre.`,
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Utilisez flutter_secure_storage, adosse au Keystore Android et au Keychain iOS. SharedPreferences convient au theme choisi ou au dernier onglet ouvert, pas a un jeton.',
          effort: 'moyen',
          tags: ['CWE-922', 'M9'],
          docs: 'https://pub.dev/packages/flutter_secure_storage',
        });
      }

      for (const m of matches(
        brut,
        /badCertificateCallback\s*=?\s*(?:\([^)]*\)\s*(?:=>|\{)[^;}]{0,120}?\btrue\b)/g,
      )) {
        const position = index.position(m.index);
        report({
          ruleId: 'FLUTTER-TLS-DESACTIVE',
          severity: 'critical',
          title: 'Validation du certificat TLS desactivee',
          message:
            'badCertificateCallback renvoie true : l\'application accepte n\'importe quel certificat, y compris celui d\'un intercepteur sur un reseau Wi-Fi public. Le HTTPS ne protege plus rien.',
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Retirez ce rappel. Pour un certificat auto-signe en developpement, chargez-le comme autorite de confiance via SecurityContext, et uniquement en mode debug (kDebugMode).',
          effort: 'moyen',
          tags: ['CWE-295', 'A02:2021'],
          docs: 'https://cwe.mitre.org/data/definitions/295.html',
        });
      }
    }
  },
};
