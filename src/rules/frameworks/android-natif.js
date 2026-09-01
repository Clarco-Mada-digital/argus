import { lineIndexFor, maskedSource, matches } from '../../core/scan.js';

/**
 * Android natif — Kotlin et Java.
 *
 * Les memes pieges qu'en React Native ou en Flutter, mais ecrits une couche
 * plus bas : c'est ici que les outils multiplateformes finissent par appeler.
 * Les regles couvrent donc aussi bien un projet 100 % Kotlin qu'un module
 * natif greffe sur une application Flutter.
 *
 * Le TrustManager vide merite une mention. On le trouve copie depuis une
 * reponse de forum pour joindre un serveur de recette a certificat
 * auto-signe. Une methode `checkServerTrusted` au corps vide ne leve jamais
 * d'exception : par contrat, cela signifie « ce certificat est valide ».
 * Tous le sont donc, y compris celui d'un intercepteur.
 */
const CLE_SENSIBLE = /(token|jwt|secret|password|passwd|mot_?de_?passe|credential|refresh|session|auth|api_?key|apikey|pin|code_?pin)/i;

const REGLES_RESEAU = [
  {
    // Un corps vide, eventuellement avec un commentaire, mais aucune verification.
    motif: /(?:override\s+fun|public\s+void)\s+checkServerTrusted\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{\s*\}/g,
    id: 'ANDROID-TRUSTMANAGER-PERMISSIF',
    severity: 'critical',
    title: 'TrustManager acceptant tous les certificats',
    message:
      'checkServerTrusted a un corps vide. Par contrat, ne pas lever d\'exception signifie « ce certificat est valide » : l\'application accepte donc n\'importe quel certificat, y compris celui d\'un intercepteur sur un reseau Wi-Fi partage. Le HTTPS ne protege plus rien.',
    suggestion:
      'Retirez ce TrustManager. Pour un serveur de recette a certificat auto-signe, declarez l\'autorite dans un `network_security_config.xml` limite au variant de debug — la chaine reste verifiee.',
    cwe: 'CWE-295',
    docs: 'https://developer.android.com/privacy-and-security/security-ssl',
  },
  {
    motif: /(?:HostnameVerifier\s*\{[^}]*->\s*true\s*\}|fun\s+verify\s*\([^)]*\)\s*(?::\s*Boolean\s*)?(?:=\s*true|\{\s*return\s+true\s*;?\s*\}))/g,
    id: 'ANDROID-HOSTNAME-NON-VERIFIE',
    severity: 'critical',
    title: 'Nom d\'hote jamais verifie',
    message:
      'Le verificateur de nom d\'hote renvoie toujours true : un certificat valide emis pour un autre domaine est accepte. La chaine est bien verifiee, mais plus rien ne garantit que vous parlez au bon serveur.',
    suggestion:
      'Supprimez ce verificateur pour revenir a celui du systeme. Si un domaine precis doit etre tolere, comparez-le explicitement plutot que de renvoyer true.',
    cwe: 'CWE-297',
  },
  {
    motif: /\.(?:allowFileAccess|allowUniversalAccessFromFileURLs|allowFileAccessFromFileURLs)\s*=\s*true/g,
    id: 'ANDROID-WEBVIEW-ACCES-FICHIER',
    severity: 'high',
    title: 'WebView avec acces au systeme de fichiers',
    message:
      'Cette WebView autorise le contenu charge a lire les fichiers de l\'application. Combine a du JavaScript actif et a une URL distante, cela expose la base de donnees locale et les preferences — donc les jetons qui s\'y trouvent.',
    suggestion:
      'Laissez ces reglages a false. Pour afficher du contenu local, servez-le depuis les assets avec WebViewAssetLoader, et restreignez la navigation via shouldOverrideUrlLoading.',
    cwe: 'CWE-668',
  },
];

export default {
  id: 'android-natif',
  label: 'Android natif (Kotlin, Java)',
  appliesTo: (context) =>
    context.cible('mobile') ||
    (context.byLanguage.get('kotlin') || []).length > 0,

  run(context, report) {
    for (const file of context.sources()) {
      if (file.language !== 'kotlin' && file.language !== 'java') continue;
      const index = lineIndexFor(file);
      const brut = file.content;
      const masque = maskedSource(file);

      // Le nom de la cle est une chaine : il faut le brut. Le reste porte sur
      // du code, donc sur le masque, pour ne pas reagir a un commentaire.
      for (const m of matches(
        brut,
        /\.put(?:String|Int|Long|Boolean|Float|StringSet)\s*\(\s*"([^"]+)"/g,
      )) {
        if (!CLE_SENSIBLE.test(m[1])) continue;
        // EncryptedSharedPreferences est precisement la reponse attendue.
        if (/EncryptedSharedPreferences/.test(masque)) continue;
        const position = index.position(m.index);

        report({
          ruleId: 'ANDROID-PREFS-NON-CHIFFRE',
          severity: 'high',
          title: 'Secret dans SharedPreferences',
          message: `« ${m[1]} » est ecrit dans SharedPreferences, un fichier XML en clair du bac a sable de l'application. Rien n'y est chiffre : sur un appareil root, ou via une sauvegarde, la valeur se lit directement.`,
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Utilisez EncryptedSharedPreferences (androidx.security-crypto), adosse au Keystore materiel. SharedPreferences reste bon pour le theme choisi ou le dernier onglet ouvert.',
          effort: 'moyen',
          tags: ['CWE-922', 'M9'],
          docs: 'https://developer.android.com/privacy-and-security/security-tips#UserData',
        });
      }

      for (const regle of REGLES_RESEAU) {
        for (const m of matches(masque, regle.motif)) {
          const position = index.position(m.index);
          report({
            ruleId: regle.id,
            severity: regle.severity,
            title: regle.title,
            message: regle.message,
            file: file.relativePath,
            line: position.line,
            column: position.column,
            snippet: index.textOfLine(position.line).trim(),
            suggestion: regle.suggestion,
            effort: 'moyen',
            tags: [regle.cwe],
            docs: regle.docs || `https://cwe.mitre.org/data/definitions/${regle.cwe.replace('CWE-', '')}.html`,
          });
        }
      }
    }
  },
};
