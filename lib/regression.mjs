/** Existing CLI entry point: prepare WordPress evidence inside a regression session. */
import { prepareRegression } from './regression-prepare.mjs';
import { runRegressionSession } from './regression-runner.mjs';

export async function runRegression(target, workspace) {
  return runRegressionSession(workspace, {
    discovery: { acf: 'No field-to-DOM assertions: ACF locations alone do not prove rendered content.' },
    prepare: (run, dir) => prepareRegression(target, dir, run),
  });
}
