import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Variables d'environnement publiees dans le navigateur.
 *
 * Presque tous les outils de construction modernes exposent un prefixe qui
 * signifie « cette valeur part dans le bundle ». Le mecanisme est identique
 * partout, et le piege aussi : le prefixe se lit comme un espace de noms alors
 * qu'il decrit une publication. Une clef nommee STRIPE_SECRET_KEY prefixee
 * ainsi devient lisible par « afficher le code source ».
 *
 * Une seule regle couvre donc huit ecosystemes — y compris ceux pour lesquels
 * Argus n'a pas de pack dedie.
 */
const PREFIXES = [
  { prefixe: 'NEXT_PUBLIC_', outil: 'Next.js', doc: 'https://nextjs.org/docs/app/building-your-application/configuring/environment-variables' },
  { prefixe: 'NUXT_PUBLIC_', outil: 'Nuxt', doc: 'https://nuxt.com/docs/guide/going-further/runtime-config' },
  { prefixe: 'VITE_', outil: 'Vite', doc: 'https://vite.dev/guide/env-and-mode' },
  { prefixe: 'PUBLIC_', outil: 'SvelteKit ou Astro', doc: 'https://svelte.dev/docs/kit/$env-static-public' },
  { prefixe: 'REACT_APP_', outil: 'Create React App', doc: null },
  { prefixe: 'GATSBY_', outil: 'Gatsby', doc: null },
  { prefixe: 'EXPO_PUBLIC_', outil: 'Expo', doc: null },
  { prefixe: 'VUE_APP_', outil: 'Vue CLI', doc: null },
];

/** Noms qui designent une valeur qui ne doit jamais atteindre le navigateur. */
const NOM_SENSIBLE = /(secret|token|password|passwd|private|api_?key|apikey|credential|signing|webhook|dsn|service_?role|admin)/i;

/** Un nom peut contenir « key » sans rien exposer : cle publique, cle de site. */
const FAUX_AMIS = /(public_?key|site_?key|publishable|client_?id|anon_?key|_url$|_host$|_region$|_version$)/i;

export default {
  id: 'variables-publiques',
  label: 'Variables d\'environnement publiques',

  // Aucune condition de framework : le piege existe des qu'un de ces prefixes
  // apparait, quel que soit l'outil qui l'a introduit.
  appliesTo: () => true,

  run(context, report) {
    const fichiers = [
      ...context.sources({ families: ['js', 'markup'] }),
      ...context.files.filter((f) => f.readable && /(^|\/)\.env/.test(f.relativePath)),
    ];

    const signales = new Set();

    for (const file of fichiers) {
      const index = lineIndexFor(file);

      for (const { prefixe, outil, doc } of PREFIXES) {
        const motif = new RegExp(`\\b${prefixe}([A-Z0-9_]{2,60})`, 'g');

        for (const match of matches(file.content, motif)) {
          const suffixe = match[1];
          const nom = prefixe + suffixe;
          if (!NOM_SENSIBLE.test(suffixe) || FAUX_AMIS.test(suffixe)) continue;
          if (signales.has(nom)) continue;
          signales.add(nom);

          const sansPrefixe = suffixe;
          report({
            ruleId: 'ENV-PUBLIC-SECRET',
            category: 'security',
            severity: 'critical',
            title: `${nom} est publiee dans le navigateur`,
            message:
              `${outil} remplace toute variable prefixee ${prefixe} par sa valeur au moment de la construction, ` +
              'et l\'inclut dans le bundle telecharge par chaque visiteur. Le nom indique une valeur sensible : ' +
              'elle est donc lisible par n\'importe qui, via « afficher le code source ».',
            file: file.relativePath,
            line: index.lineOf(match.index),
            snippet: index.textOfLine(index.lineOf(match.index)).trim(),
            suggestion:
              `Retirez le prefixe : ${sansPrefixe} reste alors cote serveur. Consommez la valeur depuis une route ` +
              'd\'API, une fonction serveur ou un composant serveur — et considerez la valeur actuelle comme compromise, ' +
              'puisqu\'elle a deja pu etre servie.',
            effort: 'moyen',
            confidence: 'certain',
            tags: ['CWE-200', 'A01:2021', outil.toLowerCase()],
            docs: doc,
            data: { variable: nom, outil },
          });
        }
      }
    }
  },
};
