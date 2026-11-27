import { expect, test } from '@playwright/test';

test('settings and storage are usable in Chromium', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Space used on this device')).toBeVisible();
  expect(errors).toEqual([]);
});
