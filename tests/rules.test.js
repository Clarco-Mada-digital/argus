import test from 'node:test';
import assert from 'node:assert/strict';

import { SECURITY_RULES, CONFIG_SECURITY_RULES } from '../src/rules/security.js';

// Regles et identifiants

// ------------------------------------------------------- Integrite des regles

test('regles : identifiants uniques et champs obligatoires', () => {
  const vus = new Set();
  for (const rule of [...SECURITY_RULES, ...CONFIG_SECURITY_RULES]) {
    assert.ok(rule.id, 'identifiant manquant');
    assert.ok(!vus.has(rule.id), `identifiant duplique : ${rule.id}`);
    vus.add(rule.id);

    assert.ok(rule.title, `titre manquant : ${rule.id}`);
    assert.ok(rule.message, `message manquant : ${rule.id}`);
    // Une regle qui ne dit pas quoi faire n'aide personne.
    assert.ok(rule.suggestion?.length > 20, `suggestion absente ou trop courte : ${rule.id}`);
    assert.ok(['critical', 'high', 'medium', 'low', 'info'].includes(rule.severity), `gravite invalide : ${rule.id}`);
  }
});

test('regles : les identifiants emis sont des constantes stables', async () => {
  const { scan } = await import('../src/index.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-'));
  // Notes truffees de ponctuation : elles ne doivent jamais contaminer l'id.
  fs.writeFileSync(
    pathMod.join(dir, 'dette.js'),
    "// TODO: gerer le cas ${x} && (y || z) — voir /regex/.test(a)\n// FIXME: corriger `ceci`\nexport const a = 1;\n",
  );

  const resultat = await scan(dir, { categories: ['quality'] });
  for (const finding of resultat.findings) {
    assert.match(
      finding.ruleId,
      /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/,
      `identifiant de regle malforme : ${JSON.stringify(finding.ruleId)}`,
    );
  }
  const ids = resultat.findings.map((f) => f.ruleId);
  assert.ok(ids.includes('QUAL-TODO'), 'le marqueur TODO doit produire QUAL-TODO');
  assert.ok(ids.includes('QUAL-FIXME'), 'le marqueur FIXME doit produire QUAL-FIXME');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('regles : les motifs compilent et ne bouclent pas', () => {
  // argus-disable-next-line — echantillon volontairement vulnerable pour mesurer le cout des motifs
  const echantillon = 'const x = 1;\nSELECT * FROM t WHERE a = "" + b;\neval(y);\n'.repeat(20);
  for (const rule of SECURITY_RULES) {
    if (!rule.pattern) continue;
    assert.ok(rule.pattern instanceof RegExp, `motif invalide : ${rule.id}`);
    assert.ok(rule.pattern.global, `le motif de ${rule.id} doit porter le drapeau g`);
    rule.pattern.lastIndex = 0;
    const debut = Date.now();
    while (rule.pattern.exec(echantillon) !== null) {
      if (Date.now() - debut > 500) assert.fail(`motif trop lent (ReDoS ?) : ${rule.id}`);
    }
  }
});
