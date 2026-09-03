/**
 * English catalogue.
 *
 * A missing key falls back to French rather than showing the key itself: a
 * message in the wrong language is still readable and still actionable, while
 * `resultat.scoreGlobal` on screen is neither.
 */
export const CATALOGUE_EN = {
  // ---------------------------------------------------------- categories
  'categorie.security': 'Security',
  'categorie.routes': 'Routes & links',
  'categorie.deadcode': 'Dead code',
  'categorie.seo': 'SEO',
  'categorie.design': 'Design & accessibility',
  'categorie.performance': 'Performance',
  'categorie.quality': 'Code quality',
  'categorie.dependencies': 'Dependencies',

  // ------------------------------------------------------------ severity
  'gravite.critical': 'Critical',
  'gravite.high': 'High',
  'gravite.medium': 'Medium',
  'gravite.low': 'Low',
  'gravite.info': 'Info',

  // -------------------------------------------------------------- effort
  'effort.rapide': 'quick',
  'effort.moyen': 'moderate',
  'effort.long': 'substantial',


  // ------------------------------------------- libelles de secrets
  'secret.aws-access-key': 'AWS access key',
  'secret.aws-secret': 'AWS secret',
  'secret.github-token': 'GitHub token',
  'secret.gitlab-token': 'GitLab token',
  'secret.slack-token': 'Slack token',
  'secret.stripe-key': 'Stripe key',
  'secret.google-api-key': 'Google API key',
  'secret.firebase-key': 'Firebase key',
  'secret.openai-key': 'OpenAI key',
  'secret.anthropic-key': 'Anthropic key',
  'secret.sendgrid-key': 'SendGrid key',
  'secret.twilio-sid': 'Twilio identifier',
  'secret.mailgun-key': 'Mailgun key',
  'secret.npm-token': 'npm token',
  'secret.private-key': 'Private key',
  'secret.jwt-token': 'Hard-coded JWT',
  'secret.db-url': 'Database URL with credentials',
  'secret.basic-auth-url': 'HTTP URL with credentials',

  // ------------------------------- findings whose title quotes a measured value
  'constat.secretExpose': 'Exposed secret: {libelle}',
  'constat.sansNomAccessible': '<{balise}> without an accessible name',
  'constat.cliquableNonAccessible': '<{balise}> clickable but not accessible',
  'constat.versionVulnerable': 'Potentially vulnerable version: {paquet}',

  // ---------------------------------------------------------- confidence
  'confiance.firm': 'confirmed',
  'confiance.tentative': 'worth checking',

  // -------------------------------------------------------- scan header
  'entete.titre': 'ARGUS',
  'entete.sousTitre': 'project analysis',
  'entete.fichiers': 'Files',
  'entete.fichiersDetail': '{analyses} analysed ({indexes} indexed, {ignores} skipped)',
  'entete.projet': 'Project',
  'entete.langages': 'Languages',
  'entete.detecte': 'Detected',
  'entete.duree': 'Duration',
  'entete.dapres': 'from {preuve}',
  'entete.plateformeImposee': 'platform set in configuration',

  // ----------------------------------------------------------- results
  'resultat.scoreGlobal': 'OVERALL SCORE',
  'resultat.problemes': '{nombre} findings',
  'resultat.aucunProbleme': 'No issues found.',
  'resultat.planDaction': 'ACTION PLAN',
  'resultat.parCategorie': 'By category',

  // --------------------------------------------------------- platforms
  'plateforme.web': 'web',
  'plateforme.mobile': 'mobile',
  'plateforme.desktop': 'desktop',
  'plateforme.application': '{cibles} application',

  // ---------------------------------------------------------- messages
  'message.aucunFichier': 'No analysable file in "{racine}".',
  'message.pasUnDepotGit': 'This folder is not a Git repository.',
  'message.cheminInexistant': 'The path "{chemin}" does not exist.',
  'message.referenceInconnue': 'The reference "{ref}" does not exist in this repository.',

  // ------------------------------------------------------------- leaks
  'fuites.titre': 'ARGUS LEAKS',
  'fuites.lecture': 'Reading history…',
  'fuites.commitsAnalyses': '{nombre} commits scanned.',
  'fuites.aucune': 'No secret found in the history.',
  'fuites.trouvees': '{nombre} secret(s) have lived in this repository.',
  'fuites.avertissement':
    'Removing a key from the code does not remove it from the history. It stays readable by anyone who clones the repository, today or in five years.',
  'fuites.encorePresente': 'still in the code',
  'fuites.retiree': 'removed from the code, still in the history',
  'fuites.donneeDeTest': 'test path — most likely test data',
  'fuites.revoquer': 'Revoke at {service}',
  'fuites.ordre': 'In this order:',

  // -------------------------------------------------------------- perf
  'perf.titre': 'ARGUS PERF',
  'perf.profilMobile': 'mobile profile',
  'perf.profilBureau': 'desktop profile',
  'perf.chargement': 'Loading…',
  'perf.premierOctet': 'Time to first byte',
  'perf.premierePeinture': 'First contentful paint',
  'perf.plusGrandElement': 'Largest contentful paint',
  'perf.stabilite': 'Layout stability (CLS)',
  'perf.poidsTotal': 'Total weight',
  'perf.bon': 'good',
  'perf.aAmeliorer': 'needs work',
  'perf.mauvais': 'poor',
  'perf.aucunProbleme': 'No loading problem measured.',
  'perf.sansNavigateur': 'No Chrome or Chromium browser found.',
};
