/**
 * English overlay for rule text.
 *
 * Only complete entries belong here. A partially translated rule — English
 * title, French message — reads worse than a rule left entirely in French,
 * because it looks like a bug rather than a known gap.
 *
 * Rules whose message is assembled at detection time (interpolating a file
 * name, a key, a measured value) cannot be overlaid here: the text does not
 * exist until the finding is produced. Those call `t()` at the point of
 * construction instead.
 */
export const REGLES_EN = {
  'SEC-EVAL': {
    title: 'Dynamic code execution (eval)',
    message: 'A call to eval(): any user-controlled content becomes executable code.',
    suggestion: 'Use JSON.parse for data, or an explicit lookup table for dynamic dispatch.',
  },
  'SEC-FUNCTION-CTOR': {
    title: 'Dynamic Function constructor',
    message: 'new Function() compiles a string into code — equivalent to eval.',
    suggestion: 'Use a real function, or a map of behaviours.',
  },
  'SEC-EXEC-SHELL': {
    title: 'Shell command built by interpolation',
    message: 'A system command is assembled by concatenation: command injection is possible.',
    suggestion:
      'Pass arguments as an array (execFile / spawn / subprocess.run([...])) and never use shell:true with user input.',
  },
  'SEC-SHELL-TRUE': {
    title: 'subprocess with shell=True',
    message: 'shell=True opens the door to command injection as soon as a variable enters the command.',
    suggestion: 'Pass a list of arguments: subprocess.run(["ls", "-l", path]).',
  },
  'SEC-SQL-CONCAT': {
    title: 'SQL query built by concatenation',
    message: 'A SQL query is assembled with variables: SQL injection is likely.',
    suggestion: 'Use parameterised queries (? / $1 / :name placeholders) provided by your driver or ORM.',
  },
  'SEC-SQL-RAW': {
    title: 'Raw ORM query',
    message: 'Raw SQL query: check that parameters are not interpolated.',
    suggestion: 'Prefer the query builder, or pass values through the raw method’s parameter array.',
  },
  'SEC-NOSQL-WHERE': {
    title: 'MongoDB $where operator',
    message: '$where evaluates JavaScript on the database side: NoSQL injection is possible.',
    suggestion: 'Replace it with standard query operators ($eq, $gt, $in).',
  },
  'SEC-INNERHTML': {
    title: 'Unescaped HTML write (innerHTML)',
    message: 'Direct assignment to innerHTML: XSS if the value comes from a user.',
    suggestion: 'Use textContent, or sanitise with DOMPurify.sanitize() before inserting.',
  },
  'SEC-DANGEROUS-HTML': {
    title: 'dangerouslySetInnerHTML',
    message: 'React turns off its automatic escaping at this point.',
    suggestion: 'Sanitise the HTML (DOMPurify) or render the content as text.',
  },
  'SEC-VUE-VHTML': {
    title: 'v-html directive',
    message: 'v-html injects raw HTML into the DOM.',
    suggestion: 'Use {{ }} interpolation, or sanitise the value server-side.',
  },
  'SEC-DOC-WRITE': {
    title: 'document.write',
    message: 'document.write blocks rendering and opens an XSS surface.',
    suggestion: 'Build nodes with createElement/textContent.',
  },
  'SEC-TEMPLATE-AUTOESCAPE': {
    title: 'Template escaping disabled',
    message: 'The template engine’s automatic escaping is bypassed here.',
    suggestion: 'Only disable escaping on content you have sanitised yourself.',
  },
  'SEC-PICKLE': {
    title: 'Unsafe deserialisation (pickle/yaml)',
    message: 'Deserialisation capable of executing arbitrary code.',
    suggestion: 'Use json.loads, or yaml.safe_load. Never deserialise an untrusted source.',
  },
  'SEC-JAVA-DESERIALIZE': {
    title: 'ObjectInputStream.readObject',
    message: 'Native Java deserialisation allows gadget-chain execution.',
    suggestion: 'Use a data format (JSON, Protobuf) or a strict ObjectInputFilter.',
  },
  'SEC-PHP-UNSERIALIZE': {
    title: 'unserialize() on external data',
    message: 'unserialize allows arbitrary object instantiation (POP chain).',
    suggestion: 'Use json_decode, or unserialize($data, ["allowed_classes" => false]).',
  },
  'SEC-WEAK-HASH': {
    title: 'Obsolete hashing algorithm',
    message: 'MD5 and SHA-1 are broken for any security purpose.',
    suggestion: 'SHA-256 or above for integrity; bcrypt, scrypt or Argon2id for passwords.',
  },
  'SEC-WEAK-CIPHER': {
    title: 'Weak cipher or ECB mode',
    message: 'Unsafe cipher or mode (ECB does not hide patterns).',
    suggestion: 'Use AES-256-GCM or ChaCha20-Poly1305, with a unique IV/nonce per message.',
  },
  'SEC-WEAK-RANDOM': {
    title: 'Non-cryptographic randomness',
    message: 'Predictable pseudo-random generator.',
    suggestion:
      'For a token, key or password: crypto.randomUUID(), crypto.getRandomValues, secrets.token_urlsafe, SecureRandom.',
  },
  'SEC-TLS-DISABLED': {
    title: 'TLS verification disabled',
    message: 'TLS certificate validation is turned off: the traffic can be intercepted.',
    suggestion:
      'Remove this bypass. In development, add the local certificate to the trust store instead.',
  },
  'SEC-HTTP-URL': {
    title: 'Unencrypted HTTP URL',
    message: 'Call to an external resource in clear text.',
    suggestion: 'Switch the URL to https:// and enable HSTS server-side.',
  },
  'SEC-JWT-NONE': {
    title: 'JWT without signature verification',
    message: 'The JWT is decoded without its signature being verified.',
    suggestion:
      'Use jwt.verify (Node) or jwt.decode(token, key, algorithms=["HS256"]), and explicitly reject the "none" algorithm.',
  },
  'SEC-CORS-WILDCARD': {
    title: 'CORS open to every origin',
    message: 'Every origin is allowed to call the API.',
    suggestion: 'List trusted origins explicitly; * is incompatible with credentials: true.',
  },
  'SEC-CSRF-OFF': {
    title: 'CSRF protection disabled',
    message: 'CSRF protection is explicitly lifted.',
    suggestion:
      'Keep the CSRF token, or use SameSite=Strict/Lax cookies plus origin checking for APIs.',
  },
  'SEC-ALLOWED-HOSTS-WILDCARD': {
    title: 'Allowed hosts unrestricted',
    message:
      'ALLOWED_HOSTS accepts any Host header: cache poisoning and forgeable password-reset links.',
    suggestion:
      'List your real domains: ALLOWED_HOSTS = ["example.com", "www.example.com"]. In development, add only "localhost" and "127.0.0.1".',
  },
  'SEC-SECURE-FLAG-OFF': {
    title: 'Session cookie sent in clear text',
    message:
      'A cookie security flag is explicitly disabled: the session cookie may travel over HTTP or be readable by JavaScript.',
    suggestion:
      'Set these to True in production. Drive them from an environment variable rather than hard-disabling them.',
  },
  'SEC-COOKIE-FLAGS': {
    title: 'Cookie without httpOnly / secure',
    message: 'Cookie readable by JavaScript, or sent in clear text.',
    suggestion: 'Set httpOnly: true, secure: true and sameSite: "lax" (or "strict") on session cookies.',
  },
  'SEC-PERMISSIVE-PERMS': {
    title: 'File permissions too broad',
    message: '777 permissions: the file can be modified by any user on the system.',
    suggestion: 'Use 0644 for files and 0755 for directories; 0600 for secrets.',
  },
  'SEC-PATH-TRAVERSAL': {
    title: 'File path built from input',
    message: 'A file path depends directly on user input: directory traversal is possible.',
    suggestion:
      'Normalise with path.resolve, then check the result starts with the allowed directory; refuse otherwise.',
  },
  'SEC-SSRF': {
    title: 'Outbound request to a supplied URL',
    message: 'The application calls a client-controlled URL: SSRF into the internal network is possible.',
    suggestion:
      'Validate the URL against an allow-list of domains and block private ranges (127.0.0.0/8, 169.254.0.0/16, 10.0.0.0/8).',
  },
  'SEC-OPEN-REDIRECT': {
    title: 'Open redirect',
    message: 'The redirect target comes from the request: phishing is possible.',
    suggestion: 'Accept relative paths only, or validate the target domain against an allow-list.',
  },
  'SEC-DEBUG-ON': {
    title: 'Debug mode enabled',
    message: 'Debug mode exposes stack traces, and sometimes a remote console.',
    suggestion: 'Drive debug mode from an environment variable and force it to false in production.',
  },
  'SEC-BIND-ALL': {
    title: 'Service listening on every interface',
    message: 'The service is exposed on all network interfaces.',
    suggestion: 'Listen on 127.0.0.1 behind a reverse proxy, unless you explicitly need otherwise.',
  },
  'SEC-PROTOTYPE-POLLUTION': {
    title: 'Possible prototype pollution',
    message:
      'Assignment by a key coming from user input: a __proto__ key can pollute Object.prototype.',
    suggestion:
      'Reject the keys __proto__, constructor and prototype, or use Object.create(null) / Map.',
  },
  'SEC-REGEX-DOS': {
    title: 'Regular expression at risk of ReDoS',
    message: 'Nested quantifiers: evaluation time can explode on a crafted input.',
    suggestion: 'Rewrite the pattern without nested quantifiers, or bound the input length.',
  },
  'SEC-LOG-SENSITIVE': {
    title: 'Sensitive data possibly logged',
    message: 'A secret or personal data appears to be written to the logs.',
    suggestion: 'Redact the value (last four characters) or drop the field before logging.',
  },
  'SEC-EMPTY-CATCH': {
    title: 'Error silently swallowed',
    message: 'Empty, uncommented catch block: a failure can go entirely unnoticed.',
    suggestion: 'Log the error, or leave a comment explaining why it is harmless here.',
  },
  'SEC-XXE': {
    title: 'XML parser without XXE protection',
    message: 'XML parser potentially vulnerable to external entities (XXE).',
    suggestion:
      'Disable DTDs and external entities: setFeature("http://apache.org/xml/features/disallow-doctype-decl", true), or defusedxml in Python.',
  },
  'SEC-MASS-ASSIGNMENT': {
    title: 'Mass assignment from the request body',
    message:
      'The request body is passed straight to the model: a private field (role, isAdmin) can be forced.',
    suggestion:
      'Select the allowed fields explicitly before writing (DTO, validation schema, fillable).',
  },
  'SEC-NO-RATE-LIMIT': {
    title: 'Authentication endpoint without rate limiting',
    message: 'Authentication route detected: check that rate limiting is applied.',
    suggestion:
      'Add a rate limiter (express-rate-limit, slowapi, bucket4j) and progressive lockout after failures.',
  },
  'SEC-DOCKER-ROOT': {
    title: 'Container running as root',
    message: 'No non-root USER directive: the process runs as root inside the container.',
    suggestion: 'Add `RUN adduser -D app` then `USER app` before CMD.',
  },
  'SEC-DOCKER-LATEST': {
    title: 'Base image not pinned',
    message: 'FROM ...:latest makes builds non-reproducible and can introduce regressions.',
    suggestion: 'Pin a version, ideally by digest: FROM node:22.3-alpine@sha256:…',
  },
  'SEC-ENV-COMMITTED': {
    title: '.env file committed',
    message: 'A .env file containing values is present in the repository.',
    suggestion:
      'Add .env to .gitignore, rotate the exposed secrets, and commit an empty .env.example instead.',
  },
  'SEC-MISSING-HEADERS': {
    title: 'HTTP security headers missing',
    message: 'No security header configuration detected (CSP, HSTS, X-Frame-Options…).',
    suggestion:
      'Add helmet (Node), SecurityMiddleware (Django), or configure them in nginx/Cloudflare: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.',
  },

  // ------------------------------------------------------------------ SEO
  //
  // Plusieurs messages SEO sont assembles au moment de la detection — ils
  // citent une longueur, un nombre de pages, une balise manquante. Ceux-la
  // n'ont volontairement pas de `message` ici : fournir un texte fixe
  // remplacerait la valeur mesuree par une generalite, ce qui serait pire que
  // le francais.
  'SEO-TITLE-MISSING': {
    title: 'Missing <title> tag',
    message:
      'The page has no title. It is the single most important on-page signal, and the text shown in search results.',
    suggestion:
      'Add a unique <title> of 30 to 60 characters, describing this page specifically.',
  },
  'SEO-TITLE-SHORT': {
    title: 'Title too short',
    suggestion:
      'Add something useful: search intent, city, benefit, or the brand name as a suffix.',
  },
  'SEO-TITLE-LONG': {
    title: 'Title too long',
    suggestion: 'Put the essential information in the first 55 characters.',
  },
  'SEO-TITLE-DUPLICATE': {
    title: 'Several <title> tags',
    suggestion: 'Keep a single title tag in the <head>.',
  },
  'SEO-DESC-MISSING': {
    title: 'Missing meta description',
    message:
      'Without a meta description, the search engine writes its own snippet — often an unappealing one. Click-through rate suffers.',
    suggestion:
      'Add a <meta name="description"> of 120 to 160 characters that gives a reason to click, not a summary of the page.',
  },
  'SEO-DESC-SHORT': { title: 'Meta description too short' },
  'SEO-DESC-LONG': { title: 'Meta description too long' },
  'SEO-LANG-MISSING': {
    title: 'Missing lang attribute on <html>',
    message:
      'The document language is not declared: this affects geographic targeting and screen readers.',
    suggestion: 'Add <html lang="en"> (or the page’s actual language).',
  },
  'SEO-VIEWPORT-MISSING': {
    title: 'Missing viewport meta',
    message:
      'Without a viewport, the page renders at desktop width on mobile. Google indexes mobile-first: this is costly.',
    suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
  },
  'SEO-VIEWPORT-NOZOOM': {
    title: 'Zoom disabled on mobile',
    message: 'The viewport prevents the user from zooming in (WCAG 1.4.4 failure).',
    suggestion: 'Remove user-scalable=no and maximum-scale.',
  },
  'SEO-CHARSET-MISSING': {
    title: 'Character encoding not declared',
    message: 'No <meta charset>: accented characters risk being mangled.',
    suggestion: 'Add <meta charset="utf-8"> as the very first element in the <head>.',
  },
  'SEO-CANONICAL-MISSING': {
    title: 'Missing canonical URL',
    message:
      'Without a canonical, URL variants (UTM parameters, /page and /page/, http and https) are seen as duplicate content.',
    suggestion:
      'Add <link rel="canonical" href="https://your-domain.tld/page-path"> with an absolute, self-referencing URL.',
  },
  'SEO-CANONICAL-RELATIVE': {
    title: 'Relative canonical URL',
    message: 'A relative canonical can be misread during crawling.',
    suggestion: 'Use an absolute URL, protocol and domain included.',
  },
  'SEO-NOINDEX': {
    title: 'Page set to noindex',
    message:
      'This page explicitly asks not to be indexed. Deliberate? A noindex forgotten after staging costs the page all of its traffic.',
    suggestion: 'Confirm this is intentional; otherwise remove the noindex directive.',
  },
  'SEO-H1-MISSING': {
    title: 'No <h1>',
    message:
      'The page has no main heading: the content hierarchy is unreadable for search engines and screen readers alike.',
    suggestion:
      'Add a single <h1> describing the page subject, consistent with the title tag without being identical to it.',
  },
  'SEO-H1-MULTIPLE': {
    title: 'Several <h1> tags',
    suggestion: 'Keep one h1 and demote the others to h2.',
  },
  'SEO-HEADING-SKIP': {
    title: 'Heading level skipped',
    suggestion:
      'Use levels in order. For visual size, use CSS rather than the heading level.',
  },
  'SEO-IMG-ALT-MISSING': {
    title: 'Image without alt attribute',
    message:
      'The image has no text alternative: invisible to Google Images and to screen readers.',
    suggestion:
      'Add alt="useful description of the image". For a purely decorative image, use alt="" — empty, but present.',
  },
  'SEO-IMG-NO-DIMENSIONS': {
    title: 'Image without dimensions',
    message:
      'Without width/height the browser reserves no space: the page jumps while loading (Cumulative Layout Shift).',
    suggestion:
      'Set width and height (the intrinsic values); CSS can then override them in percentages.',
  },
  'SEO-IMG-NO-LAZY': {
    title: 'Image loading not controlled',
    message: 'No loading attribute: every image is fetched immediately.',
    suggestion:
      'loading="lazy" for off-screen images, fetchpriority="high" for the main one (LCP).',
  },
  'SEO-OG-MISSING': {
    title: 'Missing Open Graph tags',
    message:
      'No Open Graph tags: shares on social networks and messaging apps will show an empty preview.',
    suggestion:
      'Add og:title, og:description, og:image (1200x630 px), og:url, og:type, plus twitter:card="summary_large_image".',
  },
  'SEO-OG-INCOMPLETE': {
    title: 'Incomplete Open Graph',
    suggestion: 'Fill in the missing tags for a reliable share preview.',
  },
  'SEO-STRUCTURED-DATA': {
    title: 'No structured data',
    message:
      'The page declares no JSON-LD schema: you are giving up rich results (stars, breadcrumb, FAQ, product).',
    suggestion:
      'Add a <script type="application/ld+json"> block with the right Schema.org type (Organization and WebSite on the home page, BreadcrumbList everywhere, Article / Product / LocalBusiness as appropriate), then validate with Google’s Rich Results Test.',
  },
  'SEO-THIN-CONTENT': {
    title: 'Not enough content',
    suggestion:
      'Enrich the content by genuinely answering the search intent: context, detail, common questions, evidence.',
  },
  'SEO-ANCHOR-GENERIC': {
    title: 'Non-descriptive link text',
    suggestion: 'Use an explicit label: "See our pricing" rather than "Learn more".',
  },
  'SEO-FAVICON-MISSING': {
    title: 'Missing favicon',
    message: 'No link to a site icon.',
    suggestion: 'Add <link rel="icon" href="/favicon.ico"> and a 180x180 apple-touch icon.',
  },
  'SEO-JSONLD-INCOMPLETE': {
    title: 'Incomplete structured data',
    message: 'A structured data block has no @context or @type: it will be ignored.',
    suggestion: 'Add "@context": "https://schema.org" and a valid "@type".',
  },
  'SEO-JSONLD-INVALID': {
    title: 'Invalid structured data',
    suggestion: 'Fix the syntax and validate with the Rich Results Test.',
  },
  'SEO-ROBOTS-MISSING': {
    title: 'robots.txt missing',
    message:
      'No robots.txt file: you do not control what crawlers explore, and you do not point them to your sitemap.',
  },
  'SEO-ROBOTS-BLOCK-ALL': {
    title: 'robots.txt blocks the whole site',
    message: '"Disallow: /" forbids crawling the entire site. No page will be indexed.',
    suggestion:
      'Remove this directive if the site is in production — it is typically a leftover from staging.',
  },
  'SEO-ROBOTS-NO-SITEMAP': {
    title: 'Sitemap not declared in robots.txt',
    message: 'robots.txt does not point to the sitemap.',
    suggestion: 'Add the line: Sitemap: https://your-domain.tld/sitemap.xml',
  },
  'SEO-SITEMAP-MISSING': {
    title: 'sitemap.xml missing',
    message:
      'No sitemap: deep or poorly linked pages risk never being discovered.',
    suggestion:
      'Generate a sitemap.xml at build time (next-sitemap, @nuxtjs/sitemap, django.contrib.sitemaps, spatie/laravel-sitemap) and declare it in robots.txt and Search Console.',
  },
  'SEO-MANIFEST-MISSING': {
    title: 'Web manifest missing',
    message: 'No manifest.json: no install to home screen, no theme-color.',
    suggestion:
      'Add a manifest.json (name, short_name, 192/512 icons, theme_color, display) and reference it in the <head>.',
  },
  'SEO-SPA-NO-SSR': {
    title: 'Client-rendered application without server rendering',
    suggestion:
      'Pre-render at least the public pages (static generation or server rendering), or serve a meaningful HTML shell per route.',
  },
  'SEO-SPA-SHARED-META': {
    title: 'Every route shares the same metadata',
    suggestion: 'Set title, description and canonical per route.',
  },
  'SEO-TITLE-DUPLICATED-PAGES': {
    title: 'Duplicate titles across pages',
    suggestion: 'Give each page a unique title reflecting its specific content.',
  },
  'SEO-DESC-DUPLICATED-PAGES': {
    title: 'Duplicate meta descriptions across pages',
    suggestion: 'Write a description specific to each page.',
  },

  // -------------------------------------------------- Design et accessibilite
  //
  // Meme regle que pour le SEO : les messages qui citent une valeur mesuree
  // (un ratio de contraste, un nombre de couleurs) restent en francais tant
  // qu'ils ne sont pas passes par `t()`. Leur titre et leur conseil, eux, sont
  // fixes — donc traduisibles.
  'A11Y-CONTRAST': {
    title: 'Insufficient contrast',
    suggestion:
      'Darken the text or lighten the background. Contrast determines readability for one person in twelve (colour vision deficiency, ageing eyes, screen in sunlight).',
  },
  'A11Y-FOCUS-REMOVED': {
    title: 'Focus indicator removed',
    message: 'outline: none with no replacement style: keyboard navigation becomes invisible.',
    suggestion:
      'Replace it with an explicit style: :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }',
  },
  'DESIGN-FONT-TOO-SMALL': {
    title: 'Text too small',
    suggestion:
      'Use at least 14px for secondary text and 16px for body copy. Express sizes in rem so browser preferences are respected.',
  },
  'DESIGN-TAP-TARGET': {
    title: 'Tap target too small',
    suggestion:
      'Increase min-height/min-width, or enlarge the clickable area with padding without changing the visual size.',
  },
  'DESIGN-NO-SELECT': {
    title: 'Text selection disabled globally',
    message:
      'Preventing text selection across the whole page blocks copying, translation and assistive tools.',
    suggestion:
      'Limit user-select: none to interface elements (handles, buttons), never to content.',
  },
  'DESIGN-IMPORTANT-OVERUSE': {
    title: 'Excessive use of !important',
    suggestion:
      'Reduce the specificity of competing selectors, or adopt a convention (BEM, utilities, @layer) rather than forcing.',
  },
  'DESIGN-ZINDEX-CHAOS': {
    title: 'Unmanaged z-index stacking',
    suggestion:
      'Define a scale in CSS variables (--z-dropdown: 10; --z-modal: 100; --z-toast: 1000) and use only those values.',
  },
  'A11Y-NO-ACCESSIBLE-NAME': {
    suggestion:
      'Add visible text, or aria-label="Close dialog" if the element contains only an icon. Mark the decorative icon with aria-hidden="true".',
  },
  'A11Y-LINK-NO-HREF': {
    title: 'Link without href',
    message: 'An <a> without href is not keyboard-focusable and is not announced as a link.',
    suggestion: 'Use <button> for an action, or give the link a real href.',
  },
  'A11Y-INPUT-NO-LABEL': {
    title: 'Form field without a label',
    suggestion:
      'Associate a <label for="field-id">, or add aria-label where a visible label is impossible.',
  },
  'UX-NO-AUTOCOMPLETE': {
    title: 'Field without autocomplete',
    message:
      'Without an autocomplete attribute the browser cannot pre-fill the field: needless friction, especially on mobile.',
    suggestion:
      'Add autocomplete="email" / "tel" / "current-password" / "name" as appropriate.',
  },
  'A11Y-CLICKABLE-DIV': {
    message:
      'A non-interactive element carries a click handler: unreachable by keyboard and invisible to assistive technology.',
    suggestion:
      'Use <button type="button">. If that is impossible, add role="button", tabindex="0" and a keyboard handler (Enter and Space).',
  },
  'A11Y-POSITIVE-TABINDEX': {
    title: 'Positive tabindex',
    suggestion:
      'Use only tabindex="0" (focusable) or "-1" (focusable by script), and reorder the DOM to get the right sequence.',
  },
  'DESIGN-INLINE-STYLE': {
    title: 'Large inline style',
    suggestion: 'Move these declarations into a class or a styled component.',
  },
  'A11Y-IFRAME-NO-TITLE': {
    title: 'iframe without a title',
    message: 'A frame with no title attribute is announced as "frame" with no hint of its content.',
    suggestion: 'Add title="Location map" (or any label describing the embedded content).',
  },
  'A11Y-TABLE-NO-HEADERS': {
    title: 'Table without headers',
    message:
      'No <th> cell: a screen reader cannot associate a value with its column.',
    suggestion:
      'Add a <thead> row with <th scope="col">, and a <caption> describing the table.',
  },
  'UX-AUTOFOCUS': {
    title: 'autofocus on a field',
    message:
      'Automatic focus moves the context on arrival and can make the viewport jump on mobile.',
    suggestion: 'Use it only on a page dedicated to a single action (search, sign-in).',
  },
  'A11Y-NO-MAIN-LANDMARK': {
    title: 'No <main> landmark',
    message:
      'The page has no main region: screen reader users cannot jump straight to the content.',
    suggestion:
      'Structure the page with <header>, <nav>, <main>, <footer>, and add a "Skip to content" link at the start of the document.',
  },
  'A11Y-NO-SKIP-LINK': {
    title: 'No skip link',
    message:
      'No link to bypass navigation: every page forces the user to tab through the whole menu.',
    suggestion:
      'Add as the first element of the body: <a class="skip-link" href="#content">Skip to content</a>, visible on focus.',
  },
  'DESIGN-COLOR-SPRAWL': {
    title: 'Inconsistent colour palette',
    suggestion:
      'Define a palette of 8 to 12 tokens in CSS variables (primary, secondary, four greys, success, warning, error) and replace the hard-coded values.',
  },
  'DESIGN-TYPE-SCALE': {
    title: 'Unmanaged type scale',
    suggestion:
      'Adopt a modular scale (12, 14, 16, 20, 24, 32, 48) expressed in rem, and allow only those values.',
  },
  'DESIGN-SPACING-SCALE': {
    title: 'Spacing off the grid',
    suggestion:
      'Base every spacing value on a 4 or 8px grid: --space-1: 4px … --space-8: 64px.',
  },
  'DESIGN-NO-TOKENS': {
    title: 'No design tokens',
    message:
      'No CSS or Sass variable was found: every colour, spacing and typography value is repeated by hand.',
    suggestion:
      'Create a tokens.css with :root { --color-primary; --color-text; --space-*; --radius-*; --font-* } and reference those variables. It is the prerequisite for a dark theme.',
  },
  'DESIGN-TOO-MANY-FONTS': {
    title: 'Too many font families',
    suggestion:
      'Limit yourself to two families (headings + body), three at most counting monospace.',
  },
  'DESIGN-NO-DARK-MODE': {
    title: 'No dark theme',
    message:
      'No prefers-color-scheme support. A significant share of users browse in dark mode by default.',
    suggestion:
      'Define your colours as variables, then override them inside @media (prefers-color-scheme: dark).',
  },
  'A11Y-NO-REDUCED-MOTION': {
    title: 'Animations ignoring prefers-reduced-motion',
    message:
      'Animations are defined with no alternative for people sensitive to motion (dizziness, vestibular disorders).',
    suggestion:
      '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }',
  },
  'DESIGN-NO-BREAKPOINTS': {
    title: 'No responsive breakpoints',
    message:
      'No media query in the stylesheets: the layout does not adapt to small screens. More than half of web traffic is mobile, and Google indexes mobile-first.',
    suggestion:
      'Take a mobile-first approach: write the small-screen styles, then add @media (min-width: 640px), 768px, 1024px, 1280px. Check every page at 360px wide.',
  },
  'DESIGN-TOO-MANY-BREAKPOINTS': {
    title: 'Too many breakpoints',
    suggestion:
      'Standardise on three or four breakpoints held in variables, and prefer fluid units (clamp(), minmax(), %) over steps.',
  },
  'DESIGN-FIXED-WIDTH': {
    title: 'Fixed width wider than mobile screens',
    suggestion:
      'Replace with max-width plus width: 100%, or use min(1200px, 100% - 2rem).',
  },

  // ---------------------------------------------------------- Performance
  //
  // Les regles issues d'un chargement mesure (`argus perf`) ont un titre
  // dynamique : il cite la valeur relevee. Seul leur conseil est fixe.
  'PERF-HEAVY-IMAGE': {
    title: 'Image too heavy',
    suggestion:
      'Convert to AVIF or WebP, resize to the largest displayed size, and serve several widths through srcset.',
  },
  'PERF-HEAVY-SVG': {
    title: 'Unoptimised SVG',
    suggestion: 'Run the file through SVGO (npx svgo --multipass); the saving often exceeds 60 %.',
  },
  'PERF-HEAVY-ASSET': { title: 'Large asset' },
  'PERF-TOTAL-IMAGES': {
    title: 'High total image weight',
    suggestion:
      'Set up a build-time optimisation pipeline (sharp, imagemin, next/image, or an image CDN).',
  },
  'PERF-BLOCKING-SCRIPT': {
    title: 'Render-blocking script in the <head>',
    suggestion:
      'Add defer (runs after parsing, order preserved) or async (independent). Move to the end of <body> as a last resort.',
  },
  'PERF-TOO-MANY-CSS': {
    title: 'Too many stylesheets',
    suggestion:
      'Concatenate the sheets at build time, inline the critical CSS (~14 KB) and defer the rest.',
  },
  'PERF-NO-PRECONNECT': {
    title: 'External origins without preconnect',
    suggestion:
      'Add <link rel="preconnect" href="https://external-domain" crossorigin> for critical origins (fonts, CDN).',
  },
  'PERF-FONT-FORMAT': {
    title: 'Font in an unoptimised format',
    suggestion: 'Convert to WOFF2 (fonttools, woff2_compress) and serve only that format.',
  },
  'PERF-FONT-DISPLAY': {
    title: 'font-display not set',
    message:
      'Without font-display the text stays invisible while the font loads (Flash of Invisible Text): up to three seconds of blank page.',
    suggestion:
      'Add font-display: swap; to every @font-face block, and preload the font used by the main heading.',
  },
  'PERF-AWAIT-IN-LOOP': {
    title: 'await inside a loop',
    message:
      'Each iteration waits for the previous one: total time is the sum of the calls instead of the longest one.',
    suggestion:
      'Run the operations in parallel: await Promise.all(items.map(async (item) => …)). Bound the concurrency if the target service is fragile.',
  },
  'PERF-NESTED-LOOP-QUERY': {
    title: 'Query inside a loop (N+1 problem)',
    message:
      'One query per item: the number of database calls grows linearly with the data.',
    suggestion:
      'Load everything in one query (WHERE id IN (…), a join, or your ORM’s eager loading) then group in memory.',
  },
  'PERF-DOM-IN-LOOP': {
    title: 'DOM manipulation inside a loop',
    message: 'Every insertion triggers a layout recalculation.',
    suggestion: 'Build a DocumentFragment (or a string) then insert it in a single operation.',
  },
  'PERF-SYNC-IO': {
    title: 'Synchronous input/output',
    message:
      'A synchronous operation blocks the event loop: every in-flight request is put on hold.',
    suggestion:
      'Use the asynchronous version (fs/promises). Synchronous calls are acceptable only at start-up.',
  },
  'PERF-SELECT-STAR': {
    title: 'SELECT * in the database',
    message: 'Every column is transferred, including large fields you do not need.',
    suggestion:
      'List the columns you need explicitly: it is faster, and it avoids surprises when the schema changes.',
  },
  'PERF-MOMENT': {
    title: 'moment.js library',
    message: 'moment.js adds roughly 290 KB to the bundle and is no longer maintained.',
    suggestion:
      'Move to date-fns (modular), day.js (2 KB), or the native Intl.DateTimeFormat / Temporal API.',
  },
  'PERF-FULL-LODASH': {
    title: 'Whole-library lodash import',
    suggestion:
      'Import only what you use (lodash-es with named imports), or replace the handful of helpers with native equivalents.',
  },
  'PERF-HEAVY-DEPENDENCY': {
    suggestion:
      'Check that only the needed modules are imported, and measure the real impact with a bundle analyser before deciding.',
  },
  'PERF-NO-BUILD-STEP': {
    title: 'No build step',
    suggestion:
      'Add Vite with a minimal configuration: minification, automatic code splitting and tree-shaking for very little setup.',
  },
  'PERF-LCP-LENT': {
    suggestion:
      'Identify that element — usually a banner image or a heading waiting for a font. Prefer fetchpriority="high" on the image, preload on the font, and remove whatever blocks rendering before it.',
  },
  'PERF-CLS-INSTABLE': {
    suggestion:
      'Reserve the space before loading: width and height on every image, a minimum height on areas filled by JavaScript, and font-display: optional rather than swap if the font swap shifts the text.',
  },
  'PERF-TTFB-LENT': {
    suggestion:
      'Look at server rendering, database queries on the critical path, and caching. A CDN helps mainly when your visitors are far from your server.',
  },
  'PERF-REQUETES-NOMBREUSES': {
    suggestion:
      'Bundle what can be bundled, defer what is not immediately visible, and check how much comes from third-party scripts.',
  },

  // ------------------------------------------------- Code mort, qualite, routes
  'DEAD-FILE': {
    title: 'File never imported',
    suggestion:
      'Check that it is not loaded dynamically (import(), reflection, naming convention). If not, delete it: every dead file slows down reading the project and inflates the bundle.',
  },
  'DEAD-EXPORT': {
    title: 'Export never used',
    suggestion:
      'Drop the export keyword if the symbol is still useful internally, or remove it. An unused export prevents tree-shaking from doing its job.',
  },
  'DEAD-IMPORT': {
    title: 'Unused import',
    suggestion:
      'Remove this import. In client-side code, an unused import can pull an entire library into the bundle.',
  },
  'DEAD-LOCAL': {
    title: 'Unused local declaration',
    suggestion:
      'Remove the declaration, or use it if it was meant for work in progress.',
  },
  'DEAD-UNREACHABLE': {
    title: 'Unreachable code',
    suggestion:
      'Delete this code, or move it before the exit statement if it was meant to run.',
  },
  'DEAD-COMMENTED-CODE': {
    title: 'Commented-out code block',
    suggestion:
      'Delete this block: Git keeps the history. A commented block ages and ends up lying about the real behaviour.',
  },
  'DEAD-ASSET': {
    title: 'Asset never referenced',
    suggestion:
      'Delete the asset if it is obsolete. Check first for dynamically built references.',
  },
  'DEP-DEPRECATED': {
    suggestion:
      'Plan a replacement. An unmaintained dependency will never receive a security fix.',
  },
  'DEP-CACHE-STALE': { title: 'Vulnerability database out of date' },
  'DEP-NO-OSV-SYNC': {
    title: 'Vulnerability database not synchronised',
    suggestion:
      'Run `argus sync` once: Argus queries the official OSV.dev database (GitHub Advisories, CVE, PyPA, RustSec…) and writes a local cache. Later analyses stay entirely offline.',
  },
  'DEP-UNPINNED': {
    title: 'Unconstrained dependencies',
    suggestion: 'Set an explicit range (^1.2.3) and commit the lockfile.',
  },
  'DEP-UNUSED': {
    suggestion:
      'Check that it is not used through a plugin or a binary, then uninstall it. Every needless dependency is bundle weight and attack surface.',
  },
  'DEP-NO-LOCKFILE': {
    title: 'Lockfile missing',
    message:
      'No package-lock.json / yarn.lock / pnpm-lock.yaml: installs are not reproducible, and a compromised transitive version can arrive unnoticed.',
    suggestion: 'Run npm install and commit the generated lockfile. In CI, use npm ci.',
  },
  'QUAL-FILE-TOO-LONG': {
    title: 'File too long',
    suggestion:
      'Find the groups of functions that share the same state or domain and extract them into dedicated modules. Start with what changes most often.',
  },
  'QUAL-HIGH-COMPLEXITY': {
    title: 'Function too complex',
    suggestion:
      'Extract branches into named functions, replace condition cascades with a lookup table, and return early instead of nesting.',
  },
  'QUAL-LONG-FUNCTION': {
    title: 'Function too long',
    suggestion:
      'Split it along its logical steps: a function should fit on one screen and do one thing.',
  },
  'QUAL-TOO-MANY-PARAMS': {
    title: 'Too many parameters',
    suggestion: 'Group related parameters into a named options object.',
  },
  'QUAL-DEEP-NESTING': {
    title: 'Deep nesting',
    suggestion:
      'Invert conditions to return early, extract inner blocks into functions, and replace nested loops with collection operations.',
  },
  'QUAL-DUPLICATION': {
    title: 'Code duplicated across files',
    suggestion:
      'Extract the block into a shared function or component. While the duplication exists, every fix has to be applied several times — and one will be forgotten.',
  },
  'QUAL-NO-README': {
    title: 'README missing',
    message:
      'The project has no README: nothing explains how to install it, how to run it, or what it does.',
    suggestion:
      'Add a README covering: the purpose of the project, prerequisites, installation, development commands, folder structure, and the deployment procedure.',
  },
  'QUAL-THIN-README': {
    title: 'README too thin',
    suggestion:
      'Document at minimum the installation, running it locally, and the environment variables it needs.',
  },
  'QUAL-NO-TEST-SCRIPT': {
    title: 'No test script',
    message: 'package.json defines no "test" script.',
    suggestion:
      'Add a test script, however minimal: it is the entry point every CI system expects.',
  },
  'QUAL-NO-LINTER': {
    title: 'No linter configured',
    message:
      'Neither ESLint nor Biome is configured: avoidable mistakes are only caught at run time.',
    suggestion:
      'Add ESLint or Biome with the recommended configuration, and wire it to a pre-commit hook.',
  },
  'QUAL-NO-CI': {
    title: 'No continuous integration',
    message: 'No CI configuration detected: nothing checks contributions automatically.',
    suggestion:
      'Add a workflow that runs the tests, the linter and this analysis (argus scan --ci) on every pull request.',
  },
  'QUAL-NO-TESTS': {
    title: 'No automated tests',
    suggestion:
      'Start with the critical paths: authentication, payment, business calculations. One test per business rule already delivers most of the benefit.',
  },
  'QUAL-LOW-TEST-RATIO': {
    title: 'Test coverage probably low',
    suggestion:
      'Aim for at least one test file per business module, and measure real coverage with your test runner.',
  },
  'ROUTE-DUPLICATE': {
    title: 'Route declared more than once',
    suggestion: 'Remove or merge the redundant declarations.',
  },
  'ROUTE-DOUBLE-SLASH': {
    title: 'Double slash in the route',
    suggestion:
      'Normalise the path, or use a join helper that removes extra separators.',
  },
  'ROUTE-UPPERCASE': {
    title: 'Uppercase letters in a URL',
    suggestion:
      'Use lowercase URLs with hyphens (kebab-case) and 301-redirect the old form.',
  },
  'ROUTE-UNDERSCORE': {
    title: 'Underscore in a page URL',
    suggestion: 'Prefer /my-article over /my_article.',
  },
  'ROUTE-TOO-DEEP': {
    title: 'URL too deep',
    suggestion:
      'Flatten the URL hierarchy; the navigation depth can stay the same.',
  },
  'ROUTE-ORPHAN': {
    title: 'Orphan route (no inbound link)',
    suggestion:
      'Add a link from the navigation or a relevant page, list the URL in sitemap.xml — or delete the page if it no longer has a reason to exist.',
  },
  'ROUTE-TARGET-BLANK': {
    title: 'target="_blank" without rel="noopener"',
    message:
      'The opened page gets a window.opener reference back to yours: it can redirect it (tabnabbing).',
    suggestion: 'Add rel="noopener noreferrer" to this link.',
  },
  'ROUTE-NO-404': {
    title: 'No 404 page defined',
    message:
      'No fallback route or 404 page was found. Wrong URLs return a blank page or a server error.',
    suggestion:
      'Add a useful 404 page: a clear message, a search field, links to the main sections. It must return a real HTTP 404 status (not 200).',
  },
  'ROUTE-BROKEN-LINK': {
    title: 'Dead internal link',
    suggestion:
      'Fix the target, create the missing page, or set up a 301 redirect if the URL has changed.',
  },
  'ROUTE-UNKNOWN-NAME': {
    title: 'Unknown named route',
    suggestion: 'Check the route name (name=/as=), or fix the call.',
  },

  // ------------------------------------------------------ Exploration HTTP
  //
  // Ces constats viennent d'un site reellement interroge : leurs messages
  // citent presque tous une URL, un code de statut ou une mesure. Le titre et
  // le conseil, en revanche, sont fixes.
  'CRAWL-UNREACHABLE': {
    title: 'Page unreachable',
    suggestion:
      'Check that the server responds and that its response time stays within a few seconds.',
  },
  'CRAWL-SERVER-ERROR': {
    suggestion:
      'Check the server logs for this URL. A 5xx error met by a crawler lowers the trust given to the whole site.',
  },
  'CRAWL-BROKEN-PAGE': {
    suggestion:
      'Fix the linking page, or set up a 301 redirect to whatever replaces this one.',
  },
  'CRAWL-ROBOTS-BLOCKED': {
    title: 'Page blocked by robots.txt',
    suggestion:
      'If the page should be indexed, remove the matching Disallow directive. Otherwise, remove the internal links pointing to it as well.',
  },
  'CRAWL-REDIRECT-CHAIN': {
    title: 'Redirect chain',
    suggestion: 'Replace the chain with a single redirect to the final URL.',
  },
  'CRAWL-TEMPORARY-REDIRECT': {
    title: 'Temporary redirect',
    suggestion: 'If the change is permanent, use a 301 (or 308) status.',
  },
  'CRAWL-VERSION-DISCLOSURE': {
    title: 'Technology and version disclosed',
    suggestion:
      'Hide these headers (server_tokens off in nginx, app.disable("x-powered-by") with Express).',
  },
  'CRAWL-NO-HTTPS': {
    title: 'Site served over HTTP',
    suggestion:
      'Install a certificate (Let’s Encrypt is free), 301-redirect all HTTP to HTTPS, then enable HSTS.',
  },
  'CRAWL-MIXED-CONTENT': {
    title: 'Mixed content',
    suggestion: 'Switch these resources to https://, or host them on your own domain.',
  },
  'CRAWL-EXTERNAL-DEAD': {
    title: 'Dead external link',
    suggestion:
      'Update the link, point to an archive (web.archive.org), or remove it. Dead links erode visitors’ trust.',
  },
  'CRAWL-EMPTY-HTML': {
    title: 'Page empty in the served HTML',
    suggestion:
      'Set up server rendering or pre-rendering for public pages. It is the most expensive SEO problem a client-rendered application can have.',
  },
  'CRAWL-NOINDEX-LIVE': {
    title: 'Live page marked noindex',
    suggestion:
      'If this page should appear in search results, remove the noindex directive. It is frequently a leftover from staging.',
  },
  'CRAWL-CANONICAL-MISMATCH': {
    title: 'Diverging canonical URL',
    suggestion: 'Check that the canonical is self-referencing on pages meant to be indexed.',
  },
  'CRAWL-DUPLICATE-TITLE': {
    title: 'Identical title on several live pages',
    suggestion:
      'Give each page a unique title. Observed on the production site, this is no longer a hypothesis.',
  },
  'CRAWL-SLOW-RESPONSE': {
    title: 'High server response time',
    suggestion:
      'Look for the cause server-side: unindexed queries, missing cache, synchronous external calls. A page cache or a CDN often halves it.',
  },
  'CRAWL-NO-COMPRESSION': {
    title: 'HTML responses not compressed',
    suggestion:
      'Enable Brotli or gzip on your server: HTML typically compresses to 20 % of its size, for one line of configuration.',
  },
  'CRAWL-NO-CACHE-HEADER': {
    title: 'Static assets without cache headers',
    suggestion:
      'Serve versioned assets with Cache-Control: public, max-age=31536000, immutable.',
  },
  'CRAWL-NO-ROBOTS': {
    title: 'robots.txt missing in production',
    suggestion: 'Publish a robots.txt, if only to declare your sitemap in it.',
  },
  'CRAWL-ROBOTS-BLOCKS-ALL': {
    title: 'robots.txt blocks the whole live site',
    suggestion:
      'Remove this directive immediately if the site is meant to be indexed. It is almost always a go-live oversight.',
  },
  'CRAWL-ROBOTS-NO-SITEMAP': {
    title: 'Sitemap not declared in production',
    message: 'The live robots.txt mentions no sitemap.',
  },
  'CRAWL-ROUTE-NOT-REACHED': {
    title: 'Routes in the code never reached live',
    suggestion:
      'Either these pages are linked from nowhere (add them to the navigation or the sitemap), or they are not deployed. Check which of the two it is.',
  },

  // -------------------------------------------------- Packs de frameworks
  //
  // Les titres qui nomment une valeur relevee (« NEXT_PUBLIC_X est publiee »)
  // restent dynamiques : seul leur conseil figure ici.
  'ANDROID-TRUSTMANAGER-PERMISSIF': {
    title: 'TrustManager accepting every certificate',
    message:
      'checkServerTrusted has an empty body. By contract, raising no exception means "this certificate is valid": the app therefore accepts any certificate, including an interceptor’s on a shared Wi-Fi network. HTTPS no longer protects anything.',
    suggestion:
      'Remove this TrustManager. For a staging server with a self-signed certificate, declare the authority in a network_security_config.xml limited to the debug variant — the chain stays verified.',
  },
  'ANDROID-HOSTNAME-NON-VERIFIE': {
    title: 'Hostname never verified',
    message:
      'The hostname verifier always returns true: a valid certificate issued for another domain is accepted. The chain is checked, but nothing guarantees you are talking to the right server.',
    suggestion:
      'Remove this verifier to fall back to the system one. If one domain must be tolerated, compare it explicitly rather than returning true.',
  },
  'ANDROID-WEBVIEW-ACCES-FICHIER': {
    title: 'WebView with file system access',
    suggestion:
      'Leave these settings at false. To display local content, serve it from the assets with WebViewAssetLoader, and restrict navigation via shouldOverrideUrlLoading.',
  },
  'ANDROID-PREFS-NON-CHIFFRE': {
    title: 'Secret in SharedPreferences',
    suggestion:
      'Use EncryptedSharedPreferences (androidx.security-crypto), backed by the hardware Keystore. SharedPreferences is fine for the chosen theme or the last open tab.',
  },
  'ANGULAR-BYPASS-SECURITY': {
    suggestion:
      'Sanitise the value before, or restructure so the untrusted content never becomes HTML.',
  },
  'ANGULAR-INNERHTML-BINDING': {
    title: '[innerHTML] binding',
    suggestion: 'Prefer interpolation, or sanitise explicitly with DomSanitizer.',
  },
  'ASTRO-SET-HTML': {
    title: 'HTML injected without escaping',
    suggestion: 'Sanitise the value, or render it as text.',
  },
  'ASTRO-CLIENT-ONLY': {
    title: 'Component rendered in the browser only',
    suggestion:
      'Use client:load or client:visible so the markup exists in the server response.',
  },
  'ASTRO-VITE-DEFINE-SECRET': {
    title: 'Secret injected into the bundle by vite.define',
    suggestion: 'Read the value server-side, and never expose it through define.',
  },
  'DJANGO-CSRF-TOKEN-MISSING': {
    title: 'POST form without {% csrf_token %}',
    suggestion: 'Add {% csrf_token %} inside the <form> tag.',
  },
  'DJANGO-URL-UNKNOWN': {
    title: 'Unknown route name in a template',
    suggestion: 'Check the name= of the matching path(), or fix the template.',
  },
  'DJANGO-HARDENING-MISSING': {
    title: 'Django hardening settings missing',
    suggestion:
      'Enable SECURE_HSTS_SECONDS, SECURE_SSL_REDIRECT, SESSION_COOKIE_SECURE and CSRF_COOKIE_SECURE in production.',
  },
  'DJANGO-SECRET-KEY-HARDCODED': {
    title: 'SECRET_KEY hard-coded',
    suggestion:
      'Read it from the environment: SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]. Rotate the exposed key.',
  },
  'DJANGO-CHARFIELD-NULL': {
    title: 'null=True on a text field',
    suggestion:
      'Use blank=True alone: Django then stores an empty string, avoiding two ways of saying "empty".',
  },
  'ELECTRON-NODE-INTEGRATION': {
    title: 'Node.js reachable from the renderer process',
    message:
      'With nodeIntegration, the page has require — therefore child_process and fs. Any script injection (a compromised dependency, remote content, a badly escaped string) becomes arbitrary code execution on the user’s machine.',
    suggestion:
      'Leave nodeIntegration at false and expose what the interface needs through a preload script and contextBridge.exposeInMainWorld, exposing precise functions rather than whole modules.',
  },
  'ELECTRON-CONTEXT-ISOLATION': {
    title: 'Context isolation disabled',
    message:
      'Without isolation, the preload script and the page share the same JavaScript context: the page can redefine the prototypes your preload relies on and hijack what it exposes. This is the classic Electron prototype-pollution vector.',
    suggestion: 'Set contextIsolation back to true and route exchanges through contextBridge.',
  },
  'ELECTRON-WEB-SECURITY': {
    title: 'Same-origin policy disabled',
    message:
      'webSecurity: false removes the same-origin policy. The page can read any remote URL and any local file. It is often added to work around a CORS error in development, then forgotten.',
    suggestion:
      'Remove this setting and fix CORS at the source: serve files through a custom protocol (protocol.handle) or route requests through the main process.',
  },
  'ELECTRON-CONTENU-NON-SUR': {
    title: 'Insecure content allowed in an HTTPS page',
    message:
      'The window accepts scripts and styles over HTTP from an HTTPS page. A network interceptor can replace that content, and the resulting script runs with the page’s privileges.',
    suggestion: 'Remove this setting and serve every resource over HTTPS.',
  },
  'EXPRESS-SESSION-COOKIE': {
    title: 'Session cookie insufficiently protected',
    suggestion: 'Set cookie: { httpOnly: true, secure: true, sameSite: "lax" }.',
  },
  'EXPRESS-SESSION-UNINITIALIZED': {
    title: 'Session created for every visitor',
    suggestion: 'Set saveUninitialized: false to only persist sessions that hold something.',
  },
  'EXPRESS-STATIC-DOTFILES': {
    title: 'Hidden files served publicly',
    suggestion: 'Remove dotfiles: "allow" — it exposes .env and .git/config.',
  },
  'EXPRESS-STACK-LEAK': {
    title: 'Exception trace returned to the client',
    suggestion:
      'Log the trace server-side and return a generic message with a correlation identifier.',
  },
  'EXPRESS-NO-BODY-LIMIT': {
    title: 'Request body without a size limit',
    suggestion: 'Set an explicit limit: express.json({ limit: "100kb" }).',
  },
  'FASTAPI-CORS-CREDENTIALS': {
    title: 'Open CORS combined with credentials',
    suggestion:
      'List the allowed origins explicitly. The specification forbids combining a wildcard with credentials.',
  },
  'FASTAPI-NO-RESPONSE-MODEL': {
    title: 'Endpoint without response_model',
    suggestion:
      'Declare response_model=… so the output schema is explicit and internal fields cannot leak.',
  },
  'FLASK-SECRET-KEY-HARDCODED': {
    title: 'SECRET_KEY hard-coded',
    suggestion: 'Read it from the environment and rotate the exposed key.',
  },
  'FLASK-SEND-FILE-TRAVERSAL': {
    title: 'File path taken from the request',
    suggestion:
      'Use send_from_directory with a fixed base directory, and validate the file name.',
  },
  'FLASK-NO-CSRF': {
    title: 'No CSRF protection',
    message:
      'Flask provides no CSRF protection by default, and none was found: any site can make an authenticated user submit your forms.',
    suggestion: 'Install Flask-WTF and enable CSRFProtect(app).',
  },
  'FLUTTER-PREFS-NON-CHIFFRE': {
    title: 'Secret in SharedPreferences',
    suggestion:
      'Use flutter_secure_storage, backed by the Android Keystore and the iOS Keychain. SharedPreferences is fine for the chosen theme or the last open tab.',
  },
  'FLUTTER-TLS-DESACTIVE': {
    title: 'TLS certificate validation disabled',
    message:
      'badCertificateCallback returns true: the app accepts any certificate, including an interceptor’s on a public Wi-Fi network. HTTPS no longer protects anything.',
    suggestion:
      'Remove this callback. For a self-signed certificate in development, load it as a trusted authority through SecurityContext, and only in debug mode (kDebugMode).',
  },
  'IOS-USERDEFAULTS-SECRET': {
    title: 'Secret in UserDefaults',
    suggestion:
      'Store the value in the Keychain (Keychain Services, or a wrapper such as KeychainAccess). UserDefaults is fine for the chosen theme or the last open tab.',
  },
  'IOS-TROUSSEAU-TOUJOURS-ACCESSIBLE': {
    title: 'Keychain item readable while the device is locked',
    message:
      'kSecAttrAccessibleAlways makes the item readable even when the device is locked, so without the passcode ever being entered. Apple deprecated the constant for that reason.',
    suggestion:
      'Switch to kSecAttrAccessibleWhenUnlockedThisDeviceOnly, or kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly if background work needs it after a restart.',
  },
  'IOS-TLS-NON-EVALUE': {
    title: 'Server certificate accepted without evaluation',
    message:
      'The authentication challenge is resolved by returning the trust the server offered, without ever evaluating it. Any certificate is therefore accepted, including an interceptor’s.',
    suggestion:
      'Evaluate the trust with SecTrustEvaluateWithError before building the credential, and answer .cancelAuthenticationChallenge on failure. For pinning, compare the public key after evaluation.',
  },
  'LARAVEL-CSRF-MISSING': {
    title: 'POST form without @csrf',
    suggestion: 'Add @csrf inside the <form> tag.',
  },
  'LARAVEL-ENV-OUTSIDE-CONFIG': {
    title: 'env() called outside a configuration file',
    message:
      'After config:cache, env() returns null outside config/ — silently. The value seems present in development and vanishes in production.',
    suggestion: 'Move the value into config/ and read it with config("…").',
  },
  'LARAVEL-GUARDED-EMPTY': {
    title: 'Mass-assignment protection disabled',
    suggestion: 'Use $fillable with the explicit list of writable fields.',
  },
  'LARAVEL-MODEL-NO-HIDDEN': {
    title: 'Sensitive field not hidden from responses',
    suggestion: 'Add the field to $hidden so it never appears in a serialised model.',
  },
  'MOBILE-TRAFIC-EN-CLAIR': {
    title: 'Cleartext HTTP traffic allowed',
    message:
      'The app accepts unencrypted HTTP connections. On a shared Wi-Fi network, request contents — tokens included — travel readable and modifiable. Android has blocked this by default since API 28; this setting removes the protection for the whole app.',
    suggestion:
      'Remove the attribute. If a development server must stay on HTTP, isolate it in a network_security_config.xml limited to its domain and applied to the debug variant only.',
  },
  'MOBILE-DEBUGGABLE': {
    title: 'App shippable in debug mode',
    message:
      'android:debuggable="true" in the manifest lets anyone attach a debugger to the process on a non-rooted device: memory, variables and tokens in use become readable.',
    suggestion:
      'Remove the attribute from the manifest. Gradle already sets it correctly per build type; writing it by hand short-circuits that.',
  },
  'MOBILE-SAUVEGARDE-OUVERTE': {
    title: 'App data backup allowed',
    message:
      'allowBackup lets the app’s private data be extracted over adb, without root. Everything stored in clear — preferences, SQLite database, tokens — comes out with it.',
    suggestion:
      'Set android:allowBackup="false", or declare dataExtractionRules that explicitly exclude sensitive files.',
  },
  'MOBILE-ATS-DESACTIVE': {
    title: 'App Transport Security disabled',
    message:
      'NSAllowsArbitraryLoads lifts iOS transport requirements for every destination: cleartext HTTP accepted, legacy TLS accepted. Apple requires a justification for this key at review, which says enough about its scope.',
    suggestion:
      'Remove the key. For one domain that cannot yet use HTTPS, use NSExceptionDomains limited to that domain.',
  },
  'NEXTJS-NO-HEADERS': {
    title: 'No security headers configured',
    suggestion: 'Add a headers() function in next.config.js, or use next-safe.',
  },
  'NEXTJS-API-NO-METHOD-CHECK': {
    title: 'API route without a method check',
    suggestion:
      'Check req.method and return 405 for anything else: a GET should not trigger a write.',
  },
  'NUXT-SSR-DISABLED': {
    title: 'Server rendering disabled',
    suggestion:
      'Leave ssr: true unless you are deliberately shipping a client-only application — crawlers and share previews see an empty page otherwise.',
  },
  'NUXT-DEVTOOLS-ENABLED': {
    title: 'Nuxt DevTools enabled unconditionally',
    suggestion: 'Condition it on the environment: devtools: { enabled: !isProduction }.',
  },
  'RAILS-CSRF-DISABLED': {
    title: 'CSRF verification disabled',
    suggestion:
      'Keep protect_from_forgery. For an API, use a token-based scheme rather than turning the check off.',
  },
  'RAILS-PERMIT-ALL': {
    title: 'Strong parameters bypassed',
    suggestion: 'List the permitted attributes explicitly with params.require(:x).permit(:a, :b).',
  },
  'RAILS-SQL-INTERPOLATION': {
    title: 'Interpolation inside an ActiveRecord query',
    suggestion: 'Use the placeholder form: where("name = ?", value).',
  },
  'RAILS-HTML-SAFE': {
    title: 'View escaping bypassed',
    suggestion: 'Use sanitize() rather than html_safe on content you do not control.',
  },
  'RAILS-MASTER-KEY-COMMITTED': {
    title: 'Rails decryption key present in the repository',
    suggestion:
      'Remove config/master.key from Git, rotate the credentials, and pass the key through RAILS_MASTER_KEY.',
  },
  'RN-STOCKAGE-NON-CHIFFRE': {
    title: 'Token written to unencrypted storage',
    suggestion:
      'Use the system keychain: react-native-keychain, expo-secure-store or react-native-encrypted-storage. AsyncStorage remains fine for display preferences.',
  },
  'RN-WEBVIEW-ACCES-FICHIER': {
    title: 'WebView with file system access',
    message:
      'This WebView lets the loaded content read the app’s file system. Combined with a remote URL or an uncontrolled redirect, it exposes the local database and the stored tokens.',
    suggestion:
      'Leave allowFileAccess at false. If the WebView must show local content, serve it from the bundled assets and restrict navigation with onShouldStartLoadWithRequest.',
  },
  'REACT-TOKEN-IN-STORAGE': {
    suggestion:
      'Keep the token in an httpOnly cookie set by the server: JavaScript cannot read it, so an XSS cannot steal it.',
  },
  'REACT-DYNAMIC-HREF': {
    title: 'Link built from an external value',
    suggestion:
      'Validate the scheme before use: reject anything that is not http(s), otherwise javascript: becomes executable.',
  },
  'SPRING-H2-CONSOLE': {
    title: 'H2 console enabled',
    suggestion: 'Disable it outside development: it is a full SQL shell reachable over HTTP.',
  },
  'SPRING-SHOW-SQL': {
    title: 'SQL logging enabled',
    suggestion: 'Disable show-sql in production: it floods the logs and can leak data.',
  },
  'SPRING-PERMIT-ALL': {
    title: 'Every request permitted',
    suggestion: 'Restrict by route: permitAll only on what is genuinely public.',
  },
  'SVELTE-HTML-TAG': {
    title: 'Escaping bypassed by {@html}',
    suggestion: 'Sanitise the value, or render it as text.',
  },
  'SVELTEKIT-SERVER-DATA-LEAK': {
    title: 'Sensitive value returned by load()',
    message:
      'What load() returns is serialised into the page, despite the ".server" in the file name: the value ends up readable in the browser.',
    suggestion: 'Return only what the page displays; keep the secret server-side.',
  },
  'TAURI-ALLOWLIST-TOTALE': {
    title: 'Tauri allowlist fully open',
    message:
      'allowlist.all: true grants the window every native API: file system, shell, processes, unrestricted HTTP. Tauri’s entire security model rests on that list; opening it completely amounts to shipping an Electron app without isolation.',
    suggestion:
      'Replace it with the exact list of APIs you use, for example "fs": { "readFile": true, "scope": ["$APPDATA/*"] }. The build will fail on what is missing, which is the right moment to add it.',
  },
  'TAURI-SHELL-OUVERT': {
    title: 'Shell execution granted to the window',
    message:
      'The shell API is open: any JavaScript running in the window — including code injected by a compromised dependency or a remote page — can run system commands with the user’s privileges.',
    suggestion:
      'Remove shell.execute. If the app must launch a specific binary, declare it in scope with its valid arguments, or expose a Rust #[tauri::command] that wraps the operation.',
  },
  'TAURI-CSP-ABSENTE': {
    title: 'Content security policy disabled',
    message:
      'security.csp: null removes the CSP Tauri injects. Nothing stops the window from loading and running a remote script, while it holds the native APIs the allowlist granted.',
    suggestion:
      'Define a CSP, starting from "default-src \'self\'; img-src \'self\' asset: https://asset.localhost" and opening it case by case.',
  },
  'TAURI-IPC-DISTANT': {
    title: 'IPC reachable from a remote domain',
    suggestion:
      'Serve the interface from the bundled assets. If remote content is unavoidable, show it in a separate window without IPC access, and pass data through the Rust process.',
  },
  'TAURI-GLOBAL-EXPOSE': {
    title: 'Tauri API exposed on window',
    message:
      'withGlobalTauri puts the API on window.__TAURI__, where any script on the page can find it — including a third-party dependency. Importing @tauri-apps/api keeps it available to your code without exposing it to others.',
    suggestion: 'Set it to false and import @tauri-apps/api in your modules.',
  },
  'ARGUS-PACK-EN-ECHEC': {
    suggestion: 'Please report this message: it is a defect in Argus, not in your code.',
  },
  'ARGUS-COUVERTURE-PARTIELLE': {
    suggestion:
      'This finding exists so that an absence of results is not mistaken for a clean bill of health. A pack is contributed as one module in src/rules/frameworks/; the method is in CONTRIBUTING.md.',
  },

  // ------------------------------------------------------------- Le reste
  //
  // Ce qui n'apparait plus apres cette section a un titre construit au moment
  // de la detection — il cite un nom de variable, un paquet, une mesure. Le
  // calque ne peut rien pour ces textes-la : ils n'existent pas avant d'etre
  // produits, et il faudrait passer par `t()` sur chaque site de construction.
  'SEC-GITIGNORE-ENV': {
    title: '.env missing from .gitignore',
    message: 'The .gitignore does not protect environment files.',
    suggestion: 'Add `.env` and `.env.*` (except `.env.example`) to .gitignore.',
  },
  'SEC-NO-GITIGNORE': {
    title: 'No .gitignore',
    message:
      'The project has no .gitignore: secrets, dependencies and build artefacts risk being committed.',
    suggestion: 'Create a .gitignore suited to your stack (see github/gitignore).',
  },
  'SEC-VENDOR-COMMITTED': {
    title: 'Dependencies committed',
    message: 'Installed dependencies appear to be present in the repository.',
    suggestion: 'Ignore node_modules/ and reinstall from the lockfile.',
  },
  'NEXTJS-IGNORE-LINT': {
    title: 'Lint errors ignored at build time',
    message:
      'ignoreDuringBuilds: true lets code the linter rejects reach production. The guard rail still exists, but nobody sees it any more.',
    suggestion:
      'Fix the errors, or disable the specific rules that get in the way in .eslintrc — not the whole linter.',
  },
  'NEXTJS-IGNORE-TYPES': {
    title: 'TypeScript errors ignored at build time',
    suggestion:
      'Fix the types. During a transition, isolate the files concerned with // @ts-expect-error, which documents the debt instead of erasing it.',
  },
  'NEXTJS-IMAGE-WILDCARD': {
    title: 'Image optimiser open to every domain',
    suggestion:
      'List the domains you actually use, or use remotePatterns for finer control.',
  },
  'REACT-LIST-NO-KEY': {
    suggestion:
      'Add key={item.id} — a stable identifier, never the array index, which changes as soon as the list is reordered.',
  },
  'DJANGO-MODEL-NO-STR': {
    suggestion:
      'Add:\n    def __str__(self):\n        return self.title  # or any identifying field',
  },
};
