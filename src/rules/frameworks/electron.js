import { lineIndexFor, maskedSource, matches } from '../../core/scan.js';

/**
 * Electron.
 *
 * Le processus de rendu affiche du HTML ; s'il dispose aussi de Node, alors
 * toute XSS devient une execution de code sur la machine. C'est pour cela
 * qu'Electron a inverse ses valeurs par defaut au fil des versions. Les
 * projets qui les reactivent le font presque toujours par confort — un
 * `require` dans le renderer — et la dette reste.
 */
const REGLAGES = [
  {
    cle: 'nodeIntegration',
    valeur: 'true',
    id: 'ELECTRON-NODE-INTEGRATION',
    severity: 'critical',
    title: 'Node.js accessible depuis le processus de rendu',
    message:
      'Avec nodeIntegration, la page dispose de `require`, donc de `child_process` et de `fs`. Toute injection de script — une dependance compromise, un contenu distant, une chaine mal echappee — devient une execution de code arbitraire sur la machine de l\'utilisateur.',
    suggestion:
      'Laissez nodeIntegration a false et exposez ce dont l\'interface a besoin via un script de preload et `contextBridge.exposeInMainWorld`, en n\'exposant que des fonctions precises plutot que des modules entiers.',
    cwe: 'CWE-94',
  },
  {
    cle: 'contextIsolation',
    valeur: 'false',
    id: 'ELECTRON-CONTEXT-ISOLATION',
    severity: 'critical',
    title: 'Isolation du contexte desactivee',
    message:
      'Sans isolation, le script de preload et la page partagent le meme contexte JavaScript : la page peut redefinir les prototypes qu\'utilise votre preload et detourner ce qu\'il expose. C\'est la faille classique du « prototype pollution » cote Electron.',
    suggestion: 'Remettez contextIsolation a true et faites transiter les echanges par contextBridge.',
    cwe: 'CWE-1188',
  },
  {
    cle: 'webSecurity',
    valeur: 'false',
    id: 'ELECTRON-WEB-SECURITY',
    severity: 'high',
    title: 'Politique de meme origine desactivee',
    message:
      'webSecurity: false supprime la politique de meme origine. La page peut lire n\'importe quelle URL distante et n\'importe quel fichier local. C\'est souvent ajoute pour contourner une erreur CORS en developpement, puis oublie.',
    suggestion:
      'Retirez ce reglage et reglez le CORS a la source : servez les fichiers via un protocole personnalise (`protocol.handle`) ou faites passer les requetes par le processus principal.',
    cwe: 'CWE-346',
  },
  {
    cle: 'allowRunningInsecureContent',
    valeur: 'true',
    id: 'ELECTRON-CONTENU-NON-SUR',
    severity: 'high',
    title: 'Contenu non chiffre autorise dans une page HTTPS',
    message:
      'La fenetre accepte de charger scripts et styles en HTTP depuis une page HTTPS. Un intercepteur reseau peut alors remplacer ce contenu, et le script obtenu s\'execute avec les privileges de la page.',
    suggestion: 'Retirez ce reglage et servez toutes les ressources en HTTPS.',
    cwe: 'CWE-311',
  },
];

export default {
  id: 'electron',
  label: 'Electron',
  appliesTo: (context) => context.has('electron'),

  run(context, report) {
    for (const file of context.sources()) {
      if (file.family !== 'js') continue;
      const masque = maskedSource(file);
      if (!/BrowserWindow|webPreferences/.test(masque)) continue;
      const index = lineIndexFor(file);

      for (const reglage of REGLAGES) {
        const motif = new RegExp(`\\b${reglage.cle}\\s*:\\s*${reglage.valeur}\\b`, 'g');
        for (const m of matches(masque, motif)) {
          const position = index.position(m.index);
          report({
            ruleId: reglage.id,
            severity: reglage.severity,
            title: reglage.title,
            message: reglage.message,
            file: file.relativePath,
            line: position.line,
            column: position.column,
            snippet: index.textOfLine(position.line).trim(),
            suggestion: reglage.suggestion,
            effort: 'moyen',
            tags: [reglage.cwe],
            docs: 'https://www.electronjs.org/docs/latest/tutorial/security',
          });
        }
      }
    }
  },
};
