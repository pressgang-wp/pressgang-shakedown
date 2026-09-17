import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const require = createRequire(import.meta.url);
const execute = promisify(execFile);

/** Public Playwright matcher and HTML viewer; expected captures are disposable. */
export async function compareScreenshots(_browser, dir, reference, candidate, output) {
  if (!reference || !candidate) return { unavailable: 'One or both screenshots were not captured.' };
  let temporary;
  try {
    const buffers = [reference, candidate].map(file => readFileSync(join(dir, file)));
    const dimensions = buffers.map(buffer => {
      if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG screenshot');
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    });
    if (Math.max(...dimensions.map(d => d.width)) * Math.max(...dimensions.map(d => d.height)) > 16000000) return { dimensions, unavailable: 'Comparison exceeds the 16 million pixel limit.' };
    temporary = mkdtempSync(join(tmpdir(), 'shakedown-visual-'));
    const viewer = output.replace(/\.png$/, '-playwright');
    writeFileSync(join(temporary, 'reference.png'), buffers[0]);
    writeFileSync(join(temporary, 'candidate.png'), buffers[1]);
    writeFileSync(join(temporary, 'compare.spec.cjs'), `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
const { readFileSync } = require('node:fs');
test('Observed reference versus candidate', () => {
  expect(readFileSync(${JSON.stringify(join(temporary, 'candidate.png'))})).toMatchSnapshot('reference.png');
});`);
    writeFileSync(join(temporary, 'playwright.config.cjs'), 'module.exports = ' + JSON.stringify({
      testDir: temporary, testMatch: 'compare.spec.cjs', workers: 1, retries: 0,
      updateSnapshots: 'none', snapshotPathTemplate: '{testDir}/{arg}{ext}',
      outputDir: join(temporary, 'results'), timeout: 15000,
      expect: { toMatchSnapshot: { threshold: 0.2, maxDiffPixels: 0 } },
      reporter: [['json', { outputFile: join(temporary, 'result.json') }], ['html', { outputFolder: join(dir, viewer), open: 'never' }]],
    }));
    try {
      await execute(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', join(temporary, 'playwright.config.cjs')], { cwd: temporary, timeout: 30000, maxBuffer: 1024 * 1024, env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never', PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, viewer), PLAYWRIGHT_JSON_OUTPUT_FILE: join(temporary, 'result.json') } });
    } catch (error) { if (error.code !== 1) throw error; }
    const report = JSON.parse(readFileSync(join(temporary, 'result.json'), 'utf8'));
    const tests = report.suites.flatMap(s => s.specs).flatMap(s => s.tests);
    if (report.errors?.length || tests.length !== 1 || tests[0].results.length !== 1) throw new Error('Playwright comparison did not produce one complete result');
    const result = tests[0].results[0];
    const diff = result.attachments?.find(a => a.name.endsWith('-diff.png'));
    if (result.status !== 'passed' && !(result.status === 'failed' && diff?.path)) throw new Error('Playwright comparison failed without image-diff evidence');
    if (diff) copyFileSync(diff.path, join(dir, output));
    return { engine: 'Playwright toMatchSnapshot', changed: result.status === 'failed', dimensions, threshold: 0.2, screenshot: diff ? output : undefined, report: `${viewer}/index.html` };
  } catch (error) { return { unavailable: error.message.split('\n')[0] }; }
  finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
}
