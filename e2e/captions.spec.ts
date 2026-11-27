import { expect, test } from '@playwright/test';

test('typed captions survive the switch from columns to subtitles', async ({ page }) => {
  await page.route('**/api/mt', async route => {
    const { text, lang } = route.request().postDataJSON();
    await route.fulfill({ json: { translation: `${lang}: ${text}`, provider: 'gtx', ms: 1 } });
  });
  await page.goto('/?langs=es,pt');
  await page.getByRole('combobox').selectOption('gtx');
  await page.getByRole('button', { name: 'Test Input' }).click();
  await page.getByPlaceholder('Type an English classroom sentence to test translation silently…').fill('A classroom example');
  await page.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('es: A classroom example')).toBeVisible();
  await expect(page.getByText('pt: A classroom example')).toBeVisible();
  await page.getByRole('button', { name: 'Subtitle', exact: true }).click();
  await expect(page.getByLabel('Bottom Subtitle Bar')).toContainText('es: A classroom example');
});
