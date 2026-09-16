import test from 'node:test';
import assert from 'node:assert/strict';
import {compareEvidence} from '../../lib/regression-plan.mjs';
import {reportSummary,writeRegressionReport} from '../../lib/regression-report.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('empty-link geometry is retained but never establishes a semantic difference', () => {
 const reference={emptyLinks:[{text:'2',x:1,y:200,width:40,height:40}]};
 const candidate={emptyLinks:[{text:'2',x:9,y:400,width:0,height:0}]};
 const before=JSON.stringify([reference,candidate]);
 assert.deepEqual(compareEvidence(reference,candidate,'/'),[]);
 candidate.emptyLinks.push({text:'Newsletter',x:4,y:500,width:80,height:40});
 const [diff]=compareEvidence(reference,candidate,'/');
 assert.equal(diff.key,'emptyLinks');
 assert.deepEqual(diff.reference,reference.emptyLinks);
 assert.equal(diff.candidate[1].y,500);
 candidate.emptyLinks.pop();
 assert.equal(JSON.stringify([reference,candidate]),before);
 candidate.emptyLinks[0].text='3';
 assert.equal(compareEvidence(reference,candidate,'/')[0].key,'emptyLinks');
});

test('structural differences require one known main region on both sides', () => {
 const reference={structure:[],structureScope:{selector:'main',count:1}};
 const candidate={structure:[{tag:'h2',children:0}],structureScope:{selector:'main',count:1}};
 assert.equal(compareEvidence(reference,candidate,'/')[0].comparison,undefined);
 for(const count of [0,2,null]){
  const [diff]=compareEvidence({...reference,structureScope:{selector:'main',count}},candidate,'/');
  assert.equal(diff.comparison,'unavailable');
  assert.deepEqual(diff.candidate,candidate.structure);
 }
 const legacy=compareEvidence({structure:[],landmarks:[]},{structure:candidate.structure,landmarks:[{tag:'main'}]},'/');
 assert.equal(legacy.find(d=>d.key==='structure').comparison,'unavailable');
 assert.equal(legacy.find(d=>d.key==='structure').referenceScope.inferred,true);
 const unknown=compareEvidence({structure:[]},{structure:[]},'/');
 assert.equal(unknown[0].comparison,'unavailable');
 assert.deepEqual(compareEvidence(reference,candidate,'/',[],'core'),[]);
});

test('image sizing and title changes survive; limitations are rendered and counted separately', () => {
 const reference={structure:[],landmarks:[],title:'Before',images:[{width:284,height:213}]};
 const candidate={structure:[{tag:'h2'}],landmarks:[{tag:'main'}],title:'After',images:[{width:284,height:540}]};
 const differences=compareEvidence(reference,candidate,'/');
 assert.ok(differences.some(d=>d.key==='images'));
 assert.ok(differences.some(d=>d.key==='title'));
 const run={state:'complete',results:[{path:'/',viewport:'desktop',classification:'matched',health:[],reference,candidate,differences}]};
 assert.equal(reportSummary(run).limitations,1);
 assert.equal(reportSummary(run).differences,3);
 const dir=mkdtempSync(join(tmpdir(),'comparison-report-'));
 try {
  writeRegressionReport(dir,run);
  assert.match(readFileSync(join(dir,'index.html'),'utf8'),/Structural comparison unavailable/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
