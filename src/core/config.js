import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_IDS } from './severity.js';

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.output/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/env/**',
  '**/target/**',
  '**/.gradle/**',
  '**/.dart_tool/**',
  '**/Pods/**',
  '**/.idea/**',
  '**/.vscode/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.bundle.js',
  '**/*.map',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/argus-report.*',
  '**/.argus/**',
  // Sorties de collecte et d'outillage Python, signalees depuis le terrain :
  // `staticfiles/` est produit par `collectstatic`, personne ne l'edite.
  '**/staticfiles/**',
  '**/static_root/**',
  '**/site-packages/**',
  '**/.tox/**',
  '**/htmlcov/**',
  '**/.pytest_cache/**',
  '**/.mypy_cache/**',
  '**/.ruff_cache/**',
];

export const DEFAULT_CONFIG = {
  /** Racine analysee (resolue par la CLI). */
  root: '.',
  /** Categories activees. */
  categories: [...CATEGORY_IDS],
  /** Patterns ignores en plus de .gitignore. */
  ignore: [],
  /** Utiliser le .gitignore du projet. */
  useGitignore: true,
  /** Inclure les fichiers de test dans l'analyse de securite. */
  includeTests: false,
  /** Severite minimale rapportee. */
  minSeverity: 'info',
  /** Severite qui fait echouer la commande (CI). */
  failOn: 'high',
  /** Score global minimal accepte (0 = desactive). */
  failUnderScore: 0,
  /** Taille max d'un fichier lu, en octets. */
  maxFileSize: 2 * 1024 * 1024,
  /** Nombre max de fichiers analyses (garde-fou). */
  maxFiles: 20000,
  /**
   * Plateformes visees, si la deduction se trompe : ['web'], ['desktop'],
   * ['mobile'], ou une combinaison. Vide = Argus deduit.
   */
  platforms: [],
  /** Regles desactivees, par identifiant ou prefixe (ex: "SEC-" ). */
  disabledRules: [],
  /** Surcharges de severite : { "SEO-001": "low" }. */
  ruleSeverity: {},
  /** URL de production, pour les regles SEO (canonical, sitemap). */
  siteUrl: null,
  /** URL a explorer reellement (null = analyse statique uniquement). */
  crawl: null,
  /** Reference Git : ne rapporter que ce que les changements introduisent. */
  since: null,
  /** Reglages de l'exploration HTTP. */
  crawlOptions: {
    maxPages: 50,
    maxDepth: 4,
    concurrency: 4,
    delayMs: 150,
    timeoutMs: 15000,
    respectRobots: true,
    checkExternal: true,
  },
  /** Fichier de baseline (empreintes a ignorer). */
  baseline: '.argus/baseline.json',
  /** Options par analyseur. */
  options: {
    quality: {
      maxComplexity: 15,
      maxFileLines: 500,
      maxFunctionLines: 80,
      maxParams: 5,
      duplicationMinLines: 6,
    },
    design: {
      minContrastRatio: 4.5,
      minTapTargetPx: 44,
      minFontSizePx: 12,
    },
    seo: {
      minWordCount: 250,
      titleMin: 30,
      titleMax: 60,
      descriptionMin: 70,
      descriptionMax: 160,
    },
    performance: {
      maxImageBytes: 300 * 1024,
      maxAssetBytes: 1024 * 1024,
    },
  },
};

const CONFIG_FILENAMES = [
  'argus.config.json',
  '.argusrc.json',
  '.argusrc',
];

/**
 * Charge la configuration : defauts <- fichier <- surcharges CLI.
 * @param {string} root racine du projet
 * @param {object} overrides surcharges (ligne de commande ou API)
 * @param {string} [configPath] fichier de configuration explicite
 */
export function loadConfig(root, overrides = {}, configPath = null) {
  const fileConfig = configPath ? readConfigAt(configPath) : readConfigFile(root);
  const config = deepMerge(deepMerge(structuredClone(DEFAULT_CONFIG), fileConfig), overrides);

  config.root = root;
  config.ignore = [...DEFAULT_IGNORES, ...(fileConfig.ignore || []), ...(overrides.ignore || [])];

  if (config.useGitignore) {
    config.ignore.push(...readGitignore(root));
  }

  config.categories = config.categories.filter((id) => CATEGORY_IDS.includes(id));
  if (config.categories.length === 0) config.categories = [...CATEGORY_IDS];

  /**
   * Clefs posees explicitement par l'utilisateur.
   *
   * Certaines options ont une valeur par defaut que les analyseurs surchargent
   * volontairement — `includeTests` en est le cas type : sa valeur par defaut
   * est `false`, mais la securite et le code mort demandent quand meme a lire
   * les tests, parce qu'un vrai secret dans un test reste un vrai secret.
   *
   * Il faut donc distinguer « personne n'a rien dit » de « l'utilisateur a
   * ecrit non ». Une consigne explicite l'emporte ; un defaut se laisse
   * surcharger.
   */
  Object.defineProperty(config, 'explicites', {
    value: new Set([...Object.keys(fileConfig || {}), ...Object.keys(overrides || {})]),
    enumerable: false,
  });

  return config;
}

function readConfigFile(root) {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(root, name);
    // argus-disable-next-line — lecture de configuration, une seule fois au demarrage
    if (!fs.existsSync(candidate)) continue;
    return readConfigAt(candidate);
  }
  return {};
}

/** Lit un fichier de configuration designe explicitement (option --config). */
function readConfigAt(candidate) {
  const resolu = path.resolve(candidate);
  // argus-disable-next-line — lecture de configuration, une seule fois au demarrage
  if (!fs.existsSync(resolu)) {
    throw new Error(`Fichier de configuration introuvable : ${candidate}`);
  }
  try {
    const parsed = JSON.parse(stripJsonComments(fs.readFileSync(resolu, 'utf8')));
    parsed.__configPath = resolu;
    return parsed;
  } catch (error) {
    throw new Error(`Configuration invalide dans ${path.basename(resolu)} : ${error.message}`);
  }
}

function readGitignore(root) {
  const file = path.join(root, '.gitignore');
  if (!fs.existsSync(file)) return [];
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Retire les commentaires d'un JSON permissif (tsconfig, jsconfig).
 *
 * L'implementation par expressions regulieres etait fausse, et son echec
 * silencieux : elle ne distinguait pas un commentaire d'une chaine. Un
 * `package.json` moderne declare ses sous-chemins avec des jokers —
 * `"./unsafe/*": "./lib/*"` — et le `/*` y etait pris pour une ouverture de
 * commentaire. Tout ce qui suivait, jusqu'au `*​/` suivant, disparaissait.
 *
 * Le manifeste devenait alors illisible, `data` valait `null`, et l'analyse
 * continuait sans le dire : aucune dependance detectee, aucun framework
 * reconnu, aucune vulnerabilite recherchee. Le rapport paraissait normal.
 * Trouve sur `axios` — c'est-a-dire sur le premier vrai projet regarde de
 * pres.
 *
 * On parcourt donc les caracteres en suivant l'etat des chaines.
 */
export function stripJsonComments(text) {
  let sortie = '';
  let dansUneChaine = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (dansUneChaine) {
      sortie += c;
      if (c === '\\') { sortie += text[i + 1] ?? ''; i += 2; continue; }
      if (c === '"') dansUneChaine = false;
      i++;
      continue;
    }

    if (c === '"') { dansUneChaine = true; sortie += c; i++; continue; }

    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      const fin = text.indexOf('*/', i + 2);
      i = fin === -1 ? text.length : fin + 2;
      continue;
    }

    sortie += c;
    i++;
  }

  // Virgule finale : toleree par les JSON permissifs, refusee par JSON.parse.
  return sortie.replace(/,(\s*[}\]])/g, '$1');
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('__')) continue;
    if (Array.isArray(value)) {
      base[key] = [...value];
    } else if (value && typeof value === 'object') {
      base[key] = deepMerge(base[key] && typeof base[key] === 'object' ? base[key] : {}, value);
    } else if (value !== undefined) {
      base[key] = value;
    }
  }
  return base;
}

/** Charge les empreintes deja acceptees (dette technique connue). */
export function loadBaseline(config) {
  if (!config.baseline) return new Set();
  const file = path.resolve(config.root, config.baseline);
  if (!fs.existsSync(file)) return new Set();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(parsed.fingerprints || []);
  } catch {
    return new Set();
  }
}

export function writeBaseline(config, findings) {
  const file = path.resolve(config.root, config.baseline || '.argus/baseline.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    count: findings.length,
    fingerprints: [...new Set(findings.map((f) => f.fingerprint))].sort(),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return file;
}
