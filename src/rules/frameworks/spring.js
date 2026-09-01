import { lineIndexFor, matches } from '../../core/scan.js';

/**
 * Pack de regles Spring Boot.
 *
 * Spring expose beaucoup de puissance par configuration : un `=*` dans un
 * fichier .properties peut ouvrir la memoire du processus au monde entier.
 * Ce pack vise donc surtout la configuration, la ou une ligne anodine a des
 * consequences disproportionnees.
 */
export default {
  id: 'spring',
  label: 'Spring Boot',
  appliesTo: (context) => context.has('spring'),

  run(context, report) {
    const proprietes = context.files.filter(
      (f) => f.readable && /application[\w.-]*\.(properties|ya?ml)$/i.test(f.name),
    );
    const java = context.sources({ families: ['jvm'] });

    verifierActuator(proprietes, report);
    verifierConsoleH2(proprietes, report);
    verifierJournalisationSql(proprietes, report);
    verifierAutorisations(java, report);
  },
};

/**
 * Actuator expose /env, /heapdump, /threaddump et parfois /shutdown.
 * Un heapdump contient en clair tous les secrets charges en memoire.
 */
function verifierActuator(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /management\.endpoints\.web\.exposure\.include\s*[:=]\s*(.+)/g)) {
      const valeur = match[1].trim().replace(/["']/g, '');
      const tout = valeur === '*' || valeur.split(',').map((v) => v.trim()).includes('*');
      const sensibles = ['env', 'heapdump', 'threaddump', 'shutdown', 'configprops', 'beans']
        .filter((e) => tout || valeur.includes(e));
      if (sensibles.length === 0) continue;

      report({
        ruleId: 'SPRING-ACTUATOR-EXPOSED',
        category: 'security',
        severity: tout ? 'critical' : 'high',
        title: tout ? 'Tous les endpoints Actuator sont exposes' : 'Endpoint Actuator sensible expose',
        message: tout
          ? '`include=*` publie notamment /actuator/env et /actuator/heapdump. Un heapdump contient en clair tous les secrets charges en memoire — mots de passe de base, jetons, clefs.'
          : `Les endpoints ${sensibles.join(', ')} sont accessibles et divulguent la configuration interne.`,
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0].trim(),
        suggestion:
          'N\'exposez que ce qui est necessaire : management.endpoints.web.exposure.include=health,info. Placez le reste derriere une authentification, ou sur un port separe non publie.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-200', 'A05:2021', 'spring'],
        docs: 'https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.endpoints.exposing',
      });
    }
  }
}

/** La console H2 permet d'executer du SQL arbitraire depuis un navigateur. */
function verifierConsoleH2(fichiers, report) {
  for (const file of fichiers) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /spring\.h2\.console\.enabled\s*[:=]\s*true/g)) {
      report({
        ruleId: 'SPRING-H2-CONSOLE',
        category: 'security',
        severity: 'critical',
        title: 'Console H2 activee',
        message:
          'La console H2 est une interface web d\'execution SQL. Accessible en production, elle permet de lire et modifier toute la base — et, selon la configuration, d\'executer du code sur le serveur.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0].trim(),
        suggestion:
          'Retirez cette ligne, ou reservez-la au profil de developpement en la placant dans application-dev.properties.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['CWE-489', 'spring'],
      });
    }
  }
}

/** Les requetes journalisees contiennent les valeurs, donc parfois des donnees personnelles. */
function verifierJournalisationSql(fichiers, report) {
  for (const file of fichiers) {
    if (/-(dev|test|local)\./i.test(file.name)) continue;
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /spring\.jpa\.show-sql\s*[:=]\s*true/g)) {
      report({
        ruleId: 'SPRING-SHOW-SQL',
        category: 'performance',
        severity: 'low',
        title: 'Journalisation SQL activee',
        message:
          'show-sql ecrit chaque requete sur la sortie standard : volume de journaux considerable en production, et les parametres journalises peuvent contenir des donnees personnelles.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: match[0].trim(),
        suggestion: 'Reservez ce reglage au profil de developpement.',
        effort: 'rapide',
        confidence: 'certain',
        tags: ['spring'],
      });
    }
  }
}

/** `permitAll()` sur toutes les requetes annule la chaine de securite. */
function verifierAutorisations(java, report) {
  for (const file of java) {
    const index = lineIndexFor(file);
    for (const match of matches(file.content, /anyRequest\s*\(\s*\)\s*\.\s*permitAll\s*\(/g)) {
      report({
        ruleId: 'SPRING-PERMIT-ALL',
        category: 'security',
        severity: 'high',
        title: 'Toutes les requetes sont autorisees',
        message:
          'anyRequest().permitAll() rend l\'integralite de l\'application publique. Toute route ajoutee ensuite — y compris d\'administration — sera accessible sans authentification.',
        file: file.relativePath,
        line: index.lineOf(match.index),
        snippet: index.textOfLine(index.lineOf(match.index)).trim(),
        suggestion:
          'Inversez la regle : autorisez explicitement le public, puis fermez le reste.\n  .requestMatchers("/", "/public/**").permitAll()\n  .anyRequest().authenticated()',
        effort: 'moyen',
        confidence: 'certain',
        tags: ['CWE-284', 'A01:2021', 'spring'],
      });
    }
  }
}
