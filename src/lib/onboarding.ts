/**
 * First-run onboarding state.
 *
 * A tiny localStorage-backed flag remembering whether the user has been
 * walked through the welcome carousel. Pure module — no React imports.
 *
 * Design note: on a *read* error we return `true` (i.e. "already seen").
 * If localStorage is broken or denied (private mode, locked-down browser,
 * SSR), it's better to skip onboarding than to show it to the same person
 * on every reload with no way to silence it.
 */

const STORAGE_KEY = 'jaisus-onboarding-seen';

/** Has the user completed/dismissed onboarding? */
export function hasSeenOnboarding(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable — don't pester the user.
    return true;
  }
}

/** Mark onboarding as seen (called when user finishes the flow or dismisses it). */
export function markOnboardingSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Quota exceeded or storage unavailable — fail silently. The worst case
    // is the user sees onboarding again next reload, which is harmless.
  }
}

/** Reset — debug/admin tool to re-show onboarding. */
export function resetOnboarding(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
