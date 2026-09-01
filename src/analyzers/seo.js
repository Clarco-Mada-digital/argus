import { parseHtml, stripTags, visibleWordCount, isFullPage } from '../core/html.js';
import { isHtmlLike } from '../core/languages.js';
import { isQuoted, lineIndexFor, maskedSource } from '../core/scan.js';

/**
 * Analyseur SEO technique et on-page.
 *
 * Couvre : balises meta, structure de titres, contenu, donnees structurees,
 * images, URL canoniques, robots.txt / sitemap.xml, hreflang, Open Graph,
 * et les specificites des applications a rendu client (SPA).
 */
export default {
  id: 'seo',
  category: 'seo',
  label: 'Analyse SEO',
  order: 40,

  async run(context, report) {
    const options = context.config.options.seo;
    const pages = collectPages(context);

    context.shared.set('seoPages', pages.length);

    for (const page of pages) {
      analyzePage(page, context, options, report);
    }

    analyzeProjectFiles(context, report);
    analyzeSpa(context, pages, report);
    analyzeMetaDuplication(pages, report);
  },
};

/** Une « page » = un document HTML complet ou un composant racine de framework. */
function collectPages(context) {
  const pages = [];

  for (const file of context.sources({ families: ['markup', 'js'] })) {
    if (!file.readable) continue;
    const isHtml = isHtmlLike(file.language);
    // Dans un fichier JS, on cherche les signaux hors chaines de caracteres :
    // un `<title>` ecrit dans un gabarit d'outillage n'est pas une page.
    const searchable = isHtml ? file.content : maskedSource(file);
    const looksLikePage = isHtml
      ? isFullPage(file.content)
      : /<html|<head[\s>]|<Head>|next\/head|react-helmet|useHead\(|<svelte:head|<title>|export const metadata/.test(searchable);
    if (!looksLikePage) continue;
    if (/(^|\/)(partials?|includes?|emails?|mails?)\//i.test(file.relativePath)) continue;

    const nodes = parseHtml(file.content).filter((node) => isHtml || !isQuoted(file, node.start));
    if (nodes.length === 0) continue;

    pages.push({ file, nodes, html: file.content, isHtml, index: lineIndexFor(file) });
  }

  return pages;
}

/**
 * Verifie une page. Chaque aspect du referencement est traite par une
 * fonction dediee : elles partagent le meme contexte `c` et n'ont aucun
 * ordre d'execution impose entre elles.
 */
function analyzePage(page, context, options, report) {
  const { file, nodes, html, index } = page;
  const at = (node) => (node ? index.lineOf(node.start) : 1);
  const find = (tag) => nodes.filter((n) => n.tag === tag);
  const push = (input) => report({ file: file.relativePath, ...input });

  const htmlTag = find('html')[0];
  const head = find('head')[0];
  const titles = find('title');
  const metas = find('meta');
  const links = find('link');

  const metaByName = new Map();
  for (const meta of metas) {
    const key = (meta.attr('name') || meta.attr('property') || meta.attr('http-equiv') || '').toLowerCase();
    if (key && !metaByName.has(key)) metaByName.set(key, meta);
  }

  const c = { page, context, options, file, nodes, html, index, at, find, push,
    htmlTag, head, titles, metas, links, metaByName };

  verifierTitre(c);
  verifierDescription(c);
  verifierLangueEtViewport(c);
  verifierCanonique(c);
  verifierIndexation(c);
  verifierTitresHn(c);
  verifierImages(c);
  verifierPartageSocial(c);
  verifierDonneesStructurees(c);
  verifierVolumeContenu(c);
  verifierTextesDeLiens(c);
  verifierFavicon(c);
}


/** Titre de la page : presence, longueur, unicite. */
function verifierTitre(c) {
  const { options, page, at, push, head, titles } = c;
  const title = titles[0];
  const titleText = title ? stripTags(title.text || '').trim() : '';
  if (!title || !titleText) {
    push({
      ruleId: 'SEO-TITLE-MISSING',
      severity: 'critical',
      title: 'Balise <title> absente',
      message: 'La page n\'a pas de titre. C\'est le signal on-page le plus important et le texte affiche dans les resultats de recherche.',
      line: at(head) || 1,
      suggestion: `Ajoutez <title>Titre unique et descriptif — Marque</title>, entre ${options.titleMin} et ${options.titleMax} caracteres, avec le mot-cle principal en debut.`,
      effort: 'rapide',
      docs: 'https://developers.google.com/search/docs/appearance/title-link',
    });
  } else {
    if (titleText.length < options.titleMin) {
      push({
        ruleId: 'SEO-TITLE-SHORT',
        severity: 'medium',
        title: 'Titre trop court',
        message: `Le titre fait ${titleText.length} caracteres ("${titleText}"). En dessous de ${options.titleMin}, vous perdez de la surface d'expression dans les resultats.`,
        line: at(title),
        snippet: titleText,
        suggestion: 'Completez avec une precision utile : intention de recherche, ville, benefice, ou nom de marque en suffixe.',
        effort: 'rapide',
      });
    } else if (titleText.length > options.titleMax) {
      push({
        ruleId: 'SEO-TITLE-LONG',
        severity: 'low',
        title: 'Titre trop long',
        message: `Le titre fait ${titleText.length} caracteres : Google le tronquera aux alentours de ${options.titleMax}.`,
        line: at(title),
        snippet: titleText,
        suggestion: 'Placez l\'information essentielle dans les 55 premiers caracteres.',
        effort: 'rapide',
      });
    }
    if (titles.length > 1) {
      push({
        ruleId: 'SEO-TITLE-DUPLICATE',
        severity: 'medium',
        title: 'Plusieurs balises <title>',
        message: `${titles.length} balises <title> dans le document : le comportement est indefini.`,
        line: at(titles[1]),
        suggestion: 'Ne conservez qu\'une seule balise title dans le <head>.',
        effort: 'rapide',
      });
    }
  }
}

/** Meta description : presence et longueur. */
function verifierDescription(c) {
  const { options, at, push, head, metaByName } = c;
  const description = metaByName.get('description');
  const descriptionText = description?.attr('content')?.trim() || '';
  if (!description || !descriptionText) {
    push({
      ruleId: 'SEO-DESC-MISSING',
      severity: 'high',
      title: 'Meta description absente',
      message: 'Sans meta description, le moteur genere lui-meme un extrait, souvent peu engageant : le taux de clic en souffre.',
      line: at(head) || 1,
      suggestion: `Ajoutez <meta name="description" content="…"> de ${options.descriptionMin} a ${options.descriptionMax} caracteres, avec une promesse claire et un appel a l'action.`,
      effort: 'rapide',
      docs: 'https://developers.google.com/search/docs/appearance/snippet',
    });
  } else if (descriptionText.length < options.descriptionMin) {
    push({
      ruleId: 'SEO-DESC-SHORT',
      severity: 'low',
      title: 'Meta description trop courte',
      message: `La description fait ${descriptionText.length} caracteres.`,
      line: at(description),
      snippet: descriptionText,
      suggestion: `Visez ${options.descriptionMin}-${options.descriptionMax} caracteres.`,
      effort: 'rapide',
    });
  } else if (descriptionText.length > options.descriptionMax + 20) {
    push({
      ruleId: 'SEO-DESC-LONG',
      severity: 'info',
      title: 'Meta description trop longue',
      message: `La description fait ${descriptionText.length} caracteres et sera tronquee.`,
      line: at(description),
      suggestion: `Reduisez a ${options.descriptionMax} caracteres maximum.`,
      effort: 'rapide',
    });
  }
}

/** Langue declaree, viewport mobile et encodage. */
function verifierLangueEtViewport(c) {
  const { page, html, at, push, htmlTag, head, metas, metaByName } = c;
  if (htmlTag && !htmlTag.attr('lang')) {
    push({
      ruleId: 'SEO-LANG-MISSING',
      severity: 'high',
      title: 'Attribut lang absent sur <html>',
      message: 'La langue du document n\'est pas declaree : impact sur le ciblage geographique et sur les lecteurs d\'ecran.',
      line: at(htmlTag),
      suggestion: 'Ajoutez <html lang="fr"> (ou la langue reelle de la page).',
      effort: 'rapide',
      tags: ['a11y'],
    });
  }

  const viewport = metaByName.get('viewport');
  if (!viewport) {
    push({
      ruleId: 'SEO-VIEWPORT-MISSING',
      severity: 'high',
      title: 'Meta viewport absente',
      message: 'Sans viewport, la page s\'affiche en version bureau sur mobile. Google indexe en mobile-first : c\'est penalisant.',
      line: at(head) || 1,
      suggestion: 'Ajoutez <meta name="viewport" content="width=device-width, initial-scale=1">.',
      effort: 'rapide',
      tags: ['mobile', 'design'],
    });
  } else if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(viewport.attr('content') || '')) {
    push({
      ruleId: 'SEO-VIEWPORT-NOZOOM',
      severity: 'medium',
      title: 'Zoom desactive sur mobile',
      message: 'Le viewport empeche l\'utilisateur d\'agrandir la page (echec WCAG 1.4.4).',
      line: at(viewport),
      snippet: viewport.attr('content'),
      suggestion: 'Retirez user-scalable=no et maximum-scale.',
      effort: 'rapide',
      tags: ['a11y'],
    });
  }

  if (!metaByName.get('charset') && !metas.some((m) => m.has('charset'))) {
    push({
      ruleId: 'SEO-CHARSET-MISSING',
      severity: 'medium',
      title: 'Encodage non declare',
      message: 'Aucun <meta charset> : risque de caracteres accentues corrompus.',
      line: at(head) || 1,
      suggestion: 'Ajoutez <meta charset="utf-8"> en tout premier dans le <head>.',
      effort: 'rapide',
    });
  }
}

/** URL canonique : presence et forme absolue. */
function verifierCanonique(c) {
  const { page, at, push, head, links } = c;
  const canonical = links.find((l) => (l.attr('rel') || '').toLowerCase() === 'canonical');
  if (!canonical) {
    push({
      ruleId: 'SEO-CANONICAL-MISSING',
      severity: 'medium',
      title: 'URL canonique absente',
      message: 'Sans canonical, les variantes d\'URL (parametres UTM, /page et /page/, http et https) sont vues comme du contenu duplique.',
      line: at(head) || 1,
      suggestion: 'Ajoutez <link rel="canonical" href="https://votre-domaine.tld/chemin-de-la-page"> avec une URL absolue et auto-referente.',
      effort: 'moyen',
      docs: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
    });
  } else if (!/^https?:\/\//i.test(canonical.attr('href') || '') && !canonical.isDynamic) {
    push({
      ruleId: 'SEO-CANONICAL-RELATIVE',
      severity: 'low',
      title: 'URL canonique relative',
      message: 'Une canonical relative peut etre mal interpretee lors du crawl.',
      line: at(canonical),
      snippet: canonical.attr('href'),
      suggestion: 'Utilisez une URL absolue, protocole et domaine inclus.',
      effort: 'rapide',
    });
  }
}

/** Directives d'indexation (noindex). */
function verifierIndexation(c) {
  const { page, at, push, metaByName } = c;
  const robots = metaByName.get('robots');
  const robotsContent = (robots?.attr('content') || '').toLowerCase();
  if (/noindex/.test(robotsContent)) {
    push({
      ruleId: 'SEO-NOINDEX',
      severity: 'high',
      title: 'Page en noindex',
      message: 'Cette page demande explicitement a ne pas etre indexee. Volontaire ? Un noindex oublie apres une recette coute tout le trafic de la page.',
      line: at(robots),
      snippet: robotsContent,
      suggestion: 'Verifiez que c\'est intentionnel ; sinon retirez la directive noindex.',
      effort: 'rapide',
      confidence: 'firm',
    });
  }
}

/** Hierarchie des titres : h1 unique, niveaux continus. */
function verifierTitresHn(c) {
  const { page, nodes, at, push } = c;
  const headings = nodes.filter((n) => /^h[1-6]$/.test(n.tag));
  const h1s = headings.filter((n) => n.tag === 'h1');
  if (h1s.length === 0) {
    push({
      ruleId: 'SEO-H1-MISSING',
      severity: 'high',
      title: 'Aucun <h1>',
      message: 'La page n\'a pas de titre principal : la hierarchie du contenu est illisible pour les moteurs comme pour les lecteurs d\'ecran.',
      line: 1,
      suggestion: 'Ajoutez un unique <h1> decrivant le sujet de la page, coherent avec la balise title sans etre identique.',
      effort: 'rapide',
      tags: ['a11y'],
    });
  } else if (h1s.length > 1) {
    push({
      ruleId: 'SEO-H1-MULTIPLE',
      severity: 'low',
      title: 'Plusieurs <h1>',
      message: `${h1s.length} balises h1 sur la page : le sujet principal devient ambigu.`,
      line: at(h1s[1]),
      suggestion: 'Conservez un seul h1 et retrogradez les autres en h2.',
      effort: 'rapide',
    });
  }

  let previousLevel = 0;
  for (const heading of headings) {
    const level = Number(heading.tag[1]);
    if (previousLevel && level > previousLevel + 1) {
      push({
        ruleId: 'SEO-HEADING-SKIP',
        severity: 'low',
        title: 'Niveau de titre saute',
        message: `Passage de h${previousLevel} a h${level} : la hierarchie n'est pas continue.`,
        line: at(heading),
        snippet: stripTags(heading.text || '').slice(0, 80),
        suggestion: 'Utilisez les niveaux dans l\'ordre. Pour la taille visuelle, passez par le CSS, pas par le niveau de titre.',
        effort: 'rapide',
        tags: ['a11y'],
      });
      break;
    }
    if (level) previousLevel = level;
  }
}

/** Images : alternative textuelle, dimensions, chargement. */
function verifierImages(c) {
  const { page, nodes, at, push } = c;
  for (const img of nodes.filter((n) => n.tag === 'img')) {
    if (!img.has('alt')) {
      push({
        ruleId: 'SEO-IMG-ALT-MISSING',
        severity: 'medium',
        title: 'Image sans attribut alt',
        message: 'L\'image n\'a pas d\'alternative textuelle : contenu invisible pour Google Images et pour les lecteurs d\'ecran.',
        line: at(img),
        snippet: img.attr('src') || '<img>',
        suggestion: 'Ajoutez alt="description utile de l\'image". Pour une image purement decorative, mettez alt="" (vide, mais present).',
        effort: 'rapide',
        tags: ['a11y'],
      });
    }
    if (!img.has('width') || !img.has('height')) {
      push({
        ruleId: 'SEO-IMG-NO-DIMENSIONS',
        severity: 'low',
        title: 'Image sans dimensions',
        message: 'Sans width/height, le navigateur ne reserve pas l\'espace : la page saute au chargement (Cumulative Layout Shift).',
        line: at(img),
        snippet: img.attr('src') || '<img>',
        suggestion: 'Renseignez width et height (les valeurs intrinseques), le CSS peut ensuite les surcharger en pourcentage.',
        effort: 'rapide',
        tags: ['performance', 'cwv'],
      });
    }
    if (!img.has('loading') && !img.has('fetchpriority')) {
      push({
        ruleId: 'SEO-IMG-NO-LAZY',
        severity: 'info',
        title: 'Chargement des images non pilote',
        message: 'Aucun attribut loading : toutes les images sont chargees immediatement.',
        line: at(img),
        suggestion: 'loading="lazy" pour les images hors ecran, fetchpriority="high" pour l\'image principale (LCP).',
        effort: 'rapide',
        tags: ['performance'],
      });
    }
  }
}

/** Balises Open Graph pour les apercus de partage. */
function verifierPartageSocial(c) {
  const { at, push, head, metaByName } = c;
  const ogRequired = ['og:title', 'og:description', 'og:image', 'og:url', 'og:type'];
  const missingOg = ogRequired.filter((key) => !metaByName.has(key));
  if (missingOg.length === ogRequired.length) {
    push({
      ruleId: 'SEO-OG-MISSING',
      severity: 'medium',
      title: 'Balises Open Graph absentes',
      message: 'Aucune balise Open Graph : les partages sur les reseaux sociaux et messageries afficheront un apercu vide.',
      line: at(head) || 1,
      suggestion:
        'Ajoutez og:title, og:description, og:image (1200x630 px), og:url, og:type, plus twitter:card="summary_large_image".',
      effort: 'rapide',
      docs: 'https://ogp.me/',
    });
  } else if (missingOg.length > 0) {
    push({
      ruleId: 'SEO-OG-INCOMPLETE',
      severity: 'low',
      title: 'Open Graph incomplet',
      message: `Balises manquantes : ${missingOg.join(', ')}.`,
      line: at(head) || 1,
      suggestion: 'Completez les balises manquantes pour un apercu de partage fiable.',
      effort: 'rapide',
    });
  }
}

/** Presence et validite du balisage Schema.org. */
function verifierDonneesStructurees(c) {
  const { page, html, at, push, head } = c;
  const hasJsonLd = /application\/ld\+json/i.test(html);
  const hasMicrodata = /itemscope|itemtype\s*=/.test(html);
  if (!hasJsonLd && !hasMicrodata) {
    push({
      ruleId: 'SEO-STRUCTURED-DATA',
      severity: 'medium',
      title: 'Aucune donnee structuree',
      message: 'La page ne declare aucun schema JSON-LD : vous vous privez des resultats enrichis (etoiles, fil d\'Ariane, FAQ, produit).',
      line: at(head) || 1,
      suggestion:
        'Ajoutez un bloc <script type="application/ld+json"> avec le type Schema.org adapte (Organization et WebSite sur l\'accueil, BreadcrumbList partout, Article / Product / LocalBusiness selon la page), puis validez avec le test des resultats enrichis de Google.',
      effort: 'moyen',
      docs: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
    });
  } else if (hasJsonLd) {
    validateJsonLd(page, push);
  }
}

/** Volume de contenu reellement visible. */
function verifierVolumeContenu(c) {
  const { context, page, html, push } = c;
  const words = visibleWordCount(html);
  if (page.isHtml && words < context.config.options.seo.minWordCount && words > 0) {
    push({
      ruleId: 'SEO-THIN-CONTENT',
      severity: 'low',
      title: 'Contenu insuffisant',
      message: `La page contient environ ${words} mots visibles. En dessous de ${context.config.options.seo.minWordCount}, elle a peu de chances de se positionner sur une requete concurrentielle.`,
      line: 1,
      suggestion: 'Enrichissez le contenu en repondant reellement a l\'intention de recherche : contexte, details, questions frequentes, preuve.',
      effort: 'important',
      data: { words },
    });
  }
}

/** Libelles de liens explicites. */
function verifierTextesDeLiens(c) {
  const { nodes, at, push } = c;
  for (const anchor of nodes.filter((n) => n.tag === 'a')) {
    const text = stripTags(anchor.text || '').trim().toLowerCase();
    if (!text) continue;
    if (/^(cliquez ici|ici|en savoir plus|lire la suite|click here|read more|voir|link|lien|>>|\.\.\.)$/.test(text)) {
      push({
        ruleId: 'SEO-ANCHOR-GENERIC',
        severity: 'low',
        title: 'Texte de lien non descriptif',
        message: `Le lien "${text}" ne dit rien de sa destination : il n'apporte aucun signal semantique et gene la navigation au clavier.`,
        line: at(anchor),
        snippet: text,
        suggestion: 'Remplacez par un libelle explicite : "Consulter nos tarifs" plutot que "En savoir plus".',
        effort: 'rapide',
        tags: ['a11y'],
      });
    }
  }
}

/** Icone de site. */
function verifierFavicon(c) {
  const { page, at, push, head, links } = c;
  if (page.isHtml && !links.some((l) => /icon/i.test(l.attr('rel') || ''))) {
    push({
      ruleId: 'SEO-FAVICON-MISSING',
      severity: 'info',
      title: 'Favicon absent',
      message: 'Aucun lien vers une icone de site.',
      line: at(head) || 1,
      suggestion: 'Ajoutez <link rel="icon" href="/favicon.ico"> et une icone apple-touch 180x180.',
      effort: 'rapide',
    });
  }
}

function validateJsonLd(page, push) {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(page.html)) !== null) {
    const body = match[1].trim();
    if (!body || /\{\{|\$\{|<%/.test(body)) continue;
    try {
      const data = JSON.parse(body);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (!item['@context'] || !item['@type']) {
          push({
            ruleId: 'SEO-JSONLD-INCOMPLETE',
            severity: 'low',
            title: 'JSON-LD incomplet',
            message: 'Un bloc de donnees structurees n\'a pas de @context ou de @type : il sera ignore.',
            line: page.index.lineOf(match.index),
            suggestion: 'Ajoutez "@context": "https://schema.org" et un "@type" valide.',
            effort: 'rapide',
          });
        }
      }
    } catch (error) {
      push({
        ruleId: 'SEO-JSONLD-INVALID',
        severity: 'medium',
        title: 'JSON-LD invalide',
        message: `Les donnees structurees ne sont pas du JSON valide (${error.message}) : Google les ignorera totalement.`,
        line: page.index.lineOf(match.index),
        snippet: body.slice(0, 120),
        suggestion: 'Corrigez la syntaxe et validez avec le test des resultats enrichis.',
        effort: 'rapide',
      });
    }
  }
}

/** robots.txt, sitemap.xml, manifest, redirections. */
function analyzeProjectFiles(context, report) {
  const isWeb = context.has('static-site', 'nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'react', 'vue', 'angular', 'django', 'laravel', 'rails', 'express');
  if (!isWeb) return;

  const robots = context.files.find((f) => f.name === 'robots.txt');
  const sitemap = context.files.find((f) => /^sitemap.*\.(xml|txt)$/i.test(f.name) || /sitemap\.[jt]s$/.test(f.name));

  if (!robots) {
    report({
      ruleId: 'SEO-ROBOTS-MISSING',
      severity: 'medium',
      title: 'robots.txt absent',
      message: 'Aucun fichier robots.txt : vous ne controlez pas ce que les robots explorent, et vous ne signalez pas votre sitemap.',
      suggestion:
        'Creez public/robots.txt :\nUser-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: https://votre-domaine.tld/sitemap.xml',
      effort: 'rapide',
      docs: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
    });
  } else {
    const content = robots.content;
    if (/^\s*Disallow:\s*\/\s*$/mi.test(content) && !/Allow:/i.test(content)) {
      report({
        ruleId: 'SEO-ROBOTS-BLOCK-ALL',
        severity: 'critical',
        title: 'robots.txt bloque tout le site',
        message: '"Disallow: /" interdit l\'exploration de l\'integralite du site. Aucune page ne sera indexee.',
        file: robots.relativePath,
        line: 1,
        suggestion: 'Retirez cette directive si le site est en production (c\'est typiquement un reste de pre-production).',
        effort: 'rapide',
      });
    }
    if (!/Sitemap:/i.test(content)) {
      report({
        ruleId: 'SEO-ROBOTS-NO-SITEMAP',
        severity: 'low',
        title: 'Sitemap non declare dans robots.txt',
        message: 'robots.txt ne pointe pas vers le sitemap.',
        file: robots.relativePath,
        line: 1,
        suggestion: 'Ajoutez la ligne : Sitemap: https://votre-domaine.tld/sitemap.xml',
        effort: 'rapide',
      });
    }
  }

  if (!sitemap) {
    report({
      ruleId: 'SEO-SITEMAP-MISSING',
      severity: 'medium',
      title: 'sitemap.xml absent',
      message: 'Aucun plan de site : les pages profondes ou peu maillees risquent de ne jamais etre decouvertes.',
      suggestion:
        'Generez un sitemap.xml a la construction (next-sitemap, @nuxtjs/sitemap, django.contrib.sitemaps, spatie/laravel-sitemap) et declarez-le dans robots.txt et la Search Console.',
      effort: 'moyen',
    });
  }

  const hasManifest = context.files.some((f) => /^(site\.)?(web)?manifest(\.json)?$/i.test(f.name) || f.name === 'manifest.json');
  if (!hasManifest && context.has('static-site', 'nextjs', 'nuxt', 'react', 'vue')) {
    report({
      ruleId: 'SEO-MANIFEST-MISSING',
      severity: 'info',
      title: 'Manifeste web absent',
      message: 'Pas de manifest.json : pas d\'installation sur l\'ecran d\'accueil, pas de theme-color.',
      suggestion: 'Ajoutez un manifest.json (name, short_name, icons 192/512, theme_color, display) et referencez-le dans le <head>.',
      effort: 'rapide',
      tags: ['pwa', 'design'],
    });
  }
}

/** Une SPA sans rendu serveur est un angle mort SEO majeur. */
function analyzeSpa(context, pages, report) {
  const isSpa = context.has('react', 'vue', 'angular') && !context.has('nextjs', 'nuxt', 'sveltekit', 'astro', 'gatsby', 'remix');
  if (!isSpa) return;

  const hasMetaLib = context
    .sources({ families: ['js'] })
    .some((f) => /react-helmet|vue-meta|@unhead|useHead|@angular\/platform-server|Meta\s*\)/.test(f.content));

  report({
    ruleId: 'SEO-SPA-NO-SSR',
    severity: hasMetaLib ? 'medium' : 'high',
    title: 'Application a rendu client sans rendu serveur',
    message:
      'Le contenu est genere en JavaScript dans le navigateur. Google finit souvent par le rendre, mais avec un delai et des echecs ; les autres moteurs et les apercus de partage voient une page vide.',
    suggestion: hasMetaLib
      ? 'Une gestion des meta est en place : passez a l\'etape suivante avec du prerendu (vite-plugin-ssr, prerender-spa-plugin) ou une migration vers Next.js/Nuxt pour les pages publiques.'
      : 'A minima, installez une bibliotheque de gestion des balises (react-helmet-async, @unhead/vue) pour que chaque route ait ses propres title/description, puis mettez en place un prerendu des pages publiques.',
    effort: 'important',
    tags: ['architecture'],
  });

  const routeCount = context.routes.filter((r) => r.kind === 'client' || r.kind === 'page').length;
  if (routeCount > 3 && !hasMetaLib) {
    report({
      ruleId: 'SEO-SPA-SHARED-META',
      severity: 'high',
      title: 'Toutes les routes partagent les memes meta',
      message: `${routeCount} routes client ont ete detectees, mais aucune gestion dynamique du <head> : toutes les pages auront le meme titre et la meme description.`,
      suggestion: 'Definissez title, description et canonical par route.',
      effort: 'moyen',
    });
  }
}

/** Deux pages avec le meme titre se cannibalisent dans les resultats. */
function analyzeMetaDuplication(pages, report) {
  const byTitle = new Map();
  const byDescription = new Map();

  for (const page of pages) {
    const nodes = page.nodes;
    const title = stripTags(nodes.find((n) => n.tag === 'title')?.text || '').trim();
    const description = nodes
      .find((n) => n.tag === 'meta' && (n.attr('name') || '').toLowerCase() === 'description')
      ?.attr('content')
      ?.trim();

    if (title && !/\{\{|\$\{|<%/.test(title)) push(byTitle, title, page);
    if (description && !/\{\{|\$\{|<%/.test(description)) push(byDescription, description, page);
  }

  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    report({
      ruleId: 'SEO-TITLE-DUPLICATED-PAGES',
      severity: 'medium',
      title: 'Titre identique sur plusieurs pages',
      message: `${group.length} pages partagent le titre "${title}" : elles se concurrencent sur les memes requetes.`,
      file: group[0].file.relativePath,
      line: 1,
      suggestion: 'Donnez a chaque page un titre unique refletant son contenu specifique.',
      effort: 'moyen',
      data: { pages: group.map((p) => p.file.relativePath) },
    });
  }

  for (const [, group] of byDescription) {
    if (group.length < 2) continue;
    report({
      ruleId: 'SEO-DESC-DUPLICATED-PAGES',
      severity: 'low',
      title: 'Meta description dupliquee',
      message: `${group.length} pages partagent la meme meta description.`,
      file: group[0].file.relativePath,
      line: 1,
      suggestion: 'Redigez une description propre a chaque page.',
      effort: 'moyen',
      data: { pages: group.map((p) => p.file.relativePath) },
    });
  }

  function push(map, key, value) {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  }
}
