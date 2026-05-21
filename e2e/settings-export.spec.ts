/**
 * Settings → Export your data.
 *
 * Source of truth:
 *   - SettingsPanel.tsx (renders <ExportButton /> in a labelled row)
 *   - ExportButton.tsx  (dropdown menu with three format options)
 *   - conversation-export.ts → downloadExport (programmatic <a download>
 *     click via a Blob URL — Playwright surfaces this as a 'download' event)
 *
 * We don't read the contents of the downloaded file. The download event
 * carries the suggested filename, which is what we assert against.
 */

import { test, expect } from './fixtures';

async function openSettings(page: import('@playwright/test').Page) {
  // The bottom-bar Settings button has aria-label="Settings". There are two
  // possible Settings entry points (one in voice mode's bottom bar, one in
  // ActionButtons when in text mode) — both share the aria-label. `.first()`
  // picks whichever is currently visible.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(
    page.getByRole('heading', { name: 'Settings' })
  ).toBeVisible();
}

test.describe('Settings → Export your data', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jaisus-onboarding-seen', '1');
      } catch {
        /* ignore */
      }
    });
  });

  test('export button reveals the three format options', async ({ page }) => {
    await page.goto('/');
    await openSettings(page);

    // The ExportButton trigger reads "Export your data" with a download icon.
    const trigger = page.getByRole('button', { name: /Export your data/i });
    await expect(trigger).toBeVisible();
    await trigger.click();

    // The dropdown is a role="menu" with three role="menuitem" entries.
    // Labels come from FORMAT_OPTIONS in ExportButton.tsx.
    await expect(
      page.getByRole('menuitem', { name: /Markdown \(\.md\)/i })
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /JSON \(\.json\)/i })
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: /Plain text \(\.txt\)/i })
    ).toBeVisible();
  });

  test('selecting Markdown triggers a download with a .md filename', async ({
    page,
  }) => {
    await page.goto('/');
    await openSettings(page);

    await page.getByRole('button', { name: /Export your data/i }).click();

    // Set up the download listener BEFORE clicking. Playwright queues the
    // 'download' event from the moment we start waiting; if we click first
    // the event can fire before we attach.
    const downloadPromise = page.waitForEvent('download');

    await page.getByRole('menuitem', { name: /Markdown \(\.md\)/i }).click();

    const download = await downloadPromise;

    // `downloadExport` builds the filename as
    //   `jaisus-export-YYYY-MM-DD.md`
    // The exact date depends on when the test runs, so we only assert on
    // the extension and a stable prefix.
    const suggested = download.suggestedFilename();
    expect(suggested).toMatch(/^jaisus-export-/);
    expect(suggested).toMatch(/\.md$/);

    // Optional: cancel the actual save to disk — Playwright will write the
    // file to a temp dir otherwise, which is harmless but pollutes test
    // output. `cancel()` is safe to call; if the download already finished,
    // it's a no-op.
    await download.cancel().catch(() => {
      /* already done, ignore */
    });
  });
});
