import path from 'node:path';

/**
 * Table de correspondance extension -> langage.
 * L'ajout d'un langage se fait ici + un adaptateur optionnel dans src/lang/.
 */
const BY_EXTENSION = {
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.astro': 'astro',
  '.html': 'html',
  '.htm': 'html',
  '.xhtml': 'html',
  '.ejs': 'html',
  '.hbs': 'html',
  '.twig': 'twig',
  '.erb': 'erb',
  '.liquid': 'liquid',
  '.njk': 'nunjucks',
  '.j2': 'jinja',
  '.jinja': 'jinja',
  '.jinja2': 'jinja',
  '.mustache': 'html',
  '.pug': 'pug',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.dart': 'dart',
  '.go': 'go',
  '.rs': 'rust',
  '.rb': 'ruby',
  '.erb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.scala': 'scala',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.m': 'objectivec',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.sql': 'sql',
  '.json': 'json',
  '.jsonc': 'json',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.txt': 'text',
  '.env': 'dotenv',
  '.tf': 'terraform',
  '.gradle': 'gradle',
  '.dockerfile': 'dockerfile',
};

const BY_FILENAME = {
  dockerfile: 'dockerfile',
  'docker-compose.yml': 'yaml',
  makefile: 'makefile',
  '.env': 'dotenv',
  '.htaccess': 'apache',
  'nginx.conf': 'nginx',
  gemfile: 'ruby',
  rakefile: 'ruby',
  'robots.txt': 'text',
};

/** Familles utilisees par les analyseurs pour choisir leurs heuristiques. */
const LANGUAGE_FAMILY = {
  javascript: 'js',
  typescript: 'js',
  vue: 'js',
  svelte: 'js',
  astro: 'js',
  python: 'python',
  java: 'jvm',
  kotlin: 'jvm',
  scala: 'jvm',
  dart: 'dart',
  go: 'go',
  rust: 'rust',
  ruby: 'ruby',
  php: 'php',
  csharp: 'dotnet',
  swift: 'swift',
  c: 'native',
  cpp: 'native',
  objectivec: 'native',
  html: 'markup',
  pug: 'markup',
  xml: 'markup',
  // Gabarits serveur : du HTML entrecoupe de directives. Les analyser comme du
  // balisage rend le SEO et l'accessibilite disponibles pour Laravel, Symfony,
  // Rails ou Flask — sans quoi les vues de ces projets restent des angles morts.
  blade: 'markup',
  twig: 'markup',
  erb: 'markup',
  liquid: 'markup',
  nunjucks: 'markup',
  jinja: 'markup',
  css: 'style',
  scss: 'style',
  less: 'style',
};

/** Commentaires de ligne / bloc, pour ignorer le code commente si besoin. */
export const COMMENT_SYNTAX = {
  js: { line: '//', block: ['/*', '*/'] },
  python: { line: '#', block: ['"""', '"""'] },
  jvm: { line: '//', block: ['/*', '*/'] },
  dart: { line: '//', block: ['/*', '*/'] },
  go: { line: '//', block: ['/*', '*/'] },
  rust: { line: '//', block: ['/*', '*/'] },
  ruby: { line: '#', block: ['=begin', '=end'] },
  php: { line: '//', block: ['/*', '*/'] },
  dotnet: { line: '//', block: ['/*', '*/'] },
  swift: { line: '//', block: ['/*', '*/'] },
  native: { line: '//', block: ['/*', '*/'] },
  style: { line: '//', block: ['/*', '*/'] },
  markup: { line: null, block: ['<!--', '-->'] },
};

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tiff',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.flac',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.so', '.dll', '.dylib', '.exe', '.bin', '.class', '.jar', '.wasm',
  '.pyc', '.o', '.a', '.apk', '.aab', '.ipa', '.db', '.sqlite',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp', '.tiff']);

/** Langages de gabarit assimiles a du HTML pour le SEO et l'accessibilite. */
const TEMPLATE_LANGUAGES = new Set(['html', 'blade', 'twig', 'erb', 'liquid', 'nunjucks', 'jinja']);

/** Le fichier produit-il du HTML destine a un navigateur ? */
export function isHtmlLike(language) {
  return TEMPLATE_LANGUAGES.has(language);
}

export function detectLanguage(filePath) {
  const base = path.basename(filePath).toLowerCase();
  if (BY_FILENAME[base]) return BY_FILENAME[base];
  // `.blade.php` est un gabarit Laravel, pas un fichier PHP ordinaire.
  if (base.endsWith('.blade.php')) return 'blade';
  if (base.startsWith('.env')) return 'dotenv';
  if (base.startsWith('dockerfile')) return 'dockerfile';
  const ext = path.extname(base);
  return BY_EXTENSION[ext] || 'unknown';
}

export function familyOf(language) {
  return LANGUAGE_FAMILY[language] || language;
}

export function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isImage(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Fichiers source « reels » : exclut json/markdown/config du calcul de qualite. */
export function isSourceCode(language) {
  return Boolean(LANGUAGE_FAMILY[language]) && LANGUAGE_FAMILY[language] !== 'markup';
}
