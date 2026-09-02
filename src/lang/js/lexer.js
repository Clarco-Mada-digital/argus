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
 * Decoupe une source en jetons. Les commentaires sont ignores.
 *
 * Les gabarits sont produits comme un seul jeton, `${}` compris : leur contenu
 * interpole est re-lexe a la demande par l'analyse de portees, qui est la
 * seule a en avoir besoin.
 */
export function lexer(source) {
  const jetons = [];
  let i = 0;
  const n = source.length;

  const dernierSignificatif = () => jetons[jetons.length - 1];

  while (i < n) {
    const c = source[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }

    // Commentaires.
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    const debut = i;

    // Chaines.
    if (c === '"' || c === "'") {
      i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') i++;
        if (source[i] === '\n') break; // chaine non terminee : on ne s'entete pas
        i++;
      }
      i++;
      jetons.push({ type: TYPES.chaine, valeur: source.slice(debut, i), debut, fin: i });
      continue;
    }

    // Gabarits, avec imbrication des `${ }`.
    if (c === '`') {
      i++;
      let profondeur = 0;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '`' && profondeur === 0) { i++; break; }
        if (source[i] === '$' && source[i + 1] === '{') { profondeur++; i += 2; continue; }
        if (source[i] === '}' && profondeur > 0) { profondeur--; i++; continue; }
        i++;
      }
      jetons.push({ type: TYPES.gabarit, valeur: source.slice(debut, i), debut, fin: i });
      continue;
    }

    // Expressions regulieres.
    if (c === '/' && demarreUneRegex(dernierSignificatif())) {
      i++;
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
      jetons.push({ type: TYPES.regex, valeur: source.slice(debut, i), debut, fin: i });
      continue;
    }

    // Nombres.
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] || ''))) {
      while (i < n && /[0-9a-fA-FxXoObBeE._n]/.test(source[i])) {
        // Un `.` suivi d'une lettre est un acces de propriete, pas un decimal.
        if (source[i] === '.' && !/[0-9]/.test(source[i + 1] || '')) break;
        i++;
      }
      jetons.push({ type: TYPES.nombre, valeur: source.slice(debut, i), debut, fin: i });
      continue;
    }

    // Identifiants et mots-cles.
    if (DEBUT_IDENTIFIANT.test(c)) {
      while (i < n && SUITE_IDENTIFIANT.test(source[i])) i++;
      const valeur = source.slice(debut, i);
      jetons.push({
        type: MOTS_CLES.has(valeur) ? TYPES.motCle : TYPES.identifiant,
        valeur,
        debut,
        fin: i,
      });
      continue;
    }

    // Ponctuation, du plus long au plus court.
    const trouve = PONCTUATIONS.find((p) => source.startsWith(p, i));
    if (trouve) {
      i += trouve.length;
      jetons.push({ type: TYPES.ponctuation, valeur: trouve, debut, fin: i });
      continue;
    }

    // Caractere inconnu (JSX exotique, unicode) : on avance sans bloquer.
    i++;
  }

  return jetons;
}
