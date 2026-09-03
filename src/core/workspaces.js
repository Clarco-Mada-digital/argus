/**
 * Decoupage d'un depot en sous-projets.
 *
 * Un monorepo n'etait pas analyse : la detection de frameworks ne lisait que
 * le manifeste racine, lequel ne declare le plus souvent qu'un orchestrateur
 * (turbo, nx, lerna). Un depot contenant une application Next.js et une
 * application Expo se resumait donc a « node », et toutes les regles
 * specialisees restaient muettes.
 *
 * L'attribution se fait par manifeste plutot que par declaration d'espace de
 * travail : `workspaces`, `pnpm-workspace.yaml`, `lerna.json`, les membres
 * Cargo et `go.work` decrivent la meme realite avec cinq syntaxes, alors
 * qu'un dossier portant un manifeste est un sous-projet dans tous les cas —
 * y compris quand rien ne le declare, ce qui est frequent pour un backend
 * pose a cote d'un front.
 */

/** Fichiers dont la presence dans un dossier en fait un projet a part entiere. */
export const MANIFESTES_DE_PROJET = [
  'package.json',
  'pubspec.yaml',
  'composer.json',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'requirements.txt',
  'pyproject.toml',
  'Gemfile',
  'Package.swift',
];

/** Declarations d'espace de travail : elles n'attribuent rien, elles confirment. */
const DECLARATIONS = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'turbo.json',
  'nx.json',
  'rush.json',
  'go.work',
];

function dossierDe(cheminRelatif) {
  const coupe = cheminRelatif.lastIndexOf('/');
  return coupe === -1 ? '' : cheminRelatif.slice(0, coupe);
}

/**
 * Repere les dossiers qui portent un manifeste, hors racine.
 *
 * Un sous-projet imbrique dans un autre est conserve : `apps/mobile` et
 * `apps/mobile/android` sont deux perimetres distincts, et l'attribution
 * retiendra le plus profond, donc le plus specifique.
 */
export function decouvrirSousProjets(files) {
  const dossiers = new Set();

  for (const file of files) {
    if (!MANIFESTES_DE_PROJET.includes(file.name)) continue;
    const dossier = dossierDe(file.relativePath);
    if (dossier === '') continue;
    dossiers.add(dossier);
  }

  // Un dossier de plateforme native porte un manifeste de build mais n'est pas
  // un projet distinct : c'est une cible de compilation de l'application qui
  // le contient, et l'en separer priverait le pack mobile de son contexte.
  //
  // La liste ne contient pas `web` : un dossier `web/` de Flutter n'a de toute
  // facon aucun manifeste, alors que `apps/web` est un nom d'application on ne
  // peut plus courant — l'exclure faisait disparaitre l'application front d'un
  // monorepo, ce qui est exactement le contraire du but recherche.
  const retenus = [...dossiers].filter(
    (dossier) =>
      !/(^|\/)(android|ios|macos|windows|linux|src-tauri)$/.test(dossier) &&
      // Un harnais de test ou un exemple porte souvent son propre manifeste,
      // pour s'isoler du projet — pas parce qu'il en est un composant. Axios
      // se voyait ainsi decrit comme « monorepo de 6 projets », dont cinq
      // dossiers de test et une documentation.
      !/(^|\/)(tests?|__tests__|spec|specs|examples?|samples?|fixtures?|benchmarks?|bench|e2e|demo)(\/|$)/i.test(dossier),
  );

  return retenus.sort((a, b) => b.length - a.length);
}

export function aUneDeclarationDEspaceDeTravail(files, manifests) {
  const pkg = manifests['package.json']?.data;
  if (pkg && (Array.isArray(pkg.workspaces) || Array.isArray(pkg.workspaces?.packages))) return true;
  return files.some((file) => DECLARATIONS.includes(file.name) && !file.relativePath.includes('/'));
}

/**
 * Attribue chaque fichier au sous-projet le plus profond qui le contient.
 * Les chemins sont tries du plus long au plus court : le premier prefixe qui
 * correspond est donc le plus specifique.
 */
export function attribuer(cheminRelatif, sousProjets) {
  for (const chemin of sousProjets) {
    if (cheminRelatif === chemin || cheminRelatif.startsWith(`${chemin}/`)) return chemin;
  }
  return null;
}
