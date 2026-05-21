/**
 * Parables — browse the drawer, open one in the reader, ask jAIsus about it.
 *
 * Two surfaces involved:
 *
 *   - ParablesDrawer.tsx  → bottom-sheet index of all parables. Title "Explore
 *     Parables". Each row is a <button aria-label="Open ${title} in reading
 *     mode">.
 *
 *   - ParableReader.tsx   → full-screen reading mode for one parable. Renders
 *     a <h1> with the parable title, and an "Ask jAIsus about this parable"
 *     button that fires `onAskAbout(parable.suggestPrompt)` and closes both
 *     surfaces.
 *
 * The drawer entry point lives in `ActionButtons.tsx` → button "Explore
 * Parables" — which is only shown when autoSpeak is OFF. We flip the mode
 * first (same helper used in chat.spec.ts).
 */

import { test, expect, STUB_ASSISTANT_TEXT } from './fixtures';

async function flipToTextMode(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const autoSpeakRow = page
    .locator('div')
    .filter({ hasText: /^Auto-speak responses/ })
    .first();
  await autoSpeakRow.locator('button').last().click();
  await page.getByRole('button', { name: 'Done' }).click();
}

test.describe('Parables', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jaisus-onboarding-seen', '1');
      } catch {
        /* ignore */
      }
    });
  });

  test('tapping a parable opens the immersive reader', async ({ page }) => {
    await page.goto('/');
    await flipToTextMode(page);

    // Open the Parables drawer.
    await page.getByRole('button', { name: 'Explore Parables' }).click();

    // Drawer heading.
    await expect(
      page.getByRole('heading', { name: 'Explore Parables' })
    ).toBeVisible();

    // Pick a known parable — "The Good Samaritan" is the first entry in
    // `src/lib/parables.ts` and a recognisable title. We use the row's
    // aria-label which embeds the title.
    await page
      .getByRole('button', { name: /Open The Good Samaritan in reading mode/i })
      .click();

    // The reader renders an <h1> with the parable title. We assert by role +
    // name rather than by class — robust to styling changes.
    await expect(
      page.getByRole('heading', { level: 1, name: 'The Good Samaritan' })
    ).toBeVisible();

    // The "Ask jAIsus about this parable" CTA confirms we're really inside
    // the reader and that the parent passed `onAskAbout` (which means the
    // wire-up to chat is in place).
    await expect(
      page.getByRole('button', { name: 'Ask jAIsus about this parable' })
    ).toBeVisible();
  });

  test('asking about a parable closes both panels and posts a user message', async ({
    page,
  }) => {
    await page.goto('/');
    await flipToTextMode(page);

    // Open drawer → open a parable.
    await page.getByRole('button', { name: 'Explore Parables' }).click();
    await page
      .getByRole('button', { name: /Open The Good Samaritan in reading mode/i })
      .click();

    // Click the CTA — this dispatches the parable's `suggestPrompt` as a
    // chat message, closes the reader, and closes the drawer.
    await page
      .getByRole('button', { name: 'Ask jAIsus about this parable' })
      .click();

    // Both panels should be gone: the reader's <h1> with the parable title
    // disappears, and the drawer's "Explore Parables" heading does too.
    await expect(
      page.getByRole('heading', { level: 1, name: 'The Good Samaritan' })
    ).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'Explore Parables' })
    ).toBeHidden();

    // A user message bubble should appear in the chat. The exact text is
    // the parable's `suggestPrompt` from `src/lib/parables.ts` — we don't
    // hard-code it (it may evolve) but it always mentions "Good Samaritan".
    //
    // The user bubble is rendered by `ChatMessage.tsx` with role "user".
    // We assert with a substring case-insensitive match.
    await expect(page.getByText(/Good Samaritan/i).first()).toBeVisible();

    // And the stubbed assistant response should land.
    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();
  });
});
