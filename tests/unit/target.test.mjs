import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjectConfig } from '../../lib/config.mjs';
import { resolveWordPressTarget } from '../../lib/wordpress-target.mjs';
import { resolveTarget } from '../../lib/target.mjs';
import { normaliseIgnore } from '../../lib/suppress.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'shakedown-target-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('project selection works without WordPress and retains CLI, environment and default precedence', () => {
  fixture(root => {
    const config = { targets: { first: { baseUrl: 'https://first.test' }, second: { baseUrl: 'https://second.test' } }, defaultTarget: 'first' };
    writeFileSync(join(root, 'shakedown.config.json'), JSON.stringify(config));
    const cwd = join(root, 'nested');
    mkdirSync(cwd);
    const previous = process.env.SHAKEDOWN_TARGET;
    try {
      delete process.env.SHAKEDOWN_TARGET;
      assert.deepEqual(loadProjectConfig(cwd), { name: 'first', config: config.targets.first, configDir: root });
      process.env.SHAKEDOWN_TARGET = 'second';
      assert.equal(loadProjectConfig(cwd).name, 'second');
      assert.equal(loadProjectConfig(cwd, { target: 'first' }).name, 'first');
      assert.throws(() => loadProjectConfig(cwd, { target: 'missing' }), /Unknown target "missing". Available: first, second/);
      assert.throws(() => resolveWordPressTarget(cwd, loadProjectConfig(cwd)), /No WordPress found/);
    } finally {
      if (previous === undefined) delete process.env.SHAKEDOWN_TARGET;
      else process.env.SHAKEDOWN_TARGET = previous;
    }
  });
});

test('nearest single-target config resolves paths relative to itself and retains defaults', () => {
  fixture(root => {
    writeFileSync(join(root, 'shakedown.config.json'), JSON.stringify({ sitePath: 'outer', baseUrl: 'https://outer.test' }));
    const configDir = join(root, 'project'), cwd = join(configDir, 'theme');
    mkdirSync(cwd, { recursive: true });
    const config = { sitePath: './wp', baseUrl: 'https://site.test/', sandbox: { seed: 7 }, ignore: { routes: ['/private/'] } };
    writeFileSync(join(configDir, 'shakedown.config.json'), JSON.stringify(config));
    assert.deepEqual(resolveTarget(cwd, { target: 'ignored-for-single-target' }), {
      name: 'auto', sitePath: join(configDir, 'wp'), baseUrl: 'https://site.test',
      samplesPerType: 2, searchTerm: 'test', sandbox: { seed: 7 }, ignore: normaliseIgnore(config.ignore),
    });
  });
});

test('bare sandbox target resolution needs neither an installed database nor a WP-CLI home lookup', () => {
  fixture(root => {
    writeFileSync(join(root, 'wp-config.php'), '<?php // discovery marker only');
    const cwd = join(root, 'theme');
    mkdirSync(cwd);
    assert.deepEqual(loadProjectConfig(cwd), { name: 'auto', config: {}, configDir: null });
    const target = resolveTarget(cwd, {}, { requireBaseUrl: false });
    assert.equal(target.sitePath, root);
    assert.equal(target.baseUrl, 'http://sandbox.invalid');
    assert.equal(target.regression, undefined);
  });
});

test('regression options and suppression validation remain in target composition', () => {
  fixture(root => {
    const file = join(root, 'shakedown.config.json');
    const config = { sitePath: 'wp', baseUrl: 'https://site.test', regression: {
      references: { production: 'https://production.test' }, candidates: { local: 'https://site.test' }, defaultLevel: 'full',
    } };
    writeFileSync(file, JSON.stringify(config));
    assert.equal(resolveTarget(root).regression, undefined);
    assert.equal(resolveTarget(root, { level: 'errors' }, { regression: true }).regression.level, 'errors');
    writeFileSync(file, JSON.stringify({ ...config, ignore: { typo: [] } }));
    assert.throws(() => resolveTarget(root), /typo/);
  });
});
