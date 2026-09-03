import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseHtml } from '../core/html.js';
import { lineIndexFor, maskedSource, matches, isQuoted } from '../core/scan.js';
import { extractImports } from '../lang/symbols.js';
import { countIdentifier } from '../core/scan.js';
import { color } from '../report/terminal.js';
import { isHtmlLike } from '../core/languages.js';

/**
 * Correctifs automatiques.
 *
 * Regle absolue de ce module : **rien n'est ecrit sans accord explicite de
 * l'utilisateur**. On calcule les modifications, on affiche le differentiel
 * exact, on demande fichier par fichier, et on sauvegarde l'original avant
 * toute ecriture. C'est le code de l'utilisateur, pas le notre.
 *
 * Un correctif ne figure ici que s'il est mecanique et sans ambiguite.
 * Tout ce qui demande un jugement humain (rediger un `alt`, choisir un titre,
 * decider de la langue du document) est volontairement exclu : proposer une
 * valeur inventee serait pire que de ne rien faire.
 */

const RISK = {
  SUR: { id: 'sur', label: 'sûr', paint: color.green },
  VERIFIER: { id: 'a-verifier', label: 'à vérifier', paint: color.yellow },
};

/**
 * Un correctif produit des `edits` : { start, end, replacement, note }.
 * Les offsets portent sur le contenu d'origine du fichier.
 */
export const FIXERS = [
  {
    id: 'noopener',
    ruleId: 'ROUTE-TARGET-BLANK',
    risk: RISK.SUR,
    label: 'Ajouter rel="noopener noreferrer" aux liens target="_blank"',
    why: 'Sans cet attribut, la page ouverte peut rediriger la votre (tabnabbing). Aucun effet visuel.',
    applies: (file) => ['markup', 'js'].includes(file.family),
    collect(file) {
      const edits = [];
      for (const match of matches(file.content, /<a\b([^>]*\btarget\s*=\s*["']_blank["'][^>]*)>/gi)) {
        const attributs = match[1];
        if (/\brel\s*=/i.test(attributs)) continue;
        if (file.family === 'js' && isQuoted(file, match.index)) continue;
        // On insere juste avant le `>` fermant de la balise ouvrante.
        const insertion = match.index + match[0].length - 1;
        edits.push({ start: insertion, end: insertion, replacement: ' rel="noopener noreferrer"' });
      }
      return edits;
    },
  },

  {
    id: 'autocomplete',
    ruleId: 'UX-NO-AUTOCOMPLETE',
    risk: RISK.SUR,
    label: 'Renseigner autocomplete sur les champs de formulaire',
    why:
      'Le navigateur peut pre-remplir le champ, ce qui supprime une friction reelle sur ' +
      'telephone. La valeur est deduite du type et du nom du champ, et n\'est posee que ' +
      'lorsque les deux concordent : aucun effet visuel, aucun changement de comportement.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      const edits = [];
      for (const match of matches(file.content, /<input\b([^>]*)>/gi)) {
        const attributs = match[1];
        if (/\bautocomplete\s*=/i.test(attributs)) continue;

        const valeur = valeurDAutocompletion(attributs);
        if (!valeur) continue;

        const insertion = match.index + match[0].length - (match[0].endsWith('/>') ? 2 : 1);
        edits.push({ start: insertion, end: insertion, replacement: ` autocomplete="${valeur}"` });
      }
      return edits;
    },
  },

  {
    id: 'label-for',
    ruleId: 'A11Y-INPUT-NO-LABEL',
    risk: RISK.VERIFIER,
    label: 'Associer un <label> a son champ (for / id)',
    why:
      'Le libelle est deja ecrit juste au-dessus du champ ; il ne lui est simplement pas ' +
      'rattache. Cliquer le texte ne donne pas le focus, et un lecteur d\'ecran annonce un ' +
      'champ sans nom. Le correctif ajoute un `id` deduit du `name` et le `for` correspondant. ' +
      'A verifier parce qu\'il cree un identifiant : relisez si votre CSS ou votre JavaScript ' +
      'selectionne par `id`.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      const edits = [];
      const source = file.content;

      // Les identifiants deja pris, pour ne jamais en produire un doublon.
      const pris = new Set();
      for (const match of matches(source, /\bid\s*=\s*["']([^"']+)["']/gi)) pris.add(match[1]);

      // `<label …>Texte</label>` immediatement suivi d'un `<input …>` : c'est la
      // forme que decrit la regle, et la seule ou l'intention ne fait aucun doute.
      const motif = /<label\b([^>]*)>([\s\S]{0,200}?)<\/label>\s*(<input\b([^>]*)>)/gi;
      for (const match of matches(source, motif)) {
        const [, attributsLabel, , baliseInput, attributsInput] = match;
        if (/\bfor\s*=/i.test(attributsLabel)) continue;
        if (/\bid\s*=/i.test(attributsInput)) continue;
        if (/\baria-label(?:ledby)?\s*=/i.test(attributsInput)) continue;
        if (/\btype\s*=\s*["'](?:hidden|submit|button|reset|image)["']/i.test(attributsInput)) continue;

        const nom = /\bname\s*=\s*["']([\w[\]-]+)["']/i.exec(attributsInput)?.[1];
        if (!nom) continue;

        const identifiant = identifiantLibre(`champ-${nom.replace(/[^\w-]/g, '-')}`, pris);
        pris.add(identifiant);

        const finLabel = match.index + attributsLabel.length + '<label'.length;
        edits.push({ start: finLabel, end: finLabel, replacement: ` for="${identifiant}"` });

        const debutInput = match.index + match[0].length - baliseInput.length;
        const insertion = debutInput + baliseInput.length - (baliseInput.endsWith('/>') ? 2 : 1);
        edits.push({ start: insertion, end: insertion, replacement: ` id="${identifiant}"` });
      }
      return edits;
    },
  },

  {
    id: 'charset',
    ruleId: 'SEO-CHARSET-MISSING',
    risk: RISK.SUR,
    label: 'Declarer l\'encodage UTF-8',
    why: 'Sans <meta charset>, les caracteres accentues peuvent s\'afficher corrompus.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      if (/<meta[^>]+charset/i.test(file.content)) return [];
      const head = /<head[^>]*>/i.exec(file.content);
      if (!head) return [];
      const position = head.index + head[0].length;
      const indentation = detectIndent(file);
      // `order: 0` : le charset doit rester la toute premiere balise du <head>,
      // sinon le navigateur a deja commence a decoder dans un autre encodage.
      return [{ start: position, end: position, order: 0, replacement: `\n${indentation}<meta charset="utf-8">` }];
    },
  },

  {
    id: 'viewport',
    ruleId: 'SEO-VIEWPORT-MISSING',
    risk: RISK.SUR,
    label: 'Ajouter la meta viewport (affichage mobile)',
    why: 'Sans viewport, la page s\'affiche en version bureau sur telephone. Valeur standard, sans effet de bord.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      if (/name\s*=\s*["']viewport["']/i.test(file.content)) return [];
      const head = /<head[^>]*>/i.exec(file.content);
      if (!head) return [];
      const position = head.index + head[0].length;
      const indentation = detectIndent(file);
      return [{
        start: position,
        end: position,
        order: 1,
        replacement: `\n${indentation}<meta name="viewport" content="width=device-width, initial-scale=1">`,
      }];
    },
  },

  {
    id: 'font-display',
    ruleId: 'PERF-FONT-DISPLAY',
    risk: RISK.SUR,
    label: 'Ajouter font-display: swap aux @font-face',
    why: 'Evite jusqu\'a 3 secondes de texte invisible pendant le chargement de la police.',
    applies: (file) => file.family === 'style',
    collect(file) {
      const edits = [];
      for (const match of matches(file.content, /@font-face\s*\{([^}]*)\}/g)) {
        if (/font-display\s*:/i.test(match[1])) continue;
        const fermeture = match.index + match[0].lastIndexOf('}');
        const corps = match[1];
        const indentation = /\n(\s+)\S/.exec(corps)?.[1] ?? '  ';
        const separateur = corps.trimEnd().endsWith(';') || corps.trim() === '' ? '' : ';';
        edits.push({ start: fermeture, end: fermeture, replacement: `${separateur}\n${indentation}font-display: swap;\n` });
      }
      return edits;
    },
  },

  {
    id: 'debugger',
    ruleId: 'DEAD-DEBUG-INSTRUCTION-DEBUGGER',
    risk: RISK.SUR,
    label: 'Supprimer les instructions debugger',
    why: 'Une instruction debugger laissee en production fige le navigateur des qu\'un outil de developpement est ouvert.',
    applies: (file) => file.family === 'js',
    collect(file) {
      const edits = [];
      const masked = maskedSource(file);
      const index = lineIndexFor(file);
      for (const match of matches(masked, /\bdebugger\s*;?/g)) {
        const ligne = index.lineOf(match.index);
        const texte = index.textOfLine(ligne);
        // Si la ligne ne contient que l'instruction, on retire la ligne entiere.
        if (texte.trim() === match[0].trim()) {
          const debut = index.starts[ligne - 1];
          const fin = index.starts[ligne] ?? file.content.length;
          edits.push({ start: debut, end: fin, replacement: '' });
        } else {
          edits.push({ start: match.index, end: match.index + match[0].length, replacement: '' });
        }
      }
      return edits;
    },
  },

  {
    id: 'lazy-images',
    ruleId: 'SEO-IMG-NO-LAZY',
    risk: RISK.VERIFIER,
    label: 'Ajouter loading="lazy" aux images hors du premier ecran',
    why: 'La premiere image de la page est volontairement exclue : la charger en differe degraderait le LCP. Verifiez tout de meme qu\'aucune image ciblee n\'est visible d\'emblee.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      const edits = [];
      const images = parseHtml(file.content).filter((n) => n.tag === 'img');
      // La premiere image est presomption de contenu principal : on n'y touche pas.
      for (const image of images.slice(1)) {
        if (image.has('loading') || image.has('fetchpriority')) continue;
        const insertion = image.end - (file.content[image.end - 2] === '/' ? 2 : 1);
        edits.push({ start: insertion, end: insertion, replacement: ' loading="lazy"' });
      }
      return edits;
    },
  },

  {
    id: 'defer-scripts',
    ruleId: 'PERF-BLOCKING-SCRIPT',
    risk: RISK.VERIFIER,
    label: 'Ajouter defer aux scripts bloquants du <head>',
    why: 'defer conserve l\'ordre d\'execution mais attend le parsing. A verifier si un de vos scripts utilise document.write ou doit s\'executer avant le rendu.',
    applies: (file) => isHtmlLike(file.language),
    collect(file) {
      const edits = [];
      const noeuds = parseHtml(file.content);
      const debutBody = noeuds.find((n) => n.tag === 'body')?.start ?? Number.MAX_SAFE_INTEGER;
      for (const script of noeuds) {
        if (script.tag !== 'script' || !script.has('src')) continue;
        if (script.has('async') || script.has('defer') || script.attr('type') === 'module') continue;
        if (script.start > debutBody) continue;
        const insertion = script.end - 1;
        edits.push({ start: insertion, end: insertion, replacement: ' defer' });
      }
      return edits;
    },
  },

  {
    id: 'unused-imports',
    ruleId: 'DEAD-IMPORT',
    risk: RISK.VERIFIER,
    label: 'Supprimer les imports inutilises',
    why: 'Les imports a effet de bord et les types TypeScript sont preserves. Relancez votre build apres coup.',
    applies: (file) => file.family === 'js' && !file.isTest,
    collect(file) {
      const edits = [];
      const masked = maskedSource(file);
      const index = lineIndexFor(file);

      for (const entree of extractImports(file)) {
        if (!['esm', 'cjs'].includes(entree.type)) continue;
        if (entree.names.length === 0) continue;

        const inutilises = entree.names.filter((nom) => {
          if (!nom || nom.length < 2) return false;
          if (countIdentifier(masked, nom) > 1) return false;
          if (/^[A-Z]/.test(nom) && new RegExp(`<${nom}[\\s/>]`).test(file.content)) return false;
          if (new RegExp(`[:<]\\s*${nom}\\b`).test(file.content)) return false;
          return true;
        });

        if (inutilises.length === 0) continue;
        // On ne retire la ligne que si *tous* ses symboles sont inutilises :
        // retirer un seul nom d'une liste demanderait de reecrire la clause,
        // ce qui sort du cadre d'un correctif mecanique.
        if (inutilises.length !== entree.names.length) continue;

        const debut = index.starts[entree.line - 1];
        const fin = index.starts[entree.line] ?? file.content.length;
        edits.push({ start: debut, end: fin, replacement: '', note: inutilises.join(', ') });
      }
      return edits;
    },
  },
];

/** Correctifs delibérément absents, et pourquoi. */
export const NON_AUTOMATISABLE = [
  ['Texte alternatif des images (alt)', 'Decrire une image demande de la voir. Un alt genere automatiquement serait faux, et un alt faux est pire qu\'absent.'],
  ['Attribut lang du document', 'Argus ne peut pas deviner la langue de redaction avec certitude.'],
  ['Titres et meta descriptions', 'Ce sont des textes de vente : ils relevent de votre positionnement.'],
  ['Corrections de securite', 'Une injection SQL se corrige en repensant la requete, pas en substituant du texte.'],
  ['Suppression de code mort', 'Le risque de retirer du code charge dynamiquement est trop eleve pour l\'automatiser.'],
];

/**
 * Calcule tous les correctifs applicables, sans rien ecrire.
 * @returns {Array<{file, fixes: Array<{fixer, edits}>, before, after, edits}>}
 */
/**
 * La valeur d'autocompletion deduite d'un champ, ou `null` si elle ne l'est pas.
 *
 * On ne devine pas : le type et le nom doivent concorder, et le nom doit etre
 * explicite. Un champ `text` nomme `q` ou `valeur` ne recoit rien — mieux vaut
 * ne rien poser qu'une valeur fausse, qui ferait pre-remplir le mauvais champ.
 */
function valeurDAutocompletion(attributs) {
  const type = (/\btype\s*=\s*["']([\w-]+)["']/i.exec(attributs)?.[1] || 'text').toLowerCase();
  const nom = (/\bname\s*=\s*["']([^"']+)["']/i.exec(attributs)?.[1] || '').toLowerCase();

  if (type === 'email') return 'email';
  if (type === 'tel') return 'tel';
  if (type === 'password') {
    // Un formulaire d'inscription et un formulaire de connexion demandent des
    // valeurs opposees : se tromper ferait proposer l'ancien mot de passe.
    if (/nouveau|new|confirm|repeat|again|1|2/.test(nom)) return 'new-password';
    if (/actuel|current|old|ancien/.test(nom)) return 'current-password';
    return 'current-password';
  }

  if (type !== 'text' && type !== 'search') return null;

  const correspondances = [
    [/^(courriel|email|mail|e_?mail)$/, 'email'],
    [/^(telephone|tel|phone|mobile|portable)$/, 'tel'],
    [/(prenom|firstname|given_?name)/, 'given-name'],
    [/(^nom$|lastname|family_?name|surname)/, 'family-name'],
    [/(nom_?complet|fullname|full_?name)/, 'name'],
    [/(identifiant|username|login|pseudo)/, 'username'],
    [/(organisation|entreprise|company|societe)/, 'organization'],
    [/(code_?postal|zip|postal_?code|cp)/, 'postal-code'],
    [/(ville|city|commune)/, 'address-level2'],
    [/(pays|country)/, 'country-name'],
    [/(adresse|address|rue|street)/, 'street-address'],
  ];

  for (const [motif, valeur] of correspondances) {
    if (motif.test(nom)) return valeur;
  }
  return null;
}

/** Un identifiant qui ne collisionne avec aucun de ceux deja presents. */
function identifiantLibre(base, pris) {
  if (!pris.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidat = `${base}-${n}`;
    if (!pris.has(candidat)) return candidat;
  }
  return `${base}-${Date.now()}`;
}

export function planFixes(context, { only = null } = {}) {
  const plan = [];

  for (const file of context.sources({ includeTests: true })) {
    if (!file.readable || file.isGenerated) continue;

    const fixes = [];
    for (const fixer of FIXERS) {
      if (only && !only.includes(fixer.id)) continue;
      if (!fixer.applies(file)) continue;
      let edits = [];
      try {
        edits = fixer.collect(file) || [];
      } catch {
        continue; // un correctif ne doit jamais casser la commande
      }
      if (edits.length > 0) fixes.push({ fixer, edits: edits.map((e) => ({ ...e, fixer: fixer.id })) });
    }

    if (fixes.length === 0) continue;

    const edits = fixes.flatMap((f) => f.edits);
    const before = file.content;
    const after = applyEdits(before, edits);
    if (after === before) continue;

    plan.push({ file, path: file.relativePath, absolutePath: file.path, fixes, edits, before, after });
  }

  return plan;
}

/** Applique les modifications de la fin vers le debut pour garder les offsets valides. */
export function applyEdits(source, edits) {
  // On applique de la fin vers le debut. A offset egal, l'insertion appliquee
  // en dernier se retrouve en premier dans le fichier : on trie donc `order`
  // en decroissant pour que l'ordre demande soit celui du resultat.
  const ordonnees = [...edits].sort(
    (a, b) => b.start - a.start || b.end - a.end || (b.order ?? 50) - (a.order ?? 50),
  );
  let resultat = source;
  let dernierDebut = Number.MAX_SAFE_INTEGER;

  for (const edit of ordonnees) {
    if (edit.end > dernierDebut) continue; // chevauchement : on ignore le second
    resultat = resultat.slice(0, edit.start) + edit.replacement + resultat.slice(edit.end);
    dernierDebut = edit.start;
  }
  return resultat;
}

/** Differentiel ligne a ligne, colore, pour que l'utilisateur voie exactement ce qui change. */
export function renderDiff(before, after, { contexte = 2 } = {}) {
  const avant = before.split('\n');
  const apres = after.split('\n');
  const lignes = [];

  // Alignement simple par plus longue sous-sequence commune (suffisant ici :
  // les correctifs modifient peu de lignes).
  const operations = diffLines(avant, apres);
  let tampon = [];
  let distanceDepuisChangement = Number.MAX_SAFE_INTEGER;

  for (const operation of operations) {
    if (operation.type === 'egal') {
      distanceDepuisChangement++;
      tampon.push(color.dim(`   ${operation.text}`));
      if (tampon.length > contexte * 2 + 1) tampon.shift();
    } else {
      if (distanceDepuisChangement > contexte * 2) {
        if (lignes.length > 0) lignes.push(color.dim('   ⋮'));
        lignes.push(...tampon.slice(-contexte));
      } else {
        lignes.push(...tampon);
      }
      tampon = [];
      distanceDepuisChangement = 0;
      lignes.push(
        operation.type === 'ajout'
          ? color.green(` + ${operation.text}`)
          : color.red(` - ${operation.text}`),
      );
    }
  }
  if (distanceDepuisChangement <= contexte) lignes.push(...tampon.slice(0, contexte));

  return lignes.join('\n');
}

function diffLines(avant, apres) {
  // Table de plus longue sous-sequence commune.
  const n = avant.length;
  const m = apres.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = avant[i] === apres[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (avant[i] === apres[j]) {
      operations.push({ type: 'egal', text: avant[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      operations.push({ type: 'suppression', text: avant[i++] });
    } else {
      operations.push({ type: 'ajout', text: apres[j++] });
    }
  }
  while (i < n) operations.push({ type: 'suppression', text: avant[i++] });
  while (j < m) operations.push({ type: 'ajout', text: apres[j++] });
  return operations;
}

/**
 * Sauvegarde l'original avant modification. Meme avec Git, un filet
 * supplementaire ne coute rien.
 */
export function backup(root, entree) {
  const dossier = path.join(root, '.argus', 'backup', new Date().toISOString().replace(/[:.]/g, '-'));
  const destination = path.join(dossier, entree.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // argus-disable-next-line — ecriture de sauvegarde : elle doit aboutir avant de modifier l'original
  fs.writeFileSync(destination, entree.before, 'utf8');
  return destination;
}

/**
 * Parcours interactif : affiche chaque fichier, demande, applique si accord.
 * @returns {Promise<{applied: string[], skipped: string[], backupDir: string|null}>}
 */
export async function confirmAndApply(plan, { root, autoYes = false, stream = process.stdout }) {
  const applied = [];
  const skipped = [];
  let dossierSauvegarde = null;

  const rl = autoYes
    ? null
    : readline.createInterface({ input: process.stdin, output: process.stdout });

  let toutAccepte = autoYes;

  try {
    for (const entree of plan) {
      stream.write(`\n${color.bold(color.cyan(entree.path))}\n`);
      for (const { fixer, edits } of entree.fixes) {
        stream.write(`  ${fixer.risk.paint('●')} ${fixer.label} ${color.dim(`(${edits.length}× · ${fixer.risk.label})`)}\n`);
        stream.write(color.dim(`    ${fixer.why}\n`));
      }
      stream.write(`\n${renderDiff(entree.before, entree.after)}\n\n`);

      let accepte = toutAccepte;
      if (!toutAccepte) {
        const reponse = (await rl.question(
          `  ${color.bold('Appliquer ces modifications ?')} ${color.dim('[o]ui / [n]on / [t]out accepter / [q]uitter : ')}`,
        ))
          .trim()
          .toLowerCase();

        if (reponse === 'q' || reponse === 'quitter') {
          stream.write(color.dim('\n  Interrompu. Les fichiers suivants ne sont pas traites.\n'));
          skipped.push(entree.path, ...plan.slice(plan.indexOf(entree) + 1).map((e) => e.path));
          break;
        }
        if (reponse === 't' || reponse === 'tout') {
          toutAccepte = true;
          accepte = true;
        } else {
          accepte = reponse === 'o' || reponse === 'oui' || reponse === 'y';
        }
      }

      if (!accepte) {
        skipped.push(entree.path);
        stream.write(color.dim('  Ignore.\n'));
        continue;
      }

      const sauvegarde = backup(root, entree);
      dossierSauvegarde = path.dirname(path.dirname(sauvegarde));
      fs.writeFileSync(entree.absolutePath, entree.after, 'utf8');
      applied.push(entree.path);
      stream.write(`  ${color.green('✔')} Applique.\n`);
    }
  } finally {
    rl?.close();
  }

  return { applied, skipped, backupDir: dossierSauvegarde };
}

function detectIndent(file) {
  const match = /\n(\s+)</.exec(file.content);
  return match ? match[1] : '  ';
}
