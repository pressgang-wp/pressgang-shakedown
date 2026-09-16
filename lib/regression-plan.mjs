/** Regression has one discovery matrix and two runtime origins; never pair by kind. */
import { selectViewports, runScope, levels } from './regression-scope.mjs';
import { suppressed } from './suppress.mjs';

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
}
function keys(value, allowed, name) {
  object(value, name);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown ${name} key: ${key}`);
}
export function origin(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Expected an HTTP(S) origin without credentials, path, query or fragment: ${value}`);
  }
  return url.origin;
}
export function regressionOptions(raw, discovery, flags = {}) {
  keys(raw, ['references', 'candidates', 'defaultReference', 'defaultCandidate', 'viewports', 'defaultViewports', 'defaultLevel', 'coverage', 'ignoreSelectors', 'accept', 'criticalRoutes', 'navigationLimit', 'timeout'], 'regression');
  object(raw.references, 'regression.references');
  object(raw.candidates, 'regression.candidates');
  for (const value of [...Object.values(raw.references), ...Object.values(raw.candidates)]) origin(value);
  const referenceName = flags.against ?? raw.defaultReference ?? 'production';
  const candidateName = flags.candidate ?? raw.defaultCandidate ?? 'local';
  if (!Object.hasOwn(raw.references, referenceName) || !Object.hasOwn(raw.candidates, candidateName)) throw new Error('Unknown regression reference or candidate name');
  const reference = origin(raw.references[referenceName]);
  const candidate = origin(raw.candidates[candidateName]);
  if (reference === candidate) throw new Error('Regression reference and candidate must be different origins');
  origin(discovery);
  const configuredViewports = raw.viewports;
  const viewports = configuredViewports ?? [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }];
  if (!Array.isArray(viewports) || !viewports.length) throw new Error('regression.viewports must be non-empty');
  const names = new Set();
  for (const v of viewports) {
    keys(v, ['name', 'width', 'height'], 'viewport');
    if (typeof v.name !== 'string' || !/^[a-z0-9-]+$/.test(v.name) || names.has(v.name) || ![v.width, v.height].every(n => Number.isInteger(n) && n >= 200 && n <= 4000)) throw new Error('Invalid or duplicate viewport');
    names.add(v.name);
  }
  if (raw.defaultLevel !== undefined) runScope({ level: raw.defaultLevel });
  const { level } = runScope({ level: flags.level ?? raw.defaultLevel });
  if (raw.coverage !== undefined && !['sampled', 'exhaustive'].includes(raw.coverage)) throw new Error('regression.coverage must be sampled or exhaustive');
  const coverage = flags.coverage ?? raw.coverage ?? 'sampled';
  if (!['sampled', 'exhaustive'].includes(coverage)) throw new Error('Coverage must be sampled or exhaustive');
  const lists = {};
  for (const key of ['ignoreSelectors', 'accept', 'criticalRoutes']) {
    lists[key] = raw[key] ?? [];
    if (!Array.isArray(lists[key]) || lists[key].some(s => typeof s !== 'string' || !s.trim())) throw new Error(`regression.${key} must contain non-empty strings`);
  }
  for (const path of lists.criticalRoutes) routePath(path, discovery);
  const navigationLimit = raw.navigationLimit ?? 40;
  const timeout = raw.timeout ?? 20000;
  if (!Number.isInteger(navigationLimit) || navigationLimit < 0 || navigationLimit > 200) throw new Error('navigationLimit must be 0–200');
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000) throw new Error('timeout must be 1000–120000ms');
  return { coverage, level, referenceName, candidateName, reference, candidate, discovery: origin(discovery), viewports: selectViewports(configuredViewports, raw.defaultViewports, flags.viewports), ...lists, navigationLimit, timeout };
}

/** Reject action/admin URLs even when they use GET. Query order and values remain identity. */
export function safeURL(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return false;
  let path;
  try { path = decodeURIComponent(u.pathname); } catch { return false; }
  if (/(?:^|\/)(?:wp-admin|wp-login\.php|wp-cron\.php|xmlrpc\.php)(?:\/|$)/i.test(path)) return false;
  return ![...u.searchParams.keys()].some(k => /^(?:action|_wpnonce|preview|add-to-cart|wc-ajax|doing_wp_cron)$/i.test(k));
}
export function routePath(value, discovery) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value) || value.startsWith('//')) throw new Error(`Unsafe route: ${value}`);
  const u = new URL(value, discovery);
  if (u.origin !== origin(discovery) || !safeURL(u.href)) throw new Error(`Route is outside discovery or unsafe: ${value}`);
  return u.pathname + u.search;
}
export function mapRoute(value, discovery, destination) {
  // Concatenate, rather than resolving a path beginning // as a new authority.
  return origin(destination) + routePath(value, discovery);
}
export function pairedPlan(matrix, options, source) {
  const routes = [], excluded = [], seen = new Set();
  const entries = [...matrix.routes, ...options.criticalRoutes.map(url => ({ url, kind: 'critical', expect: 200 }))];
  for (const route of entries) {
    try {
      const path = routePath(route.url, options.discovery);
      if (seen.has(path)) continue;
      const referenceUrl = mapRoute(route.url, options.discovery, options.reference);
      const candidateUrl = mapRoute(route.url, options.discovery, options.candidate);
      if ([route.url, referenceUrl, candidateUrl].some(url => suppressed(matrix.ignore?.routes, url))) {
        excluded.push({ ...route, reason: 'ignore.routes' }); continue;
      }
      seen.add(path);
      routes.push({ ...route, path, referenceUrl, candidateUrl, source: route.kind === 'critical' ? 'critical supplement' : route.derivation ?? source });
    } catch (error) { excluded.push({ ...route, reason: error.message }); }
  }
  return { version: 1, options, routes, excluded, ignore: matrix.ignore ?? {} };
}
export function classifyRoute(route, reference, candidate) {
  if (reference.error || candidate.error || reference.unavailableReason || candidate.unavailableReason) return 'inconclusive';
  const missing = x => [404, 410].includes(x.status);
  const present = x => x.status >= 200 && x.status < 300;
  if (route.expect !== 404 && missing(reference) && present(candidate)) return 'candidate-only';
  if (route.expect !== 404 && present(reference) && missing(candidate)) return 'reference-only';
  if (route.expect !== 404 && (missing(reference) || missing(candidate))) return 'unmatched';
  if (reference.status >= 500 || candidate.status >= 500 || [401, 403, 429].includes(reference.status) || [401, 403, 429].includes(candidate.status)) return 'inconclusive';
  if (reference.finalPath !== candidate.finalPath) return 'unmatched';
  return 'matched';
}
export const normaliseText = value => String(value ?? '').replace(/\s+/g, ' ').trim();
export function compareEvidence(reference, candidate, path, accept = [], level = 'full') {
  const normalize = evidence => ({
    ...evidence,
    title: evidence.title === undefined ? undefined : normaliseText(evidence.title),
    h1: evidence.h1?.map(normaliseText),
    // Location is capture evidence, not the identity/content of an empty link.
    emptyLinks: evidence.emptyLinks?.map(({ x, y, width, height, ...semantic }) => semantic),
  });
  const normalizedReference = normalize(reference);
  const normalizedCandidate = normalize(candidate);
  const differences = [];
  for (const key of levels[level].differenceKeys) {
    const signature = `${key} on ${path}`;
    if (key === 'structure' && (reference.structure !== undefined || candidate.structure !== undefined)) {
      const scope = evidence => evidence.structureScope ?? (Array.isArray(evidence.landmarks)
        ? { selector: 'main', count: evidence.landmarks.filter(l => l.tag === 'main').length, inferred: true }
        : { selector: 'unknown', count: null });
      const referenceScope = scope(reference), candidateScope = scope(candidate);
      if (referenceScope.selector !== 'main' || candidateScope.selector !== 'main' ||
          referenceScope.count !== 1 || candidateScope.count !== 1 ||
          !Array.isArray(reference.structure) || !Array.isArray(candidate.structure)) {
        differences.push({
          key, signature, comparison: 'unavailable',
          reason: 'Structural comparison requires exactly one captured <main> region on each page. Missing, multiple or unknown regions cannot establish structural additions or removals.',
          referenceScope, candidateScope,
          reference: reference.structure, candidate: candidate.structure,
          suppressed: suppressed(accept, signature),
        });
        continue;
      }
    }
    if (JSON.stringify(normalizedReference[key]) === JSON.stringify(normalizedCandidate[key])) continue;
    differences.push({ key, signature, reference: reference[key], candidate: candidate[key], suppressed: suppressed(accept, signature) });
  }
  return differences;
}
