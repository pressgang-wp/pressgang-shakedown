import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {semanticEvidence} from '../../lib/regression-browser.mjs';
import {compareEvidence} from '../../lib/regression-plan.mjs';

test('real DOM captures main scope and retains link geometry without reporting movement as an empty-link change',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage();
  await page.setContent('<div><h2>Heading</h2><a href="">2</a></div>');
  const reference=await semanticEvidence(page);
  await page.setContent('<main style="padding-top:100px"><h2>Heading</h2><a href="">2</a></main>');
  const candidate=await semanticEvidence(page);
  assert.equal(reference.structureScope.count,0);
  assert.equal(candidate.structureScope.count,1);
  assert.notEqual(reference.emptyLinks[0].y,candidate.emptyLinks[0].y);
  const differences=compareEvidence(reference,candidate,'/');
  assert.ok(!differences.some(d=>d.key==='emptyLinks'));
  assert.equal(differences.find(d=>d.key==='structure').comparison,'unavailable');
  await page.setContent('<main><h2>Heading</h2><section>New section</section><a href="">2</a></main>');
  const changed=await semanticEvidence(page);
  assert.equal(compareEvidence(candidate,changed,'/').find(d=>d.key==='structure').comparison,undefined);
  const ignored=await semanticEvidence(page,['main']);
  assert.equal(ignored.structureScope.count,0);
  assert.deepEqual(ignored.structure,[]);
 }finally{await browser.close();}
});
