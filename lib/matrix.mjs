/** Shared route data and pure matrix operations; no discovery or filesystem IO. */
import { suppressed } from './suppress.mjs';

/**
 * @typedef {object} Route One derived route.
 * @property {string} url Absolute URL to test.
 * @property {string} kind `family:detail` label, e.g. `archive:event`.
 * @property {number} expect Intended HTTP status (200, or 404 for the probe).
 * @property {boolean} [html] False for routes that aren't HTML (feeds) — pass 00
 *     still checks them, the browser passes skip them.
 * @property {string} [template] Oracle (capstan --resolve): basename of the PHP template WP should choose.
 * @property {string|null} [controller] Oracle: FQCN of the controller that should render (dispatched routes only).
 * @property {string} [derivation] Discovery source retained for coverage/report disclosure.
 */

/**
 * @typedef {object} Matrix The derived matrix written by `shakedown matrix`.
 * @property {string} target
 * @property {string} baseUrl
 * @property {Route[]} routes
 * @property {object} [ignore] Suppression policy, carried with the routes into every consumer.
 * @property {string[]} [discoveryWarnings]
 * @property {object[]} [discoveryExcluded]
 * Other discovery metadata (for example home/generated) is retained unchanged.
 */

/**
 * The routes a browser should actually open: successful ones that render HTML.
 *
 * Feeds are in the matrix (a feed that fatals is worth catching) but are XML, so
 * running axe or a full-page snapshot over one measures nothing and would only
 * add a baseline to maintain.
 *
 * @param {Matrix} matrix
 * @returns {Route[]}
 */
export function browsableRoutes(matrix) {
  return matrix.routes.filter((route) => route.expect === 200 && route.html !== false);
}

/**
 * Combine discovered families and apply the target's policy without mutating
 * discovery data. Base routes win collisions with supplementary routes. The
 * supplementary count is taken before suppression, as in the persisted report.
 *
 * @param {{matrix: object, source: string, supplement: {source: string, routes: Route[], warnings: string[], excluded: object[]}}} discovery
 * @param {{name: string, baseUrl: string, ignore?: object}} target
 * @returns {{matrix: Matrix, source: string, ignored: number, supplemented: number}}
 */
export function assembleMatrix({ matrix: base, source, supplement }, target) {
  const matrix = { ...base, target: target.name, baseUrl: target.baseUrl, ignore: target.ignore ?? {} };
  const known = new Set(base.routes.map(route => route.url));
  const extra = supplement.routes.filter(route => !known.has(route.url));
  matrix.discoveryWarnings = [...supplement.warnings];
  matrix.discoveryExcluded = [...supplement.excluded];
  matrix.routes = [
    ...base.routes.map(route => ({ ...route, derivation: source })),
    ...extra.map(route => ({ ...route, derivation: supplement.source })),
  ];

  // Filter only after merging, so the policy covers supplementary families too.
  const before = matrix.routes.length;
  matrix.routes = matrix.routes.filter(route => !suppressed(matrix.ignore.routes ?? [], route.url));
  return { matrix, source, ignored: before - matrix.routes.length, supplemented: extra.length };
}

/**
 * Prepend seeded state routes, first occurrence wins by exact URL. Seeding's
 * state labels take precedence over generic discovery labels. Apply the policy
 * after merging so late fixture routes cannot reintroduce excluded URLs. The
 * policy stays in the matrix for the existing CLI/report disclosure.
 *
 * @param {Matrix} matrix
 * @param {Route[]} extraRoutes
 * @returns {Matrix}
 */
export function prependMatrixRoutes(matrix, extraRoutes) {
  const seen = new Set();
  const routes = [...extraRoutes, ...matrix.routes].filter(route => {
    if (seen.has(route.url)) return false;
    seen.add(route.url);
    return !suppressed(matrix.ignore?.routes ?? [], route.url);
  });
  return { ...matrix, routes };
}
