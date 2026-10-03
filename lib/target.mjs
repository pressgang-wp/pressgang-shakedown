/**
 * Target resolution: which site is under trial, and where is it?
 *
 * Resolution order:
 *  1. `shakedown.config.json` found in the cwd or an ancestor directory.
 *     - With a `targets` map (central/multi-site shape): pick `--target`,
 *       $SHAKEDOWN_TARGET, or `defaultTarget`.
 *     - Otherwise the file is a single-target config for this theme.
 *  2. Auto-detection fills any gaps: walk up from cwd to find wp-config.php
 *     (the WP-CLI `sitePath`), then ask WP-CLI for the home URL.
 *
 * A theme therefore needs NO config at all when its site is resolvable by
 * WP-CLI and served at its home URL — config exists for overrides.
 */
import { loadProjectConfig } from './config.mjs';
import { resolveWordPressTarget } from './wordpress-target.mjs';
import { normaliseIgnore } from './suppress.mjs';
import { regressionOptions } from './regression-plan.mjs';

// Preserve the existing helper exports for callers outside target resolution.
export { findUp } from './config.mjs';
export { detectBaseUrl } from './wordpress-target.mjs';

/**
 * Resolve the target for a shakedown run.
 *
 * @param {string} cwd Directory the CLI was invoked from (the workspace).
 * @param {{target?: string}} flags
 * @param {{requireBaseUrl?: boolean}} options Sandbox runs serve their own
 *     URL, so they resolve targets without needing the real site to answer
 *     WP-CLI (a bare core checkout in CI has no installed database).
 * @returns {{name: string, sitePath: string, baseUrl: string, samplesPerType: number, searchTerm: string}}
 */
export function resolveTarget(cwd, flags = {}, { requireBaseUrl = true, regression = false } = {}) {
  const selection = loadProjectConfig(cwd, flags);
  const { config, name } = selection;
  const { sitePath, baseUrl } = resolveWordPressTarget(cwd, selection, { requireBaseUrl });

  return {
    name,
    sitePath,
    baseUrl,
    ...(regression ? { regression: regressionOptions(config.regression, baseUrl, flags) } : {}),
    samplesPerType: config.samplesPerType ?? 2,
    searchTerm: config.searchTerm ?? 'test',
    // Sandbox policy, e.g. { "plugins": ["contact-form-7"] } — the plugin
    // allowlist for throwaway environments (default: none).
    sandbox: config.sandbox ?? {},
    // Suppression policy: findings already judged as not this theme's problem.
    // Normalised (and validated) here so nothing downstream has to guess at
    // missing keys or a mistyped one. See lib/suppress.mjs.
    ignore: normaliseIgnore(config.ignore ?? {}),
  };
}
