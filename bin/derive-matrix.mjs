#!/usr/bin/env node
/**
 * Derives the route matrix for a target site and writes .shakedown/matrix.json.
 *
 * Usage: node bin/derive-matrix.mjs [target]
 *
 * The target names an entry in shakedown.config.json; WP-CLI runs bin/matrix.php
 * inside that site and this script persists the result for the test passes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Resolve the requested target from shakedown.config.json.
 *
 * @param {string|undefined} name Target name; falls back to SHAKEDOWN_TARGET, then defaultTarget.
 * @returns {{name: string, target: object}}
 */
function resolveTarget(name) {
  const config = JSON.parse(readFileSync(join(root, 'shakedown.config.json'), 'utf8'));
  const targetName = name || process.env.SHAKEDOWN_TARGET || config.defaultTarget;
  const target = config.targets[targetName];

  if (!target) {
    console.error(`Unknown target "${targetName}". Available: ${Object.keys(config.targets).join(', ')}`);
    process.exit(1);
  }

  return { name: targetName, target };
}

/**
 * Run matrix.php inside the target site via WP-CLI and parse its JSON output.
 *
 * Output before the JSON payload (PHP notices on WP_DEBUG sites, plugin chatter)
 * is tolerated by parsing from the first "{".
 *
 * @param {{name: string, target: object}} resolved
 * @returns {object} The matrix, annotated with target name and base URL.
 */
function deriveMatrix({ name, target }) {
  let out;
  try {
    out = execFileSync(
      'wp',
      [
        'eval-file',
        join(root, 'bin/matrix.php'),
        String(target.samplesPerType ?? 2),
        String(target.searchTerm ?? 'test'),
        `--path=${target.sitePath}`,
      ],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (err) {
    console.error(`WP-CLI failed for target "${name}" (sitePath: ${target.sitePath}).`);
    console.error(String(err.stderr || err.message).trim());
    process.exit(1);
  }

  const jsonStart = out.indexOf('{');
  if (jsonStart === -1) {
    console.error(`matrix.php produced no JSON for target "${name}":\n${out.trim()}`);
    process.exit(1);
  }

  const matrix = JSON.parse(out.slice(jsonStart));
  matrix.target = name;
  matrix.baseUrl = target.baseUrl;

  return matrix;
}

/**
 * Persist the matrix and print a per-route summary.
 *
 * @param {object} matrix
 * @returns {void}
 */
function persistAndReport(matrix) {
  mkdirSync(join(root, '.shakedown'), { recursive: true });
  writeFileSync(join(root, '.shakedown/matrix.json'), JSON.stringify(matrix, null, 2));

  console.log(`Matrix for "${matrix.target}": ${matrix.routes.length} routes → .shakedown/matrix.json`);
  for (const r of matrix.routes) {
    console.log(`  [${r.expect}] ${r.kind.padEnd(28)} ${r.url}`);
  }
}

persistAndReport(deriveMatrix(resolveTarget(process.argv[2])));
