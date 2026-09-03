import { crawl } from '../crawler/index.js';

/**
 * Analyseur d'exploration HTTP.
 *
 * Ne s'active que si une URL est fournie (`--crawl https://…`). Il transforme
 * les observations reelles du serveur en problemes, repartis dans les
 * categories habituelles : les en-tetes vont en securite, les meta en SEO, les
 * 404 en routes, les temps de reponse en performance.
 *
 * Sa valeur tient a une chose : ce sont des faits verifies, pas des
 * deductions. « L'en-tete CSP est absent » devient une observation, plus une
 * supposition tiree du code.
 */
export default {
  id: 'crawl',
  /** Categorie par defaut des constats qui n'en precisent pas. */
  category: 'routes',
  /**
   * Categories reellement alimentees : l'exploration produit des constats de
   * securite (en-tetes), de SEO (meta, robots), de performance (temps de
   * reponse) et de routes (404). Le moteur s'en sert pour decider s'il doit
   * lancer l'analyseur, meme quand `--only seo` est demande.
   */
  categories: ['routes', 'seo', 'security', 'performance'],
  label: 'Exploration du site en ligne',
  order: 90,

  appliesTo: (context) => Boolean(context.config.crawl),

  async run(context, report) {
    const resultat = await crawl(context.config.crawl, {
      ...(context.config.crawlOptions || {}),
      onEvent: context.config.onCrawlEvent,
    });

    context.shared.set('crawl', resumer(resultat));

    const pagesHtml = resultat.pages.filter((p) => p.html);

    verifierStatuts(resultat, report);
    verifierRedirections(resultat, report);
    verifierEnTetes(resultat, pagesHtml, report);
    verifierLiensExternes(resultat, report);
    verifierSeoReel(pagesHtml, report);
    verifierPerformance(resultat, report);
    verifierRobots(resultat, report);
    rapprocherRoutes(resultat, context, report);
  },
};

function resumer(resultat) {
  const pages = resultat.pages;
  return {
    origin: resultat.origin,
    pagesExplorees: pages.length,
    enErreur: pages.filter((p) => p.status && p.status >= 400).length,
    liensExternesVerifies: resultat.external.length,
    liensExternesMorts: resultat.external.filter((e) => !e.ok).length,
    ttfbMedian: mediane(pages.filter((p) => p.ttfb).map((p) => p.ttfb)),
    durationMs: resultat.durationMs,
    tronque: resultat.truncated,
    inventaire: inventorier(resultat),
  };
}

/**
 * Inventaire de ce qui a ete visite et de ce vers quoi le site pointe.
 *
 * Un compte agrege — « 10 pages explorees » — ne permet pas de verifier la
 * couverture : l'utilisateur ne sait pas *lesquelles*, et se demande a juste
 * titre si ses pages produits ont ete vues. La liste repond a la question.
 *
 * Les liens sortants sont regroupes par domaine plutot que listes un a un.
 * Ce qui compte pour le referencement n'est pas « ce lien-ci existe » mais
 * « voila a qui ce site adresse son autorite, et combien de fois » — un
 * domaine cite trente fois se remarque, trente lignes separees non.
 */
function inventorier(resultat) {
  const pages = resultat.pages
    .map((page) => ({
      url: page.url,
      chemin: cheminDe(page.url, resultat.origin),
      statut: page.status ?? null,
      profondeur: page.depth ?? 0,
      titre: page.seo?.title || null,
      // D'ou vient le lien : indispensable pour corriger une page en erreur,
      // puisque c'est la page *source* qu'il faut modifier.
      depuis: page.from ? cheminDe(page.from, resultat.origin) : null,
      erreur: page.error || null,
    }))
    .sort((a, b) => a.profondeur - b.profondeur || a.chemin.localeCompare(b.chemin));

  const parDomaine = new Map();
  for (const lien of resultat.external) {
    let domaine = lien.url;
    try {
      domaine = new URL(lien.url).host;
    } catch {
      /* URL non analysable : on garde la chaine telle quelle */
    }

    if (!parDomaine.has(domaine)) {
      parDomaine.set(domaine, { domaine, liens: 0, morts: 0, sources: new Set(), exemples: [] });
    }
    const groupe = parDomaine.get(domaine);
    groupe.liens++;
    if (!lien.ok) groupe.morts++;
    for (const source of lien.sources || []) groupe.sources.add(cheminDe(source, resultat.origin));
    if (groupe.exemples.length < 3) groupe.exemples.push({ url: lien.url, statut: lien.status ?? null, ok: lien.ok });
  }

  const domaines = [...parDomaine.values()]
    .map((g) => ({ ...g, sources: [...g.sources] }))
    // Les domaines morts d'abord — ce sont eux qui demandent une action —
    // puis les plus cites, qui pesent le plus dans le maillage sortant.
    .sort((a, b) => b.morts - a.morts || b.liens - a.liens);

  return { pages, domaines };
}

function cheminDe(url, origin) {
  try {
    const analysee = new URL(url);
    return analysee.origin === origin ? analysee.pathname + analysee.search : url;
  } catch {
    return url;
  }
}

function verifierStatuts(resultat, report) {
  for (const page of resultat.pages) {
    if (page.error) {
      report({
        ruleId: 'CRAWL-UNREACHABLE',
        category: 'routes',
        severity: 'high',
        title: 'Page injoignable',
        message: `${page.url} n'a pas repondu : ${page.error}${page.from ? ` (liee depuis ${page.from})` : ''}.`,
        suggestion: 'Verifiez que le serveur repond et que le delai de reponse reste sous quelques secondes.',
        effort: 'moyen',
        confidence: 'certain',
        data: { url: page.url },
      });
      continue;
    }

    if (page.status >= 500) {
      report({
        ruleId: 'CRAWL-SERVER-ERROR',
        category: 'routes',
        severity: 'critical',
        title: `Erreur serveur ${page.status}`,
        message: `${page.url} renvoie ${page.status}${page.from ? `, alors qu'elle est liee depuis ${page.from}` : ''}.`,
        suggestion: 'Consultez les journaux du serveur pour cette URL. Une erreur 5xx rencontree par un robot fait chuter la confiance accordee au site.',
        effort: 'important',
        confidence: 'certain',
        data: { url: page.url, status: page.status },
      });
    } else if (page.status >= 400) {
      report({
        ruleId: 'CRAWL-BROKEN-PAGE',
        category: 'routes',
        severity: page.status === 404 ? 'high' : 'medium',
        title: `Lien mort verifie (${page.status})`,
        message: `${page.url} renvoie ${page.status}${page.from ? `, mais reste liee depuis ${page.from}` : ''}.`,
        suggestion: 'Corrigez le lien source, ou mettez en place une redirection 301 vers la page qui remplace celle-ci.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['seo'],
        data: { url: page.url, status: page.status, from: page.from },
      });
    }

    if (page.blockedByRobots) {
      report({
        ruleId: 'CRAWL-ROBOTS-BLOCKED',
        category: 'seo',
        severity: 'medium',
        title: 'Page bloquee par robots.txt',
        message: `${page.url} est liee depuis le site mais interdite d'exploration par robots.txt.`,
        suggestion: 'Si la page doit etre indexee, retirez la directive Disallow correspondante. Sinon, retirez aussi les liens internes qui y menent.',
        effort: 'rapide',
        confidence: 'certain',
        data: { url: page.url },
      });
    }
  }
}

function verifierRedirections(resultat, report) {
  for (const page of resultat.pages) {
    if (!page.redirects || page.redirects.length === 0) continue;

    if (page.redirects.length > 1) {
      report({
        ruleId: 'CRAWL-REDIRECT-CHAIN',
        category: 'performance',
        severity: 'medium',
        title: 'Chaine de redirections',
        message: `${page.url} passe par ${page.redirects.length} redirections avant d'arriver a ${page.finalUrl}. Chaque saut ajoute un aller-retour reseau et dilue le signal transmis aux moteurs.`,
        suggestion: `Remplacez la chaine par une redirection unique de ${page.url} vers ${page.finalUrl}.`,
        effort: 'rapide',
        confidence: 'certain',
        tags: ['seo'],
        data: { chaine: page.redirects.map((r) => `${r.status} ${r.to}`) },
      });
    }

    const temporaire = page.redirects.find((r) => r.status === 302 || r.status === 307);
    if (temporaire) {
      report({
        ruleId: 'CRAWL-TEMPORARY-REDIRECT',
        category: 'seo',
        severity: 'low',
        title: 'Redirection temporaire',
        message: `${temporaire.from} redirige en ${temporaire.status} (temporaire). Les moteurs ne transferent pas la valeur de la page d'origine.`,
        suggestion: 'Si le changement est definitif, utilisez un code 301 (ou 308).',
        effort: 'rapide',
        confidence: 'certain',
        data: { url: temporaire.from, status: temporaire.status },
      });
    }
  }
}

/** En-tetes de securite reellement envoyes — la verification que le code seul ne permet pas. */
const EN_TETES_SECURITE = [
  {
    nom: 'content-security-policy',
    severite: 'high',
    titre: 'Content-Security-Policy',
    pourquoi: 'Sans CSP, une seule faille XSS permet d\'executer n\'importe quel script sur vos pages.',
    quoi: 'Commencez en mode observation : Content-Security-Policy-Report-Only, puis durcissez progressivement vers `default-src \'self\'`.',
  },
  {
    nom: 'strict-transport-security',
    severite: 'medium',
    titre: 'Strict-Transport-Security',
    pourquoi: 'Sans HSTS, la toute premiere visite peut etre interceptee et redirigee en HTTP.',
    quoi: 'Ajoutez : Strict-Transport-Security: max-age=31536000; includeSubDomains',
    httpsSeulement: true,
  },
  {
    nom: 'x-content-type-options',
    severite: 'low',
    titre: 'X-Content-Type-Options',
    pourquoi: 'Sans cet en-tete, le navigateur peut deviner le type d\'un fichier et executer comme script ce qui n\'en est pas un.',
    quoi: 'Ajoutez : X-Content-Type-Options: nosniff',
  },
  {
    nom: 'referrer-policy',
    severite: 'low',
    titre: 'Referrer-Policy',
    pourquoi: 'Par defaut, l\'URL complete de vos pages est transmise aux sites tiers, parametres compris.',
    quoi: 'Ajoutez : Referrer-Policy: strict-origin-when-cross-origin',
  },
  {
    nom: 'x-frame-options',
    severite: 'medium',
    titre: 'X-Frame-Options ou frame-ancestors',
    pourquoi: 'Sans protection, votre site peut etre affiche dans une iframe invisible pour pieger les clics (clickjacking).',
    quoi: 'Ajoutez X-Frame-Options: DENY, ou la directive frame-ancestors dans votre CSP.',
    alternative: (headers) => /frame-ancestors/i.test(headers['content-security-policy'] || ''),
  },
];

function verifierEnTetes(resultat, pagesHtml, report) {
  const accueil = pagesHtml[0];
  if (!accueil) return;
  const headers = accueil.headers || {};
  const enHttps = accueil.finalUrl.startsWith('https:');

  for (const attendu of EN_TETES_SECURITE) {
    if (headers[attendu.nom]) continue;
    if (attendu.httpsSeulement && !enHttps) continue;
    if (attendu.alternative?.(headers)) continue;

    report({
      ruleId: `CRAWL-HEADER-${attendu.nom.toUpperCase()}`,
      category: 'security',
      severity: attendu.severite,
      title: `En-tete absent : ${attendu.titre}`,
      message: `${attendu.pourquoi} Verifie sur ${accueil.finalUrl} : l'en-tete n'est pas envoye.`,
      suggestion: attendu.quoi,
      effort: 'rapide',
      confidence: 'certain',
      tags: ['A05:2021', 'CWE-693'],
      docs: 'https://owasp.org/www-project-secure-headers/',
      data: { url: accueil.finalUrl, header: attendu.nom },
    });
  }

  const revele = ['server', 'x-powered-by', 'x-aspnet-version'].filter((nom) => headers[nom]);
  if (revele.length > 0) {
    report({
      ruleId: 'CRAWL-VERSION-DISCLOSURE',
      category: 'security',
      severity: 'low',
      title: 'Technologie et version divulguees',
      message: `Le serveur annonce : ${revele.map((n) => `${n}: ${headers[n]}`).join(', ')}. Cela indique a un attaquant quelles failles connues essayer en premier.`,
      suggestion: 'Masquez ces en-tetes (server_tokens off dans nginx, app.disable("x-powered-by") avec Express).',
      effort: 'rapide',
      confidence: 'certain',
      data: { headers: revele },
    });
  }

  if (!enHttps) {
    report({
      ruleId: 'CRAWL-NO-HTTPS',
      category: 'security',
      severity: 'critical',
      title: 'Site servi en HTTP',
      message: `${accueil.finalUrl} n'est pas chiffre : tout le trafic est lisible et modifiable sur le reseau.`,
      suggestion: 'Installez un certificat (Let\'s Encrypt est gratuit), redirigez tout le HTTP vers HTTPS en 301, puis activez HSTS.',
      effort: 'moyen',
      confidence: 'certain',
      tags: ['CWE-319'],
    });
  }

  // Contenu mixte : une page HTTPS qui charge des ressources en clair.
  for (const page of pagesHtml) {
    if (!page.finalUrl.startsWith('https:')) continue;
    const enClair = (page.links || []).filter((l) => l.url.startsWith('http:') && l.type !== 'lien');
    if (enClair.length === 0) continue;
    report({
      ruleId: 'CRAWL-MIXED-CONTENT',
      category: 'security',
      severity: 'high',
      title: 'Contenu mixte',
      message: `${page.url} est en HTTPS mais charge ${enClair.length} ressource(s) en HTTP : ${enClair.slice(0, 3).map((l) => l.url).join(', ')}. Les navigateurs les bloquent.`,
      suggestion: 'Passez ces ressources en https://, ou hebergez-les sur votre domaine.',
      effort: 'rapide',
      confidence: 'certain',
      data: { url: page.url, ressources: enClair.slice(0, 10).map((l) => l.url) },
    });
  }
}

function verifierLiensExternes(resultat, report) {
  for (const lien of resultat.external) {
    if (lien.ok) continue;
    report({
      ruleId: 'CRAWL-EXTERNAL-DEAD',
      category: 'routes',
      severity: 'low',
      title: 'Lien externe mort',
      message: `${lien.url} ${lien.status ? `renvoie ${lien.status}` : `est injoignable (${lien.error})`}. Reference depuis ${lien.sources.slice(0, 2).join(', ')}.`,
      suggestion: 'Mettez le lien a jour, pointez vers l\'archive (web.archive.org) ou retirez-le. Les liens morts degradent la confiance des visiteurs.',
      effort: 'rapide',
      confidence: lien.status ? 'certain' : 'firm',
      data: { url: lien.url, status: lien.status, sources: lien.sources.slice(0, 5) },
    });
  }
}

/** SEO constate sur le HTML reellement servi, avant execution du JavaScript. */
function verifierSeoReel(pagesHtml, report) {
  const titres = new Map();

  for (const page of pagesHtml) {
    const seo = page.seo;
    if (!seo) continue;

    if (seo.words < 50 && seo.h1 === 0) {
      report({
        ruleId: 'CRAWL-EMPTY-HTML',
        category: 'seo',
        severity: 'high',
        title: 'Page vide dans le HTML servi',
        message: `${page.url} ne contient que ${seo.words} mots et aucun titre h1 dans la reponse du serveur. Le contenu est donc genere par JavaScript : les robots qui n'executent pas de script voient une page vide.`,
        suggestion:
          'Mettez en place un rendu serveur ou un prerendu pour les pages publiques. C\'est le probleme de referencement le plus couteux d\'une application a rendu client — et il est invisible dans un navigateur.',
        effort: 'important',
        confidence: 'certain',
        data: { url: page.url, mots: seo.words },
      });
    }

    if (seo.robots && /noindex/i.test(seo.robots)) {
      report({
        ruleId: 'CRAWL-NOINDEX-LIVE',
        category: 'seo',
        severity: 'critical',
        title: 'Page en ligne marquee noindex',
        message: `${page.url} demande explicitement a ne pas etre indexee (meta robots: ${seo.robots}). Verifie sur le site en production.`,
        suggestion: 'Si cette page doit apparaitre dans les resultats de recherche, retirez la directive noindex. C\'est frequemment un reste de pre-production.',
        effort: 'rapide',
        confidence: 'certain',
        data: { url: page.url, robots: seo.robots },
      });
    }

    if (seo.canonical) {
      try {
        const canonique = new URL(seo.canonical, page.finalUrl).href;
        if (normaliserPourComparaison(canonique) !== normaliserPourComparaison(page.finalUrl)) {
          report({
            ruleId: 'CRAWL-CANONICAL-MISMATCH',
            category: 'seo',
            severity: 'medium',
            title: 'URL canonique divergente',
            message: `${page.url} declare comme canonique ${canonique}. Si ce n'est pas voulu, cette page ne sera pas indexee sous sa propre adresse.`,
            suggestion: 'Verifiez que la canonique est auto-referente sur les pages a indexer.',
            effort: 'rapide',
            confidence: 'certain',
            data: { url: page.url, canonical: canonique },
          });
        }
      } catch { /* canonique illisible : deja signalee par l'analyse statique */ }
    }

    if (seo.title) {
      const cle = seo.title.trim();
      if (!titres.has(cle)) titres.set(cle, []);
      titres.get(cle).push(page.url);
    }
  }

  for (const [titre, urls] of titres) {
    if (urls.length < 2) continue;
    report({
      ruleId: 'CRAWL-DUPLICATE-TITLE',
      category: 'seo',
      severity: 'medium',
      title: 'Titre identique sur plusieurs pages en ligne',
      message: `${urls.length} pages servent le titre « ${titre} » : ${urls.slice(0, 3).join(', ')}.`,
      suggestion: 'Donnez a chaque page un titre unique. Constate sur le site en production, ce n\'est plus une hypothese.',
      effort: 'moyen',
      confidence: 'certain',
      data: { titre, urls: urls.slice(0, 10) },
    });
  }
}

function verifierPerformance(resultat, report) {
  const pages = resultat.pages.filter((p) => p.ttfb && p.ok);
  if (pages.length === 0) return;

  const lentes = pages.filter((p) => p.ttfb > 800).sort((a, b) => b.ttfb - a.ttfb);
  if (lentes.length > 0) {
    report({
      ruleId: 'CRAWL-SLOW-RESPONSE',
      category: 'performance',
      severity: lentes[0].ttfb > 2000 ? 'high' : 'medium',
      title: 'Temps de reponse serveur eleve',
      message: `${lentes.length} page(s) repondent en plus de 800 ms. La plus lente : ${lentes[0].url} en ${lentes[0].ttfb} ms. Google recommande de rester sous 600 ms.`,
      suggestion:
        'Cherchez la cause cote serveur : requetes non indexees, absence de cache, appels externes synchrones. Un cache de page ou un CDN reduit souvent ce temps d\'un ordre de grandeur.',
      effort: 'important',
      confidence: 'certain',
      tags: ['ttfb', 'cwv'],
      data: { pages: lentes.slice(0, 5).map((p) => ({ url: p.url, ttfb: p.ttfb })) },
    });
  }

  const sansCompression = resultat.pages.filter(
    (p) => p.html && p.bytes > 50 * 1024 && !/(gzip|br|deflate|zstd)/i.test(p.headers['content-encoding'] || ''),
  );
  if (sansCompression.length > 0) {
    report({
      ruleId: 'CRAWL-NO-COMPRESSION',
      category: 'performance',
      severity: 'medium',
      title: 'Reponses HTML non compressees',
      message: `${sansCompression.length} page(s) sont servies sans compression, dont ${sansCompression[0].url} (${Math.round(sansCompression[0].bytes / 1024)} Ko).`,
      suggestion: 'Activez Brotli ou gzip sur votre serveur : le HTML se compresse typiquement a 20 % de sa taille, pour une ligne de configuration.',
      effort: 'rapide',
      confidence: 'certain',
    });
  }

  const sansCache = resultat.pages.filter(
    (p) => p.ok && /\.(css|js|png|jpe?g|webp|woff2?)$/i.test(new URL(p.url).pathname) && !p.headers['cache-control'],
  );
  if (sansCache.length > 0) {
    report({
      ruleId: 'CRAWL-NO-CACHE-HEADER',
      category: 'performance',
      severity: 'low',
      title: 'Ressources statiques sans en-tete de cache',
      message: `${sansCache.length} ressource(s) statique(s) sont servies sans Cache-Control : elles sont retelechargees a chaque visite.`,
      suggestion: 'Servez les ressources versionnees avec Cache-Control: public, max-age=31536000, immutable.',
      effort: 'rapide',
      confidence: 'certain',
    });
  }
}

function verifierRobots(resultat, report) {
  const robots = resultat.robots;

  if (robots.status === null || robots.status === 404) {
    report({
      ruleId: 'CRAWL-NO-ROBOTS',
      category: 'seo',
      severity: 'medium',
      title: 'robots.txt absent en production',
      message: `${resultat.origin}/robots.txt ne repond pas (${robots.status ?? 'injoignable'}).`,
      suggestion: 'Publiez un robots.txt, ne serait-ce que pour y declarer votre sitemap.',
      effort: 'rapide',
      confidence: 'certain',
    });
    return;
  }

  if (robots.rules.some((r) => r.type === 'disallow' && r.path === '/')) {
    report({
      ruleId: 'CRAWL-ROBOTS-BLOCKS-ALL',
      category: 'seo',
      severity: 'critical',
      title: 'robots.txt interdit tout le site en production',
      message: `${resultat.origin}/robots.txt contient « Disallow: / ». Aucune page ne sera indexee.`,
      suggestion: 'Retirez cette directive immediatement si le site doit etre reference. C\'est presque toujours un oubli de mise en ligne.',
      effort: 'rapide',
      confidence: 'certain',
    });
  }

  if (robots.sitemaps.length === 0) {
    report({
      ruleId: 'CRAWL-ROBOTS-NO-SITEMAP',
      category: 'seo',
      severity: 'low',
      title: 'Sitemap non declare en production',
      message: 'Le robots.txt en ligne ne mentionne aucun sitemap.',
      suggestion: `Ajoutez : Sitemap: ${resultat.origin}/sitemap.xml`,
      effort: 'rapide',
      confidence: 'certain',
    });
  }
}

/**
 * Confronte les routes trouvees dans le code aux pages reellement atteintes.
 * Une route declaree mais jamais servie signale un deploiement incomplet.
 */
function rapprocherRoutes(resultat, context, report) {
  const pages = context.routes.filter((r) => (r.kind === 'page' || r.kind === 'client') && !r.dynamic);
  if (pages.length === 0 || resultat.truncated) return;

  const atteintes = new Set(resultat.pages.filter((p) => p.ok).map((p) => new URL(p.finalUrl).pathname.replace(/\/$/, '') || '/'));
  const manquantes = pages.filter((r) => !atteintes.has(r.pattern)).slice(0, 15);

  if (manquantes.length > 0 && atteintes.size > 1) {
    report({
      ruleId: 'CRAWL-ROUTE-NOT-REACHED',
      category: 'routes',
      severity: 'low',
      title: 'Routes du code jamais atteintes en ligne',
      message: `${manquantes.length} route(s) declarees dans le code n'ont pas ete rencontrees lors de l'exploration : ${manquantes.slice(0, 5).map((r) => r.pattern).join(', ')}.`,
      suggestion:
        'Soit ces pages ne sont liees depuis nulle part (ajoutez-les a la navigation ou au sitemap), soit elles ne sont pas deployees. Verifiez laquelle des deux situations s\'applique.',
      effort: 'moyen',
      confidence: 'tentative',
      data: { routes: manquantes.map((r) => r.pattern) },
    });
  }
}

function normaliserPourComparaison(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url;
  }
}

function mediane(valeurs) {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.floor(triees.length / 2)];
}
