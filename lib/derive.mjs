/**
 * Matrix derivation: enumerate the target site's route surface.
 *
 * Prefers `wp capstan matrix --resolve` (PressGang's own introspection —
 * includes the expected-template/controller oracle for dispatched routes);
 * falls back to the bundled matrix.php when Capstan isn't installed, which
 * derives the same route families without oracle data.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Derive the matrix and persist it to <workspace>/.shakedown/matrix.json.
 *
 * @param {ReturnType<import('./target.mjs').resolveTarget>} target
 * @param {string} workspace Directory run artifacts belong to.
 * @returns {{matrix: object, source: string, path: string}}
 */
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

/**
 * Merge extra routes into the persisted matrix, first-occurrence-wins on URL
 * collisions — so specific labels (state:*) prepended here beat the generic
 * single:* labels the derivation gave the same URLs.
 *
 * @param {string} workspace
 * @param {array<{url: string, kind: string, expect: number}>} extraRoutes
 * @returns {object} The merged matrix.
 */
export function mergeRoutes(workspace, extraRoutes) {
  const path = join(workspace, '.shakedown', 'matrix.json');
  const matrix = JSON.parse(readFileSync(path, 'utf8'));

  const seen = new Set();
  matrix.routes = [...extraRoutes, ...matrix.routes].filter((route) => {
    if (seen.has(route.url)) return false;
    seen.add(route.url);
    return true;
  });

  writeFileSync(path, JSON.stringify(matrix, null, 2));

  return matrix;
}

export function deriveMatrix(target, workspace) {
  const { matrix, source } = tryCapstan(target) ?? runBundledScript(target);

  matrix.target = target.name;
  matrix.baseUrl = target.baseUrl;

  const dir = join(workspace, '.shakedown');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'matrix.json');
  writeFileSync(path, JSON.stringify(matrix, null, 2));

  return { matrix, source, path };
}
