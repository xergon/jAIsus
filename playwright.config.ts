import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the jAIsus end-to-end test suite.
 *
 * Tests live in `./e2e` and run against a local Next.js dev server which
 * Playwright will boot automatically (`webServer.command = "npm run dev"`).
 *
 * One project only — Mobile Chrome (Pixel 5). jAIsus is a mobile-first app
 * and the layout, button sizes, and the voice-mode toggle behavior are tuned
 * for portrait phones. Desktop coverage isn't worth the extra wall-clock
 * time at this stage.
 *
 * All AI/voice endpoints are mocked in `e2e/fixtures.ts`, so the tests never
 * make real network calls to Claude, ElevenLabs, etc.
 */
export default defineConfig({
  testDir: './e2e',

  // Each individual test gets up to 30s. The default is 30s — set explicitly
  // so future readers see what we expect a slow streaming test to take.
  timeout: 30_000,

  // expect() assertions retry until satisfied or 5s elapses. Snappy enough
  // that broken UI surfaces fast; long enough that animation-gated checks
  // (drawer slide-in, fade-in) don't flake.
  expect: { timeout: 5_000 },

  // Run tests in parallel — Playwright spins multiple workers and each file
  // can also parallelise within itself if marked. We don't share state across
  // tests (each test gets a fresh page + cleared localStorage), so this is safe.
  fullyParallel: true,

  // Retry once in CI to absorb the occasional flake (cold dev server, hot
  // reload race). Locally, retries hide real bugs from you — leave at 0 so
  // failures jump out.
  retries: process.env.CI ? 1 : 0,

  // HTML report under `playwright-report/`. Open with
  // `npx playwright show-report` after a failing run.
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    // Capture a trace ONLY on the retry attempt — trace files are big and we
    // only need them when something flaked or actually failed.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      // The single supported target — mobile Chrome, Pixel 5 device emulation.
      // Includes touch + viewport + user agent. Matches the form factor most
      // jAIsus users actually run on.
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  // Boot the Next.js dev server before tests run. `reuseExistingServer` lets
  // you keep `npm run dev` open in another terminal during local iteration —
  // the test runner will just attach to that. In CI it always boots fresh.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
