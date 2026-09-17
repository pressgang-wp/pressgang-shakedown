import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Advisory pixel evidence only: never a baseline or a correctness gate. */
export async function compareScreenshots(browser, dir, reference, candidate, output) {
  if (!reference || !candidate) return { unavailable: 'One or both screenshots were not captured.' };
  let page;
  try {
    const sources = [reference, candidate].map(file => 'data:image/png;base64,' + readFileSync(join(dir, file)).toString('base64'));
    page = await browser.newPage();
    const result = await page.evaluate(async sources => {
      const images = await Promise.all(sources.map(src => new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Cannot decode screenshot')); img.src = src;
      })));
      const dimensions = images.map(i => ({ width: i.width, height: i.height }));
      const width = Math.max(...images.map(i => i.width)), height = Math.max(...images.map(i => i.height));
      if (width * height > 16000000) return { dimensions, unavailable: 'Diff exceeds the 16 million pixel capture limit.' };
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      const data = images.map(img => { ctx.clearRect(0, 0, width, height); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, width, height).data; });
      const diff = ctx.createImageData(width, height); let changed = 0;
      for (let p = 0; p < width * height; p++) {
        const i = p * 4, x = p % width, y = Math.floor(p / width);
        const outside = images.some(img => x >= img.width || y >= img.height);
        const different = outside || [0, 1, 2, 3].some(c => Math.abs(data[0][i + c] - data[1][i + c]) > 16);
        if (different) changed++;
        diff.data.set(different ? [220, 0, 80, 255] : [235, 235, 235, 255], i);
      }
      ctx.putImageData(diff, 0, 0);
      return { dimensions, changedPixels: changed, totalPixels: width * height, percent: changed / (width * height) * 100, png: canvas.toDataURL('image/png').split(',')[1] };
    }, sources);
    if (result.png) { writeFileSync(join(dir, output), Buffer.from(result.png, 'base64')); delete result.png; result.screenshot = output; }
    return result;
  } catch (error) { return { unavailable: error.message.split('\n')[0] }; }
  finally { await page?.close().catch(() => {}); }
}
