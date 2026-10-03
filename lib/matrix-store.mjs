/** Persisted matrix IO; the invocation workspace owns the artifact. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const matrixPath = workspace => join(workspace, '.shakedown', 'matrix.json');

/** @returns {import('./matrix.mjs').Matrix} */
export function readMatrix(workspace) {
  return JSON.parse(readFileSync(matrixPath(workspace), 'utf8'));
}

/** Write the existing JSON format and return its artifact path. */
export function writeMatrix(workspace, matrix) {
  const path = matrixPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(matrix, null, 2));
  return path;
}

/** Pass collection retains its existing workspace default and missing-matrix hint. */
export function loadMatrix(workspace = process.env.SHAKEDOWN_WORKSPACE || pkgRoot) {
  try {
    return readMatrix(workspace);
  } catch {
    throw new Error('No matrix found. Run `shakedown matrix` (or `npm run matrix`) first.');
  }
}
