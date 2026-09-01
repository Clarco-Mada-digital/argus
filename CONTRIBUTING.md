# Contribuer à Argus

## Avant tout

```bash
npm run check    # linter + 151 tests
```

Aucune dépendance n'est installée : Node.js 18+ suffit.

## La règle qui compte

**Une règle ne se livre pas sans avoir été mesurée sur un projet réel.**

Le dépôt contient six projets de démonstration dans `tests/fixtures/` — un site
statique défectueux, un polyglotte, et un projet par framework (Django, Laravel,
Rails, Spring). Chacun a été construit pour rendre visibles à la fois ce que la
règle doit trouver **et** ce qu'elle ne doit pas signaler.

La procédure suivie pour chaque pack livré jusqu'ici :

1. Construire une fixture réaliste, avec des défauts que vous avez vraiment
   rencontrés en production.
2. Lancer Argus dessus **avant** d'écrire la moindre règle, et noter ce qui est
   manqué et ce qui est faux.
3. Écrire la règle, puis remesurer les deux chiffres.
4. Verrouiller par un test — y compris un test qui vérifie l'**absence** de bruit.

Une règle qui produit du bruit coûte plus cher qu'elle ne rapporte : elle apprend
aux utilisateurs à ignorer l'outil.

## Un piège déjà rencontré

Le `.gitignore` du projet exclut `*.key` — une bonne pratique. Elle a silencieusement
exclu une fixture Rails nommée `config/master.key` : les tests passaient en local,
et échouaient sur un clone frais.

`npm run lint` vérifie désormais qu'aucun fichier de `tests/` n'est exclu de Git.
Si votre scénario a besoin d'un fichier que le `.gitignore` doit légitimement
exclure, **construisez-le à l'exécution** dans un dossier temporaire plutôt que
d'ajouter une exception.

## Ajouter une règle

- **Motif simple, multi-langages** → `src/rules/security.js`
- **Spécifique à un framework** → `src/rules/frameworks/<nom>.js`, référencé dans
  son `index.js`
- **Nouvelle dimension d'analyse** → un module dans `src/analyzers/`

Tout constat doit porter un `message` (ce qui ne va pas) **et** une `suggestion`
(quoi faire, concrètement). C'est vérifié par les tests.

## Ajouter un langage

1. L'extension dans `src/core/languages.js`
2. Si nécessaire, des motifs de déclaration dans `src/lang/symbols.js`
3. Si le langage a des routes, un extracteur dans `src/lang/routes.js`

## Style

Français dans les messages destinés à l'utilisateur et dans les commentaires.
Les commentaires expliquent **pourquoi**, jamais **quoi**.
