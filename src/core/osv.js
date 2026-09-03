import fs from 'node:fs';
import path from 'node:path';
import { compareVersions, cvssBaseScore, firstFixedVersion, isAffected, severityFromScore } from './semver.js';

/**
 * Client OSV.dev — la base de vulnerabilites open source de Google, qui agrege
 * GitHub Security Advisories, les CVE, RustSec, PyPA, Go vulndb, etc.
 *
 * Principe : `argus sync` interroge le reseau **une fois** et ecrit un cache
 * local. Toutes les analyses ulterieures lisent ce cache et restent donc
 * entierement hors ligne. Aucune donnee de votre code n'est transmise : seuls
 * des couples (nom de paquet, version) partent en requete.
 */

const OSV_ENDPOINT = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_ENDPOINT = 'https://api.osv.dev/v1/vulns';
const CACHE_FILE = '.argus/osv-cache.json';
const BATCH_SIZE = 100;
const ADVISORY_CONCURRENCY = 8;
const CACHE_MAX_AGE_DAYS = 7;

function cachePath(root) {
  return path.join(root, CACHE_FILE);
}

/** @returns {{generatedAt:string, packages:Object, ageDays:number}|null} */
export function readCache(root) {
  const file = cachePath(root);
  // argus-disable-next-line — lecture du cache local, une seule fois au demarrage
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data.packages) return null;
    data.ageDays = (Date.now() - new Date(data.generatedAt).getTime()) / 86400000;
    return data;
  } catch {
    return null;
  }
}

/**
 * Sur quelle base la veille a conclu.
 *
 * Une equipe a vu deux scans consecutifs, sans toucher aux dependances, donner
 * 2 puis 8 constats — la synchronisation OSV s'etait faite entre les deux, en
 * silence. Un score qui bouge sans que le code bouge fait douter de tout le
 * reste du rapport ; la seule reponse est de dire ce qui a servi de reference.
 */
export function etatDeLaVeille(root) {
  const cache = readCache(root);
  if (!cache) return { source: 'embarquee', entrees: 0, date: null, ageJours: null };

  return {
    source: 'osv',
    entrees: Object.keys(cache.packages).length,
    date: cache.generatedAt ?? null,
    ageJours: Number.isFinite(cache.ageDays) ? Math.round(cache.ageDays) : null,
  };
}

export function cacheIsStale(cache) {
  return !cache || !Number.isFinite(cache.ageDays) || cache.ageDays > CACHE_MAX_AGE_DAYS;
}

/**
 * Interroge OSV pour une liste de paquets et ecrit le cache.
 * @param {Array<{name:string, version:string, ecosystem:string}>} packages
 * @param {{onProgress?:Function, timeout?:number}} options
 */
export async function syncOsv(root, packages, { onProgress = () => {}, timeout = 20000 } = {}) {
  const queryable = packages.filter((p) => p.name && p.version && p.ecosystem);
  if (queryable.length === 0) {
    return { packages: {}, queried: 0, vulnerable: 0, generatedAt: new Date().toISOString() };
  }

  const results = {};
  const vulnIds = new Set();
  let queried = 0;

  for (let offset = 0; offset < queryable.length; offset += BATCH_SIZE) {
    const batch = queryable.slice(offset, offset + BATCH_SIZE);
    const body = {
      queries: batch.map((p) => ({
        package: { name: p.name, ecosystem: p.ecosystem },
        version: p.version,
      })),
    };

    const response = await fetchJson(OSV_ENDPOINT, { method: 'POST', body: JSON.stringify(body) }, timeout);
    queried += batch.length;
    onProgress({ queried, total: queryable.length });

    const batchResults = response.results || [];
    for (let i = 0; i < batch.length; i++) {
      const pkg = batch[i];
      const vulns = batchResults[i]?.vulns || [];
      if (vulns.length === 0) continue;
      const key = keyOf(pkg);
      results[key] = { name: pkg.name, version: pkg.version, ecosystem: pkg.ecosystem, vulns: vulns.map((v) => v.id) };
      for (const vuln of vulns) vulnIds.add(vuln.id);
    }
  }

  // `querybatch` ne renvoie que des identifiants : on recupere les details.
  // Ces requetes sont independantes — les enchainer une par une ferait payer
  // la latence reseau autant de fois qu'il y a de bulletins. On les lance par
  // lots, en bornant la concurrence pour rester courtois envers l'API.
  const advisories = {};
  const identifiants = [...vulnIds];
  let fetched = 0;

  // argus-disable-next-line — chaque lot doit s'achever avant le suivant : c'est la limitation de debit
  for (let offset = 0; offset < identifiants.length; offset += ADVISORY_CONCURRENCY) {
    const lot = identifiants.slice(offset, offset + ADVISORY_CONCURRENCY);
    const details = await Promise.all(
      lot.map(async (id) => {
        try {
          return [id, compactAdvisory(await fetchJson(`${OSV_VULN_ENDPOINT}/${encodeURIComponent(id)}`, {}, timeout))];
        } catch {
          return [id, { id, summary: 'Details indisponibles', severity: 'medium', affected: [], aliases: [] }];
        }
      }),
    );
    for (const [id, advisory] of details) advisories[id] = advisory;
    fetched += lot.length;
    onProgress({ advisories: fetched, totalAdvisories: identifiants.length });
  }

  const cache = {
    source: 'https://osv.dev',
    generatedAt: new Date().toISOString(),
    packageCount: queryable.length,
    packages: results,
    advisories,
  };

  const file = cachePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

  return { ...cache, queried, vulnerable: Object.keys(results).length, file };
}

/** Ne conserve du bulletin OSV que ce que le rapport exploite. */
function compactAdvisory(advisory) {
  const cvss = (advisory.severity || []).find((s) => /CVSS_V3/.test(s.type))?.score ?? null;
  const score = cvss ? cvssBaseScore(cvss) : null;
  const declared = advisory.database_specific?.severity;

  const affected = (advisory.affected || []).map((entry) => ({
    package: entry.package,
    ranges: entry.ranges,
    versions: entry.versions?.length > 200 ? undefined : entry.versions,
  }));

  return {
    id: advisory.id,
    aliases: advisory.aliases || [],
    summary: advisory.summary || advisory.details?.slice(0, 200) || 'Vulnerabilite signalee',
    details: advisory.details?.slice(0, 600) || null,
    published: advisory.published || null,
    cvss,
    score,
    severity: severityFromScore(score) || mapDeclared(declared) || 'medium',
    affected,
    references: (advisory.references || []).filter((r) => ['ADVISORY', 'FIX', 'WEB'].includes(r.type)).slice(0, 3).map((r) => r.url),
  };
}

function mapDeclared(value) {
  return { CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' }[String(value).toUpperCase()] || null;
}

export function keyOf({ ecosystem, name, version }) {
  return `${ecosystem}:${name}@${version}`;
}

/**
 * Recherche hors ligne dans le cache.
 * @returns {Array<{package, version, ecosystem, advisory, fixedIn}>}
 */
export function findVulnerabilities(cache, packages) {
  if (!cache?.packages) return [];
  const findings = [];

  for (const pkg of packages) {
    const entry = cache.packages[keyOf(pkg)];
    if (!entry) continue;

    for (const id of entry.vulns) {
      const advisory = cache.advisories?.[id];
      if (!advisory) continue;

      // Le cache a ete construit pour cette version precise, mais on
      // reverifie : la version declaree a pu changer depuis la synchronisation.
      const matching = (advisory.affected || []).filter(
        (a) => !a.package || a.package.name === pkg.name,
      );
      const stillAffected = matching.length === 0 || matching.some((a) => isAffected(pkg.version, a));
      if (!stillAffected) continue;

      // `.sort()` par defaut compare des chaines : « 10.0.0 » y precede
      // « 9.0.0 ». Et sans la version installee, la branche choisie pouvait
      // etre inferieure a celle du projet.
      const fixedIn =
        matching
          .map((entree) => firstFixedVersion(entree, pkg.version))
          .filter(Boolean)
          .sort((a, b) => compareVersions(a, b) ?? 0)[0] || null;
      findings.push({ package: pkg.name, version: pkg.version, ecosystem: pkg.ecosystem, exact: pkg.exact, direct: pkg.direct, advisory, fixedIn });
    }
  }

  return findings;
}

async function fetchJson(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`OSV a repondu ${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
