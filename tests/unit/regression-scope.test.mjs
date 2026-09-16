import test from 'node:test';
import assert from 'node:assert/strict';
import { regressionOptions, compareEvidence } from '../../lib/regression-plan.mjs';
import { parseRegressionFlags, reviewGroups, observationVerdict } from '../../lib/regression-scope.mjs';
const config = { references: { production: 'https://prod.test' }, candidates: { local: 'https://local.test' } };
const options = (raw = {}, flags = {}) => regressionOptions({ ...config, ...raw }, 'https://local.test', flags);

test('scope defaults remain compatible and flags override saved selections without changing them', () => {
  assert.equal(options().level, 'full');
  assert.deepEqual(options().viewports.map(v => v.name), ['desktop', 'tablet', 'mobile']);
  const raw = { defaultLevel: 'core', defaultViewports: ['desktop'], viewports: [{ name: 'desktop', width: 1440, height: 900 }] };
  assert.equal(options(raw).level, 'core');
  assert.equal(options(raw).viewports[0].width, 1440);
  const selected = options(raw, { level: 'errors', viewports: 'tablet,mobile' });
  assert.equal(selected.level, 'errors');
  assert.deepEqual(selected.viewports.map(v => v.name), ['tablet', 'mobile']);
  assert.deepEqual(raw.defaultViewports, ['desktop']);
  assert.equal(raw.defaultLevel, 'core');
});

test('invalid scopes and viewport selections fail rather than silently narrowing coverage', () => {
  for (const flags of [{level:'severe'}, {viewports:'phone'}, {viewports:'desktop,desktop'}, {viewports:''}, {viewports:'desktop,'}]) assert.throws(() => options({}, flags));
  for (const raw of [{defaultLevel:'bad'}, {defaultViewports:[]}, {defaultViewports:['bad']}, {defaultViewports:'desktop'}]) assert.throws(() => options(raw));
  assert.deepEqual(parseRegressionFlags(['--level', 'errors', '--viewports=desktop,tablet']), {level:'errors',viewports:'desktop,tablet'});
  for (const args of [['--level'], ['--level='], ['--level','--viewports=desktop'], ['--level=core','--level=full'], ['--project=desktop']]) assert.throws(() => parseRegressionFlags(args));
});

test('core differences are review evidence; full adds content and errors does not compare', () => {
  const before = {title:'Before',forms:[],images:[],emptyLinks:[]};
  const after = {title:'After',forms:[{}],images:[{}],emptyLinks:[{}]};
  assert.deepEqual(compareEvidence(before, after, '/', [], 'errors'), []);
  assert.deepEqual(compareEvidence(before, after, '/', ['forms on /'], 'core').map(d => [d.key,d.suppressed]), [['forms',true],['emptyLinks',false]]);
  assert.equal(compareEvidence(before, after, '/').length, 4);
  assert.deepEqual(reviewGroups({health:['JS exception'],candidate:{},differences:[],classification:'candidate-checked'}),['errors']);
  assert.deepEqual(reviewGroups({health:['axe finding'],candidate:{accessibility:{findings:[{message:'axe finding',blocking:true}]}},differences:[{key:'title',suppressed:false}],classification:'matched'}),['accessibility','other']);
});

test('page verdict never treats incomplete or advisory evidence as a clean pass', () => {
  const clean = {health:[],differences:[],classification:'candidate-checked',candidate:{blocked:['GET https://embed.example/']}};
  assert.equal(observationVerdict(clean).kind,'passed');
  assert.equal(observationVerdict({...clean,health:['missing <title>']}).kind,'failed');
  assert.equal(observationVerdict({...clean,classification:'inconclusive'}).kind,'incomplete');
  assert.equal(observationVerdict({...clean,candidate:{error:'timeout'}}).kind,'incomplete');
  assert.equal(observationVerdict({...clean,differences:[{key:'title',suppressed:false}]}).kind,'review');
  assert.equal(observationVerdict({...clean,candidate:{advisory:['capture limit reached']}}).kind,'review');
  assert.equal(observationVerdict({...clean,differences:[{key:'title',suppressed:true}]}).kind,'passed');
});
