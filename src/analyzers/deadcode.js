import { extractDeclarations, extractImports, isEntryPoint, resolveImport } from '../lang/symbols.js';
import { countIdentifier, lineIndexFor, maskedSource, matches, indentOf } from '../core/scan.js';

/**
 * Analyseur de code mort.
 *
 * Strategie : construire le graphe d'imports du projet, marquer les fichiers
 * atteignables depuis les points d'entree, puis chercher a l'interieur des
 * fichiers vivants les symboles, imports et blocs jamais utilises.
 */
export default {
  id: 'deadcode',
  category: 'deadcode',
  label: 'Detection de code mort',
  order: 30,

  async run(context, report) {
    const files = context
      .sources({ includeTests: true })
      // Les fichiers d'environnement et de donnees n'ont ni imports ni appelants :
      // la notion de « code mort » ne s'y applique pas.
      .filter((f) => f.family && !f.isGenerated && !['dotenv', 'text', 'unknown'].includes(f.language));
    const graph = buildImportGraph(files, context);
    context.shared.set('importGraph', {
      nodes: graph.nodes.size,
      edges: [...graph.edges.values()].reduce((sum, set) => sum + set.size, 0),
    });

    detectUnreachableFiles(files, graph, context, report);
    detectUnusedExports(files, graph, context, report);

    for (const file of files) {
      if (file.isTest) continue;
      detectUnusedImports(file, report);
      detectUnusedLocals(file, report);
      detectUnreachableCode(file, report);
      detectCommentedCode(file, report);
      detectDebugLeftovers(file, report);
    }

    detectUnusedAssets(context, report);
  },
};

function buildImportGraph(files, context) {
  const nodes = new Map(files.map((f) => [f.relativePath, f]));
  const edges = new Map(); // importeur -> Set(importe)
  const reverse = new Map(); // importe -> Set(importeurs)
  const importsOf = new Map();

  for (const file of files) {
    const imports = extractImports(file);
    importsOf.set(file.relativePath, imports);
    const targets = new Set();

    for (const entry of imports) {
      const resolved = resolveImport(entry.source, file, context, entry.names);
      if (!resolved || resolved === file.relativePath) continue;
      targets.add(resolved);
      if (!reverse.has(resolved)) reverse.set(resolved, new Set());
      reverse.get(resolved).add(file.relativePath);
    }
    edges.set(file.relativePath, targets);
  }

  // Un fichier dont le chemin apparait dans une chaine (route, configuration,
  // gabarit) compte comme atteint. La recherche est couteuse : on la garde
  // paresseuse, pour ne la payer que sur les fichiers reellement candidats a
  // « jamais importe » — une poignee, dans un projet normal.
  let toutLeTexte = null;
  const cache = new Map();
  const estReferenceParChaine = (chemin) => {
    if (cache.has(chemin)) return cache.get(chemin);
    if (toutLeTexte === null) toutLeTexte = files.map((f) => f.content).join('\n');

    const racine = chemin.replace(/\.[^.]+$/, '');
    // Deux occurrences : la premiere peut etre le fichier lui-meme.
    const premier = toutLeTexte.indexOf(racine);
    const trouve = premier !== -1 && toutLeTexte.indexOf(racine, premier + racine.length) !== -1;
    cache.set(chemin, trouve);
    return trouve;
  };

  return { nodes, edges, reverse, importsOf, estReferenceParChaine };
}

/**
 * Familles dont les imports designent un *fichier*, et pour lesquelles
 * l'absence de reference dans le graphe veut donc dire quelque chose.
 *
 * En Java, Kotlin, Go, C# ou Swift, un import nomme un paquet ou un module,
 * jamais un chemin : un fichier peut etre utilise partout sans qu'aucun
 * import ne le mentionne. Y chercher du code mort avec un graphe de fichiers
 * revient a tirer a pile ou face — le fixture Swift l'a montre, ou deux
 * fichiers bien utilises etaient declares morts pendant que leurs equivalents
 * Kotlin passaient par simple coincidence de nommage.
 */
const IMPORTS_PAR_FICHIER = new Set(['js', 'python', 'dart', 'php', 'ruby', 'rust']);

function detectUnreachableFiles(files, graph, context, report) {
  for (const file of files) {
    if (!IMPORTS_PAR_FICHIER.has(file.family)) continue;
    if (isEntryPoint(file, context)) continue;
    if (file.isTest || file.isVendored) continue;
    if (graph.reverse.has(file.relativePath)) continue;
    if (file.lineCount < 3) continue;
    // En dernier : c'est la verification la plus couteuse.
    if (graph.estReferenceParChaine(file.relativePath)) continue;

    report({
      ruleId: 'DEAD-FILE',
      severity: 'medium',
      title: 'Fichier jamais importe',
      message: `${file.relativePath} (${file.lineCount} lignes) n'est importe par aucun autre fichier et n'est pas un point d'entree connu.`,
      file: file.relativePath,
      line: 1,
      suggestion:
        'Verifiez qu\'il n\'est pas charge dynamiquement (import(), reflection, convention de nommage). Si ce n\'est pas le cas, supprimez-le : chaque fichier mort ralentit la lecture du projet et gonfle le bundle.',
      effort: 'rapide',
      confidence: 'tentative',
      data: { lines: file.lineCount, bytes: file.size },
    });
  }
}

function detectUnusedExports(files, graph, context, report) {
  // Index global des identifiants importes quelque part.
  const importedNames = new Map(); // fichier cible -> Set(noms)
  for (const [importer, imports] of graph.importsOf) {
    const importerFile = context.file(importer);
    for (const entry of imports) {
      const resolved = resolveImport(entry.source, importerFile, context, entry.names);
      if (!resolved) continue;
      if (!importedNames.has(resolved)) importedNames.set(resolved, new Set());
      const set = importedNames.get(resolved);
      for (const name of entry.names) set.add(name);
      if (entry.names.length === 0) set.add('*');
    }
  }

  // Index des identifiants, construit en une seule passe.
  //
  // La version precedente rebalayait l'integralite du code source pour chaque
  // symbole exporte — quadratique, et de loin le poste le plus couteux de
  // l'analyse. Ici on paie une passe, puis chaque question coute une lecture
  // de table.
  const index = indexerIdentifiants(files);

  for (const file of files) {
    if (file.isTest) continue;
    if (isPublicApiFile(file, context)) continue;
    const declarations = extractDeclarations(file);
    if (declarations.length === 0) continue;

    const consumers = importedNames.get(file.relativePath);
    if (consumers?.has('*')) continue; // import namespace : impossible de trancher

    for (const declaration of declarations) {
      if (!declaration.exported) continue;
      // Les exports d'une bibliotheque sont son produit : ils ne sont pas
      // importes en interne pour la meme raison qu'une porte d'entree ne
      // s'ouvre pas depuis l'interieur. Signaler la surface publique de
      // `requests` comme morte etait le contresens le plus complet possible.
      if (context.estBibliotheque) continue;
      if (declaration.decorated) continue; // appele par un framework
      if (declaration.name.length < 3) continue;
      if (consumers?.has(declaration.name)) continue;
      if (/^(default|main|index|App|Page|Layout|handler|GET|POST|PUT|PATCH|DELETE)$/.test(declaration.name)) continue;

      // Le nom apparait-il dans un autre fichier que celui qui le declare ?
      const trace = index.get(declaration.name);
      if (trace && (trace.fichiers > 1 || trace.premier !== file.relativePath)) continue;

      report({
        ruleId: 'DEAD-EXPORT',
        severity: 'low',
        title: 'Export jamais utilise',
        message: `${declaration.kind} "${declaration.name}" est exporte mais n'est importe nulle part dans le projet.`,
        file: file.relativePath,
        line: declaration.line,
        snippet: lineIndexFor(file).textOfLine(declaration.line),
        suggestion:
          'Retirez le mot-cle export si le symbole reste utile en interne, ou supprimez-le. Un export inutilise empeche le tree-shaking de faire son travail.',
        effort: 'rapide',
        confidence: 'tentative',
        data: { symbol: declaration.name, kind: declaration.kind },
      });
    }
  }
}

/**
 * Compte, pour chaque identifiant du projet, dans combien de fichiers il
 * apparait — et lequel en premier. Cela suffit a repondre a la seule question
 * qui compte : « ce symbole est-il utilise ailleurs que la ou il est declare ? »
 *
 * Une passe unique remplace un balayage complet du code source par symbole
 * exporte, qui rendait l'analyse quadratique.
 */
function indexerIdentifiants(files) {
  const index = new Map();
  const motif = /[A-Za-z_$][\w$]*/g;

  for (const file of files) {
    if (!file.readable) continue;
    // Un identifiant repete dans un meme fichier ne compte qu'une fois.
    const presents = new Set();
    for (const match of file.content.matchAll(motif)) presents.add(match[0]);

    for (const nom of presents) {
      const trace = index.get(nom);
      if (!trace) index.set(nom, { fichiers: 1, premier: file.relativePath });
      else trace.fichiers++;
    }
  }

  return index;
}

/** Fichiers dont le role est d'exposer des symboles a un tiers. */
function isPublicApiFile(file, context) {
  if (/^(index|__init__|mod|lib|public-api|api)\.[\w]+$/.test(file.name)) return true;
  // Un fichier de configuration declare des constantes lues par reflexion
  // (Django lit SECRET_KEY, DEBUG, DATABASES… sans jamais les importer).
  if (/^(settings|config|conf|constants|env)(\.\w+)?\.(py|js|ts|rb)$/i.test(file.name)) return true;
  if (/(^|\/)(settings|config)\//.test(file.relativePath)) return true;
  // Classes autochargees par convention (Rails, Laravel, Django) : c'est le
  // framework qui les instancie, a partir d'un nom trouve dans une route.
  if (/(^|\/)app\/(controllers|models|helpers|jobs|mailers|channels|services|policies|Http|Models|Console)\//.test(file.relativePath)) return true;
  // Cible d'une carte d'imports : c'est le navigateur qui consomme ses exports,
  // en remplacement d'un module de plateforme. Le mimetisme de l'API est le but.
  if (isEntryPoint(file, context) && /(^|\/)shims?\//.test(file.relativePath)) return true;
  // Fichiers a exports conventionnels : SvelteKit appelle `load` et `actions`,
  // Nuxt appelle le gestionnaire par defaut d'une route serveur, Astro lit
  // `getStaticPaths`. Aucun de ces symboles n'est jamais importe.
  if (/^\+(page|layout|server|error)\./.test(file.name)) return true;
  if (/(^|\/)(server\/(api|routes)|src\/(routes|pages))\//.test(file.relativePath)) return true;
  // Dossier de routage, relativement a *l'application*. Un composant de page
  // est appele par le routeur, quel que soit son nom — et dans un monorepo il
  // vit sous `apps/web/pages/`, que le test ancre a la racine manquait.
  const perimetre = context.perimetreDe ? context.perimetreDe(file) : context;
  const relatif = perimetre.relatif ? perimetre.relatif(file.relativePath) : file.relativePath;
  if (perimetre.has?.('nextjs', 'nuxt', 'remix', 'sveltekit', 'astro', 'expo') &&
      /^(pages|app|routes)\//.test(relatif)) {
    return true;
  }
  const pkg = perimetre.manifests['package.json']?.data;
  if (pkg?.main && file.relativePath.endsWith(pkg.main.replace(/^\.\//, ''))) return true;
  return false;
}

function detectUnusedImports(file, report) {
  if (!['js', 'python'].includes(file.family)) return;
  const imports = extractImports(file);
  if (imports.length === 0) return;

  const masked = maskedSource(file);
  const index = lineIndexFor(file);

  for (const entry of imports) {
    // Un re-export n'a pas a etre reference localement : c'est sa raison d'etre.
    if (['side-effect', 'dynamic', 'reexport', 'reexport-all'].includes(entry.type)) continue;
    for (const name of entry.names) {
      if (!name || name.length < 2) continue;
      const uses = countIdentifier(masked, name);
      // 1 occurrence = la ligne d'import elle-meme.
      if (uses > 1) continue;
      // JSX : le composant peut apparaitre uniquement dans le balisage.
      if (/^[A-Z]/.test(name) && new RegExp(`<${name}[\\s/>]`).test(file.content)) continue;
      // Types TypeScript utilises en annotation.
      if (new RegExp(`[:<]\\s*${name}\\b`).test(file.content)) continue;

      report({
        ruleId: 'DEAD-IMPORT',
        severity: 'low',
        title: 'Import inutilise',
        message: `"${name}" est importe depuis "${entry.source}" mais jamais utilise dans ce fichier.`,
        file: file.relativePath,
        line: entry.line,
        snippet: index.textOfLine(entry.line),
        suggestion: 'Supprimez cet import. Sur du code cote client, un import inutile peut tirer toute une bibliotheque dans le bundle.',
        effort: 'rapide',
        data: { symbol: name, from: entry.source },
      });
    }
  }
}

function detectUnusedLocals(file, report) {
  if (!['js', 'python', 'dart', 'php'].includes(file.family)) return;
  const masked = maskedSource(file);
  const index = lineIndexFor(file);
  const declarations = extractDeclarations(file);

  for (const declaration of declarations) {
    if (declaration.exported || declaration.decorated) continue;
    if (declaration.name.length < 3) continue;
    if (/^(_|main|setup|init|constructor|build|render|test)/.test(declaration.name)) continue;
    if (countIdentifier(masked, declaration.name) > 1) continue;

    report({
      ruleId: 'DEAD-LOCAL',
      severity: 'low',
      title: 'Declaration locale inutilisee',
      message: `${declaration.kind} "${declaration.name}" est declare mais jamais reference.`,
      file: file.relativePath,
      line: declaration.line,
      snippet: index.textOfLine(declaration.line),
      suggestion: 'Supprimez la declaration, ou utilisez-la si elle etait prevue pour une fonctionnalite en cours.',
      effort: 'rapide',
      confidence: 'tentative',
      data: { symbol: declaration.name },
    });
  }
}

function detectUnreachableCode(file, report) {
  if (!['js', 'python', 'dart', 'go', 'jvm', 'php', 'dotnet'].includes(file.family)) return;
  const index = lineIndexFor(file);
  const lines = file.lines;

  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i].trim();
    if (!/^(return\b|throw\b|raise\b|break\b|continue\b|process\.exit|sys\.exit|panic\()/.test(current)) continue;
    if (!/[;)}]?\s*$/.test(current)) continue;

    const currentIndent = indentOf(lines[i]);
    const next = lines[i + 1];
    if (!next || !next.trim()) continue;
    const nextTrimmed = next.trim();
    if (/^[})\]]|^(else|elif|except|finally|catch|case|default|end)\b|^#|^\/\/|^\*/.test(nextTrimmed)) continue;
    if (indentOf(next) !== currentIndent) continue;

    report({
      ruleId: 'DEAD-UNREACHABLE',
      severity: 'medium',
      title: 'Code inatteignable',
      message: `La ligne ${i + 2} suit un ${current.split(/\s/)[0]} au meme niveau d'indentation : elle ne sera jamais executee.`,
      file: file.relativePath,
      line: i + 2,
      snippet: index.textOfLine(i + 2),
      suggestion: 'Supprimez ce code, ou deplacez-le avant l\'instruction de sortie si son execution etait attendue.',
      effort: 'rapide',
    });
  }
}

/**
 * Blocs de code laisses en commentaire : bruit de lecture et source de
 * confusion. On exige au moins 3 lignes consecutives ressemblant a du code.
 */
function detectCommentedCode(file, report) {
  if (!['js', 'python', 'dart', 'go', 'jvm', 'php', 'dotnet', 'ruby', 'rust'].includes(file.family)) return;
  const lines = file.lines;
  const prefix = ['python', 'ruby'].includes(file.family) ? '#' : '//';
  const codeSignals = /[;{}]\s*$|^\s*(if|for|while|return|const|let|var|function|def|class|import|from|public|private)\b|\w+\s*\(.*\)\s*[;{]?$/;

  let run = [];
  const flush = () => {
    if (run.length >= 4) {
      const codeLike = run.filter((entry) => codeSignals.test(entry.text) || /[=(){};]/.test(entry.text)).length;
      if (codeLike >= Math.ceil(run.length * 0.6)) {
        report({
          ruleId: 'DEAD-COMMENTED-CODE',
          severity: 'info',
          title: 'Bloc de code commente',
          message: `${run.length} lignes de code sont commentees a partir de la ligne ${run[0].line}.`,
          file: file.relativePath,
          line: run[0].line,
          snippet: run[0].raw,
          suggestion: 'Supprimez ce bloc : l\'historique Git conserve le code. Un bloc commente vieillit et finit par mentir sur le comportement reel.',
          effort: 'rapide',
          data: { lines: run.length },
        });
      }
    }
    run = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      const text = trimmed.slice(prefix.length).trim();
      // argus-disable-next-line — liste de mots-cles a exclure, pas une dette declaree
      if (text && !/^[A-ZÀ-Ÿ]?[a-zà-ÿ\s,'’-]{20,}$/.test(text) && !/^(TODO|FIXME|NOTE|eslint|@|https?:|-)/.test(text)) {
        run.push({ line: i + 1, text, raw: trimmed });
        continue;
      }
    }
    flush();
  }
  flush();
}

/** Familles ou un « debugger » ou un « print » est du code, pas un mot. */
const FAMILLES_DE_CODE = new Set(['js', 'python', 'php', 'ruby', 'jvm', 'dart', 'go', 'rust', 'dotnet']);

function detectDebugLeftovers(file, report) {
  // Un fichier de configuration n'execute rien. « flake8-debugger » cite dans
  // un commentaire de pyproject.toml etait signale comme une instruction
  // debugger oubliee, au rang le plus grave.
  if (!FAMILLES_DE_CODE.has(file.family)) return;

  const masked = maskedSource(file);
  const index = lineIndexFor(file);
  const patterns = [
    { re: /\b(debugger)\b/g, label: 'instruction debugger', severity: 'high' },
    { re: /\bconsole\.(log|debug|dir|table|trace)\s*\(/g, label: 'appel console', severity: 'low' },
    { re: /\b(print|pprint)\s*\(/g, label: 'appel print', severity: 'info', families: ['python'] },
    { re: /\bvar_dump\s*\(|\bdd\s*\(|\bdump\s*\(/g, label: 'dump de debug', severity: 'medium', families: ['php'] },
    { re: /\bbinding\.pry\b|\bbyebug\b|\bpdb\.set_trace\b|\bbreakpoint\s*\(\)/g, label: 'point d\'arret', severity: 'high' },
    { re: /\bprintStackTrace\s*\(/g, label: 'printStackTrace', severity: 'medium', families: ['jvm'] },
    { re: /\bdebugPrint\s*\(/g, label: 'debugPrint', severity: 'low', families: ['dart'] },
  ];

  const isFrontend = /(^|\/)(src|app|pages|components|lib|public)\//.test(file.relativePath);

  for (const pattern of patterns) {
    if (pattern.families && !pattern.families.includes(file.family)) continue;
    let count = 0;
    let firstLine = null;
    for (const match of matches(masked, pattern.re)) {
      count++;
      if (firstLine === null) firstLine = index.lineOf(match.index);
    }
    if (count === 0) continue;
    if (pattern.severity === 'low' && count < 3 && !isFrontend) continue;

    report({
      ruleId: `DEAD-DEBUG-${pattern.label.toUpperCase().replace(/[^A-Z]+/g, '-')}`,
      severity: pattern.severity,
      title: `Reste de debogage : ${pattern.label}`,
      message: `${count} occurrence(s) de ${pattern.label} dans ce fichier.`,
      file: file.relativePath,
      line: firstLine,
      snippet: index.textOfLine(firstLine),
      suggestion:
        'Retirez ces traces avant la mise en production, ou remplacez-les par un logger configurable par niveau. Une trace laissee en place peut divulguer des donnees internes.',
      effort: 'rapide',
      data: { count },
    });
  }
}

/** Images, feuilles de style et polices presentes mais jamais referencees. */
function detectUnusedAssets(context, report) {
  const assets = context.files.filter(
    (f) => /\.(png|jpe?g|gif|svg|webp|avif|css|scss|less|woff2?|ttf|mp4|webm)$/i.test(f.name) && !f.relativePath.includes('node_modules'),
  );
  if (assets.length === 0 || assets.length > 3000) return;

  const haystack = context
    .sources({ includeTests: true })
    .filter((f) => !assets.includes(f))
    .map((f) => f.content)
    .join('\n');

  let unusedBytes = 0;
  const unused = [];

  for (const asset of assets) {
    const base = asset.name;
    const stem = base.replace(/\.[^.]+$/, '');
    if (haystack.includes(base) || haystack.includes(asset.relativePath)) continue;
    if (stem.length > 3 && haystack.includes(stem)) continue;
    if (/favicon|apple-touch|android-chrome|manifest|robots|sitemap|og-|opengraph|logo/i.test(base)) continue;
    unused.push(asset);
    unusedBytes += asset.size;
  }

  for (const asset of unused.slice(0, 40)) {
    report({
      ruleId: 'DEAD-ASSET',
      severity: 'low',
      title: 'Ressource jamais referencee',
      message: `${asset.relativePath} (${formatBytes(asset.size)}) n'est reference nulle part dans le code.`,
      file: asset.relativePath,
      suggestion: 'Supprimez la ressource si elle est obsolete. Verifiez d\'abord les references construites dynamiquement (`/images/${name}.png`).',
      effort: 'rapide',
      confidence: 'tentative',
      data: { bytes: asset.size },
    });
  }

  if (unused.length > 0) {
    context.shared.set('unusedAssets', { count: unused.length, bytes: unusedBytes });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
