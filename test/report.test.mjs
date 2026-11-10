import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, parseReport, seconds } from '../src/report.mjs';

test('durations', () => {
  assert.equal(seconds('90s'), 90);
  assert.equal(seconds('5m'), 300);
  assert.equal(seconds('1h'), 3600);
  assert.equal(seconds('500ms'), 0.5);
  assert.equal(seconds(30), 30);
  assert.throws(() => seconds('5 minutes'));
});

test('environment expansion', () => {
  process.env.PSE_TEST_TOKEN = 'secret';
  assert.equal(expand('Bearer ${PSE_TEST_TOKEN}'), 'Bearer secret');
  assert.equal(expand('${PSE_TEST_UNSET:-fallback}'), 'fallback');
  assert.throws(() => expand('${PSE_TEST_UNSET}'), /PSE_TEST_UNSET/);
});

const vitals = Buffer.from(JSON.stringify({ '/': { lcp: 1200, cls: 0.02 } })).toString('base64');
const report = (status, extra = {}) =>
  JSON.stringify({
    suites: [{
      specs: [{
        tests: [{
          results: [{
            status,
            duration: 1500,
            steps: [
              { title: 'Before Hooks', duration: 10 },
              { title: 'open', duration: 800 },
              { title: 'submit', duration: 600, ...(status === 'passed' ? {} : { error: { message: 'x' } }) },
              { title: 'After Hooks', duration: 5 },
            ],
            attachments: [{ name: 'web-vitals', contentType: 'application/json', body: vitals }],
            errors: status === 'passed' ? [] : [{ message: '\u001b[31mError: expect(locator).toBeVisible()\u001b[39m\n\nLocator: #missing\nExpected: visible\nReceived: hidden' }],
            ...extra,
          }],
        }],
      }],
    }],
  });

test('passed run', () => {
  const r = parseReport(report('passed'));
  assert.equal(r.ok, true);
  assert.equal(r.duration, 1.5);
  assert.deepEqual(r.steps, [
    { title: 'open', duration: 0.8, ok: true },
    { title: 'submit', duration: 0.6, ok: true },
  ]);
  assert.deepEqual(r.vitals, { '/': { lcp: 1200, cls: 0.02 } });
});

test('failed run keeps the first error lines without colour codes', () => {
  const r = parseReport(report('failed'));
  assert.equal(r.ok, false);
  assert.equal(r.steps[1].ok, false);
  assert.equal(r.error, 'Error: expect(locator).toBeVisible() | Locator: #missing | Expected: visible');
});

test('spec without tests is a failure', () => {
  const r = parseReport(JSON.stringify({ suites: [], errors: [{ message: 'SyntaxError: bad spec' }] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /SyntaxError/);
});
