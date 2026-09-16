import test from 'node:test';
import assert from 'node:assert/strict';
import { addCoverage, coverageSummary } from '../../lib/coverage.mjs';
import { regressionOptions } from '../../lib/regression-plan.mjs';
import { parseRegressionFlags } from '../../lib/regression-scope.mjs';

const options = { discovery: 'https://local.test', reference: 'https://production.test', candidate: 'https://local.test', viewports: [{ name: 'desktop' }, { name: 'mobile' }] };
const inventory = { routes: [
  { url: 'https://local.test/', kind: 'home' },
  { url: 'https://local.test/hsma/', kind: 'term:training-type' },
  { url: 'https://local.test/ignore/', kind: 'single:page' },
  { url: 'https://external.test/no/', kind: 'single:page' },
] };
test('coverage lists sampling gaps and expands finite content without inventing template oracles', () => {
  const plan = { options, ignore: { routes: ['/ignore/'] }, routes: [{ path: '/', expect: 200 }] };
  const sampled = addCoverage(plan, inventory);
  assert.deepEqual(sampled.notSelected, [{ path: '/hsma/', kind: 'term:training-type' }]);
  assert.equal(sampled.excluded.length, 2);
  const coverage = addCoverage(plan, inventory, 'exhaustive');
  assert.equal(plan.routes.length, 2);
  assert.equal(coverage.notSelected.length, 0);
  assert.equal(plan.routes[1].candidateUrl, 'https://local.test/hsma/');
  assert.equal(plan.routes[1].oracle, undefined);
  const summary = coverageSummary({ coverage, plan, state: 'incomplete', results: [{ path: '/', viewport: 'desktop' }] });
  assert.equal(summary.notVisited.length, 3);
  assert.equal(summary.notVisited[0].reason, 'Not visited');
  // A later navigation supplement closes an earlier sampling gap.
  assert.equal(coverageSummary({ coverage: sampled, plan, results: [] }).notSelected.length, 0);
});
test('coverage options are validated and CLI overrides configuration', () => {
  const raw = { references: { production: options.reference }, candidates: { local: options.candidate }, coverage: 'sampled' };
  assert.equal(regressionOptions(raw, options.discovery, parseRegressionFlags(['--coverage=exhaustive'])).coverage, 'exhaustive');
  assert.throws(() => regressionOptions({ ...raw, coverage: 'everything' }, options.discovery), /coverage/);
  assert.throws(() => regressionOptions(raw, options.discovery, { coverage: 'everything' }), /Coverage/);
});

test('inventory includes empty landing-page terms and pages beyond the first query batch', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('../../bin/route-inventory.php', import.meta.url));
  const php = `<?php
function is_wp_error($v) { return false; }
function get_post_types($args, $format) { return [(object)['name'=>'page']]; }
function is_post_type_viewable($type) { return true; }
function get_posts($args) { return $args['offset']===0 ? range(1,500) : ($args['offset']===500 ? [501] : []); }
function get_permalink($post) { return 'https://local.test/page-'.$post.'/'; }
function get_taxonomies($args, $format) { return [(object)['name'=>'training-type'],(object)['name'=>'private']]; }
function is_taxonomy_viewable($tax) { return $tax->name !== 'private'; }
function get_terms($args) { if($args['hide_empty']) throw new Exception('Empty landing pages would be lost'); return [(object)['slug'=>'hsma','count'=>0]]; }
function get_term_link($term) { return 'https://local.test/training-type/'.$term->slug.'/'; }
function update_option() { throw new Exception('Unexpected database write'); }
require ${JSON.stringify(file)};
`;
  const result = JSON.parse(execFileSync('php', [], { input: php, encoding: 'utf8' }));
  assert.equal(result.routes.length, 502);
  assert.ok(result.routes.some(r => r.url.endsWith('/hsma/')));
  assert.ok(result.routes.some(r => r.url.endsWith('/page-501/')));
  assert.equal(result.excluded[0].family, 'term:private');
});
