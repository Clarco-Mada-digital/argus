import { parseHtml, stripTags } from '../core/html.js';
import { contrastRatio, parseColor, toHex, toPixels, wcagLevel } from '../core/color.js';
import { isQuoted, lineIndexFor, matches } from '../core/scan.js';

/**
 * Analyseur design et accessibilite.
 *
 * Deux volets :
 *  - accessibilite (WCAG) : contrastes, libelles, navigation clavier, semantique ;
 *  - systeme de design : coherence des couleurs, espacements, typographie,
 *    responsive, et signaux de dette CSS.
 */
export default {
  id: 'design',
  category: 'design',
  label: 'Design et accessibilite',
  order: 50,

  async run(context, report) {
    const options = context.config.options.design;
    const styleFiles = context.sources({ families: ['style'] });
    const markupFiles = context.sources({ families: ['markup', 'js'] }).filter((f) => /<[a-z]/i.test(f.content));

    const tokens = collectDesignTokens(styleFiles, context);
    context.shared.set('designTokens', {
      colors: tokens.colors.size,
      fontSizes: [...tokens.fontSizes].sort((a, b) => a - b),
      spacings: [...tokens.spacings].sort((a, b) => a - b),
      usesVariables: tokens.variableCount > 0,
      breakpoints: [...tokens.breakpoints].sort((a, b) => a - b),
    });

    for (const file of styleFiles) {
      analyzeStylesheet(file, options, report);
    }

    for (const file of markupFiles) {
      analyzeMarkup(file, options, report);
    }

    analyzeDesignSystem(tokens, styleFiles, context, report);
    analyzeResponsive(tokens, styleFiles, context, report);
  },
};

// ---------------------------------------------------------------- Feuilles CSS

/** Decoupe grossiere d'une feuille de style en blocs { selector, body, offset }. */
function parseRules(source) {
  const rules = [];
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const raw = match[1];
    const selector = raw.trim().replace(/\s+/g, ' ');
    if (!selector || selector.startsWith('@')) continue;
    // On pointe sur le premier caractere du selecteur, pas sur l'espace qui
    // le precede : sinon la ligne rapportee est celle de la regle precedente.
    const offset = match.index + (raw.length - raw.trimStart().length);
    rules.push({ selector, body: match[2], offset, declarations: parseDeclarations(match[2]) });
  }
  return rules;
}

function parseDeclarations(body) {
  const declarations = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (name) declarations[name] = value;
  }
  return declarations;
}

function analyzeStylesheet(file, options, report) {
  const source = file.content;
  const index = lineIndexFor(file);
  const rules = parseRules(source);
  const push = (input) => report({ file: file.relativePath, ...input });

  let importantCount = 0;
  const zIndexes = [];

  for (const rule of rules) {
    const line = index.lineOf(rule.offset);
    const { declarations } = rule;

    // --- Contraste texte / fond declares dans la meme regle.
    const color = declarations.color;
    const background = declarations['background-color'] || extractBackgroundColor(declarations.background);
    if (color && background) {
      const ratio = contrastRatio(color, background);
      if (ratio !== null) {
        const fontSize = toPixels(declarations['font-size']) || 16;
        const isBold = /bold|[6-9]00/.test(declarations['font-weight'] || '');
        const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
        const level = wcagLevel(ratio, isLarge);
        if (level === 'fail') {
          push({
            ruleId: 'A11Y-CONTRAST',
            severity: ratio < 3 ? 'high' : 'medium',
            title: 'Contraste insuffisant',
            message: `Le contraste entre ${color} et ${background} est de ${ratio}:1, en dessous du minimum WCAG AA de ${isLarge ? '3' : options.minContrastRatio}:1 pour ce texte.`,
            line,
            snippet: `${rule.selector} { color: ${color}; background: ${background}; }`,
            suggestion: `Assombrissez le texte ou eclaircissez le fond. Par exemple ${suggestContrast(color, background)}. Le contraste conditionne la lisibilite pour 1 personne sur 12 (deficience de la vision des couleurs) et pour tout le monde en plein soleil.`,
            effort: 'rapide',
            tags: ['wcag-1.4.3', 'a11y'],
            data: { ratio, required: isLarge ? 3 : options.minContrastRatio },
            docs: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
          });
        }
      }
    }

    // --- Suppression du focus visible.
    if (/:focus/.test(rule.selector) && /outline\s*:\s*(none|0)/.test(rule.body) && !/box-shadow|border|outline-offset/.test(rule.body)) {
      push({
        ruleId: 'A11Y-FOCUS-REMOVED',
        severity: 'high',
        title: 'Indicateur de focus supprime',
        message: 'outline: none sans style de remplacement : la navigation au clavier devient invisible.',
        line,
        snippet: rule.selector,
        suggestion: 'Remplacez par un style explicite : :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }',
        effort: 'rapide',
        tags: ['wcag-2.4.7', 'a11y'],
      });
    }

    // --- Taille de police trop petite.
    const fontSize = toPixels(declarations['font-size']);
    if (fontSize !== null && fontSize > 0 && fontSize < options.minFontSizePx) {
      push({
        ruleId: 'DESIGN-FONT-TOO-SMALL',
        severity: 'medium',
        title: 'Texte trop petit',
        message: `font-size: ${declarations['font-size']} (~${Math.round(fontSize)}px) est en dessous du seuil de lisibilite de ${options.minFontSizePx}px.`,
        line,
        snippet: rule.selector,
        suggestion: 'Utilisez au minimum 14px pour du texte secondaire et 16px pour le corps de texte. Exprimez les tailles en rem pour respecter les preferences du navigateur.',
        effort: 'rapide',
        tags: ['a11y', 'lisibilite'],
      });
    }

    // --- Cibles tactiles trop petites.
    const width = toPixels(declarations.width);
    const height = toPixels(declarations.height);
    const isInteractive = /button|\.btn|\ba\b|input|\[role=["']?button|\.link|\.icon/i.test(rule.selector);
    if (isInteractive && height !== null && height > 0 && height < options.minTapTargetPx && !/:hover|:before|:after/.test(rule.selector)) {
      push({
        ruleId: 'DESIGN-TAP-TARGET',
        severity: 'medium',
        title: 'Cible tactile trop petite',
        message: `"${rule.selector}" fait ${Math.round(height)}px de haut${width ? ` et ${Math.round(width)}px de large` : ''} ; la recommandation est ${options.minTapTargetPx}x${options.minTapTargetPx}px.`,
        line,
        snippet: rule.selector,
        suggestion: `Augmentez min-height/min-width a ${options.minTapTargetPx}px, ou agrandissez la zone cliquable avec du padding sans changer l'apparence.`,
        effort: 'rapide',
        tags: ['wcag-2.5.5', 'mobile'],
      });
    }

    if (declarations['z-index']) {
      const value = Number.parseInt(declarations['z-index'], 10);
      if (Number.isFinite(value)) zIndexes.push({ value, selector: rule.selector, line });
    }

    if (/user-select\s*:\s*none/.test(rule.body) && /body|html|\*/.test(rule.selector)) {
      push({
        ruleId: 'DESIGN-NO-SELECT',
        severity: 'low',
        title: 'Selection de texte desactivee globalement',
        message: 'Empecher la selection du texte sur toute la page bloque la copie, la traduction et les outils d\'assistance.',
        line,
        suggestion: 'Limitez user-select: none aux elements d\'interface (poignees, boutons), jamais au contenu.',
        effort: 'rapide',
      });
    }
  }

  for (const _ of matches(source, /!important/g)) importantCount++;
  const importantRatio = rules.length > 0 ? importantCount / rules.length : 0;
  if (importantCount > 15 && importantRatio > 0.15) {
    push({
      ruleId: 'DESIGN-IMPORTANT-OVERUSE',
      severity: 'low',
      title: 'Usage excessif de !important',
      message: `${importantCount} declarations !important pour ${rules.length} regles. La cascade CSS n'est plus maitrisee : chaque nouvelle regle demandera un !important de plus.`,
      line: 1,
      suggestion: 'Reduisez la specificite des selecteurs concurrents, ou adoptez une convention (BEM, utilitaires, couches @layer) plutot que de forcer.',
      effort: 'important',
      data: { count: importantCount, rules: rules.length },
    });
  }

  const extremeZ = zIndexes.filter((z) => z.value > 999);
  if (extremeZ.length > 3) {
    push({
      ruleId: 'DESIGN-ZINDEX-CHAOS',
      severity: 'low',
      title: 'Empilement z-index non maitrise',
      message: `${extremeZ.length} valeurs de z-index superieures a 999 (max : ${Math.max(...extremeZ.map((z) => z.value))}). Les superpositions deviennent imprevisibles.`,
      line: extremeZ[0].line,
      snippet: `${extremeZ[0].selector} { z-index: ${extremeZ[0].value} }`,
      suggestion: 'Definissez une echelle en variables CSS (--z-dropdown: 10; --z-modal: 100; --z-toast: 1000) et n\'utilisez que ces valeurs.',
      effort: 'moyen',
    });
  }
}

function extractBackgroundColor(background) {
  if (!background) return null;
  const match = /(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|red|blue|green|gray|grey)\b)/i.exec(background);
  return match ? match[1] : null;
}

function suggestContrast(colorValue, backgroundValue) {
  const fg = parseColor(colorValue);
  const bg = parseColor(backgroundValue);
  if (!fg || !bg) return 'ajustez la luminosite d\'une des deux couleurs';
  const bgLuminance = (bg.r + bg.g + bg.b) / 3;
  const darken = bgLuminance > 128;
  let candidate = { ...fg };
  for (let step = 0; step < 20; step++) {
    candidate = {
      r: clampByte(candidate.r + (darken ? -12 : 12)),
      g: clampByte(candidate.g + (darken ? -12 : 12)),
      b: clampByte(candidate.b + (darken ? -12 : 12)),
      a: 1,
    };
    if ((contrastRatio(candidate, bg) || 0) >= 4.5) break;
  }
  return `color: ${toHex(candidate)} (contraste ${contrastRatio(candidate, bg)}:1)`;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// ------------------------------------------------------------------- Balisage

/**
 * Balises reellement rendues par le fichier.
 * Dans un fichier JavaScript, une balise citee entre guillemets (chaine de
 * gabarit, exemple de documentation, motif de regle) n'est pas de l'interface :
 * on l'ecarte, sinon tout code manipulant du HTML se signale lui-meme.
 */
function markupNodes(file) {
  const nodes = parseHtml(file.content);
  if (file.family !== 'js') return nodes;
  return nodes.filter((node) => !isQuoted(file, node.start));
}

/** Extrait la balise ouvrante et son contenu immediat, sur une seule ligne. */
function openingTag(file, node) {
  const end = Math.min(node.closeStart ?? node.end, node.end + 80, file.content.length);
  return file.content.slice(node.start, end).replace(/\s+/g, ' ').slice(0, 160);
}

function analyzeMarkup(file, options, report) {
  const nodes = markupNodes(file);
  if (nodes.length === 0) return;
  const index = lineIndexFor(file);
  const at = (node) => index.lineOf(node.start);
  const push = (input) => report({ file: file.relativePath, ...input });

  const hasLandmarkMain = nodes.some((n) => n.tag === 'main' || (n.attr('role') || '') === 'main');
  const isFullDocument = nodes.some((n) => n.tag === 'body');

  for (const node of nodes) {
    // --- Boutons et liens sans nom accessible.
    if (['button', 'a'].includes(node.tag)) {
      const text = stripTags(node.text || '').trim();
      const label = node.attr('aria-label') || node.attr('title') || node.attr('aria-labelledby');
      const hasIconOnly = !text && !label;
      if (hasIconOnly && !node.isDynamic && !/\{/.test(node.text || '')) {
        push({
          ruleId: 'A11Y-NO-ACCESSIBLE-NAME',
          severity: 'high',
          title: `<${node.tag}> sans nom accessible`,
          message: `Cet element interactif n'a ni texte visible ni aria-label : un lecteur d'ecran annoncera seulement "bouton" ou "lien".`,
          line: at(node),
          snippet: openingTag(file, node),
          suggestion: 'Ajoutez un texte visible, ou aria-label="Fermer la fenetre" si l\'element ne contient qu\'une icone. Marquez l\'icone decorative avec aria-hidden="true".',
          effort: 'rapide',
          tags: ['wcag-4.1.2', 'a11y'],
        });
      }
      if (node.tag === 'a' && !node.has('href') && !node.isDynamic) {
        push({
          ruleId: 'A11Y-LINK-NO-HREF',
          severity: 'medium',
          title: 'Lien sans href',
          message: 'Un <a> sans href n\'est pas focusable au clavier et n\'est pas annonce comme un lien.',
          line: at(node),
          suggestion: 'Utilisez <button> pour une action, ou donnez un href reel au lien.',
          effort: 'rapide',
          tags: ['a11y'],
        });
      }
    }

    // --- Champs de formulaire sans etiquette.
    if (['input', 'select', 'textarea'].includes(node.tag)) {
      const type = (node.attr('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
      const hasLabel =
        node.has('aria-label') ||
        node.has('aria-labelledby') ||
        node.has('title') ||
        (node.id && new RegExp(`for\\s*=\\s*["']${node.id}["']`).test(file.content));
      if (!hasLabel && !node.isDynamic) {
        push({
          ruleId: 'A11Y-INPUT-NO-LABEL',
          severity: 'high',
          title: 'Champ de formulaire sans etiquette',
          message: `Le champ ${node.attr('name') || node.tag} n'a pas d'etiquette associee. Un placeholder ne remplace pas un label : il disparait a la saisie.`,
          line: at(node),
          snippet: file.content.slice(node.start, node.end),
          suggestion: 'Associez un <label for="id-du-champ">, ou ajoutez aria-label si le libelle visible est impossible.',
          effort: 'rapide',
          tags: ['wcag-3.3.2', 'a11y', 'ux'],
        });
      }
      if (['email', 'tel', 'password', 'text'].includes(type) && !node.has('autocomplete')) {
        push({
          ruleId: 'UX-NO-AUTOCOMPLETE',
          severity: 'low',
          title: 'Champ sans autocomplete',
          message: 'Sans attribut autocomplete, le navigateur ne peut pas pre-remplir le champ : friction inutile, surtout sur mobile.',
          line: at(node),
          suggestion: 'Ajoutez autocomplete="email" / "tel" / "current-password" / "name" selon le champ.',
          effort: 'rapide',
          tags: ['ux', 'wcag-1.3.5'],
        });
      }
    }

    // --- Elements non interactifs rendus cliquables.
    if (['div', 'span', 'li', 'td'].includes(node.tag)) {
      const clickable = node.has('onclick') || node.has('@click') || node.has('v-on:click') || node.has('(click)');
      if (clickable && !node.has('role') && !node.has('tabindex')) {
        push({
          ruleId: 'A11Y-CLICKABLE-DIV',
          severity: 'medium',
          title: `<${node.tag}> cliquable non accessible`,
          message: 'Un element non interactif porte un gestionnaire de clic : il est inatteignable au clavier et invisible pour les technologies d\'assistance.',
          line: at(node),
          snippet: file.content.slice(node.start, node.end),
          suggestion: 'Utilisez <button type="button">. Si ce n\'est pas possible, ajoutez role="button", tabindex="0" et un gestionnaire clavier (Entree et Espace).',
          effort: 'moyen',
          tags: ['wcag-2.1.1', 'a11y'],
        });
      }
    }

    // --- tabindex positif.
    const tabindex = Number.parseInt(node.attr('tabindex') ?? '', 10);
    if (Number.isFinite(tabindex) && tabindex > 0) {
      push({
        ruleId: 'A11Y-POSITIVE-TABINDEX',
        severity: 'medium',
        title: 'tabindex positif',
        message: `tabindex="${tabindex}" force un ordre de tabulation artificiel qui finit toujours par diverger de l'ordre visuel.`,
        line: at(node),
        suggestion: 'Utilisez uniquement tabindex="0" (focusable) ou "-1" (focusable par script), et reorganisez le DOM pour obtenir le bon ordre.',
        effort: 'moyen',
        tags: ['wcag-2.4.3', 'a11y'],
      });
    }

    // --- Styles en ligne : dette de design.
    const style = node.attr('style');
    if (style && style.length > 60 && !node.isDynamic) {
      push({
        ruleId: 'DESIGN-INLINE-STYLE',
        severity: 'info',
        title: 'Style en ligne volumineux',
        message: `Un attribut style de ${style.length} caracteres sur <${node.tag}> : non reutilisable, non couvert par le theme, et bloquant pour une CSP stricte.`,
        line: at(node),
        snippet: style.slice(0, 100),
        suggestion: 'Deplacez ces declarations dans une classe ou un composant style.',
        effort: 'rapide',
        tags: ['maintenance'],
      });
    }

    // --- Iframes sans titre.
    if (node.tag === 'iframe' && !node.has('title')) {
      push({
        ruleId: 'A11Y-IFRAME-NO-TITLE',
        severity: 'medium',
        title: 'iframe sans titre',
        message: 'Un cadre sans attribut title est annonce comme "cadre" sans indication de contenu.',
        line: at(node),
        suggestion: 'Ajoutez title="Carte de localisation" (ou tout libelle decrivant le contenu embarque).',
        effort: 'rapide',
        tags: ['wcag-4.1.2', 'a11y'],
      });
    }

    // --- Tableaux de donnees sans en-tetes.
    if (node.tag === 'table' && !node.has('role')) {
      const body = file.content.slice(node.start, node.closeStart ?? node.end);
      // Un tableau de mise en page n'a pas d'en-tete par nature ; on ne
      // signale que ceux qui portent visiblement des donnees (plusieurs
      // cellules) sans jamais declarer de colonne.
      const cellules = (body.match(/<td[\s>]/gi) || []).length;
      if (!/<th[\s>]/i.test(body) && cellules >= 2) {
        push({
          ruleId: 'A11Y-TABLE-NO-HEADERS',
          severity: 'medium',
          title: 'Tableau sans en-tetes',
          message: 'Aucune cellule <th> : impossible pour un lecteur d\'ecran d\'associer une valeur a sa colonne.',
          line: at(node),
          suggestion: 'Ajoutez une ligne <thead> avec des <th scope="col">, et un <caption> decrivant le tableau.',
          effort: 'moyen',
          tags: ['wcag-1.3.1', 'a11y'],
        });
      }
    }

    // --- Autofocus.
    if (node.has('autofocus')) {
      push({
        ruleId: 'UX-AUTOFOCUS',
        severity: 'low',
        title: 'autofocus sur un champ',
        message: 'Le focus automatique deplace le contexte a l\'arrivee sur la page et peut faire sauter l\'affichage sur mobile.',
        line: at(node),
        suggestion: 'Ne l\'utilisez que sur une page dediee a une seule action (recherche, connexion).',
        effort: 'rapide',
        tags: ['ux'],
      });
    }
  }

  // --- Reperes de page.
  if (isFullDocument && !hasLandmarkMain) {
    push({
      ruleId: 'A11Y-NO-MAIN-LANDMARK',
      severity: 'medium',
      title: 'Aucun repere <main>',
      message: 'La page n\'a pas de region principale : les utilisateurs de lecteurs d\'ecran ne peuvent pas sauter directement au contenu.',
      line: 1,
      suggestion: 'Structurez la page avec <header>, <nav>, <main>, <footer>, et ajoutez un lien d\'evitement « Aller au contenu » en debut de document.',
      effort: 'moyen',
      tags: ['wcag-1.3.1', 'a11y', 'seo'],
    });
  }

  if (isFullDocument && !/skip.?(to|link)|aller au contenu|evitement/i.test(file.content)) {
    push({
      ruleId: 'A11Y-NO-SKIP-LINK',
      severity: 'low',
      title: 'Lien d\'evitement absent',
      message: 'Aucun lien permettant de sauter la navigation : chaque page impose de tabuler dans tout le menu.',
      line: 1,
      suggestion: 'Ajoutez en premier element du body : <a class="skip-link" href="#contenu">Aller au contenu</a>, visible au focus.',
      effort: 'rapide',
      tags: ['wcag-2.4.1', 'a11y'],
    });
  }
}

// -------------------------------------------------------------- Design system

function collectDesignTokens(styleFiles, context) {
  const colors = new Map();
  const colorsAsTokens = new Set();
  const fontSizes = new Set();
  const spacings = new Set();
  const breakpoints = new Set();
  const fontFamilies = new Set();
  let variableCount = 0;

  const sources = [
    ...styleFiles,
    ...context.sources({ families: ['js', 'markup'] }).filter((f) => /style|css|theme|tailwind/i.test(f.relativePath)),
  ];

  for (const file of sources) {
    const source = file.content;
    for (const match of matches(source, /(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g)) {
      const parsed = parseColor(match[1]);
      if (!parsed) continue;
      const key = toHex(parsed);
      colors.set(key, (colors.get(key) || 0) + 1);
    }
    for (const match of matches(source, /font-size\s*:\s*([\d.]+(?:px|rem|em|pt))/g)) {
      const px = toPixels(match[1]);
      if (px) fontSizes.add(Math.round(px));
    }
    for (const match of matches(source, /(?:margin|padding|gap)(?:-\w+)?\s*:\s*([\d.]+(?:px|rem))/g)) {
      const px = toPixels(match[1]);
      if (px) spacings.add(Math.round(px));
    }
    for (const match of matches(source, /@media[^{]*\(\s*(?:min|max)-width\s*:\s*([\d.]+)(px|rem|em)\s*\)/g)) {
      const px = toPixels(`${match[1]}${match[2]}`);
      if (px) breakpoints.add(Math.round(px));
    }
    for (const match of matches(source, /font-family\s*:\s*([^;}\n]+)/g)) {
      fontFamilies.add(match[1].trim().split(',')[0].replace(/["']/g, '').toLowerCase());
    }
    for (const _ of matches(source, /(--[\w-]+\s*:|\$[\w-]+\s*:|@[\w-]+\s*:)/g)) variableCount++;
    // Couleurs affectees a une variable : ce sont les jetons du systeme.
    for (const match of matches(source, /(?:--[\w-]+|\$[\w-]+|@[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/g)) {
      const parsed = parseColor(match[1]);
      if (parsed) colorsAsTokens.add(toHex(parsed));
    }
  }

  return { colors, colorsAsTokens, fontSizes, spacings, breakpoints, fontFamilies, variableCount };
}

function analyzeDesignSystem(tokens, styleFiles, context, report) {
  if (styleFiles.length === 0 && !context.has('tailwind', 'styled-components')) return;
  const anchorFile = styleFiles[0]?.relativePath ?? null;

  // Une couleur definie comme variable CSS appartient a un systeme : la
  // compter comme dispersion reviendrait a reprocher d'avoir suivi le conseil
  // que cette regle donne elle-meme.
  const distinctColors = tokens.colors.size - tokens.colorsAsTokens.size;
  if (distinctColors > 30) {
    const topColors = [...tokens.colors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    report({
      ruleId: 'DESIGN-COLOR-SPRAWL',
      severity: 'medium',
      title: 'Palette de couleurs incoherente',
      message: `${distinctColors} couleurs distinctes sont utilisees dans les styles. Au-dela d'une trentaine, il n'y a plus de palette : chaque ecran derive.`,
      file: anchorFile,
      line: 1,
      suggestion:
        `Definissez une palette de 8 a 12 tokens en variables CSS (primaire, secondaire, 4 nuances de gris, succes, alerte, erreur) et remplacez les valeurs en dur. Vos couleurs les plus utilisees, bonnes candidates : ${topColors.map(([c, n]) => `${c} (${n}x)`).join(', ')}.`,
      effort: 'important',
      data: { count: distinctColors, top: topColors },
    });
  }

  if (tokens.fontSizes.size > 12) {
    report({
      ruleId: 'DESIGN-TYPE-SCALE',
      severity: 'low',
      title: 'Echelle typographique non maitrisee',
      message: `${tokens.fontSizes.size} tailles de police differentes (${[...tokens.fontSizes].sort((a, b) => a - b).join(', ')} px). Une echelle lisible en compte 5 a 7.`,
      file: anchorFile,
      line: 1,
      suggestion: 'Adoptez une echelle modulaire (12, 14, 16, 20, 24, 32, 48) exprimee en rem, et n\'autorisez que ces valeurs.',
      effort: 'moyen',
    });
  }

  const irregularSpacings = [...tokens.spacings].filter((value) => value % 4 !== 0 && value > 2);
  if (tokens.spacings.size > 8 && irregularSpacings.length > tokens.spacings.size * 0.4) {
    report({
      ruleId: 'DESIGN-SPACING-SCALE',
      severity: 'low',
      title: 'Espacements sans grille',
      message: `${irregularSpacings.length} valeurs d'espacement sur ${tokens.spacings.size} ne sont pas des multiples de 4px (${irregularSpacings.slice(0, 10).join(', ')}). L'alignement vertical parait « presque juste », ce qui se voit.`,
      file: anchorFile,
      line: 1,
      suggestion: 'Basez tous les espacements sur une grille de 4 ou 8px : --space-1: 4px … --space-8: 64px.',
      effort: 'moyen',
    });
  }

  if (tokens.variableCount === 0 && styleFiles.length > 0 && distinctColors > 8) {
    report({
      ruleId: 'DESIGN-NO-TOKENS',
      severity: 'medium',
      title: 'Aucun token de design',
      message: 'Aucune variable CSS/Sass n\'a ete trouvee : chaque valeur de couleur, d\'espacement et de typographie est repetee en dur.',
      file: anchorFile,
      line: 1,
      suggestion:
        'Creez un fichier tokens.css avec :root { --color-primary; --color-text; --space-*; --radius-*; --font-* } puis referencez ces variables. C\'est le prealable a un theme sombre et a toute refonte.',
      effort: 'important',
    });
  }

  if (tokens.fontFamilies.size > 3) {
    report({
      ruleId: 'DESIGN-TOO-MANY-FONTS',
      severity: 'low',
      title: 'Trop de familles de polices',
      message: `${tokens.fontFamilies.size} familles differentes : ${[...tokens.fontFamilies].slice(0, 6).join(', ')}. Chaque police supplementaire coute en coherence et en temps de chargement.`,
      file: anchorFile,
      line: 1,
      suggestion: 'Limitez-vous a deux familles (titres + texte), trois au maximum en comptant le monospace.',
      effort: 'moyen',
      tags: ['performance'],
    });
  }

  const hasDarkMode = styleFiles.some((f) => /prefers-color-scheme|\.dark\b|\[data-theme/.test(f.content)) ||
    context.sources({ families: ['js'] }).some((f) => /prefers-color-scheme|dark:|theme.*dark/i.test(f.content));
  if (!hasDarkMode && styleFiles.length > 0) {
    report({
      ruleId: 'DESIGN-NO-DARK-MODE',
      severity: 'info',
      title: 'Pas de theme sombre',
      message: 'Aucune prise en charge de prefers-color-scheme. Une part importante des utilisateurs navigue en mode sombre par defaut.',
      file: anchorFile,
      line: 1,
      suggestion: 'Definissez vos couleurs en variables, puis surchargez-les dans @media (prefers-color-scheme: dark).',
      effort: 'moyen',
    });
  }

  const hasReducedMotion = styleFiles.some((f) => /prefers-reduced-motion/.test(f.content));
  const hasAnimations = styleFiles.some((f) => /@keyframes|animation\s*:|transition\s*:/.test(f.content));
  if (hasAnimations && !hasReducedMotion) {
    report({
      ruleId: 'A11Y-NO-REDUCED-MOTION',
      severity: 'low',
      title: 'Animations sans respect de prefers-reduced-motion',
      message: 'Des animations sont definies sans alternative pour les personnes sensibles au mouvement (vertiges, troubles vestibulaires).',
      file: anchorFile,
      line: 1,
      suggestion:
        '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }',
      effort: 'rapide',
      tags: ['wcag-2.3.3', 'a11y'],
    });
  }
}

function analyzeResponsive(tokens, styleFiles, context, report) {
  if (styleFiles.length === 0) return;
  const anchorFile = styleFiles[0].relativePath;
  const totalCss = styleFiles.reduce((sum, f) => sum + f.content.length, 0);

  if (tokens.breakpoints.size === 0 && totalCss > 3000 && !context.has('tailwind')) {
    report({
      ruleId: 'DESIGN-NO-BREAKPOINTS',
      severity: 'high',
      title: 'Aucun point de rupture responsive',
      message: 'Aucune media query dans les feuilles de style : la mise en page ne s\'adapte pas aux petits ecrans. Plus de la moitie du trafic web est mobile, et Google indexe en mobile-first.',
      file: anchorFile,
      line: 1,
      suggestion:
        'Adoptez une approche mobile-first : ecrivez les styles pour petit ecran, puis ajoutez @media (min-width: 640px), 768px, 1024px, 1280px. Verifiez chaque page a 360px de large.',
      effort: 'important',
      tags: ['mobile', 'seo'],
    });
  } else if (tokens.breakpoints.size > 8) {
    report({
      ruleId: 'DESIGN-TOO-MANY-BREAKPOINTS',
      severity: 'info',
      title: 'Trop de points de rupture',
      message: `${tokens.breakpoints.size} points de rupture distincts (${[...tokens.breakpoints].sort((a, b) => a - b).join(', ')} px) : chaque modification devient un test de regression sur toutes les tailles.`,
      file: anchorFile,
      line: 1,
      suggestion: 'Standardisez 3 ou 4 points de rupture en variables, et privilegiez les unites fluides (clamp(), minmax(), %) plutot que des paliers.',
      effort: 'moyen',
    });
  }

  const fixedWidths = [];
  for (const file of styleFiles) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d{4,})px/g)) {
      fixedWidths.push({ file: file.relativePath, line: index.lineOf(match.index), value: match[1] });
    }
  }
  if (fixedWidths.length > 0) {
    report({
      ruleId: 'DESIGN-FIXED-WIDTH',
      severity: 'medium',
      title: 'Largeur fixe superieure a la taille des ecrans mobiles',
      message: `${fixedWidths.length} declaration(s) de largeur fixe d'au moins 1000px : elles provoquent un debordement horizontal sur mobile.`,
      file: fixedWidths[0].file,
      line: fixedWidths[0].line,
      snippet: `width: ${fixedWidths[0].value}px`,
      suggestion: 'Remplacez par max-width avec width: 100%, ou utilisez min(1200px, 100% - 2rem).',
      effort: 'rapide',
      tags: ['mobile'],
    });
  }
}
