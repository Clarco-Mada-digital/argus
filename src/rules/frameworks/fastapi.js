import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack FastAPI.
 *
 * Deux pieges recurrents : une configuration CORS copiee d'un tutoriel qui
 * combine deux options incompatibles, et des endpoints qui renvoient
 * directement un modele de base — donc tous ses champs.
 */
export default {
  id: 'fastapi',
  label: 'FastAPI',
  appliesTo: (context) => context.has('fastapi'),

  run(context, report) {
    for (const file of context.sources({ languages: ['python'] })) {
      const index = lineIndexFor(file);
      const contenu = file.content;

      // --- CORS : le couple interdit par la specification.
      const cors = /add_middleware\s*\(\s*CORSMiddleware[\s\S]{0,400}?\)/.exec(contenu);
      if (cors) {
        const toutesOrigines = /allow_origins\s*=\s*\[\s*["']\*["']/.test(cors[0]);
        const avecIdentifiants = /allow_credentials\s*=\s*True/.test(cors[0]);

        if (toutesOrigines && avecIdentifiants) {
          report({
            ruleId: 'FASTAPI-CORS-CREDENTIALS',
            category: 'security',
            severity: 'critical',
            title: 'CORS ouvert combine aux identifiants',
            message:
              'allow_origins=["*"] avec allow_credentials=True : la specification interdit cette combinaison, et les navigateurs la rejettent. Selon la version de Starlette, l\'origine de la requete est renvoyee telle quelle — n\'importe quel site peut alors appeler votre API avec les cookies de vos utilisateurs.',
            file: file.relativePath,
            line: index.lineOf(cors.index),
            snippet: index.textOfLine(index.lineOf(cors.index)).trim(),
            suggestion:
              'Listez explicitement les origines de confiance : allow_origins=["https://app.exemple.com"]. Le joker n\'est acceptable que sans identifiants.',
            effort: 'rapide',
            confidence: 'certain',
            tags: ['CWE-942', 'A05:2021', 'fastapi'],
          });
        }
      }

      // --- Endpoint sans modele de reponse : tous les champs partent.
      for (const match of matches(contenu, /@\w+\.(get|post|put|patch|delete)\s*\(\s*["'][^"']*["']([^)]*)\)/g)) {
        if (/response_model\s*=/.test(match[2])) continue;
        // La fenetre s'arrete au decorateur suivant : sans cela, le corps de la
        // fonction d'apres serait attribue a celle-ci.
        const reste = contenu.slice(match.index + match[0].length);
        const prochain = reste.search(/\n@\w+\.(?:get|post|put|patch|delete)\s*\(/);
        const corps = prochain === -1 ? reste.slice(0, 600) : reste.slice(0, prochain);
        // On ne signale que si la fonction renvoie manifestement un objet de base.
        if (!/\breturn\s+(?:await\s+)?(?:db|session|crud|repo)\b|\.first\(\)|\.all\(\)|\.get\(/.test(corps)) continue;

        report({
          ruleId: 'FASTAPI-NO-RESPONSE-MODEL',
          category: 'security',
          severity: 'medium',
          title: 'Endpoint sans response_model',
          message:
            'Sans response_model, FastAPI serialise l\'objet tel quel : tous les champs du modele partent dans la reponse, y compris ceux ajoutes plus tard — mot de passe hache, jeton de reinitialisation, notes internes.',
          file: file.relativePath,
          line: index.lineOf(match.index),
          snippet: index.textOfLine(index.lineOf(match.index)).trim(),
          suggestion:
            'Declarez un schema de sortie explicite : @app.get("/...", response_model=UtilisateurPublic). Le contrat devient alors verifie, et un nouveau champ n\'est plus expose par accident.',
          effort: 'moyen',
          confidence: 'tentative',
          tags: ['CWE-213', 'fastapi'],
          docs: 'https://fastapi.tiangolo.com/tutorial/response-model/',
        });
      }
    }
  },
};
