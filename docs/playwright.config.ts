import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [['html', { outputFolder: './playwright-report' }]],
  use: {
    baseURL: 'http://localhost:4321',
  },
  webServer: {
    command: 'npm run preview',
    port: 4321,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
