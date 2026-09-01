/**
 * Explorateur HTTP.
 *
 * Contrairement au reste d'Argus, ce module sort sur le reseau : il demande
 * reellement les pages a votre serveur. C'est ce qui permet de verifier ce
 * qu'aucune analyse statique ne peut affirmer — les vrais codes HTTP, les
 * chaines de redirection, les en-tetes de securite effectivement envoyes, et
 * le HTML tel que le recoit un robot d'indexation.
 *
 * Il n'execute pas le JavaScript : c'est justement ce que voient la plupart
 * des robots au premier passage, donc l'information la plus utile pour le SEO.
 */

import { parseHtml, stripTags, visibleWordCount } from '../core/html.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; ArgusBot/1.0; +analyse locale)';

export const DEFAULT_CRAWL_OPTIONS = {
  maxPages: 50,
  maxDepth: 4,
  concurrency: 4,
  delayMs: 150,
  timeoutMs: 15000,
  respectRobots: true,
  checkExternal: true,
  maxExternal: 40,
  includeSubdomains: false,
};

/**
 * @param {string} startUrl
 * @returns {Promise<{pages, external, robots, origin, errors, durationMs}>}
 */
export async function crawl(startUrl, options = {}) {
  const config = { ...DEFAULT_CRAWL_OPTIONS, ...options };
  const onEvent = config.onEvent || (() => {});
  const start = Date.now();

  let origin;
  try {
    origin = new URL(startUrl);
  } catch {
    throw new Error(`URL de depart invalide : ${startUrl}`);
  }

  const robots = config.respectRobots ? await fetchRobots(origin, config) : { rules: [], sitemaps: [], raw: null };
  const pages = new Map();
  const externalTargets = new Map();
  const errors = [];

  const queue = [{ url: normalizeUrl(origin.href), depth: 0, from: null }];
  const seen = new Set([normalizeUrl(origin.href)]);

  while (queue.length > 0 && pages.size < config.maxPages) {
    const lot = queue.splice(0, config.concurrency);
    const resultats = await Promise.all(
      lot.map(async (item) => {
        if (config.delayMs) await pause(config.delayMs);
        return visit(item, config, origin, robots);
      }),
    );

    for (const page of resultats) {
      if (!page) continue;
      pages.set(page.url, page);
      onEvent({ type: 'page', url: page.url, status: page.status, count: pages.size, total: config.maxPages });
      if (page.error) errors.push({ url: page.url, message: page.error });

      for (const lien of page.links || []) {
        if (lien.external) {
          if (!externalTargets.has(lien.url)) externalTargets.set(lien.url, { url: lien.url, sources: [] });
          externalTargets.get(lien.url).sources.push(page.url);
          continue;
        }
        const normalise = normalizeUrl(lien.url);
        if (seen.has(normalise)) continue;
        if (page.depth >= config.maxDepth) continue;
        if (pages.size + queue.length >= config.maxPages) continue;
        seen.add(normalise);
        queue.push({ url: normalise, depth: page.depth + 1, from: page.url });
      }
    }
  }

  // Verification des liens sortants : une simple requete HEAD suffit.
  const external = [];
  if (config.checkExternal) {
    const cibles = [...externalTargets.values()].slice(0, config.maxExternal);
    // argus-disable-next-line — lots successifs : politesse envers les serveurs interroges
    for (let i = 0; i < cibles.length; i += config.concurrency) {
      const lot = cibles.slice(i, i + config.concurrency);
      const verifies = await Promise.all(lot.map((cible) => checkExternal(cible, config)));
      external.push(...verifies);
      onEvent({ type: 'external', checked: external.length, total: cibles.length });
    }
  }

  return {
    origin: origin.origin,
    startUrl: origin.href,
    pages: [...pages.values()],
    external,
    robots,
    errors,
    durationMs: Date.now() - start,
    truncated: queue.length > 0,
  };
}

async function visit(item, config, origin, robots) {
  if (config.respectRobots && isDisallowed(new URL(item.url).pathname, robots)) {
    return { url: item.url, depth: item.depth, from: item.from, blockedByRobots: true, status: null, links: [] };
  }

  const debut = Date.now();
  const redirects = [];
  let url = item.url;
  let response = null;

  try {
    // On suit les redirections a la main pour mesurer la longueur de la chaine.
    for (let saut = 0; saut < 6; saut++) {
      response = await fetchWithTimeout(url, { redirect: 'manual', method: 'GET' }, config.timeoutMs);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const cible = response.headers.get('location');
      if (!cible) break;
      const suivante = new URL(cible, url).href;
      redirects.push({ from: url, to: suivante, status: response.status });
      url = suivante;
    }
  } catch (error) {
    return {
      url: item.url, depth: item.depth, from: item.from, status: null,
      error: error.name === 'AbortError' ? `Delai depasse (${config.timeoutMs} ms)` : error.message,
      links: [], redirects,
    };
  }

  const ttfb = Date.now() - debut;
  const contentType = response.headers.get('content-type') || '';
  const estHtml = contentType.includes('text/html');
  const corps = estHtml ? await response.text().catch(() => '') : '';

  const page = {
    url: item.url,
    finalUrl: url,
    depth: item.depth,
    from: item.from,
    status: response.status,
    ok: response.ok,
    contentType,
    ttfb,
    bytes: Number(response.headers.get('content-length')) || Buffer.byteLength(corps),
    headers: Object.fromEntries([...response.headers.entries()]),
    redirects,
    html: estHtml ? corps : null,
    links: [],
  };

  if (estHtml && corps) {
    page.links = extractPageLinks(corps, url, origin, config);
    page.seo = summarizeSeo(corps);
  }

  return page;
}

function extractPageLinks(html, pageUrl, origin, config) {
  const liens = [];
  const vus = new Set();
  const noeuds = parseHtml(html);

  const ajouter = (valeur, type) => {
    if (!valeur) return;
    const brut = valeur.trim();
    if (!brut || brut.startsWith('#')) return;
    if (/^(mailto|tel|sms|javascript|data|blob|about):/i.test(brut)) return;

    let resolue;
    try {
      resolue = new URL(brut, pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(resolue.protocol)) return;

    const memeOrigine = config.includeSubdomains
      ? resolue.hostname.endsWith(origin.hostname.replace(/^www\./, ''))
      : resolue.origin === origin.origin;

    const cle = `${type}:${resolue.href}`;
    if (vus.has(cle)) return;
    vus.add(cle);
    liens.push({ url: resolue.href, type, external: !memeOrigine, raw: brut });
  };

  for (const noeud of noeuds) {
    if (noeud.tag === 'a') ajouter(noeud.attr('href'), 'lien');
    else if (noeud.tag === 'img') ajouter(noeud.attr('src'), 'image');
    else if (noeud.tag === 'script') ajouter(noeud.attr('src'), 'script');
    else if (noeud.tag === 'link' && /stylesheet/i.test(noeud.attr('rel') || '')) ajouter(noeud.attr('href'), 'style');
    else if (noeud.tag === 'iframe') ajouter(noeud.attr('src'), 'iframe');
  }

  return liens;
}

/** Resume SEO du HTML reellement servi (avant execution du JavaScript). */
function summarizeSeo(html) {
  const noeuds = parseHtml(html);
  const meta = new Map();
  for (const noeud of noeuds.filter((n) => n.tag === 'meta')) {
    const cle = (noeud.attr('name') || noeud.attr('property') || '').toLowerCase();
    if (cle && !meta.has(cle)) meta.set(cle, noeud.attr('content') || '');
  }

  return {
    title: stripTags(noeuds.find((n) => n.tag === 'title')?.text || '').trim(),
    description: meta.get('description') || null,
    robots: meta.get('robots') || null,
    canonical: noeuds.find((n) => n.tag === 'link' && (n.attr('rel') || '').toLowerCase() === 'canonical')?.attr('href') || null,
    h1: noeuds.filter((n) => n.tag === 'h1').length,
    lang: noeuds.find((n) => n.tag === 'html')?.attr('lang') || null,
    words: visibleWordCount(html),
    hasOg: [...meta.keys()].some((k) => k.startsWith('og:')),
    hasJsonLd: /application\/ld\+json/i.test(html),
    imagesSansAlt: noeuds.filter((n) => n.tag === 'img' && !n.has('alt')).length,
  };
}

async function checkExternal(cible, config) {
  try {
    let response = await fetchWithTimeout(cible.url, { method: 'HEAD', redirect: 'follow' }, config.timeoutMs);
    // Certains serveurs refusent HEAD : on retente en GET avant de conclure.
    if (response.status === 405 || response.status === 501) {
      response = await fetchWithTimeout(cible.url, { method: 'GET', redirect: 'follow' }, config.timeoutMs);
    }
    return { ...cible, status: response.status, ok: response.ok, finalUrl: response.url };
  } catch (error) {
    return { ...cible, status: null, ok: false, error: error.name === 'AbortError' ? 'delai depasse' : error.message };
  }
}

async function fetchRobots(origin, config) {
  const url = new URL('/robots.txt', origin.origin).href;
  try {
    const response = await fetchWithTimeout(url, {}, config.timeoutMs);
    if (!response.ok) return { rules: [], sitemaps: [], raw: null, status: response.status };
    const texte = await response.text();
    return { ...parseRobots(texte), raw: texte, status: response.status };
  } catch {
    return { rules: [], sitemaps: [], raw: null, status: null };
  }
}

/** Analyse robots.txt en ne retenant que les groupes qui nous concernent. */
export function parseRobots(texte) {
  const rules = [];
  const sitemaps = [];
  let concerne = false;

  for (const ligne of texte.split(/\r?\n/)) {
    const propre = ligne.split('#')[0].trim();
    if (!propre) continue;
    const [cleBrute, ...reste] = propre.split(':');
    const cle = cleBrute.trim().toLowerCase();
    const valeur = reste.join(':').trim();

    if (cle === 'user-agent') {
      concerne = valeur === '*' || /argus/i.test(valeur);
    } else if (cle === 'sitemap') {
      sitemaps.push(valeur);
    } else if (concerne && (cle === 'disallow' || cle === 'allow')) {
      if (valeur) rules.push({ type: cle, path: valeur });
    }
  }

  return { rules, sitemaps };
}

export function isDisallowed(pathname, robots) {
  let decision = null;
  let longueur = -1;
  for (const regle of robots.rules || []) {
    if (!pathname.startsWith(regle.path.replace(/\*$/, ''))) continue;
    // La regle la plus specifique l'emporte, comme dans la norme.
    if (regle.path.length > longueur) {
      longueur = regle.path.length;
      decision = regle.type === 'disallow';
    }
  }
  return decision === true;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    // Les parametres de campagne creent des doublons sans interet.
    for (const parametre of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']) {
      u.searchParams.delete(parametre);
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.href;
  } catch {
    return url;
  }
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,*/*', ...(options.headers || {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
