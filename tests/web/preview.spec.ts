import { expect, test } from '@playwright/test';

test('browser preview is honest, accessible and makes no private-content API request', async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (['fetch', 'xhr', 'websocket'].includes(request.resourceType())) requests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mobile build required' })).toBeVisible();
  await expect(page.getByLabel('New lecture name')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Create lecture/ })).toBeDisabled();
  await expect(page.getByText('No device library is open in this preview.', { exact: false })).toBeVisible();
  await expect(page.getByText('Saved on this phone.', { exact: false })).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/mobile-preview.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('heading', { name: 'Mobile build required' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/desktop-preview.png', fullPage: true });
});
