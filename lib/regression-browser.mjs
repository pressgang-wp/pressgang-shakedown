/** Anonymous GET-only transport. No journeys, clicks, form submissions or persistent context. */
import { safeURL } from './regression-plan.mjs';
import { request } from '@playwright/test';

const redirect = status => [301, 302, 303, 307, 308].includes(status);
export async function getEvidence(request, url, { timeout = 20000, maxRedirects = 5 } = {}) {
  const expectedOrigin = new URL(url).origin;
  const redirects = [];
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    if (!safeURL(current) || new URL(current).origin !== expectedOrigin) throw new Error(`Blocked unsafe or cross-origin navigation: ${current}`);
    const res = await request.get(current, { maxRedirects: 0, timeout, headers: { cookie: '', authorization: '' } });
    const status = res.status(), headers = res.headers();
    const body = await res.text();
    await res.dispose();
    const finalPath = new URL(current).pathname + new URL(current).search;
    if (!redirect(status) || maxRedirects === 0) return { status, headers, body, finalPath, finalUrl: current, redirects };
    if (!headers.location) throw new Error(`Redirect without Location: ${current}`);
    const next = new URL(headers.location, current);
    redirects.push({ status, from: finalPath, to: next.origin === expectedOrigin ? next.pathname + next.search : next.href });
    current = next.href;
  }
  throw new Error('Redirect limit exceeded');
}

export async function protectContext(context, selectedOrigin, blocked, timeout) {
  // route.fetch shares the browser cookie jar. A separate API context prevents
  // Set-Cookie from creating a browser session even before response fulfilment.
  const transport = await request.newContext({ ignoreHTTPSErrors: new URL(selectedOrigin).hostname.endsWith('.test') });
  context.once('close', () => { transport.dispose().catch(() => {}); });
  await context.routeWebSocket('**/*', socket => { blocked.push(`WebSocket ${socket.url()}`); socket.close(); });
  await context.route('**/*', async route => {
    const req = route.request();
    const url = req.url();
    const navigation = req.isNavigationRequest();
    if (req.method() !== 'GET' || !safeURL(url) || (navigation && new URL(url).origin !== selectedOrigin)) {
      blocked.push(`${req.method()} ${url}`);
      return route.abort('blockedbyclient');
    }
    // Fetch redirects ourselves: neither cookies nor a redirect can bypass the guard.
    try {
      let current = url;
      for (let i = 0; i <= 5; i++) {
        if (!safeURL(current) || (navigation && new URL(current).origin !== selectedOrigin)) throw new Error('unsafe redirect');
        const headers = { ...req.headers(), cookie: '', authorization: '' };
        const res = await transport.get(current, { headers, maxRedirects: 0, timeout });
        const responseHeaders = { ...res.headers() };
        delete responseHeaders['set-cookie'];
        if (redirect(res.status())) {
          if (!responseHeaders.location) throw new Error('redirect without location');
          current = new URL(responseHeaders.location, current).href;
          await res.dispose();
          continue;
        }
        // We preserve document URL by pre-resolving top-level redirects before goto.
        await route.fulfill({ response: res, headers: responseHeaders });
        await res.dispose();
        return;
      }
      throw new Error('redirect limit');
    } catch (error) {
      blocked.push(`transport ${url}: ${error.message}`);
      // fulfilment marks a route handled before its promise settles. Context
      // teardown can reject that promise (or response disposal) afterwards;
      // aborting it again must not escape this asynchronous handler and kill
      // the runner. The original transport failure remains disclosed above.
      await route.abort('failed').catch(() => {});
    }
  });
}

/** Visit the viewport-sized slices before capturing a full page. Bounded so an
 * infinite-scroll feed cannot turn a route capture into an unbounded crawl.
 * Never click or submit anything; requests still pass through protectContext.
 */
export async function settlePage(page, { maxScrollSteps = 40, stepDelay = 60, imageTimeout = 2000 } = {}) {
  let steps = 0;
  let reachedBottom = false;
  while (steps < maxScrollSteps) {
    const position = await page.evaluate(() => ({
      y: scrollY, height: innerHeight, bottom: document.documentElement.scrollHeight,
    }));
    if (position.y + position.height >= position.bottom - 1) {
      reachedBottom = true;
      break;
    }
    await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), position.y + Math.max(100, Math.floor(position.height * 0.8)));
    await page.waitForTimeout(stepDelay);
    steps++;
  }
  if (!reachedBottom) reachedBottom = await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 1);
  await page.waitForFunction(() => [...document.images].every(img =>
    img.getBoundingClientRect().width === 0 || img.complete
  ), undefined, { timeout: imageTimeout }).catch(error => {
    if (error.name !== 'TimeoutError') throw error;
  });
  const pendingImages = await page.evaluate(() => [...document.images]
    .filter(img => img.getBoundingClientRect().width > 0 && !img.complete)
    .map(img => img.currentSrc || img.src));
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(stepDelay);
  return { steps, reachedBottom, pendingImages };
}

/** Captured values are evidence, not assertions about theme-specific classes or ACF fields. */
export async function semanticEvidence(page, ignoreSelectors = [], level = 'full') {
  return page.evaluate(({ selectors, level }) => {
    const ignored = element => selectors.some(selector => element.matches(selector) || element.closest(selector));
    const all = selector => [...document.querySelectorAll(selector)].filter(el => !ignored(el));
    const text = el => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const url = value => {
      try { const u = new URL(value, location.href); return u.origin === location.origin ? u.pathname + u.search + u.hash : u.href; } catch { return value; }
    };
    const rect = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), width: Math.round(r.width), height: Math.round(r.height) }; };
    const core = {
      forms: all('form').map(el => ({ action: url(el.action), method: el.method, fields: [...el.querySelectorAll('input,select,textarea,button')].filter(f => f.type !== 'hidden').map(f => ({ tag: f.tagName.toLowerCase(), type: f.type, name: f.name, required: f.required, options: f.tagName === 'SELECT' ? [...f.options].map(o => text(o)) : undefined })) })),
      emptyLinks: all('a[href]').filter(el => !el.getAttribute('href').trim()).map(el => ({ text: text(el), ...(level === 'full' ? rect(el) : {}) })),
      navigation: [...new Set(all('nav a[href],header a[href],footer a[href],[role="navigation"] a[href]').map(el => el.href))],
    };
    if (level === 'core') return core;
    return {
      ...core,
      title: document.title.replace(/\s+/g, ' ').trim(),
      h1: all('h1').map(text),
      landmarks: all('main,nav,header,footer,aside,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"]').map(el => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), ...rect(el) })),
      emptyHeadings: all('h1,h2,h3,h4,h5,h6').filter(el => !text(el) && !el.getAttribute('aria-label') && !el.querySelector('img[alt],svg,title')).map(el => ({ tag: el.tagName.toLowerCase(), ...rect(el) })),
      images: all('img').map(el => ({ src: url(el.currentSrc || el.src), alt: el.alt, naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, objectFit: getComputedStyle(el).objectFit, ...rect(el) })),
      structure: all('main h2,main h3,main article,main section,main ul,main ol,main form,main table').map(el => ({ tag: el.tagName.toLowerCase(), children: el.children.length })),
    };
  }, { selectors: ignoreSelectors, level });
}
