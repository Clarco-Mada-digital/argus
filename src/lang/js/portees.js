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
 * Analyse une source et retourne l'arbre des portees, plus un resolveur.
 */
export function analyserPortees(source) {
  const jetons = lexer(source);
  const racine = new Portee(null, true, 0);
  let courante = racine;
  const pile = [racine];

  /** Portee a ouvrir au prochain `{` : renseignee par une liste de parametres. */
  let porteeEnAttente = null;

  const declarerDansFonction = (liaison) => courante.porteeDeFonction().declarer(liaison);

  for (let i = 0; i < jetons.length; i++) {
    const jeton = jetons[i];

    // ------------------------------------------------------------- blocs
    if (jeton.type === TYPES.ponctuation && jeton.valeur === '{') {
      if (porteeEnAttente) {
        courante = porteeEnAttente;
        courante.debut = jeton.debut;
        porteeEnAttente = null;
      } else {
        courante = new Portee(courante, false, jeton.debut);
      }
      pile.push(courante);
      continue;
    }
    if (jeton.type === TYPES.ponctuation && jeton.valeur === '}') {
      if (pile.length > 1) {
        courante.fin = jeton.fin;
        pile.pop();
        courante = pile[pile.length - 1];
      }
      continue;
    }

    // -------------------------------------------------------- fonctions
    if (jeton.type === TYPES.motCle && jeton.valeur === 'function') {
      const nom = jetons[i + 1];
      if (nom?.type === TYPES.identifiant) {
        declarerDansFonction({
          nom: nom.valeur, genre: 'function', offset: nom.debut, valeurs: [], reaffecte: false,
        });
      }
      const ouverture = jetons.findIndex((j, k) => k > i && j.valeur === '(');
      if (ouverture !== -1) {
        const fermeture = finDuGroupe(jetons, ouverture);
        const portee = new Portee(courante, true, jetons[ouverture].debut);
        for (const param of nomsDuMotif(jetons, ouverture + 1, fermeture - 1)) {
          portee.declarer({
            nom: param.valeur, genre: 'param', offset: param.debut, valeurs: [], reaffecte: false,
          });
        }
        porteeEnAttente = portee;
        i = fermeture;
      }
      continue;
    }

    // Fleche : les parametres precedent le `=>`, il faut donc revenir en arriere.
    if (jeton.type === TYPES.ponctuation && jeton.valeur === '=>') {
      const portee = new Portee(courante, true, jeton.debut);
      const precedent = jetons[i - 1];

      if (precedent?.valeur === ')') {
        // On retrouve l'ouverture correspondante.
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
        porteeEnAttente = portee;
      } else {
        portee.fin = jetons[finDExpression(jetons, i + 1)]?.fin ?? Infinity;
      }
      continue;
    }

    // ------------------------------------------------------ declarations
    if (jeton.type === TYPES.motCle && DECLARATEURS.has(jeton.valeur)) {
      const genre = jeton.valeur;
      let k = i + 1;
      // On reprend le balayage juste apres le *premier* nom declare, sans
      // sauter l'initialisateur : sinon une fonction flechee affectee a une
      // constante n'ouvrait jamais sa portee, et ses parametres restaient
      // introuvables — le cas le plus courant du JavaScript moderne.
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

        const cible = genre === 'var' ? courante.porteeDeFonction() : courante;
        for (const nom of noms) {
          cible.declarer({
            nom: nom.valeur,
            genre,
            offset: nom.debut,
            valeurs: [{ origine, offset: nom.debut }],
            reaffecte: false,
          });
        }

        k = finValeur + 1;
        if (jetons[k]?.valeur === ',') { k++; continue; }
        break;
      }

      i = repriseApres === null ? k - 1 : repriseApres;
      continue;
    }

    // --------------------------------------------------------- importations
    if (jeton.type === TYPES.motCle && jeton.valeur === 'import') {
      let k = i + 1;
      while (k < jetons.length && jetons[k].valeur !== ';' && !(jetons[k].type === TYPES.motCle && jetons[k].valeur === 'from')) {
        if (jetons[k].valeur === '{') {
          const fermeture = finDuGroupe(jetons, k);
          for (const nom of nomsDuMotif(jetons, k + 1, fermeture - 1)) {
            courante.declarer({
              nom: nom.valeur, genre: 'import', offset: nom.debut, valeurs: [{ origine: ORIGINES.inconnu, offset: nom.debut }], reaffecte: false,
            });
          }
          k = fermeture;
        } else if (jetons[k].type === TYPES.identifiant) {
          courante.declarer({
            nom: jetons[k].valeur, genre: 'import', offset: jetons[k].debut, valeurs: [{ origine: ORIGINES.inconnu, offset: jetons[k].debut }], reaffecte: false,
          });
        }
        k++;
      }
      i = k;
      continue;
    }

    // -------------------------------------------------------- affectations
    if (
      jeton.type === TYPES.identifiant &&
      jetons[i + 1]?.type === TYPES.ponctuation &&
      ['=', '+=', '||=', '??='].includes(jetons[i + 1].valeur) &&
      jetons[i - 1]?.valeur !== '.' &&
      jetons[i - 1]?.valeur !== 'const' &&
      jetons[i - 1]?.valeur !== 'let' &&
      jetons[i - 1]?.valeur !== 'var'
    ) {
      const fin = finDExpression(jetons, i + 2);
      const origine = classerExpression(jetons, i + 2, fin);
      const liaison = resoudreDans(courante, jeton.valeur, jeton.debut);
      if (liaison) {
        liaison.valeurs.push({ origine, offset: jeton.debut });
        liaison.reaffecte = true;
      }
      i = fin;
      continue;
    }
  }

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

function resoudreDans(portee, nom, _offset) {
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
