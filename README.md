# Argus

**Analyse complète d'un projet en une commande : sécurité, SEO, routes mortes, code mort, design et accessibilité, performance, qualité, dépendances.**

Argus lit votre code source, en dresse le diagnostic, note chaque dimension sur 100, puis vous donne un plan d'action classé par impact — avec, pour chaque problème, ce qu'il faut faire concrètement.

- **Zéro dépendance.** Node.js seul suffit. Rien à installer, rien à compiler.
- **Hors ligne par défaut.** Deux commandes explicites peuvent sortir sur le réseau (`sync` et `crawl`) ; l'analyse, elle, ne transmet jamais votre code.
- **Multi-langages.** JavaScript, TypeScript, Python, Java, Kotlin, Dart/Flutter, PHP, Go, Ruby, C#, Rust, HTML, CSS/SCSS.
- **Rapport HTML autonome.** Un seul fichier, partageable, filtrable, en thème clair et sombre.

---

## Trois façons de l'utiliser

### 1. Sans rien installer — `npx`

```bash
npx github:Clarco-Mada-digital/argus scan ./mon-projet
```

Node.js 18 ou plus récent, rien d'autre. Aucun clone, aucune installation. C'est la voie complète : rapports SARIF, mode différentiel, correctifs assistés, exploration HTTP.

### 2. Dans le navigateur — sans ligne de commande

**[clarco-mada-digital.github.io/argus/analyser.html](https://clarco-mada-digital.github.io/argus/analyser.html)**

> **Activation de GitHub Pages — une seule fois.** Créer un site Pages exige une
> permission d'administration que le jeton d'un workflow ne peut pas recevoir :
> l'étape ne peut donc pas être automatisée. Dans **Settings → Pages**, choisissez
> **Source : GitHub Actions**, puis relancez le workflow. Le site se publie ensuite
> à chaque `push` sur `main`.
>
> En attendant, la page fonctionne aussi en local : `git clone`, puis servez le
> dossier `site/` (`npx serve site` ou tout serveur statique) — l'analyse tourne
> entièrement dans votre navigateur.

Choisissez un dossier de votre ordinateur : Argus l'analyse dans l'onglet et affiche le rapport. **Vos fichiers ne quittent pas votre machine** — la page n'a pas de serveur, vous pouvez couper votre connexion avant de lancer l'analyse.

Ce n'est pas un portage : c'est le même cœur, avec `node:fs`, `node:path` et `node:crypto` redirigés vers des shims par une carte d'imports. Les empreintes SHA-1 sont identiques à celles de la ligne de commande, donc une baseline reste interchangeable.

Le sélecteur de dossier demande un navigateur Chromium (Chrome, Edge, Opera). Ailleurs, un champ de fichiers classique prend le relais. Les fonctions liées à Git — mode différentiel, historique par commit — ne sont pas disponibles et se dégradent proprement.

### 3. Dans votre intégration continue

```yaml
- uses: Clarco-Mada-digital/argus@main
  with:
    since: origin/${{ github.base_ref }}   # ne juger que ce que la PR ajoute
    fail-on: medium
```

L'action publie les annotations directement dans la diff et expose `score` et `findings` en sorties.

### 4. Depuis les sources

```bash
git clone https://github.com/Clarco-Mada-digital/argus.git
cd argus
npm run check    # linter + 191 tests, sans rien installer

# Analyse du dossier courant
node bin/argus.js

# Rapport HTML complet, ouvert dans le navigateur
node bin/argus.js scan ./mon-site --html rapport.html --open

# Tableau de bord interactif
node bin/argus.js serve ./mon-site
```

```bash
# Vraies vulnérabilités des dépendances (une requête réseau, puis hors ligne)
node bin/argus.js sync && node bin/argus.js scan --only dependances

# Corrections proposées — rien n'est modifié sans votre accord
node bin/argus.js fix --dry-run

# Audit du site réellement en ligne
node bin/argus.js crawl https://mon-site.tld
```

Pour disposer de la commande `argus` partout :

```bash
npm link          # depuis ce dossier
argus scan ./mon-site
```

> Toute la suite de ce document utilise `argus …` par commodité. Remplacez par
> `npx github:Clarco-Mada-digital/argus …` ou `node bin/argus.js …` selon votre
> mode d'utilisation.

---

## Ce qu'Argus détecte

### Sécurité

Plus de 40 règles, appliquées à tous les langages détectés.

| Famille | Exemples |
|---|---|
| **Secrets exposés** | Clés AWS, GitHub, Stripe, OpenAI, Anthropic, Slack, Twilio, jetons JWT, clés privées, URL de base de données avec mot de passe. Détection par signature de fournisseur **et** par entropie, avec filtrage des valeurs d'exemple. |
| **Injections** | SQL par concaténation, commandes système, NoSQL `$where`, `eval`, `new Function`, templates non échappés. |
| **XSS** | `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, `document.write`, `\|safe`, `mark_safe`. |
| **Désérialisation** | `pickle.loads`, `yaml.load`, `ObjectInputStream.readObject`, `unserialize` PHP. |
| **Cryptographie** | MD5/SHA-1, DES/RC4, mode ECB, aléatoire non cryptographique, TLS désactivé. |
| **Authentification** | JWT sans vérification de signature, CORS ouvert, CSRF désactivé, cookies sans `httpOnly`/`secure`. |
| **Accès** | Traversée de répertoire, SSRF, redirection ouverte, affectation de masse. |
| **Configuration** | Mode debug en production, `.env` versionné, conteneur en root, en-têtes de sécurité absents, image Docker non épinglée. |

Chaque résultat porte sa référence **CWE** et sa catégorie **OWASP Top 10**.

### Routes et navigation

Argus extrait les routes déclarées, puis les confronte aux liens réellement présents dans le code.

- **Extraction** : Express, Fastify, Koa, NestJS, React Router, Vue Router, Angular, Next.js (Pages *et* App Router), Nuxt, SvelteKit, Astro, Remix, Flask, FastAPI, Django, Spring, Laravel, Symfony, Rails, Go, Flutter (`go_router` et routes nommées), pages HTML statiques.
- **Liens morts** : un `href`, un `router.push`, un `redirect` qui ne correspond à aucune route ni à aucun fichier.
- **Ressources introuvables** : `src` d'image, feuille de style ou script absent du projet.
- **Routes orphelines** : une page atteignable par aucun lien interne ni par le sitemap — invisible pour les visiteurs comme pour Google.
- **Doublons** : deux déclarations de la même route dans le même routeur ; seule la première s'applique, l'autre est morte.
- **Hygiène d'URL** : majuscules, doubles barres, underscores, profondeur excessive, absence de page 404, `target="_blank"` sans `rel="noopener"`.

### Code mort

- Fichiers jamais importés (avec graphe d'imports, résolution des alias `@/` et `~/`, et détection des points d'entrée par convention).
- Exports jamais consommés ailleurs dans le projet — les symboles décorés (`@app.route`, `@GetMapping`, `@Component`) sont reconnus comme appelés par leur framework.
- Imports et déclarations locales inutilisés — les variables seulement interpolées dans un gabarit restent considérées comme vivantes.
- Code inatteignable après un `return` / `throw` / `raise`.
- Blocs de code laissés en commentaire.
- Restes de débogage : `debugger`, `console.log`, `var_dump`, `pdb.set_trace`, `printStackTrace`.
- Ressources (images, polices, feuilles de style) jamais référencées.

### SEO

- **Balises essentielles** : `title` (longueur, unicité, doublons entre pages), `meta description`, `charset`, `viewport`, `lang`, canonical, `noindex` involontaire, favicon.
- **Structure** : présence et unicité du `h1`, continuité de la hiérarchie des titres, volume de contenu, textes de liens non descriptifs.
- **Images** : `alt`, dimensions (décalage de mise en page), pilotage du chargement.
- **Partage social** : Open Graph et Twitter Card complets.
- **Données structurées** : présence, validité JSON, `@context`/`@type`.
- **Fichiers de crawl** : `robots.txt` (dont le redoutable `Disallow: /` oublié après une recette), `sitemap.xml`, manifeste web.
- **Applications à rendu client** : détection des SPA sans rendu serveur et des routes partageant les mêmes métadonnées.

### Design et accessibilité

- **Contraste WCAG** calculé sur les couleurs réelles du CSS, avec **une couleur de remplacement concrète proposée** et son ratio.
- **Accessibilité** : boutons et liens sans nom accessible, champs sans étiquette, `div` cliquables, `tabindex` positif, `iframe` sans titre, tableaux sans en-têtes, focus supprimé, repère `<main>`, lien d'évitement, `prefers-reduced-motion`.
- **Responsive** : absence de points de rupture, largeurs fixes supérieures aux écrans mobiles, zoom désactivé.
- **Système de design** : dispersion de la palette (avec vos couleurs dominantes), échelle typographique, grille d'espacement, absence de tokens, excès de `!important`, empilement `z-index` incontrôlé, absence de thème sombre.

### Performance

Images et ressources trop lourdes (avec le temps de chargement estimé en 3G), SVG non optimisés, scripts bloquants dans le `<head>`, `font-display` manquant, absence de `preconnect`, `await` dans une boucle, requêtes N+1, entrées/sorties synchrones, `SELECT *`, dépendances lourdes.

### Frameworks : règles dédiées

Certaines vérifications n'ont de sens que pour un framework donné, et demandent de croiser plusieurs fichiers. Elles sont regroupées en **packs** activés automatiquement.

**Treize packs** sont livrés, chacun validé contre un projet réaliste construit pour l'occasion, avec les faux positifs mesurés avant livraison.

### Le piège commun à tous les outils de construction

```
NEXT_PUBLIC_STRIPE_SECRET_KEY   VITE_API_TOKEN   PUBLIC_ADMIN_KEY
NUXT_PUBLIC_...   REACT_APP_...   GATSBY_...   EXPO_PUBLIC_...   VUE_APP_...
```

Ces préfixes ne sont **pas des espaces de noms : ce sont des publications**. La valeur est inlinée dans le bundle et devient lisible via « afficher le code source ». Une seule règle — `ENV-PUBLIC-SECRET` — couvre les huit écosystèmes, y compris ceux sans pack dédié. Les faux amis (`PUBLIC_KEY`, `PUBLISHABLE`, `ANON_KEY`, `_URL`) sont écartés.

### Front et rendu

| Framework | Ce qu'il attrape en propre |
|---|---|
| **React** | Jeton rangé dans `localStorage` — une faille XSS suffit à voler la session. Liste sans `key`. `href` construit depuis une valeur externe. |
| **Next.js** | `ignoreBuildErrors`, `images.domains: ['*']`, route d'API traitant GET comme POST, en-têtes absents. |
| **Nuxt** | Secret sous `runtimeConfig.public` — sérialisé vers le navigateur. `ssr: false` qui vide vos pages pour les robots. DevTools actif. |
| **Astro** | `set:html` (XSS), `client:only` qui saute le rendu serveur, secret injecté par `vite.define`. |
| **SvelteKit** | **Le retour de `load()` part dans le navigateur**, malgré le nom `.server`. `{@html}`. |
| **Angular** | `bypassSecurityTrustHtml` — le seul moyen de désactiver l'assainissement. Liaison `[innerHTML]`. |

### Serveur

| Framework | Ce qu'il attrape en propre |
|---|---|
| **Django** | `SECRET_KEY` en dur, formulaire sans `{% csrf_token %}`, `{% url %}` vers une route inexistante, N+1 de l'ORM. |
| **Flask** | Clé de session en dur, **aucune protection CSRF** (Flask n'en fournit pas), `send_file` depuis la requête. |
| **FastAPI** | `allow_origins=["*"]` **avec** `allow_credentials=True` — combinaison interdite par la spécification. `response_model` absent. |
| **Laravel** | `env()` hors de `config/` — renvoie `null` après `config:cache`, silencieusement. `$guarded = []`. |
| **Rails** | `config/master.key` versionné, interpolation dans un `where()`, `params.permit!`. |
| **Spring Boot** | Actuator ouvert : `/heapdump` expose tous les secrets en mémoire. Console H2. |
| **Express** | `dotfiles: 'allow'` qui sert `.env` et `.git/config`. `err.stack` renvoyé au client. |

### Mobile et bureau

| Plateforme | Ce qu'il attrape en propre |
|---|---|
| **React Native / Expo** | `AsyncStorage` porte un nom rassurant mais **écrit en clair** : un jeton s'y lit sans effort sur un appareil rooté ou via une sauvegarde. WebView avec accès au système de fichiers. |
| **Flutter** | Même piège, autre nom : `SharedPreferences` est un XML en clair sous Android. Et `badCertificateCallback => true`, qui désactive **toute** la validation TLS. |
| **Tauri** | `allowlist.all: true` réduit à néant le modèle de sécurité entier de Tauri. Shell exposé, `csp: null`, `dangerousRemoteDomainIpcAccess` — une XSS sur le domaine distant devient une exécution de code locale. |
| **Electron** | `nodeIntegration`, `contextIsolation: false`, `webSecurity: false`, contenu non chiffré. Le renderer affiche du HTML ; s'il a aussi Node, toute XSS devient un RCE. |
| **Android natif** (Kotlin, Java) | `SharedPreferences` pour un jeton, **TrustManager au corps vide** — ne pas lever d'exception signifie « certificat valide », donc tous le sont. Nom d'hôte jamais vérifié, WebView avec accès disque. |
| **iOS natif** (Swift, Obj-C) | `UserDefaults` pour un secret, `kSecAttrAccessibleAlways`, certificat serveur accepté sans `SecTrustEvaluate`. |
| **Manifestes Android / iOS** | Règle **transverse** sur `AndroidManifest.xml` et `Info.plist`, quel que soit l'outil qui les a générés : trafic en clair, `debuggable`, `allowBackup`, `NSAllowsArbitraryLoads`. Couvre donc aussi Capacitor, Ionic, Kotlin et Swift natifs. |

#### Un script isolé ne change pas la nature du projet

Signalé sur un vrai projet Expo : Argus le classait **Python**. Un unique script de publication en `.py` suffisait — la règle était « au moins un fichier Python ».

Il faut désormais soit un manifeste Python (`requirements.txt`, `pyproject.toml`, `Pipfile`, `setup.py`…), soit une présence qui pèse réellement dans le code applicatif (≥ 3 fichiers **et** ≥ 15 % des lignes). En prime, la répartition des langages ne compte plus le JSON ni le YAML, qui écrasaient la part du code réel, et le rapport affiche maintenant en une ligne **ce que le projet est** :

```
Projet        React Native (Expo) · mobile
Langages      typescript 65%  python 19%  javascript 15%
Detecte       react, react-native, expo, node
```

#### Une application mobile n'est pas un site web

React Native dépend de `react`. Sans distinction, Argus en concluait « SPA » et reprochait à une application mobile son `robots.txt` absent, son `sitemap.xml` absent et son défaut de rendu serveur — quatre constats sur cinq, tous absurdes.

Argus détecte désormais la **plateforme visée** (`web`, `mobile`, `desktop`), affichée dans le rapport. Le SEO, les balises méta et le rendu serveur ne s'appliquent qu'au web ; les règles de manifeste natif ne s'appliquent qu'au mobile. Un projet Capacitor, qui est légitimement les deux, reçoit les deux.

**Les gabarits serveur sont analysés comme du HTML** : `.blade.php`, `.erb`, `.twig`, `.liquid`, `.njk`, `.jinja`. Les vues de vos projets Laravel, Rails ou Symfony bénéficient donc du SEO, de l'accessibilité et de la détection de liens morts — ce qui n'était pas le cas auparavant.

Les imports sont résolus selon les conventions de chaque écosystème : **PSR-4** pour PHP (`use App\Http\Controllers\X` → `app/Http/Controllers/X.php`), modules Python, autoload Rails. Sans quoi un projet entier paraîtrait mort.

Pour ajouter un framework : un module dans `src/rules/frameworks/`, référencé dans son index.

## L'origine de la valeur, pas seulement le motif

Le motif « concaténation dans une requête SQL » ne distingue pas ceci :

```js
const identifiant = requete.query.id;                                  // faille
db.query('SELECT * FROM users WHERE id = ' + identifiant);

const identifiant = 'admin';                                           // rien du tout
db.query('SELECT * FROM users WHERE role = ' + identifiant);
```

Les deux remontaient en **critique**. Le second est un faux positif — et un faux positif critique est le plus coûteux de tous : c'est celui qui pousse à ignorer la catégorie entière.

Argus analyse maintenant les **portées et l'origine des valeurs**, en JavaScript/TypeScript et en Python :

| Origine | Ce qui est signalé |
|---|---|
| Constante littérale | **rien** |
| Entrée externe (`req.query`, `request.GET`, `process.argv`, `location.hash`…) | gravité pleine, confiance **firm**, message explicite |
| Paramètre de fonction | signalé, confiance **tentative** — l'appelant est inconnu |
| Indéterminée | comportement inchangé |

Trois cas que le lexical ne pouvait pas voir sont désormais corrects :

```js
const table = 'users';
function lister(table) { db.query('SELECT * FROM ' + table); }   // le paramètre masque la constante

let critere = 'defaut';
critere = requete.body.critere;                                   // réaffectation
db.query('… WHERE nom = ' + critere);

const { slug } = requete.params;                                  // déstructuration
db.query('… WHERE slug = ' + slug);
```

### Ce que ce n'est pas

Pas un analyseur syntaxique complet, et volontairement. Aucun arbre n'est construit, la précédence des opérateurs est ignorée, il n'y a ni suivi inter-fichiers ni inter-fonctions. L'objectif est étroit : répondre à *« d'où vient la valeur de cet identifiant, ici ? »* — et y répondre juste. Chaque ligne de grammaire en trop est une ligne qui peut se tromper.

Côté Python, il n'y a même pas de lexeur : le langage n'ayant pas de portée de bloc, l'indentation suffit.

Le coût est nul en pratique : l'analyse ne tourne que sur les fichiers où une règle sensible au flux a déjà déclenché.

Mesuré sur des fixtures conçues pour piéger l'approche lexicale — **1 faux positif éliminé sur 5 constats, 0 détection perdue** sur les projets existants.

## Monorepos

Un dépôt qui contient plusieurs applications n'était, en pratique, **pas analysé**. La détection ne lisait que le manifeste racine — lequel ne déclare le plus souvent qu'un orchestrateur (`turbo`, `nx`, `lerna`). Un dépôt Next.js + Expo se résumait à `node`, et aucune règle spécialisée ne s'activait.

Argus découpe désormais le dépôt et juge chaque application sur ce qu'elle déclare :

```
Projet        Monorepo · 3 projets (React Native (Expo), Next.js, React) · mobile et web
  └ apps/mobile  React Native (Expo) · mobile
  └ apps/web     Next.js · web
  └ packages/ui  React · web
```

L'attribution se fait **par manifeste**, pas par déclaration d'espace de travail : `workspaces`, `pnpm-workspace.yaml`, `lerna.json`, les membres Cargo et `go.work` décrivent la même réalité avec cinq syntaxes, alors qu'un dossier portant un manifeste est un sous-projet dans tous les cas — y compris quand rien ne le déclare, ce qui est fréquent pour un backend posé à côté d'un front.

Trois faux positifs disparaissent au passage, tous dus à des conventions testées depuis la racine du dépôt au lieu de l'application :

| Constat | Pourquoi c'était faux |
|---|---|
| `apps/web/pages/contact.jsx` — *code mort* | C'est une page Next.js, chargée par le routeur |
| `robots.txt absent` **×2** | `packages/ui` est une bibliothèque de composants, pas un site |
| *« Créez `public/robots.txt` »* | À la racine du dépôt, il ne serait jamais servi — le conseil dit maintenant `apps/web/public/robots.txt` |

Ce qui reste global le reste volontairement : le graphe d'imports et la détection de code mort traversent les paquets, ce qui est exactement ce qu'on veut d'un monorepo — un composant partagé que plus personne n'importe est bien mort.

Les dossiers de plateforme native (`android/`, `ios/`, `src-tauri/`) ne sont pas séparés : ce sont des cibles de compilation, et les isoler priverait le pack mobile du contexte de son application.

## Le site est installable et fonctionne hors ligne

L'analyseur en ligne tourne **entièrement dans l'onglet** : aucun fichier ne part sur le réseau. Il n'y avait donc aucune raison qu'il ait besoin du réseau pour se charger.

Le site est une PWA : « Installer l'application » dans la barre d'adresse, ou depuis le bouton de la page d'accueil. Une fois installée, elle analyse vos dossiers sans aucune connexion — ce qui rend la promesse de confidentialité vérifiable plutôt que déclarative : coupez le Wi-Fi, l'outil marche toujours.

Le service worker précache 83 ressources (≈ 660 Ko), dont les 62 modules du cœur d'Argus. **La liste est générée** au déploiement par `scripts/site-precache.js`, jamais écrite à la main, et la version du cache est l'empreinte du contenu : un octet modifié déclenche la mise à jour, deux déploiements identiques ne la déclenchent pas.

Vérifié en conditions réelles, pas en principe : profil de navigateur neuf, installation, **serveur éteint**, puis analyse complète d'un projet — la détection Expo et les six règles remontent normalement. Ce test a d'ailleurs révélé deux bugs invisibles autrement : `node:http` et `node:readline/promises` manquaient à la carte d'imports (un seul spécificateur absent casse **toute** la chaîne, et l'erreur ne nomme que le module d'entrée), et `terminal.js` lisait `process` au chargement. `scripts/lint.js` garde maintenant l'invariant : tout spécificateur `node:` atteignable depuis `src/` doit avoir son bouchon.

### Qualité et dépendances

Complexité cyclomatique, longueur des fonctions et des fichiers, nombre de paramètres, imbrication, duplication de blocs, dette déclarée (`TODO`/`FIXME`/`@deprecated`), absence de README, de linter, de tests ou d'intégration continue.
Côté dépendances : versions vulnérables connues, paquets abandonnés, versions non contraintes, fichier de verrouillage absent, dépendances jamais importées. Un rapport `npm audit --json` déposé dans `.argus/npm-audit.json` est intégré automatiquement.

---

## Les trois commandes qui vont plus loin

### `argus sync` — vulnérabilités réelles

Interroge **OSV.dev**, la base officielle de Google qui agrège GitHub Security Advisories, les CVE, PyPA, RustSec et Go vulndb. Le résultat est mis en cache localement : toutes les analyses suivantes restent hors ligne.

```bash
argus sync                    # une requête réseau
argus scan --only dependances # puis hors ligne, avec de vraies CVE
```

Les versions sont lues dans votre **fichier de verrouillage** (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `composer.lock`, `pubspec.lock`, `Cargo.lock`, `poetry.lock`). Sans lockfile, la version est déduite de la plage déclarée — et le rapport le signale explicitement.

Les scores CVSS affichés sont **calculés** à partir du vecteur officiel avec la formule FIRST.org v3.1, pas recopiés.

Ce qui part sur le réseau : uniquement des couples *(nom de paquet, version)*. Jamais votre code.

> Sans synchronisation, Argus se rabat sur une courte liste locale de secours et **vous prévient** que sa couverture est minime (`DEP-NO-OSV-SYNC`).

### `argus fix` — correctifs, avec votre accord

```bash
argus fix --dry-run   # voir les différentiels, sans rien écrire
argus fix             # proposer fichier par fichier
```

**Rien n'est jamais modifié sans que vous ayez dit oui.** Chaque fichier vous est présenté avec son différentiel exact, vous répondez `[o]ui`, `[n]on`, `[t]out accepter` ou `[q]uitter`, et l'original est sauvegardé dans `.argus/backup/` avant toute écriture.

Chaque correctif est étiqueté **sûr** ou **à vérifier** :

| Correctif | Risque |
|---|---|
| `rel="noopener noreferrer"` sur `target="_blank"` | sûr |
| `<meta charset>` et `<meta viewport>` manquants | sûr |
| `font-display: swap` dans `@font-face` | sûr |
| Suppression des instructions `debugger` | sûr |
| `loading="lazy"` (hors première image, pour préserver le LCP) | à vérifier |
| `defer` sur les scripts bloquants du `<head>` | à vérifier |
| Suppression des imports inutilisés | à vérifier |

**Volontairement non automatisé**, parce que cela demande votre jugement : les textes alternatifs des images (décrire une image demande de la voir — un `alt` inventé est pire qu'absent), l'attribut `lang`, les titres et méta descriptions, les corrections de sécurité, et la suppression de code mort.

### `argus scan --since` — uniquement ce que vos changements introduisent

```bash
argus scan --since main          # ce que votre branche ajoute
argus scan --since HEAD          # vos modifications non encore validées
argus scan --since origin/main   # en intégration continue
```

Sur un projet existant, la dette accumulée noie les nouveautés — et une revue qui affiche 400 problèmes préexistants n'est pas lue. Le mode différentiel ne rapporte que les problèmes situés dans les fichiers modifiés, et **calcule le score sur ce seul périmètre**.

La comparaison depuis une branche part de l'ancêtre commun : les commits arrivés sur `main` entre-temps ne vous sont pas imputés.

C'est ce qui rend l'outil utilisable en équipe : `--fail-on medium --since origin/main` bloque la dette *nouvelle* sans exiger de nettoyer l'existant.

### `argus history` — la tendance, pas l'instantané

Chaque `argus scan` enregistre son résultat dans `.argus/history.json` (local, ignoré par Git). L'analyse suivante affiche l'écart :

```
  Analyse precedente  35/100 il y a 2 h
  Evolution          ▲ +1 pt  (-4 problemes)
    Routes & liens           +7
```

```bash
argus history        # les 20 dernières analyses, avec leur commit
argus scan --no-history   # ne rien enregistrer
```

Le rapport HTML affiche une **tuile de tendance** : score courant, delta signé, et une sparkline des 12 dernières analyses. La valeur reste lisible sans survol — l'onglet Projet en donne le tableau complet.

Rien n'est enregistré en mode différentiel ni en exploration seule : ces scores portent sur un périmètre réduit et fausseraient la courbe.

### `argus crawl` — ce que votre serveur renvoie vraiment

```bash
argus crawl https://mon-site.tld
argus scan . --crawl https://mon-site.tld --html rapport.html
```

Demande réellement les pages à votre serveur. C'est le seul moyen de **vérifier** ce que l'analyse statique ne peut que supposer :

- **En-têtes de sécurité réellement envoyés** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, et les en-têtes qui divulguent votre stack.
- **Vrais codes HTTP** — 404 et 500 constatés, pas déduits.
- **Chaînes de redirection** — mesurées saut par saut, 302 temporaires signalés.
- **Liens externes morts** — vérifiés un par un.
- **Contenu mixte** — page HTTPS chargeant des ressources en HTTP.
- **Coquille vide de SPA** — si le HTML servi ne contient ni contenu ni `h1`, c'est la preuve que les robots voient une page blanche.
- **`noindex` oublié en production**, `robots.txt` bloquant tout le site, titres dupliqués constatés.
- **Temps de réponse, compression, en-têtes de cache.**

`robots.txt` est respecté, un délai sépare chaque requête, et le JavaScript n'est **pas** exécuté — c'est précisément ce que voit un robot d'indexation au premier passage.

Ces constats portent la confiance `certain` : ce sont des faits observés.

---

## Commandes

```
argus scan [chemin]      analyse le projet                          (par défaut)
argus serve [chemin]     tableau de bord interactif
argus fix [chemin]       correctifs mécaniques, avec votre accord
argus crawl <url>        audit du site réellement en ligne
argus sync [chemin]      met à jour la base de vulnérabilités (OSV.dev)
argus init [chemin]      crée un argus.config.json commenté
argus rules              liste les règles de sécurité
argus history [chemin]   évolution des scores au fil des analyses
argus baseline [chemin]  fige l'état actuel comme référence
argus help [commande]    aide détaillée
```

### Options principales

| Option | Effet |
|---|---|
| `--html [fichier]` | Rapport HTML autonome (défaut : `argus-report.html`) |
| `--json` / `--sarif` / `--markdown` | Autres formats de rapport |
| `--format <nom>` | Sortie standard : `terminal`, `json`, `sarif`, `markdown`, `html`, `compact`, `github` |
| `--open` | Ouvre le rapport HTML dans le navigateur |
| `--only <catégories>` | Ex. `--only seo,design` |
| `--skip <catégories>` | Catégories à exclure |
| `--ignore <patterns>` | Exclusions supplémentaires |
| `--since <ref>` | Ne rapporte que ce que vos changements introduisent |
| `--crawl <url>` | Vérifie aussi le site en ligne |
| `--max-pages <n>` | Limite l'exploration (défaut : 50) |
| `--dry-run` | (`fix`) affiche les différentiels sans rien écrire |
| `-s, --min-severity` | Gravité minimale rapportée |
| `--fail-on <gravité>` | Code de sortie 1 à partir de cette gravité (défaut : `high`) |
| `--fail-under <score>` | Code de sortie 1 sous ce score global |
| `--update-baseline` | Fige l'état actuel comme référence |
| `-V, --verbose` | Affiche tous les problèmes |

---

## Configuration

`argus init` crée un `argus.config.json` :

```json
{
  "categories": ["security", "routes", "deadcode", "seo", "design", "performance", "quality", "dependencies"],
  "ignore": ["**/legacy/**"],
  "minSeverity": "info",
  "failOn": "high",
  "failUnderScore": 70,
  "siteUrl": "https://votre-domaine.tld",
  "disabledRules": ["QUAL-TODO"],
  "ruleSeverity": { "SEO-THIN-CONTENT": "info" },
  "options": {
    "seo": { "titleMin": 30, "titleMax": 60, "minWordCount": 250 },
    "design": { "minContrastRatio": 4.5, "minTapTargetPx": 44 },
    "quality": { "maxComplexity": 15, "maxFileLines": 500 }
  }
}
```

Le `.gitignore` du projet est respecté automatiquement.

### Ignorer un cas précis dans le code

```js
// argus-disable-next-line
eval(codeDeConfiance);

const cle = 'valeur-de-demo'; // argus-ignore
```

### Baseline

Sur un projet existant, la dette accumulée noie les nouveautés. Figez-la une fois :

```bash
argus baseline
```

Les problèmes connus sont désormais masqués ; seuls les **nouveaux** remontent. Le fichier `.argus/baseline.json` se versionne avec le code.

---

## Intégration continue

```yaml
# .github/workflows/argus.yml
name: Analyse Argus
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - name: Analyse
        run: node bin/argus.js scan . --sarif argus.sarif --format github --fail-on high

      - name: Publication dans Code Scanning
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: argus.sarif }
```

Le format `github` produit des annotations directement visibles dans la diff de la pull request. Le format `sarif` alimente GitHub Code Scanning, GitLab, Azure DevOps et la plupart des IDE.

**Codes de sortie** : `0` succès · `1` seuil dépassé · `2` erreur d'exécution.

---

## Utilisation programmatique

```js
import { scan, renderHtml } from './src/index.js';

const rapport = await scan('./mon-projet', {
  categories: ['security', 'seo'],
  minSeverity: 'medium',
});

console.log(rapport.scores.global, rapport.scores.grade);

for (const action of rapport.actionPlan) {
  console.log(`${action.priority}. ${action.title} — ${action.suggestion}`);
}

fs.writeFileSync('rapport.html', renderHtml(rapport));
```

---

## Identité visuelle

L'icône est un œil — Argus Panoptes, le géant aux cent yeux de la mythologie. Elle vit dans `assets/argus-icon.svg` (286 octets) et une variante monochrome `assets/argus-icon-mono.svg` qui suit `currentColor`.

La contrainte de conception dominante était la **lisibilité à 16 px** dans un onglet. D'où deux choix vérifiés au pixel près :

- **Fond plein** plutôt qu'un tracé : l'icône garde son contraste sur un onglet clair comme sombre.
- **Œil large, pupille modérée** : une pupille plus grosse réduit le blanc à de fins croissants et la forme cesse de se lire.

Le rapport HTML l'embarque en data URI — il doit rester un fichier unique, ouvrable hors ligne. Le tableau de bord la sert sur `/favicon.svg`.

## Performance

Mesuré sur un projet généré de 3 000 fichiers :

| | Avant | Après |
|---|---:|---:|
| Projet réaliste (fichiers qui s'importent) | — | **3,1 s** (1 ms/fichier) |
| Cas pathologique (aucun fichier importé) | 9,5 s | **5,8 s** |

Deux corrections **algorithmiques**, pas de parallélisation :

- La détection d'exports morts rebalayait tout le code source **pour chaque symbole** — quadratique. Un index d'identifiants construit en une passe répond désormais en temps constant.
- La recherche « ce fichier est-il cité dans une chaîne ? » est devenue paresseuse : elle ne s'exécute que sur les fichiers réellement candidats.

> **Pourquoi pas de `worker_threads` ?** Le profilage a montré qu'un seul analyseur consommait 75 % du temps. Paralléliser n'aurait masqué le problème qu'au prix d'une complexité réelle — transfert des contenus entre fils d'exécution. Corriger l'algorithme a donné 41 % sans ajouter une ligne de coordination. À 1 ms par fichier, et avec `--since` pour l'incrémental, le sujet n'est plus prioritaire.

## Comment le score est calculé

Chaque catégorie part de 100. Chaque problème retire des points selon sa gravité (critique 40, élevé 18, moyen 7, faible 2,5, info 0,5), pondérée par le niveau de confiance de la règle. La pénalité totale est ensuite **amortie par la taille du projet** : un dépôt de 5 000 fichiers n'est pas jugé à la même aune qu'un de 20.

Le score global est la moyenne des catégories, pondérée par leur importance — la sécurité pèse le plus, la qualité le moins.

| Note | Score |
|---|---|
| A+ / A | 95+ / 90+ |
| B / C | 80+ / 70+ |
| D / E | 55+ / 40+ |
| F | < 40 |

---

## Architecture

```
bin/argus.js              interface en ligne de commande
src/
  core/       engine, walker, config, scan, scoring, html, color, glob
  analyzers/  security, routes, deadcode, seo, design, performance, quality, dependencies
  lang/       routes (extracteurs par framework), symbols (déclarations/imports)
  rules/      security (base de motifs), secrets (signatures et entropie)
  report/     terminal, html, formats (json, sarif, markdown, compact, github)
  server/     tableau de bord local
tests/        unitaires, intégration, fixtures
```

**Ajouter un analyseur** : créez un module exportant `{ id, category, label, order, run(context, report) }`, puis référencez-le dans `src/analyzers/index.js`.

**Ajouter une règle de sécurité** : ajoutez une entrée dans `src/rules/security.js`. Toute règle doit fournir un `message` (ce qui ne va pas) *et* une `suggestion` (quoi faire) — c'est vérifié par les tests.

**Ajouter un langage** : déclarez l'extension dans `src/core/languages.js`, puis, si nécessaire, des motifs dans `src/lang/symbols.js` et un extracteur de routes dans `src/lang/routes.js`.

---

## Limites à connaître

Argus fait de l'analyse **statique et lexicale** : il ne construit pas d'arbre syntaxique complet et n'exécute pas votre code.

- Les problèmes de niveau `low`/`info` marqués « tentative » demandent une vérification humaine.
- Le code chargé dynamiquement (réflexion, conventions de nommage, chargeurs de plugins) peut être signalé à tort comme mort.
- Les liens construits à l'exécution (`` `/produits/${id}` ``) ne sont pas résolus.
- Les contrastes sont évalués sur les couleurs déclarées dans une même règle CSS ; la cascade et les variables ne sont pas simulées.
- Sans `argus sync`, la base de vulnérabilités locale est volontairement minime — l'outil vous le dit alors explicitement.
- Le crawl n'exécute pas le JavaScript : il montre ce que voit un robot, pas ce que voit un navigateur.

C'est le prix à payer pour un outil qui s'exécute en moins d'une seconde, sans installation, sur n'importe quelle base de code.

---

## Tests

```bash
npm test
```

191 tests couvrent :

- les briques de base — glob, masquage lexical, couleur et contraste WCAG, parsing HTML, détection de secrets, routes, score ;
- le **calcul CVSS**, vérifié contre les vecteurs de référence publiés par FIRST.org ;
- la lecture des fichiers de verrouillage et la correspondance des plages OSV ;
- les correctifs — dont la garantie que `planFixes` **n'écrit jamais** sur le disque ;
- le crawl, contre un serveur HTTP local (statuts, redirections, `robots.txt`, coquille vide de SPA) ;
- le comportement bout-en-bout sur des projets de démonstration volontairement défectueux, en JavaScript et en Python/Java/PHP/Dart.
