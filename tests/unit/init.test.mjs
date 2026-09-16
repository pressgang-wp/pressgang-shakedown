import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { initProject, parseInitArgs, discoverWordPress } from '../../lib/init.mjs';
import { resolveTarget } from '../../lib/target.mjs';

const cli = new URL('../../bin/shakedown.mjs', import.meta.url).pathname;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'wp'));
  writeFileSync(join(dir, 'wp', 'wp-load.php'), '<?php');
  return dir;
}
const quiet = { log() {}, detectHome: () => 'https://local.test/' };

test('init creates a portable regression config, preserves ignore contents and refuses reruns', async t => {
  const dir = fixture(t);
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n# keep this comment');
  const config = await initProject(dir, { reference: 'https://production.example/', staging: 'https://staging.example' }, quiet);
  assert.equal(config.sitePath, 'wp');
  assert.equal(config.baseUrl, 'https://local.test');
  assert.equal(config.regression.candidates.staging, 'https://staging.example');
  const before = readFileSync(join(dir, 'shakedown.config.json'), 'utf8');
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), 'node_modules/\n# keep this comment\n/.shakedown/\n');
  await assert.rejects(initProject(dir, {}, quiet), /already exists/);
  assert.equal(readFileSync(join(dir, 'shakedown.config.json'), 'utf8'), before);
  mkdirSync(join(dir, 'subdirectory'));
  const target = resolveTarget(join(dir, 'subdirectory'), {}, { regression: true });
  assert.equal(target.sitePath, join(dir, 'wp'));
  assert.equal(target.regression.reference, 'https://production.example');
  await assert.rejects(initProject(join(dir, 'subdirectory'), {}, quiet), /shadow/);
  assert.equal(existsSync(join(dir, 'subdirectory', 'shakedown.config.json')), false);
});

test('interactive setup accepts detected values and asks for regression environments', async t => {
  const dir = fixture(t), prompts = [], answers = ['', '', 'https://production.example', ''];
  const config = await initProject(dir, {}, { ...quiet, ask: async (label, fallback) => { prompts.push([label, fallback]); return answers.shift(); } });
  assert.equal(prompts.length, 4);
  assert.equal(prompts[0][1], 'wp');
  assert.equal(config.regression.references.production, 'https://production.example');
  assert.deepEqual(config.regression.candidates, { local: 'https://local.test' });
});

test('attached-only setup needs no production URL and retains an existing ignore rule', async t => {
  const dir = fixture(t);
  writeFileSync(join(dir, '.gitignore'), '/.shakedown/\n');
  const config = await initProject(dir, {}, quiet);
  assert.equal(config.regression, undefined);
  assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), '/.shakedown/\n');
});

test('invalid or incomplete setup writes neither config nor ignore files', async t => {
  for (const options of [
    { baseUrl: 'https://user:password@local.test', reference: 'https://prod.example' },
    { reference: 'https://local.test' },
    { reference: 'https://prod.example/path' },
    { reference: 'https://prod.example', staging: 'https://prod.example' },
    { staging: 'https://staging.example' },
    { sitePath: 'missing' },
  ]) {
    const dir = fixture(t);
    await assert.rejects(initProject(dir, options, quiet));
    assert.equal(existsSync(join(dir, 'shakedown.config.json')), false);
    assert.equal(existsSync(join(dir, '.gitignore')), false);
  }
  const dir = fixture(t);
  await assert.rejects(initProject(dir, {}, { ...quiet, detectHome: () => { throw new Error('WP unavailable'); } }), /--base-url/);
  await assert.rejects(initProject(dir, {}, { ...quiet, ask: async () => { throw new Error('cancelled'); } }), /cancelled/);
  assert.equal(existsSync(join(dir, 'shakedown.config.json')), false);
});

test('discovery is bounded and ambiguous installations require a choice', async t => {
  const dir = fixture(t);
  mkdirSync(join(dir, 'wordpress')); writeFileSync(join(dir, 'wordpress', 'wp-load.php'), '<?php');
  assert.equal(discoverWordPress(dir).length, 2);
  await assert.rejects(initProject(dir, {}, quiet), /--site-path/);
  mkdirSync(join(dir, 'wp', 'wp-content'));
  assert.deepEqual(discoverWordPress(join(dir, 'wp', 'wp-content')), [join(dir, 'wp')]);
  await initProject(dir, { sitePath: './wp' }, quiet);
});

test('init refuses symlinked ignore files and does not modify their targets', async t => {
  const dir = fixture(t), target = join(dir, 'other-ignore');
  writeFileSync(target, 'keep\n'); symlinkSync(target, join(dir, '.gitignore'));
  await assert.rejects(initProject(dir, {}, quiet), /regular file/);
  assert.equal(readFileSync(target, 'utf8'), 'keep\n');
  assert.equal(existsSync(join(dir, 'shakedown.config.json')), false);
});

test('init parses both flag styles and rejects unknown, duplicate and valueless options', () => {
  assert.deepEqual(parseInitArgs(['--site-path', './wp', '--reference=https://prod.example', '--yes']), { sitePath: './wp', reference: 'https://prod.example', yes: true });
  for (const args of [['--force'], ['--target=client'], ['--yes=false'], ['--reference'], ['--reference='], ['--base-url', '--yes'], ['--yes', '--yes']]) assert.throws(() => parseInitArgs(args));
});

test('CLI init works before target resolution and only reads the WP home option', t => {
  const dir = fixture(t), bin = join(dir, 'bin'); mkdirSync(bin);
  const wp = join(bin, 'wp');
  writeFileSync(wp, '#!/usr/bin/env node\nconst a=process.argv.slice(2); if(a.length!==6||a.slice(0,3).join(" ")!=="option get home"||!a[3].startsWith("--path=")||a[4]!=="--skip-plugins"||a[5]!=="--skip-themes")process.exit(42); console.log("https://local.test");\n');
  chmodSync(wp, 0o755);
  const invoke = args => spawnSync(process.execPath, [cli, 'init', ...args], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  const help = invoke(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /--reference/);
  assert.equal(existsSync(join(dir, 'shakedown.config.json')), false);
  const run = invoke(['--reference=https://prod.example', '--yes']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Next: npx shakedown regression/);
  assert.equal(existsSync(join(dir, '.shakedown')), false);
  const duplicate = invoke(['--yes']); assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /already exists/);
});
