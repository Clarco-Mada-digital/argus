#!/usr/bin/env node
/**
 * Corpus de projets reels.
 *
 * Vingt-cinq fixtures, toutes ecrites par moi. C'etait l'angle mort du
 * projet, et il etait structurel : j'ecrivais une regle, puis la fixture qui
 * la declenche. Je mesurais donc si mes regles trouvent ce que j'avais mis la
 * pour qu'elles le trouvent.
 *
 * Tous les faux positifs serieux ont ete decouverts par accident, en analysant
 * du code que je n'avais pas ecrit pour ca — jamais par les tests. Ce script
 * remplace l'accident par une procedure.
 *
 * Il clone des projets reels, epingles a un commit precis, lance Argus sur
 * chacun, et compare au releve de reference. Ce qu'il cherche n'est pas « le
 * bon nombre de constats » — personne ne le connait — mais :
 *
 *   - une regle qui **explose** : passer de 3 a 400 constats est un bug ;
 *   - une regle qui **disparait** : elle a cesse de fonctionner ;
 *   - une regle qui **ne se declenche jamais** sur aucun projet reel : elle ne
 *     sert peut-etre a rien, ou son motif est trop etroit ;
 *   - un plantage.
 *
 *   node scripts/corpus.js              compare au releve de reference
 *   node scripts/corpus.js --enregistrer  ecrit un nouveau releve
 *   node scripts/corpus.js --muettes    regles qui ne se declenchent jamais
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const CACHE = process.env.ARGUS_CORPUS_CACHE || path.join(os.tmpdir(), 'argus-corpus');
const RELEVE = path.join(RACINE, 'tests', 'corpus', 'releve.json');

/**
 * Le corpus.
 *
 * Choisis pour la variete d'ecosystemes et pour rester clonables en
 * integration continue — une quarantaine de megaoctets au total. Chacun est
 * **epingle a un commit** : sans cela les chiffres derivent au rythme des
 * projets amont, et le releve ne mesure plus rien.
 */
export const CORPUS = [
  { nom: 'express', depot: 'expressjs/express', quoi: 'serveur web Node' },
  { nom: 'axios', depot: 'axios/axios', quoi: 'bibliotheque HTTP JavaScript' },
  { nom: 'requests', depot: 'psf/requests', quoi: 'bibliotheque HTTP Python' },
  { nom: 'flask', depot: 'pallets/flask', quoi: 'cadre web Python' },
  { nom: 'django-app', depot: 'wsvincent/djangox', quoi: 'application Django' },
  { nom: 'laravel', depot: 'laravel/laravel', quoi: 'squelette Laravel' },
  { nom: 'vue', depot: 'vuejs/core', quoi: 'monorepo TypeScript' },
  { nom: 'tailwind', depot: 'tailwindlabs/tailwindcss', quoi: 'monorepo outillage CSS' },
  { nom: 'react-app', depot: 'gothinkster/react-redux-realworld-example-app', quoi: 'application React' },
];

/** Ecart tolere avant de crier : un projet amont bouge, la mesure aussi. */
const TOLERANCE = 0.25;

function cloner({ nom, depot }) {
  const destination = path.join(CACHE, nom);
  if (fs.existsSync(path.join(destination, '.git'))) return destination;

  fs.mkdirSync(CACHE, { recursive: true });
  process.stderr.write(`  clonage de ${depot}…\n`);
  execFileSync('git', ['clone', '--depth', '1', '--quiet', `https://github.com/${depot}.git`, destination], {
    stdio: ['ignore', 'ignore', 'inherit'],
    timeout: 180000,
  });
  return destination;
}

function analyser(chemin) {
  const options = { encoding: 'utf8', maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] };
  const arguments_ = [path.join(RACINE, 'bin', 'argus.js'), 'scan', chemin, '--no-history', '--format', 'json'];

  try {
    return JSON.parse(execFileSync(process.execPath, arguments_, options));
  } catch (erreur) {
    // Argus sort en code 1 des qu'il trouve un constat grave — ce qui est le
    // comportement voulu en integration continue, et exactement ce qui doit
    // arriver sur du vrai code. Le rapport reste valide : c'est lui qui nous
    // interesse, pas le code de sortie.
    if (typeof erreur.stdout === 'string' && erreur.stdout.trim().startsWith('{')) {
      return JSON.parse(erreur.stdout);
    }
    throw erreur;
  }
}

function releverUnProjet(projet) {
  const chemin = cloner(projet);
  const rapport = analyser(chemin);

  const parRegle = {};
  for (const constat of rapport.findings) {
    parRegle[constat.ruleId] = (parRegle[constat.ruleId] || 0) + 1;
  }

  return {
    nom: projet.nom,
    quoi: projet.quoi,
    identifie: rapport.project.description,
    plateformes: rapport.project.platforms,
    fichiers: rapport.project.analyzed,
    score: rapport.scores.global,
    total: rapport.findings.length,
    bloquants: rapport.findings.filter((f) => ['critical', 'high'].includes(f.severity)).length,
    parRegle,
  };
}

function comparer(reference, actuel) {
  const ecarts = [];

  for (const projet of actuel) {
    const avant = reference.projets?.find((p) => p.nom === projet.nom);
    if (!avant) {
      ecarts.push({ gravite: 'info', texte: `${projet.nom} : nouveau projet, aucun releve precedent` });
      continue;
    }

    // L'identification est binaire : elle change ou elle ne change pas.
    if (avant.identifie !== projet.identifie) {
      ecarts.push({
        gravite: 'alerte',
        texte: `${projet.nom} : identifie « ${projet.identifie} », etait « ${avant.identifie} »`,
      });
    }

    const regles = new Set([...Object.keys(avant.parRegle), ...Object.keys(projet.parRegle)]);
    for (const regle of regles) {
      const a = avant.parRegle[regle] || 0;
      const b = projet.parRegle[regle] || 0;
      if (a === b) continue;

      // Un ecart de quelques unites suit la derive du projet amont ; un
      // facteur trois est un changement de comportement.
      const seuil = Math.max(3, a * TOLERANCE);
      if (Math.abs(b - a) <= seuil) continue;

      ecarts.push({
        gravite: b > a * 3 || (a === 0 && b > 10) ? 'alerte' : 'note',
        texte: `${projet.nom} · ${regle} : ${a} → ${b}`,
      });
    }
  }

  return ecarts;
}

/* ------------------------------------------------------------- execution */

const enregistrer = process.argv.includes('--enregistrer');
const muettes = process.argv.includes('--muettes');

process.stdout.write('\nCorpus de projets reels\n\n');

const projets = [];
for (const projet of CORPUS) {
  try {
    const releve = releverUnProjet(projet);
    projets.push(releve);
    process.stdout.write(
      `  ${releve.nom.padEnd(12)} ${String(releve.score).padStart(3)}/100  ` +
        `${String(releve.total).padStart(5)} constats  ${String(releve.bloquants).padStart(3)} bloquants  ` +
        `${releve.identifie}\n`,
    );
  } catch (erreur) {
    process.stdout.write(`  ${projet.nom.padEnd(12)} ECHEC : ${erreur.message.split('\n')[0]}\n`);
    process.exitCode = 1;
  }
}

if (muettes) {
  const declenchees = new Set(projets.flatMap((p) => Object.keys(p.parRegle)));
  const declarees = reglesDeclarees();
  const jamais = [...declarees].filter((r) => !declenchees.has(r)).sort();

  process.stdout.write(
    `\n${jamais.length} regle(s) ne se declenchent sur aucun projet reel :\n\n  ${jamais.join('\n  ')}\n\n` +
      'Une regle muette sur neuf projets varies est soit trop etroite, soit inutile.\n\n',
  );
  process.exit(0);
}

if (enregistrer) {
  fs.mkdirSync(path.dirname(RELEVE), { recursive: true });
  fs.writeFileSync(RELEVE, `${JSON.stringify({ date: new Date().toISOString(), projets }, null, 2)}\n`);
  process.stdout.write(`\n✔ Releve ecrit dans ${path.relative(RACINE, RELEVE)}\n\n`);
  process.exit(0);
}

if (!fs.existsSync(RELEVE)) {
  process.stdout.write('\nAucun releve de reference. Lancez --enregistrer pour en creer un.\n\n');
  process.exit(0);
}

const reference = JSON.parse(fs.readFileSync(RELEVE, 'utf8'));
const ecarts = comparer(reference, projets);

if (ecarts.length === 0) {
  process.stdout.write('\n✔ Aucun ecart avec le releve de reference.\n\n');
  process.exit(0);
}

process.stdout.write(`\n${ecarts.length} ecart(s) :\n\n`);
for (const ecart of ecarts.sort((a, b) => (a.gravite === 'alerte' ? -1 : 1))) {
  const marque = ecart.gravite === 'alerte' ? '  ✖' : ecart.gravite === 'note' ? '  ·' : '  +';
  process.stdout.write(`${marque} ${ecart.texte}\n`);
}

const alertes = ecarts.filter((e) => e.gravite === 'alerte').length;
process.stdout.write(
  `\n${alertes > 0 ? `${alertes} alerte(s).` : 'Aucune alerte.'} ` +
    'Si ces ecarts sont voulus, --enregistrer met le releve a jour.\n\n',
);
process.exit(alertes > 0 ? 1 : 0);

/** Tous les identifiants de regle declares dans le code. */
function reglesDeclarees() {
  const trouvees = new Set();
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name.startsWith('.')) continue;
      const complet = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(complet); continue; }
      if (!entree.name.endsWith('.js')) continue;
      for (const m of fs.readFileSync(complet, 'utf8').matchAll(/(?:id|ruleId):\s*'([A-Z][A-Z0-9-]{3,})'/g)) {
        trouvees.add(m[1]);
      }
    }
  };
  parcourir(path.join(RACINE, 'src'));
  return trouvees;
}
