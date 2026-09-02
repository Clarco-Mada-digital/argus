/**
 * Regles sur un chargement mesure.
 *
 * Les seuils viennent des « Core Web Vitals » publies par Google, qui les
 * derive d'etudes d'abandon reelles plutot que d'un ideal d'ingenieur. Ils
 * sont repris tels quels : inventer les siens rendrait le resultat
 * incomparable avec la Search Console de l'utilisateur, qui est la seule
 * mesure ayant des consequences pour lui.
 *
 * Un chargement mesure ne remplace pas l'analyse statique, il la complete :
 * l'une dit qu'une image pese 800 Ko, l'autre dit que la page reste blanche
 * pendant trois secondes a cause d'elle.
 */

const KO = 1024;

/** Seuils officiels : bon en dessous du premier, mauvais au-dela du second. */
export const SEUILS = {
  lcp: { bon: 2500, mauvais: 4000, unite: 'ms' },
  cls: { bon: 0.1, mauvais: 0.25, unite: '' },
  ttfb: { bon: 800, mauvais: 1800, unite: 'ms' },
  fcp: { bon: 1800, mauvais: 3000, unite: 'ms' },
};

function graviteSelonSeuil(valeur, seuil) {
  if (valeur > seuil.mauvais) return 'high';
  if (valeur > seuil.bon) return 'medium';
  return null;
}

const secondes = (ms) => `${(ms / 1000).toFixed(2)} s`;

export function evaluerChargement(mesures) {
  const constats = [];
  const ajouter = (constat) => constats.push({ effort: 'moyen', confidence: 'firm', ...constat });

  // --------------------------------------------------------------- LCP
  const graviteLcp = graviteSelonSeuil(mesures.lcp, SEUILS.lcp);
  if (graviteLcp && mesures.lcp > 0) {
    ajouter({
      ruleId: 'PERF-LCP-LENT',
      severity: graviteLcp,
      title: `Plus grand element affiche en ${secondes(mesures.lcp)}`,
      message:
        `Le plus grand element visible met ${secondes(mesures.lcp)} a apparaitre, contre ${secondes(SEUILS.lcp.bon)} recommandees. ` +
        'C\'est le moment ou le visiteur considere que la page « a chargé » : au-dela, il commence a partir.',
      suggestion:
        'Identifiez cet element — le plus souvent une image de banniere ou un titre attendant une police. ' +
        'Preferez `fetchpriority="high"` sur l\'image concernee, `preload` sur la police, et retirez ce qui bloque le rendu avant elle.',
      docs: 'https://web.dev/articles/lcp?hl=fr',
    });
  }

  // --------------------------------------------------------------- CLS
  const graviteCls = graviteSelonSeuil(mesures.cls, SEUILS.cls);
  if (graviteCls) {
    ajouter({
      ruleId: 'PERF-CLS-INSTABLE',
      severity: graviteCls,
      title: `La mise en page bouge pendant le chargement (${mesures.cls.toFixed(3)})`,
      message:
        `Le decalage cumule atteint ${mesures.cls.toFixed(3)}, au-dela du seuil de ${SEUILS.cls.bon}. ` +
        'Concretement : le contenu saute sous les yeux du visiteur, et un bouton se derobe au moment ou il le vise.',
      suggestion:
        'Reservez la place avant le chargement : `width` et `height` sur chaque image, une hauteur minimale sur les zones remplies en JavaScript, ' +
        'et `font-display: optional` plutot que `swap` si le changement de police decale le texte.',
      docs: 'https://web.dev/articles/cls?hl=fr',
    });
  }

  // -------------------------------------------------------------- TTFB
  const graviteTtfb = graviteSelonSeuil(mesures.ttfb, SEUILS.ttfb);
  if (graviteTtfb && mesures.ttfb > 0) {
    ajouter({
      ruleId: 'PERF-TTFB-LENT',
      severity: graviteTtfb === 'high' ? 'medium' : 'low',
      title: `Premier octet recu apres ${secondes(mesures.ttfb)}`,
      message:
        `Le serveur met ${secondes(mesures.ttfb)} a repondre. Tout le reste attend ce moment : ` +
        'aucune optimisation cote navigateur ne rattrape un serveur lent.',
      suggestion:
        'Regardez du cote du rendu serveur, des requetes en base sur le chemin critique, et de la mise en cache. ' +
        'Un reseau de diffusion aide surtout si vos visiteurs sont loin de votre serveur.',
      docs: 'https://web.dev/articles/ttfb?hl=fr',
    });
  }

  // ------------------------------------------------------- Poids total
  if (mesures.octets > 2 * KO * KO) {
    const mo = (mesures.octets / (KO * KO)).toFixed(1);
    ajouter({
      ruleId: 'PERF-POIDS-TOTAL',
      severity: mesures.octets > 5 * KO * KO ? 'medium' : 'low',
      title: `${mo} Mo telecharges pour une page`,
      message:
        `Le chargement complet represente ${mo} Mo en ${mesures.requetes} requetes. ` +
        'Sur un forfait mobile limite, chaque visite coute cela au visiteur.',
      suggestion: detaillerLePoids(mesures),
      effort: 'long',
    });
  }

  // --------------------------------------------------- Ressources lourdes
  for (const ressource of mesures.lourdes.slice(0, 3)) {
    const ko = Math.round(ressource.octets / KO);
    if (ko < 200) continue;
    ajouter({
      ruleId: 'PERF-RESSOURCE-LOURDE',
      severity: ko > 500 ? 'medium' : 'low',
      title: `${ko} Ko pour une seule ressource`,
      message: `${nomCourt(ressource.url)} pese ${ko} Ko a lui seul (${ressource.type}).`,
      suggestion:
        ressource.type === 'Image'
          ? 'Convertissez en AVIF ou WebP, dimensionnez a la taille reellement affichee, et servez plusieurs tailles via `srcset`.'
          : 'Decoupez ce fichier et ne chargez que ce dont la premiere vue a besoin.',
      effort: 'moyen',
    });
  }

  // -------------------------------------------------- Nombre de requetes
  if (mesures.requetes > 80) {
    ajouter({
      ruleId: 'PERF-REQUETES-NOMBREUSES',
      severity: 'low',
      title: `${mesures.requetes} requetes pour afficher la page`,
      message:
        `La page declenche ${mesures.requetes} requetes reseau. Meme rapides, elles se disputent la bande passante ` +
        'et retardent ce qui compte.',
      suggestion:
        'Regroupez ce qui peut l\'etre, differez ce qui n\'est pas visible immediatement, et verifiez la part des scripts tiers.',
      effort: 'moyen',
    });
  }

  return constats;
}

function detaillerLePoids(mesures) {
  const parts = Object.entries(mesures.parType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type, octets]) => `${type} ${(octets / (KO * KO)).toFixed(1)} Mo`);

  return `Repartition : ${parts.join(', ')}. Commencez par le poste le plus lourd — c'est le seul qui change le total.`;
}

function nomCourt(url) {
  try {
    const { pathname, host } = new URL(url);
    const fichier = pathname.split('/').filter(Boolean).pop() || '/';
    return `${host}/…/${fichier}`;
  } catch {
    return url.slice(0, 60);
  }
}
