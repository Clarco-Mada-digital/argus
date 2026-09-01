import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Manifestes des plateformes natives — transverse.
 *
 * AndroidManifest.xml et Info.plist sont produits par React Native, Flutter,
 * Capacitor, Ionic, Kotlin et Swift natifs. Les memes reglages y ouvrent les
 * memes portes, quel que soit l'outil qui les a generes : une seule regle
 * couvre donc tout le mobile, y compris les technologies sans pack dedie.
 *
 * `usesCleartextTraffic` merite une mention : Android l'a passe a false par
 * defaut a partir d'API 28, et beaucoup de projets l'ont remis a true pour
 * joindre un serveur de test en HTTP, sans jamais revenir en arriere.
 */
const REGLES_ANDROID = [
  {
    motif: /android:usesCleartextTraffic\s*=\s*"true"/g,
    id: 'MOBILE-TRAFIC-EN-CLAIR',
    severity: 'high',
    title: 'Trafic HTTP en clair autorise',
    message:
      'L\'application accepte les connexions HTTP non chiffrees. Sur un reseau Wi-Fi partage, le contenu des requetes — jetons compris — circule lisible et modifiable. Android bloque ce trafic par defaut depuis API 28 ; ce reglage annule la protection pour tout le domaine de l\'application.',
    suggestion:
      'Retirez l\'attribut. Si un serveur de developpement doit rester en HTTP, isolez-le dans un `network_security_config.xml` limite a son domaine et applique au seul variant de debug.',
    cwe: 'CWE-319',
    docs: 'https://developer.android.com/privacy-and-security/security-config',
  },
  {
    motif: /android:debuggable\s*=\s*"true"/g,
    id: 'MOBILE-DEBUGGABLE',
    severity: 'critical',
    title: 'Application livrable en mode debogage',
    message:
      'android:debuggable="true" dans le manifeste permet a quiconque d\'attacher un debogueur au processus sur un appareil non root : lecture de la memoire, des variables, des jetons en cours d\'utilisation.',
    suggestion:
      'Supprimez l\'attribut du manifeste. Gradle le positionne deja correctement selon le type de build ; l\'ecrire a la main court-circuite ce mecanisme.',
    cwe: 'CWE-489',
  },
  {
    motif: /android:allowBackup\s*=\s*"true"/g,
    id: 'MOBILE-SAUVEGARDE-OUVERTE',
    severity: 'medium',
    title: 'Sauvegarde des donnees de l\'application autorisee',
    message:
      'allowBackup permet d\'extraire les donnees privees de l\'application via adb, sans root. Tout ce qui est ecrit en clair — preferences, base SQLite, jetons — sort avec.',
    suggestion:
      'Passez a android:allowBackup="false", ou declarez un `dataExtractionRules` qui exclut explicitement les fichiers sensibles.',
    cwe: 'CWE-530',
  },
];

export default {
  id: 'manifestes-natifs',
  label: 'Android et iOS',
  // Transverse : le manifeste natif a les memes failles quel que soit l'outil
  // qui l'a genere — React Native, Flutter, Capacitor, Kotlin ou Swift.
  appliesTo: (context) => context.cible('mobile'),

  run(context, report) {
    for (const file of context.files) {
      if (!file.readable) continue;
      const estAndroid = /(^|\/)AndroidManifest\.xml$/.test(file.relativePath);
      const estIos = /(^|\/)Info\.plist$/.test(file.relativePath);
      if (!estAndroid && !estIos) continue;

      const index = lineIndexFor(file);

      if (estAndroid) {
        for (const regle of REGLES_ANDROID) {
          for (const m of matches(file.content, regle.motif)) {
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
              effort: 'rapide',
              tags: [regle.cwe],
              docs: regle.docs || `https://cwe.mitre.org/data/definitions/${regle.cwe.replace('CWE-', '')}.html`,
            });
          }
        }
        continue;
      }

      // iOS : la cle est un element frere de sa valeur, pas un attribut.
      for (const m of matches(
        file.content,
        /<key>\s*NSAllowsArbitraryLoads\s*<\/key>\s*<true\s*\/>/g,
      )) {
        const position = index.position(m.index);
        report({
          ruleId: 'MOBILE-ATS-DESACTIVE',
          severity: 'high',
          title: 'App Transport Security desactive',
          message:
            'NSAllowsArbitraryLoads leve les exigences de transport d\'iOS pour toutes les destinations : HTTP en clair accepte, TLS ancien accepte. Apple demande une justification pour cette cle lors de la revue, ce qui indique assez sa portee.',
          file: file.relativePath,
          line: position.line,
          column: position.column,
          snippet: index.textOfLine(position.line).trim(),
          suggestion:
            'Retirez la cle. Pour un domaine precis qui ne peut pas encore passer en HTTPS, utilisez NSExceptionDomains en le limitant a ce domaine.',
          effort: 'rapide',
          tags: ['CWE-319'],
          docs: 'https://developer.apple.com/documentation/security/preventing-insecure-network-connections',
        });
      }
    }
  },
};
