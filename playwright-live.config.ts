import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'e2e-agent.spec.ts',
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  use: {
    baseURL: process.env.BASE_URL || 'https://jaisus.vercel.app',
    ...devices['Pixel 5'],
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: '/tmp/jaisus-test-results',
});
