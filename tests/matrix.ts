import { readFileSync } from 'node:fs';

/** One derived route: a URL, why it exists, and the HTTP status it should return. */
export interface Route {
  /** Absolute URL to test. */
  url: string;
  /** `family:detail` label, e.g. `archive:event`, `template:contact-page.php`. */
  kind: string;
  /** Intended HTTP status (200 for real routes, 404 for the unknown-URL probe). */
  expect: number;
}

/** The derived matrix written by `npm run matrix` (bin/derive-matrix.mjs). */
export interface Matrix {
  target: string;
  baseUrl: string;
  routes: Route[];
}

/**
 * Load the persisted matrix, with a friendly nudge when it hasn't been derived.
 */
export function loadMatrix(): Matrix {
  const path = new URL('../.shakedown/matrix.json', import.meta.url);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('No matrix found. Run `npm run matrix` first.');
  }
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
