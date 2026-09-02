import fs from 'node:fs';
import path from 'node:path';
import { analyze } from '../core/engine.js';
import { loadConfig } from '../core/config.js';
import { walkProject } from '../core/walker.js';
import { ProjectContext } from '../core/project.js';
import { CATEGORIES, SEVERITIES } from '../core/severity.js';
import { planFixes, renderDiff } from '../cli/fix.js';

/**
 * Serveur MCP (Model Context Protocol) d'Argus.
 *
 * Il expose l'analyse a un assistant, qui peut alors lire un projet et
 * proposer des corrections en connaissance de cause plutot qu'en devinant.
 *
 * Trois principes ont guide la conception.
 *
 * **Rien n'est jamais ecrit.** Le serveur est en lecture seule, sans
 * exception. `argus fix` demande confirmation fichier par fichier dans un
 * terminal ; un assistant qui appellerait un outil ne peut pas donner cette
 * confirmation a la place de l'utilisateur. L'outil de correction retourne
 * donc des differentiels a lire, jamais un fichier modifie — et sa
 * description le dit, pour qu'aucun modele ne suppose le contraire.
 *
 * **Le contexte est une ressource rare.** Un projet reel produit des
 * centaines de constats ; les deverser tels quels remplirait la fenetre de
 * l'assistant sans rien lui apprendre. Chaque outil renvoie donc une
 * synthese d'abord, des constats filtres ensuite, et indique comment obtenir
 * la suite. Un rapport se lit, il ne se recite pas.
 *
 * **Zero dependance.** Le transport MCP sur stdio est un flux de messages
 * JSON-RPC separes par des retours a la ligne : quarante lignes suffisent,
 * et le projet garde sa promesse.
 */

const VERSION_PROTOCOLE_PAR_DEFAUT = '2024-11-05';
const VERSIONS_CONNUES = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);

/** Nombre de constats detailles retournes par defaut. */
const LIMITE_PAR_DEFAUT = 25;

const OUTILS = [
  {
    name: 'argus_scan',
    description:
      "Analyse un projet local et retourne son score par categorie, puis les constats les plus graves. " +
      "Couvre la securite (injections, secrets, configuration), les routes et liens morts, le code mort, " +
      "le SEO, le design et l'accessibilite, la performance, la qualite et les dependances vulnerables. " +
      "Detecte le framework et la plateforme visee (web, mobile, bureau) et n'applique que les regles valides pour elle. " +
      "LECTURE SEULE : aucun fichier n'est modifie.",
    inputSchema: {
      type: 'object',
      properties: {
        chemin: {
          type: 'string',
          description: 'Chemin du projet a analyser. Par defaut, le repertoire courant.',
        },
        categories: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(CATEGORIES) },
          description: 'Categories a analyser. Par defaut, toutes.',
        },
        severiteMin: {
          type: 'string',
          enum: [...SEVERITIES],
          description: 'Ne retourner que les constats de cette gravite ou plus. Defaut : « medium ».',
        },
        limite: {
          type: 'number',
          description: `Nombre maximal de constats detailles. Defaut : ${LIMITE_PAR_DEFAUT}.`,
        },
      },
    },
  },
  {
    name: 'argus_correctifs',
    description:
      "Retourne les corrections automatiques applicables a un projet, sous forme de differentiels a lire. " +
      "N'ECRIT RIEN et ne peut rien ecrire : la modification de fichiers passe obligatoirement par " +
      "`argus fix` dans un terminal, ou l'utilisateur valide chaque fichier lui-meme. " +
      "Utilisez ce resultat pour expliquer ou proposer, jamais pour affirmer qu'une correction a ete faite.",
    inputSchema: {
      type: 'object',
      properties: {
        chemin: { type: 'string', description: 'Chemin du projet. Par defaut, le repertoire courant.' },
        limite: { type: 'number', description: 'Nombre maximal de correctifs retournes. Defaut : 10.' },
      },
    },
  },
  {
    name: 'argus_regle',
    description:
      "Explique une regle d'Argus a partir de son identifiant (par exemple SEC-SQL-CONCAT) : " +
      'ce qu\'elle detecte, pourquoi cela pose probleme, et comment y remedier. ' +
      'Sans identifiant, liste les regles disponibles par categorie.',
    inputSchema: {
      type: 'object',
      properties: {
        identifiant: { type: 'string', description: 'Identifiant de la regle, par exemple « SEC-EVAL ».' },
      },
    },
  },
];

/* ------------------------------------------------------------------ outils */

/**
 * Resout et verifie le chemin demande.
 *
 * Sans cette verification, un chemin errone produisait « 100/100, 0 fichiers
 * analyses » : un assistant aurait annonce un projet exemplaire alors qu'il
 * n'avait rien lu. Une erreur franche vaut mieux qu'un succes vide.
 */
function resoudreChemin(chemin) {
  const resolu = path.resolve(chemin || process.cwd());

  if (!fs.existsSync(resolu)) {
    throw new Error(`Le chemin « ${resolu} » n'existe pas. Verifiez l'argument « chemin ».`);
  }
  if (!fs.statSync(resolu).isDirectory()) {
    throw new Error(`« ${resolu} » est un fichier. Indiquez le dossier du projet.`);
  }

  return resolu;
}

/** Une ligne compacte par constat : fichier, ligne, gravite, regle, titre. */
function ligneDeConstat(constat) {
  const position = constat.file ? `${constat.file}${constat.line ? `:${constat.line}` : ''}` : 'projet';
  const confiance = constat.confidence === 'tentative' ? ' (a verifier)' : '';
  return `- [${constat.severity}] ${position} — ${constat.ruleId} : ${constat.title}${confiance}`;
}

async function outilScan({ chemin, categories, severiteMin = 'medium', limite = LIMITE_PAR_DEFAUT }) {
  const racine = resoudreChemin(chemin);
  const config = loadConfig(racine, {
    ...(categories?.length ? { categories } : {}),
    minSeverity: 'info',
    noHistory: true,
  });

  const rapport = await analyze(config);
  const { project, scores } = rapport;

  if (project.analyzed === 0) {
    return (
      `Aucun fichier analysable dans « ${racine} ».\n\n` +
      'Le dossier est vide, ne contient que des fichiers ignores, ou tout son ' +
      'contenu est exclu par le .gitignore. Le score n\'a pas de sens ici : ne ' +
      'concluez pas que le projet est sain.'
    );
  }

  const rang = (s) => SEVERITIES.indexOf(s);
  const retenus = rapport.findings.filter((f) => rang(f.severity) <= rang(severiteMin));
  const montres = retenus.slice(0, limite);

  const plateformes = { web: 'web', mobile: 'mobile', desktop: 'bureau' };
  const cibles = (project.platforms || []).map((p) => plateformes[p]).filter(Boolean);

  const lignes = [
    `# ${project.description || 'Projet'}${cibles.length ? ` — application ${cibles.join(' et ')}` : ''}`,
    '',
    `Score global : ${scores.global}/100 (${scores.grade}) · ${project.analyzed} fichiers analyses`,
    `Detecte : ${project.frameworks.slice(0, 10).join(', ') || 'aucun framework identifie'}`,
    '',
    '## Scores par categorie',
    ...Object.values(scores.categories).map(
      (c) => `- ${c.label} : ${c.score}/100 (${c.total} constat${c.total > 1 ? 's' : ''})`,
    ),
    '',
    `## Constats de gravite « ${severiteMin} » ou superieure (${retenus.length} au total)`,
  ];

  if (montres.length === 0) {
    lignes.push('Aucun.');
  } else {
    lignes.push(...montres.map(ligneDeConstat));
    if (retenus.length > montres.length) {
      lignes.push(
        '',
        `${retenus.length - montres.length} constat(s) supplementaire(s) non affiches. ` +
          'Rappelez l\'outil avec une limite plus elevee, ou filtrez par categorie.',
      );
    }
  }

  // Le detail complet du premier constat sert de modele : il montre a
  // l'assistant ce qu'Argus sait dire, sans multiplier le volume.
  const premier = montres[0];
  if (premier) {
    lignes.push(
      '',
      '## Detail du constat le plus grave',
      `**${premier.ruleId}** — ${premier.title}`,
      premier.message,
      premier.suggestion ? `\n*Correction suggeree :* ${premier.suggestion}` : '',
    );
  }

  return lignes.filter((l) => l !== undefined).join('\n');
}

async function outilCorrectifs({ chemin, limite = 10 }) {
  const racine = resoudreChemin(chemin);
  const config = loadConfig(racine, { minSeverity: 'info', noHistory: true });

  const { files } = await walkProject(config);
  const contexte = new ProjectContext(config, files);
  const plan = planFixes(contexte);

  if (plan.length === 0) {
    return 'Aucune correction mecanique applicable sur ce projet.';
  }

  const montres = plan.slice(0, limite);
  const total = plan.reduce((somme, e) => somme + e.edits.length, 0);

  const lignes = [
    `${total} modification(s) possible(s) dans ${plan.length} fichier(s).`,
    '',
    "**Aucune n'a ete appliquee, et cet outil ne peut pas les appliquer.**",
    'La modification des fichiers passe par `argus fix` dans un terminal, ou',
    "l'utilisateur voit le differentiel et valide fichier par fichier.",
    '',
  ];

  for (const entree of montres) {
    const correctifs = entree.fixes.map((f) => f.fixer);
    const aVerifier = correctifs.filter((f) => f.risk?.id === 'a-verifier');

    lignes.push(
      `## ${entree.path}`,
      `Correctifs : ${correctifs.map((f) => f.label || f.id).join(', ')}`,
      aVerifier.length > 0
        ? `A verifier : ${aVerifier.map((f) => f.label || f.id).join(', ')} — ${aVerifier[0].risk.raison || 'le resultat depend du contexte'}`
        : '',
      '```diff',
      renderDiff(entree.before, entree.after),
      '```',
      '',
    );
  }

  if (plan.length > montres.length) {
    lignes.push(`${plan.length - montres.length} fichier(s) supplementaire(s) non affiches.`);
  }

  return lignes.filter(Boolean).join('\n');
}

async function outilRegle({ identifiant }) {
  const { SECURITY_RULES, CONFIG_SECURITY_RULES } = await import('../rules/security.js');
  const toutes = [...SECURITY_RULES, ...CONFIG_SECURITY_RULES];

  if (!identifiant) {
    const parPrefixe = new Map();
    for (const regle of toutes) {
      const prefixe = regle.id.split('-')[0];
      if (!parPrefixe.has(prefixe)) parPrefixe.set(prefixe, []);
      parPrefixe.get(prefixe).push(regle.id);
    }
    return [
      'Regles de securite disponibles (les autres categories sont documentees dans docs/regles.md) :',
      '',
      ...[...parPrefixe].map(([prefixe, ids]) => `**${prefixe}** : ${ids.join(', ')}`),
    ].join('\n');
  }

  const regle = toutes.find((r) => r.id.toLowerCase() === identifiant.toLowerCase());
  if (!regle) {
    return `Aucune regle « ${identifiant} ». Appelez l'outil sans identifiant pour obtenir la liste.`;
  }

  return [
    `# ${regle.id} — ${regle.title}`,
    '',
    `Gravite : ${regle.severity}`,
    regle.cwe ? `Classification : ${regle.cwe}${regle.owasp ? ` · ${regle.owasp}` : ''}` : '',
    '',
    regle.message,
    '',
    regle.suggestion ? `**Correction :** ${regle.suggestion}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const IMPLEMENTATIONS = {
  argus_scan: outilScan,
  argus_correctifs: outilCorrectifs,
  argus_regle: outilRegle,
};

/* ------------------------------------------------------------- protocole */

/**
 * Traite un message JSON-RPC et retourne la reponse, ou `null` pour une
 * notification (qui, par definition, n'en attend aucune).
 */
export async function traiterMessage(message) {
  const { id, method, params = {} } = message;
  const repondre = (result) => ({ jsonrpc: '2.0', id, result });
  const echouer = (code, msg) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });

  if (method === 'initialize') {
    const demandee = params.protocolVersion;
    return repondre({
      protocolVersion: VERSIONS_CONNUES.has(demandee) ? demandee : VERSION_PROTOCOLE_PAR_DEFAUT,
      capabilities: { tools: {} },
      serverInfo: { name: 'argus', version: '1.0.0' },
    });
  }

  // Les notifications n'ont pas d'identifiant et ne recoivent pas de reponse.
  if (method?.startsWith('notifications/') || id === undefined) return null;

  if (method === 'tools/list') return repondre({ tools: OUTILS });
  if (method === 'ping') return repondre({});

  if (method === 'tools/call') {
    const implementation = IMPLEMENTATIONS[params.name];
    if (!implementation) return echouer(-32602, `Outil inconnu : ${params.name}`);

    try {
      const texte = await implementation(params.arguments || {});
      return repondre({ content: [{ type: 'text', text: texte }] });
    } catch (erreur) {
      // Une erreur d'analyse est un resultat, pas une panne de protocole :
      // l'assistant doit pouvoir la lire et l'expliquer a l'utilisateur.
      return repondre({
        content: [{ type: 'text', text: `L'analyse a echoue : ${erreur.message}` }],
        isError: true,
      });
    }
  }

  return echouer(-32601, `Methode inconnue : ${method}`);
}

/**
 * Boucle stdio : un message JSON par ligne, dans les deux sens.
 *
 * Rien n'est ecrit sur la sortie standard en dehors des reponses — un seul
 * `console.log` egare corromprait le flux et rendrait le serveur muet pour
 * son client. Les diagnostics passent donc par la sortie d'erreur.
 */
export function demarrerServeurMcp({ entree = process.stdin, sortie = process.stdout } = {}) {
  let tampon = '';

  entree.setEncoding('utf8');
  entree.on('data', async (morceau) => {
    tampon += morceau;

    let saut;
    while ((saut = tampon.indexOf('\n')) !== -1) {
      const ligne = tampon.slice(0, saut).trim();
      tampon = tampon.slice(saut + 1);
      if (!ligne) continue;

      let message;
      try {
        message = JSON.parse(ligne);
      } catch {
        sortie.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } })}\n`,
        );
        continue;
      }

      try {
        const reponse = await traiterMessage(message);
        if (reponse) sortie.write(`${JSON.stringify(reponse)}\n`);
      } catch (erreur) {
        if (message.id !== undefined) {
          sortie.write(
            `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: erreur.message } })}\n`,
          );
        }
      }
    }
  });

  return new Promise((resolve) => entree.on('end', resolve));
}

export { OUTILS };
