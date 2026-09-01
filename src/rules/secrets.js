/**
 * Detection de secrets : motifs de fournisseurs connus (haute confiance) puis
 * heuristique generique affectation + entropie (confiance moderee).
 */

const PROVIDER_SECRETS = [
  { id: 'aws-access-key', label: 'Clef d\'acces AWS', pattern: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g, severity: 'critical' },
  { id: 'aws-secret', label: 'Secret AWS', pattern: /aws_?secret_?access_?key["'\s:=]+([A-Za-z0-9/+=]{40})\b/gi, severity: 'critical' },
  { id: 'github-token', label: 'Jeton GitHub', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g, severity: 'critical' },
  { id: 'gitlab-token', label: 'Jeton GitLab', pattern: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g, severity: 'critical' },
  { id: 'slack-token', label: 'Jeton Slack', pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, severity: 'high' },
  { id: 'stripe-key', label: 'Clef Stripe', pattern: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,})\b/g, severity: 'critical' },
  { id: 'google-api-key', label: 'Clef API Google', pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g, severity: 'high' },
  { id: 'firebase-key', label: 'Clef Firebase', pattern: /\b(AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140,})\b/g, severity: 'high' },
  { id: 'openai-key', label: 'Clef OpenAI', pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g, severity: 'critical' },
  { id: 'anthropic-key', label: 'Clef Anthropic', pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g, severity: 'critical' },
  { id: 'sendgrid-key', label: 'Clef SendGrid', pattern: /\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g, severity: 'high' },
  { id: 'twilio-sid', label: 'Identifiant Twilio', pattern: /\b(AC[a-f0-9]{32})\b/g, severity: 'high' },
  { id: 'mailgun-key', label: 'Clef Mailgun', pattern: /\b(key-[a-f0-9]{32})\b/g, severity: 'high' },
  { id: 'npm-token', label: 'Jeton npm', pattern: /\b(npm_[A-Za-z0-9]{36})\b/g, severity: 'critical' },
  { id: 'private-key', label: 'Clef privee', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g, severity: 'critical' },
  { id: 'jwt-token', label: 'Jeton JWT en dur', pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, severity: 'high' },
  {
    id: 'db-url',
    label: 'URL de base avec identifiants',
    pattern: /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s"']+:[^@\s"']{3,}@[^\s"'/]+)/gi,
    severity: 'critical',
    // `user:pass@localhost` est ce qu'on ecrit dans un modele : le signaler
    // apprend a ignorer la regle le jour ou une vraie URL apparait.
    ignore: /:\/\/(user|username|utilisateur|admin|root|foo|test|demo):(pass|password|motdepasse|secret|changeme|xxx+|\*+)@|@(localhost|127\.0\.0\.1|db|host|hostname|example\.\w+)[:/]/i,
  },
  { id: 'basic-auth-url', label: 'URL HTTP avec identifiants', pattern: /\bhttps?:\/\/[^:\s"']+:[^@\s"']{3,}@/gi, severity: 'high' },
];

/** Noms de variables consideres comme sensibles pour l'heuristique generique. */
const SECRET_KEY_PATTERN =
  /\b((?:api|access|secret|private|auth|client|encryption|signing|session|master|admin|db|database|jwt|refresh)[_-]?(?:key|token|secret|password|passwd|pwd|credential|cert)|password|passwd|pwd|passphrase|secret|token|apikey|mot_de_passe)\b/i;

// Le nom peut lui-meme etre cite : `'PASSWORD': '…'` dans un dictionnaire
// Python, un objet JSON ou un tableau PHP — cas tres courant en configuration.
const ASSIGNMENT_RE =
  /["']?([A-Za-z_][A-Za-z0-9_.-]{2,40})["']?\s*[:=>]{1,2}\s*["'`]([^"'`\n]{8,200})["'`]/g;

/** Valeurs manifestement inoffensives : placeholders, exemples, references. */
const PLACEHOLDER_RE =
  /^(?:\s*)(?:x{3,}|\*{3,}|\.{3,}|<[^>]+>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[sd]|null|none|true|false|undefined|changeme|change_me|your[_-]?\w*|my[_-]?\w*|example|examples?\.\w+|test|testing|demo|dummy|sample|placeholder|todo|fixme|foo|bar|baz|secret|password|process\.env\.\w+|os\.environ\S*|env\(|config\(|import\.meta\.env\.\w+|\w+\.env\.\w+)(?:\s*)$/i;

const ENV_REFERENCE_RE = /process\.env|os\.environ|import\.meta\.env|getenv|System\.getenv|ENV\[|dotenv|config\.get|Platform\.environment/;

/** Entropie de Shannon en bits par caractere. */
export function shannonEntropy(text) {
  if (!text) return 0;
  const counts = new Map();
  for (const char of text) counts.set(char, (counts.get(char) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Un texte qui ressemble a une phrase/URL/chemin n'est pas un secret. */
function looksStructural(value) {
  if (/\s{2,}/.test(value)) return true;
  if (/^[a-z]+(?:[ -][a-z]+){2,}$/i.test(value)) return true; // phrase
  if (/^[./~]|^[a-z]:\\|\/\w+\/\w+/i.test(value) && !/:\/\//.test(value)) return true; // chemin
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return true; // couleur
  if (/^\d{1,4}([.-]\d{1,4}){1,3}$/.test(value)) return true; // version / date
  if (/^[\w.-]+@[\w.-]+\.\w{2,}$/.test(value)) return true; // email
  if (/^(?:GET|POST|PUT|PATCH|DELETE|SELECT|INSERT|UPDATE)\b/i.test(value)) return true;
  if (/^[a-z-]+\/[a-z0-9.+-]+$/i.test(value)) return true; // mime type
  return false;
}

/**
 * Analyse une ligne et retourne les secrets probables qu'elle contient.
 * @returns {Array<{kind:string,label:string,severity:string,match:string,index:number,entropy:number,confidence:string}>}
 */
/**
 * Affectation sans guillemets, telle qu'on l'ecrit dans un fichier de
 * configuration : `spring.datasource.password=Pr0dPassw0rd!`. Ce motif ne
 * s'applique qu'a ces fichiers — en plein code, il produirait du bruit.
 */
const CONFIG_ASSIGNMENT_RE = /^\s*([\w.\-]{3,60})\s*[:=]\s*([^\s#][^\n#]{7,200}?)\s*$/;

export function detectSecrets(line, { minEntropy = 3.6, allowTests = false, unquoted = false } = {}) {
  const results = [];

  for (const rule of PROVIDER_SECRETS) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(line)) !== null) {
      const value = match[1] || match[0];
      if (rule.ignore && rule.ignore.test(value)) continue;
      results.push({
        kind: rule.id,
        label: rule.label,
        severity: rule.severity,
        match: value,
        index: match.index,
        entropy: Math.round(shannonEntropy(value) * 100) / 100,
        confidence: 'certain',
      });
    }
  }

  if (results.length > 0) return results;

  // Fichier de configuration : la valeur n'est pas entre guillemets.
  if (unquoted) {
    const config = CONFIG_ASSIGNMENT_RE.exec(line);
    if (config && SECRET_KEY_PATTERN.test(config[1])) {
      const valeur = config[2];
      const inoffensif =
        PLACEHOLDER_RE.test(valeur) || ENV_REFERENCE_RE.test(valeur) ||
        /^\$\{|^<|^\*+$/.test(valeur) || looksStructural(valeur);
      if (!inoffensif) {
        const entropy = shannonEntropy(valeur);
        if (entropy >= 2.6) {
          return [{
            kind: 'config-secret',
            label: 'Secret dans un fichier de configuration',
            severity: entropy > 3.6 ? 'critical' : 'high',
            match: valeur,
            index: line.indexOf(valeur),
            entropy: Math.round(entropy * 100) / 100,
            confidence: 'firm',
          }];
        }
      }
    }
  }

  ASSIGNMENT_RE.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT_RE.exec(line)) !== null) {
    const [, name, value] = match;
    if (!SECRET_KEY_PATTERN.test(name)) continue;
    if (PLACEHOLDER_RE.test(value)) continue;
    if (ENV_REFERENCE_RE.test(line)) continue;
    if (looksStructural(value)) continue;
    if (!allowTests && /^[a-z]{4,12}(?:123|1234)?$/i.test(value)) continue;

    const entropy = shannonEntropy(value);
    const hasVariety = /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
    if (entropy < minEntropy && !(hasVariety && value.length >= 16)) continue;

    results.push({
      kind: 'generic-secret',
      label: 'Secret code en dur',
      severity: entropy > 4.2 ? 'high' : 'medium',
      match: value,
      index: match.index,
      entropy: Math.round(entropy * 100) / 100,
      confidence: entropy > 4.2 ? 'firm' : 'tentative',
    });
  }

  return results;
}

/** Masque une valeur pour l'affichage dans les rapports. */
export function redact(value) {
  const text = String(value);
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}${'*'.repeat(Math.min(12, text.length - 8))}${text.slice(-4)}`;
}
