import { estPageDErreur } from './seo.js';
import {
  ROUTE_EXTRACTORS,
  extractFileSystemRoutes,
  extractLinks,
  normalizeRoute,
  resolveLink,
} from '../lang/routes.js';
import { isQuoted, lineIndexFor } from '../core/scan.js';

/**
 * Le projet passe-t-il par un outil de construction ?
 *
 * Quand c'est le cas, les chemins ecrits dans le HTML sont reecrits a la
 * compilation : les confronter au systeme de fichiers tel quel n'a pas de sens.
 */
function aUnEmpaqueteur(context) {
  return context.has('vite', 'webpack', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix', 'electron');
}

/** Le perimetre auquel appartient ce fichier vise-t-il le web ? */
function perimetreWeb(context, cheminOuFichier) {
  const chemin = typeof cheminOuFichier === 'string' ? cheminOuFichier : cheminOuFichier?.relativePath;
  const fichier = chemin ? context.byPath?.get(chemin) : null;
  const perimetre = context.perimetreDe && fichier ? context.perimetreDe(fichier) : context;
  return perimetre.cible('web');
}

/**
 * Analyseur de routes et de liens.
 *
 * Il repond a trois questions :
 *  1. Quels liens de l'application ne menent nulle part ? (lien casse)
 *  2. Quelles routes ne sont jamais atteintes ? (route orpheline)
 *  3. Quelles routes sont declarees deux fois, mal formees ou sans handler ?
 */
export default {
  id: 'routes',
  category: 'routes',
  label: 'Routes et navigation',
  order: 20,

  async run(context, report) {
    const routes = collectRoutes(context);
    const links = collectLinks(context);
    context.routes = routes;
    context.links = links;

    const assets = buildAssetIndex(context);

    detectDuplicates(routes, report);
    detectMalformed(routes, report);
    detectBrokenLinks(links, routes, assets, context, report);
    detectOrphanRoutes(routes, links, context, report);
    detectUnsafeExternalLinks(context, report);
    detectMissingErrorRoutes(routes, context, report);

    context.shared.set('routeStats', {
      total: routes.length,
      byKind: countBy(routes, (r) => r.kind),
      byFramework: countBy(routes, (r) => r.framework),
      dynamic: routes.filter((r) => r.dynamic).length,
      links: links.length,
      internalLinks: links.filter((l) => !l.external).length,
    });
  },
};

function collectRoutes(context) {
  const routes = [...extractFileSystemRoutes(context)];

  for (const extractor of ROUTE_EXTRACTORS) {
    const relevant = extractor.frameworks.some((f) => context.has(f));
    const files = context.sources({ families: extractor.families });
    if (files.length === 0) continue;
    // On lance quand meme l'extracteur si le framework n'est pas detecte mais
    // que la famille de langage correspond : mieux vaut un peu de bruit qu'un
    // angle mort.
    for (const file of files) {
      if (!relevant && !extractor.families.includes(file.family)) continue;
      try {
        routes.push(...extractor.extract(file, context));
      } catch {
        /* un extracteur ne doit jamais casser le scan */
      }
    }
  }

  context.inclusionsHorsDepot = monterLesInclusionsDjango(routes);

  // Deduplication exacte (meme methode + meme motif + meme fichier).
  const seen = new Set();
  return routes.filter((route) => {
    const key = `${route.method} ${route.pattern} ${route.file}:${route.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Propage le prefixe d'un `include()` aux routes du fichier inclus.
 *
 * Une route declaree dans le `urls.py` d'une application Django est
 * *relative* au point ou l'application est montee. Sans cette passe, cinq
 * applications montees sous cinq prefixes differents declaraient toutes la
 * route « / », et l'outil concluait a « la route / declaree 5 fois » puis a
 * du code mort. Le projet etait correct ; c'est la lecture qui ne l'etait pas.
 *
 * Les montages imbriques sont resolus par passes successives, bornees : un
 * `include()` circulaire ne doit pas faire tourner le scan indefiniment.
 */
function monterLesInclusionsDjango(routes) {
  let horsDepot = false;
  const parFichier = new Map();
  for (const route of routes) {
    if (route.framework !== 'django') continue;
    if (!parFichier.has(route.file)) parFichier.set(route.file, []);
    parFichier.get(route.file).push(route);
  }
  if (parFichier.size === 0) return false;

  const cible = (module) => {
    // `comptes.urls` designe `comptes/urls.py`, ou qu'il se trouve dans
    // l'arborescence : un projet peut ranger ses applications sous `apps/`.
    const chemin = `${module.replace(/\./g, '/')}.py`;
    for (const fichier of parFichier.keys()) {
      if (fichier === chemin || fichier.endsWith(`/${chemin}`)) return fichier;
    }
    return null;
  };

  const joindre = (prefixe, motif) =>
    `/${`${prefixe}/${motif}`.split('/').filter(Boolean).join('/')}`;

  // Une profondeur de montage superieure a huit ne se rencontre pas ; la borne
  // protege surtout d'un `include()` qui se referme sur lui-meme.
  for (let passe = 0; passe < 8; passe++) {
    let change = false;

    for (const montage of routes) {
      if (montage.kind !== 'mount' || montage.framework !== 'django') continue;
      if (montage.monte) continue;
      const fichier = cible(montage.data?.include || '');
      if (!fichier || fichier === montage.file) {
        // `include("allauth.urls")` : le fichier vit dans une dependance
        // installee, pas dans le depot. Ses routes nommees existent bel et
        // bien, mais nous ne pouvons pas les voir — et un outil qui ne voit
        // pas doit se taire plutot que d'accuser.
        if (montage.data?.include) horsDepot = true;
        continue;
      }

      montage.monte = true;
      change = true;
      for (const route of parFichier.get(fichier)) {
        route.pattern = joindre(montage.pattern, route.pattern);
        if (route.regex) route.regex = new RegExp(`^${route.pattern.replace(/<[^>]+>/g, '[^/]+')}/?$`);
      }
    }

    if (!change) break;
  }

  return horsDepot;
}

function collectLinks(context) {
  const links = [];
  for (const file of context.sources()) {
    if (!file.readable || file.size > 512 * 1024) continue;
    if (!['js', 'markup', 'python', 'php', 'dart', 'ruby', 'jvm', 'go'].includes(file.family)) continue;
    links.push(...extractLinks(file));
  }
  return links;
}

/** Index des fichiers servables (assets publics, pages statiques). */
function buildAssetIndex(context) {
  const index = new Set();
  for (const file of context.files) {
    const rel = file.relativePath;
    const stripped = rel.replace(/^(public|static|www|htdocs|assets|dist|build|src\/assets)\//, '');
    index.add(`/${stripped}`);
    index.add(`/${rel}`);
    if (/index\.html?$/i.test(stripped)) {
      index.add(`/${stripped.replace(/index\.html?$/i, '')}`.replace(/\/$/, '') || '/');
    }
    if (/\.html?$/i.test(stripped)) index.add(`/${stripped.replace(/\.html?$/i, '')}`);
  }
  return index;
}

function detectDuplicates(routes, report) {
  const groups = new Map();
  for (const route of routes) {
    if (route.kind === 'mount') continue;
    // Deux routeurs differents (une API Python et un routeur Flutter) peuvent
    // legitimement declarer le meme chemin : seul un doublon au sein d'un meme
    // routeur constitue une declaration morte.
    const key = `${route.framework} ${route.method} ${route.pattern}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }

  for (const [key, group] of groups) {
    const distinctFiles = new Set(group.map((r) => `${r.file}:${r.line}`));
    if (distinctFiles.size < 2) continue;
    const [first, ...rest] = group;
    report({
      ruleId: 'ROUTE-DUPLICATE',
      severity: 'medium',
      title: 'Route declaree plusieurs fois',
      message: `La route ${first.method} ${first.pattern} est declaree ${distinctFiles.size} fois. Seule la premiere declaration enregistree sera atteinte ; les autres sont du code mort.`,
      file: first.file,
      line: first.line,
      snippet: `${first.method} ${first.pattern}`,
      suggestion: `Supprimez ou fusionnez les declarations redondantes (${rest.map((r) => `${r.file}:${r.line}`).slice(0, 3).join(', ')}).`,
      effort: 'rapide',
      data: { occurrences: [...distinctFiles] },
    });
  }
}

function detectMalformed(routes, report) {
  for (const route of routes) {
    if (route.kind === 'mount') continue;

    if (/\/\//.test(route.raw)) {
      report({
        ruleId: 'ROUTE-DOUBLE-SLASH',
        severity: 'low',
        title: 'Double barre oblique dans la route',
        message: `La route "${route.raw}" contient "//" : selon le routeur elle peut ne jamais correspondre.`,
        file: route.file,
        line: route.line,
        snippet: route.raw,
        suggestion: 'Normalisez le chemin, ou utilisez un helper de concatenation qui supprime les separateurs en trop.',
        effort: 'rapide',
      });
    }

    if (/[A-Z]/.test(route.pattern) && route.kind !== 'mount') {
      report({
        ruleId: 'ROUTE-UPPERCASE',
        severity: 'low',
        title: 'Majuscules dans une URL',
        message: `"${route.pattern}" contient des majuscules. Les URL sont sensibles a la casse : cela cree des 404 et duplique le contenu pour les moteurs de recherche.`,
        file: route.file,
        line: route.line,
        snippet: route.pattern,
        suggestion: 'Utilisez des URL en minuscules avec des tirets (kebab-case) et redirigez l\'ancienne forme en 301.',
        effort: 'rapide',
        tags: ['seo'],
      });
    }

    if (/_/.test(route.pattern) && route.kind !== 'server') {
      report({
        ruleId: 'ROUTE-UNDERSCORE',
        severity: 'info',
        title: 'Underscore dans une URL de page',
        message: `"${route.pattern}" utilise des underscores ; Google recommande le tiret comme separateur de mots.`,
        file: route.file,
        line: route.line,
        suggestion: 'Preferez /mon-article a /mon_article.',
        effort: 'rapide',
        tags: ['seo'],
      });
    }

    if (route.segments > 5 && route.kind !== 'server') {
      report({
        ruleId: 'ROUTE-TOO-DEEP',
        severity: 'info',
        title: 'URL trop profonde',
        message: `"${route.pattern}" comporte ${route.segments} segments. Une profondeur superieure a 4 dilue le maillage interne et complique le crawl.`,
        file: route.file,
        line: route.line,
        suggestion: 'Aplatissez la hierarchie d\'URL, la profondeur de navigation peut rester la meme.',
        effort: 'important',
        tags: ['seo'],
      });
    }
  }
}

function detectBrokenLinks(links, routes, assets, context, report) {
  const matchable = routes.filter((r) => r.kind !== 'mount');
  const mounts = routes.filter((r) => r.kind === 'mount').map((r) => r.pattern);
  const namedRoutes = new Set(routes.map((r) => r.handler).filter(Boolean));
  const reported = new Set();

  for (const link of links) {
    if (link.external) continue;
    if (link.kind === 'named') {
      // url_for('vue') / route('nom') : on verifie le nom, pas le chemin.
      // Un `include()` vers une application installee rend le tableau des
      // noms incomplet : tout nom absent devient alors indecidable.
      if (context.inclusionsHorsDepot) continue;
      if (namedRoutes.size > 0 && !namedRoutes.has(link.target) && !link.target.includes('.')) {
        maybeReport(link, 'ROUTE-UNKNOWN-NAME', 'Route nommee inconnue',
          `Aucune route nommee "${link.target}" n'a ete trouvee.`,
          'Verifiez le nom (name=/as=) de la route cible, ou corrigez l\'appel.');
      }
      continue;
    }

    const target = link.target;
    if (!target || target.startsWith('#') || target.startsWith('?')) continue;
    if (/^\{|\$\{|<%|\{\{|\{%/.test(target)) continue; // cible dynamique
    if (/^(data|javascript|mailto|tel|sms|blob|about):/i.test(target)) continue;

    const resolved = target.startsWith('/') ? normalizeRoute(target) : resolveLink(target, link.file);
    const bare = resolved.split('?')[0].split('#')[0];

    if (assets.has(bare) || assets.has(`${bare}/`) || assets.has(bare.replace(/\/$/, ''))) continue;
    // Un chemin racine dans une page servie par un empaqueteur n'est pas
    // resolu depuis la racine du depot mais depuis le dossier de la page :
    // Vite lit `/src/main.jsx` relativement au dossier de son index.html.
    // Sans cela, toute application Vite se voyait reprocher son point
    // d'entree comme lien mort.
    if (target.startsWith('/') && aUnEmpaqueteur(context) && assets.has(resolveLink(target.slice(1), link.file))) {
      continue;
    }
    if (mounts.some((mount) => bare === mount || bare.startsWith(`${mount}/`))) continue;
    if (matchable.some((route) => route.regex.test(bare))) continue;
    // Un lien vers un dossier vise son index : `/blog/` designe `/blog/index.html`.
    if (assets.has(`${bare}/index.html`) || assets.has(`${bare === '/' ? '' : bare}/index.html`)) continue;
    if (/\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|mp4|webm|pdf|json|xml|txt|zip|map)$/i.test(bare)) {
      maybeReport(link, 'ROUTE-MISSING-ASSET', 'Ressource statique introuvable',
        `Le fichier "${target}" reference ici n'existe pas dans le projet.`,
        'Corrigez le chemin, ou ajoutez la ressource manquante. Un 404 sur une ressource ralentit le rendu et degrade le score de crawl.');
      continue;
    }

    maybeReport(link, 'ROUTE-BROKEN-LINK', 'Lien interne mort',
      `Le lien "${target}" ne correspond a aucune route ni fichier du projet.`,
      'Corrigez la cible, creez la page manquante, ou mettez en place une redirection 301 si l\'URL a change.');
  }

  function maybeReport(link, ruleId, title, message, suggestion) {
    const key = `${ruleId}:${link.target}`;
    if (reported.has(key)) return;
    reported.add(key);
    const file = context.file(link.file);
    report({
      ruleId,
      severity: ruleId === 'ROUTE-MISSING-ASSET' ? 'medium' : 'high',
      title,
      message,
      file: link.file,
      line: link.line,
      snippet: file ? lineIndexFor(file).textOfLine(link.line) : link.target,
      suggestion,
      effort: 'rapide',
      confidence: 'firm',
      tags: ['seo', 'ux'],
      data: { target: link.target, kind: link.kind },
    });
  }
}

function detectOrphanRoutes(routes, links, context, report) {
  const internalTargets = new Set();
  for (const link of links) {
    if (link.external) continue;
    const resolved = link.target.startsWith('/') ? normalizeRoute(link.target) : resolveLink(link.target, link.file);
    internalTargets.add(resolved.split('?')[0].split('#')[0]);
    if (link.kind === 'named') internalTargets.add(link.target);
  }

  const sitemapContent = context.files
    .filter((f) => /sitemap.*\.(xml|txt|js|ts)$/i.test(f.name) || f.name === 'robots.txt')
    .map((f) => f.content)
    .join('\n');

  for (const route of routes) {
    if (route.kind === 'mount' || route.kind === 'server') continue;
    if (route.pattern === '/' || route.pattern === '') continue;
    if (route.dynamic) continue; // une route dynamique est atteinte par construction
    if (/^\/(404|500|error|not-found|_)/.test(route.pattern)) continue;

    // Une page statique se lie indifferemment par `/a-propos` ou
    // `/a-propos.html` : le motif de route perd l'extension, pas les liens.
    const formes = [route.pattern];
    if (route.framework === 'static') {
      formes.push(`${route.pattern}.html`, `${route.pattern}.htm`);
      if (route.pattern === '/') formes.push('/index.html');
    }

    const linked =
      formes.some((forme) => internalTargets.has(forme)) ||
      [...internalTargets].some((target) => route.regex.test(target)) ||
      formes.some((forme) => sitemapContent.includes(forme));

    if (linked) continue;
    // Une page d'erreur est servie par le serveur, jamais liee : c'est le
    // propre d'un 404. La signaler orpheline reprochait a un site d'en avoir
    // une, alors que son absence est justement ce qu'Argus recommande.
    if (route.file && estPageDErreur(route.file)) continue;
    // Hors du web, la notion de route orpheline n'a pas de sens : le HTML
    // d'une fenetre Electron est charge par `loadFile()`, aucun lien ne
    // pointe vers lui et aucun n'a a le faire.
    if (route.file && !perimetreWeb(context, route.file)) continue;

    report({
      ruleId: 'ROUTE-ORPHAN',
      severity: 'medium',
      title: 'Route orpheline (aucun lien entrant)',
      message: `La page "${route.pattern}" n'est referencee par aucun lien interne ni par le sitemap. Elle est invisible pour les visiteurs comme pour les moteurs de recherche.`,
      file: route.file,
      line: route.line,
      snippet: route.pattern,
      suggestion:
        'Ajoutez un lien depuis la navigation ou une page pertinente, inscrivez l\'URL au sitemap.xml — ou supprimez la page si elle n\'a plus de raison d\'etre.',
      effort: 'rapide',
      confidence: 'tentative',
      tags: ['seo', 'deadcode'],
      data: { pattern: route.pattern, framework: route.framework },
    });
  }
}

function detectUnsafeExternalLinks(context, report) {
  for (const file of context.sources({ families: ['markup', 'js'] })) {
    if (!file.readable) continue;
    const index = lineIndexFor(file);
    const re = /<a\b([^>]*\btarget\s*=\s*["']_blank["'][^>]*)>/gi;
    let match;
    while ((match = re.exec(file.content)) !== null) {
      const attrs = match[1];
      if (/\brel\s*=\s*["'][^"']*noopener/i.test(attrs)) continue;
      if (file.family === 'js' && isQuoted(file, match.index)) continue;
      report({
        ruleId: 'ROUTE-TARGET-BLANK',
        severity: 'medium',
        title: 'target="_blank" sans rel="noopener"',
        message: 'La page ouverte obtient une reference window.opener vers votre page : elle peut la rediriger (tabnabbing).',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0].slice(0, 160),
        suggestion: 'Ajoutez rel="noopener noreferrer" a ce lien.',
        effort: 'rapide',
        tags: ['CWE-1022', 'security'],
      });
    }
  }
}

function detectMissingErrorRoutes(routes, context, report) {
  const isWebApp = context.has('nextjs', 'nuxt', 'react-router', 'vue-router', 'sveltekit', 'express', 'laravel', 'django', 'flask', 'static-site');
  if (!isWebApp || routes.length < 3) return;

  const has404 = routes.some((r) => /404|not-?found|\*|catch/i.test(r.raw)) ||
    context.files.some((f) => /(^|\/)(404|not-found)\.(html?|jsx?|tsx?|vue|svelte|astro|py)$/i.test(f.relativePath));

  if (!has404) {
    report({
      ruleId: 'ROUTE-NO-404',
      severity: 'medium',
      title: 'Aucune page 404 definie',
      message: 'Aucune route de repli ni page 404 n\'a ete trouvee. Les URL erronees renvoient une page blanche ou une erreur serveur.',
      suggestion:
        'Ajoutez une page 404 utile : message clair, champ de recherche, liens vers les sections principales. Elle doit renvoyer un vrai code HTTP 404 (pas 200), sinon Google indexe des pages vides.',
      effort: 'moyen',
      tags: ['seo', 'ux'],
    });
  }
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
