import { CATEGORIES, SEVERITY_LABEL_FR } from '../core/severity.js';

/** Rapport JSON complet (utilisable comme API). */
export function renderJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * SARIF 2.1.0 : format standard consomme par GitHub Code Scanning,
 * GitLab, Azure DevOps et la plupart des IDE.
 */
export function renderSarif(result) {
  const rules = new Map();
  for (const finding of result.findings) {
    if (rules.has(finding.ruleId)) continue;
    rules.set(finding.ruleId, {
      id: finding.ruleId,
      name: finding.ruleId.replace(/[^A-Za-z0-9]/g, ''),
      shortDescription: { text: finding.title },
      fullDescription: { text: finding.message },
      help: { text: finding.suggestion || finding.message, markdown: finding.suggestion || finding.message },
      helpUri: finding.docs || undefined,
      properties: {
        category: finding.category,
        tags: [finding.category, ...(finding.tags || [])].filter(Boolean),
        'security-severity': securityScore(finding.severity),
      },
      defaultConfiguration: { level: sarifLevel(finding.severity) },
    });
  }

  return `${JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: result.tool.name,
              version: result.tool.version,
              informationUri: 'https://github.com/argus-scan/argus',
              rules: [...rules.values()],
            },
          },
          invocations: [
            {
              executionSuccessful: result.errors.length === 0,
              startTimeUtc: result.startedAt,
              workingDirectory: { uri: `file://${result.root}` },
            },
          ],
          results: result.findings.map((finding) => ({
            ruleId: finding.ruleId,
            level: sarifLevel(finding.severity),
            message: { text: finding.suggestion ? `${finding.message}\n\nCorrection : ${finding.suggestion}` : finding.message },
            partialFingerprints: { argusFingerprint: finding.fingerprint },
            locations: finding.file
              ? [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: finding.file, uriBaseId: '%SRCROOT%' },
                      region: {
                        startLine: finding.line || 1,
                        startColumn: finding.column || undefined,
                        endLine: finding.endLine || undefined,
                        snippet: finding.snippet ? { text: finding.snippet } : undefined,
                      },
                    },
                  },
                ]
              : [{ physicalLocation: { artifactLocation: { uri: '.', uriBaseId: '%SRCROOT%' } } }],
          })),
        },
      ],
    },
    null,
    2,
  )}\n`;
}

function sarifLevel(severity) {
  return { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' }[severity] || 'warning';
}

function securityScore(severity) {
  return { critical: '9.5', high: '7.5', medium: '5.0', low: '3.0', info: '1.0' }[severity] || '5.0';
}

/** Rapport Markdown : lisible dans une pull request ou un ticket. */
export function renderMarkdown(result) {
  const lines = [];
  const { scores, project } = result;

  lines.push(`# Rapport d'analyse — score ${scores.global}/100 (${scores.grade})`);
  lines.push('');
  lines.push(`> ${project.analyzed} fichiers analyses · ${scores.total} problemes · genere le ${new Date(result.startedAt).toLocaleString('fr-FR')}`);
  lines.push('');

  lines.push('## Scores par categorie');
  lines.push('');
  lines.push('| Categorie | Score | Note | Problemes |');
  lines.push('|---|---:|:---:|---:|');
  for (const category of Object.values(scores.categories)) {
    lines.push(`| ${category.label} | ${category.score} | ${category.grade} | ${category.total} |`);
  }
  lines.push('');

  if (result.actionPlan.length > 0) {
    lines.push('## Plan d\'action');
    lines.push('');
    for (const item of result.actionPlan) {
      lines.push(`### ${item.priority}. ${item.title}`);
      lines.push('');
      lines.push(`- **Gravite** : ${SEVERITY_LABEL_FR[item.severity]} · **Occurrences** : ${item.count} · **Effort** : ${item.effort}`);
      lines.push(`- **Categorie** : ${CATEGORIES[item.category]?.label || item.category}`);
      if (item.suggestion) lines.push(`- **Correction** : ${item.suggestion}`);
      if (item.files.length) lines.push(`- **Fichiers** : ${item.files.slice(0, 5).map((f) => `\`${f}\``).join(', ')}`);
      lines.push('');
    }
  }

  lines.push('## Detail des problemes');
  lines.push('');
  const byCategory = new Map();
  for (const finding of result.findings) {
    if (!byCategory.has(finding.category)) byCategory.set(finding.category, []);
    byCategory.get(finding.category).push(finding);
  }

  for (const [categoryId, findings] of byCategory) {
    lines.push(`### ${CATEGORIES[categoryId]?.label || categoryId} (${findings.length})`);
    lines.push('');
    lines.push('| Gravite | Regle | Emplacement | Probleme |');
    lines.push('|---|---|---|---|');
    for (const finding of findings.slice(0, 100)) {
      const location = finding.file ? `\`${finding.file}${finding.line ? `:${finding.line}` : ''}\`` : '—';
      lines.push(`| ${SEVERITY_LABEL_FR[finding.severity]} | \`${finding.ruleId}\` | ${location} | ${escapeCell(finding.title)} |`);
    }
    if (findings.length > 100) lines.push(`| … | | | ${findings.length - 100} autres |`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Sortie compacte pour la CI (une ligne par probleme). */
export function renderCompact(result) {
  return `${result.findings
    .map((f) => `${f.file || '.'}:${f.line || 0}: [${f.severity}] ${f.ruleId} ${f.title}`)
    .join('\n')}\n`;
}

/** Annotations GitHub Actions : affichees directement dans la diff. */
export function renderGithub(result) {
  const level = (severity) => (['critical', 'high'].includes(severity) ? 'error' : severity === 'medium' ? 'warning' : 'notice');
  return `${result.findings
    .filter((f) => f.file)
    .map((f) => {
      const message = `${f.title}: ${f.message}${f.suggestion ? ` | Correction: ${f.suggestion}` : ''}`.replace(/\n/g, '%0A');
      return `::${level(f.severity)} file=${f.file},line=${f.line || 1},title=${f.ruleId}::${message}`;
    })
    .join('\n')}\n`;
}
