/**
 * API publique d'Argus, pour une utilisation programmatique :
 *
 *   import { scan } from 'argus';
 *   const result = await scan('./mon-projet', { categories: ['seo', 'security'] });
 *   console.log(result.scores.global, result.findings.length);
 */
import path from 'node:path';
import { loadConfig } from './core/config.js';
import { Engine } from './core/engine.js';

export { Engine, analyze } from './core/engine.js';
export { loadConfig, writeBaseline, DEFAULT_CONFIG } from './core/config.js';
export { analyzers } from './analyzers/index.js';
export { renderHtml } from './report/html.js';
export { renderJson, renderSarif, renderMarkdown, renderCompact, renderGithub } from './report/formats.js';
export { renderReport } from './report/terminal.js';
export { startServer } from './server/index.js';
export { CATEGORIES, SEVERITIES, SEVERITY_LABEL_FR } from './core/severity.js';
export { createFinding } from './core/finding.js';

/**
 * Analyse un projet et retourne le rapport complet.
 * @param {string} root chemin du projet
 * @param {object} overrides surcharges de configuration
 * @param {object} options { onEvent, analyzers }
 */
export async function scan(root = '.', overrides = {}, options = {}) {
  const config = loadConfig(path.resolve(root), overrides);
  return new Engine(config, options).run();
}
