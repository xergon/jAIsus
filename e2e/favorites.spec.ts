/**
 * Favorites — heart-tap saves; the Saved panel lists them; remove empties.
 *
 * Source of truth:
 *   - FavoriteButton.tsx (heart icon, aria-label="Save to favorites" /
 *     "Remove from favorites", aria-pressed)
 *   - FavoritesPanel.tsx (drawer titled "Saved (N)", empty state title
 *     "No favorites yet")
 *   - favorites.ts (storage key 'jaisus-favorites')
 *
 * Strategy: skip onboarding, flip the UI into text-mode (chat-list mode) so
 * messages render as bubbles with a header containing the heart button, send
 * a question, wait for the streamed assistant response, click the heart,
 * open the Saved panel, and assert the saved row appears. Then remove it
 * and assert the empty state copy.
 */

import { test, expect, STUB_ASSISTANT_TEXT } from './fixtures';

async function flipToTextMode(page: import('@playwright/test').Page) {
  // Open Settings → toggle auto-speak off → Done.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const autoSpeakRow = page
    .locator('div')
    .filter({ hasText: /^Auto-speak responses/ })
    .first();
  await autoSpeakRow.locator('button').last().click();
  await page.getByRole('button', { name: 'Done' }).click();
}

test.describe('Favorites', () => {
  test.beforeEach(async ({ context }) => {
    // Pre-seed onboarding flag so the modal doesn't block taps.
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jaisus-onboarding-seen', '1');
      } catch {
        /* ignore */
      }
    });
  });

  test('clicking the heart saves the message; reopening the panel shows it', async ({
    page,
  }) => {
    await page.goto('/');
    await flipToTextMode(page);

    // Send a question.
    const input = page.getByPlaceholder('Type your question...');
    await input.fill('Tell me something kind');
    await input.press('Enter');

    // Wait for the stubbed assistant text to land in a bubble.
    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();

    // ChatMessage renders the heart inside the assistant bubble's header.
    // FavoriteButton sets aria-label to "Save to favorites" when not yet
    // saved. There may be multiple matches if the empty-state-or-elsewhere
    // had any — but in text-mode chat, only assistant messages render this
    // button. `.first()` picks the most recent (and only) one.
    const heart = page
      .getByRole('button', { name: 'Save to favorites' })
      .first();
    await expect(heart).toBeVisible();
    await heart.click();

    // After click, the same button changes its accessible name to
    // "Remove from favorites" (aria-pressed=true). That's our confirmation
    // the favorite was added without needing to peek into the panel yet.
    await expect(
      page.getByRole('button', { name: 'Remove from favorites' }).first()
    ).toBeVisible();

    // Now open the Saved panel via the "Saved" button in ActionButtons.
    // ActionButtons only renders when autoSpeak is false (we flipped it).
    // The button label is "Saved" with aria-label="Saved favorites".
    await page.getByRole('button', { name: 'Saved favorites' }).click();

    // FavoritesPanel headline is "Saved (1)" after one save.
    await expect(
      page.getByRole('heading', { name: /Saved \(1\)/ })
    ).toBeVisible();

    // The saved content should be visible inside the panel.
    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();
  });

  test('removing a favorite empties the list and shows the empty state', async ({
    page,
  }) => {
    await page.goto('/');
    await flipToTextMode(page);

    // Drive one save first so there's something to remove.
    const input = page.getByPlaceholder('Type your question...');
    await input.fill('Save this please');
    await input.press('Enter');
    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();
    await page
      .getByRole('button', { name: 'Save to favorites' })
      .first()
      .click();

    // Open the panel.
    await page.getByRole('button', { name: 'Saved favorites' }).click();
    await expect(
      page.getByRole('heading', { name: /Saved \(1\)/ })
    ).toBeVisible();

    // Each saved row has a small X button on the right with
    // aria-label="Remove from favorites" (same label as the heart in the
    // bubble — we scope to the dialog so we get the right button).
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: 'Remove from favorites' })
      .first()
      .click();

    // Empty state copy comes from FavoritesPanel.tsx → EmptyState.tsx.
    // Title: "No favorites yet"
    // Description starts with "Tap the heart..."
    await expect(
      page.getByRole('heading', { name: 'No favorites yet' })
    ).toBeVisible();
    await expect(page.getByText(/Tap the heart/i)).toBeVisible();

    // The header count also drops to (0). The "Clear all" link disappears
    // when the list is empty, so this is a useful double-check.
    await expect(
      page.getByRole('heading', { name: /Saved \(0\)/ })
    ).toBeVisible();
  });
});
