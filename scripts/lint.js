#!/usr/bin/env node
/**
 * Verification statique du projet, sans dependance externe.
 *
 * Trois controles, tous issus de regressions reellement vecues :
 *   1. syntaxe de chaque module (`node --check`) ;
 *   2. invariants du rapport HTML — les couleurs de texte doivent passer par
 *      des variables, sinon elles cassent en theme clair ;
 *   3. hygiene generale : pas de `debugger`, pas de `.only` oublie dans un test ;
 *   4. aucun fichier necessaire aux tests n'est exclu de Git.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const problemes = [];

function fichiers(dossier, filtre = /\.js$/) {
  const trouves = [];
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) trouves.push(...fichiers(complet, filtre));
    else if (filtre.test(entree.name)) trouves.push(complet);
  }
  return trouves;
}

const modules = ['src', 'bin', 'tests', 'scripts']
  .map((d) => path.join(RACINE, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => fichiers(d));

// 1. Syntaxe.
for (const fichier of modules) {
  try {
    execFileSync(process.execPath, ['--check', fichier], { stdio: 'pipe' });
  } catch (erreur) {
    problemes.push(`${relatif(fichier)} : syntaxe invalide\n${erreur.stderr?.toString().trim()}`);
  }
}

// 2. Invariants du rapport HTML.
const rapport = fs.readFileSync(path.join(RACINE, 'src/report/html.js'), 'utf8');
if (/;color:#[0-9a-f]{3,8}/i.test(rapport)) {
  problemes.push('src/report/html.js : couleur de texte codee en dur sur un fond colore — utilisez var(--on-accent).');
}
if (!/button\s*\{[^}]*color:\s*inherit/.test(rapport)) {
  problemes.push('src/report/html.js : le reset des boutons doit forcer color: inherit.');
}

// 3. Hygiene.
for (const fichier of modules) {
  const contenu = fs.readFileSync(fichier, 'utf8');
  const lignes = contenu.split('\n');
  lignes.forEach((ligne, i) => {
    if (/^\s*debugger\b/.test(ligne)) problemes.push(`${relatif(fichier)}:${i + 1} : instruction debugger oubliee.`);
    if (/\b(test|describe|it)\.only\s*\(/.test(ligne)) problemes.push(`${relatif(fichier)}:${i + 1} : .only oublie — le reste de la suite serait ignore.`);
  });
}

// 4. Un fichier de test *ignore* par Git est invisible : les tests passent en
//    local et echouent sur un clone frais. C'est arrive avec la regle `*.key`
//    du .gitignore, qui masquait une fixture Rails.
//    On interroge Git sur ce qu'il ignore, et non sur ce qu'il suit : un
//    fichier simplement pas encore ajoute n'est pas un probleme.
try {
  const ignores = execFileSync(
    'git',
    ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'tests'],
    { cwd: RACINE, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);

  if (ignores.length > 0) {
    problemes.push(
      'fichiers de test exclus par le .gitignore — ils manqueront sur un clone ' +
        `frais :\n      ${ignores.join('\n      ')}\n      ` +
        'Construisez ce scenario a l\'execution plutot que d\'ajouter une exception.',
    );
  }
} catch {
  /* hors depot Git : la verification ne s'applique pas */
}

// 5. La carte d'imports du site doit couvrir *tous* les specificateurs `node:`
//    atteignables depuis src/. Un seul manquant fait echouer la chaine entiere
//    d'imports, et l'erreur ne nomme que le module d'entree : le diagnostic est
//    donc tres couteux. C'est arrive avec `node:http` et
//    `node:readline/promises`, atteints parce que src/index.js reexporte
//    startServer — la page d'analyse etait cassee sans que rien ne le signale.
try {
  const page = fs.readFileSync(path.join(RACINE, 'site/analyser.html'), 'utf8');
  const carte = JSON.parse(page.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;

  // On ne considere que les modules *reellement atteignables* depuis le point
  // d'entree du navigateur. Balayer tout src/ signalait `node:os`, importe par
  // le pilote de navigateur de `argus perf` — un fichier que la page ne charge
  // jamais. Un garde-fou qui crie a tort finit par etre desactive.
  const racineNavigateur = path.join(RACINE, 'src/index.js');
  const vus = new Set();
  const specificateurs = new Set();

  const suivre = (fichier) => {
    if (vus.has(fichier) || !fs.existsSync(fichier)) return;
    vus.add(fichier);

    const contenu = fs.readFileSync(fichier, 'utf8');
    for (const m of contenu.matchAll(/from\s+'([^']+)'|import\('([^']+)'\)/g)) {
      const cible = m[1] ?? m[2];
      if (!cible) continue;
      if (cible.startsWith('node:')) { specificateurs.add(cible); continue; }
      if (!cible.startsWith('.')) continue;
      suivre(path.resolve(path.dirname(fichier), cible));
    }
  };

  suivre(racineNavigateur);

  const absents = [...specificateurs].filter((s) => !carte[s]);
  if (absents.length > 0) {
    problemes.push(
      `site/analyser.html : la carte d'imports ne couvre pas ${absents.join(', ')}.\n      ` +
        'Ajoutez un bouchon dans site/shims/ et referencez-le : un specificateur absent\n      ' +
        'casse tout le graphe d\'imports, et l\'erreur ne nomme que le module d\'entree.',
    );
  }

  for (const [specificateur, cible] of Object.entries(carte)) {
    if (!fs.existsSync(path.join(RACINE, 'site', cible.replace(/^\.\//, '')))) {
      problemes.push(`site/analyser.html : ${specificateur} pointe vers ${cible}, qui n'existe pas.`);
    }
  }
} catch (erreur) {
  problemes.push(`site/analyser.html : carte d'imports illisible (${erreur.message}).`);
}

// 6. Une regle qui vise un element porteur de `.zone` ne doit pas utiliser la
//    forme courte `padding` avec une valeur horizontale nulle : elle ecrase le
//    retrait lateral herite et colle le contenu aux bords de l'ecran.
//    Erreur commise trois fois — page 404, en-tete, hero et pied — parce
//    qu'elle est invisible a la lecture et ne se voit qu'a une certaine
//    largeur. `padding-block` exprime l'intention sans l'effet de bord.
try {
  const css = fs.readFileSync(path.join(RACINE, 'site/style.css'), 'utf8');
  const html = ['index.html', 'analyser.html', '404.html']
    .map((f) => path.join(RACINE, 'site', f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');

  // Les classes qui accompagnent `zone` dans le balisage.
  const classesDeZone = new Set();
  for (const m of html.matchAll(/class="([^"]*\bzone\b[^"]*)"/g)) {
    for (const classe of m[1].split(/\s+/)) {
      if (classe && classe !== 'zone' && classe !== 'zone-large') classesDeZone.add(classe);
    }
  }

  for (const classe of classesDeZone) {
    const regle = new RegExp(`\\.${classe}\\s*\\{[^}]*`, 'g');
    for (const m of css.matchAll(regle)) {
      const raccourci = /(?:^|[;{])\s*padding:\s*([^;}]+)/.exec(m[0]);
      if (!raccourci) continue;
      const valeurs = raccourci[1].trim().split(/\s+/);
      if (valeurs.length >= 2 && valeurs[1] === '0') {
        problemes.push(
          `site/style.css : .${classe} porte aussi la classe « zone » et pose ` +
            `\`padding: ${raccourci[1].trim()}\`, ce qui annule son retrait lateral.\n      ` +
            'Utilisez `padding-block` : le contenu se colle sinon aux bords de l\'ecran.',
        );
      }
    }
  }
} catch (erreur) {
  problemes.push(`Verification du retrait lateral impossible : ${erreur.message}`);
}

function relatif(fichier) {
  return path.relative(RACINE, fichier);
}

if (problemes.length > 0) {
  process.stderr.write(`\n${problemes.length} probleme(s) :\n\n${problemes.map((p) => `  • ${p}`).join('\n')}\n\n`);
  process.exit(1);
}

process.stdout.write(`✔ ${modules.length} modules verifies, aucun probleme.\n`);
