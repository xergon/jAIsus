/**
 * Onboarding overlay — the four-slide welcome carousel shown on first run.
 *
 * Source of truth: `src/components/OnboardingOverlay.tsx` (slide copy) and
 * `src/lib/onboarding.ts` (the `jaisus-onboarding-seen` localStorage flag).
 *
 * The overlay is gated on the localStorage flag, NOT on a server check, so
 * pre-seeding the flag from an init script is the canonical way to skip it.
 */

import { test, expect } from './fixtures';

test.describe('Onboarding overlay', () => {
  test('first visit shows the onboarding overlay', async ({ page }) => {
    // `clearStorage` fixture wiped localStorage before nav, so the
    // `jaisus-onboarding-seen` flag is absent → overlay should appear.
    await page.goto('/');

    // The dialog is rendered with role="dialog" and aria-labelledby pointing
    // at an <h2>. We look for the h2 heading text directly — that's the
    // first slide's title.
    await expect(
      page.getByRole('heading', { name: 'Meet jAIsus' })
    ).toBeVisible();

    // Subtitle of slide 1 — sanity check that we're really seeing the
    // carousel content rather than a stale UI element.
    await expect(
      page.getByText(/AI guide grounded in the teachings of Jesus/i)
    ).toBeVisible();
  });

  test('skip dismisses the onboarding immediately', async ({ page }) => {
    await page.goto('/');

    // The Skip button is small and top-right inside the dialog. It calls
    // `onComplete` which marks the flag AND closes the overlay.
    await page.getByRole('button', { name: 'Skip' }).click();

    // Overlay gone — the "Meet jAIsus" heading should disappear.
    await expect(
      page.getByRole('heading', { name: 'Meet jAIsus' })
    ).toBeHidden();
  });

  test('next advances through 4 slides and "Start talking" closes', async ({
    page,
  }) => {
    await page.goto('/');

    // Slide 1: title visible, button says "Next"
    await expect(
      page.getByRole('heading', { name: 'Meet jAIsus' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Slide 2
    await expect(
      page.getByRole('heading', { name: 'Tap the mic, ask anything' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Slide 3
    await expect(
      page.getByRole('heading', { name: 'He has many voices' })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();

    // Slide 4 — the final slide swaps the CTA label to "Start talking"
    await expect(page.getByRole('heading', { name: 'Begin' })).toBeVisible();
    await page.getByRole('button', { name: 'Start talking' }).click();

    // Overlay closed — no more dialog heading.
    await expect(
      page.getByRole('heading', { name: 'Begin' })
    ).toBeHidden();
  });

  test('second visit (flag already set) does not show onboarding', async ({
    page,
    context,
  }) => {
    // Pre-seed the seen flag BEFORE the page script runs. `addInitScript`
    // executes on every navigation in this context. Note: the auto
    // `clearStorage` fixture also added an init script that clears storage —
    // init scripts run in registration order, so we set the flag AFTER the
    // clear, which is what we want.
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('jaisus-onboarding-seen', '1');
      } catch {
        /* storage unavailable — nothing to do */
      }
    });

    await page.goto('/');

    // The overlay should never render. Wait long enough that any client-side
    // mount delay would have shown it if it were going to.
    //
    // We use `toHaveCount(0)` rather than `toBeHidden()` because a non-existent
    // dialog with role="dialog" is the strongest signal that nothing rendered.
    await expect(
      page.getByRole('dialog', { name: /Meet jAIsus|Tap the mic|He has many|Begin/i })
    ).toHaveCount(0);
  });
});
