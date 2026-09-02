import { performance } from 'node:perf_hooks';
import { createFinding } from './finding.js';
import { walkProject } from './walker.js';
import { ProjectContext } from './project.js';
import { buildActionPlan, buildScores } from './scoring.js';
import { atLeast } from './severity.js';
import { constatDansSonDomaine } from './domaines.js';
import { traduireConstat } from '../i18n/index.js';
import { loadBaseline } from './config.js';
import { analyzers as builtinAnalyzers } from '../analyzers/index.js';
import { changedFiles, describeRef } from './git.js';

/**
 * Orchestrateur : indexe le projet, execute les analyseurs dans l'ordre de
 * dependance, filtre puis agrege les resultats.
 */
export class Engine {
  constructor(config, { analyzers = builtinAnalyzers, onEvent = () => {} } = {}) {
    this.config = config;
    this.analyzers = [...analyzers].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    this.onEvent = onEvent;
  }

  async run() {
    const startedAt = Date.now();
    const t0 = performance.now();

    // `crawlOnly` : audit d'un site en ligne sans code source disponible.
    // On saute entierement l'indexation plutot que de scanner un dossier au hasard.
    this.onEvent({ type: 'phase', phase: 'indexing', message: 'Indexation des fichiers…' });
    const { files, skipped, totalBytes, truncated } = this.config.crawlOnly
      ? { files: [], skipped: 0, totalBytes: 0, truncated: false }
      : await walkProject(this.config, {
          onProgress: (count) => this.onEvent({ type: 'progress', phase: 'indexing', count }),
        });

    const context = new ProjectContext(this.config, files, { skipped, totalBytes, truncated });
    this.onEvent({
      type: 'indexed',
      files: files.length,
      skipped,
      frameworks: context.frameworks,
      platforms: context.platforms,
    });

    const findings = [];
    const timings = [];
    const errors = [];

    for (const analyzer of this.analyzers) {
      if (!this.#isEnabled(analyzer, context)) continue;

      this.onEvent({ type: 'phase', phase: analyzer.id, message: analyzer.label || analyzer.id });
      const start = performance.now();
      const collected = [];
      const report = (input) => {
        const finding = createFinding({ category: analyzer.category, ...input });
        collected.push(finding);
        return finding;
      };

      try {
        await analyzer.run(context, report);
      } catch (error) {
        errors.push({ analyzer: analyzer.id, message: error.message, stack: error.stack });
        this.onEvent({ type: 'error', analyzer: analyzer.id, message: error.message });
      }

      const duration = performance.now() - start;
      timings.push({ analyzer: analyzer.id, ms: Math.round(duration), findings: collected.length });
      findings.push(...collected);
      this.onEvent({ type: 'analyzed', analyzer: analyzer.id, count: collected.length, ms: Math.round(duration) });
    }

    const baseline = loadBaseline(this.config);
    let { kept, suppressed } = this.#filter(findings, baseline, context);

    // Mode differentiel : on ne garde que ce qui touche les fichiers modifies.
    let diff = null;
    if (this.config.since) {
      diff = changedFiles(context.root, this.config.since);
      diff.description = describeRef(context.root, this.config.since);
      const dansLeDiff = kept.filter((f) => f.file && diff.files.has(f.file));
      suppressed = [...suppressed, ...kept.filter((f) => !dansLeDiff.includes(f))];
      kept = dansLeDiff;
      this.onEvent({ type: 'diff', ref: this.config.since, files: diff.files.size });
    }

    kept.sort(compareFindings);

    const scores = buildScores(kept, {
      // En mode differentiel, le score porte sur le perimetre modifie : le
      // rapporter a la taille du projet entier le rendrait toujours excellent.
      fileCount: diff ? Math.max(diff.files.size, 1) : context.sources().length || files.length,
      categories: this.config.categories,
    });

    const durationMs = Math.round(performance.now() - t0);
    const result = {
      tool: { name: 'Argus', version: '1.0.0' },
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      root: context.root,
      config: publicConfig(this.config),
      project: {
        files: files.length,
        analyzed: context.sources().length,
        skipped,
        totalBytes,
        truncated,
        frameworks: context.frameworks,
        platforms: context.platforms,
        description: context.description,
        identite: context.identite ?? null,
        plateformeImposee: Boolean(context.plateformeImposee),
        preuves: Object.fromEntries(context.preuves || []),
        monorepo: Boolean(context.estMonorepo),
        sousProjets: (context.sousProjets || []).map((p) => ({
          chemin: p.chemin,
          nom: p.nom,
          description: p.description,
          platforms: p.platforms,
          fichiers: p.files.length,
        })),
        stack: context.stack,
        dependencies: [...context.dependencies.values()],
      },
      scores,
      diff: diff ? { ref: diff.ref, base: diff.base, description: diff.description, files: [...diff.files] } : null,
      findings: kept,
      suppressed: suppressed.length,
      routes: context.routes,
      links: context.links,
      insights: Object.fromEntries(context.shared),
      actionPlan: buildActionPlan(kept),
      timings,
      errors,
    };

    this.onEvent({ type: 'done', result });
    for (const file of files) file.release();
    return result;
  }

  #isEnabled(analyzer, context) {
    // Un analyseur peut alimenter plusieurs categories (l'exploration HTTP
    // produit des constats de securite, de SEO et de performance). Il reste
    // actif des qu'au moins une d'entre elles est demandee.
    const emises = analyzer.categories ?? [analyzer.category];
    if (!emises.some((id) => this.config.categories.includes(id))) return false;
    if (analyzer.appliesTo && !analyzer.appliesTo(context)) return false;
    return true;
  }

  /**
   * Le constat releve-t-il d'une regle valide pour la plateforme de son
   * fichier ? La plateforme est celle du *perimetre* du fichier : dans un
   * monorepo, `apps/web` garde le SEO que `apps/mobile` n'a pas.
   */
  #dansSonDomaine(finding, context) {
    const fichier = finding.file ? context.byPath?.get(finding.file) : null;
    const perimetre = fichier && context.perimetreDe ? context.perimetreDe(fichier) : context;
    return constatDansSonDomaine(finding.ruleId, perimetre.platforms);
  }

  #filter(findings, baseline, context) {
    const kept = [];
    const suppressed = [];
    const seen = new Set();
    const { disabledRules = [], ruleSeverity = {}, minSeverity = 'info' } = this.config;

    for (const finding of findings) {
      // La suppression par commentaire vaut pour toutes les regles, quel que
      // soit l'analyseur qui a produit le constat : c'est ce qu'attend un
      // utilisateur qui ecrit `argus-ignore` dans son code.
      if (isSuppressedInSource(finding, context)) {
        finding.suppressedByComment = true;
        suppressed.push(finding);
        continue;
      }
      // Un analyseur multi-categories peut produire des constats hors du
      // perimetre demande : `--only seo` ne doit pas laisser passer un
      // resultat de securite.
      if (!this.config.categories.includes(finding.category)) {
        suppressed.push(finding);
        continue;
      }
      // Une regle appliquee hors de son domaine ne dit rien de vrai. La
      // verification est centrale et non dispersee dans les analyseurs :
      // sinon chaque nouvelle regle recommence l'oubli.
      if (!this.#dansSonDomaine(finding, context)) {
        finding.horsDomaine = true;
        suppressed.push(finding);
        continue;
      }
      if (ruleSeverity[finding.ruleId]) {
        finding.severity = ruleSeverity[finding.ruleId];
        finding.severityOverridden = true;
      }
      if (disabledRules.some((rule) => finding.ruleId === rule || finding.ruleId.startsWith(rule))) {
        suppressed.push(finding);
        continue;
      }
      if (!atLeast(finding.severity, minSeverity)) {
        suppressed.push(finding);
        continue;
      }
      if (baseline.has(finding.fingerprint)) {
        finding.baselined = true;
        suppressed.push(finding);
        continue;
      }
      const key = `${finding.fingerprint}:${finding.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // La traduction est posee en sortie, une fois toutes les decisions
      // prises : les regles, les seuils et les suppressions raisonnent sur les
      // identifiants, jamais sur le texte affiche.
      kept.push(traduireConstat(finding));
    }
    return { kept, suppressed };
  }
}

/**
 * Prise en charge des commentaires de suppression :
 *   `argus-ignore` / `argus-disable` sur la ligne concernee,
 *   `argus-disable-next-line` sur la ligne precedente.
 */
function isSuppressedInSource(finding, context) {
  if (!finding.file || !finding.line) return false;
  const file = context.file(finding.file);
  if (!file?.readable) return false;

  const lines = file.lines;
  const current = lines[finding.line - 1];
  if (current && /argus-(ignore|disable)\b/.test(current)) return true;

  // La directive est cherchee dans tout le bloc de commentaires qui precede
  // immediatement, pas seulement sur la ligne d'avant : une justification tient
  // rarement en une ligne, et exiger que la directive soit la derniere obligerait
  // a ecrire le pourquoi avant le quoi.
  for (let i = finding.line - 2; i >= 0; i--) {
    const ligne = lines[i];
    if (ligne === undefined) break;
    const texte = ligne.trim();
    if (texte === '') break;
    if (!EST_COMMENTAIRE.test(texte)) break;
    if (/argus-disable-next-line/.test(texte)) return true;
  }

  return false;
}

/** Formes de commentaire rencontrees dans les langages pris en charge. */
const EST_COMMENTAIRE = /^(\/\/|\/\*|\*|#|--|<!--|%|;)/;

function compareFindings(a, b) {
  const bySeverity = severityIndex(a.severity) - severityIndex(b.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.category !== b.category) return a.category.localeCompare(b.category);
  if ((a.file || '') !== (b.file || '')) return (a.file || '').localeCompare(b.file || '');
  return (a.line || 0) - (b.line || 0);
}

function severityIndex(severity) {
  return ['critical', 'high', 'medium', 'low', 'info'].indexOf(severity);
}

function publicConfig(config) {
  const { root, categories, minSeverity, failOn, failUnderScore, includeTests, siteUrl } = config;
  return { root, categories, minSeverity, failOn, failUnderScore, includeTests, siteUrl };
}

/** Point d'entree pratique pour un scan complet. */
export async function analyze(config, options = {}) {
  return new Engine(config, options).run();
}
