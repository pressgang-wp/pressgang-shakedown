/** Project setup only: local config/ignore files, never WordPress data or baselines. */
import { existsSync, lstatSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, constants } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { findUp, detectBaseUrl } from './target.mjs';
import { origin, regressionOptions } from './regression-plan.mjs';

export const initHelp = `Usage: shakedown init [options]
Run in the project directory where configuration and reports should live.

  --site-path <path>  Local WordPress core directory (auto-detected when possible)
  --base-url <url>    Local site's public origin (otherwise read through WP-CLI)
  --reference <url>   Production origin; enables regression against local
  --staging <url>     Optional staging candidate (requires --reference)
  --yes              Use detected values without interactive questions
  --help             Show this help

Both --name=value and --name value are supported. Non-interactive runs never
prompt; supply missing values with flags. Without a reference, setup is for
attached testing only. Existing configs are never overwritten or shadowed.
Creates shakedown.config.json and adds /.shakedown/ to .gitignore.
No dependency installation, test run, database change or baseline update.`;

export function parseInitArgs(args) {
  const options = {};
  const names = { 'site-path': 'sitePath', 'base-url': 'baseUrl', reference: 'reference', staging: 'staging', yes: 'yes', help: 'help' };
  for (let i = 0; i < args.length; i++) {
    const match = args[i].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match || !Object.hasOwn(names, match[1])) throw new Error(`Unknown init argument: ${args[i]}. Run shakedown init --help.`);
    const key = names[match[1]];
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate init option: --${match[1]}`);
    if (key === 'yes' || key === 'help') {
      if (match[2] !== undefined) throw new Error(`--${match[1]} does not take a value`);
      options[key] = true;
    } else {
      const value = match[2] ?? args[++i];
      if (!value?.trim() || value.startsWith('--')) throw new Error(`--${match[1]} requires a value`);
      options[key] = value.trim();
    }
  }
  return options;
}

/** Bounded discovery, not a recursive scan of unrelated projects. */
export function discoverWordPress(workspace) {
  const ancestor = findUp(workspace, 'wp-load.php');
  if (ancestor) return [ancestor];
  return ['wp', 'wordpress', 'web/wp', 'public/wp', 'public'].map(p => join(workspace, p))
    .filter(p => existsSync(join(p, 'wp-load.php')));
}

export async function initProject(workspace, options, { ask, detectHome = detectBaseUrl, log = console.log } = {}) {
  workspace = resolve(workspace);
  const existing = findUp(workspace, 'shakedown.config.json');
  if (existing) throw new Error(`Configuration already exists at ${join(existing, 'shakedown.config.json')}. Edit that file; init will not overwrite or shadow it.`);
  const ignorePath = join(workspace, '.gitignore');
  let ignored = '';
  try {
    if (!lstatSync(ignorePath).isFile()) throw new Error('Refusing to modify a .gitignore that is not a regular file.');
    ignored = readFileSync(ignorePath, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const choose = async (label, fallback = '') => ask ? (await ask(label, fallback)).trim() || fallback : fallback;
  const candidates = discoverWordPress(workspace);
  if (candidates.length > 1) log(`Multiple WordPress installations found: ${candidates.map(p => relative(workspace, p)).join(', ')}`);
  const chosen = options.sitePath ?? await choose('WordPress directory', candidates.length === 1 ? relative(workspace, candidates[0]) || '.' : '');
  if (!chosen) throw new Error('Cannot choose a WordPress installation. Supply --site-path=<path>.');
  const sitePath = resolve(workspace, chosen);
  if (!existsSync(join(sitePath, 'wp-load.php'))) throw new Error(`No WordPress core at ${sitePath}. Supply --site-path pointing to the directory containing wp-load.php.`);
  let detected = '';
  if (!options.baseUrl) {
    try { detected = detectHome(sitePath); }
    catch { log('Could not read the home URL through WP-CLI; supply the local URL explicitly.'); }
  }
  const base = options.baseUrl ?? await choose('Local public URL', detected);
  if (!base) throw new Error('Local URL is required. Supply --base-url=<url>, or make WordPress accessible through WP-CLI.');
  const baseUrl = origin(base);
  const reference = options.reference ?? await choose('Production URL (blank skips regression setup)');
  const staging = options.staging ?? (reference ? await choose('Staging URL (optional)') : '');
  if (staging && !reference) throw new Error('--staging requires a production --reference.');
  const config = { sitePath: relative(workspace, sitePath) || '.', baseUrl };
  if (reference) {
    config.regression = {
      defaultViewports: ['desktop'],
      references: { production: origin(reference) },
      candidates: { local: baseUrl, ...(staging ? { staging: origin(staging) } : {}) },
    };
    regressionOptions(config.regression, baseUrl);
    if (staging) regressionOptions(config.regression, baseUrl, { candidate: 'staging' });
  }
  const path = join(workspace, 'shakedown.config.json');
  // Exclusive creation also protects against another init racing this one.
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
  // Append an explicit rule last: earlier negations must not expose run artifacts.
  const lastRule = ignored.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).at(-1);
  if (!['/.shakedown/', '.shakedown/', '/.shakedown', '.shakedown'].includes(lastRule)) {
    try {
      const fd = openSync(ignorePath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o666);
      try { writeSync(fd, (ignored && !ignored.endsWith('\n') ? '\n' : '') + '/.shakedown/\n'); }
      finally { closeSync(fd); }
    } catch (error) {
      throw new Error(`Created ${path}, but could not update .gitignore: ${error.message}. Add /.shakedown/ manually.`);
    }
  }
  log(`Created ${path}\nGenerated reports are ignored in ${ignorePath}.\nCommit shakedown.config.json and .gitignore with your project.`);
  log('If needed, install Chromium once: npx playwright install chromium');
  log(reference ? 'Next: npx shakedown regression --against=production --candidate=local\nOpen the index.html path printed by the run; reports live in .shakedown/regression/run-*/.' : 'Next: npx shakedown\nFor regression later, add named references and candidates to this config (see docs/REGRESSION.md).');
  return config;
}

export async function runInit(workspace, args) {
  const options = parseInitArgs(args);
  if (options.help) { console.log(initHelp); return; }
  let rl;
  const abort = new AbortController();
  try {
    if (process.stdin.isTTY && process.stdout.isTTY && !options.yes) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.on('close', () => abort.abort());
      rl.on('SIGINT', () => { abort.abort(); rl.close(); });
    }
    return await initProject(workspace, options, {
      ask: rl ? (label, fallback) => rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `, { signal: abort.signal }) : undefined,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Setup cancelled; no configuration written.');
    throw error;
  } finally { rl?.close(); }
}
