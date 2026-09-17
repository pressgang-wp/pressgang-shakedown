import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { compareScreenshots } from '../../lib/screenshot-diff.mjs';
test('pixel guidance detects colour and extra area without establishing a regression verdict', async () => {
  const dir=mkdtempSync(join(tmpdir(),'visual-diff-')), browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:200,height:200}});
    await page.setContent('<style>body{margin:0;background:red}</style>');
    await page.screenshot({path:join(dir,'a.png')});
    const identical=await compareScreenshots(browser,dir,'a.png','a.png','same.png');
    assert.equal(identical.changed,false,JSON.stringify(identical));
    await page.setViewportSize({width:200,height:300});
    await page.screenshot({path:join(dir,'b.png')});
    const changed=await compareScreenshots(browser,dir,'a.png','b.png','diff.png');
    assert.equal(changed.changed,true,JSON.stringify(changed));
    assert.ok(existsSync(join(dir,changed.report)));
    assert.ok(existsSync(join(dir,'diff.png')));
    assert.match((await compareScreenshots(browser,dir,null,'b.png','none.png')).unavailable,/not captured/);
  } finally {await browser.close();rmSync(dir,{recursive:true,force:true});}
});
