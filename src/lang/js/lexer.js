/**
 * Lexeur JavaScript et TypeScript.
 *
 * Le masquage lexical (`maskCommentsAndStrings`) suffit a savoir *ou* on se
 * trouve ; il ne dit rien de ce qu'on lit. Pour repondre a « d'ou vient la
 * valeur de cette variable ? », il faut des jetons : distinguer un identifiant
 * d'un mot-cle, une affectation d'une comparaison, une accolade de bloc d'une
 * accolade d'objet.
 *
 * Ce lexeur n'est pas un analyseur syntaxique complet et n'essaie pas de
 * l'etre : il ne construit aucun arbre et ignore la precedence des operateurs.
 * Il produit une suite de jetons positionnes, ce qui est exactement le
 * materiau dont l'analyse de portees a besoin — et rien de plus, car chaque
 * ligne de grammaire en trop est une ligne qui peut se tromper.
 */

export const TYPES = {
  identifiant: 'identifiant',
  motCle: 'mot-cle',
  chaine: 'chaine',
  gabarit: 'gabarit',
  nombre: 'nombre',
  regex: 'regex',
  ponctuation: 'ponctuation',
};

const MOTS_CLES = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'let', 'static', 'async', 'await', 'of', 'get', 'set',
  // TypeScript : ce sont des mots-cles contextuels, mais les traiter comme tels
  // evite de les confondre avec des identifiants dans les declarations.
  'interface', 'type', 'implements', 'declare', 'namespace', 'abstract',
  'public', 'private', 'protected', 'readonly', 'as', 'satisfies', 'keyof', 'infer',
]);

const DEBUT_IDENTIFIANT = /[A-Za-z_$]/;
const SUITE_IDENTIFIANT = /[A-Za-z0-9_$]/;

/**
 * Une barre oblique demarre-t-elle une expression reguliere ?
 *
 * C'est l'ambiguite classique du JavaScript : `/` est une division ou le debut
 * d'un litteral. La reponse depend du dernier jeton significatif — apres une
 * valeur, c'est une division ; apres un operateur ou une ouverture, c'est une
 * expression reguliere.
 */
function demarreUneRegex(dernier) {
  if (!dernier) return true;
  if (dernier.type === TYPES.nombre || dernier.type === TYPES.chaine) return false;
  if (dernier.type === TYPES.gabarit || dernier.type === TYPES.regex) return false;
  if (dernier.type === TYPES.identifiant) return false;
  if (dernier.type === TYPES.motCle) {
    // `return /x/` est une regex ; `this / x` est une division.
    return !['this', 'super', 'true', 'false', 'null'].includes(dernier.valeur);
  }
  return ![')', ']', '}', '++', '--'].includes(dernier.valeur);
}

const PONCTUATIONS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
  '{', '}', '(', ')', '[', ']', ';', ',', '<', '>', '+', '-', '*', '/', '%',
  '&', '|', '^', '!', '~', '?', ':', '=', '.', '@', '#',
].sort((a, b) => b.length - a.length);

/**
 * Lecteurs par type de jeton.
 *
 * Chacun recoit la source et la position d'ouverture, et rend la position de
 * fin. Les separer garde `lexer` lisible : la boucle principale ne fait plus
 * qu'aiguiller, et chaque forme se relit — et se corrige — isolement.
 */

/** Chaine simple ou double, echappements compris. */
function lireChaine(source, debut, guillemet) {
  const n = source.length;
  let i = debut + 1;
  while (i < n && source[i] !== guillemet) {
    if (source[i] === '\\') i++;
    if (source[i] === '\n') break; // chaine non terminee : on ne s'entete pas
    i++;
  }
  return i + 1;
}

/** Gabarit, avec imbrication des `${ }`. */
function lireGabarit(source, debut) {
  const n = source.length;
  let i = debut + 1;
  let profondeur = 0;

  while (i < n) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '`' && profondeur === 0) return i + 1;
    if (source[i] === '$' && source[i + 1] === '{') { profondeur++; i += 2; continue; }
    if (source[i] === '}' && profondeur > 0) { profondeur--; i++; continue; }
    i++;
  }
  return i;
}

/** Litteral d'expression reguliere, classes de caracteres comprises. */
function lireRegex(source, debut) {
  const n = source.length;
  let i = debut + 1;
  let dansClasse = false;

  while (i < n) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === '[') dansClasse = true;
    else if (source[i] === ']') dansClasse = false;
    else if (source[i] === '/' && !dansClasse) { i++; break; }
    else if (source[i] === '\n') break;
    i++;
  }

  while (i < n && /[dgimsuyv]/.test(source[i])) i++;
  return i;
}

/** Nombre, y compris hexadecimal, binaire, exponentiel et BigInt. */
function lireNombre(source, debut) {
  const n = source.length;
  let i = debut;
  while (i < n && /[0-9a-fA-FxXoObBeE._n]/.test(source[i])) {
    // Un `.` suivi d'une lettre est un acces de propriete, pas un decimal.
    if (source[i] === '.' && !/[0-9]/.test(source[i + 1] || '')) break;
    i++;
  }
  return i;
}

function lireIdentifiant(source, debut) {
  const n = source.length;
  let i = debut;
  while (i < n && SUITE_IDENTIFIANT.test(source[i])) i++;
  return i;
}

/** Commentaire de ligne ou de bloc : rend la fin, ou -1 si ce n'en est pas un. */
function finDeCommentaire(source, i) {
  if (source[i] !== '/') return -1;
  const n = source.length;

  if (source[i + 1] === '/') {
    let k = i;
    while (k < n && source[k] !== '\n') k++;
    return k;
  }

  if (source[i + 1] === '*') {
    let k = i + 2;
    while (k < n && !(source[k] === '*' && source[k + 1] === '/')) k++;
    return k + 2;
  }

  return -1;
}

const ESPACES = new Set([' ', '\t', '\n', '\r', '\f', '\v']);

/**
 * Decoupe une source en jetons. Les commentaires sont ignores.
 *
 * Les gabarits sont produits comme un seul jeton, `${}` compris : leur contenu
 * interpole est re-lexe a la demande par l'analyse de portees, qui est la
 * seule a en avoir besoin.
 */
export function lexer(source) {
  const jetons = [];
  const n = source.length;
  let i = 0;

  const ajouter = (type, debut, fin) => {
    jetons.push({ type, valeur: source.slice(debut, fin), debut, fin });
    return fin;
  };

  while (i < n) {
    const c = source[i];

    if (ESPACES.has(c)) { i++; continue; }

    const finCommentaire = finDeCommentaire(source, i);
    if (finCommentaire !== -1) { i = finCommentaire; continue; }

    if (c === '"' || c === "'") { i = ajouter(TYPES.chaine, i, lireChaine(source, i, c)); continue; }
    if (c === '`') { i = ajouter(TYPES.gabarit, i, lireGabarit(source, i)); continue; }

    if (c === '/' && demarreUneRegex(jetons[jetons.length - 1])) {
      i = ajouter(TYPES.regex, i, lireRegex(source, i));
      continue;
    }

    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      i = ajouter(TYPES.nombre, i, lireNombre(source, i));
      continue;
    }

    if (DEBUT_IDENTIFIANT.test(c)) {
      const fin = lireIdentifiant(source, i);
      const valeur = source.slice(i, fin);
      i = ajouter(MOTS_CLES.has(valeur) ? TYPES.motCle : TYPES.identifiant, i, fin);
      continue;
    }

    const ponctuation = PONCTUATIONS.find((forme) => source.startsWith(forme, i));
    if (ponctuation) {
      i = ajouter(TYPES.ponctuation, i, i + ponctuation.length);
      continue;
    }

    // Caractere inconnu (JSX exotique, unicode) : on avance sans bloquer.
    i++;
  }

  return jetons;
}
