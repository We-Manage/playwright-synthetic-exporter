// Must fail in its second step; the CI checks that the exporter reports it.
import { test, expect } from 'playwright-synthetic-exporter';

test('broken', async ({ page }) => {
  await test.step('open', async () => {
    await page.setContent('<h1>hello</h1>');
  });
  await test.step('find missing element', async () => {
    await expect(page.locator('#missing')).toBeVisible({ timeout: 1000 });
  });
});
