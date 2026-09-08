import { createHash } from 'node:crypto';
import { estimateComplexity, indentOf, lineIndexFor, maskedSource, matches, matchBrace, indentBlockEnd } from '../core/scan.js';
import { isSourceCode } from '../core/languages.js';

/**
 * Analyseur de qualite : taille et complexite des unites de code, duplication,
 * marqueurs de dette laisses dans les commentaires, et maintenabilite.
 */
export default {
  id: 'quality',
  category: 'quality',
  label: 'Qualite du code',
  order: 70,

  async run(context, report) {
    const options = context.config.options.quality;
    const files = context.sources().filter((f) => isSourceCode(f.language) && !f.isGenerated);

    const metrics = { files: 0, lines: 0, functions: 0, complexitySum: 0, maxComplexity: 0 };
    const blocks = new Map();

    for (const file of files) {
      metrics.files++;
      metrics.lines += file.lineCount;

      analyzeFileSize(file, options, report);
      analyzeFunctions(file, options, metrics, report);
      analyzeDebt(file, report);
      analyzeNesting(file, report);
      collectDuplicationBlocks(file, options, blocks);
    }

    for (const file of context.sources({ languages: ['yaml'] })) {
      analyserEchappementsYaml(file, report);
    }

    detectDuplication(blocks, options, report);
    analyzeStructure(context, report);
    analyzeTests(context, files, report);

    context.shared.set('qualityMetrics', {
      ...metrics,
      averageComplexity: metrics.functions > 0 ? Math.round((metrics.complexitySum / metrics.functions) * 10) / 10 : 0,
      averageFileLines: metrics.files > 0 ? Math.round(metrics.lines / metrics.files) : 0,
    });
  },
};

/**
 * Sequences d'echappement invalides dans un scalaire YAML entre guillemets.
 *
 * YAML n'accepte qu'une courte liste d'echappements entre `"…"`. Une barre
 * oblique inverse suivie d'autre chose — `\$`, `\d`, un chemin Windows — rend
 * le *fichier entier* illisible, pas seulement la ligne.
 *
 * La consequence est sournoise : un workflow qui ne se charge pas ne signale
 * rien, il ne s'execute simplement jamais. Nous en avons fait les frais nous
 * memes, sur notre propre `action.yml` : une equipe ne pouvait pas utiliser
 * l'action en integration continue, et le message du runner ne pointait que
 * la ligne, pas la cause.
 *
 * Les guillemets simples ne traitent aucun echappement : c'est presque
 * toujours le bon remede.
 */
const ECHAPPEMENTS_YAML = new Set([...'0abtnvfre "/\\N_LP\t']);

/** `\x` attend 2 chiffres hexadecimaux, `\u` en attend 4, `\U` en attend 8. */
const ECHAPPEMENTS_HEXA = { x: 2, u: 4, U: 8 };

/**
 * Le premier echappement invalide d'une chaine, ou `null`.
 *
 * `"C:\Users\runner"` en est l'exemple typique : `\U` *est* un echappement
 * reconnu, mais il exige huit chiffres hexadecimaux. Un chemin Windows colle
 * dans un YAML casse donc le fichier entier, et l'auteur cherche longtemps.
 */
function echappementInvalide(contenu) {
  for (const trouve of contenu.matchAll(/\\(.)/g)) {
    const caractere = trouve[1];
    const chiffres = ECHAPPEMENTS_HEXA[caractere];

    if (chiffres !== undefined) {
      const suite = contenu.slice(trouve.index + 2, trouve.index + 2 + chiffres);
      if (new RegExp(`^[0-9a-fA-F]{${chiffres}}$`).test(suite)) continue;
      return { caractere, position: trouve.index, chiffres };
    }

    if (!ECHAPPEMENTS_YAML.has(caractere)) return { caractere, position: trouve.index };
  }
  return null;
}

/**
 * Les rangs de lignes appartenant au corps d'un bloc litteral YAML.
 *
 * Un bloc s'ouvre par `|` ou `>` (avec les variantes `-` et `+`) en fin de
 * ligne, et court tant que l'indentation depasse celle de la clef qui l'a
 * ouvert. Son contenu n'est pas analyse par YAML, donc il n'y a rien a y
 * verifier.
 */
function lignesDeBlocLitteral(lignes) {
  const dedans = new Set();
  let margeOuvrante = null;

  lignes.forEach((ligne, rang) => {
    if (margeOuvrante !== null) {
      if (!ligne.trim()) { dedans.add(rang); return; }
      if (indentOf(ligne) > margeOuvrante) { dedans.add(rang); return; }
      margeOuvrante = null;
    }
    // `clef: |`, `clef: >-`, ou un `-` de liste suivi du meme marqueur.
    if (/(?::|^\s*-)\s*[|>][+-]?\s*(?:#.*)?$/.test(ligne)) margeOuvrante = indentOf(ligne);
  });

  return dedans;
}

function analyserEchappementsYaml(file, report) {
  if (!file.readable) return;
  const index = lineIndexFor(file);

  // Un bloc litteral (`run: |`) ne contient pas de YAML : c'est du texte
  // opaque, le plus souvent du shell, ou `\`` et `\$` sont l'echappement
  // normal. Nos propres workflows en contiennent, et la regle les a signales
  // des le premier essai — a tort.
  const dansUnBloc = lignesDeBlocLitteral(file.lines);

  file.lines.forEach((ligne, rang) => {
    if (dansUnBloc.has(rang)) return;
    // Un commentaire n'est pas un scalaire : `# chemin C:\Users` est valide.
    const sansCommentaire = ligne.replace(/(?:^|\s)#.*$/, '');

    for (const guillemets of sansCommentaire.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const echappement = echappementInvalide(guillemets[1]);
      if (echappement) {
        const pourquoi = echappement.chiffres
          ? `\\${echappement.caractere} attend ${echappement.chiffres} chiffres hexadecimaux, qui ne suivent pas`
          : `\\${echappement.caractere} n'est pas un echappement YAML valide`;

        report({
          ruleId: 'QUAL-YAML-ECHAPPEMENT-INVALIDE',
          severity: 'high',
          title: 'Fichier YAML illisible',
          message:
            `Entre guillemets doubles, ${pourquoi}. Le fichier entier devient illisible, ` +
            'et non la seule ligne concernee : un workflow dans cet etat ne signale aucune ' +
            'erreur, il ne s\'execute jamais.',
          file: file.relativePath,
          line: rang + 1,
          column: guillemets.index + 1 + echappement.position + 1,
          snippet: ligne.trim(),
          suggestion:
            'Passez la valeur en guillemets simples : YAML n\'y traite aucun echappement. ' +
            'Sinon, doublez la barre oblique inverse, ou utilisez un bloc littéral `|`. ' +
            'Seuls 0 a b t n v f r e espace \" / \\ N _ L P sont valides seuls ; x, u et U ' +
            'exigent respectivement 2, 4 et 8 chiffres hexadecimaux.',
          effort: 'rapide',
          confidence: 'certain',
        });
        return;
      }
    }
  });
}

function analyzeFileSize(file, options, report) {
  if (file.lineCount <= options.maxFileLines) return;
  const severity = file.lineCount > options.maxFileLines * 3 ? 'medium' : 'low';
  report({
    ruleId: 'QUAL-FILE-TOO-LONG',
    severity,
    title: 'Fichier trop long',
    message: `${file.relativePath} compte ${file.lineCount} lignes (seuil : ${options.maxFileLines}). Un fichier de cette taille porte generalement plusieurs responsabilites.`,
    file: file.relativePath,
    line: 1,
    suggestion:
      'Identifiez les groupes de fonctions qui partagent le meme etat ou le meme domaine et extrayez-les dans des modules dedies. Commencez par ce qui change le plus souvent.',
    effort: 'important',
    data: { lines: file.lineCount },
  });
}

/**
 * Mots-cles dont la forme lexicale imite une declaration de fonction.
 * Sans cette liste, `for (…) {` serait analyse comme une fonction nommee
 * « for » — et sa complexite comptee une seconde fois.
 */
const CONTROL_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'catch', 'try', 'finally',
  'return', 'typeof', 'instanceof', 'new', 'delete', 'void', 'await', 'yield',
  'throw', 'case', 'with', 'super', 'this',
]);

/** Decoupe le fichier en unites de code (fonctions/methodes) approximatives. */
function extractFunctions(file) {
  const source = maskedSource(file);
  const raw = file.content;
  const index = lineIndexFor(file);
  const functions = [];

  const braceFamilies = ['js', 'jvm', 'dart', 'go', 'php', 'dotnet', 'rust', 'native', 'swift'];

  if (braceFamilies.includes(file.family)) {
    const re = /(?:^|\n)[^\n]*?\b(?:function\s*\*?\s*([\w$]+)?|([\w$]+)\s*(?::\s*)?(?:=\s*)?(?:async\s*)?\([^)]*\)\s*(?:=>)?)\s*\{/g;
    for (const match of matches(source, re)) {
      const open = source.indexOf('{', match.index + match[0].length - 1);
      if (open === -1) continue;
      const close = matchBrace(source, open);
      if (close === -1) continue;
      const startLine = index.lineOf(match.index);
      const endLine = index.lineOf(close);
      const body = raw.slice(open, close);
      if (endLine - startLine < 3) continue;

      const name = match[1] || match[2] || '(anonyme)';
      // `for (…) {`, `while (…) {`, `switch (…) {` ont la meme forme lexicale
      // qu'un appel de fonction suivi d'un bloc. Les compter comme des unites
      // de code gonflerait le total et compterait deux fois leur complexite,
      // deja incluse dans celle de la fonction qui les contient.
      if (CONTROL_KEYWORDS.has(name)) continue;

      functions.push({
        name,
        startLine,
        endLine,
        lines: endLine - startLine + 1,
        body,
        signature: index.textOfLine(startLine).trim(),
      });
    }
  } else if (file.family === 'python') {
    const lines = file.lines;
    for (let i = 0; i < lines.length; i++) {
      const match = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
      if (!match) continue;
      const end = indentBlockEnd(lines, i);
      const body = lines.slice(i, end).join('\n');
      if (end - i < 4) continue;
      functions.push({ name: match[1], startLine: i + 1, endLine: end, lines: end - i, body, signature: lines[i].trim() });
    }
  } else if (file.family === 'ruby') {
    const lines = file.lines;
    for (let i = 0; i < lines.length; i++) {
      const match = /^\s*def\s+(?:self\.)?(\w+[?!]?)/.exec(lines[i]);
      if (!match) continue;
      const baseIndent = indentOf(lines[i]);
      let end = i + 1;
      while (end < lines.length && !(indentOf(lines[end]) === baseIndent && /^\s*end\b/.test(lines[end]))) end++;
      const body = lines.slice(i, end).join('\n');
      if (end - i < 4) continue;
      functions.push({ name: match[1], startLine: i + 1, endLine: end + 1, lines: end - i, body, signature: lines[i].trim() });
    }
  }

  return functions;
}

function analyzeFunctions(file, options, metrics, report) {
  const functions = extractFunctions(file);

  for (const fn of functions) {
    metrics.functions++;
    const complexity = estimateComplexity(fn.body);
    metrics.complexitySum += complexity;
    metrics.maxComplexity = Math.max(metrics.maxComplexity, complexity);

    if (complexity > options.maxComplexity) {
      report({
        ruleId: 'QUAL-HIGH-COMPLEXITY',
        severity: complexity > options.maxComplexity * 2 ? 'medium' : 'low',
        title: 'Fonction trop complexe',
        message: `"${fn.name}" a une complexite cyclomatique estimee a ${complexity} (seuil : ${options.maxComplexity}). Il faudrait ${complexity} tests pour couvrir tous les chemins.`,
        file: file.relativePath,
        line: fn.startLine,
        endLine: fn.endLine,
        snippet: fn.signature,
        suggestion:
          'Extrayez les branches en fonctions nommees, remplacez les cascades de conditions par un objet de correspondance, et sortez tot (guard clauses) plutot que d\'imbriquer.',
        effort: 'important',
        data: { complexity, function: fn.name },
      });
    }

    if (fn.lines > options.maxFunctionLines) {
      report({
        ruleId: 'QUAL-LONG-FUNCTION',
        severity: 'low',
        title: 'Fonction trop longue',
        message: `"${fn.name}" fait ${fn.lines} lignes (seuil : ${options.maxFunctionLines}).`,
        file: file.relativePath,
        line: fn.startLine,
        endLine: fn.endLine,
        snippet: fn.signature,
        suggestion: 'Decoupez selon les etapes logiques : une fonction devrait tenir sur un ecran et faire une seule chose.',
        effort: 'moyen',
        data: { lines: fn.lines, function: fn.name },
      });
    }

    const params = /\(([^)]*)\)/.exec(fn.signature)?.[1] ?? '';
    const paramCount = params.trim() ? params.split(',').filter((p) => p.trim()).length : 0;
    if (paramCount > options.maxParams) {
      report({
        ruleId: 'QUAL-TOO-MANY-PARAMS',
        severity: 'low',
        title: 'Trop de parametres',
        message: `"${fn.name}" prend ${paramCount} parametres : les appels deviennent illisibles et les erreurs d'ordre inevitables.`,
        file: file.relativePath,
        line: fn.startLine,
        snippet: fn.signature,
        suggestion: 'Regroupez les parametres lies dans un objet d\'options nomme.',
        effort: 'moyen',
        data: { params: paramCount },
      });
    }
  }
}

function analyzeDebt(file, report) {
  const index = lineIndexFor(file);
  // L'identifiant de regle est declare, jamais derive du texte trouve :
  // le construire a partir de la correspondance produisait des identifiants
  // instables et illisibles des que la note contenait de la ponctuation.
  const markers = [
  // argus-disable-next-line — vocabulaire de la regle, pas de la dette
    { id: 'QUAL-FIXME', label: 'FIXME', re: /\b(?:FIXME|XXX|HACK|BUG)\b\s*:?\s*(.{0,120})/g, severity: 'medium' },
  // argus-disable-next-line — vocabulaire de la regle, pas de la dette
    { id: 'QUAL-TODO', label: 'TODO', re: /\bTODO\b\s*:?\s*(.{0,120})/g, severity: 'info' },
  // argus-disable-next-line — vocabulaire de la regle, pas de la dette
    { id: 'QUAL-DEPRECATED', label: '@deprecated', re: /\b@deprecated\b\s*(.{0,120})/g, severity: 'low', deprecated: true },
  ];

  for (const marker of markers) {
    for (const match of matches(file.content, marker.re)) {
      const line = index.lineOf(match.index);
      const note = (match[1] || '').trim();
      report({
        ruleId: marker.id,
        severity: marker.severity,
        title: marker.deprecated ? 'Code marque comme deprecie' : `Dette declaree : ${marker.label}`,
        message: note ? `« ${note} »` : 'Marqueur de dette technique sans description.',
        file: file.relativePath,
        line,
        snippet: index.textOfLine(line).trim(),
        suggestion: marker.deprecated
          ? 'Planifiez la suppression : identifiez les appelants restants et fixez une echeance.'
          : 'Convertissez ce marqueur en ticket avec un responsable et une echeance, ou traitez-le maintenant. Un marqueur sans suivi ne sera jamais traite.',
        effort: 'rapide',
      });
    }
  }
}

function analyzeNesting(file, report) {
  const lines = file.lines;
  const unit = file.family === 'python' ? 4 : 2;
  let worst = { depth: 0, line: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('//') || line.trim().startsWith('#')) continue;
    const depth = Math.floor(indentOf(line) / unit);
    if (depth > worst.depth) worst = { depth, line: i + 1 };
  }

  if (worst.depth >= 7) {
    report({
      ruleId: 'QUAL-DEEP-NESTING',
      severity: 'low',
      title: 'Imbrication profonde',
      message: `Jusqu'a ${worst.depth} niveaux d'imbrication dans ce fichier. Au-dela de 4, suivre le flux demande de garder trop de contexte en tete.`,
      file: file.relativePath,
      line: worst.line,
      snippet: lines[worst.line - 1]?.trim(),
      suggestion: 'Inversez les conditions pour sortir tot, extrayez les blocs internes en fonctions, remplacez les boucles imbriquees par des operations sur collections.',
      effort: 'moyen',
      data: { depth: worst.depth },
    });
  }
}

/** Empreintes de blocs normalises, pour la detection de copier-coller. */
function collectDuplicationBlocks(file, options, blocks) {
  const minLines = options.duplicationMinLines;
  const lines = file.lines
    .map((line, position) => ({ text: normalizeForHash(line), position: position + 1 }))
    .filter((entry) => entry.text.length > 12);

  if (lines.length < minLines) return;

  for (let i = 0; i + minLines <= lines.length; i++) {
    const window = lines.slice(i, i + minLines);
    // On ignore les fenetres non contigues (separees par du vide ou du commentaire).
    if (window[window.length - 1].position - window[0].position > minLines * 2) continue;
    const hash = createHash('sha1').update(window.map((w) => w.text).join('\n')).digest('hex').slice(0, 16);
    if (!blocks.has(hash)) blocks.set(hash, []);
    blocks.get(hash).push({ file: file.relativePath, line: window[0].position, lines: minLines });
  }
}

function normalizeForHash(line) {
  return line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/["'`][^"'`]*["'`]/g, '""')
    .replace(/\b\d+(\.\d+)?\b/g, '0');
}

function detectDuplication(blocks, options, report) {
  const reported = new Set();

  for (const [hash, occurrences] of blocks) {
    if (occurrences.length < 2) continue;
    const distinct = occurrences.filter(
      (occurrence, position) =>
        occurrences.findIndex((other) => other.file === occurrence.file && Math.abs(other.line - occurrence.line) < options.duplicationMinLines) === position,
    );
    if (distinct.length < 2) continue;

    const key = distinct.map((o) => `${o.file}:${o.line}`).join('|');
    if (reported.has(key)) continue;
    reported.add(key);

    const crossFile = new Set(distinct.map((o) => o.file)).size > 1;
    report({
      ruleId: 'QUAL-DUPLICATION',
      severity: crossFile ? 'low' : 'info',
      title: crossFile ? 'Code duplique entre fichiers' : 'Code duplique dans le fichier',
      message: `Un bloc de ${options.duplicationMinLines} lignes apparait ${distinct.length} fois : ${distinct.slice(0, 4).map((o) => `${o.file}:${o.line}`).join(', ')}.`,
      file: distinct[0].file,
      line: distinct[0].line,
      suggestion:
        'Extrayez le bloc dans une fonction ou un composant partage. Tant que la duplication existe, chaque correction devra etre appliquee a plusieurs endroits — et l\'un d\'eux sera oublie.',
      effort: 'moyen',
      confidence: 'firm',
      data: { occurrences: distinct.slice(0, 10), hash },
    });
  }
}

function analyzeStructure(context, report) {
  const readme = context.files.find((f) => /^readme(\.md|\.txt)?$/i.test(f.name));
  if (!readme && context.files.length > 15) {
    report({
      ruleId: 'QUAL-NO-README',
      severity: 'low',
      title: 'README absent',
      message: 'Le projet n\'a pas de README : rien n\'explique comment l\'installer, le lancer, ni ce qu\'il fait.',
      suggestion: 'Ajoutez un README avec : objectif du projet, prerequis, installation, commandes de developpement, structure des dossiers, et procedure de deploiement.',
      effort: 'moyen',
    });
  } else if (readme && readme.lineCount < 10) {
    report({
      ruleId: 'QUAL-THIN-README',
      severity: 'info',
      title: 'README trop succinct',
      message: `Le README ne fait que ${readme.lineCount} lignes.`,
      file: readme.relativePath,
      line: 1,
      suggestion: 'Documentez au minimum l\'installation, le lancement en local et les variables d\'environnement necessaires.',
      effort: 'rapide',
    });
  }

  const pkg = context.manifests['package.json'];
  if (pkg?.data) {
    const scripts = pkg.data.scripts || {};
    if (!scripts.test) {
      report({
        ruleId: 'QUAL-NO-TEST-SCRIPT',
        severity: 'low',
        title: 'Aucun script de test',
        message: 'package.json ne definit pas de script "test".',
        file: pkg.file.relativePath,
        line: 1,
        suggestion: 'Ajoutez un script de test, meme minimal : c\'est le point d\'entree attendu par toute integration continue.',
        effort: 'rapide',
      });
    }
    if (!scripts.lint && !context.files.some((f) => /^\.?(eslintrc|eslint\.config|biome\.json)/.test(f.name))) {
      report({
        ruleId: 'QUAL-NO-LINTER',
        severity: 'low',
        title: 'Aucun linter configure',
        message: 'Ni ESLint ni Biome ne sont configures : les erreurs evitables ne sont detectees qu\'a l\'execution.',
        file: pkg.file.relativePath,
        line: 1,
        suggestion: 'Ajoutez ESLint ou Biome avec la configuration recommandee, et branchez-le sur un hook de pre-commit.',
        effort: 'moyen',
      });
    }
  }

  const hasCi = context.files.some((f) => /\.(github\/workflows|gitlab-ci|circleci|travis)/.test(f.relativePath));
  if (!hasCi && context.files.length > 40) {
    report({
      ruleId: 'QUAL-NO-CI',
      severity: 'low',
      title: 'Aucune integration continue',
      message: 'Aucune configuration de CI detectee : rien ne verifie automatiquement les contributions.',
      suggestion: 'Ajoutez un workflow qui lance les tests, le linter et cette analyse (argus scan --ci) sur chaque pull request.',
      effort: 'moyen',
    });
  }
}

function analyzeTests(context, files, report) {
  const testFiles = context.files.filter((f) => f.isTest && isSourceCode(f.language));
  const sourceCount = files.length;
  if (sourceCount < 10) return;

  const ratio = testFiles.length / sourceCount;
  if (testFiles.length === 0) {
    report({
      ruleId: 'QUAL-NO-TESTS',
      severity: 'medium',
      title: 'Aucun test automatise',
      message: `${sourceCount} fichiers source, aucun fichier de test. Chaque modification est un pari.`,
      suggestion:
        'Commencez par les chemins critiques : authentification, paiement, calculs metier. Un test par regle metier apporte deja l\'essentiel du benefice.',
      effort: 'important',
    });
  } else if (ratio < 0.1) {
    report({
      ruleId: 'QUAL-LOW-TEST-RATIO',
      severity: 'low',
      title: 'Couverture de tests probablement faible',
      message: `${testFiles.length} fichiers de test pour ${sourceCount} fichiers source (ratio ${Math.round(ratio * 100)} %).`,
      suggestion: 'Visez au moins un fichier de test par module metier, et mesurez la couverture reelle avec votre outil de test.',
      effort: 'important',
      confidence: 'tentative',
    });
  }
}
