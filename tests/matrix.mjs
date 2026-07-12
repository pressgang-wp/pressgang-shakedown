import { readFileSync } from 'node:fs';

/**
 * @typedef {object} Route One derived route.
 * @property {string} url Absolute URL to test.
 * @property {string} kind `family:detail` label, e.g. `archive:event`.
 * @property {number} expect Intended HTTP status (200, or 404 for the probe).
 * @property {string} [template] Oracle (capstan --resolve): basename of the PHP template WP should choose.
 * @property {string|null} [controller] Oracle: FQCN of the controller that should render (dispatched routes only).
 */

/**
 * @typedef {object} Matrix The derived matrix written by `shakedown matrix`.
 * @property {string} target
 * @property {string} baseUrl
 * @property {Route[]} routes
 */

/**
 * Load the persisted matrix from the workspace (the directory the CLI was
 * invoked from), with a friendly nudge when it hasn't been derived.
 *
 * @returns {Matrix}
 */
export function loadMatrix() {
  const path = process.env.SHAKEDOWN_WORKSPACE
    ? `${process.env.SHAKEDOWN_WORKSPACE}/.shakedown/matrix.json`
    : new URL('../.shakedown/matrix.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('No matrix found. Run `shakedown matrix` (or `npm run matrix`) first.');
  }
}

/**
 * The observer reports controllers as the snake_case short name used in the
 * pressgang_render_{key} action; the oracle stores an FQCN. Normalise the
 * FQCN to the observer's shape for comparison.
 *
 * @param {string} fqcn
 * @returns {string}
 */
export function controllerHeaderName(fqcn) {
  const short = fqcn.split('\\').pop() ?? fqcn;
  return short.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Signatures of PHP/Twig failure output in a rendered page body.
 *
 * Covers both plain-text (CLI/log style) and PHP's HTML display format
 * (`<b>Warning</b>:`). Trade-off: a page whose *content* legitimately contains
 * one of these strings will false-positive — accepted, because a marketing
 * page reading "Fatal error" deserves a human look anyway.
 */
export const ERROR_SIGNATURES = [
  'Fatal error',
  'Parse error',
  'Warning: ',
  'Notice: ',
  'Deprecated: ',
  '<b>Fatal error</b>',
  '<b>Warning</b>:',
  '<b>Notice</b>:',
  '<b>Deprecated</b>:',
  'Uncaught Error',
  'Twig\\Error',
  'Stack trace:',
];
