/** Resolve the local WordPress installation and its public home URL. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { findUp } from './config.mjs';

/**
 * Ask WP-CLI for the site's home URL.
 *
 * @param {string} sitePath
 * @returns {string}
 */
export function detectBaseUrl(sitePath) {
  const out = execFileSync('wp', ['option', 'get', 'home', `--path=${sitePath}`, '--skip-plugins', '--skip-themes'], {
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = out.trim().split('\n');

  return lines[lines.length - 1].trim().replace(/\/$/, '');
}

export function resolveWordPressTarget(cwd, { config, configDir }, { requireBaseUrl = true } = {}) {
  const sitePath = config.sitePath ? resolve(configDir ?? cwd, config.sitePath) : findUp(cwd, 'wp-config.php');
  if (!sitePath) {
    throw new Error(
      'No WordPress found: no sitePath in shakedown.config.json and no wp-config.php in any ancestor directory.'
    );
  }

  const baseUrl = (config.baseUrl ?? (requireBaseUrl ? detectBaseUrl(sitePath) : 'http://sandbox.invalid')).replace(/\/$/, '');

  return { sitePath, baseUrl };
}
