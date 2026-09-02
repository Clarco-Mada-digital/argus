/**
 * Catalogue francais : la version de reference.
 *
 * Les messages ont ete ecrits ici, pas traduits. C'est ce qui explique le
 * sens de la traduction : l'anglais est un calque pose par-dessus, et non
 * l'inverse.
 */
export const CATALOGUE_FR = {
  // ----------------------------------------------------------- categories
  'categorie.security': 'Securite',
  'categorie.routes': 'Routes & liens',
  'categorie.deadcode': 'Code mort',
  'categorie.seo': 'SEO',
  'categorie.design': 'Design & accessibilite',
  'categorie.performance': 'Performance',
  'categorie.quality': 'Qualite du code',
  'categorie.dependencies': 'Dependances',

  // ------------------------------------------------------------- gravites
  'gravite.critical': 'Critique',
  'gravite.high': 'Eleve',
  'gravite.medium': 'Moyen',
  'gravite.low': 'Faible',
  'gravite.info': 'Info',

  // --------------------------------------------------------------- effort
  'effort.rapide': 'rapide',
  'effort.moyen': 'moyen',
  'effort.long': 'long',

  // ------------------------------------------------------------ confiance
  'confiance.firm': 'certain',
  'confiance.tentative': 'a verifier',

  // ------------------------------------------------------- en-tete du scan
  'entete.titre': 'ARGUS',
  'entete.sousTitre': 'analyse de projet',
  'entete.fichiers': 'Fichiers',
  'entete.fichiersDetail': '{analyses} analyses ({indexes} indexes, {ignores} ignores)',
  'entete.projet': 'Projet',
  'entete.langages': 'Langages',
  'entete.detecte': 'Detecte',
  'entete.duree': 'Duree',
  'entete.dapres': "d'apres {preuve}",
  'entete.plateformeImposee': 'plateforme imposee par la configuration',

  // ------------------------------------------------------------ resultats
  'resultat.scoreGlobal': 'SCORE GLOBAL',
  'resultat.problemes': '{nombre} problemes',
  'resultat.aucunProbleme': 'Aucun probleme detecte.',
  'resultat.planDaction': "PLAN D'ACTION",
  'resultat.parCategorie': 'Par categorie',

  // -------------------------------------------------------- plateformes
  'plateforme.web': 'web',
  'plateforme.mobile': 'mobile',
  'plateforme.desktop': 'bureau',
  'plateforme.application': 'application {cibles}',

  // ------------------------------------------------------------- messages
  'message.aucunFichier': 'Aucun fichier analysable dans « {racine} ».',
  'message.pasUnDepotGit': "Ce dossier n'est pas un depot Git.",
  'message.cheminInexistant': "Le chemin « {chemin} » n'existe pas.",
  'message.referenceInconnue': "La reference « {ref} » n'existe pas dans ce depot.",

  // ---------------------------------------------------------------- fuites
  'fuites.titre': 'ARGUS FUITES',
  'fuites.lecture': "Lecture de l'historique…",
  'fuites.commitsAnalyses': '{nombre} commits analyses.',
  'fuites.aucune': "Aucun secret trouve dans l'historique.",
  'fuites.trouvees': '{nombre} secret(s) ont vecu dans ce depot.',
  'fuites.avertissement':
    "Retirer une clef du code ne la retire pas de l'historique. Elle reste lisible par quiconque clone le depot, aujourd'hui ou dans cinq ans.",
  'fuites.encorePresente': 'encore dans le code',
  'fuites.retiree': "retiree du code, toujours dans l'historique",
  'fuites.donneeDeTest': 'chemin de test — probablement une donnee de test',
  'fuites.revoquer': 'Revoquez sur {service}',
  'fuites.ordre': 'Dans cet ordre :',

  // ------------------------------------------------------------------ perf
  'perf.titre': 'ARGUS PERF',
  'perf.profilMobile': 'profil mobile',
  'perf.profilBureau': 'profil bureau',
  'perf.chargement': 'Chargement en cours…',
  'perf.premierOctet': 'Premier octet',
  'perf.premierePeinture': 'Premiere peinture',
  'perf.plusGrandElement': 'Plus grand element',
  'perf.stabilite': 'Stabilite (CLS)',
  'perf.poidsTotal': 'Poids total',
  'perf.bon': 'bon',
  'perf.aAmeliorer': 'a ameliorer',
  'perf.mauvais': 'mauvais',
  'perf.aucunProbleme': 'Aucun probleme de chargement mesure.',
  'perf.sansNavigateur': 'Aucun navigateur Chrome ou Chromium trouve.',
};
