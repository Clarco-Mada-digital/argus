import security from './security.js';
import routes from './routes.js';
import deadcode from './deadcode.js';
import seo from './seo.js';
import design from './design.js';
import performance from './performance.js';
import quality from './quality.js';
import dependencies from './dependencies.js';
import crawl from './crawl.js';
import frameworks from './frameworks.js';

/**
 * Registre des analyseurs. L'ordre d'execution est pilote par `order` :
 * l'analyseur de routes doit passer avant le SEO (qui exploite context.routes).
 *
 * Pour ajouter un analyseur : creez un module exportant
 * { id, category, label, order, appliesTo?, run(context, report) }
 * et referencez-le ici.
 */
export const analyzers = [security, routes, deadcode, seo, design, performance, quality, dependencies, crawl, frameworks];

export { security, routes, deadcode, seo, design, performance, quality, dependencies, crawl, frameworks };
