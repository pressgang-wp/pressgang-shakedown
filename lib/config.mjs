/** Project configuration selection, independent of a site's platform. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Find a file in `start` or the nearest ancestor directory.
 *
 * @param {string} start
 * @param {string} name
 * @returns {string|null} Absolute path of the containing directory, or null.
 */
export function findUp(start, name) {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, name))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Select the nearest config and its target without probing WordPress. */
export function loadProjectConfig(cwd, flags = {}) {
  let config = {};
  let name = 'auto';

  const configDir = findUp(cwd, 'shakedown.config.json');
  if (configDir) {
    const file = JSON.parse(readFileSync(join(configDir, 'shakedown.config.json'), 'utf8'));

    if (file.targets) {
      name = flags.target || process.env.SHAKEDOWN_TARGET || file.defaultTarget;
      config = file.targets[name];
      if (!config) {
        throw new Error(`Unknown target "${name}". Available: ${Object.keys(file.targets).join(', ')}`);
      }
    } else {
      config = file;
    }
  }

  return { config, name, configDir };
}
