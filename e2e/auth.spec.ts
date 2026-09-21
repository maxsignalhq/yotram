import { test, expect } from '@playwright/test';
import { TEST_PASSWORD } from './testPassword';

test('shows a login page until the correct password is submitted, then remembers the session', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

  await page.getByPlaceholder('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('#error')).toHaveText('Incorrect password');

  await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Open current directory' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Open current directory' })).toBeVisible();
});
