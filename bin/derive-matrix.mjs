#!/usr/bin/env node
/**
 * Derives the route matrix for a target site via WP-CLI and writes .shakedown/matrix.json
 * Usage: node bin/derive-matrix.mjs [target]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(readFileSync(join(root, 'shakedown.config.json'), 'utf8'));
const targetName = process.argv[2] || process.env.SHAKEDOWN_TARGET || config.defaultTarget;
const target = config.targets[targetName];
if (!target) {
  console.error(`Unknown target "${targetName}". Available: ${Object.keys(config.targets).join(', ')}`);
  process.exit(1);
}

const out = execFileSync(
  'wp',
  ['eval-file', join(root, 'bin/matrix.php'), String(target.samplesPerType ?? 2), `--path=${target.sitePath}`],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);

const matrix = JSON.parse(out);
matrix.target = targetName;
matrix.baseUrl = target.baseUrl;

mkdirSync(join(root, '.shakedown'), { recursive: true });
writeFileSync(join(root, '.shakedown/matrix.json'), JSON.stringify(matrix, null, 2));
console.log(`Matrix for "${targetName}": ${matrix.routes.length} routes → .shakedown/matrix.json`);
for (const r of matrix.routes) console.log(`  [${r.expect}] ${r.kind.padEnd(28)} ${r.url}`);
