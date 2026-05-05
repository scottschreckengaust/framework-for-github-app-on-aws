import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readdirSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const DIST_DIR = resolve(__dir, '..', 'dist');

function getAllPages(dir: string, base: string): string[] {
  const pages: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      pages.push(...getAllPages(full, `${base}/${entry}`));
    } else if (entry === 'index.html') {
      pages.push(`${base}/` || '/');
    }
  }
  return pages;
}

let pages: string[] = [];
try {
  pages = getAllPages(DIST_DIR, '');
} catch {
  pages = ['/'];
}

for (const pagePath of pages) {
  test(`${pagePath} meets WCAG 2.1 AA`, async ({ page }) => {
    await page.goto(pagePath);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
