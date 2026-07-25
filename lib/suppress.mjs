/**
 * Suppression policy: which findings are not this theme's to answer for.
 *
 * The derived passes are deliberately strict — zero console errors, zero PHP
 * notices, no serious axe violations. On a real site some of that noise belongs
 * to somebody else: a tag manager logging to the console, a deprecation raised
 * inside ACF on a newer PHP, a contrast rule the brand palette loses on purpose.
 * Without a way to say so, the only lever left is switching a whole pass off,
 * which trades a little noise for all of the signal.
 *
 * This is not a bespoke spec file — it declares no checks and invents no routes.
 * It records, per theme, which findings have already been judged. The passes
 * already carried policy of exactly this kind hard-coded (third-party request
 * failures ignored, iframes excluded from axe, moderate/minor a11y advisory);
 * this makes that layer configurable instead of frozen.
 *
 * Matching is plain SUBSTRING, case-sensitive — not regex, not glob. A finding
 * is suppressed when a pattern appears anywhere in its text, so the string you
 * paste out of a failure message is the string that silences it, with no
 * escaping to get wrong and no pattern that quietly matches everything.
 * `a11yRules` is the exception: those are exact axe rule IDs, handed to
 * axe's own disableRules().
 */

/** Every recognised key in the `ignore` block, with what each one matches. */
export const IGNORE_KEYS = {
  routes: 'route URLs — dropped from the matrix, so no pass visits them',
  consoleErrors: 'browser console error text (pass 01)',
  requests: 'URLs of failed same-origin requests (pass 01)',
  phpIssues: 'PHP notice signatures, "<message> in <path>:<line>" (pass 00, sandbox)',
  a11yRules: 'exact axe rule IDs to disable, e.g. "color-contrast" (pass 02)',
};

/** The shape of an empty policy — every key present, nothing suppressed. */
export const NO_SUPPRESSIONS = Object.freeze(
  Object.fromEntries(Object.keys(IGNORE_KEYS).map((k) => [k, Object.freeze([])]))
);

/**
 * Does any pattern suppress this finding?
 *
 * @param {string[]} patterns Substrings; an empty list suppresses nothing.
 * @param {string} text The finding's text (message, URL, signature).
 * @returns {boolean}
 */
export function suppressed(patterns, text) {
  if (!patterns || patterns.length === 0) return false;

  const haystack = String(text ?? '');

  return patterns.some((pattern) => haystack.includes(pattern));
}

/**
 * Read one category out of a persisted matrix, tolerating a matrix written
 * before the policy existed (`shakedown test` reuses whatever is on disk).
 *
 * @param {{ignore?: object}} matrix
 * @param {keyof typeof IGNORE_KEYS} key
 * @returns {string[]}
 */
export function ignoresFor(matrix, key) {
  const value = matrix?.ignore?.[key];

  return Array.isArray(value) ? value : [];
}

/**
 * Validate and normalise a config's `ignore` block into every key, so callers
 * never branch on absence.
 *
 * Unknown keys THROW rather than being skipped: a policy is only as good as its
 * spelling, and a silently-ignored `consoleError` (singular) suppresses nothing
 * while reading, in the config, exactly as though it did.
 *
 * @param {object} raw The `ignore` value from shakedown.config.json.
 * @returns {Record<string, string[]>}
 */
export function normaliseIgnore(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('shakedown.config.json "ignore" must be an object of pattern lists.');
  }

  const known = Object.keys(IGNORE_KEYS);
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown ignore key(s): ${unknown.join(', ')}. Valid keys: ${known.join(', ')}.`
    );
  }

  const ignore = {};

  for (const key of known) {
    const value = raw[key] ?? [];

    if (!Array.isArray(value) || value.some((p) => typeof p !== 'string' || p.trim() === '')) {
      throw new TypeError(`ignore.${key} must be an array of non-empty strings.`);
    }

    ignore[key] = [...value];
  }

  return ignore;
}

/**
 * Flatten a policy to "key: n pattern(s)" lines, for logging and for the trial
 * report's disclosure. Suppression that isn't disclosed is just a blind spot.
 *
 * @param {Record<string, string[]>} ignore
 * @returns {Array<{key: string, patterns: string[]}>} Only non-empty categories.
 */
export function activeSuppressions(ignore = {}) {
  return Object.keys(IGNORE_KEYS)
    .map((key) => ({ key, patterns: Array.isArray(ignore[key]) ? ignore[key] : [] }))
    .filter((entry) => entry.patterns.length > 0);
}
