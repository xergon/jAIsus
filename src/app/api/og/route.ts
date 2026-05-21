/**
 * Dynamic OG image endpoint — GET /api/og
 *
 * Renders 1200x630 PNG cards for social media unfurls (OpenGraph, Twitter,
 * iMessage). Three variants:
 *
 *   ?type=default                            → branded homepage card
 *   ?type=verse&text=<verse>&ref=<citation>  → daily verse card
 *   ?type=message&text=<reply>               → shared message card
 *
 * Uses Next.js `next/og` (Satori-backed) to convert React elements to PNG.
 * Edge runtime, aggressively cached (same input always renders the same PNG).
 *
 * Crawlers send weird stuff — malformed input falls back to the default
 * variant rather than returning 400, so a bad share link still produces a
 * usable image.
 *
 * Note: this file is `.ts` (not `.tsx`) per the route spec, so JSX is built
 * with `React.createElement` calls. The visual output is identical.
 */
import { ImageResponse } from 'next/og';
import { createElement, type CSSProperties, type ReactElement } from 'react';

export const runtime = 'edge';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };

// ---------- design tokens (Tailwind stone/amber palette) ----------
const COLORS = {
  cream: '#fafaf9', // stone-50
  stone900: '#1c1917',
  stone800: '#292524',
  stone600: '#57534e',
  stone500: '#78716c',
  stone400: '#a8a29e',
  amber400: '#fbbf24',
  amber500: '#f59e0b',
  amber700: '#b45309',
} as const;

const SERIF_STACK =
  'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

// ---------- helpers ----------

/**
 * Sanitize a user-supplied query param: strip control chars, decode URI
 * components if needed, collapse whitespace, clamp length. Returns empty
 * string on failure rather than throwing.
 */
function clean(value: string | null, maxLen: number): string {
  if (!value) return '';
  let s = value;
  // decodeURIComponent throws on malformed sequences — swallow and fall back.
  try {
    s = decodeURIComponent(s);
  } catch {
    // already decoded, or garbled — use raw input
  }
  // strip ASCII control chars (incl. NUL, BEL, etc.) but keep printable Unicode
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // collapse runs of whitespace to a single space
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) {
    s = s.slice(0, maxLen - 1).trimEnd() + '…';
  }
  return s;
}

/** Pick a font size for verse body text based on length. */
function verseFontSize(text: string): number {
  if (text.length < 100) return 56;
  if (text.length < 180) return 44;
  return 36;
}

// ---------- shared layout pieces ----------

/** Warm amber radial glow in upper-right corner. */
function backgroundGlow(): ReactElement {
  return createElement('div', {
    style: {
      position: 'absolute',
      top: 0,
      right: 0,
      width: 800,
      height: 800,
      // Satori supports radial-gradient. Place glow off-canvas-right so the
      // softest edge fades through the visible area.
      background:
        'radial-gradient(circle at 80% 20%, rgba(251,191,36,0.35) 0%, rgba(251,191,36,0.12) 35%, rgba(251,191,36,0) 65%)',
      display: 'flex',
    },
  });
}

/** "jAIsus" wordmark in serif — "AI" is amber, rest is stone-900. */
function wordmark(): ReactElement {
  const base: CSSProperties = {
    fontFamily: SERIF_STACK,
    fontSize: 72,
    fontWeight: 700,
    lineHeight: 1,
    letterSpacing: '-0.02em',
  };
  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'baseline',
        color: COLORS.stone900,
      },
    },
    createElement('span', { style: base }, 'j'),
    createElement(
      'span',
      { style: { ...base, color: COLORS.amber500 } },
      'AI'
    ),
    createElement('span', { style: base }, 'sus')
  );
}

/** Bottom-left brand block: wordmark + subtitle. */
function brandBlock(): ReactElement {
  return createElement(
    'div',
    {
      style: { display: 'flex', flexDirection: 'column', gap: 8 },
    },
    wordmark(),
    createElement(
      'div',
      {
        style: {
          fontSize: 26,
          color: COLORS.stone600,
          letterSpacing: '0.01em',
        },
      },
      'AI Spiritual Companion'
    )
  );
}

/** Bottom-right URL tagline. */
function urlTag(): ReactElement {
  return createElement(
    'div',
    {
      style: {
        fontSize: 22,
        color: COLORS.stone400,
        letterSpacing: '0.04em',
        display: 'flex',
      },
    },
    'jaisus.vercel.app'
  );
}

/** Bottom row: brand block on the left, URL tag on the right. */
function footerRow(): ReactElement {
  return createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        width: '100%',
      },
    },
    brandBlock(),
    urlTag()
  );
}

/**
 * Card frame: cream background, glow, 60px padding, footer pinned to bottom.
 * `body` is the main content for the upper portion of the card.
 */
function cardFrame(body: ReactElement): ReactElement {
  return createElement(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        backgroundColor: COLORS.cream,
        padding: 60,
        fontFamily: SERIF_STACK,
      },
    },
    backgroundGlow(),
    createElement(
      'div',
      {
        // main content area — fills available vertical space above the footer
        style: {
          flex: 1,
          display: 'flex',
          width: '100%',
          position: 'relative',
        },
      },
      body
    ),
    footerRow()
  );
}

// ---------- variants ----------

function defaultCard(): ReactElement {
  const body = createElement(
    'div',
    {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 24,
        width: '100%',
        position: 'relative',
      },
    },
    // dove emoji, top-right of content area
    createElement(
      'div',
      {
        style: {
          position: 'absolute',
          top: 0,
          right: 0,
          fontSize: 80,
          display: 'flex',
        },
      },
      '\u{1F54A}\u{FE0F}'
    ),
    createElement(
      'div',
      {
        style: {
          fontSize: 92,
          fontWeight: 700,
          color: COLORS.stone900,
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          display: 'flex',
        },
      },
      'Talk to jAIsus.'
    ),
    createElement(
      'div',
      {
        style: {
          fontSize: 36,
          color: COLORS.stone600,
          lineHeight: 1.3,
          maxWidth: 900,
          display: 'flex',
        },
      },
      'A spiritual companion grounded in scripture.'
    )
  );
  return cardFrame(body);
}

function verseCard(text: string, ref: string): ReactElement {
  const fontSize = verseFontSize(text);
  const body = createElement(
    'div',
    {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        position: 'relative',
        padding: '0 40px',
      },
    },
    // big translucent opening quote, top-left of content
    createElement(
      'div',
      {
        style: {
          position: 'absolute',
          top: -40,
          left: 0,
          fontSize: 220,
          lineHeight: 1,
          color: COLORS.amber400,
          opacity: 0.35,
          fontFamily: SERIF_STACK,
          display: 'flex',
        },
      },
      '“'
    ),
    // big translucent closing quote, bottom-right of content
    createElement(
      'div',
      {
        style: {
          position: 'absolute',
          bottom: -80,
          right: 0,
          fontSize: 220,
          lineHeight: 1,
          color: COLORS.amber400,
          opacity: 0.35,
          fontFamily: SERIF_STACK,
          display: 'flex',
        },
      },
      '”'
    ),
    // verse body
    createElement(
      'div',
      {
        style: {
          fontSize,
          fontStyle: 'italic',
          color: COLORS.stone800,
          textAlign: 'center',
          lineHeight: 1.35,
          maxWidth: 1000,
          display: 'flex',
        },
      },
      text
    ),
    // em-dash + reference
    ref
      ? createElement(
          'div',
          {
            style: {
              marginTop: 32,
              fontSize: 30,
              color: COLORS.stone500,
              letterSpacing: '0.02em',
              display: 'flex',
            },
          },
          `— ${ref}`
        )
      : null
  );
  return cardFrame(body);
}

function messageCard(text: string): ReactElement {
  const body = createElement(
    'div',
    {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 28,
        width: '100%',
        position: 'relative',
      },
    },
    // "FROM JAISUS" label, top of content area
    createElement(
      'div',
      {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          fontSize: 22,
          fontWeight: 600,
          color: COLORS.amber700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          display: 'flex',
        },
      },
      'From jAIsus'
    ),
    // message body
    createElement(
      'div',
      {
        style: {
          fontSize: 40,
          color: COLORS.stone800,
          lineHeight: 1.35,
          maxWidth: 1000,
          display: 'flex',
        },
      },
      text
    )
  );
  return cardFrame(body);
}

// ---------- request handler ----------

const CACHE_HEADERS = {
  'Cache-Control':
    'public, max-age=3600, s-maxage=86400, immutable',
} as const;

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const type = (url.searchParams.get('type') || 'default').toLowerCase();

    let element: ReactElement;

    if (type === 'verse') {
      const text =
        clean(url.searchParams.get('text'), 300) ||
        'The Lord is my shepherd; I shall not want.';
      const ref = clean(url.searchParams.get('ref'), 60) || 'Psalm 23:1';
      element = verseCard(text, ref);
    } else if (type === 'message') {
      const text =
        clean(url.searchParams.get('text'), 250) ||
        'Peace be with you.';
      element = messageCard(text);
    } else {
      // 'default' or anything unrecognized
      element = defaultCard();
    }

    return new ImageResponse(element, {
      ...size,
      headers: { ...CACHE_HEADERS },
    });
  } catch (err) {
    // Last-ditch fallback — if rendering fails for any reason, return the
    // default card so crawlers still get a usable image. If even that fails,
    // surface a 500 with a short message.
    try {
      return new ImageResponse(defaultCard(), {
        ...size,
        headers: { ...CACHE_HEADERS },
      });
    } catch {
      const message = err instanceof Error ? err.message : 'unknown error';
      return new Response(`OG image generation failed: ${message}`, {
        status: 500,
      });
    }
  }
}
