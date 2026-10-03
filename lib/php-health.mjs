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
