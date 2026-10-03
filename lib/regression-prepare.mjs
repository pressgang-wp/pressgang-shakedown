/** WordPress preparation for a regression run; browser execution consumes its plan. */
import { deriveMatrix } from './derive.mjs';
import { capstanDoctor, inventoryRoutes } from './wordpress-discovery.mjs';
import { addCoverage } from './coverage.mjs';
import { pairedPlan } from './regression-plan.mjs';

/**
 * Populate the run incrementally: if inventory or a later preparation step
 * fails, the session must still report the plan and evidence already obtained.
 * Discovery artifacts belong to this run directory, never the attached run.
 */
export function prepareRegression(target, dir, run) {
  // Discovery artifacts stay inside this run; ordinary attached/sandbox matrix is untouched.
  const { matrix, source, ignored, supplemented } = deriveMatrix(target, dir);
  run.plan = pairedPlan(matrix, target.regression, source);
  try {
    run.coverage = addCoverage(run.plan, inventoryRoutes(target), target.regression.coverage);
  } catch (error) {
    run.coverage = { mode: target.regression.coverage ?? 'sampled', state: 'unavailable', error: error.message.split('\n')[0] };
    if (target.regression.coverage === 'exhaustive') throw new Error('Exhaustive inventory unavailable: ' + run.coverage.error);
  }
  run.discovery = { ...run.discovery, source, derived: matrix.routes.length, ignored, supplemented, warnings: matrix.discoveryWarnings, excluded: matrix.discoveryExcluded, doctor: capstanDoctor(target.sitePath) };
}
