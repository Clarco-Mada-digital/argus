# Référence des règles

Chaque règle porte un identifiant stable. Vous pouvez la désactiver (`disabledRules`) ou en changer la gravité (`ruleSeverity`) dans `argus.config.json`, ou par préfixe : `"disabledRules": ["QUAL-"]` désactive toute la qualité.

Gravités : **critique** · **élevé** · **moyen** · **faible** · **info**.
Confiance : les règles marquées *tentative* signalent un motif suspect qui demande une lecture humaine.

---

## Sécurité — `SEC-*`

### Secrets

| Règle | Gravité | Détecte |
|---|---|---|
| `SEC-SECRET-AWS-ACCESS-KEY` | critique | Clé d'accès AWS (`AKIA…`) |
| `SEC-SECRET-GITHUB-TOKEN` | critique | Jeton GitHub (`ghp_`, `gho_`, `ghs_`…) |
| `SEC-SECRET-STRIPE-KEY` | critique | Clé Stripe live ou test |
| `SEC-SECRET-OPENAI-KEY` / `-ANTHROPIC-KEY` | critique | Clés d'API de modèles |
| `SEC-SECRET-PRIVATE-KEY` | critique | Bloc `-----BEGIN … PRIVATE KEY-----` |
| `SEC-SECRET-DB-URL` | critique | URL de base contenant un mot de passe |
| `SEC-SECRET-JWT-TOKEN` | élevé | Jeton JWT écrit en dur |
| `SEC-SECRET-GENERIC-SECRET` | élevé / moyen | Affectation à haute entropie sur un nom sensible |

Les valeurs d'exemple (`changeme`, `your-api-key`, `process.env.X`, `${SECRET}`, `<votre-clé>`) sont écartées. Les fichiers `.example`, `.sample` et les tests voient leur gravité abaissée d'un cran.

> **Un secret détecté doit être considéré comme compromis.** Le retirer du code ne suffit pas : il reste dans l'historique Git. Révoquez-le et régénérez-le.

### Injections

| Règle | Gravité | CWE |
|---|---|---|
| `SEC-SQL-CONCAT` | critique | CWE-89 |
| `SEC-EXEC-SHELL` | critique | CWE-78 |
| `SEC-SHELL-TRUE` | élevé | CWE-78 |
| `SEC-EVAL` / `SEC-FUNCTION-CTOR` | élevé | CWE-95 |
| `SEC-NOSQL-WHERE` | élevé | CWE-943 |
| `SEC-SQL-RAW` | moyen *(tentative)* | CWE-89 |

### XSS

`SEC-INNERHTML` · `SEC-DANGEROUS-HTML` · `SEC-VUE-VHTML` · `SEC-TEMPLATE-AUTOESCAPE` (élevé) · `SEC-DOC-WRITE` (moyen) — CWE-79.

### Désérialisation — CWE-502

`SEC-PICKLE` (Python) · `SEC-JAVA-DESERIALIZE` · `SEC-PHP-UNSERIALIZE` — toutes critiques.

### Cryptographie

| Règle | Gravité |
|---|---|
| `SEC-TLS-DISABLED` | critique |
| `SEC-WEAK-HASH` (MD5/SHA-1) | élevé |
| `SEC-WEAK-CIPHER` (DES, RC4, ECB) | élevé |
| `SEC-WEAK-RANDOM` | moyen *(tentative)* |
| `SEC-HTTP-URL` | moyen |

### Authentification et accès

`SEC-JWT-NONE` (critique) · `SEC-CORS-WILDCARD` · `SEC-CSRF-OFF` · `SEC-PATH-TRAVERSAL` · `SEC-SSRF` (élevé) · `SEC-COOKIE-FLAGS` · `SEC-OPEN-REDIRECT` · `SEC-MASS-ASSIGNMENT` · `SEC-PERMISSIVE-PERMS` (moyen).

### Configuration

`SEC-ENV-COMMITTED` (critique) · `SEC-MISSING-HEADERS` · `SEC-DOCKER-ROOT` · `SEC-DEBUG-ON` · `SEC-XXE` · `SEC-LOG-SENSITIVE` · `SEC-REGEX-DOS` (moyen) · `SEC-DOCKER-LATEST` · `SEC-BIND-ALL` · `SEC-EMPTY-CATCH` · `SEC-GITIGNORE-ENV` (faible).

---

## Routes — `ROUTE-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `ROUTE-BROKEN-LINK` | élevé | Lien interne ne menant à aucune route ni fichier |
| `ROUTE-MISSING-ASSET` | moyen | Image, script ou feuille de style référencée mais absente |
| `ROUTE-ORPHAN` | moyen *(tentative)* | Page sans aucun lien entrant ni entrée de sitemap |
| `ROUTE-DUPLICATE` | moyen | Même route déclarée deux fois dans le même routeur |
| `ROUTE-NO-404` | moyen | Aucune page ni route de repli |
| `ROUTE-TARGET-BLANK` | moyen | `target="_blank"` sans `rel="noopener"` |
| `ROUTE-UNKNOWN-NAME` | élevé | `url_for()` / `route()` vers un nom inexistant |
| `ROUTE-UPPERCASE` / `ROUTE-DOUBLE-SLASH` | faible | Hygiène d'URL |
| `ROUTE-UNDERSCORE` / `ROUTE-TOO-DEEP` | info | Recommandations SEO |

**Angles morts** : une URL construite à l'exécution (`` `/produits/${id}` ``) n'est pas résolue ; une route dynamique n'est jamais signalée comme orpheline.

---

## Code mort — `DEAD-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `DEAD-UNREACHABLE` | moyen | Instruction après un `return`/`throw`/`raise` au même niveau |
| `DEAD-FILE` | moyen *(tentative)* | Fichier importé par personne, hors points d'entrée |
| `DEAD-EXPORT` | faible *(tentative)* | Export jamais consommé ailleurs |
| `DEAD-IMPORT` / `DEAD-LOCAL` | faible | Import ou déclaration inutilisés |
| `DEAD-ASSET` | faible *(tentative)* | Image, police ou style jamais référencé |
| `DEAD-DEBUG-*` | variable | `debugger` (élevé), points d'arrêt (élevé), `console.log` (faible) |
| `DEAD-COMMENTED-CODE` | info | Au moins 4 lignes de code en commentaire |

**Sont considérés comme vivants** : points d'entrée déclarés dans `package.json`, fichiers `index`/`main`/`__init__`, dossiers `pages/`, `app/`, `routes/`, `views/`, `controllers/`, `migrations/`, fichiers de configuration et de test, symboles décorés (`@app.route`, `@GetMapping`, `@Component`), et tout fichier dont le chemin apparaît dans une chaîne du projet.

---

## SEO — `SEO-*`

| Règle | Gravité |
|---|---|
| `SEO-TITLE-MISSING` · `SEO-ROBOTS-BLOCK-ALL` | critique |
| `SEO-DESC-MISSING` · `SEO-LANG-MISSING` · `SEO-VIEWPORT-MISSING` · `SEO-H1-MISSING` · `SEO-NOINDEX` · `SEO-SPA-NO-SSR` · `SEO-SPA-SHARED-META` | élevé |
| `SEO-CANONICAL-MISSING` · `SEO-OG-MISSING` · `SEO-STRUCTURED-DATA` · `SEO-JSONLD-INVALID` · `SEO-ROBOTS-MISSING` · `SEO-SITEMAP-MISSING` · `SEO-CHARSET-MISSING` · `SEO-IMG-ALT-MISSING` · `SEO-TITLE-SHORT` · `SEO-TITLE-DUPLICATED-PAGES` · `SEO-VIEWPORT-NOZOOM` | moyen |
| `SEO-TITLE-LONG` · `SEO-DESC-SHORT` · `SEO-H1-MULTIPLE` · `SEO-HEADING-SKIP` · `SEO-ANCHOR-GENERIC` · `SEO-IMG-NO-DIMENSIONS` · `SEO-THIN-CONTENT` · `SEO-CANONICAL-RELATIVE` · `SEO-OG-INCOMPLETE` | faible |
| `SEO-DESC-LONG` · `SEO-IMG-NO-LAZY` · `SEO-FAVICON-MISSING` · `SEO-MANIFEST-MISSING` | info |

Seuils ajustables dans `options.seo` : `titleMin`, `titleMax`, `descriptionMin`, `descriptionMax`, `minWordCount`.

---

## Design et accessibilité — `A11Y-*`, `DESIGN-*`, `UX-*`

### Accessibilité

| Règle | Gravité | Critère WCAG |
|---|---|---|
| `A11Y-NO-ACCESSIBLE-NAME` | élevé | 4.1.2 |
| `A11Y-INPUT-NO-LABEL` | élevé | 3.3.2 |
| `A11Y-FOCUS-REMOVED` | élevé | 2.4.7 |
| `A11Y-CONTRAST` | élevé / moyen | 1.4.3 |
| `A11Y-CLICKABLE-DIV` | moyen | 2.1.1 |
| `A11Y-POSITIVE-TABINDEX` | moyen | 2.4.3 |
| `A11Y-IFRAME-NO-TITLE` | moyen | 4.1.2 |
| `A11Y-TABLE-NO-HEADERS` | moyen | 1.3.1 |
| `A11Y-NO-MAIN-LANDMARK` | moyen | 1.3.1 |
| `A11Y-LINK-NO-HREF` | moyen | 2.1.1 |
| `A11Y-NO-SKIP-LINK` | faible | 2.4.1 |
| `A11Y-NO-REDUCED-MOTION` | faible | 2.3.3 |

`A11Y-CONTRAST` calcule le ratio réel et **propose une couleur de remplacement** atteignant AA, en préservant la teinte.

### Système de design

| Règle | Gravité | Seuil |
|---|---|---|
| `DESIGN-NO-BREAKPOINTS` | élevé | aucune media query |
| `DESIGN-COLOR-SPRAWL` | moyen | > 30 couleurs distinctes |
| `DESIGN-NO-TOKENS` | moyen | aucune variable CSS |
| `DESIGN-FONT-TOO-SMALL` | moyen | < `minFontSizePx` (12) |
| `DESIGN-TAP-TARGET` | moyen | < `minTapTargetPx` (44) |
| `DESIGN-FIXED-WIDTH` | moyen | largeur fixe ≥ 1000 px |
| `DESIGN-TYPE-SCALE` | faible | > 12 tailles de police |
| `DESIGN-SPACING-SCALE` | faible | espacements hors grille de 4 px |
| `DESIGN-ZINDEX-CHAOS` | faible | > 3 valeurs au-delà de 999 |
| `DESIGN-IMPORTANT-OVERUSE` | faible | > 15 `!important` et > 15 % des règles |
| `DESIGN-TOO-MANY-FONTS` | faible | > 3 familles |
| `DESIGN-NO-DARK-MODE` · `DESIGN-INLINE-STYLE` | info | |
| `UX-NO-AUTOCOMPLETE` · `UX-AUTOFOCUS` | faible | |

---

## Performance — `PERF-*`

| Règle | Gravité |
|---|---|
| `PERF-NESTED-LOOP-QUERY` (N+1) | élevé |
| `PERF-HEAVY-IMAGE` (> 1 Mo) | élevé |
| `PERF-HEAVY-IMAGE` / `PERF-HEAVY-ASSET` | moyen |
| `PERF-BLOCKING-SCRIPT` · `PERF-FONT-DISPLAY` · `PERF-AWAIT-IN-LOOP` · `PERF-DOM-IN-LOOP` · `PERF-SYNC-IO` | moyen |
| `PERF-SELECT-STAR` · `PERF-MOMENT` · `PERF-FULL-LODASH` · `PERF-HEAVY-SVG` · `PERF-FONT-FORMAT` · `PERF-TOO-MANY-CSS` | faible |
| `PERF-NO-PRECONNECT` · `PERF-HEAVY-DEPENDENCY` | info |

Seuils : `options.performance.maxImageBytes` (300 Ko) et `maxAssetBytes` (1 Mo).

---

## Qualité — `QUAL-*`

| Règle | Gravité | Seuil par défaut |
|---|---|---|
| `QUAL-NO-TESTS` | moyen | aucun fichier de test |
| `QUAL-HIGH-COMPLEXITY` | moyen / faible | complexité > 15 |
| `QUAL-FIXME` | moyen | `FIXME`, `XXX`, `HACK`, `BUG` |
| `QUAL-FILE-TOO-LONG` | faible | > 500 lignes |
| `QUAL-LONG-FUNCTION` | faible | > 80 lignes |
| `QUAL-TOO-MANY-PARAMS` | faible | > 5 paramètres |
| `QUAL-DEEP-NESTING` | faible | ≥ 7 niveaux |
| `QUAL-DUPLICATION` | faible / info | 6 lignes identiques |
| `QUAL-DEPRECATED` · `QUAL-NO-README` · `QUAL-NO-LINTER` · `QUAL-NO-CI` · `QUAL-NO-TEST-SCRIPT` · `QUAL-LOW-TEST-RATIO` | faible | |
| `QUAL-TODO` · `QUAL-THIN-README` | info | |

---

## Dépendances — `DEP-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `DEP-VULNERABLE` | selon le score CVSS | Vulnérabilité connue affectant la version installée |
| `DEP-AUDIT` | selon `npm audit` | Résultat d'un rapport `npm audit --json` déposé dans `.argus/` |
| `DEP-NO-OSV-SYNC` | moyen / faible | Aucun cache OSV : la couverture est minime, lancez `argus sync` |
| `DEP-CACHE-STALE` | info | Le cache OSV a plus de 7 jours |
| `DEP-DEPRECATED` · `DEP-UNPINNED` · `DEP-NO-LOCKFILE` | moyen | Paquet abandonné, version non contrainte, lockfile absent |
| `DEP-UNUSED` | faible *(tentative)* | Dépendance de production jamais importée |

**Trois sources, par fiabilité décroissante :**

1. **Cache OSV.dev** (`argus sync`) — base officielle agrégeant GitHub Advisories, CVE, PyPA, RustSec, Go vulndb. Confiance `certain` quand la version vient d'un fichier de verrouillage, `firm` quand elle est déduite d'une plage. La gravité est calculée à partir du **vecteur CVSS v3.1** avec la formule officielle FIRST.org.
2. **`npm audit --json`** déposé dans `.argus/npm-audit.json`.
3. **Liste locale de secours** — 17 paquets seulement, marquée `tentative`, avec la mention « à confirmer » dans le message. Argus émet alors `DEP-NO-OSV-SYNC` pour vous prévenir que sa couverture est très partielle.

---

## Django — `DJANGO-*`

Actives uniquement sur un projet Django. Croisent plusieurs fichiers ou detectent l'absence d'un element — ce qu'un simple motif ne permet pas.

| Règle | Gravité | Détecte |
|---|---|---|
| `DJANGO-SECRET-KEY-HARDCODED` | critique | `SECRET_KEY` littérale au lieu d'une variable d'environnement |
| `DJANGO-CSRF-TOKEN-MISSING` | élevé | `<form method="post">` sans `{% csrf_token %}` |
| `DJANGO-URL-UNKNOWN` | élevé | `{% url 'nom' %}` sans `name=` correspondant dans un `urls.py` |
| `DJANGO-HARDENING-MISSING` | moyen / faible | Réglages de durcissement absents de `settings.py` |
| `DJANGO-MODEL-NO-STR` | faible | Modèle sans `__str__` — l'admin affiche « Object (1) » |
| `DJANGO-CHARFIELD-NULL` | faible | `null=True` sur un champ texte : deux représentations du vide |

**Angles morts connus** : `related_name` manquant, index de base absents, migrations incohérentes, attributs de vues classe.

---

## Laravel — `LARAVEL-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `LARAVEL-CSRF-MISSING` | élevé | `<form method="POST">` Blade sans `@csrf` (erreur 419) |
| `LARAVEL-ENV-OUTSIDE-CONFIG` | élevé | `env()` hors de `config/` : renvoie `null` après `config:cache` |
| `LARAVEL-GUARDED-EMPTY` | élevé | `$guarded = []` : affectation de masse sans garde-fou |
| `LARAVEL-MODEL-NO-HIDDEN` | élevé | Champ sensible dans `$fillable` sans `$hidden` |

Les vues `.blade.php` sont analysées comme du HTML, et les classes résolues via **PSR-4** lu dans `composer.json`.

---

## Rails — `RAILS-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `RAILS-MASTER-KEY-COMMITTED` | critique | `config/master.key` versionné : déchiffre tous les credentials |
| `RAILS-SQL-INTERPOLATION` | critique | `where("… #{params[…]}")` |
| `RAILS-CSRF-DISABLED` | élevé / moyen | `skip_before_action :verify_authenticity_token` |
| `RAILS-PERMIT-ALL` | élevé | `params.permit!` ou `to_unsafe_h` |
| `RAILS-HTML-SAFE` | élevé | `.html_safe` / `raw()` sur contenu interpolé |

Les vues `.erb` sont analysées comme du HTML. Le N+1 est vu malgré la syntaxe `.each do |x|`.

**Angles morts connus** : `before_action` d'autorisation manquant, portées non filtrées par utilisateur.


---

## Express — `EXPRESS-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `EXPRESS-STATIC-DOTFILES` | critique | `dotfiles: 'allow'` sert les fichiers cachés du dossier statique |
| `EXPRESS-STACK-LEAK` | élevé | `err.stack` dans une réponse HTTP |
| `EXPRESS-SESSION-COOKIE` | élevé / moyen | Cookie de session sans `secure`, `httpOnly` ou `sameSite` |
| `EXPRESS-NO-BODY-LIMIT` | moyen | `express.json()` sans `limit` déclarée |
| `EXPRESS-SESSION-UNINITIALIZED` | faible | `saveUninitialized: true` : une session par visiteur, robots compris |

---

## Next.js — `NEXTJS-*`

| Règle | Gravité | Détecte |
|---|---|---|
| `NEXTJS-PUBLIC-SECRET` | critique | Variable `NEXT_PUBLIC_*` au nom sensible : inlinée dans le bundle navigateur |
| `NEXTJS-IGNORE-TYPES` | élevé | `typescript.ignoreBuildErrors: true` |
| `NEXTJS-IMAGE-WILDCARD` | élevé | `images.domains: ['*']` |
| `NEXTJS-IGNORE-LINT` · `NEXTJS-NO-HEADERS` · `NEXTJS-API-NO-METHOD-CHECK` | moyen | Garde-fous désactivés, en-têtes absents, méthode HTTP non vérifiée |

Le routeur `app/` déclare une fonction par méthode (`export async function POST`) : la vérification de méthode ne s'y applique pas.

---

## Exploration HTTP — `CRAWL-*`

Ces règles ne s'activent qu'avec `argus crawl <url>` ou `--crawl <url>`. Ce sont des **faits observés** sur votre serveur, pas des déductions : toutes portent la confiance `certain`.

### Disponibilité et navigation

| Règle | Gravité | Détecte |
|---|---|---|
| `CRAWL-SERVER-ERROR` | critique | Page renvoyant une erreur 5xx |
| `CRAWL-UNREACHABLE` | élevé | Page ne répondant pas (délai dépassé, connexion refusée) |
| `CRAWL-BROKEN-PAGE` | élevé / moyen | Lien interne renvoyant réellement un 404 |
| `CRAWL-REDIRECT-CHAIN` | moyen | Plus d'une redirection avant la destination |
| `CRAWL-TEMPORARY-REDIRECT` | faible | 302/307 là où un 301 serait attendu |
| `CRAWL-EXTERNAL-DEAD` | faible | Lien sortant vérifié comme mort |
| `CRAWL-ROUTE-NOT-REACHED` | faible *(tentative)* | Route du code jamais rencontrée en ligne |

### Sécurité constatée

| Règle | Gravité |
|---|---|
| `CRAWL-NO-HTTPS` | critique |
| `CRAWL-MIXED-CONTENT` | élevé |
| `CRAWL-HEADER-CONTENT-SECURITY-POLICY` | élevé |
| `CRAWL-HEADER-STRICT-TRANSPORT-SECURITY` *(HTTPS uniquement)* | moyen |
| `CRAWL-HEADER-X-FRAME-OPTIONS` *(sauf si `frame-ancestors` en CSP)* | moyen |
| `CRAWL-HEADER-X-CONTENT-TYPE-OPTIONS` · `CRAWL-HEADER-REFERRER-POLICY` | faible |
| `CRAWL-VERSION-DISCLOSURE` | faible |

C'est la différence décisive avec l'analyse statique : `SEC-MISSING-HEADERS` suppose à partir du code, `CRAWL-HEADER-*` **vérifie** ce que le serveur envoie — reverse proxy, CDN et middleware compris.

### SEO constaté

| Règle | Gravité | Détecte |
|---|---|---|
| `CRAWL-NOINDEX-LIVE` | critique | Page en production demandant à ne pas être indexée |
| `CRAWL-ROBOTS-BLOCKS-ALL` | critique | `Disallow: /` en production |
| `CRAWL-EMPTY-HTML` | élevé | HTML servi sans contenu ni `h1` : les robots voient une page blanche |
| `CRAWL-CANONICAL-MISMATCH` | moyen | Canonique pointant ailleurs que la page elle-même |
| `CRAWL-DUPLICATE-TITLE` | moyen | Titre identique constaté sur plusieurs URL |
| `CRAWL-NO-ROBOTS` | moyen | `robots.txt` absent en production |
| `CRAWL-ROBOTS-BLOCKED` | moyen | Page liée mais interdite d'exploration |
| `CRAWL-ROBOTS-NO-SITEMAP` | faible | Sitemap non déclaré |

### Performance constatée

| Règle | Gravité | Seuil |
|---|---|---|
| `CRAWL-SLOW-RESPONSE` | élevé / moyen | TTFB > 800 ms (élevé au-delà de 2 s) |
| `CRAWL-NO-COMPRESSION` | moyen | HTML > 50 Ko sans gzip/Brotli |
| `CRAWL-NO-CACHE-HEADER` | faible | Ressource statique sans `Cache-Control` |

**Limites** : le JavaScript n'est pas exécuté (c'est volontaire — c'est ce que voit un robot au premier passage), `robots.txt` est respecté, et l'exploration est bornée par `--max-pages`.

---

## Correctifs automatiques — `argus fix`

Les correctifs ne créent pas de règles : ils répondent à des règles existantes.

| Correctif | Règle traitée | Risque |
|---|---|---|
| `noopener` | `ROUTE-TARGET-BLANK` | sûr |
| `charset` | `SEO-CHARSET-MISSING` | sûr |
| `viewport` | `SEO-VIEWPORT-MISSING` | sûr |
| `font-display` | `PERF-FONT-DISPLAY` | sûr |
| `debugger` | `DEAD-DEBUG-INSTRUCTION-DEBUGGER` | sûr |
| `lazy-images` | `SEO-IMG-NO-LAZY` | à vérifier |
| `defer-scripts` | `PERF-BLOCKING-SCRIPT` | à vérifier |
| `unused-imports` | `DEAD-IMPORT` | à vérifier |

Sélection : `argus fix --only noopener,charset`. Aperçu sans écriture : `argus fix --dry-run`.

**Aucune écriture sans accord explicite**, et l'original est sauvegardé dans `.argus/backup/`.
