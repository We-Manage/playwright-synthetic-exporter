// Browser check with Web Vitals: every top-level test.step becomes a step in
// the metrics (synthetic_pw_step_duration_seconds, synthetic_pw_step_success).
import { test, expect } from 'playwright-synthetic-exporter';

test('playwright.dev get started', async ({ page }) => {
  await test.step('home', async () => {
    const response = await page.goto('https://playwright.dev/');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(/Playwright/);
  });

  await test.step('get started', async () => {
    await page.getByRole('link', { name: 'Get started' }).first().click();
    await expect(page.getByRole('heading', { name: 'Installation', level: 1 })).toBeVisible();
  });
});
