// Fixtures for synthetic checks. Specs import test and expect from
// 'playwright-synthetic-exporter' (mapped here by tsconfig.json) instead of
// '@playwright/test'. The page fixture reports Web Vitals for every page it
// loads; specs that only use `request` never start a browser.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The package's exports map hides dist/, so read the bundle by path.
const webVitalsBundle = readFileSync(
  join(__dirname, '..', 'node_modules', 'web-vitals', 'dist', 'web-vitals.iife.js'),
  'utf8',
);

// Runs in every document before its own scripts. Values are reported with
// reportAllChanges, the last report per page and metric wins.
const initScript = `
(() => {
  if (window !== window.top) return;
  const send = (metric, value) => {
    try { window.__pseVital({ page: location.pathname, metric, value }); } catch (e) {}
  };
  ${webVitalsBundle}
  const opts = { reportAllChanges: true };
  webVitals.onLCP((m) => send('lcp', m.value), opts);
  webVitals.onFCP((m) => send('fcp', m.value), opts);
  webVitals.onTTFB((m) => send('ttfb', m.value), opts);
  webVitals.onCLS((m) => send('cls', m.value), opts);
  webVitals.onINP((m) => send('inp', m.value), opts);
  // Total blocking time as a lab stand-in for INP: long tasks beyond 50 ms.
  let tbt = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) tbt += Math.max(0, e.duration - 50);
      send('tbt', tbt);
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
})();
`;

type Vitals = Record<string, Record<string, number>>;

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const vitals: Vitals = {};
    await page.exposeBinding('__pseVital', (_source, m: { page: string; metric: string; value: number }) => {
      (vitals[m.page] ??= {})[m.metric] = m.value;
    });
    await page.addInitScript({ content: initScript });
    await use(page);
    if (Object.keys(vitals).length > 0) {
      await testInfo.attach('web-vitals', {
        body: JSON.stringify(vitals),
        contentType: 'application/json',
      });
    }
  },
});

export { expect };
