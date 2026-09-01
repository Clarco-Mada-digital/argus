import { parseHtml } from '../core/html.js';
import { lineIndexFor, matches } from '../core/scan.js';
import { isHtmlLike } from '../core/languages.js';

/**
 * Analyseur de performance web : poids des ressources, chemin critique de
 * rendu, Core Web Vitals, et anti-patterns de calcul cote code.
 */
export default {
  id: 'performance',
  category: 'performance',
  label: 'Performance',
  order: 60,

  async run(context, report) {
    const options = context.config.options.performance;

    analyzeAssets(context, options, report);
    analyzeCriticalPath(context, report);
    analyzeFonts(context, report);
    analyzeCodePatterns(context, report);
    analyzeBundleWeight(context, options, report);
  },
};

function analyzeAssets(context, options, report) {
  const images = context.files.filter((f) => f.image);
  let totalImageBytes = 0;

  for (const image of images) {
    totalImageBytes += image.size;
    if (image.size <= options.maxImageBytes) continue;

    const modern = /\.(webp|avif)$/i.test(image.name);
    report({
      ruleId: 'PERF-HEAVY-IMAGE',
      severity: image.size > 1024 * 1024 ? 'high' : 'medium',
      title: 'Image trop lourde',
      message: `${image.relativePath} pese ${formatBytes(image.size)}. Sur une connexion mobile a 3 Mb/s, cela represente environ ${(image.size / (3 * 1024 * 1024 / 8)).toFixed(1)} s de telechargement.`,
      file: image.relativePath,
      suggestion: modern
        ? 'Reduisez la qualite d\'encodage (75-80 suffit generalement) et redimensionnez a la taille reellement affichee.'
        : 'Convertissez en WebP ou AVIF (30 a 60 % de gain), redimensionnez a la taille d\'affichage, et servez plusieurs resolutions via srcset.',
      effort: 'rapide',
      tags: ['lcp', 'cwv'],
      data: { bytes: image.size },
    });
  }

  const svgs = images.filter((f) => f.ext === '.svg' && f.size > 50 * 1024);
  for (const svg of svgs) {
    report({
      ruleId: 'PERF-HEAVY-SVG',
      severity: 'low',
      title: 'SVG non optimise',
      message: `${svg.relativePath} pese ${formatBytes(svg.size)} : un SVG de cette taille contient generalement des metadonnees d'editeur et des chemins non simplifies.`,
      file: svg.relativePath,
      suggestion: 'Passez le fichier dans SVGO (npx svgo --multipass) ; le gain depasse souvent 60 %.',
      effort: 'rapide',
    });
  }

  const heavyOthers = context.files.filter(
    (f) => !f.image && f.size > options.maxAssetBytes && /\.(js|css|json|mp4|webm|zip|pdf)$/i.test(f.name),
  );
  for (const asset of heavyOthers.slice(0, 20)) {
    report({
      ruleId: 'PERF-HEAVY-ASSET',
      severity: 'medium',
      title: 'Ressource volumineuse',
      message: `${asset.relativePath} pese ${formatBytes(asset.size)}.`,
      file: asset.relativePath,
      suggestion: /\.(mp4|webm)$/i.test(asset.name)
        ? 'Hebergez les videos sur un service de streaming, ou compressez en H.264/VP9 avec preload="none" et une image de poster.'
        : 'Decoupez le fichier (import dynamique), compressez-le (Brotli), ou chargez-le a la demande.',
      effort: 'moyen',
      data: { bytes: asset.size },
    });
  }

  if (totalImageBytes > 5 * 1024 * 1024) {
    report({
      ruleId: 'PERF-TOTAL-IMAGES',
      severity: 'low',
      title: 'Poids total des images eleve',
      message: `${images.length} images pour ${formatBytes(totalImageBytes)} au total.`,
      suggestion: 'Mettez en place un pipeline d\'optimisation a la construction (sharp, imagemin, next/image, ou un CDN d\'images).',
      effort: 'moyen',
    });
  }
}

function analyzeCriticalPath(context, report) {
  for (const file of context.sources({ families: ['markup'] })) {
    if (!isHtmlLike(file.language)) continue;
    const nodes = parseHtml(file.content);
    const index = lineIndexFor(file);
    const head = nodes.find((n) => n.tag === 'head');
    const bodyStart = nodes.find((n) => n.tag === 'body')?.start ?? Number.MAX_SAFE_INTEGER;

    const blockingScripts = nodes.filter(
      (n) => n.tag === 'script' && n.has('src') && !n.has('async') && !n.has('defer') && n.attr('type') !== 'module' && n.start < bodyStart,
    );
    for (const script of blockingScripts) {
      report({
        ruleId: 'PERF-BLOCKING-SCRIPT',
        severity: 'medium',
        title: 'Script bloquant dans le <head>',
        message: `Le script "${script.attr('src')}" est charge de maniere synchrone avant le rendu : il retarde l'affichage du premier pixel.`,
        file: file.relativePath,
        line: index.lineOf(script.start),
        snippet: file.content.slice(script.start, script.end),
        suggestion: 'Ajoutez defer (execution apres le parsing, ordre conserve) ou async (independant). Deplacez en fin de <body> en dernier recours.',
        effort: 'rapide',
        tags: ['fcp', 'lcp', 'cwv'],
      });
    }

    const externalCss = nodes.filter((n) => n.tag === 'link' && /stylesheet/i.test(n.attr('rel') || ''));
    if (externalCss.length > 4) {
      report({
        ruleId: 'PERF-TOO-MANY-CSS',
        severity: 'low',
        title: 'Trop de feuilles de style',
        message: `${externalCss.length} feuilles de style externes : autant de requetes bloquantes avant le premier rendu.`,
        file: file.relativePath,
        line: index.lineOf(externalCss[0].start),
        suggestion: 'Concatenez les feuilles a la construction, inlinez le CSS critique (~14 Ko) et chargez le reste en differe.',
        effort: 'moyen',
        tags: ['fcp'],
      });
    }

    const hasPreconnect = nodes.some((n) => n.tag === 'link' && /preconnect|dns-prefetch/i.test(n.attr('rel') || ''));
    const externalOrigins = new Set();
    for (const node of nodes) {
      const url = node.attr('src') || node.attr('href') || '';
      const match = /^https?:\/\/([^/]+)/i.exec(url);
      if (match) externalOrigins.add(match[1]);
    }
    if (externalOrigins.size >= 2 && !hasPreconnect) {
      report({
        ruleId: 'PERF-NO-PRECONNECT',
        severity: 'info',
        title: 'Origines externes sans preconnect',
        message: `La page charge des ressources depuis ${externalOrigins.size} domaines externes (${[...externalOrigins].slice(0, 3).join(', ')}) sans etablir la connexion a l'avance.`,
        file: file.relativePath,
        line: head ? index.lineOf(head.start) : 1,
        suggestion: 'Ajoutez <link rel="preconnect" href="https://domaine-externe" crossorigin> pour les origines critiques (polices, CDN).',
        effort: 'rapide',
      });
    }
  }
}

function analyzeFonts(context, report) {
  const fontFiles = context.files.filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f.name));
  const styleFiles = context.sources({ families: ['style'] });
  const allStyles = styleFiles.map((f) => f.content).join('\n');

  const legacyFonts = fontFiles.filter((f) => /\.(ttf|otf|eot)$/i.test(f.name));
  if (legacyFonts.length > 0) {
    report({
      ruleId: 'PERF-FONT-FORMAT',
      severity: 'low',
      title: 'Police dans un format non optimise',
      message: `${legacyFonts.length} fichier(s) de police en TTF/OTF/EOT. Le format WOFF2 est 30 a 50 % plus leger et supporte partout.`,
      file: legacyFonts[0].relativePath,
      suggestion: 'Convertissez en WOFF2 (fonttools, woff2_compress) et ne servez que ce format.',
      effort: 'rapide',
    });
  }

  if (/@font-face/.test(allStyles) && !/font-display\s*:/.test(allStyles)) {
    const file = styleFiles.find((f) => /@font-face/.test(f.content));
    report({
      ruleId: 'PERF-FONT-DISPLAY',
      severity: 'medium',
      title: 'font-display non defini',
      message: 'Sans font-display, le texte reste invisible pendant le chargement de la police (Flash of Invisible Text) : jusqu\'a 3 secondes de page blanche.',
      file: file?.relativePath ?? null,
      line: file ? lineIndexFor(file).lineOf(file.content.indexOf('@font-face')) : 1,
      suggestion: 'Ajoutez font-display: swap; dans chaque bloc @font-face, et preloadez la police du titre principal.',
      effort: 'rapide',
      tags: ['cls', 'lcp', 'cwv'],
    });
  }
}

function analyzeCodePatterns(context, report) {
  const patterns = [
    {
      id: 'PERF-AWAIT-IN-LOOP',
      re: /for\s*\([^)]*\)\s*\{[^}]{0,400}?await\s+/g,
      families: ['js'],
      severity: 'medium',
      title: 'await dans une boucle',
      message: 'Chaque iteration attend la precedente : le temps total est la somme des appels au lieu du plus long.',
      suggestion: 'Lancez les operations en parallele : await Promise.all(items.map(async (item) => …)). Bornez la concurrence si le service cible est fragile.',
    },
    {
      id: 'PERF-NESTED-LOOP-QUERY',
      // Volontairement limite aux methodes d'acces aux donnees : `.find(` et
      // `.filter(` sur un tableau sont des operations en memoire, sans requete.
      // Trois familles d'acces aux donnees : methodes explicitement nommees,
      // objets de connexion, et les ORM « par convention » (Django, Rails,
      // Eloquent) ou l'appel ne porte aucun de ces noms.
      re: /for\s*[^{]*\{[^}]{0,300}?\.(findOne|findById|findUnique|findMany|queryRow|fetchOne|fetchAll|executeQuery|aggregate)\s*\(|for\s*[^{]*\{[^}]{0,300}?\b(?:db|conn|connection|session|cursor|repository|repo|prisma|knex|orm)\b[^;{}]{0,60}\.(query|execute|find|get|select|insert|update|delete|save)\s*\(|for\s*[^{]*\{[^}]{0,300}?\.objects\.(get|filter|all|first|count|exists)\s*\(|for(?:each)?\s*\([^{]*\{[^}]{0,300}?(?:->|::)(?:find|first|firstOrFail|findOrFail|where)\s*\(/g,
      families: ['js', 'python', 'php', 'jvm'],
      severity: 'high',
      title: 'Requete dans une boucle (probleme N+1)',
      message: 'Une requete par element : le nombre d\'appels a la base croit lineairement avec les donnees.',
      suggestion: 'Chargez tout en une requete (WHERE id IN (…), jointure, ou eager loading de l\'ORM) puis regroupez en memoire.',
    },
    {
      // Python et Ruby n'ont pas d'accolades : la boucle se delimite par
      // l'indentation. Il faut donc un motif distinct de celui des langages
      // a accolades, sinon aucun N+1 Django ou Rails n'est jamais vu.
      id: 'PERF-NESTED-LOOP-QUERY',
      re: /(?:\bfor\s+\w+\s+in\s+[^\n]+:|\.each\s+do\s*\|[^|]*\|)[^\n]*\n(?:[^\n]*\n){0,12}?[ \t]+[^\n]*(?:\.objects\.(?:get|filter|all|first|count|exists)|\.query\(|session\.(?:query|execute)|cursor\.execute|\.find_by_\w+|\.where\(|\b[A-Z]\w*\.(?:find|find_by|where|first)\()/g,
      families: ['python', 'ruby'],
      severity: 'high',
      title: 'Requete dans une boucle (probleme N+1)',
      message: 'Une requete par element : le nombre d\'appels a la base croit lineairement avec les donnees.',
      suggestion:
        'Chargez tout en une fois. Avec Django : select_related() pour une cle etrangere, prefetch_related() pour une relation inverse ou many-to-many. Avec SQLAlchemy : joinedload(). Avec Rails : includes().',
    },
    {
      id: 'PERF-DOM-IN-LOOP',
      re: /for\s*\([^)]*\)\s*\{[^}]{0,300}?(document\.(getElementById|querySelector)|\.appendChild)/g,
      families: ['js'],
      severity: 'medium',
      title: 'Manipulation du DOM dans une boucle',
      message: 'Chaque insertion declenche un recalcul de mise en page.',
      suggestion: 'Construisez un DocumentFragment (ou une chaine) puis inserez-le en une seule operation.',
    },
    {
      id: 'PERF-SYNC-IO',
      re: /(?<!function\s)(?<!\.)\b(readFileSync|writeFileSync|execSync|existsSync)\s*\(/g,
      // Une declaration n'est pas un appel : `export function existsSync(...)`
      // decrit une API, il ne lit rien.
      ignoreLine: /^\s*(export\s+)?(async\s+)?function\s|=>\s*\{?\s*$|^\s*(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/,
      families: ['js'],
      severity: 'medium',
      title: 'Entree/sortie synchrone',
      message: 'Une operation synchrone bloque la boucle d\'evenements : toutes les requetes en cours sont mises en attente.',
      suggestion: 'Utilisez la version asynchrone (fs/promises). Les versions synchrones sont acceptables uniquement au demarrage.',
      ignoreIf: (file) => /(^|\/)(bin|scripts?|tools?|config)\//.test(file.relativePath) || file.isTest,
    },
    {
      id: 'PERF-SELECT-STAR',
      re: /SELECT\s+\*\s+FROM/gi,
      families: ['*'],
      severity: 'low',
      title: 'SELECT * en base',
      message: 'Toutes les colonnes sont transferees, y compris les champs volumineux inutiles.',
      suggestion: 'Listez explicitement les colonnes necessaires : c\'est plus rapide et cela evite les surprises quand le schema evolue.',
    },
    {
      id: 'PERF-MOMENT',
      re: /require\s*\(\s*['"]moment['"]\s*\)|from\s+['"]moment['"]/g,
      families: ['js'],
      severity: 'low',
      title: 'Bibliotheque moment.js',
      message: 'moment.js ajoute environ 290 Ko au bundle et n\'est plus maintenue.',
      suggestion: 'Migrez vers date-fns (modulaire), day.js (2 Ko) ou l\'API native Intl.DateTimeFormat / Temporal.',
    },
    {
      id: 'PERF-FULL-LODASH',
      re: /require\s*\(\s*['"]lodash['"]\s*\)|from\s+['"]lodash['"]/g,
      families: ['js'],
      severity: 'low',
      title: 'Import global de lodash',
      message: 'Importer lodash en entier tire environ 70 Ko meme si vous n\'utilisez qu\'une fonction.',
      suggestion: 'Importez la fonction seule : import debounce from "lodash/debounce", ou utilisez les equivalents natifs.',
    },
  ];

  for (const file of context.sources()) {
    if (!file.readable) continue;
    for (const pattern of patterns) {
      if (!pattern.families.includes('*') && !pattern.families.includes(file.family)) continue;
      if (pattern.ignoreIf && pattern.ignoreIf(file)) continue;
      const index = lineIndexFor(file);
      let count = 0;
      let firstOffset = null;
      for (const match of matches(file.content, pattern.re)) {
        if (pattern.ignoreLine && pattern.ignoreLine.test(index.textOfLine(index.lineOf(match.index)))) continue;
        count++;
        if (firstOffset === null) firstOffset = match.index;
      }
      if (count === 0) continue;

      report({
        ruleId: pattern.id,
        severity: pattern.severity,
        title: pattern.title,
        message: `${pattern.message}${count > 1 ? ` (${count} occurrences dans ce fichier)` : ''}`,
        file: file.relativePath,
        line: index.lineOf(firstOffset),
        snippet: index.textOfLine(index.lineOf(firstOffset)),
        suggestion: pattern.suggestion,
        effort: 'moyen',
        confidence: 'tentative',
        data: { count },
      });
    }
  }
}

function analyzeBundleWeight(context, options, report) {
  const pkg = context.manifests['package.json']?.data;
  if (!pkg) return;

  const heavyPackages = {
    'react-icons': '~1 Mo si importe globalement',
    'chart.js': '~250 Ko',
    'aws-sdk': '~5 Mo (utilisez @aws-sdk/client-* v3)',
    jquery: '~90 Ko, generalement remplacable par du DOM natif',
    bootstrap: '~200 Ko CSS+JS ; envisagez uniquement les composants utilises',
    'material-ui': 'lourd ; verifiez le tree-shaking',
    '@mui/material': 'verifiez les imports nommes pour permettre le tree-shaking',
  };

  const deps = { ...(pkg.dependencies || {}) };
  for (const [name, note] of Object.entries(heavyPackages)) {
    if (!deps[name]) continue;
    report({
      ruleId: 'PERF-HEAVY-DEPENDENCY',
      severity: 'info',
      title: `Dependance lourde : ${name}`,
      message: `${name} est declaree en dependance de production (${note}).`,
      file: context.manifests['package.json'].file.relativePath,
      line: 1,
      suggestion: 'Verifiez que seuls les modules necessaires sont importes, et mesurez l\'impact reel avec un analyseur de bundle avant d\'arbitrer.',
      effort: 'moyen',
      data: { package: name },
    });
  }

  const hasBuildTool = context.has('vite', 'webpack', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby');
  const jsFiles = context.sources({ families: ['js'] });
  if (!hasBuildTool && jsFiles.length > 15 && context.has('static-site')) {
    report({
      ruleId: 'PERF-NO-BUILD-STEP',
      severity: 'medium',
      title: 'Aucun outil de construction',
      message: `${jsFiles.length} fichiers JavaScript sont servis sans etape de construction : ni minification, ni regroupement, ni suppression du code mort.`,
      suggestion: 'Ajoutez Vite (configuration minimale) : minification, decoupage automatique et tree-shaking pour un cout de mise en place tres faible.',
      effort: 'moyen',
    });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}
