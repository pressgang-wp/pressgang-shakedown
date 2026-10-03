/**
 * Matrix derivation: enumerate the target site's route surface.
 *
 * Prefers `wp capstan matrix --resolve` (PressGang's own introspection —
 * includes the expected-template/controller oracle for dispatched routes);
 * falls back to the bundled matrix.php when Capstan isn't installed, which
 * derives the same route families without oracle data.
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Parse JSON out of WP-CLI output, tolerating pre-JSON noise
 * (PHP notices on WP_DEBUG sites, plugin chatter).
 *
 * @param {string} out
 * @returns {object|null}
 */
function parseJson(out) {
  const start = out.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<import('./target.mjs').resolveTarget>} target
 * @returns {{matrix: object, source: string}|null}
 */
function tryCapstan(target) {
  try {
    const out = execFileSync(
      'wp',
      [
        'capstan',
        'matrix',
        '--resolve',
        '--format=json',
        `--samples=${target.samplesPerType}`,
        `--search=${target.searchTerm}`,
        `--path=${target.sitePath}`,
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const matrix = parseJson(out);

    return matrix ? { matrix, source: 'capstan' } : null;
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<import('./target.mjs').resolveTarget>} target
 * @returns {{matrix: object, source: string}}
 */
function runBundledScript(target) {
  const out = execFileSync(
    'wp',
    [
      'eval-file',
      join(pkgRoot, 'bin/matrix.php'),
      String(target.samplesPerType),
      target.searchTerm,
      `--path=${target.sitePath}`,
    ],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const matrix = parseJson(out);

  if (!matrix) {
    throw new Error(`matrix.php produced no JSON:\n${out.trim().slice(0, 500)}`);
  }

  return { matrix, source: 'bundled matrix.php' };
}

/**
 * Route families the primary derivation doesn't enumerate: author and date
 * archives, page 2, feeds, an empty search.
 *
 * Merged into whichever source produced the base matrix, so Capstan and the
 * bundled script cover the same ground — only the oracle should differ. Failure
 * here is swallowed: these are supplementary by definition and shouldn't cost a
 * run its whole matrix.
 *
 * @param {ReturnType<import('./target.mjs').resolveTarget>} target
 * @returns {array<{url: string, kind: string, expect: number, html?: boolean}>}
 */
function supplementRoutes(target, warnings = [], excluded = []) {
  try {
    const out = execFileSync(
      'wp',
      [
        'eval-file',
        join(pkgRoot, 'bin/matrix-supplement.php'),
        String(target.samplesPerType),
        `--path=${target.sitePath}`,
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    const payload = parseJson(out);
    const routes = payload?.routes;
    if (!Array.isArray(routes)) throw new Error('Supplement produced no route array');
    warnings.push(...(payload.warnings ?? []));
    excluded.push(...(payload.excluded ?? []));
    return routes;
  } catch (error) {
    warnings.push(`Supplementary route discovery unavailable: ${error.message.split('\n')[0]}`);
    return [];
  }
}

/**
 * Pre-flight configuration health via `wp capstan doctor --format=json`.
 *
 * @param {string} sitePath
 * @returns {{checks: array, failures: number, warnings: number}|null}
 *     null when Capstan isn't installed — the pre-flight is optional.
 */
export function capstanDoctor(sitePath) {
  try {
    const out = execFileSync('wp', ['capstan', 'doctor', '--format=json', `--path=${sitePath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return parseJson(out);
  } catch (err) {
    // Doctor exits non-zero when checks FAIL — that's a report, not an error.
    const report = parseJson(String(err.stdout ?? ''));

    return report ?? null;
  }
}

export function inventoryRoutes(target) {
  const output = execFileSync('wp', ['eval-file', fileURLToPath(new URL('../bin/route-inventory.php', import.meta.url)), `--path=${target.sitePath}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const inventory = JSON.parse(output.slice(output.indexOf('{')));
  if (!Array.isArray(inventory.routes)) throw new Error('Inventory returned no routes');
  return inventory;
}

/** Collect raw discovery evidence without writing or applying route policy. */
export function discoverWordPressRoutes(target) {
  const { matrix, source } = tryCapstan(target) ?? runBundledScript(target);
  const warnings = [], excluded = [];
  const routes = supplementRoutes(target, warnings, excluded);
  return { matrix, source, supplement: { source: 'bundled matrix-supplement.php', routes, warnings, excluded } };
}
