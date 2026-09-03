import path from 'node:path';
import { isQuoted, lineIndexFor, maskedSource, matches } from '../core/scan.js';

/**
 * Extraction de symboles (declarations, exports, imports) par famille de
 * langage. Approche lexicale : pas d'AST, mais des motifs suffisamment cibles
 * pour alimenter la detection de code mort avec peu de faux positifs.
 */

const DECLARATION_PATTERNS = {
  js: [
    { kind: 'function', re: /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g },
    { kind: 'class', re: /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { kind: 'const-fn', re: /(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g },
    { kind: 'const', re: /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=/g },
    { kind: 'type', re: /(?:^|\n)\s*(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/g },
  ],
  python: [
    { kind: 'function', re: /(?:^|\n)\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/g },
    { kind: 'class', re: /(?:^|\n)\s*class\s+([A-Za-z_]\w*)/g },
    { kind: 'const', re: /(?:^|\n)([A-Z][A-Z0-9_]{2,})\s*(?::[^=\n]+)?=/g },
  ],
  jvm: [
    { kind: 'class', re: /(?:^|\n)\s*(?:public|private|protected|internal)?\s*(?:final\s+|abstract\s+|open\s+|data\s+)*(?:class|interface|enum|object)\s+([A-Za-z_]\w*)/g },
    { kind: 'method', re: /(?:public|private|protected|internal)\s+(?:static\s+)?(?:final\s+)?[\w<>,\[\]?.]+\s+([a-z]\w*)\s*\(/g },
    { kind: 'method', re: /(?:^|\n)\s*(?:private|internal|public|protected)?\s*fun\s+([A-Za-z_]\w*)/g },
  ],
  dart: [
    { kind: 'class', re: /(?:^|\n)\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/g },
    { kind: 'function', re: /(?:^|\n)\s*(?:[\w<>,\[\]?]+\s+)?([a-z_]\w*)\s*\([^)]*\)\s*(?:async\s*)?\{/g },
  ],
  php: [
    { kind: 'function', re: /(?:^|\n)\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z_]\w*)/g },
    { kind: 'class', re: /(?:^|\n)\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z_]\w*)/g },
  ],
  go: [
    { kind: 'function', re: /(?:^|\n)func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g },
    { kind: 'type', re: /(?:^|\n)type\s+([A-Za-z_]\w*)/g },
  ],
  ruby: [
    { kind: 'function', re: /(?:^|\n)\s*def\s+(?:self\.)?([a-z_]\w*[?!]?)/g },
    { kind: 'class', re: /(?:^|\n)\s*(?:class|module)\s+([A-Z]\w*)/g },
  ],
  dotnet: [
    { kind: 'class', re: /(?:^|\n)\s*(?:public|private|protected|internal)?\s*(?:sealed\s+|abstract\s+|static\s+|partial\s+)*(?:class|interface|record|struct|enum)\s+([A-Za-z_]\w*)/g },
    { kind: 'method', re: /(?:public|private|protected|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*[\w<>,\[\]?.]+\s+([A-Z]\w*)\s*\(/g },
  ],
  rust: [
    { kind: 'function', re: /(?:^|\n)\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_]\w*)/g },
    { kind: 'type', re: /(?:^|\n)\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g },
  ],
};

/** @returns {Array<{name:string,kind:string,line:number,exported:boolean,offset:number}>} */
export function extractDeclarations(file) {
  const patterns = DECLARATION_PATTERNS[file.family];
  if (!patterns) return [];
  const source = maskedSource(file);
  const index = lineIndexFor(file);
  const found = new Map();

  for (const { kind, re } of patterns) {
    for (const match of matches(source, re)) {
      const name = match[1];
      if (!name || found.has(name)) continue;
      // Les motifs demarrent sur le saut de ligne precedent : on repositionne
      // l'offset sur le nom lui-meme pour ne pas decaler le numero de ligne.
      const nameOffset = match.index + Math.max(0, match[0].lastIndexOf(name));
      const line = index.lineOf(nameOffset);
      const lineText = index.textOfLine(line);
      found.set(name, {
        name,
        kind,
        line,
        offset: nameOffset,
        exported: isExported(lineText, name, file),
        decorated: isDecorated(index, line),
        public: !name.startsWith('_'),
      });
    }
  }

  return [...found.values()].sort((a, b) => a.line - b.line);
}

/**
 * Un symbole precede d'un decorateur ou d'une annotation est appele par un
 * framework, jamais par un import : @app.route, @GetMapping, @Component,
 * @Injectable, @override… Le considerer comme mort serait faux.
 */
function isDecorated(index, line) {
  for (let current = line - 1; current >= Math.max(1, line - 6); current--) {
    const text = index.textOfLine(current).trim();
    if (!text) continue;
    if (/^[@#]\[?\w/.test(text)) return true;
    if (/^(async\s+)?(def|function|class|public|private|final|static)\b/.test(text)) return false;
    if (!/^[)\]},]|^\s*$/.test(text)) return false;
  }
  return false;
}

function isExported(lineText, name, file) {
  switch (file.family) {
    case 'js':
      return /\bexport\b/.test(lineText) || new RegExp(`\\bexports\\.${name}\\b|module\\.exports`).test(file.content);
    case 'python':
      return !name.startsWith('_');
    case 'go':
      return /^[A-Z]/.test(name);
    case 'jvm':
    case 'dotnet':
      return /\bpublic\b/.test(lineText);
    case 'rust':
      return /\bpub\b/.test(lineText);
    case 'dart':
      // Dart n'a pas de mot-cle d'export : tout identifiant public est
      // visible. Traiter chaque classe comme un export produirait un bruit
      // considerable — on laisse la detection d'usage local trancher.
      return false;
    default:
      return true;
  }
}

/**
 * Imports declares par un fichier.
 * Un extracteur par famille de langage : chacun reste court et lisible, et
 * ajouter un langage revient a ajouter une entree dans la table.
 * @returns {Array<{names:string[],source:string,line:number,type:string}>}
 */
export function extractImports(file) {
  const extracteur = EXTRACTEURS_IMPORT[file.family];
  if (!extracteur) return [];

  const imports = [];
  /**
   * Un `import` cite dans une chaine ou un commentaire est de la
   * documentation, pas une dependance : un exemple JSDoc ou un extrait dans un
   * message d'aide ne doit pas etre compte comme un import du fichier.
   */
  const estDocumentation = (offset) => file.family === 'js' && isQuoted(file, offset);

  extracteur(file.content, lineIndexFor(file), imports, estDocumentation);
  return imports;
}

/** Imports JavaScript et TypeScript : ESM, CommonJS, dynamiques, re-exports. */
function extraireImportsJs(raw, index, imports, estDocumentation) {
  const ajouter = (match, entree) => {
    if (estDocumentation(match.index)) return;
    imports.push({ line: index.lineOf(match.index), ...entree });
  };

  for (const match of matches(raw, /import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
    ajouter(match, { names: parseJsImportClause(match[1]), source: match[2], type: 'esm' });
  }

  // Un re-export compte comme une utilisation du symbole cible.
  for (const match of matches(raw, /export\s+(\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s+from\s*['"]([^'"]+)['"]/g)) {
    const clause = match[1];
    const tout = clause.startsWith('*');
    ajouter(match, {
      names: tout ? [] : parseJsImportClause(clause),
      source: match[2],
      type: tout ? 'reexport-all' : 'reexport',
    });
  }

  for (const match of matches(raw, /import\s*['"]([^'"]+)['"]/g)) {
    ajouter(match, { names: [], source: match[1], type: 'side-effect' });
  }

  for (const match of matches(raw, /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    ajouter(match, { names: parseJsImportClause(match[1]), source: match[2], type: 'cjs' });
  }

  for (const match of matches(raw, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    ajouter(match, { names: [], source: match[1], type: 'dynamic' });
  }
}

/** Imports Python : `from x import a, b` et `import x`. */
function extraireImportsPython(raw, index, imports) {
  const nomsDe = (liste) =>
    liste
      .split(',')
      .map((n) => n.trim().split(/\s+as\s+/)[0].replace(/[()]/g, ''))
      .filter(Boolean);

  for (const match of matches(raw, /^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm)) {
    imports.push({ names: nomsDe(match[2]), source: match[1], line: index.lineOf(match.index), type: 'from' });
  }

  for (const match of matches(raw, /^\s*import\s+([\w.,\s]+)$/gm)) {
    for (const name of nomsDe(match[1])) {
      imports.push({ names: [name], source: name, line: index.lineOf(match.index), type: 'import' });
    }
  }
}

/** Imports Dart. */
function extraireImportsDart(raw, index, imports) {
  for (const match of matches(raw, /import\s+['"]([^'"]+)['"]/g)) {
    imports.push({ names: [], source: match[1], line: index.lineOf(match.index), type: 'import' });
  }
}

/** Imports Java et Kotlin : le symbole utile est le dernier segment. */
function extraireImportsJvm(raw, index, imports) {
  for (const match of matches(raw, /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;?$/gm)) {
    const segments = match[1].split('.');
    imports.push({
      names: [segments[segments.length - 1]],
      source: match[1],
      line: index.lineOf(match.index),
      type: 'import',
    });
  }
}

/** Imports Go : chaines citees a l'interieur d'un bloc `import (...)`. */
function extraireImportsGo(raw, index, imports) {
  for (const match of matches(raw, /"([\w./-]+)"/g)) {
    const avant = raw.slice(Math.max(0, match.index - 200), match.index);
    if (!/^import|\(/.test(avant)) continue;
    imports.push({ names: [], source: match[1], line: index.lineOf(match.index), type: 'import' });
  }
}

/** Imports PHP : `use` d'espace de noms et `require`/`include` de fichier. */
function extraireImportsPhp(raw, index, imports) {
  for (const match of matches(raw, /^\s*use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm)) {
    const name = match[2] || match[1].split('\\').pop();
    imports.push({ names: [name], source: match[1], line: index.lineOf(match.index), type: 'use' });
  }

  for (const match of matches(raw, /(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/g)) {
    imports.push({ names: [], source: match[1], line: index.lineOf(match.index), type: 'include' });
  }
}

/** Table des extracteurs : ajouter un langage se fait ici. */
const EXTRACTEURS_IMPORT = {
  js: extraireImportsJs,
  python: extraireImportsPython,
  dart: extraireImportsDart,
  jvm: extraireImportsJvm,
  go: extraireImportsGo,
  php: extraireImportsPhp,
};

function parseJsImportClause(clause) {
  const names = [];
  const text = clause.trim();
  const namedMatch = /\{([^}]*)\}/.exec(text);
  if (namedMatch) {
    for (const part of namedMatch[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.push(name);
    }
  }
  const defaultMatch = /^([A-Za-z_$][\w$]*)/.exec(text);
  if (defaultMatch) names.push(defaultMatch[1]);
  const namespaceMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(text);
  if (namespaceMatch) names.push(namespaceMatch[1]);
  return [...new Set(names)];
}

/**
 * Resout une specification d'import vers un fichier du projet.
 * @returns {string|null} chemin relatif du fichier cible
 */
export function resolveImport(spec, fromFile, context, importedNames = []) {
  if (!spec) return null;

  // Alias de tsconfig / jsconfig les plus courants.
  let target = spec;
  if (/^[@~]\//.test(target)) target = target.replace(/^[@~]\//, 'src/');
  else if (target.startsWith('@/')) target = target.replace(/^@\//, 'src/');

  const isRelative = target.startsWith('.');
  const isAbsoluteProject = target.startsWith('src/') || target.startsWith('/');

  // PHP : les espaces de noms suivent PSR-4, declare dans composer.json.
  if (file_family(fromFile) === 'php' && spec.includes('\\')) {
    const psr4 = context.manifests['composer.json']?.data?.autoload?.['psr-4'] || { 'App\\': 'app/' };
    for (const [prefixe, dossier] of Object.entries(psr4)) {
      const racine = prefixe.replace(/\\+$/, '');
      if (!spec.startsWith(`${racine}\\`)) continue;
      const reste = spec.slice(racine.length + 1).split('\\').join('/');
      const resolu = findFile(context, [`${dossier.replace(/\/+$/, '')}/${reste}.php`]);
      if (resolu) return resolu;
    }
    return null;
  }

  // Import relatif Python : le point designe le paquet courant, pas un nom de
  // fichier. La resolution generique produisait `src/requests/.adapters`, un
  // fichier cache qui n'existe evidemment pas — et tout le coeur d'une
  // bibliotheque Python passait pour du code mort. Aucune de mes fixtures ne
  // l'a montre : elles utilisent toutes des imports absolus.
  if (file_family(fromFile) === 'python' && isRelative) {
    const points = /^\.+/.exec(target)[0].length;
    const reste = target.slice(points).replace(/\./g, '/');

    // Un point : le paquet courant. Chaque point supplementaire remonte d'un
    // cran, comme `..` dans un chemin.
    let dossier = path.posix.dirname(fromFile.relativePath);
    for (let i = 1; i < points; i++) dossier = path.posix.dirname(dossier);

    const base = reste ? path.posix.join(dossier, reste) : dossier;
    const candidats = [`${base}.py`, `${base}/__init__.py`];
    // `from . import adapters` : le nom importe designe le module.
    for (const nom of importedNames) candidats.push(`${base}/${nom}.py`);
    return findFile(context, candidats);
  }

  if (file_family(fromFile) === 'python' && !isRelative) {
    const base = target.replace(/\./g, '/');
    const candidats = [`${base}.py`, `${base}/__init__.py`];
    // `from blog import views` : le module cible est `blog/views.py`, pas
    // seulement le paquet `blog`. Sans cela, tout un projet Django parait mort.
    for (const nom of importedNames) candidats.push(`${base}/${nom}.py`);
    return findFile(context, candidats);
  }

  if (!isRelative && !isAbsoluteProject) return null; // paquet externe

  const base = isRelative
    ? path.posix.normalize(path.posix.join(path.posix.dirname(fromFile.relativePath), target))
    : target.replace(/^\//, '');

  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.dart', '.py', '.php'];
  const candidates = [];
  for (const ext of extensions) candidates.push(`${base}${ext}`);
  for (const ext of extensions.slice(1)) candidates.push(`${base}/index${ext}`);

  return findFile(context, candidates);
}

function findFile(context, candidates) {
  for (const candidate of candidates) {
    const normalized = candidate.replace(/^\.\//, '');
    if (context.byPath.has(normalized)) return normalized;
  }
  return null;
}

function file_family(file) {
  return file.family;
}

/** Points d'entree implicites : ces fichiers ne sont jamais « morts ». */
export function isEntryPoint(file, context) {
  // Les conventions de framework sont relatives a *l'application*, pas au
  // depot : dans un monorepo, `apps/web/pages/contact.jsx` est une page
  // Next.js, chargee par le routeur. Juger sur le chemin depuis la racine la
  // declarait morte, ce qui est le pire des faux positifs — il designe du
  // code parfaitement vivant.
  const perimetre = context.perimetreDe ? context.perimetreDe(file) : context;
  const rel = perimetre.relatif ? perimetre.relatif(file.relativePath) : file.relativePath;
  const name = file.name;

  const pkg = perimetre.manifests['package.json']?.data;
  if (pkg) {
    const declared = [pkg.main, pkg.module, pkg.browser, pkg.types, ...(Object.values(pkg.bin || {}) || [])]
      .filter((v) => typeof v === 'string')
      .map((v) => v.replace(/^\.\//, ''));
    if (declared.includes(rel)) return true;
    if (pkg.exports && JSON.stringify(pkg.exports).includes(rel.replace(/^\.\//, ''))) return true;
  }

  if (/^(index|main|app|server|bootstrap|entry|__init__|manage|wsgi|asgi|setup|program|Program|Application)\./i.test(name)) return true;
  // Scripts de construction : executes par l'outil de build, jamais importes.
  if (/^(build|settings)\.gradle(\.kts)?$|^Package\.swift$|^(Makefile|Rakefile|Gemfile|Brewfile)$/.test(name)) return true;
  // Fichiers de declaration de routes : charges par convention, pas importes.
  if (/^(routes?|web|api|urls|urlpatterns|router)\.[\w]+$/i.test(name)) return true;
  // Fichiers charges par convention de framework — jamais importes explicitement :
  // Django/DRF, Flask, Rails, Laravel, Celery.
  if (/^(settings|views|models|admin|apps|forms|serializers|permissions|filters|signals|tasks|middleware|consumers|routing|celery|conftest|schema|urls)\.py$/i.test(name)) return true;
  if (/(^|\/)(migrations|management\/commands|templatetags)\//.test(rel)) return true;
  // Laravel, Symfony, Rails : charges par le framework, jamais importes.
  if (/(^|\/)(config|bootstrap|resources\/views|resources\/lang|database\/(migrations|seeders|factories)|app\/views|app\/helpers|lang)\//.test(rel)) return true;
  if (/\.(blade\.php|twig|erb|liquid|njk|j2|jinja2?)$/i.test(name)) return true;
  // Rails autocharge tout app/ par convention de nommage.
  if (/(^|\/)app\/(controllers|models|helpers|jobs|mailers|channels|services|serializers|policies)\//.test(rel)) return true;
  // Spring instancie ses composants par scan du classpath, a partir des
  // annotations : aucune classe annotee n'est jamais importee explicitement.
  if (/(^|\/)src\/main\/(java|kotlin|resources)\//.test(rel)) return true;
  // Nuxt, SvelteKit, Astro : dossiers charges par convention de nom de fichier.
  if (/(^|\/)(server\/(api|routes|middleware|plugins)|composables|plugins|middleware|layouts|content)\//.test(rel)) return true;
  if (/(^|\/)src\/(routes|pages|content|params|hooks)\//.test(rel)) return true;
  if (/^\+(page|layout|server|error)(\.|$)/.test(name) || /\.(astro|vue|svelte)$/.test(name)) return true;
  // Manifestes de dependances : ce sont des declarations, pas du code appele.
  if (/^(Gemfile|Rakefile|Podfile|Brewfile|Fastfile|Appfile)$/i.test(name)) return true;
  if (/^(pages|app|src\/pages|src\/app|src\/routes|routes|views|controllers|migrations|api)\//.test(rel)) return true;
  if (/\.(config|conf|rc|test|spec|stories|d)\.[\w]+$/.test(name)) return true;
  if (/^(middleware|layout|error|loading|not-found|template|page|route|head|sitemap|robots|manifest|opengraph-image)\./.test(name)) return true;
  if (/(^|\/)(bin|scripts?|cli|tools?|public|static)\//.test(rel)) return true;
  if (/\.(html?|css|scss|less|json|ya?ml|md|toml|xml|txt|sql|sh)$/i.test(name)) return true;
  // Cible d'une carte d'imports : c'est le navigateur qui la resout, aucun
  // fichier JavaScript ne la mentionne.
  if (estCibleDeCarteDImports(file, context)) return true;
  // Charge par le navigateur et non par un import : `<script src>` d'une page,
  // ou enregistrement d'un service worker. Aucun module ne les mentionne, et
  // ils passaient donc pour du code mort — sur le site d'Argus lui-meme.
  if (estCharguParLeNavigateur(file, context)) return true;
  return false;
}

/**
 * Fichiers references depuis du HTML ou une API du navigateur.
 *
 * Deux formes echappent au graphe d'imports :
 *   - `<script src="./pwa.js">`, resolu par le navigateur ;
 *   - `navigator.serviceWorker.register('./sw.js')`, ou le chemin est une
 *     simple chaine de caracteres.
 *
 * Le resultat est memorise : la reponse est la meme pour tout le projet.
 */
function estCharguParLeNavigateur(file, context) {
  let cibles = context.shared.get('ciblesNavigateur');
  if (!cibles) {
    cibles = new Set();

    const ajouter = (source, chemin) => {
      if (!chemin || /^(https?:)?\/\//.test(chemin)) return;
      const resolu = path.posix.normalize(
        path.posix.join(path.posix.dirname(source.relativePath), chemin.split('?')[0]),
      );
      cibles.add(resolu.replace(/^\.\//, ''));
    };

    for (const fichier of context.files) {
      if (!fichier.readable) continue;

      if (fichier.language === 'html') {
        for (const m of fichier.content.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
          ajouter(fichier, m[1]);
        }
      }

      if (fichier.family === 'js') {
        for (const m of fichier.content.matchAll(
          /serviceWorker\s*\.\s*register\s*\(\s*["']([^"']+)["']/g,
        )) {
          ajouter(fichier, m[1]);
        }
        // Le script de preload d'Electron est designe par un chemin construit
        // a l'execution — `preload: join(__dirname, 'preload.js')`. Aucun
        // import ne le mentionne, et il passait donc pour du code mort alors
        // qu'il est le pont entre la fenetre et le systeme.
        for (const m of fichier.content.matchAll(
          // La virgule est autorisee : le chemin est presque toujours
          // construit par `join(__dirname, 'preload.js')`.
          /\bpreload\s*:[^\n]{0,80}?["']([^"']+\.[cm]?[jt]s)["']/g,
        )) {
          ajouter(fichier, m[1]);
        }
        // `new Worker('./x.js')` releve exactement du meme mecanisme.
        for (const m of fichier.content.matchAll(
          /new\s+(?:Shared)?Worker\s*\(\s*["']([^"']+)["']/g,
        )) {
          ajouter(fichier, m[1]);
        }
      }
    }

    context.shared.set('ciblesNavigateur', cibles);
  }

  return cibles.has(file.relativePath);
}

/**
 * Modules references depuis un `<script type="importmap">`.
 * Le resultat est memorise : la carte est la meme pour tout le projet.
 */
function estCibleDeCarteDImports(file, context) {
  let cibles = context.shared.get('importMapTargets');
  if (!cibles) {
    cibles = new Set();
    for (const page of context.files) {
      if (page.language !== 'html' || !page.readable) continue;
      const carte = /<script[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(page.content);
      if (!carte) continue;
      try {
        const imports = JSON.parse(carte[1]).imports || {};
        for (const valeur of Object.values(imports)) {
          if (typeof valeur !== 'string' || !valeur.startsWith('.')) continue;
          const resolu = path.posix.normalize(path.posix.join(path.posix.dirname(page.relativePath), valeur));
          cibles.add(resolu.replace(/^\.\//, ''));
        }
      } catch {
        /* carte illisible : on ne peut rien en deduire */
      }
    }
    context.shared.set('importMapTargets', cibles);
  }
  return cibles.has(file.relativePath);
}
