import { decouvrirSousProjets, aUneDeclarationDEspaceDeTravail, attribuer } from './workspaces.js';
import path from 'node:path';
import { stripJsonComments } from './config.js';

/**
 * Contexte partage par tous les analyseurs : index des fichiers, manifestes,
 * frameworks detectes, et espace de donnees inter-analyseurs (routes, liens…).
 */
export class ProjectContext {
  constructor(config, files, meta = {}) {
    this.config = config;
    this.root = path.resolve(config.root);
    this.files = files;
    this.meta = meta;

    this.byPath = new Map(files.map((f) => [f.relativePath, f]));
    this.byLanguage = groupBy(files, (f) => f.language);
    this.byFamily = groupBy(files, (f) => f.family);
    this.byExtension = groupBy(files, (f) => f.ext);

    this.manifests = this.#readManifests();
    /** Ce qui a fait conclure a chaque framework : `id -> preuve`. */
    this.preuves = new Map();
    this.frameworks = detectFrameworks(this, this.preuves);
    this.platforms = plateformesRetenues(this, detectPlatforms(this.frameworks, aDesPagesHtml(this)));
    this.stack = summarizeStack(this);

    this.#construireSousProjets();

    this.estBibliotheque = estUneBibliotheque(this);
    this.description = describeProject(this);

    /** Rempli par l'analyseur de routes, consomme par SEO et code mort. */
    this.routes = [];
    this.links = [];
    this.symbols = new Map();
    this.shared = new Map();
  }

  file(relativePath) {
    return this.byPath.get(relativePath) || null;
  }

  /** Fichiers analysables (texte, non generes, hors tests si configure). */
  /**
   * Fichiers a analyser.
   *
   * `includeTests` est une *demande de l'analyseur*, pas une decision finale :
   * la securite et le code mort veulent lire les tests, parce qu'un vrai
   * secret dans un test reste un vrai secret. Mais quand l'utilisateur ecrit
   * `includeTests: false` dans sa configuration, il donne une consigne
   * explicite — et une consigne explicite l'emporte sur une preference
   * d'analyseur.
   *
   * Sans cela, un projet qui excluait ses tests en voyait quand meme analyser
   * trois, pour quinze pour cent de ses constats. Signale sur un projet reel.
   */
  sources({ includeTests = this.config.includeTests, families = null, languages = null } = {}) {
    // Une consigne explicite l'emporte sur la preference d'un analyseur ; un
    // simple defaut se laisse surcharger.
    const impose = this.config.explicites?.has('includeTests');
    const testsAutorises = impose ? this.config.includeTests : includeTests;

    return this.files.filter((f) => {
      if (!f.readable) return false;
      if (!testsAutorises && f.isTest) return false;
      if (families && !families.includes(f.family)) return false;
      if (languages && !languages.includes(f.language)) return false;
      return true;
    });
  }

  /** Le projet vise-t-il l'une de ces plateformes ? (`web`, `mobile`, `desktop`) */
  cible(...plateformes) {
    return plateformes.some((p) => this.platforms.includes(p));
  }

  has(...frameworkIds) {
    return frameworkIds.some((id) => this.frameworks.includes(id));
  }

  /**
   * Construit les perimetres et fusionne leurs conclusions dans la racine.
   *
   * Les frameworks et les plateformes de la racine deviennent l'union de
   * ceux des sous-projets : sans cela, un depot dont le manifeste racine ne
   * declare qu'un orchestrateur n'activait aucune regle specialisee, et un
   * monorepo restait de fait non analyse.
   */
  #construireSousProjets() {
    const chemins = decouvrirSousProjets(this.files);
    this.estMonorepo =
      chemins.length >= 2 ||
      (chemins.length === 1 && aUneDeclarationDEspaceDeTravail(this.files, this.manifests));

    if (!this.estMonorepo) {
      this.sousProjets = [];
      this.#perimetres = new Map();
      return;
    }

    const parChemin = new Map(chemins.map((c) => [c, []]));
    const racine = [];
    for (const file of this.files) {
      const chemin = attribuer(file.relativePath, chemins);
      if (chemin) parChemin.get(chemin).push(file);
      else racine.push(file);
    }

    this.sousProjets = chemins
      .map((chemin) => new Perimetre(chemin, parChemin.get(chemin), this.config))
      // Un dossier qui ne porte qu'un manifeste, sans code, n'apprend rien.
      .filter((p) => p.files.length > 1)
      .sort((a, b) => a.chemin.localeCompare(b.chemin));

    this.#perimetres = new Map(this.sousProjets.map((p) => [p.chemin, p]));

    const frameworks = new Set(this.frameworks);
    for (const perimetre of this.sousProjets) {
      for (const id of perimetre.frameworks) frameworks.add(id);
    }
    this.frameworks = [...frameworks];
    this.platforms = plateformesRetenues(this, detectPlatforms(this.frameworks, aDesPagesHtml(this)));
  }

  /**
   * Le perimetre auquel appartient un fichier, ou la racine.
   *
   * C'est ce que doivent consulter les regles sensibles au contexte : le SEO
   * n'a pas de sens dans `apps/mobile` meme si `apps/web` existe a cote, et
   * les conventions de points d'entree de Next.js sont relatives a
   * l'application, pas au depot.
   */
  perimetreDe(file) {
    if (!this.sousProjets?.length) return this;
    const chemin = attribuer(file.relativePath ?? file, this.sousProjets.map((p) => p.chemin));
    return chemin ? this.#perimetres.get(chemin) : this;
  }

  #perimetres = new Map();

  #readManifests() {
    return readManifests(this.files, this.byPath, '');
  }

  /** Toutes les dependances declarees, tous ecosystemes confondus. */
  get dependencies() {
    const deps = new Map();
    const pkg = this.manifests['package.json']?.data;
    if (pkg) {
      for (const scope of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const [name, range] of Object.entries(pkg[scope] || {})) {
          deps.set(name, { name, range, scope, ecosystem: 'npm' });
        }
      }
    }
    const reqs = this.manifests['requirements.txt']?.data;
    if (reqs) {
      for (const dep of reqs) deps.set(dep.name, { ...dep, ecosystem: 'pypi', scope: 'dependencies' });
    }
    const pubspec = this.manifests['pubspec.yaml']?.data;
    if (pubspec?.dependencies) {
      for (const [name, range] of Object.entries(pubspec.dependencies)) {
        deps.set(name, { name, range: String(range), scope: 'dependencies', ecosystem: 'pub' });
      }
    }
    return deps;
  }
}

/**
 * Perimetre d'analyse : un sous-projet d'un monorepo, avec ses propres
 * manifestes, frameworks et plateformes.
 *
 * C'est le meme calcul que pour la racine, applique a un sous-ensemble de
 * fichiers. Un depot qui contient une application Next.js et une application
 * Expo a donc deux perimetres, chacun juge sur ce qu'il declare — au lieu
 * d'une detection unique qui melangeait les deux, ou plus souvent n'en
 * voyait aucune.
 */
export class Perimetre {
  constructor(chemin, files, config) {
    this.chemin = chemin;
    this.config = config;
    this.files = files;
    this.byPath = new Map(files.map((f) => [f.relativePath, f]));
    this.byLanguage = groupBy(files, (f) => f.language);
    this.manifests = readManifests(files, this.byPath, chemin);
    this.frameworks = detectFrameworks(this);
    this.platforms = detectPlatforms(this.frameworks, aDesPagesHtml(this));
    this.stack = summarizeStack(this);
    this.description = describeProject(this);
    this.nom = this.manifests['package.json']?.data?.name || chemin;
  }

  sources({ includeTests = true, families = null, languages = null } = {}) {
    return this.files.filter((f) => {
      if (!f.readable) return false;
      if (!includeTests && f.isTest) return false;
      if (families && !families.includes(f.family)) return false;
      if (languages && !languages.includes(f.language)) return false;
      return true;
    });
  }

  has(...frameworkIds) {
    return frameworkIds.some((id) => this.frameworks.includes(id));
  }

  cible(...plateformes) {
    return plateformes.some((p) => this.platforms.includes(p));
  }

  /** Chemin d'un fichier relativement a ce perimetre, pour les conventions. */
  relatif(cheminRelatif) {
    if (!this.chemin) return cheminRelatif;
    return cheminRelatif.startsWith(`${this.chemin}/`)
      ? cheminRelatif.slice(this.chemin.length + 1)
      : cheminRelatif;
  }
}

/**
 * Lit les manifestes d'un perimetre.
 *
 * `prefixe` restreint la recherche a un sous-projet. Sans lui, dans un
 * monorepo, le manifeste racine — celui de l'orchestrateur, qui ne declare
 * que turbo ou nx — repondait pour toutes les applications contenues.
 */
function readManifests(files, byPath, prefixe = '') {
  const manifests = {};
  const load = (name, parser) => {
    const file = prefixe
      ? byPath.get(`${prefixe}/${name}`)
      : byPath.get(name) || files.find((f) => f.relativePath.endsWith(`/${name}`));
    if (!file || !file.readable) return;
    try {
      manifests[name] = { file, data: parser(file.content) };
    } catch {
      manifests[name] = { file, data: null, invalid: true };
    }
  };

  load('package.json', (c) => JSON.parse(stripJsonComments(c)));
  load('composer.json', (c) => JSON.parse(stripJsonComments(c)));
  load('tsconfig.json', (c) => JSON.parse(stripJsonComments(c)));
  load('pubspec.yaml', parseSimpleYaml);
  load('requirements.txt', parseRequirements);
  load('pyproject.toml', parseSimpleToml);
  load('pom.xml', (c) => c);
  load('build.gradle', (c) => c);
  load('go.mod', (c) => c);
  load('Gemfile', (c) => c);
  load('Cargo.toml', parseSimpleToml);
  return manifests;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * Detection de frameworks par manifeste + presence de fichiers signature.
 * Volontairement large : elle pilote l'activation des regles specialisees.
 */
/**
 * Detection de frameworks, avec la preuve qui a fait conclure.
 *
 * Sans trace, une deduction fausse est invisible donc incorrigible : un projet
 * Electron classe « site statique » recevait toute l'analyse d'un site sans
 * que rien n'indique pourquoi. On note desormais *ce qui* a decide, et le
 * rapport l'affiche.
 */
function detectFrameworks(context, preuves = new Map()) {
  const found = new Set();
  const pkg = context.manifests['package.json']?.data || {};
  const npmDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const hasDep = (name) => Object.hasOwn(npmDeps, name);
  const hasFile = (pattern) => context.files.some((f) => pattern.test(f.relativePath));

  /** Enregistre la premiere preuve trouvee : c'est la plus directe. */
  const noter = (id, preuve) => {
    found.add(id);
    if (!preuves.has(id)) preuves.set(id, preuve);
  };

  const npmMap = {
    next: 'nextjs',
    nuxt: 'nuxt',
    react: 'react',
    'react-native': 'react-native',
    vue: 'vue',
    svelte: 'svelte',
    '@sveltejs/kit': 'sveltekit',
    '@angular/core': 'angular',
    astro: 'astro',
    express: 'express',
    fastify: 'fastify',
    koa: 'koa',
    '@nestjs/core': 'nestjs',
    'react-router-dom': 'react-router',
    'vue-router': 'vue-router',
    gatsby: 'gatsby',
    remix: 'remix',
    '@remix-run/react': 'remix',
    tailwindcss: 'tailwind',
    'styled-components': 'styled-components',
    electron: 'electron',
    // Un projet Electron moderne n'a pas toujours `electron` en dependance
    // directe : electron-vite, electron-forge ou electron-builder pilotent
    // l'installation. Ne reconnaitre que le paquet principal laissait des
    // applications de bureau entieres passer pour des sites web.
    'electron-builder': 'electron',
    'electron-vite': 'electron',
    'electron-updater': 'electron',
    'electron-log': 'electron',
    'electron-store': 'electron',
    '@electron-forge/cli': 'electron',
    '@electron/remote': 'electron',
    '@electron-toolkit/utils': 'electron',
    '@electron-toolkit/preload': 'electron',
    '@tauri-apps/api': 'tauri',
    '@tauri-apps/cli': 'tauri',
    '@capacitor/android': 'capacitor',
    '@capacitor/ios': 'capacitor',
    '@capacitor/core': 'capacitor',
    '@ionic/angular': 'ionic',
    '@ionic/react': 'ionic',
    'expo': 'expo',
    'nativescript': 'nativescript',
    vite: 'vite',
    webpack: 'webpack',
  };
  for (const [dep, id] of Object.entries(npmMap)) {
    if (hasDep(dep)) noter(id, `dependance « ${dep} »`);
  }

  if (context.manifests['package.json']) noter('node', 'package.json');
  if (context.manifests['pubspec.yaml']) noter('flutter', 'pubspec.yaml');
  if (context.manifests['composer.json']) {
    found.add('php');
    const composer = context.manifests['composer.json'].data || {};
    const phpDeps = { ...(composer.require || {}), ...(composer['require-dev'] || {}) };
    if (Object.keys(phpDeps).some((d) => d.startsWith('laravel/'))) noter('laravel', 'composer.json');
    if (Object.keys(phpDeps).some((d) => d.startsWith('symfony/'))) noter('symfony', 'composer.json');
  }
  if (context.manifests['go.mod']) noter('go', 'go.mod');
  if (context.manifests['Cargo.toml']) noter('rust', 'Cargo.toml');
  if (context.manifests['Gemfile']) {
    found.add('ruby');
    if (/rails/.test(context.manifests['Gemfile'].data || '')) noter('rails', 'Gemfile');
  }
  if (context.manifests['pom.xml'] || context.manifests['build.gradle']) {
    found.add('jvm');
    const build = `${context.manifests['pom.xml']?.data || ''}${context.manifests['build.gradle']?.data || ''}`;
    if (/spring-boot|springframework/.test(build)) noter('spring', 'pom.xml ou build.gradle');
  }

  const pythonSource = context.byLanguage.get('python') || [];
  const pythonHead = pythonSource.slice(0, 300).map((f) => f.content).join('\n');
  if (/from\s+django|import\s+django/.test(pythonHead) || hasFile(/(^|\/)manage\.py$/)) {
    noter('django', hasFile(/(^|\/)manage\.py$/) ? 'manage.py' : 'import django');
  }
  if (/from\s+fastapi|FastAPI\(/.test(pythonHead)) noter('fastapi', 'import fastapi');
  if (/from\s+flask|Flask\(/i.test(pythonHead)) noter('flask', 'import flask');

  // Un script utilitaire ne fait pas un projet Python.
  //
  // La regle etait « au moins un fichier .py ». Un depot React Native qui
  // embarque un script de publication se voyait donc classe Python — constat
  // remonte sur un vrai projet Expo. On demande desormais soit un manifeste
  // Python, soit une presence qui pese reellement dans le code applicatif.
  const manifestePython =
    Boolean(context.manifests['requirements.txt'] || context.manifests['pyproject.toml']) ||
    hasFile(/(^|\/)(Pipfile|setup\.py|setup\.cfg|environment\.yml|conda\.yaml|tox\.ini)$/);
  if (manifestePython || found.has('django') || found.has('flask') || found.has('fastapi')) {
    found.add('python');
  } else if (pythonSource.length >= 3) {
    const lignesPython = pythonSource.reduce((total, f) => total + (f.readable ? f.lineCount : 0), 0);
    const lignesCode = context
      .sources({ includeTests: true })
      .reduce((total, f) => total + (estLangageDeCode(f.language) && f.readable ? f.lineCount : 0), 0);
    if (lignesCode > 0 && lignesPython / lignesCode >= 0.15) found.add('python');
  }

  // Le manifeste natif est parfois le seul indice : un projet Tauri se
  // reconnait a son `src-tauri`, une app Android a son AndroidManifest.
  if (hasFile(/(^|\/)src-tauri\//) || hasFile(/(^|\/)tauri\.conf\.json$/)) {
    noter('tauri', 'dossier src-tauri/ ou tauri.conf.json');
  }

  // Dernier recours : ce que le code importe reellement.
  //
  // Beaucoup de projets Electron ne declarent pas le paquet — il est installe
  // globalement, herite d'un espace de travail parent, ou simplement absent
  // d'un package.json ecrit a la main. Le manifeste se tait, mais
  // `require('electron')` ne ment pas. Sans ce filet, une application de
  // bureau etait classee « site statique » et recevait toute l'analyse SEO.
  for (const [motif, id] of SIGNATURES_DANS_LE_CODE) {
    if (found.has(id)) continue;
    if (motif.test(scriptsDuManifeste(pkg))) { noter(id, 'script npm du manifeste'); continue; }
    if (motif.test(entetesJavaScript(context))) noter(id, 'import dans le code source');
  }
  // Fichiers de signature : ils suffisent a identifier une application de
  // bureau meme quand le manifeste ne dit rien d'utile.
  if (hasFile(/(^|\/)(electron-builder\.(yml|yaml|json|js)|forge\.config\.[cm]?js|electron\.vite\.config\.[cm]?[jt]s)$/)) {
    noter('electron', 'fichier de configuration Electron');
  }
  if (hasFile(/(^|\/)AndroidManifest\.xml$/)) noter('android', 'AndroidManifest.xml');
  if (hasFile(/(^|\/)Info\.plist$/) || hasFile(/\.xcodeproj\//)) noter('ios', 'Info.plist ou projet Xcode');
  if (hasFile(/(^|\/)capacitor\.config\.(ts|js|json)$/)) noter('capacitor', 'capacitor.config');

  if (hasFile(/(^|\/)(pages|app)\/.*\.(jsx?|tsx?)$/) && found.has('nextjs')) found.add('nextjs-router');
  if (hasFile(/(^|\/)index\.html$/)) noter('static-site', 'index.html');
  if (hasFile(/(^|\/)Dockerfile/i)) found.add('docker');
  if (hasFile(/\.github\/workflows\//)) found.add('github-actions');

  return [...found];
}

/**
 * La plateforme imposee par la configuration l'emporte sur la deduction.
 *
 * Aucune heuristique ne sera juste partout, et se tromper de plateforme change
 * toute l'analyse — pas une regle, une categorie entiere. L'utilisateur doit
 * pouvoir trancher. La deduction reste affichee avec sa preuve, pour qu'il
 * sache *pourquoi* il doit la corriger.
 */
const PLATEFORMES_VALIDES = new Set(['web', 'mobile', 'desktop']);

function plateformesRetenues(perimetre, deduites) {
  const imposees = perimetre.config?.platforms;
  if (!Array.isArray(imposees) || imposees.length === 0) return deduites;

  const retenues = imposees.filter((p) => PLATEFORMES_VALIDES.has(p));
  if (retenues.length === 0) return deduites;

  perimetre.plateformeImposee = true;
  return retenues;
}

/**
 * Le projet est-il une bibliotheque ?
 *
 * Distinction absente jusqu'ici, et decouverte en analysant `requests`,
 * `axios` et `express` : soixante-dix exports « morts » y ont ete signales,
 * alors que **les exports d'une bibliotheque sont son produit**. Ils ne sont
 * pas importes en interne pour la meme raison qu'une porte d'entree ne s'ouvre
 * pas depuis l'interieur.
 *
 * Une bibliotheque se reconnait a ce qu'elle *publie* une surface — champ
 * `main`/`exports`, paquet Python declare, autoload PSR-4 — sans avoir de
 * point d'entree applicatif.
 */
function estUneBibliotheque(perimetre) {
  // Une application native n'est pas une bibliotheque, quoi qu'elle declare.
  // Un projet Electron porte un `main` — le point d'entree de son processus
  // principal, pas une API publiee — et garde `electron` en dependance de
  // developpement, ce qui est la bonne pratique. Sans cette garde, toute
  // application de bureau ou mobile basculait du mauvais cote.
  if (perimetre.platforms?.some((p) => p === 'mobile' || p === 'desktop')) return false;

  const pkg = perimetre.manifests?.['package.json']?.data;
  if (pkg) {
    // `private: true` designe une application ou un espace de travail.
    if (pkg.private === true) return false;
    if (pkg.main || pkg.exports || pkg.module || pkg.types) return true;
    // `files` enumere ce qui part a la publication : c'est la definition meme
    // d'un paquet distribue. Express ne declare aucun `main` — il s'en remet
    // au `index.js` par defaut — et n'etait donc pas reconnu.
    if (Array.isArray(pkg.files) && pkg.files.length > 0) return true;
  }

  // Python : un paquet declare pour distribution.
  if (perimetre.manifests?.['pyproject.toml'] || perimetre.byPath?.has('setup.py')) return true;

  // PHP : un paquet Composer de type bibliotheque.
  const composer = perimetre.manifests?.['composer.json']?.data;
  if (composer && composer.type !== 'project' && composer.autoload) return true;

  return false;
}

/** Le perimetre contient-il au moins une page HTML servable ? */
function aDesPagesHtml(perimetre) {
  return (perimetre.files || []).some(
    (f) => f.language === 'html' && f.readable && !f.isGenerated && !f.isVendored,
  );
}

/**
 * Signatures reperables dans le code ou dans les scripts npm.
 * Volontairement peu nombreuses : uniquement les cas ou se tromper de
 * plateforme change toute l'analyse.
 */
const SIGNATURES_DANS_LE_CODE = [
  [/\b(?:require\(\s*['"]electron['"]|from\s+['"]electron['"]|electron\s+\.)/, 'electron'],
  [/@tauri-apps\/(?:api|cli)/, 'tauri'],
  [/\bfrom\s+['"]react-native['"]/, 'react-native'],
  [/@capacitor\/core/, 'capacitor'],
];

function scriptsDuManifeste(pkg) {
  return Object.values(pkg?.scripts || {}).join(' ; ');
}

/**
 * Les premieres lignes des fichiers JavaScript du projet.
 *
 * On se limite a l'en-tete de chaque fichier et a un nombre borne de
 * fichiers : les imports vivent en haut, et l'analyse ne doit pas couter
 * une lecture integrale du depot pour une question de detection.
 */
function entetesJavaScript(context) {
  let cache = context.shared?.get('entetesJs');
  if (cache !== undefined) return cache;

  cache = (context.byFamily?.get('js') || [])
    .slice(0, 200)
    .filter((f) => f.readable)
    .map((f) => f.content.slice(0, 1200))
    .join('\n');

  context.shared?.set('entetesJs', cache);
  return cache;
}

/**
 * Plateformes visees par le projet.
 *
 * Distinction indispensable : une application React Native depend de `react`,
 * ce qui suffisait a la faire passer pour un site et a lui reprocher l'absence
 * de robots.txt. Le SEO, les balises meta et le rendu serveur n'ont aucun sens
 * hors du web. Un projet peut viser plusieurs plateformes (Capacitor, Tauri).
 */
const PLATEFORMES = {
  mobile: ['react-native', 'flutter', 'expo', 'capacitor', 'ionic', 'nativescript', 'android', 'ios'],
  desktop: ['electron', 'tauri'],
  web: [
    'static-site', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix',
    'react', 'vue', 'angular', 'svelte', 'react-router', 'vue-router',
    'django', 'flask', 'fastapi', 'laravel', 'symfony', 'rails', 'spring',
    'express', 'fastify', 'koa', 'nestjs',
  ],
};

function detectPlatforms(frameworks, aDesPagesHtml = false) {
  const set = new Set(frameworks);
  const cibles = new Set();
  for (const [plateforme, ids] of Object.entries(PLATEFORMES)) {
    if (ids.some((id) => set.has(id))) cibles.add(plateforme);
  }

  // Une app mobile ou bureau ecrite en React embarque forcement `react` : la
  // presence d'une plateforme native l'emporte, sauf si le projet expose aussi
  // une vraie cible web (un site compagnon, ou une coquille Capacitor servie
  // depuis un index.html — auquel cas les deux sont vraies).
  if ((cibles.has('mobile') || cibles.has('desktop')) && cibles.has('web')) {
    const webPropre = frameworks.some((id) =>
      ['nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix', 'django', 'flask',
       'fastapi', 'laravel', 'symfony', 'rails', 'spring', 'express', 'fastify',
       'koa', 'nestjs'].includes(id),
    );
    if (!webPropre) cibles.delete('web');
  }

  // Des pages HTML sans framework restent un site : un dossier de fichiers
  // `.html` servi tel quel est le plus vieux site web du monde. Le signal
  // `static-site` n'est pose que par la presence d'un `index.html`, ce qui
  // laissait de cote les projets sans page d'accueil — et leur retirait toute
  // l'analyse SEO.
  if (!cibles.has('mobile') && !cibles.has('desktop') && aDesPagesHtml) cibles.add('web');

  if (cibles.size === 0) cibles.add('inconnu');
  return [...cibles];
}

/**
 * Langages de configuration et de donnees.
 *
 * Les compter dans la repartition fausse la lecture : un projet Expo de neuf
 * fichiers affichait « json 32 % », ce qui ecrasait la part reelle du code
 * applicatif et faisait remonter un script isole a un rang trompeur.
 */
const LANGAGES_DE_CONFIGURATION = new Set([
  'json', 'yaml', 'toml', 'ini', 'dotenv', 'markdown', 'text', 'xml', 'plist',
  'properties', 'lock', 'csv', 'unknown',
]);

function estLangageDeCode(langage) {
  return !LANGAGES_DE_CONFIGURATION.has(langage);
}

function summarizeStack(context) {
  const counts = [...context.byLanguage.entries()]
    .filter(([lang]) => lang !== 'unknown')
    .map(([lang, files]) => ({
      language: lang,
      files: files.length,
      lines: files.reduce((sum, f) => sum + (f.readable ? f.lineCount : 0), 0),
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      code: estLangageDeCode(lang),
    }))
    .sort((a, b) => b.lines - a.lines);
  return counts;
}

/**
 * Ce que le projet *est*, en une ligne.
 *
 * La liste brute des frameworks detectes les met tous sur le meme plan :
 * « react, react-native, expo, node, python » ne dit pas qu'il s'agit d'une
 * application mobile Expo. L'ordre va du plus specifique au plus general,
 * et le premier trouve gagne.
 */
const IDENTITES = [
  { id: 'expo', label: 'React Native (Expo)' },
  { id: 'react-native', label: 'React Native' },
  { id: 'flutter', label: 'Flutter' },
  { id: 'capacitor', label: 'Capacitor' },
  { id: 'ionic', label: 'Ionic' },
  { id: 'tauri', label: 'Tauri' },
  { id: 'electron', label: 'Electron' },
  { id: 'nextjs', label: 'Next.js' },
  { id: 'nuxt', label: 'Nuxt' },
  { id: 'sveltekit', label: 'SvelteKit' },
  { id: 'remix', label: 'Remix' },
  { id: 'gatsby', label: 'Gatsby' },
  { id: 'astro', label: 'Astro' },
  { id: 'angular', label: 'Angular' },
  { id: 'nestjs', label: 'NestJS' },
  { id: 'django', label: 'Django' },
  { id: 'fastapi', label: 'FastAPI' },
  { id: 'flask', label: 'Flask' },
  { id: 'laravel', label: 'Laravel' },
  { id: 'symfony', label: 'Symfony' },
  { id: 'rails', label: 'Ruby on Rails' },
  { id: 'spring', label: 'Spring Boot' },
  { id: 'express', label: 'Express' },
  { id: 'fastify', label: 'Fastify' },
  { id: 'koa', label: 'Koa' },
  { id: 'react', label: 'React' },
  { id: 'vue', label: 'Vue' },
  { id: 'svelte', label: 'Svelte' },
  { id: 'android', label: 'Android natif' },
  { id: 'ios', label: 'iOS natif' },
  { id: 'static-site', label: 'Site statique' },
];

function describeProject(context) {
  context.identite = IDENTITES.find((c) => context.frameworks.includes(c.id))?.id ?? null;

  // Une bibliotheque n'est pas l'application de ses outils. Axios utilise
  // Express pour son serveur de test, en dependance de developpement : cela
  // n'en fait pas une application Express. L'identite d'une bibliotheque ne
  // se lit donc que dans ses dependances de production.
  if (context.estBibliotheque && context.identite) {
    const prod = context.manifests?.['package.json']?.data?.dependencies || {};
    const preuve = context.preuves?.get(context.identite) || '';
    const venuDUneDependance = /dependance/.test(preuve);
    if (venuDUneDependance && !Object.keys(prod).some((d) => preuve.includes(d))) {
      context.identite = null;
    }
  }

  // Une bibliotheque n'est pas une application. `express` etait decrit comme
  // « Site statique » parce qu'il contient des pages d'exemple : le signal le
  // plus visible du rapport designait exactement le contraire de la realite.
  // `static-site` ne repose que sur la presence d'un index.html : dans une
  // bibliotheque, c'est une page d'exemple ou de documentation, pas le
  // produit. `express` etait ainsi decrit comme « Site statique ».
  if (context.estBibliotheque && context.identite === 'static-site') context.identite = null;

  if (context.estBibliotheque && !context.identite) {
    const principal = context.stack?.find((s) => s.code);
    return principal ? `Bibliotheque ${principal.language}` : 'Bibliotheque';
  }

  if (context.estMonorepo && context.sousProjets?.length) {
    const noms = context.sousProjets.map((p) => p.description);
    const distincts = [...new Set(noms)];
    return `Monorepo · ${context.sousProjets.length} projets (${distincts.slice(0, 3).join(', ')}${distincts.length > 3 ? '…' : ''})`;
  }
  const identite = IDENTITES.find((candidat) => context.frameworks.includes(candidat.id));
  const principal = context.stack.find((s) => s.code);
  if (identite) return identite.label;
  return principal ? `Projet ${principal.language}` : 'Projet';
}

/** Parseur YAML minimal : suffisant pour pubspec.yaml (cles/valeurs, 1 niveau). */
function parseSimpleYaml(text) {
  const result = {};
  const stack = [{ indent: -1, node: result }];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const match = /^([\w.\-/]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (value === '') {
      parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return result;
}

/** Parseur TOML minimal : sections + cles simples. */
function parseSimpleToml(text) {
  const result = {};
  let section = result;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].split('.').reduce((node, part) => {
        node[part] = node[part] || {};
        return node[part];
      }, result);
      continue;
    }
    const kv = /^([\w.\-"']+)\s*=\s*(.+)$/.exec(line);
    if (kv) section[kv[1].replace(/["']/g, '')] = kv[2].replace(/^["']|["'],?$/g, '');
  }
  return result;
}

function parseRequirements(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split('#')[0].trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([A-Za-z0-9._\-[\]]+)\s*([<>=!~^].*)?$/.exec(line);
      return match ? { name: match[1], range: (match[2] || '').trim() } : null;
    })
    .filter(Boolean);
}
