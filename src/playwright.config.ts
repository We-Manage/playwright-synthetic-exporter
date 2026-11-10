// Playwright config for one check run. runner.mjs sets the environment per
// check, so every run sees exactly one spec file.
import { defineConfig, devices } from '@playwright/test';
import { basename, dirname, join } from 'node:path';

const spec = process.env.PSE_SPEC ?? '';

export default defineConfig({
  testDir: dirname(spec),
  testMatch: basename(spec),
  outputDir: process.env.PSE_OUTPUT_DIR ?? '/tmp/playwright-synthetic-exporter',
  // Maps the 'playwright-synthetic-exporter' import of the specs to fixtures.ts.
  tsconfig: join(__dirname, '..', 'tsconfig.json'),
  timeout: Number(process.env.PSE_TIMEOUT_MS ?? 60000),
  // A failed run is a result, not something to hide behind a retry.
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['json']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 768 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
