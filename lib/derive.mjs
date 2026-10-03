/** Existing derivation entry points: discover, assemble, then persist. */
import { discoverWordPressRoutes } from './wordpress-discovery.mjs';
import { assembleMatrix, prependMatrixRoutes } from './matrix.mjs';
import { readMatrix, writeMatrix } from './matrix-store.mjs';

export { capstanDoctor } from './wordpress-discovery.mjs';

/** Derive and persist the matrix in the invocation workspace. */
export function deriveMatrix(target, workspace) {
  const { matrix, source, ignored, supplemented } = assembleMatrix(discoverWordPressRoutes(target), target);
  const path = writeMatrix(workspace, matrix);
  return { matrix, source, path, ignored, supplemented };
}

/** Seeded state routes keep precedence over generic discovery labels. */
export function mergeRoutes(workspace, extraRoutes) {
  const matrix = prependMatrixRoutes(readMatrix(workspace), extraRoutes);
  writeMatrix(workspace, matrix);
  return matrix;
}
