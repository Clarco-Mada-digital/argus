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

test('suppression : la directive vaut dans tout le bloc de commentaires precedent', async () => {
  const { scan } = await import('../src/index.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-supp-'));
  fs.writeFileSync(
    pathMod.join(dir, 'index.js'),
    [
      '// argus-disable-next-line — justification tenant sur plusieurs lignes,',
      '// ce qui est le cas normal : on explique pourquoi avant de deroger.',
      '// La directive n\'a donc pas a etre la derniere ligne du bloc.',
      'eval(masque);',
      '',
      'eval(visible);',
    ].join('\n'),
  );

  const r = await scan(dir, { categories: ['security'] });
  const lignes = r.findings.filter((f) => f.ruleId === 'SEC-EVAL').map((f) => f.line);
  assert.deepEqual(lignes, [6], 'seul l\'appel non justifie doit remonter');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('regles : un exemple de code dans une page n\'est pas une vulnerabilite', async () => {
  const { scan } = await import('../src/index.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'argus-doc-'));
  fs.writeFileSync(
    pathMod.join(dir, 'guide.html'),
    [
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Guide de securite</title></head>',
      '<body><main><h1>CORS</h1>',
      // Le motif est ici *explique*, pas applique.
      '<p>Ne combinez jamais <code>allow_origins=["*"]</code> avec des identifiants.</p>',
      '<pre><code>app.use(cors());</code></pre>',
      '</main></body></html>',
    ].join('\n'),
  );

  const r = await scan(dir, { categories: ['security'] });
  const bruit = r.findings.filter((f) => f.ruleId === 'SEC-CORS-WILDCARD');
  assert.deepEqual(bruit, [], 'un article qui explique une faille ne la contient pas');

  // Le meme motif hors zone d'exemple doit rester signale.
  fs.writeFileSync(pathMod.join(dir, 'vrai.html'), '<script>app.use(cors());</script>');
  const reel = await scan(dir, { categories: ['security'] });
  assert.ok(reel.findings.some((f) => f.ruleId === 'SEC-CORS-WILDCARD'), 'le code reel doit remonter');

  fs.rmSync(dir, { recursive: true, force: true });
});
