/**
 * Analyseur d'arguments minimaliste : suffisant pour la CLI et sans dependance.
 * Supporte --flag, --option=valeur, --option valeur, -abc, et --no-flag.
 */
export function parseArgs(argv, { booleans = [], aliases = {} } = {}) {
  const options = {};
  const positional = [];
  const isBoolean = (name) => booleans.includes(name);
  const resolve = (name) => aliases[name] || name;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const equals = body.indexOf('=');
      if (equals !== -1) {
        options[resolve(body.slice(0, equals))] = coerce(body.slice(equals + 1));
        continue;
      }
      if (body.startsWith('no-')) {
        options[resolve(body.slice(3))] = false;
        continue;
      }
      const name = resolve(body);
      if (isBoolean(name)) {
        options[name] = true;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('-')) options[name] = true;
        else {
          options[name] = coerce(next);
          i++;
        }
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      for (const letter of token.slice(1)) {
        const name = resolve(letter);
        if (isBoolean(name)) options[name] = true;
        else {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith('-')) {
            options[name] = coerce(next);
            i++;
          } else options[name] = true;
        }
      }
      continue;
    }

    positional.push(token);
  }

  return { options, positional };
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10);
  return value;
}

/** Transforme "a,b, c" en ["a","b","c"]. */
export function toList(value) {
  if (value === undefined || value === null || value === true) return null;
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
