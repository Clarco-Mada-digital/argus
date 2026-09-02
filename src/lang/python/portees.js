import { maskCommentsAndStrings } from '../../core/scan.js';
import { ORIGINES } from '../js/portees.js';

/**
 * Portees et origine des valeurs, en Python.
 *
 * Beaucoup plus simple que son equivalent JavaScript, et pour une bonne
 * raison : Python n'a pas de portee de bloc. Un `if` ou une boucle
 * n'introduisent rien ; seules les fonctions et les classes comptent. La
 * structure se lit donc a l'indentation, sans avoir besoin d'un lexeur.
 *
 * Meme objectif que du cote JavaScript : distinguer `request.GET.get('id')`
 * d'une constante litterale dans une concatenation SQL. Django, Flask et
 * FastAPI sont des cibles centrales d'Argus, et le faux positif y est
 * exactement le meme.
 */

/** Ce qui, en Python, vient de l'exterieur du programme. */
const MOTIFS_EXTERNES = [
  /\brequest\b/,
  /\bself\.request\b/,
  /\.(GET|POST|FILES|COOKIES|META)\b/,
  /\.(data|form|json|args|values|query_params|path_params)\b/,
  /\.(body|headers|cookies)\b/,
  /\bsys\.argv\b/,
  /\bos\.environ\b/,
  /\binput\s*\(/,
  /\bflask\.request\b/,
];

const LITTERAUX_NOMMES = new Set(['True', 'False', 'None']);

/** Indentation d'une ligne, tabulations comptees pour quatre espaces. */
function indentationDe(ligne) {
  let n = 0;
  for (const c of ligne) {
    if (c === ' ') n++;
    else if (c === '\t') n += 4;
    else break;
  }
  return n;
}

class Portee {
  constructor(parent, indentation, debut) {
    this.parent = parent;
    this.indentation = indentation;
    this.debut = debut;
    this.fin = Infinity;
    this.liaisons = new Map();
    this.enfants = [];
    if (parent) parent.enfants.push(this);
  }

  declarer(liaison) {
    const existante = this.liaisons.get(liaison.nom);
    if (existante) {
      existante.valeurs.push(...liaison.valeurs);
      existante.reaffecte = true;
      return existante;
    }
    this.liaisons.set(liaison.nom, liaison);
    return liaison;
  }
}

/**
 * Classe une expression a partir de sa forme masquee et de sa forme brute.
 *
 * Le masque a blanchi chaines et commentaires : s'il ne reste ni identifiant
 * ni appel, l'expression etait faite de litteraux.
 */
function classerExpression(masquee, brute) {
  const sansLitterauxNommes = masquee.replace(/\b(True|False|None)\b/g, '');
  const aDesIdentifiants = /[A-Za-z_]\w*/.test(sansLitterauxNommes);

  if (!aDesIdentifiants) {
    // Une expression sans identifiant est litterale — a condition qu'il y ait
    // quelque chose : une ligne vide n'apprend rien.
    return brute.trim() ? ORIGINES.litteral : ORIGINES.inconnu;
  }

  for (const motif of MOTIFS_EXTERNES) {
    if (motif.test(masquee)) return ORIGINES.externe;
  }

  if (masquee.split(/\b/).every((m) => !m.trim() || LITTERAUX_NOMMES.has(m.trim()) || /^[^A-Za-z_]*$/.test(m))) {
    return ORIGINES.litteral;
  }

  return ORIGINES.inconnu;
}

/** Les noms lies par une cible d'affectation (`a`, `a, b`, `(a, b)`). */
function nomsDeCible(cible) {
  const noms = [];
  for (const m of cible.matchAll(/(?<![.\w])[A-Za-z_]\w*/g)) {
    noms.push({ nom: m[0], decalage: m.index });
  }
  return noms;
}

export function analyserPortees(source) {
  const masque = maskCommentsAndStrings(source, 'python');
  const lignes = source.split('\n');
  const lignesMasquees = masque.split('\n');

  const debutsDeLigne = [];
  let position = 0;
  for (const ligne of lignes) {
    debutsDeLigne.push(position);
    position += ligne.length + 1;
  }

  const racine = new Portee(null, -1, 0);
  const pile = [racine];

  for (let i = 0; i < lignes.length; i++) {
    const brute = lignes[i];
    const ligne = lignesMasquees[i];
    if (!ligne.trim()) continue;

    const indentation = indentationDe(ligne);
    const debutLigne = debutsDeLigne[i];

    // Sortie de portee : on referme tout ce qui est plus indente.
    while (pile.length > 1 && indentation <= pile[pile.length - 1].indentation) {
      pile.pop().fin = debutLigne;
    }
    const courante = pile[pile.length - 1];

    // ------------------------------------------------------- definitions
    const def = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)/.exec(ligne);
    if (def) {
      courante.declarer({
        nom: def[1], genre: 'function', offset: debutLigne, valeurs: [], reaffecte: false,
      });

      const portee = new Portee(courante, indentation, debutLigne);
      // Les parametres : on ignore annotations et valeurs par defaut, qui
      // suivent respectivement `:` et `=`.
      for (const morceau of def[2].split(',')) {
        const nom = /^\s*\*{0,2}\s*([A-Za-z_]\w*)/.exec(morceau);
        if (!nom || nom[1] === 'self' || nom[1] === 'cls') continue;
        portee.declarer({
          nom: nom[1], genre: 'param', offset: debutLigne, valeurs: [], reaffecte: false,
        });
      }
      pile.push(portee);
      continue;
    }

    const classe = /^\s*class\s+([A-Za-z_]\w*)/.exec(ligne);
    if (classe) {
      courante.declarer({
        nom: classe[1], genre: 'class', offset: debutLigne, valeurs: [], reaffecte: false,
      });
      pile.push(new Portee(courante, indentation, debutLigne));
      continue;
    }

    // ------------------------------------------------------ affectations
    // `=` simple, en excluant `==`, `<=`, `>=`, `!=` et les valeurs par defaut
    // d'appel, qui vivent entre parentheses.
    const affectation = /^(\s*)([A-Za-z_][\w\s,.[\]()]*?)\s*(?::[^=]*)?=(?!=)(.*)$/.exec(ligne);
    if (affectation && !/[<>!+\-*/%|&^]$/.test(affectation[2].trimEnd())) {
      const cible = affectation[2];
      // Une affectation d'attribut (`self.x = …`) ne cree pas de liaison locale.
      if (!/\./.test(cible)) {
        const decalageValeur = ligne.length - affectation[3].length;
        const origine = classerExpression(affectation[3], brute.slice(decalageValeur));
        for (const { nom, decalage } of nomsDeCible(cible)) {
          courante.declarer({
            nom,
            genre: 'variable',
            offset: debutLigne + affectation[1].length + decalage,
            valeurs: [{ origine, offset: debutLigne }],
            reaffecte: false,
          });
        }
        continue;
      }
    }

    // ------------------------------------------ boucles et gestionnaires
    const boucle = /^\s*for\s+([A-Za-z_][\w\s,]*?)\s+in\s+(.*?):/.exec(ligne);
    if (boucle) {
      const origine = classerExpression(boucle[2], boucle[2]);
      for (const { nom } of nomsDeCible(boucle[1])) {
        courante.declarer({
          nom, genre: 'variable', offset: debutLigne, valeurs: [{ origine, offset: debutLigne }], reaffecte: false,
        });
      }
      continue;
    }

    for (const m of ligne.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) {
      courante.declarer({
        nom: m[1], genre: 'variable', offset: debutLigne, valeurs: [{ origine: ORIGINES.inconnu, offset: debutLigne }], reaffecte: false,
      });
    }
  }

  while (pile.length > 1) pile.pop().fin = source.length;
  racine.fin = source.length;

  return {
    racine,
    resoudre: (nom, offset) => resoudreParOffset(racine, nom, offset),
    origine: (nom, offset) => {
      const liaison = resoudreParOffset(racine, nom, offset);
      return liaison ? origineDe(liaison) : ORIGINES.inconnu;
    },
  };
}

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

function origineDe(liaison) {
  if (liaison.genre === 'param') return ORIGINES.parametre;
  if (liaison.valeurs.some((v) => v.origine === ORIGINES.externe)) return ORIGINES.externe;
  if (liaison.valeurs.length > 0 && liaison.valeurs.every((v) => v.origine === ORIGINES.litteral)) {
    return ORIGINES.litteral;
  }
  return ORIGINES.inconnu;
}

export { ORIGINES };
