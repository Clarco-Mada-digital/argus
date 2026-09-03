import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Interpolation non echappee a l'interieur d'une balise `<script>`.
 *
 * Signale depuis le terrain, ou c'etait une faille reelle qu'Argus n'avait
 * pas vue :
 *
 *     <script>window.gpSons = {{ preferences_json|safe }};</script>
 *
 * Le raisonnement habituel — « c'est du JSON valide, donc c'est sur » — est
 * faux, et le piege est peu connu. L'analyseur HTML ne connait pas le JSON :
 * il cherche la premiere occurrence de `</script`, ou qu'elle soit. Une
 * valeur contenant cette chaine ferme donc la balise, et tout ce qui suit
 * redevient du HTML — puis du code. Chez l'equipe qui l'a signale, la valeur
 * contenait un nom de fichier televerse par l'utilisateur.
 *
 * `json_script` de Django existe exactement pour cela ; il echappe `<`, `>`
 * et `&`, ce qui rend la sequence impossible a produire.
 */

/** Ouvertures de balise script, avec leur position de fin de balise. */
function zonesDeScript(contenu) {
  const zones = [];
  for (const ouverture of matches(contenu, /<script\b([^>]*)>/gi)) {
    const attributs = ouverture[1] || '';
    // Un script de donnees (`type="application/json"`) n'est pas execute :
    // le contenu y est lu par `JSON.parse`, jamais evalue. Le piege de la
    // fermeture demeure, mais la consequence est bien moindre.
    const executable = !/type\s*=\s*["'](?:application\/(?:json|ld\+json)|text\/template)/i.test(attributs);
    const debut = ouverture.index + ouverture[0].length;
    const fin = contenu.toLowerCase().indexOf('</script', debut);
    zones.push({ debut, fin: fin === -1 ? contenu.length : fin, executable });
  }
  return zones;
}

/**
 * Interpolations de gabarit qui contournent l'echappement.
 * Django et Jinja (`|safe`), Twig (`|raw`), ERB (`<%==`, `.html_safe`),
 * Liquid, et l'appel direct a `mark_safe` dans une variable rendue.
 */
const NON_ECHAPPE = [
  // argus-ignore SEC-TEMPLATE-AUTOESCAPE : ce sont les motifs que la regle
  // detecte, pas un echappement desactive dans un gabarit.
  { motif: /\{\{[^}]*\|\s*safe\s*\}\}/g, forme: '|safe' },
  { motif: /\{\{[^}]*\|\s*raw\s*\}\}/g, forme: '|raw' },
  { motif: /\{%\s*autoescape\s+off\s*%\}/g, forme: 'autoescape off' },
  { motif: /<%==[^%]*%>/g, forme: '<%==' },
  { motif: /<%=[^%]*\.html_safe[^%]*%>/g, forme: 'html_safe' },
  { motif: /\{\{[^}]*\|\s*json_encode[^}]*\}\}/g, forme: '|json_encode' },
];

export default {
  id: 'json-dans-script',
  label: 'Donnees dans une balise script',
  // Concerne tout gabarit serveur, quel que soit le moteur.
  appliesTo: (context) =>
    context.has('django', 'flask', 'fastapi', 'laravel', 'symfony', 'rails', 'spring', 'express', 'nestjs') ||
    context.cible('web'),

  run(context, report) {
    for (const file of context.sources({ families: ['markup'] })) {
      if (file.isGenerated) continue;
      const contenu = file.content;
      if (!/<script/i.test(contenu)) continue;

      const zones = zonesDeScript(contenu);
      if (zones.length === 0) continue;
      const index = lineIndexFor(file);

      for (const { motif, forme } of NON_ECHAPPE) {
        for (const m of matches(contenu, motif)) {
          const zone = zones.find((z) => m.index >= z.debut && m.index < z.fin);
          if (!zone) continue;

          const position = index.position(m.index);
          report({
            ruleId: 'SEC-DONNEES-DANS-SCRIPT',
            severity: zone.executable ? 'high' : 'medium',
            category: 'security',
            title: `Interpolation non echappee dans une balise <script> (${forme})`,
            message:
              `Une valeur est inseree telle quelle dans un <script> via ${forme}. ` +
              "Un JSON valide n'est pas sur a cet endroit : l'analyseur HTML cherche la " +
              'premiere occurrence de « </script », ou qu\'elle soit. Une valeur qui la ' +
              'contient ferme la balise, et la suite redevient du HTML puis du code — ' +
              (zone.executable
                ? 'execute avec les droits de la page.'
                : 'meme dans un script de donnees, la balise se ferme au mauvais endroit.'),
            file: file.relativePath,
            line: position.line,
            column: position.column,
            snippet: index.textOfLine(position.line).trim(),
            suggestion:
              'Avec Django, utilisez `{{ valeur|json_script:"identifiant" }}` puis lisez-la ' +
              'par `JSON.parse(document.getElementById("identifiant").textContent)`. ' +
              'Ailleurs, echappez au minimum `<`, `>` et `&` avant l\'insertion.',
            confidence: 'firm',
            effort: 'rapide',
            tags: ['CWE-79', 'A03:2021'],
            docs: 'https://docs.djangoproject.com/en/stable/ref/templates/builtins/#json-script',
          });
        }
      }
    }
  },
};
