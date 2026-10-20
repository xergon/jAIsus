'use client';

import { useHaptics } from '@/hooks/useHaptics';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';

export type ShareKind = 'message' | 'teaching' | 'verse' | 'parable';

interface ShareButtonProps {
  /** Plain text content to share */
  content: string;
  /** Optional title shown in share sheet */
  title?: string;
  /** Type of content — used for the share-text formatting and analytics */
  kind?: ShareKind;
  /** Optional source label appended to share text — e.g. "Parable of the Good Samaritan" */
  context?: string;
  /** Visual size — defaults to 'sm' */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Compose the share text per content kind.
 *
 * Verses get quotation marks + attribution on one line.
 * Parables get a "From {context}" preamble + a trimmed excerpt.
 * Everything else uses the default footer-only format.
 */
function composeShareText(
  kind: ShareKind,
  content: string,
  context: string | undefined
): string {
  const trimmed = content.trim();

  if (kind === 'verse') {
    return `"${trimmed}" — ${context ?? 'Scripture'}\n\nvia jAIsus`;
  }

  if (kind === 'parable') {
    const excerpt = trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
    // Contexts are titles like "The Good Samaritan" — no extra "the".
    const source = context ?? 'the parables';
    return `From ${source}: "${excerpt}"\n\nvia jAIsus`;
  }

  // 'message' | 'teaching' — default footer
  const base = `${trimmed}\n\n— shared from jAIsus`;
  return context ? `${base}\n${context}` : base;
}

/**
 * Type guard for AbortError (user cancelled the share sheet). We intentionally
 * stay quiet for these — they're a normal interaction, not a failure.
 */
function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown };
  return e.name === 'AbortError';
}

/**
 * Small share button that prefers the native share sheet (mobile / modern
 * Safari + Chrome) and falls back to clipboard copy on desktop / older
 * browsers.
 *
 * Visual style matches FavoriteButton: no fill, no background, sits flush in
 * message headers next to it.
 */
export function ShareButton({
  content,
  title,
  kind = 'message',
  context,
  size = 'sm',
  className = '',
}: ShareButtonProps) {
  const { vibrate } = useHaptics();

  const dimensions = size === 'md' ? 'w-11 h-11' : 'w-9 h-9';
  const iconSize = size === 'md' ? 22 : 18;

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Don't bubble — these often sit inside larger clickable cards.
    e.stopPropagation();

    // Privacy-safe: only the kind is tracked, never the content.
    track('share.invoked', { kind });
    vibrate('tap');

    const shareText = composeShareText(kind, content, context);

    // Prefer the native share sheet when available. `navigator.share` exists
    // on iOS Safari, Android Chrome, and modern desktop Safari. We feature-
    // detect at call time rather than capability-detect at mount because
    // some browsers (e.g. Firefox desktop) only expose it under certain
    // permissions/origins.
    const canNativeShare =
      typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    if (canNativeShare) {
      try {
        await navigator.share({
          title: title ?? 'jAIsus',
          text: shareText,
        });
        toast.success('Shared!');
        vibrate('success');
        return;
      } catch (err) {
        // User cancelled — stay quiet.
        if (isAbortError(err)) return;
        // Other share failures: fall through to clipboard as a best-effort
        // backup. Log for debugging but don't toast an error.
        console.error('[ShareButton] navigator.share failed', err);
      }
    }

    // Clipboard fallback.
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(shareText);
        toast.success('Copied!');
        vibrate('success');
        return;
      }
      // No clipboard API at all — log and stay quiet per spec.
      console.error('[ShareButton] clipboard API unavailable');
    } catch (err) {
      console.error('[ShareButton] clipboard write failed', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Share"
      title="Share"
      className={[
        dimensions,
        'inline-flex items-center justify-center rounded-full',
        'text-stone-400 hover:text-stone-600',
        'transition-transform duration-150 ease-out',
        'active:scale-90',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60',
        // No backdrop per spec — button stands alone next to FavoriteButton.
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* "Arrow out of square" share glyph — outline style */}
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
    </button>
  );
}
