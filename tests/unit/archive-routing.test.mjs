import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('archive discovery respects filtered rules, preserves plain URLs and never writes rewrite options', () => {
 const file = fileURLToPath(new URL('../../bin/archive-routing.php', import.meta.url));
 const script = `<?php
require ${JSON.stringify(file)};
function home_url($path) {return 'https://example.test/site/';}
function get_option($name) {return [];}
function update_option() {throw new Exception('Unexpected database write');}
class FakeRewrite {
 public $matches = '';
 public $plain = false;
 public $rules = [];
 public function using_permalinks() {return !$this->plain;}
 public function rewrite_rules() {return $this->rules;}
}
$wp_rewrite = new FakeRewrite();
$author = ['url'=>'https://example.test/site/writers/alice/', 'kind'=>'author', 'expect'=>200];
$date = ['url'=>'https://example.test/site/2026/09/', 'kind'=>'date:month', 'expect'=>200];
$rules = [
 '(.?.+?)/?$' => 'index.php?pagename=$matches[1]',
 'writers/([^/]+)/?$' => 'index.php?author_name=$matches[1]',
 '([0-9]{4})/([0-9]{2})/?$' => 'index.php?year=$matches[1]&monthnum=$matches[2]',
];
$wp_rewrite->rules=$rules;
$enabled=shakedown_filter_archive_routes([$author,$date]);
$wp_rewrite->rules=['(.?.+?)/?$'=>'index.php?pagename=$matches[1]'];
$disabled=shakedown_filter_archive_routes([$author,$date]);
$wp_rewrite->plain=true;
$plain=shakedown_filter_archive_routes([$author,$date]);
echo json_encode([
 'enabled'=>$enabled,'disabled'=>$disabled,'plain'=>$plain,
 'query'=>shakedown_archive_is_routed('https://example.test/site/?author=1','author',[],'https://example.test/site/'),
 'datedSingle'=>shakedown_archive_is_routed($date['url'],'date',['([0-9]{4})/(.+)/?$'=>'index.php?year=$matches[1]&name=$matches[2]'],'https://example.test/site/'),
 'unrelated'=>shakedown_archive_is_routed($author['url'],'author',['people/(.+)/?$'=>'index.php?author_name=$matches[1]'],'https://example.test/site/'),
 'originalMatches'=>$wp_rewrite->matches,
]);
`;
 const result=JSON.parse(execFileSync('php',[],{input:script,encoding:'utf8'}));
 assert.equal(result.enabled.routes.length,2);
 assert.equal(result.enabled.warnings.length,1);
 assert.equal(result.disabled.routes.length,0);
 assert.equal(result.disabled.excluded.length,2);
 assert.match(result.disabled.excluded[0].reason,/No matching author/);
 assert.equal(result.plain.routes.length,2);
 assert.equal(result.plain.warnings.length,0);
 assert.equal(result.query,true);
 assert.equal(result.datedSingle,false);
 assert.equal(result.unrelated,false);
 assert.equal(result.originalMatches,'');
});
