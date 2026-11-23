import { expect, test } from '@playwright/test';
import { checkMobile, snap } from './helpers';

test('see the month, pay a bill, add a bill, view the year', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every bill');
  await expect(page.locator('.hero .cal')).toBeVisible();
  await page.waitForTimeout(1000);
  await snap(page, 'landing');
  await checkMobile(page, 'landing-mobile');

  await page.getByRole('link', { name: 'Open this month' }).click();
  await page.getByLabel('Amount paid for Council tax').fill('132');
  await page.getByLabel('Amount paid for Council tax').locator('xpath=ancestor::li').getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByText('Council tax marked paid ($132.00).')).toBeVisible();
  await snap(page, 'calendar');
  await checkMobile(page);
  await page.reload();
  await expect(page.getByLabel('Amount paid for Council tax')).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Bills' }).click();
  await page.getByRole('link', { name: 'Add bill' }).click();
  await page.getByLabel('Bill name').fill('Music streaming');
  await page.getByLabel('Amount (USD)').fill('10.99');
  await page.getByLabel('Day of month').fill('31');
  await page.getByLabel('Paid automatically').check();
  await page.getByRole('button', { name: 'Save bill' }).click();
  await expect(page.getByRole('link', { name: 'Music streaming' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Music streaming/ })).toContainText('Monthly on the last day');
  await snap(page, 'bills');

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Year ahead' }).click();
  await expect(page.getByRole('heading', { name: 'Due per month' })).toBeVisible();
  await page.waitForTimeout(900);
  await snap(page, 'year');
  await checkMobile(page, 'year-mobile');
});
