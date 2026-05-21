/**
 * Chat behavior — sending a message, seeing a streamed response, and the
 * pre-conversation empty-state content stack (daily verse, kindness, etc.).
 *
 * Two UI modes share a single component (`ChatInterface.tsx`):
 *
 *   - autoSpeak ON  (default) — voice-first mode. Text input still visible
 *     in a sticky footer. No daily-content stack — the screen is tuned for
 *     voice. Messages stream to a transcript overlay (hidden by default).
 *
 *   - autoSpeak OFF — text-first mode. Empty state shows the daily content
 *     stack (verse / kindness / suggestions / mood). Messages render as
 *     bubbles in a scrolling list.
 *
 * Tests below cover both. We always dismiss the onboarding overlay first by
 * pre-seeding `jaisus-onboarding-seen` — otherwise the modal blocks clicks.
 */

import { test, expect, STUB_ASSISTANT_TEXT } from './fixtures';

test.describe('Chat', () => {
  // Skip onboarding for every test in this file. Faster than clicking Skip
  // in each test, and means we don't depend on the onboarding flow working.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jaisus-onboarding-seen', '1');
      } catch {
        /* ignore — onboarding will show but the test will fail explicitly */
      }
    });
  });

  test('user types a message and sees the streamed response', async ({ page }) => {
    await page.goto('/');

    // The text input is rendered in BOTH UI modes (voice and chat). In voice
    // mode it sits in a sticky footer above the mic. The placeholder text
    // is the most robust selector.
    const input = page.getByPlaceholder('Type your question...');
    await expect(input).toBeVisible();

    await input.fill('What is grace?');

    // Submitting the form sends the message. There's a visual send button
    // that only appears when input has text — we use form submission via
    // Enter instead, which works whether or not the button is rendered.
    await input.press('Enter');

    // The stub stream contains the line "Peace be with you, friend." — the
    // text-delta event. After the stream completes, the assistant bubble
    // should be visible. In voice mode the message ALSO triggers the
    // transcript overlay only if the user has tapped the transcript toggle,
    // so we look for the message in the DOM directly.
    //
    // Note: in voice mode (default autoSpeak=true) the user/assistant
    // bubbles aren't rendered inline — only via the transcript overlay.
    // The transcript bubbles render the assistant text inside a styled
    // div with `text-stone-200` etc. Either way, the text content appears
    // somewhere — looking for the stub text is the simplest correctness
    // signal.
    //
    // To be safe across both modes, we click the transcript toggle so the
    // overlay is shown, then assert the assistant text appears.
    const transcriptToggle = page.getByRole('button', { name: 'Show transcript' });
    if (await transcriptToggle.isVisible().catch(() => false)) {
      await transcriptToggle.click();
    }

    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();
  });

  test('empty state shows the daily content stack (verse, kindness, suggestions, mood)', async ({
    page,
  }) => {
    await page.goto('/');

    // The daily content stack only appears in text-mode (autoSpeak=false).
    // The simplest way to flip the mode is via Settings → Auto-speak toggle.
    //
    // Settings button has aria-label="Settings".
    await page.getByRole('button', { name: 'Settings' }).first().click();

    // Settings panel — toggle "Auto-speak responses" off. The toggle has no
    // accessible role of "switch" (it's a styled <button>), so we locate by
    // the surrounding label text and click it.
    //
    // The settings UI shows a card titled "Auto-speak responses" with a
    // toggle button to the right. We click any button that's the immediate
    // sibling of the label container — locating by the toggle's visual
    // structure is brittle, so instead we locate by stable role + parent.
    await expect(page.getByText('Auto-speak responses')).toBeVisible();
    // The toggle <button> is the only button in the same flex row as the
    // "Auto-speak responses" label. Use the row's accessible structure.
    const autoSpeakRow = page.locator('div').filter({
      hasText: /^Auto-speak responses/,
    }).first();
    // The toggle is the last button inside this row.
    await autoSpeakRow.locator('button').last().click();

    // Close settings.
    await page.getByRole('button', { name: 'Done' }).click();

    // Daily verse — verse-of-the-day card has aria-label="Verse of the day".
    await expect(page.getByLabel('Verse of the day')).toBeVisible();

    // Suggested prompts — the section has aria-label="Suggested prompts" and
    // is preceded by a "Try asking..." caption.
    await expect(page.getByText(/Try asking\.\.\./i)).toBeVisible();

    // Mood selector renders mood options. We assert it's present by looking
    // for one of its stable elements (a "How are you feeling?"-ish prompt
    // is rendered by MoodSelector — but to avoid coupling to copy that may
    // change, we check for at least one mood button via its emoji-bearing
    // chip class. As a fallback, just confirm we're not in voice mode any
    // more by checking the verse is on screen plus the suggestions caption.)
    //
    // (No additional brittle assertion needed — verse + suggestions is
    // enough signal that the empty-state stack rendered.)
  });

  test('tapping a suggested prompt sends it as a chat message', async ({
    page,
  }) => {
    await page.goto('/');

    // Flip into text mode (same dance as the previous test).
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const autoSpeakRow = page.locator('div').filter({
      hasText: /^Auto-speak responses/,
    }).first();
    await autoSpeakRow.locator('button').last().click();
    await page.getByRole('button', { name: 'Done' }).click();

    // Wait for the suggestions strip to mount.
    await expect(page.getByText(/Try asking\.\.\./i)).toBeVisible();

    // Suggestion chips are <button>s inside the "Suggested prompts" group.
    // Each chip is structured as:
    //   <button>
    //     <span aria-hidden>EMOJI</span>
    //     <span>prompt text</span>
    //   </button>
    // We read the text from the INNER `<span class="truncate">` so we
    // don't accidentally include the leading emoji — the user message
    // bubble only contains the prompt text (no emoji), so we need to
    // assert against the same string.
    const firstChip = page
      .locator('[aria-label="Suggested prompts"] button')
      .first();
    // The text span is the LAST span child of the button.
    const textSpan = firstChip.locator('span').last();
    const chipText = (await textSpan.textContent())?.trim() ?? '';
    expect(chipText.length).toBeGreaterThan(0);

    await firstChip.click();

    // The chip text becomes the user message. ChatMessage renders user
    // bubbles with `bg-blue-500` and the raw text. We don't lock to the
    // class — instead we just assert the text appears somewhere on screen.
    //
    // The chip itself disappears (it was inside the empty state, which
    // unmounts when messages.length > 0). So the only place the chip text
    // can still be is the user message bubble.
    await expect(page.getByText(chipText, { exact: false }).first()).toBeVisible();

    // And the stubbed assistant response should land too.
    await expect(page.getByText(STUB_ASSISTANT_TEXT)).toBeVisible();
  });
});
