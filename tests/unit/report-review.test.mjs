import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusRoutes, regressionOptions } from '../../lib/regression-plan.mjs';
import { parseRegressionFlags } from '../../lib/regression-scope.mjs';
import { groupedChanges, acceptanceHelp, markdownReport } from '../../lib/report-review.mjs';
import { observationVerdict } from '../../lib/regression-scope.mjs';
test('pixel-only changes and unavailable diff evidence stay visible for review', () => {
  const result={health:[],differences:[],classification:'matched',reference:{},candidate:{}};
  assert.equal(observationVerdict({...result,visual:{percent:2}}).kind,'review');
  assert.equal(observationVerdict({...result,visual:{unavailable:'size limit'}}).kind,'review');
  assert.equal(observationVerdict({...result,visual:{percent:0}}).kind,'passed');
});
test('focused selection includes inventoried routes but refuses unknown or unsafe paths', () => {
  const options = regressionOptions({references:{production:'https://prod.test'},candidates:{local:'https://local.test'}}, 'https://local.test', parseRegressionFlags(['--routes=/hsma/']));
  const plan = { options, routes: [{path:'/'}] };
  focusRoutes(plan, {eligible:[{path:'/hsma/',kind:'term:training'}]});
  assert.equal(plan.routes[0].path, '/hsma/');
  assert.equal(plan.focusExcluded.length, 1);
  assert.throws(() => focusRoutes({options, routes:[]}, {eligible:[]}), /not discovered/);
  assert.throws(() => regressionOptions({references:{production:'https://prod.test'},candidates:{local:'https://local.test'}}, 'https://local.test', {routes:'/wp-admin/'}), /unsafe/i);
});
test('grouping recognises punctuation without merging different titles or accepted state', () => {
  const result = (path,a,b,suppressed=false) => ({path,viewport:'desktop',health:[],differences:[{key:'title',reference:a,candidate:b,suppressed}]});
  const run={results:[result('/a','A - Site','A – Site'),result('/b','B - Site','B – Site'),result('/c','C','D'),result('/d','D - Site','D – Site',true)]};
  assert.equal(groupedChanges(run).length,1);
  assert.equal(groupedChanges(run)[0].members.length,2);
  assert.match(acceptanceHelp({signature:'forms on /x/'}), /substring/);
  assert.equal(acceptanceHelp({signature:'forms on /x/',suppressed:true}), '');
  const md=markdownReport(run,{routes:4,healthFailures:0,differences:4,limitations:0},{mode:'sampled',state:'unavailable',selectedRoutes:4,notVisited:[]});
  assert.match(md,/unknown discovered routes omitted/);
});
