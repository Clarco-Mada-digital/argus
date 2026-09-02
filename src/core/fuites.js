import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { detectSecrets, redact } from '../rules/secrets.js';
import { isGitRepository } from './git.js';

/**
 * Secrets ayant vecu dans l'historique Git.
 *
 * Argus dit, pour chaque secret trouve dans le code : « elle doit etre
 * consideree comme compromise des lors qu'elle a ete versionnee ». Il etait
 * pourtant incapable de dire *lesquelles* l'avaient ete — il ne lisait que
 * l'arbre de travail.
 *
 * Or le geste le plus courant, face a une clef en dur, est de la remplacer par
 * une variable d'environnement dans le commit suivant. Le fichier redevient
 * propre, l'analyse redevient verte, et la clef reste integralement lisible
 * dans `git log -p` — pour quiconque clone le depot, aujourd'hui ou dans cinq
 * ans. La correction donne un sentiment de securite qui est exactement
 * l'inverse de la realite.
 *
 * Le resultat n'est donc pas « il y a un secret » mais « cette clef a vecu du
 * commit A au commit B, la voici, revoquez-la ». Reecrire l'historique est une
 * option ; revoquer la clef est la seule qui marche vraiment, parce qu'on ne
 * sait pas qui a deja clone.
 */

/** Au-dela, on s'arrete : mieux vaut un resultat partiel annonce qu'une attente sans fin. */
const COMMITS_PAR_DEFAUT = 2000;

/**
 * Marqueur d'en-tete de commit.
 *
 * Il doit etre absent du code comme des messages de commit, et ne contenir
 * aucun octet nul : `git` refuse les arguments qui en portent.
 */
const MARQUE = '@@ARGUS@@';

/**
 * Chemins ou un secret est, presque toujours, une donnee de test.
 *
 * Une suite qui verifie la detection de secrets *doit* en contenir : c'est
 * son entree. Les melanger aux vraies fuites noierait les secondes, et une
 * alerte de securite noyee est une alerte ignoree.
 *
 * Ils ne sont pas ecartes pour autant — une vraie clef finit parfois dans un
 * test — mais rangés a part et signales comme tels, a l'utilisateur de
 * trancher.
 */
const CHEMIN_DE_TEST = /(^|\/)(tests?|__tests__|spec|fixtures?|examples?|samples?|mocks?|demo|e2e|cypress|playwright)(\/|$)/i;

function estUnCheminDeTest(fichiers) {
  return fichiers.length > 0 && fichiers.every((f) => CHEMIN_DE_TEST.test(f));
}

/**
 * Empreinte d'un secret : c'est la *valeur* qui compte, pas l'endroit.
 * Une meme clef copiee dans trois fichiers est une seule fuite a revoquer.
 */
function empreinte(valeur) {
  return crypto.createHash('sha1').update(valeur).digest('hex').slice(0, 12);
}

/**
 * Lit l'historique en flux et appelle `surLigne` pour chaque ligne ajoutee.
 *
 * Le flux est indispensable : `git log -p` sur un depot serieux produit des
 * centaines de mega-octets, que rien ne justifie de charger en memoire.
 */
function parcourirHistorique(racine, { maxCommits, tousLesRefs, surCommit, surLigne }) {
  return new Promise((resoudre, rejeter) => {
    const arguments_ = [
      'log',
      `--max-count=${maxCommits}`,
      '-p',
      '--no-color',
      '--no-renames',
      // Aucun contexte : seules les lignes ajoutees nous interessent.
      '--unified=0',
      `--format=${MARQUE}%H${MARQUE}%at${MARQUE}%an${MARQUE}%s`,
    ];
    if (tousLesRefs) arguments_.push('--all');

    const git = spawn('git', arguments_, { cwd: racine });
    let tampon = '';
    let commit = null;
    let fichier = null;
    let lignesLues = 0;

    git.stdout.setEncoding('utf8');
    git.stdout.on('data', (morceau) => {
      tampon += morceau;
      let saut;

      while ((saut = tampon.indexOf('\n')) !== -1) {
        const ligne = tampon.slice(0, saut);
        tampon = tampon.slice(saut + 1);
        lignesLues++;

        if (ligne.startsWith(MARQUE)) {
          const [, hash, date, auteur, sujet] = ligne.split(MARQUE);
          commit = { hash, date: Number(date) * 1000, auteur, sujet };
          surCommit(commit);
          continue;
        }

        if (ligne.startsWith('+++ b/')) { fichier = ligne.slice(6); continue; }
        if (ligne.startsWith('--- ')) continue;
        if (ligne.startsWith('diff --git')) { fichier = null; continue; }

        // Seules les lignes ajoutees comptent : une ligne supprimee a
        // forcement ete ajoutee par un commit plus ancien, que l'on verra.
        if (ligne.startsWith('+') && !ligne.startsWith('+++') && commit) {
          surLigne(ligne.slice(1), fichier, commit);
        }
      }
    });

    git.on('error', rejeter);
    git.on('close', () => resoudre({ lignesLues }));
  });
}

/**
 * Cherche les secrets ayant existe dans l'historique.
 *
 * @param {string} racine
 * @param {{ maxCommits?: number, tousLesRefs?: boolean, fichiersActuels?: Map<string,string> }} options
 */
export async function chercherLesFuites(racine, {
  maxCommits = COMMITS_PAR_DEFAUT,
  tousLesRefs = true,
  fichiersActuels = new Map(),
} = {}) {
  if (!isGitRepository(racine)) {
    throw Object.assign(new Error('Ce dossier n\'est pas un depot Git.'), { genre: 'git' });
  }

  const parEmpreinte = new Map();
  let commitsVus = 0;

  const { lignesLues } = await parcourirHistorique(racine, {
    maxCommits,
    tousLesRefs,
    surCommit: () => { commitsVus++; },
    surLigne: (contenu, fichier, commit) => {
      // Une ligne demesuree est un minifie ou un binaire encode : la scanner
      // coute cher et ne produit que du bruit.
      if (contenu.length > 1000) return;

      for (const secret of detectSecrets(contenu, { allowTests: false })) {
        const cle = empreinte(secret.match);
        let fuite = parEmpreinte.get(cle);

        if (!fuite) {
          fuite = {
            empreinte: cle,
            genre: secret.kind,
            libelle: secret.label,
            severite: secret.severity,
            valeur: redact(secret.match),
            entropie: secret.entropy,
            fichiers: new Set(),
            // `git log` remonte du plus recent au plus ancien : le premier vu
            // est donc le dernier commit ou la valeur apparait.
            dernierCommit: commit,
            premierCommit: commit,
            commits: 0,
          };
          parEmpreinte.set(cle, fuite);
        }

        if (fichier) fuite.fichiers.add(fichier);
        fuite.premierCommit = commit;
        fuite.commits++;
      }
    },
  });

  // Le secret est-il encore dans le code d'aujourd'hui ? La reponse change
  // entierement le conseil a donner.
  const contenuActuel = [...fichiersActuels.values()].join('\n');
  const fuites = [...parEmpreinte.values()].map((fuite) => {
    const fichiers = [...fuite.fichiers];
    return {
      ...fuite,
      fichiers,
      donneeDeTest: estUnCheminDeTest(fichiers),
      encorePresente: contenuActuel.includes(fuite.valeur.replace(/….*$/, '').slice(0, 8)),
    };
  });

  // Les vraies fuites d'abord, les donnees de test ensuite ; a l'interieur de
  // chaque groupe, les plus graves puis les plus anciennes — une clef qui
  // traine depuis deux ans a eu plus de temps pour fuiter.
  const rang = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  fuites.sort(
    (a, b) =>
      Number(a.donneeDeTest) - Number(b.donneeDeTest) ||
      (rang[a.severite] ?? 9) - (rang[b.severite] ?? 9) ||
      a.premierCommit.date - b.premierCommit.date,
  );

  const reelles = fuites.filter((f) => !f.donneeDeTest);
  return {
    fuites,
    reelles,
    donneesDeTest: fuites.length - reelles.length,
    commitsAnalyses: commitsVus,
    lignesLues,
    tronque: commitsVus >= maxCommits,
  };
}

/**
 * Ou revoquer, selon le fournisseur.
 *
 * C'est la partie qui compte. Reecrire l'historique est possible, mais on ne
 * sait pas qui a deja clone le depot, ni ce qu'un miroir en a garde : seule
 * la revocation ferme reellement la porte. Donner l'adresse exacte evite la
 * demi-heure de recherche qui fait remettre l'action a plus tard.
 */
const REVOCATION = {
  'stripe-key': ['Stripe', 'https://dashboard.stripe.com/apikeys'],
  'github-token': ['GitHub', 'https://github.com/settings/tokens'],
  'gitlab-token': ['GitLab', 'https://gitlab.com/-/user_settings/personal_access_tokens'],
  'aws-access-key': ['AWS IAM', 'https://console.aws.amazon.com/iam/home#/security_credentials'],
  'aws-secret': ['AWS IAM', 'https://console.aws.amazon.com/iam/home#/security_credentials'],
  'google-api-key': ['Google Cloud', 'https://console.cloud.google.com/apis/credentials'],
  'firebase-key': ['Firebase', 'https://console.firebase.google.com/'],
  'slack-token': ['Slack', 'https://api.slack.com/apps'],
  'openai-key': ['OpenAI', 'https://platform.openai.com/api-keys'],
  'anthropic-key': ['Anthropic', 'https://console.anthropic.com/settings/keys'],
  'sendgrid-key': ['SendGrid', 'https://app.sendgrid.com/settings/api_keys'],
  'twilio-sid': ['Twilio', 'https://console.twilio.com/'],
  'mailgun-key': ['Mailgun', 'https://app.mailgun.com/settings/api_security'],
  'npm-token': ['npm', 'https://www.npmjs.com/settings/~/tokens'],
  'jwt-token': ['le service emetteur', null],
  'private-key': ["l'autorite ayant emis la clef", null],
  'db-url': ['la base de donnees — changez le mot de passe', null],
  'basic-auth-url': ['le service concerne', null],
};

export function ouRevoquer(genre) {
  const trouve = REVOCATION[genre];
  if (!trouve) return { service: null, adresse: null };
  return { service: trouve[0], adresse: trouve[1] };
}

/** Age lisible d'un horodatage, en francais. */
export function depuisQuand(horodatage) {
  const jours = Math.floor((Date.now() - horodatage) / 86400000);
  if (jours < 1) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 31) return `il y a ${jours} jours`;
  if (jours < 365) return `il y a ${Math.floor(jours / 30)} mois`;
  const annees = Math.floor(jours / 365);
  return annees === 1 ? 'il y a un an' : `il y a ${annees} ans`;
}
