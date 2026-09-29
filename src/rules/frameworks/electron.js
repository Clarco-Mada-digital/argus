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
    cle: 'sandbox',
    valeur: 'false',
    id: 'ELECTRON-SANDBOX',
    severity: 'high',
    title: 'Bac a sable du processus de rendu desactive',
    message:
      'Le bac a sable est la derniere barriere quand tout le reste a cede : meme avec nodeIntegration a false, un rendu non confine dispose des primitives d\'IPC internes d\'Electron et d\'une surface d\'attaque bien plus large sur le processus principal. Il est actif par defaut depuis Electron 20 ; le desactiver est un choix, rarement un besoin.',
    suggestion:
      'Retirez `sandbox: false`. Si votre preload a besoin de modules Node, extrayez ce travail vers le processus principal et exposez-en le resultat par `contextBridge` — un preload confine peut toujours dialoguer par IPC.',
    cwe: 'CWE-693',
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

/** Le constat, sous la forme commune du pack. */
function signaler(file, index, position, constat) {
  return {
    file: file.relativePath,
    line: position.line,
    column: position.column,
    snippet: index.textOfLine(position.line).trim(),
    effort: 'moyen',
    docs: 'https://www.electronjs.org/docs/latest/tutorial/security',
    ...constat,
  };
}

/**
 * `<webview>` avec `nodeintegration`.
 *
 * La balise porte ses propres reglages, independants de ceux de la fenetre :
 * une application par ailleurs irreprochable peut ouvrir une breche par une
 * seule ligne de HTML, et les regles sur `webPreferences` ne la voient pas.
 */
function verifierWebview(file, masque, index, report) {
  for (const m of matches(masque, /<webview\b[^>]*\bnodeintegration\b/gi)) {
    const position = index.position(m.index);
    report(
      signaler(file, index, position, {
        ruleId: 'ELECTRON-WEBVIEW-NODE',
        severity: 'critical',
        title: 'Node.js accessible depuis une balise webview',
        message:
          'Une `<webview>` avec `nodeintegration` donne `require` au contenu qu\'elle affiche — souvent du contenu distant, donc hors de votre controle. La configuration de la fenetre parente n\'y change rien : la balise a ses propres reglages.',
        suggestion:
          'Retirez l\'attribut `nodeintegration`. Si la vue integree doit dialoguer avec l\'application, passez par `preload` et un canal IPC explicite. Electron recommande par ailleurs `WebContentsView` plutot que `<webview>`.',
        tags: ['CWE-94'],
      }),
    );
  }
}

/**
 * Le schema est-il verifie juste avant l'ouverture ?
 *
 * La suggestion de cette regle decrit precisement ce garde-fou ; le signaler
 * quand meme apprend a ignorer la regle. Deux formes le disent, et ce sont
 * celles qu'on ecrit reellement :
 *
 *   if (/^https?:\/\//i.test(u)) shell.openExternal(u);
 *   if (estUneUrlWeb(u)) shell.openExternal(u);
 *
 * On lit le source BRUT, pas le masque : c'est justement le litteral `http`
 * qu'on cherche, et le masquage l'efface.
 *
 * La fenetre s'arrete a trois lignes : au-dela, un `http` qui traine plus haut
 * dans la fonction ne dit plus rien de cet appel-ci.
 */
// Le `?` est LITTERAL : dans `/^https?:\/\//` le caractere qui suit `https`
// est un point d'interrogation, pas deux-points. Sans lui, la forme la plus
// courante du garde-fou passait a travers.
const GARDE_SCHEMA = /https?\s*\??\s*:|\bprotocol\s*===?|\bstartsWith\s*\(\s*["'`]https?/i;
const GARDE_NOMMEE = /\b(?:is|est)[A-Za-z_$]*(?:Url|Uri|Lien|Link)[A-Za-z_$]*\s*\(/;

function ouvertureGardee(file, offset) {
  const toutes = file.content.split('\n');
  const avant = file.content.slice(0, offset).split('\n');
  const debut = Math.max(0, avant.length - 4);
  // On regarde AUSSI vers l'avant, jusqu'a la fin de l'appel : le schema peut
  // etre fixe par l'argument lui-meme. `shell.openExternal('https://…/q=' +
  // encodeURIComponent(x))` concatene sur un prefixe litteral — la partie
  // variable ne peut plus changer le protocole.
  const fenetre = toutes.slice(debut, avant.length).join('\n')
    + file.content.slice(offset, offset + 200);
  return GARDE_SCHEMA.test(fenetre) || GARDE_NOMMEE.test(fenetre);
}

/**
 * `shell.openExternal` sur une valeur non litterale.
 *
 * La fonction ouvre l'URL avec le *gestionnaire du systeme*. Sur une chaine
 * venue de la page affichee, cela permet `file://`, `smb://` — et sous
 * Windows une invocation de programme. Une URL en dur ne pose aucun probleme.
 */
function verifierOuvertureExterne(file, masque, index, report) {
  for (const m of matches(masque, /\bshell\.openExternal\s*\(\s*([^)]*)/g)) {
    const argument = m[1].trim();
    // Le masquage vide les chaines : une URL litterale ne laisse que des
    // espaces et des guillemets, sans le moindre identifiant.
    if (!/[A-Za-z_$][\w$]*/.test(argument)) continue;
    // Schema deja verifie a cote : l'appel est protege.
    if (ouvertureGardee(file, m.index)) continue;

    const position = index.position(m.index);
    report(
      signaler(file, index, position, {
        ruleId: 'ELECTRON-OPEN-EXTERNAL',
        severity: 'high',
        title: 'Ouverture externe d\'une URL non verifiee',
        message:
          'La valeur passee a `shell.openExternal` n\'est pas litterale : elle est confiee au gestionnaire de protocole du systeme. Un schema `file://`, `smb://` ou, sous Windows, un chemin executable ouvre alors autre chose qu\'une page web.',
        suggestion:
          'Verifiez le schema avant d\'ouvrir : `const u = new URL(cible); if (u.protocol === "https:" || u.protocol === "http:") shell.openExternal(u.href);`. Une liste blanche de domaines est encore plus sure quand elle est possible.',
        tags: ['CWE-20'],
        confidence: 'firm',
      }),
    );
  }
}

/**
 * Absence de `setWindowOpenHandler`.
 *
 * Sans lui, un `target="_blank"` ou un `window.open` de la page ouvre une
 * fenetre Electron a part entiere, qui ne reprend pas forcement les reglages
 * de securite de la fenetre parente. Le comportement voulu est presque
 * toujours « ouvrir dans le navigateur du systeme, et refuser le reste ».
 */
function verifierGestionnaireDOuverture(file, masque, index, report) {
  if (!/new\s+BrowserWindow\b/.test(masque)) return;
  // La garde lit la source *brute* : `on('new-window', …)` passe par une
  // chaine, que le masquage vide. Sur le code masque, une fenetre pourtant
  // encadree paraissait ne rien declarer.
  if (/setWindowOpenHandler|['"`]new-window['"`]/.test(file.content)) return;

  const m = /new\s+BrowserWindow\b/.exec(masque);
  const position = index.position(m.index);
  report(
    signaler(file, index, position, {
      ruleId: 'ELECTRON-WINDOW-OPEN-HANDLER',
      severity: 'medium',
      title: 'Ouverture de fenetre non encadree',
      message:
        'Cette fenetre ne declare pas de `setWindowOpenHandler`. Un `window.open` ou un lien `target="_blank"` dans la page ouvre alors une fenetre Electron, dont les reglages ne sont pas necessairement ceux que vous avez choisis ici.',
      suggestion:
        'Refusez par defaut et deleguez au navigateur, en verifiant le schema : ' +
        '`setWindowOpenHandler(({ url }) => { const u = new URL(url); ' +
        'if (u.protocol === "https:") shell.openExternal(u.href); return { action: "deny" }; })`. ' +
        'La verification n\'est pas facultative : l\'URL vient de la page affichee, et ' +
        '`openExternal` la confie au gestionnaire de protocole du systeme.',
      tags: ['CWE-1021'],
      effort: 'rapide',
      confidence: 'tentative',
    }),
  );
}

export default {
  id: 'electron',
  label: 'Electron',
  appliesTo: (context) => context.has('electron'),

  run(context, report) {
    for (const file of context.sources()) {
      // Une `<webview>` s'ecrit aussi bien dans un gabarit HTML que dans du
      // JSX : la chercher uniquement dans les fichiers JavaScript revenait a
      // ne pas la voir la ou elle se trouve le plus souvent.
      const balisage = file.family === 'markup';
      if (file.family !== 'js' && !balisage) continue;

      const masque = maskedSource(file);
      if (!/BrowserWindow|webPreferences|webview|shell\.openExternal/.test(masque)) continue;
      const index = lineIndexFor(file);

      verifierWebview(file, masque, index, report);
      if (balisage) continue;

      verifierOuvertureExterne(file, masque, index, report);
      verifierGestionnaireDOuverture(file, masque, index, report);

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
