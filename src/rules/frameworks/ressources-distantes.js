import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Ressources distantes dans une application installee — transverse.
 *
 * Une page web qui charge une police ou un script depuis un CDN fait un
 * arbitrage connu : une requete de plus contre un cache partage. Dans une
 * application installee, le meme geste a deux consequences que personne ne
 * choisit vraiment.
 *
 * D'abord l'application cesse de fonctionner hors ligne — precisement ce
 * qu'un logiciel installe est cense garantir, et le defaut ne se voit qu'une
 * fois chez l'utilisateur, dans un train ou derriere un pare-feu.
 *
 * Ensuite, et surtout, le domaine distant obtient un droit d'execution dans
 * une fenetre qui dispose d'API systeme. Une page web compromise par son CDN
 * perd sa session ; une application de bureau compromise par son CDN perd la
 * machine.
 *
 * La regle vaut pour Electron, Tauri, les WebView mobiles et Capacitor : le
 * mecanisme est le meme partout ou du HTML local s'execute avec des
 * privileges natifs.
 */
const RESSOURCES = [
  {
    motif: /<script\b[^>]*\bsrc\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
    type: 'script',
    severity: 'high',
    consequence:
      'Un script distant s\'execute avec les privileges de la fenetre. Si le domaine ou son CDN est compromis, c\'est la machine de l\'utilisateur qui l\'est.',
  },
  {
    motif: /<link\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+\.css[^"']*)["']/gi,
    type: 'feuille de style',
    severity: 'medium',
    consequence:
      'L\'interface perd sa mise en forme hors ligne, et une feuille de style distante peut exfiltrer des donnees par des selecteurs d\'attribut.',
  },
  {
    motif: /@import\s+(?:url\()?["'](https?:\/\/[^"']+)["']/gi,
    type: 'feuille de style importee',
    severity: 'medium',
    consequence: 'L\'interface perd sa mise en forme hors ligne.',
  },
];

export default {
  id: 'ressources-distantes',
  label: 'Ressources distantes',
  // Transverse : partout ou du HTML local s'execute avec des privileges natifs.
  appliesTo: (context) => context.cible('mobile', 'desktop'),

  run(context, report) {
    for (const file of context.sources()) {
      if (file.family !== 'markup' && file.language !== 'css') continue;

      const index = lineIndexFor(file);

      for (const regle of RESSOURCES) {
        for (const m of matches(file.content, regle.motif)) {
          const position = index.position(m.index);
          let hote = m[1];
          try {
            hote = new URL(m[1]).host;
          } catch {
            /* URL non analysable : on cite l'adresse telle quelle */
          }

          report({
            ruleId: 'APP-RESSOURCE-DISTANTE',
            severity: regle.severity,
            category: 'security',
            title: `${regle.type} chargee depuis ${hote}`,
            message:
              `Cette application installee charge une ${regle.type} depuis ${hote}. ` +
              `${regle.consequence} Un logiciel installe est cense fonctionner sans reseau, et le defaut ne se voit qu'une fois chez l'utilisateur.`,
            file: file.relativePath,
            line: position.line,
            column: position.column,
            snippet: index.textOfLine(position.line).trim(),
            suggestion:
              'Embarquez la ressource dans l\'application plutot que de la charger. Si un contenu distant est indispensable, servez-le dans une fenetre sans acces natif et verrouillez la politique de securite du contenu.',
            confidence: 'firm',
            effort: 'rapide',
            tags: ['CWE-829', 'A08:2021'],
            docs: 'https://cwe.mitre.org/data/definitions/829.html',
          });
        }
      }
    }
  },
};
