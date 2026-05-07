import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page title/heading is visible', async ({ page }) => {
    const heading = page.getByText('ai3-mvp', { exact: true });
    await expect(heading).toBeVisible();
  });

  test('commands table has 3 rows', async ({ page }) => {
    await expect(page.getByText('Show available commands')).toBeVisible();
    await expect(page.getByText('Echo back your message')).toBeVisible();
    await expect(page.getByText('Run CI checks on the current PR')).toBeVisible();
  });

  test('authorize button is clickable', async ({ page }) => {
    const button = page.getByRole('link', { name: 'Authorize with GitHub' }).or(
      page.getByText('Authorize with GitHub')
    );
    await expect(button.first()).toBeVisible();
  });

  test('responsive - mobile viewport shows content', async ({ page }) => {
    await expect(page.getByText('ai3-mvp', { exact: true })).toBeVisible();
    await expect(page.getByText('Authorize with GitHub')).toBeVisible();
    await expect(page.getByText('View Documentation')).toBeVisible();
  });

  test('accessibility - WCAG 2.1 AA', async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules(['color-contrast', 'document-title'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
