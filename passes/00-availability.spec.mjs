import { test, expect } from '@playwright/test';
import { loadMatrix } from './matrix.mjs';
import { availabilityFindings } from '../lib/health.mjs';

const matrix = loadMatrix();
for (const route of matrix.routes) {
  test(`00 ${route.kind} ${route.url}`, async ({ request }) => {
    const res = await request.get(route.url, { maxRedirects: route.expect === 404 ? 0 : 5 });
    expect(availabilityFindings(route, { status: res.status(), headers: res.headers() }, await res.text(), matrix.ignore, matrix.target === 'sandbox'), `availability on ${route.url}`).toEqual([]);
  });
}
