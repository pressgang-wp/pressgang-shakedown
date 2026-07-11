#!/usr/bin/env node
/**
 * Thin wrapper kept for `npm run matrix` in this repo.
 * The real logic lives in lib/target.mjs and lib/derive.mjs;
 * the `shakedown` CLI (bin/shakedown.mjs) is the primary entry point.
 *
 * Usage: node bin/derive-matrix.mjs [target]
 */
import { resolveTarget } from '../lib/target.mjs';
import { deriveMatrix } from '../lib/derive.mjs';

const target = resolveTarget(process.cwd(), { target: process.argv[2] });
const { matrix, source, path } = deriveMatrix(target, process.cwd());

console.log(`Matrix for "${target.name}": ${matrix.routes.length} routes (via ${source}) → ${path}`);
for (const r of matrix.routes) {
  console.log(`  [${r.expect}] ${r.kind.padEnd(28)} ${r.url}`);
}
