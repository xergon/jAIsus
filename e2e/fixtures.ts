/**
 * Shared Playwright fixtures + API mocking for the jAIsus test suite.
 *
 * Everything that talks to a paid / external service is intercepted here:
 *
 *   - POST /api/chat      → stub AI SDK v6 streaming response
 *   - POST /api/tts       → 500 (forces the in-browser SpeechSynthesis
 *                          fallback, which is silent in headless Chromium)
 *   - POST /api/vision    → stub scene-description JSON
 *   - POST /api/teachings → stub teaching text JSON
 *   - POST /api/summarize → stub one-sentence summary JSON
 *   - POST /api/remember  → stub "nothing learned" long-term memory JSON
 *   - GET  /api/daily     → stub verse + reflection JSON
 *
 * Tests should always import `test` and `expect` from this file (NOT from
 * `@playwright/test` directly) so that the mocks and the `clearStorage`
 * fixture run automatically before every test.
 *
 *   import { test, expect } from './fixtures';
 *
 * If you find yourself wanting more granular control inside a single test
 * (e.g. asserting on the chat request body, or returning a different stub),
 * use `page.route()` directly inside that test AFTER the fixture has set up
 * the defaults — your route handler takes priority for that one test.
 */

import { test as base, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────
// Stub bodies
// ─────────────────────────────────────────────────────────────────────

/**
 * Stub assistant message used by all chat-mock tests. Short, recognisable,
 * and assertable with a literal `getByText()`. Single sentence so the
 * streaming TTS chunker can finish it deterministically.
 */
export const STUB_ASSISTANT_TEXT = 'Peace be with you, friend.';

/**
 * Build a minimal AI SDK v6 event-stream body that the `useChat` hook will
 * accept. The protocol expects a sequence of `data: { ... }\n\n` lines and a
 * terminal `data: [DONE]\n\n`. The four events below are the smallest set
 * that produces a single text part:
 *
 *   start            → marks the beginning of the stream
 *   text-start       → opens a text block with id "0"
 *   text-delta       → appends `delta` to text block "0"
 *   finish           → marks the assistant message as complete
 *   [DONE]           → terminates the SSE stream
 *
 * Returned as a plain string — Playwright's `route.fulfill({ body })` will
 * serialize it without modification when paired with the right content-type.
 */
export function buildChatStreamBody(text: string = STUB_ASSISTANT_TEXT): string {
  const lines = [
    'data: {"type":"start"}',
    'data: {"type":"text-start","id":"0"}',
    `data: {"type":"text-delta","id":"0","delta":${JSON.stringify(text)}}`,
    'data: {"type":"finish"}',
    'data: [DONE]',
  ];
  // Each event MUST be terminated by a blank line — that's how SSE parsers
  // know a frame is complete. The trailing \n\n at the very end is harmless.
  return lines.map(l => l + '\n\n').join('');
}

// ─────────────────────────────────────────────────────────────────────
// The fixture
// ─────────────────────────────────────────────────────────────────────

/**
 * Our extended `test` adds two automatic behaviors:
 *
 *   1. `clearStorage` (auto): visits `about:blank` and wipes localStorage +
 *      sessionStorage before every test runs. Ensures onboarding shows, no
 *      stray favorites/messages bleed across tests, etc.
 *
 *   2. API mocks (auto): installs `page.route()` handlers for all the
 *      external endpoints listed at the top of this file BEFORE the test
 *      navigates. Individual tests can override by calling `page.route()`
 *      themselves — last-registered handler wins.
 *
 * Both fixtures use the `[fn, { auto: true }]` form so the user doesn't have
 * to opt in by listing them in their test signature.
 */
export const test = base.extend<{
  // Fixture names are exposed for type-system completeness, but since they
  // run with `auto: true` the test function signature usually omits them.
  clearStorage: void;
  mockApis: void;
}>({
  clearStorage: [
    // eslint-disable-next-line no-empty-pattern
    async ({ context }, use) => {
      // Clearing must happen on a same-origin page; `about:blank` has no
      // storage of its own but on the *next* navigation the browser starts
      // fresh. We also pre-emptively clear any cookies the dev server set
      // for the baseURL.
      await context.clearCookies();
      // Clear via init script — runs before any page script on every nav.
      // Wrapping in try/catch defends against SecurityError on file://-style
      // URLs (unlikely in our setup but cheap insurance).
      await context.addInitScript(() => {
        try {
          window.localStorage.clear();
          window.sessionStorage.clear();
        } catch {
          /* storage unavailable — nothing to clear */
        }
      });
      await use();
    },
    { auto: true },
  ],

  mockApis: [
    async ({ context }, use) => {
      // POST /api/chat ─ AI SDK v6 streamed response
      await context.route('**/api/chat', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          headers: {
            // text/event-stream is what the AI SDK v6 transport expects.
            // `x-vercel-ai-data-stream: v1` is added by some adapters; not
            // required, but harmless.
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache, no-transform',
            'x-vercel-ai-data-stream': 'v1',
          },
          body: buildChatStreamBody(STUB_ASSISTANT_TEXT),
        });
      });

      // POST /api/tts ─ deliberately 500 so the client falls back to the
      // browser's built-in SpeechSynthesis (which produces no audible audio
      // in headless Chromium but completes without error).
      await context.route('**/api/tts', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'tts mocked off in e2e' }),
        });
      });

      // POST /api/vision ─ stub scene description. Returned shape mirrors
      // what `useCamera.ts` expects to read back from the route.
      await context.route('**/api/vision', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            description: 'a person sitting at their desk',
          }),
        });
      });

      // POST /api/teachings ─ stub teaching text. TeachingPlayer.tsx reads
      // `{ teaching: string }` from the response body.
      await context.route('**/api/teachings', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            teaching:
              'Consider the lilies of the field. They neither toil nor spin, ' +
              'yet they are clothed in such beauty.',
          }),
        });
      });

      // POST /api/summarize ─ called when the user clears chat history. We
      // don't care what comes back; just don't 500.
      await context.route('**/api/summarize', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ summary: '' }),
        });
      });

      // POST /api/remember ─ long-term memory, called in the background as
      // replies finish and when the page is hidden. Nothing learned.
      await context.route('**/api/remember', async (route) => {
        if (route.request().method() !== 'POST') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true, name: null, add: [], update: [], remove: [], summary: '',
            forgetName: false, forgetConversations: [],
          }),
        });
      });

      // GET /api/daily ─ stub verse + reflection. Returned shape matches the
      // real route's response (verse object + reflection string + cached
      // flag). Used by the daily-content stack in the empty chat state.
      await context.route('**/api/daily', async (route) => {
        if (route.request().method() !== 'GET') {
          return route.fallback();
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            verse: {
              id: 'stub-verse',
              text: 'Be still, and know that I am with you.',
              reference: 'Psalm 46:10',
              theme: 'stillness',
            },
            reflection: 'Where in your day could you carve out a moment of stillness?',
            cached: false,
          }),
        });
      });

      // Any other /api/* request that we haven't mocked is allowed to fall
      // through to the dev server — fine for `/api/version`, etc.

      await use();
    },
    { auto: true },
  ],
});

export { expect };
