# Rester à jour

Un analyseur statique se périme de trois façons distinctes, et une seule se corrige toute seule. Ce document dit laquelle, et quoi faire pour les deux autres.

## 1. Les vulnérabilités — automatisable

C'est la seule partie qui se met à jour sans intervention humaine, parce que la donnée est publique et structurée : [OSV.dev](https://osv.dev) agrège GitHub Advisories, les CVE, PyPA, RustSec, Go, Maven, et les publie sous un schéma stable.

```bash
argus sync     # une requête réseau, puis tout redevient hors ligne
```

Le cache est écrit dans `.argus/osv-cache.json` et porte sa date de génération.

### Le vrai danger n'est pas le cache périmé

C'est la **fausse assurance**. Une analyse qui ne remonte rien ressemble à un projet sain — qu'elle ait consulté une base d'hier ou d'il y a six mois. Argus gradue donc le constat selon l'âge :

| Âge du cache | Gravité de `DEP-CACHE-STALE` |
|---|---|
| < 30 jours | `info` |
| 30 – 90 jours | `low` |
| 90 – 180 jours | `medium` |
| ≥ 180 jours | `high` |

À six mois, le message le dit franchement : la couverture est périmée et l'absence de constat ne prouve plus rien.

### Automatiser la veille

Un projet peut devenir vulnérable **sans qu'aucun commit ne soit poussé** : il suffit qu'un avis soit publié sur une dépendance qui n'a pas bougé. C'est le seul cas que l'intégration continue classique ne voit jamais, puisqu'elle ne se déclenche qu'au push.

`.github/workflows/veille.yml` couvre ce cas : rafraîchissement hebdomadaire, et ouverture d'une alerte **uniquement s'il y a quelque chose à dire**. Un ticket hebdomadaire « rien à signaler » finit par ne plus être lu, et c'est ainsi qu'on rate celui qui comptait.

Pour l'utiliser sur votre projet, copiez le fichier et ajustez le `cron`.

## 2. Les règles de framework — travail humain, mais signalé

Un nouveau framework, une API dépréciée, une valeur par défaut inversée : rien de tout cela n'est publié dans un format exploitable. Ça demande de lire les notes de version et d'écrire une règle.

Ce qui **peut** être automatisé, c'est de savoir qu'on ne sait pas. Voir la section « Angles morts » ci-dessous.

La méthode d'ajout d'une règle est décrite dans [CONTRIBUTING.md](../CONTRIBUTING.md), et elle n'est pas négociable : **une règle n'est jamais livrée sans avoir été mesurée sur un projet réaliste**, faux positifs compris, avant et après.

## 3. Les conventions du web — lent, mais réel

Les seuils de performance, les critères d'accessibilité, la disponibilité des fonctionnalités navigateur bougent d'année en année. C'est le rythme le plus lent des trois ; une revue annuelle suffit.

## Angles morts : savoir qu'on ne sait pas

Le silence d'un analyseur est ambigu. « Aucun problème dans votre code Svelte » peut vouloir dire *« votre code est propre »* ou *« je n'ai aucune règle pour Svelte »*. Les deux s'affichent pareil, et c'est une faiblesse de conception, pas un détail d'affichage.

Argus liste les frameworks détectés dans l'en-tête du rapport. Un écosystème présent dans vos dépendances mais absent de cette liste signifie qu'il n'a pas de pack dédié — l'analyse générique s'applique quand même (secrets, injections, code mort, qualité), mais pas les pièges propres à cet outil.

Les 20 packs actuels sont listés dans [regles.md](regles.md).
