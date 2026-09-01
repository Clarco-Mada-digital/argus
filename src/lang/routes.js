import path from 'node:path';
import { isQuoted, lineIndexFor, matches } from '../core/scan.js';

/**
 * Extraction des routes declarees, tous frameworks confondus.
 * Chaque extracteur retourne des objets Route normalises :
 * { method, pattern, kind, framework, file, line, handler, dynamic }
 */

const HTTP_METHODS = 'get|post|put|patch|delete|options|head|all|use';

/** Definitions d'extracteurs : { id, test(file, context), extract(file, context) } */
export const ROUTE_EXTRACTORS = [
  // ------------------------------------------------------------------ Node
  {
    id: 'express',
    frameworks: ['express', 'koa', 'fastify', 'node'],
    families: ['js'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      const source = file.content;
      const re = new RegExp(
        `\\b(?:app|router|server|api|fastify|r)\\s*\\.\\s*(${HTTP_METHODS})\\s*\\(\\s*(['"\`])([^'"\`]*)\\2`,
        'gi',
      );
      for (const match of matches(source, re)) {
        const method = match[1].toLowerCase();
        const pattern = match[3];
        if (method === 'use' && !pattern.startsWith('/')) continue;
        routes.push(
          makeRoute({
            method: method === 'all' || method === 'use' ? 'ALL' : method.toUpperCase(),
            pattern,
            kind: 'server',
            framework: 'express',
            file,
            line: index.lineOf(match.index),
            mount: method === 'use',
          }),
        );
      }
      // Routers montes : app.use('/api', router)
      for (const match of matches(source, /\.use\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)/g)) {
        routes.push(
          makeRoute({
            method: 'MOUNT',
            pattern: match[1],
            kind: 'mount',
            framework: 'express',
            file,
            line: index.lineOf(match.index),
            handler: match[2],
          }),
        );
      }
      return routes;
    },
  },
  {
    id: 'nestjs',
    frameworks: ['nestjs'],
    families: ['js'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      const controller = /@Controller\s*\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/.exec(file.content);
      const base = controller ? `/${(controller[1] || '').replace(/^\/+/, '')}` : '';
      for (const match of matches(file.content, /@(Get|Post|Put|Patch|Delete|Options|Head|All)\s*\(\s*['"`]?([^'"`)]*)['"`]?\s*\)/g)) {
        routes.push(
          makeRoute({
            method: match[1].toUpperCase(),
            pattern: joinRoute(base, match[2] || ''),
            kind: 'server',
            framework: 'nestjs',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },
  {
    id: 'react-router',
    frameworks: ['react-router', 'react', 'remix'],
    families: ['js'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /<Route\b[^>]*?\bpath\s*=\s*(?:['"]([^'"]*)['"]|\{['"`]([^'"`]*)['"`]\})/g)) {
        routes.push(
          makeRoute({
            method: 'PAGE',
            pattern: match[1] ?? match[2] ?? '',
            kind: 'client',
            framework: 'react-router',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      for (const match of matches(file.content, /\bpath\s*:\s*['"`]([^'"`]*)['"`]/g)) {
        const line = index.textOfLine(index.lineOf(match.index));
        if (!/element|component|Component|lazy|loader|children/.test(line + file.content.slice(match.index, match.index + 200))) continue;
        routes.push(
          makeRoute({
            method: 'PAGE',
            pattern: match[1],
            kind: 'client',
            framework: 'react-router',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },
  {
    id: 'vue-angular-router',
    frameworks: ['vue-router', 'vue', 'angular', 'nuxt'],
    families: ['js'],
    extract(file) {
      if (!/router|routes/i.test(file.relativePath) && !/createRouter|RouterModule|Routes\s*=/.test(file.content)) return [];
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /\bpath\s*:\s*['"`]([^'"`]*)['"`]/g)) {
        routes.push(
          makeRoute({
            method: 'PAGE',
            pattern: match[1],
            kind: 'client',
            framework: 'vue-router',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },

  // ----------------------------------------------------------------- Python
  {
    id: 'flask',
    frameworks: ['flask'],
    families: ['python'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /@\w+\.route\s*\(\s*['"]([^'"]*)['"](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/g)) {
        const methods = match[2] ? match[2].match(/['"](\w+)['"]/g)?.map((m) => m.replace(/['"]/g, '')) : ['GET'];
        for (const method of methods || ['GET']) {
          routes.push(
            makeRoute({
              method: method.toUpperCase(),
              pattern: match[1],
              kind: 'server',
              framework: 'flask',
              file,
              line: index.lineOf(match.index),
            }),
          );
        }
      }
      return routes;
    },
  },
  {
    id: 'fastapi',
    frameworks: ['fastapi'],
    families: ['python'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /@\w+\.(get|post|put|patch|delete|options|head|websocket)\s*\(\s*['"]([^'"]*)['"]/g)) {
        routes.push(
          makeRoute({
            method: match[1].toUpperCase(),
            pattern: match[2],
            kind: 'server',
            framework: 'fastapi',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },
  {
    id: 'django',
    frameworks: ['django'],
    families: ['python'],
    extract(file) {
      if (!/urls?\.py$/.test(file.relativePath) && !/urlpatterns/.test(file.content)) return [];
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /\b(?:path|re_path|url)\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+)/g)) {
        routes.push(
          makeRoute({
            method: 'ALL',
            pattern: `/${match[1].replace(/^\^|\$$/g, '')}`,
            kind: 'server',
            framework: 'django',
            file,
            line: index.lineOf(match.index),
            handler: match[2],
          }),
        );
      }
      return routes;
    },
  },

  // -------------------------------------------------------------------- JVM
  {
    id: 'spring',
    frameworks: ['spring', 'jvm'],
    families: ['jvm'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      const classMapping = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]*)['"]/.exec(file.content);
      const base = classMapping ? classMapping[1] : '';
      const re = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?[{\s]*['"]([^'"]*)['"]/g;
      let first = true;
      for (const match of matches(file.content, re)) {
        if (first && classMapping && match.index === classMapping.index) {
          first = false;
          continue;
        }
        first = false;
        routes.push(
          makeRoute({
            method: match[1] === 'Request' ? 'ALL' : match[1].toUpperCase(),
            pattern: joinRoute(base, match[2]),
            kind: 'server',
            framework: 'spring',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },

  // -------------------------------------------------------------------- PHP
  {
    id: 'laravel',
    frameworks: ['laravel', 'php'],
    families: ['php'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /Route::(get|post|put|patch|delete|options|any|match|resource|view|redirect)\s*\(\s*['"]([^'"]*)['"]/gi)) {
        routes.push(
          makeRoute({
            method: match[1].toUpperCase(),
            pattern: match[2],
            kind: 'server',
            framework: 'laravel',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      for (const match of matches(file.content, /#\[Route\s*\(\s*['"]([^'"]*)['"]/g)) {
        routes.push(
          makeRoute({ method: 'ALL', pattern: match[1], kind: 'server', framework: 'symfony', file, line: index.lineOf(match.index) }),
        );
      }
      return routes;
    },
  },

  // --------------------------------------------------------------------- Go
  {
    id: 'go-http',
    frameworks: ['go'],
    families: ['go'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      const re = /\.(HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE|Any)\s*\(\s*["`]([^"`]*)["`]/g;
      for (const match of matches(file.content, re)) {
        const isMethod = /^(GET|POST|PUT|PATCH|DELETE)$/.test(match[1]);
        routes.push(
          makeRoute({
            method: isMethod ? match[1] : 'ALL',
            pattern: match[2],
            kind: 'server',
            framework: 'go',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },

  // ------------------------------------------------------------------ Ruby
  {
    id: 'rails',
    frameworks: ['rails', 'ruby'],
    families: ['ruby'],
    extract(file) {
      if (!/routes\.rb$/.test(file.relativePath)) return [];
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /^\s*(get|post|put|patch|delete|root|resources?)\s+['"]?([^'",\s]*)['"]?/gm)) {
        const isRoot = match[1] === 'root';
        routes.push(
          makeRoute({
            method: isRoot ? 'GET' : match[1].toUpperCase(),
            pattern: isRoot ? '/' : `/${match[2].replace(/^\//, '')}`,
            kind: 'server',
            framework: 'rails',
            file,
            line: index.lineOf(match.index),
          }),
        );
      }
      return routes;
    },
  },

  // ----------------------------------------------------------------- Flutter
  {
    id: 'flutter',
    frameworks: ['flutter'],
    families: ['dart'],
    extract(file) {
      const routes = [];
      const index = lineIndexFor(file);
      for (const match of matches(file.content, /GoRoute\s*\(\s*(?:[^)]*?)path\s*:\s*['"]([^'"]*)['"]/g)) {
        routes.push(makeRoute({ method: 'PAGE', pattern: match[1], kind: 'client', framework: 'go_router', file, line: index.lineOf(match.index) }));
      }
      for (const match of matches(file.content, /['"](\/[\w\-/:]*)['"]\s*:\s*\(\s*(?:BuildContext\s+)?\w*\s*\)\s*=>/g)) {
        routes.push(makeRoute({ method: 'PAGE', pattern: match[1], kind: 'client', framework: 'flutter', file, line: index.lineOf(match.index) }));
      }
      for (const match of matches(file.content, /RouteSettings\s*\(\s*name\s*:\s*['"]([^'"]*)['"]/g)) {
        routes.push(makeRoute({ method: 'PAGE', pattern: match[1], kind: 'client', framework: 'flutter', file, line: index.lineOf(match.index) }));
      }
      return routes;
    },
  },
];

/**
 * Routes issues du systeme de fichiers (Next.js, Nuxt, SvelteKit, Astro,
 * site statique). Elles n'apparaissent dans aucun appel de fonction.
 */
export function extractFileSystemRoutes(context) {
  const routes = [];

  const nextLike = [
    { dirs: ['pages', 'src/pages'], framework: 'nextjs' },
    { dirs: ['app', 'src/app'], framework: 'nextjs-app' },
    { dirs: ['src/routes'], framework: 'sveltekit' },
    { dirs: ['src/pages'], framework: 'astro' },
  ];

  const usesFileRouting = context.has('nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix');

  if (usesFileRouting) {
    for (const { dirs, framework } of nextLike) {
      for (const dir of dirs) {
        for (const file of context.files) {
          if (!file.relativePath.startsWith(`${dir}/`)) continue;
          if (!/\.(jsx?|tsx?|vue|svelte|astro|mdx?)$/.test(file.name)) continue;
          if (/^_/.test(file.name) && framework === 'nextjs') continue;
          if (/^(layout|error|loading|not-found|template)\./.test(file.name)) continue;
          if (/^\+(layout|error|server)/.test(file.name)) continue;

          const pattern = fileToRoutePattern(file.relativePath.slice(dir.length + 1), framework);
          if (pattern === null) continue;
          routes.push(
            makeRoute({
              method: file.relativePath.includes('/api/') ? 'ALL' : 'PAGE',
              pattern,
              kind: file.relativePath.includes('/api/') ? 'server' : 'page',
              framework,
              file,
              line: 1,
            }),
          );
        }
      }
    }
  }

  // Pages HTML statiques : chaque fichier est une URL.
  for (const file of context.files) {
    if (file.language !== 'html') continue;
    if (/(^|\/)(partials?|includes?|components?|templates?|layouts?|emails?)\//i.test(file.relativePath)) continue;
    const rel = file.relativePath.replace(/^(public|static|www|docs|dist|src)\//, '');
    const pattern = `/${rel.replace(/index\.html?$/i, '').replace(/\.html?$/i, '')}`.replace(/\/+$/, '') || '/';
    routes.push(makeRoute({ method: 'PAGE', pattern, kind: 'page', framework: 'static', file, line: 1 }));
  }

  return routes;
}

/** Convertit `blog/[slug]/page.tsx` en `/blog/:slug`. */
export function fileToRoutePattern(relative, framework) {
  let route = relative.replace(/\.[^.]+$/, '');

  if (framework === 'sveltekit') {
    // Convention SvelteKit : `+page.svelte` est la page du dossier qui la
    // contient. `+page.server.js` fournit ses donnees, ce n'est pas une route.
    if (/\+page\.server$/.test(route) || /^\+(layout|error|server)/.test(relative)) return null;
    if (!/(^|\/)\+page$/.test(route)) return null;
    route = route.replace(/(^|\/)\+page$/, '');
    route = route.replace(/\((\w+)\)\//g, '');
  } else if (framework === 'nextjs-app') {
    if (!/(^|\/)(page|route)$/.test(route)) return null;
    route = route.replace(/(^|\/)(page|route)$/, '');
  } else {
    route = route.replace(/(^|\/)index$/, '');
  }

  route = route
    .replace(/\(\w+\)\//g, '') // groupes Next.js
    .replace(/\[\.\.\.([\w-]+)\]/g, '*') // catch-all
    .replace(/\[\[?\.\.\.([\w-]+)\]?\]/g, '*')
    .replace(/\[([\w-]+)\]/g, ':$1') // segments dynamiques
    .replace(/\$([\w-]+)/g, ':$1') // Remix
    .replace(/_([\w-]+)@/g, '');

  const normalized = `/${route}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized || '/';
}

function makeRoute({ method, pattern, kind, framework, file, line, handler = null, mount = false }) {
  const normalized = normalizeRoute(pattern);
  return {
    method: method || 'ALL',
    pattern: normalized,
    raw: pattern,
    kind,
    framework,
    file: file?.relativePath ?? null,
    line,
    handler,
    mount,
    dynamic: /[:*{<]/.test(normalized),
    segments: normalized.split('/').filter(Boolean).length,
    regex: routeToRegExp(normalized),
  };
}

export function normalizeRoute(pattern) {
  if (!pattern) return '/';
  let route = String(pattern).trim();
  route = route.split('?')[0].split('#')[0];
  if (!route.startsWith('/')) route = `/${route}`;
  route = route.replace(/\/+/g, '/');
  if (route.length > 1) route = route.replace(/\/$/, '');
  return route;
}

/**
 * Convertit un motif de route (tous dialectes) en expression reguliere :
 * :id, {id}, <int:id>, [id], *, **, (.*)
 */
export function routeToRegExp(pattern) {
  // Les segments dynamiques sont d'abord remplaces par des jetons opaques :
  // sinon la substitution suivante reecrirait les classes de caracteres deja
  // produites (`[^/]+` contient des crochets, comme `[id]`).
  const SEGMENT = ' S '; // un segment
  const REST = ' R '; // zero ou plusieurs segments

  const tokenized = pattern
    .replace(/\*\*/g, REST)
    .replace(/\{[^}]*\}/g, SEGMENT)
    .replace(/<[^>]*>/g, SEGMENT)
    .replace(/\[\.\.\.[^\]]*\]/g, REST)
    .replace(/\[[^\]]*\]/g, SEGMENT)
    .replace(/:[A-Za-z_][\w-]*\??/g, SEGMENT)
    .replace(/\*/g, REST);

  const source = tokenized
    .replace(/[.+^$()|[\]{}\\?]/g, '\\$&')
    .split(SEGMENT)
    .join('[^/]+')
    .split(REST)
    .join('.*');

  try {
    return new RegExp(`^${source}/?$`, 'i');
  } catch {
    return new RegExp(`^${pattern.replace(/[^\w/]/g, '.')}$`, 'i');
  }
}

function joinRoute(base, sub) {
  const left = (base || '').replace(/\/+$/, '');
  const right = (sub || '').replace(/^\/+/, '');
  return normalizeRoute(`${left}/${right}`);
}

/** Extrait les liens/navigations sortants d'un fichier. */
export function extractLinks(file) {
  const links = [];
  const index = lineIndexFor(file);
  const source = file.content;

  const patterns = [
    { re: /\b(?:href|action)\s*=\s*["']([^"'{}<>\s]+)["']/g, kind: 'href' },
    { re: /\b(?:src|poster|data-src)\s*=\s*["']([^"'{}<>\s]+)["']/g, kind: 'asset' },
    { re: /\bto\s*=\s*(?:["']([^"'{}<>\s]+)["']|\{\s*["']([^"']+)["']\s*\})/g, kind: 'link' },
    { re: /\b(?:router|history|navigate|Router)\s*\.\s*(?:push|replace|navigate|go)\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'nav' },
    { re: /\bnavigate\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'nav' },
    { re: /\b(?:redirect|sendRedirect|Redirect)\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'redirect' },
    { re: /\bpushNamed\s*\(\s*(?:context\s*,\s*)?["']([^"']+)["']/g, kind: 'nav' },
    { re: /\bcontext\.(?:go|push)\s*\(\s*["']([^"']+)["']/g, kind: 'nav' },
    { re: /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'fetch' },
    { re: /\baxios(?:\.\w+)?\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'fetch' },
    { re: /\baxios\.\w+\s*\(\s*["'`]([^"'`]+)["'`]/g, kind: 'fetch' },
  ];

  // Les helpers de route nommee appartiennent aux ecosystemes serveur.
  // En JavaScript, `route('quelque chose')` designe le plus souvent autre chose.
  if (['python', 'php', 'ruby', 'markup'].includes(file.family)) {
    patterns.push(
      { re: /\burl_for\s*\(\s*["']([^"']+)["']/g, kind: 'named' },
      { re: /\broute\s*\(\s*["']([^"']+)["']/g, kind: 'named' },
      { re: /\{\{\s*url\s*\(\s*['"]([^'"]+)['"]/g, kind: 'named' },
    );
  }

  const markupKinds = new Set(['href', 'asset']);

  for (const { re, kind } of patterns) {
    for (const match of matches(source, re)) {
      const target = match[1] ?? match[2];
      if (!target) continue;
      // Un attribut HTML ecrit a l'interieur d'une chaine JavaScript est de la
      // documentation ou un gabarit d'outil, pas un lien de l'application.
      if (markupKinds.has(kind) && file.family === 'js' && isQuoted(file, match.index)) continue;
      links.push({
        target: target.trim(),
        kind,
        file: file.relativePath,
        line: index.lineOf(match.index),
        external: /^(https?:)?\/\//i.test(target) || /^(mailto|tel|sms|ftp|data|javascript|blob):/i.test(target),
      });
    }
  }

  return links;
}

/**
 * Resout un lien relatif par rapport au fichier qui le contient.
 *
 * `./`, `../` et les cibles terminees par `/` designent l'index d'un dossier :
 * ce sont des liens parfaitement valides, qu'il ne faut pas confondre avec des
 * chemins introuvables.
 */
export function resolveLink(target, fromFile) {
  const dir = path.posix.dirname(fromFile);
  const brut = target.startsWith('/') ? target : path.posix.join(dir, target);
  const normalise = path.posix.normalize(brut);
  // `normalize` reduit './' et '.' a '.', qui designe la racine du perimetre.
  if (normalise === '.' || normalise === './') return '/';
  return normalizeRoute(normalise);
}
