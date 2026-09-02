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
};
