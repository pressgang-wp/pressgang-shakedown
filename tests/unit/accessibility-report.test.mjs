import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import TrialReporter from '../../lib/trial-reporter.mjs';
import { renderAccessibilityEvidence } from '../../lib/accessibility-report.mjs';

test('trial report keeps failed attempt evidence and portable screenshot attachments after a successful retry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'shakedown-report-'));
  try {
    const evidence = { screenshot: 'source.png', width: 800, height: 900, findings: [{
      id: 'button-name', impact: 'critical', blocking: true, nodes: [{
        target: ['button'], html: '<button onclick="evil()">', highlight: { box: {x: 0,y: 0,width: 50,height: 40} },
      }],
    }] };
    const first = {status:'failed', error:{message:'button-name'}, attachments:[
      {name:'accessibility-evidence',body:Buffer.from(JSON.stringify(evidence))},
      {name:'accessibility-screenshot',body:Buffer.from('fixture PNG')},
    ]};
    const second = {status:'passed',attachments:[{name:'accessibility-evidence',body:Buffer.from('{"findings":[]}')}]};
    const t = {id:'unique test',title:'02 home https://example.test/',results:[first,second],outcome:() => 'flaky'};
    const reporter = new TrialReporter(); reporter.workspace = dir;
    reporter.onTestEnd(t,first); reporter.onTestEnd(t,second); reporter.onEnd();
    const run = JSON.parse(readFileSync(join(dir,'.shakedown/run.json'),'utf8'));
    assert.equal(run.results[0].outcome,'flaky');
    assert.equal(run.results[0].accessibility.length,2);
    const image = run.results[0].accessibility[0].screenshot;
    assert.equal(readFileSync(join(dir,'.shakedown',image),'utf8'),'fixture PNG');
    const html = readFileSync(join(dir,'.shakedown/trial-report.html'),'utf8');
    assert.match(html,/attempt 1/);
    assert.match(html,/&lt;button/);
    assert.ok(!html.includes('<button'));
    assert.equal(renderAccessibilityEvidence(undefined),'');
    evidence.screenshot = 'javascript:bad.png';
    assert.ok(!renderAccessibilityEvidence(evidence).includes('<svg'));
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
