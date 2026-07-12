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
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find a file in `start` or the nearest ancestor directory.
 *
 * @param {string} start
 * @param {string} name
 * @returns {string|null} Absolute path of the containing directory, or null.
 */
function findUp(start, name) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Ask WP-CLI for the site's home URL.
 *
 * @param {string} sitePath
 * @returns {string}
 */
function detectBaseUrl(sitePath) {
  const out = execFileSync('wp', ['option', 'get', 'home', `--path=${sitePath}`, '--skip-plugins', '--skip-themes'], {
    encoding: 'utf8',
  });
  const lines = out.trim().split('\n');

  return lines[lines.length - 1].trim().replace(/\/$/, '');
}

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
export function resolveTarget(cwd, flags = {}, { requireBaseUrl = true } = {}) {
  let config = {};
  let name = 'auto';

  const configDir = findUp(cwd, 'shakedown.config.json');
  if (configDir) {
    const file = JSON.parse(readFileSync(join(configDir, 'shakedown.config.json'), 'utf8'));

    if (file.targets) {
      name = flags.target || process.env.SHAKEDOWN_TARGET || file.defaultTarget;
      config = file.targets[name];
      if (!config) {
        throw new Error(`Unknown target "${name}". Available: ${Object.keys(file.targets).join(', ')}`);
      }
    } else {
      config = file;
    }
  }

  const sitePath = config.sitePath ?? findUp(cwd, 'wp-config.php');
  if (!sitePath) {
    throw new Error(
      'No WordPress found: no sitePath in shakedown.config.json and no wp-config.php in any ancestor directory.'
    );
  }

  const baseUrl = (config.baseUrl ?? (requireBaseUrl ? detectBaseUrl(sitePath) : 'http://sandbox.invalid')).replace(/\/$/, '');

  return {
    name,
    sitePath,
    baseUrl,
    samplesPerType: config.samplesPerType ?? 2,
    searchTerm: config.searchTerm ?? 'test',
    // Sandbox policy, e.g. { "plugins": ["contact-form-7"] } — the plugin
    // allowlist for throwaway environments (default: none).
    sandbox: config.sandbox ?? {},
  };
}
