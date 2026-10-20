/**
 * Conversation export — turn the chat history + favorites stored in
 * localStorage into a downloadable file in the user's chosen format.
 *
 * Pure helpers (`buildExport`, `formatExport`) have no DOM side-effects and
 * are safe to call during SSR — they return empty payloads / plain strings.
 * The only DOM-touching function is `downloadExport`, which wires up the
 * Blob + object URL + temporary anchor click dance.
 *
 * No external libraries — the AI SDK's UIMessage type is read structurally so
 * we only depend on `parts: Array<{ type: string; text?: string }>` actually
 * being present, which matches what `useChatHistory` persists.
 */

import type { UIMessage } from 'ai';
import type { Favorite } from './favorites';
import { stripAllEmotionTags } from './emotions';

export type ExportFormat = 'markdown' | 'json' | 'plaintext';

export interface ExportOptions {
  format: ExportFormat;
  /** Include the chat history (default true) */
  includeChat?: boolean;
  /** Include the favorites (default true) */
  includeFavorites?: boolean;
  /** Filename (without extension). Default 'jaisus-export-YYYY-MM-DD' */
  filename?: string;
}

export interface ExportPayload {
  exportedAt: string;
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    timestamp?: number;
  }>;
  favorites: Favorite[];
}

// ─── Storage keys ────────────────────────────────────────────────────
// Keep these in sync with `useChatHistory.ts` and `favorites.ts`. Inlined
// rather than imported to avoid pulling React hook code into a pure lib.
const CHAT_STORAGE_KEY = 'jaisus-chat-history';
const FAVORITES_STORAGE_KEY = 'jaisus-favorites';

// ─── Structural narrowing helpers ────────────────────────────────────
// We narrow UIMessage parts structurally rather than relying on the AI SDK's
// union — the persisted shape is whatever was written to localStorage, which
// may be from an older client. Defensive parsing keeps the export robust.

interface UIMessagePartLike {
  type?: unknown;
  text?: unknown;
}

interface UIMessageLike {
  role?: unknown;
  parts?: unknown;
  metadata?: unknown;
  // Some older clients persisted a `createdAt` on the message — pick it up
  // if it happens to be a number, otherwise ignore.
  createdAt?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Extract a numeric timestamp from a stored message if one is available.
 * Looks at a few common locations (top-level `createdAt`, `metadata.createdAt`,
 * `metadata.timestamp`). Returns undefined when nothing usable is found.
 */
function extractTimestamp(msg: UIMessageLike): number | undefined {
  if (typeof msg.createdAt === 'number') return msg.createdAt;
  if (isObject(msg.metadata)) {
    const meta = msg.metadata;
    if (typeof meta.createdAt === 'number') return meta.createdAt;
    if (typeof meta.timestamp === 'number') return meta.timestamp;
  }
  return undefined;
}

/**
 * Pull all text parts out of a UIMessage and join them. Returns an empty
 * string when there is nothing usable.
 */
function extractText(msg: UIMessageLike): string {
  if (!Array.isArray(msg.parts)) return '';
  const out: string[] = [];
  for (const raw of msg.parts) {
    if (!isObject(raw)) continue;
    const part = raw as UIMessagePartLike;
    if (part.type === 'text' && typeof part.text === 'string') {
      out.push(part.text);
    }
  }
  return out.join('');
}

/** Same rule ChatInterface uses to hide auto-vision pings, e.g. "(observe what you see…)". */
function isInternalPrompt(text: string): boolean {
  const t = text.trim();
  return t.startsWith('(') && t.endsWith(')');
}

/**
 * Read & parse JSON from localStorage. Returns `null` on any failure —
 * missing key, malformed JSON, storage disabled, SSR, etc. Callers fall
 * back to an empty section in that case.
 */
function safeReadJson(key: string): unknown {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validate + normalize a stored Favorite. Returns null for anything that
 * doesn't match the expected shape — keeps the export from leaking
 * unexpected fields out into a downloaded file.
 */
function normalizeFavorite(value: unknown): Favorite | null {
  if (!isObject(value)) return null;
  const { id, kind, content, context, createdAt } = value;
  if (typeof id !== 'string') return null;
  if (typeof content !== 'string') return null;
  if (typeof createdAt !== 'number') return null;
  if (
    kind !== 'message' &&
    kind !== 'teaching' &&
    kind !== 'verse' &&
    kind !== 'parable'
  ) {
    return null;
  }
  const fav: Favorite = { id, kind, content, createdAt };
  if (typeof context === 'string') fav.context = context;
  return fav;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Build the export payload from current localStorage state. Pure — doesn't
 * touch the DOM. Safe to call SSR (returns empty arrays then).
 */
export function buildExport(): ExportPayload {
  const exportedAt = new Date().toISOString();

  // --- Messages ---
  const messages: ExportPayload['messages'] = [];
  const rawChat = safeReadJson(CHAT_STORAGE_KEY);
  if (Array.isArray(rawChat)) {
    for (const raw of rawChat) {
      if (!isObject(raw)) continue;
      const msg = raw as UIMessageLike;
      // Only export user/assistant turns — system messages (rare in this
      // app, but possible) shouldn't end up in a user-facing dump.
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;
      const role = msg.role as 'user' | 'assistant';

      const rawText = extractText(msg);
      // Auto-vision pings are user messages wrapped in parentheses that the
      // chat UI hides; they aren't something the user said.
      if (role === 'user' && isInternalPrompt(rawText)) continue;
      // Strip emotion tags from assistant responses before exporting. User
      // messages never contain them, but stripping is idempotent so we
      // could run it unconditionally — keeping the conditional makes the
      // intent obvious in the diff.
      const text =
        role === 'assistant'
          ? stripAllEmotionTags(rawText).cleanText.trim()
          : rawText.trim();

      // Skip rows that ended up empty after stripping (e.g. tool-only or
      // reasoning-only assistant turns).
      if (text.length === 0) continue;

      const timestamp = extractTimestamp(msg);
      const entry: ExportPayload['messages'][number] =
        timestamp !== undefined ? { role, text, timestamp } : { role, text };
      messages.push(entry);
    }
  }

  // --- Favorites ---
  const favorites: Favorite[] = [];
  const rawFavs = safeReadJson(FAVORITES_STORAGE_KEY);
  if (Array.isArray(rawFavs)) {
    for (const raw of rawFavs) {
      const fav = normalizeFavorite(raw);
      if (fav) favorites.push(fav);
    }
  }

  return { exportedAt, messages, favorites };
}

// ─── Formatting ──────────────────────────────────────────────────────

/** ISO date → `YYYY-MM-DD`. */
function toDateOnly(iso: string): string {
  // `Date#toISOString()` always yields `YYYY-MM-DDTHH:...` — slicing is safe.
  return iso.slice(0, 10);
}

/** `Date.now()` ms → human-readable date in the user's locale. */
function formatHumanDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** Pretty label for the favorite section header. */
function favoriteKindLabel(kind: Favorite['kind']): string {
  switch (kind) {
    case 'message':
      return 'From jAIsus';
    case 'teaching':
      return 'Teachings';
    case 'verse':
      return 'Verses';
    case 'parable':
      return 'Parables';
  }
}

/** Stable ordering for kind sections — feels like reading a hymnal: */
const KIND_ORDER: Favorite['kind'][] = [
  'message',
  'teaching',
  'verse',
  'parable',
];

function groupByKind(
  favorites: Favorite[]
): Array<{ kind: Favorite['kind']; items: Favorite[] }> {
  const buckets: Record<Favorite['kind'], Favorite[]> = {
    message: [],
    teaching: [],
    verse: [],
    parable: [],
  };
  for (const fav of favorites) {
    buckets[fav.kind].push(fav);
  }
  // Newest first within each bucket — same convention as the favorites lib.
  for (const kind of KIND_ORDER) {
    buckets[kind].sort((a, b) => b.createdAt - a.createdAt);
  }
  return KIND_ORDER.filter(k => buckets[k].length > 0).map(k => ({
    kind: k,
    items: buckets[k],
  }));
}

function formatMarkdown(payload: ExportPayload): string {
  const lines: string[] = [];
  lines.push('# jAIsus Export');
  lines.push('');
  lines.push(`*Exported ${toDateOnly(payload.exportedAt)}*`);
  lines.push('');

  // Conversations section.
  if (payload.messages.length > 0) {
    lines.push('## Conversations');
    lines.push('');
    for (const msg of payload.messages) {
      const who = msg.role === 'user' ? 'You' : 'jAIsus';
      // Render each message body as a blockquote, preserving internal line
      // breaks by prefixing every line with `> `.
      const body = msg.text.split('\n').join('\n> ');
      lines.push(`> **${who}:** ${body}`);
      lines.push('');
    }
  }

  // Favorites section.
  if (payload.favorites.length > 0) {
    lines.push('## Saved');
    lines.push('');
    for (const group of groupByKind(payload.favorites)) {
      lines.push(`### ${favoriteKindLabel(group.kind)}`);
      lines.push('');
      for (const fav of group.items) {
        const body = fav.content.split('\n').join('\n> ');
        lines.push(`> ${body}`);
        if (fav.context) {
          lines.push(`> *${fav.context}*`);
        }
        lines.push(`*Saved on ${formatHumanDate(fav.createdAt)}*`);
        lines.push('');
      }
    }
  }

  // Trim any trailing blank lines.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n') + '\n';
}

function formatPlaintext(payload: ExportPayload): string {
  const lines: string[] = [];
  lines.push('jAIsus Export');
  lines.push(`Exported ${toDateOnly(payload.exportedAt)}`);
  lines.push('---');

  if (payload.messages.length > 0) {
    lines.push('Conversations');
    lines.push('');
    for (const msg of payload.messages) {
      const prefix = msg.role === 'user' ? 'YOU:' : 'JAISUS:';
      // Indent continuation lines under the prefix so a multi-line message
      // is still readable as plain text.
      const [first, ...rest] = msg.text.split('\n');
      lines.push(`${prefix} ${first}`);
      for (const line of rest) {
        lines.push(`  ${line}`);
      }
      lines.push('');
    }
    lines.push('---');
  }

  if (payload.favorites.length > 0) {
    lines.push('Saved');
    lines.push('');
    for (const group of groupByKind(payload.favorites)) {
      lines.push(favoriteKindLabel(group.kind).toUpperCase());
      lines.push('');
      for (const fav of group.items) {
        const [first, ...rest] = fav.content.split('\n');
        lines.push(first);
        for (const line of rest) lines.push(line);
        if (fav.context) lines.push(`(${fav.context})`);
        lines.push(`Saved on ${formatHumanDate(fav.createdAt)}`);
        lines.push('');
      }
    }
    lines.push('---');
  }

  // Trim any trailing blank lines but leave a final newline at EOF.
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n') + '\n';
}

/**
 * Format the payload as a string for the chosen format.
 *  - markdown: a human-friendly .md with H1 headers per section, > blockquotes for messages.
 *  - json: pretty-printed JSON (2-space indent).
 *  - plaintext: bare lines, no formatting characters.
 */
export function formatExport(
  payload: ExportPayload,
  format: ExportFormat
): string {
  switch (format) {
    case 'json':
      return JSON.stringify(payload, null, 2);
    case 'markdown':
      return formatMarkdown(payload);
    case 'plaintext':
      return formatPlaintext(payload);
  }
}

// ─── Download trigger ────────────────────────────────────────────────

interface FormatDescriptor {
  mime: string;
  extension: string;
}

const FORMAT_DESCRIPTORS: Record<ExportFormat, FormatDescriptor> = {
  markdown: { mime: 'text/markdown;charset=utf-8', extension: 'md' },
  json: { mime: 'application/json;charset=utf-8', extension: 'json' },
  plaintext: { mime: 'text/plain;charset=utf-8', extension: 'txt' },
};

function defaultFilename(): string {
  const today = new Date();
  // Always YYYY-MM-DD in local time, not UTC — matches what the user sees
  // on the rest of the app.
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `jaisus-export-${y}-${m}-${d}`;
}

/**
 * Apply optional section filters from ExportOptions to a payload. We build
 * the full payload first so the formatter sees a consistent shape; this
 * function just empties the sections the caller doesn't want.
 */
function applyOptions(
  payload: ExportPayload,
  options: ExportOptions
): ExportPayload {
  const includeChat = options.includeChat !== false;
  const includeFavorites = options.includeFavorites !== false;
  if (includeChat && includeFavorites) return payload;
  return {
    exportedAt: payload.exportedAt,
    messages: includeChat ? payload.messages : [],
    favorites: includeFavorites ? payload.favorites : [],
  };
}

/**
 * Build + format + trigger a browser download. Returns true on success.
 * No-op + returns false if SSR.
 */
export function downloadExport(options: ExportOptions): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  try {
    const payload = applyOptions(buildExport(), options);
    const contents = formatExport(payload, options.format);
    const descriptor = FORMAT_DESCRIPTORS[options.format];
    const filename = `${options.filename ?? defaultFilename()}.${descriptor.extension}`;

    const blob = new Blob([contents], { type: descriptor.mime });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    // Hide it offscreen — some browsers refuse to click an element that
    // isn't attached to the DOM, so we attach + remove + revoke.
    anchor.style.position = 'fixed';
    anchor.style.left = '-9999px';
    anchor.rel = 'noopener';

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Keep the blob URL alive for a while: iOS Safari only reads it after
    // the user confirms its download prompt, so revoking right away makes
    // the download fail there. 40 s matches FileSaver.js.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore — already revoked or never created.
      }
    }, 40_000);

    return true;
  } catch {
    return false;
  }
}

// ─── Test seams ──────────────────────────────────────────────────────
// Exported only to satisfy `noUnusedLocals` if a test ever needs them.
// (Tree-shaken in production.) Intentionally minimal surface.
export const __INTERNAL = {
  CHAT_STORAGE_KEY,
  FAVORITES_STORAGE_KEY,
  FORMAT_DESCRIPTORS,
};

// Suppress the unused-import warning for `UIMessage`. It's part of the
// documented public surface of this module's narrowing (the persisted
// payload IS a UIMessage[]), but TypeScript can't see that from a
// type-only structural cast.
export type _UIMessageReference = UIMessage;
