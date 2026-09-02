import { lexer, TYPES } from './lexer.js';

/**
 * Portees, liaisons et origine des valeurs, en JavaScript et TypeScript.
 *
 * L'objectif est etroit et assume : repondre a « d'ou vient la valeur de cet
 * identifiant, a cet endroit precis ? ». Pas construire un arbre syntaxique
 * complet, pas evaluer des expressions — repondre a cette question-la, et
 * bien.
 *
 * C'est ce qui manquait pour graduer les regles d'injection. Le motif
 * « concatenation dans une requete SQL » signale a la fois une valeur venue
 * de `req.query` et une constante litterale du module. Le premier cas est une
 * faille, le second un faux positif qui use la confiance qu'on accorde a
 * l'outil.
 *
 * Limites connues, et voulues :
 *   - pas de suivi inter-fichiers ni inter-fonctions ;
 *   - un parametre est d'origine inconnue, car son appelant l'est ;
 *   - `var` est traite comme portant sur la fonction, `let`/`const` sur le bloc.
 */

/** Racines dont toute lecture provient de l'exterieur du programme. */
const SOURCES_EXTERNES = new Set([
  'req', 'request', 'requete', 'ctx', 'context', 'event', 'evenement',
  'searchParams', 'formData', 'payload', 'input', 'userInput',
]);

/** Proprietes qui trahissent une entree externe, quelle que soit la racine. */
const PROPRIETES_EXTERNES = new Set([
  'query', 'body', 'params', 'headers', 'cookies', 'search', 'hash',
  'href', 'referrer', 'argv', 'stdin', 'formData', 'searchParams',
]);

/** Chaines completes reconnues comme externes. */
const CHEMINS_EXTERNES = [
  ['process', 'argv'],
  ['process', 'env'],
  ['location', 'search'],
  ['location', 'hash'],
  ['location', 'href'],
  ['window', 'location'],
  ['document', 'location'],
  ['document', 'referrer'],
  ['document', 'URL'],
];

export const ORIGINES = {
  litteral: 'litteral',
  externe: 'externe',
  parametre: 'parametre',
  inconnu: 'inconnu',
};

class Portee {
  constructor(parent, estFonction, debut) {
    this.parent = parent;
    this.estFonction = estFonction;
    this.debut = debut;
    this.fin = Infinity;
    this.liaisons = new Map();
    this.enfants = [];
    if (parent) parent.enfants.push(this);
  }

  /** La portee de fonction englobante, ou `var` atterrit. */
  porteeDeFonction() {
    let courante = this;
    while (courante && !courante.estFonction && courante.parent) courante = courante.parent;
    return courante;
  }

  declarer(liaison) {
    // Une redeclaration (`var` repete, surcharge TypeScript) ne remplace pas :
    // on fusionne les valeurs, sinon la premiere affectation serait perdue.
    const existante = this.liaisons.get(liaison.nom);
    if (existante) {
      existante.valeurs.push(...liaison.valeurs);
      existante.reaffecte = existante.reaffecte || liaison.reaffecte;
      return existante;
    }
    this.liaisons.set(liaison.nom, liaison);
    return liaison;
  }
}

/** Le groupe delimite qui commence au jeton `depart` (une ouverture). */
function finDuGroupe(jetons, depart) {
  const ouvertures = { '(': ')', '[': ']', '{': '}' };
  const fermeture = ouvertures[jetons[depart]?.valeur];
  if (!fermeture) return depart;
  let profondeur = 0;
  for (let i = depart; i < jetons.length; i++) {
    const v = jetons[i].valeur;
    if (jetons[i].type !== TYPES.ponctuation) continue;
    if (v === jetons[depart].valeur) profondeur++;
    else if (v === fermeture) {
      profondeur--;
      if (profondeur === 0) return i;
    }
  }
  return jetons.length - 1;
}

/** Les identifiants lies par un motif de declaration (simple ou decompose). */
function nomsDuMotif(jetons, debut, fin) {
  const noms = [];
  let attendUneCle = true;

  for (let i = debut; i <= fin && i < jetons.length; i++) {
    const jeton = jetons[i];
    if (jeton.type === TYPES.ponctuation) {
      // Dans `{ a: b }`, c'est `b` qui est lie, pas `a`.
      if (jeton.valeur === ':') attendUneCle = false;
      else if (jeton.valeur === ',') attendUneCle = true;
      else if (jeton.valeur === '=') {
        // Valeur par defaut : on saute jusqu'a la virgule de meme niveau.
        let profondeur = 0;
        while (i + 1 <= fin) {
          const suivant = jetons[i + 1];
          if (suivant.type === TYPES.ponctuation) {
            if ('([{'.includes(suivant.valeur)) profondeur++;
            else if (')]}'.includes(suivant.valeur)) profondeur--;
            else if (suivant.valeur === ',' && profondeur <= 0) break;
          }
          if (profondeur < 0) break;
          i++;
        }
      }
      continue;
    }
    if (jeton.type !== TYPES.identifiant) continue;
    if (!attendUneCle) {
      noms.push(jeton);
      attendUneCle = true;
      continue;
    }
    // `{ a }` : la cle est aussi la liaison, sauf si un `:` suit.
    const suivant = jetons[i + 1];
    if (suivant?.valeur === ':') continue;
    noms.push(jeton);
  }

  return noms;
}

/** Fin d'une expression d'initialisation, a partir du `=`. */
function finDExpression(jetons, debut) {
  let profondeur = 0;
  for (let i = debut; i < jetons.length; i++) {
    const jeton = jetons[i];
    if (jeton.type !== TYPES.ponctuation) continue;
    if ('([{'.includes(jeton.valeur)) profondeur++;
    else if (')]}'.includes(jeton.valeur)) {
      if (profondeur === 0) return i - 1;
      profondeur--;
    } else if ((jeton.valeur === ';' || jeton.valeur === ',') && profondeur === 0) {
      return i - 1;
    }
  }
  return jetons.length - 1;
}

/**
 * Classe une expression : litterale, venue de l'exterieur, ou indeterminee.
 */
function classerExpression(jetons, debut, fin) {
  const tranche = jetons.slice(debut, fin + 1).filter((j) => j.type !== TYPES.ponctuation || j.valeur !== ';');
  if (tranche.length === 0) return ORIGINES.inconnu;

  // Un gabarit sans interpolation vaut une chaine.
  const litterale = tranche.every(
    (j) =>
      j.type === TYPES.chaine ||
      j.type === TYPES.nombre ||
      (j.type === TYPES.gabarit && !j.valeur.includes('${')) ||
      (j.type === TYPES.motCle && ['true', 'false', 'null'].includes(j.valeur)) ||
      (j.type === TYPES.ponctuation && ['+', '-'].includes(j.valeur)),
  );
  if (litterale) return ORIGINES.litteral;

  for (let i = debut; i <= fin && i < jetons.length; i++) {
    const jeton = jetons[i];
    if (jeton.type !== TYPES.identifiant) continue;

    if (SOURCES_EXTERNES.has(jeton.valeur)) return ORIGINES.externe;

    // `x.query`, `x.body`… : la propriete suffit a trahir l'origine.
    const precedent = jetons[i - 1];
    if (precedent?.valeur === '.' && PROPRIETES_EXTERNES.has(jeton.valeur)) return ORIGINES.externe;

    for (const chemin of CHEMINS_EXTERNES) {
      if (jeton.valeur !== chemin[0]) continue;
      let ok = true;
      for (let k = 1; k < chemin.length; k++) {
        if (jetons[i + 2 * k - 1]?.valeur !== '.' || jetons[i + 2 * k]?.valeur !== chemin[k]) {
          ok = false;
          break;
        }
      }
      if (ok) return ORIGINES.externe;
    }
  }

  return ORIGINES.inconnu;
}

const DECLARATEURS = new Set(['const', 'let', 'var']);

/**
 * Etat du balayage : la pile de portees et la portee en attente d'un `{`.
 *
 * Rassembler ces trois variables permet aux gestionnaires ci-dessous d'etre
 * des fonctions ordinaires plutot que des branches d'une seule boucle geante.
 * L'analyse tenait dans une fonction de complexite 70 ; elle se relit
 * maintenant construction par construction.
 */
class Balayage {
  constructor() {
    this.racine = new Portee(null, true, 0);
    this.courante = this.racine;
    this.pile = [this.racine];
    /** Portee a ouvrir au prochain `{` : renseignee par une liste de parametres. */
    this.enAttente = null;
  }

  ouvrir(jeton) {
    if (this.enAttente) {
      this.courante = this.enAttente;
      this.courante.debut = jeton.debut;
      this.enAttente = null;
    } else {
      this.courante = new Portee(this.courante, false, jeton.debut);
    }
    this.pile.push(this.courante);
  }

  fermer(jeton) {
    if (this.pile.length <= 1) return;
    this.courante.fin = jeton.fin;
    this.pile.pop();
    this.courante = this.pile[this.pile.length - 1];
  }

  declarer(nom, genre, offset, valeurs = []) {
    const portee = genre === 'var' ? this.courante.porteeDeFonction() : this.courante;
    return portee.declarer({ nom, genre, offset, valeurs, reaffecte: false });
  }
}

/** `function nom(params) {` — declare le nom, puis ouvre la portee des parametres. */
function traiterFonction(jetons, i, etat) {
  const nom = jetons[i + 1];
  if (nom?.type === TYPES.identifiant) {
    etat.courante.porteeDeFonction().declarer({
      nom: nom.valeur, genre: 'function', offset: nom.debut, valeurs: [], reaffecte: false,
    });
  }

  let ouverture = -1;
  for (let k = i + 1; k < jetons.length; k++) {
    if (jetons[k].valeur === '(') { ouverture = k; break; }
    if (jetons[k].valeur === '{') break; // pas de liste de parametres trouvable
  }
  if (ouverture === -1) return i;

  const fermeture = finDuGroupe(jetons, ouverture);
  const portee = new Portee(etat.courante, true, jetons[ouverture].debut);
  for (const param of nomsDuMotif(jetons, ouverture + 1, fermeture - 1)) {
    portee.declarer({
      nom: param.valeur, genre: 'param', offset: param.debut, valeurs: [], reaffecte: false,
    });
  }
  etat.enAttente = portee;
  return fermeture;
}

/**
 * `=>` — les parametres *precedent* la fleche, il faut donc revenir en arriere.
 */
function traiterFleche(jetons, i, etat) {
  const portee = new Portee(etat.courante, true, jetons[i].debut);
  const precedent = jetons[i - 1];

  if (precedent?.valeur === ')') {
    let profondeur = 0;
    let ouverture = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (jetons[k].type !== TYPES.ponctuation) continue;
      if (jetons[k].valeur === ')') profondeur++;
      else if (jetons[k].valeur === '(') {
        profondeur--;
        if (profondeur === 0) { ouverture = k; break; }
      }
    }
    if (ouverture !== -1) {
      for (const param of nomsDuMotif(jetons, ouverture + 1, i - 2)) {
        portee.declarer({
          nom: param.valeur, genre: 'param', offset: param.debut, valeurs: [], reaffecte: false,
        });
      }
    }
  } else if (precedent?.type === TYPES.identifiant) {
    portee.declarer({
      nom: precedent.valeur, genre: 'param', offset: precedent.debut, valeurs: [], reaffecte: false,
    });
  }

  // Corps entre accolades : la portee s'ouvre au `{`. Corps d'expression :
  // elle vaut jusqu'a la fin de l'expression.
  if (jetons[i + 1]?.valeur === '{') {
    etat.enAttente = portee;
  } else {
    portee.fin = jetons[finDExpression(jetons, i + 1)]?.fin ?? Infinity;
  }
  return i;
}

/** `const`, `let`, `var` — un ou plusieurs declarateurs, motifs compris. */
function traiterDeclaration(jetons, i, etat) {
  const genre = jetons[i].valeur;
  let k = i + 1;
  // On reprend le balayage juste apres le *premier* nom declare, sans sauter
  // l'initialisateur : sinon une fonction flechee affectee a une constante
  // n'ouvrait jamais sa portee, et ses parametres restaient introuvables — la
  // forme la plus courante du JavaScript moderne.
  let repriseApres = null;

  while (k < jetons.length) {
    const suivant = jetons[k];
    if (!suivant) break;

    let finMotif = k;
    if (suivant.valeur === '{' || suivant.valeur === '[') finMotif = finDuGroupe(jetons, k);
    const noms = nomsDuMotif(jetons, k, finMotif);

    let origine = ORIGINES.inconnu;
    let finValeur = finMotif;
    if (jetons[finMotif + 1]?.valeur === '=') {
      finValeur = finDExpression(jetons, finMotif + 2);
      origine = classerExpression(jetons, finMotif + 2, finValeur);
    }

    if (repriseApres === null) repriseApres = finMotif;
    for (const nom of noms) {
      etat.declarer(nom.valeur, genre, nom.debut, [{ origine, offset: nom.debut }]);
    }

    k = finValeur + 1;
    if (jetons[k]?.valeur === ',') { k++; continue; }
    break;
  }

  return repriseApres === null ? k - 1 : repriseApres;
}

/** `import x, { a, b } from '…'` — les noms lies, sans la source. */
function traiterImport(jetons, i, etat) {
  let k = i + 1;

  while (k < jetons.length && jetons[k].valeur !== ';') {
    if (jetons[k].type === TYPES.motCle && jetons[k].valeur === 'from') break;

    if (jetons[k].valeur === '{') {
      const fermeture = finDuGroupe(jetons, k);
      for (const nom of nomsDuMotif(jetons, k + 1, fermeture - 1)) {
        etat.declarer(nom.valeur, 'import', nom.debut, [{ origine: ORIGINES.inconnu, offset: nom.debut }]);
      }
      k = fermeture;
    } else if (jetons[k].type === TYPES.identifiant) {
      etat.declarer(jetons[k].valeur, 'import', jetons[k].debut, [
        { origine: ORIGINES.inconnu, offset: jetons[k].debut },
      ]);
    }
    k++;
  }

  return k;
}

const AFFECTATIONS = new Set(['=', '+=', '||=', '??=']);
const AVANT_DECLARATION = new Set(['const', 'let', 'var', '.']);

/** `x = …` — enregistre la valeur sur la liaison existante. */
function traiterAffectation(jetons, i, etat) {
  const fin = finDExpression(jetons, i + 2);
  const origine = classerExpression(jetons, i + 2, fin);
  const liaison = resoudreDans(etat.courante, jetons[i].valeur);
  if (liaison) {
    liaison.valeurs.push({ origine, offset: jetons[i].debut });
    liaison.reaffecte = true;
  }
  return fin;
}

function estUneAffectation(jetons, i) {
  const jeton = jetons[i];
  if (jeton.type !== TYPES.identifiant) return false;
  if (jetons[i + 1]?.type !== TYPES.ponctuation) return false;
  if (!AFFECTATIONS.has(jetons[i + 1].valeur)) return false;
  return !AVANT_DECLARATION.has(jetons[i - 1]?.valeur);
}

/**
 * Analyse une source et retourne l'arbre des portees, plus un resolveur.
 *
 * La boucle ne fait qu'aiguiller : chaque construction est traitee par une
 * fonction dediee, ce qui la rend verifiable isolement.
 */
export function analyserPortees(source) {
  const jetons = lexer(source);
  const etat = new Balayage();

  for (let i = 0; i < jetons.length; i++) {
    const jeton = jetons[i];

    if (jeton.type === TYPES.ponctuation) {
      if (jeton.valeur === '{') { etat.ouvrir(jeton); continue; }
      if (jeton.valeur === '}') { etat.fermer(jeton); continue; }
      if (jeton.valeur === '=>') { i = traiterFleche(jetons, i, etat); continue; }
    }

    if (jeton.type === TYPES.motCle) {
      if (jeton.valeur === 'function') { i = traiterFonction(jetons, i, etat); continue; }
      if (DECLARATEURS.has(jeton.valeur)) { i = traiterDeclaration(jetons, i, etat); continue; }
      if (jeton.valeur === 'import') { i = traiterImport(jetons, i, etat); continue; }
    }

    if (estUneAffectation(jetons, i)) { i = traiterAffectation(jetons, i, etat); continue; }
  }

  const racine = etat.racine;
  return {
    racine,
    jetons,
    /** La liaison visible pour ce nom, depuis la portee la plus proche. */
    resoudre: (nom, offset) => resoudreParOffset(racine, nom, offset),
    origine: (nom, offset) => {
      const liaison = resoudreParOffset(racine, nom, offset);
      return liaison ? origineDe(liaison) : ORIGINES.inconnu;
    },
  };
}

function resoudreDans(portee, nom) {
  let courante = portee;
  while (courante) {
    const liaison = courante.liaisons.get(nom);
    if (liaison) return liaison;
    courante = courante.parent;
  }
  return null;
}

/** Portee la plus profonde contenant l'offset, puis remontee lexicale. */
function resoudreParOffset(racine, nom, offset) {
  const chemin = [];
  const descendre = (portee) => {
    chemin.push(portee);
    for (const enfant of portee.enfants) {
      if (offset >= enfant.debut && offset <= enfant.fin) {
        descendre(enfant);
        return;
      }
    }
  };
  descendre(racine);

  for (let i = chemin.length - 1; i >= 0; i--) {
    const liaison = chemin[i].liaisons.get(nom);
    if (liaison) return liaison;
  }
  return null;
}

/**
 * L'origine d'une liaison : la plus defavorable de ses valeurs.
 *
 * Une variable initialisee a une constante puis reaffectee depuis la requete
 * est externe — c'est precisement le cas que le motif lexical ne voyait pas.
 */
export function origineDe(liaison) {
  if (liaison.genre === 'param') return ORIGINES.parametre;
  if (liaison.valeurs.some((v) => v.origine === ORIGINES.externe)) return ORIGINES.externe;
  if (liaison.valeurs.length > 0 && liaison.valeurs.every((v) => v.origine === ORIGINES.litteral)) {
    return ORIGINES.litteral;
  }
  return ORIGINES.inconnu;
}
