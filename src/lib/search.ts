/**
 * Client-side search across three local data sources:
 *   1. Chat history (`jaisus-chat-history` in localStorage, serialized UIMessage[])
 *   2. Favorites (curated by the user)
 *   3. Parables (timeless content shipped with the app)
 *
 * Pure module — no React. Reads localStorage fresh on every call so callers
 * always get current data. Designed for small datasets (<= 100 messages,
 * <= 200 favorites, ~50 parables) — no precomputed index needed.
 */
import type { UIMessage } from 'ai';
import { stripAllEmotionTags } from './emotions';
import { listFavorites, type Favorite } from './favorites';
import { parables } from './parables';

export type SearchSource = 'chat' | 'favorite' | 'parable';

export interface SearchResult {
  id: string;
  source: SearchSource;
  /** Plain-text excerpt to show in the result list (may be truncated with ellipses). */
  text: string;
  /** Full original content — used when the consumer needs the complete text
   *  (e.g. SearchPanel.onAskAbout sends this to chat, NOT the truncated `text`). */
  fullText: string;
  /** Brief context label (e.g. "From jAIsus", "Parable of the Good Samaritan", "Saved verse"). */
  context?: string;
  /** Optional timestamp for chat / favorite results. Used as a tiebreaker when ranking. */
  timestamp?: number;
  /** Higher = better match. */
  score: number;
}

const CHAT_STORAGE_KEY = 'jaisus-chat-history';
const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 50;
const EXCERPT_LENGTH = 140;

// Source weights — recent chat outranks favorites outranks timeless parables.
const SOURCE_WEIGHT: Record<SearchSource, number> = {
  chat: 2.0,
  favorite: 1.5,
  parable: 1.0,
};

// 14-day half-life for chat-recency decay. Older messages count for less.
const CHAT_DECAY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Indexed view of a single chat message — what we actually search against.
 * Built lazily inside searchAll() so the public API stays simple.
 */
interface ChatItem {
  id: string;
  searchable: string;
  timestamp: number | undefined;
}

/** Tolerant extraction of a UIMessage timestamp. Falls back to undefined. */
function readMessageTimestamp(msg: UIMessage): number | undefined {
  // Some apps stash createdAt on the message object itself; others put it in
  // metadata. Be permissive — neither field is on the v6 UIMessage type.
  const loose = msg as unknown as Record<string, unknown>;
  const direct = loose.createdAt;
  if (typeof direct === 'number') return direct;
  if (direct instanceof Date) return direct.getTime();
  if (typeof direct === 'string') {
    const parsed = Date.parse(direct);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const meta = loose.metadata;
  if (meta && typeof meta === 'object') {
    const metaCreated = (meta as Record<string, unknown>).createdAt;
    if (typeof metaCreated === 'number') return metaCreated;
    if (metaCreated instanceof Date) return metaCreated.getTime();
    if (typeof metaCreated === 'string') {
      const parsed = Date.parse(metaCreated);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

/**
 * Read + index chat history from localStorage. Returns [] on any error.
 * Joins all text parts, strips emotion tags from assistant text.
 */
function readChatItems(): ChatItem[] {
  if (typeof window === 'undefined') return [];
  let messages: UIMessage[];
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    messages = parsed as UIMessage[];
  } catch {
    return [];
  }

  const items: ChatItem[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || !Array.isArray(msg.parts)) continue;
    const textParts: string[] = [];
    for (const part of msg.parts) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text'
      ) {
        const t = (part as { text?: unknown }).text;
        if (typeof t === 'string' && t.length > 0) textParts.push(t);
      }
    }
    if (textParts.length === 0) continue;
    const joined = textParts.join(' ');
    const cleaned =
      msg.role === 'assistant'
        ? stripAllEmotionTags(joined).cleanText
        : joined;
    const trimmed = cleaned.trim();
    if (trimmed.length === 0) continue;
    items.push({
      id: typeof msg.id === 'string' ? msg.id : `chat-${items.length}`,
      searchable: trimmed,
      timestamp: readMessageTimestamp(msg),
    });
  }
  return items;
}

/**
 * Count case-insensitive occurrences of `term` in `haystack`. Uses
 * String#indexOf so we don't have to worry about regex-escaping the term.
 */
function countOccurrences(haystack: string, term: string): number {
  if (term.length === 0) return 0;
  const h = haystack.toLowerCase();
  const t = term.toLowerCase();
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = h.indexOf(t, from);
    if (idx === -1) break;
    count++;
    from = idx + t.length;
  }
  return count;
}

/** Index of the first match of any term, for excerpt centering. -1 if none. */
function firstMatchIndex(haystack: string, terms: string[]): number {
  const lower = haystack.toLowerCase();
  let best = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * Build a ~EXCERPT_LENGTH character window centered on the first match.
 * Adds ellipsis markers when we trim either edge.
 */
function buildExcerpt(text: string, terms: string[]): string {
  if (text.length <= EXCERPT_LENGTH) return text;
  const matchAt = firstMatchIndex(text, terms);
  if (matchAt === -1) {
    return `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
  }
  // Center the window on the match — half the budget on either side.
  const half = Math.floor(EXCERPT_LENGTH / 2);
  let start = Math.max(0, matchAt - half);
  let end = Math.min(text.length, start + EXCERPT_LENGTH);
  // If we hit the end, walk start back so we still get a full window.
  if (end === text.length) start = Math.max(0, end - EXCERPT_LENGTH);
  // Snap to a nearby word boundary when possible — nicer to read.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space - start < 20) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space !== -1 && end - space < 20) end = space;
  }
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  return `${head}${text.slice(start, end).trim()}${tail}`;
}

/** Friendly context label for a favorite by kind. */
function favoriteContext(fav: Favorite): string {
  switch (fav.kind) {
    case 'message':
      return 'Saved message';
    case 'teaching':
      return 'Saved teaching';
    case 'verse':
      return 'Saved verse';
    case 'parable':
      return 'Saved parable';
  }
}

/**
 * Score a hit: sum of (term frequency × source weight). Chat results get an
 * exponential recency decay — a match from today counts ~2x a match from
 * two weeks ago.
 */
function scoreHit(
  searchable: string,
  terms: string[],
  source: SearchSource,
  timestamp: number | undefined,
  now: number
): number {
  let tf = 0;
  for (const term of terms) tf += countOccurrences(searchable, term);
  if (tf === 0) return 0;
  let score = tf * SOURCE_WEIGHT[source];
  if (source === 'chat' && typeof timestamp === 'number') {
    const ageMs = Math.max(0, now - timestamp);
    const decay = Math.pow(0.5, ageMs / CHAT_DECAY_HALF_LIFE_MS);
    // Floor at 0.4 — a six-month-old gold match shouldn't disappear entirely.
    score *= Math.max(0.4, decay);
  }
  return score;
}

/** True only when ALL terms appear in the searchable text. */
function allTermsPresent(searchable: string, terms: string[]): boolean {
  const lower = searchable.toLowerCase();
  for (const term of terms) {
    if (!lower.includes(term.toLowerCase())) return false;
  }
  return true;
}

/**
 * Search across chat history, favorites, and parables.
 *
 * - Case-insensitive.
 * - Splits the query into whitespace-separated terms; ALL terms must appear
 *   somewhere in the item's searchable text.
 * - Sorted best-first, capped at {@link MAX_RESULTS}.
 * - Returns [] for empty or very short queries (< {@link MIN_QUERY_LENGTH}).
 */
export function searchAll(query: string): SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  // Split on whitespace, drop empties. Keep duplicates — they boost TF.
  const terms = trimmed.split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return [];

  const now = Date.now();
  const results: SearchResult[] = [];

  // --- Chat history ---
  for (const item of readChatItems()) {
    if (!allTermsPresent(item.searchable, terms)) continue;
    const score = scoreHit(
      item.searchable,
      terms,
      'chat',
      item.timestamp,
      now
    );
    if (score === 0) continue;
    results.push({
      id: `chat:${item.id}`,
      source: 'chat',
      text: buildExcerpt(item.searchable, terms),
      fullText: item.searchable,
      context: 'From your chat',
      timestamp: item.timestamp,
      score,
    });
  }

  // --- Favorites ---
  for (const fav of listFavorites()) {
    if (!allTermsPresent(fav.content, terms)) continue;
    const score = scoreHit(
      fav.content,
      terms,
      'favorite',
      fav.createdAt,
      now
    );
    if (score === 0) continue;
    results.push({
      id: `favorite:${fav.id}`,
      source: 'favorite',
      text: buildExcerpt(fav.content, terms),
      fullText: fav.content,
      context: fav.context ?? favoriteContext(fav),
      timestamp: fav.createdAt,
      score,
    });
  }

  // --- Parables ---
  for (const parable of parables) {
    const searchable = [
      parable.title,
      parable.summary,
      parable.fullText,
      parable.themes.join(' '),
    ].join('\n');
    if (!allTermsPresent(searchable, terms)) continue;
    // For excerpting, prefer the richer fullText where the body of the
    // story lives; fall back to summary if the match landed in title/themes.
    const excerptSource =
      firstMatchIndex(parable.fullText, terms) !== -1
        ? parable.fullText
        : firstMatchIndex(parable.summary, terms) !== -1
          ? parable.summary
          : searchable;
    const score = scoreHit(searchable, terms, 'parable', undefined, now);
    if (score === 0) continue;
    results.push({
      id: `parable:${parable.id}`,
      source: 'parable',
      text: buildExcerpt(excerptSource, terms),
      // For parables, "ask jAIsus about this" should send the title +
      // reference rather than the raw scripture text — that yields a more
      // natural conversation than dumping the parable text into chat.
      fullText: `Tell me more about ${parable.title} (${parable.reference}).`,
      context: parable.title,
      score,
    });
  }

  // Rank: score desc, then timestamp desc (recent wins ties), then id for
  // determinism so unit tests don't flake.
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.timestamp ?? 0;
    const bt = b.timestamp ?? 0;
    if (bt !== at) return bt - at;
    return a.id.localeCompare(b.id);
  });

  return results.slice(0, MAX_RESULTS);
}

/**
 * Helper for callers that want to highlight matches in their own renderer.
 * Returns the input text with every case-insensitive occurrence of any term
 * wrapped in `<mark>...</mark>`. The original text is HTML-escaped first so
 * the result can be assigned directly to innerHTML.
 *
 * Exported for tests and for callers that prefer dangerouslySetInnerHTML;
 * SearchPanel itself uses a JSX-based highlighter instead.
 */
export function highlightMatches(text: string, query: string): string {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return escapeHtml(text);
  const terms = trimmed.split(/\s+/).filter(t => t.length > 0);
  if (terms.length === 0) return escapeHtml(text);

  // Build one combined case-insensitive regex from all terms (escaped).
  const pattern = new RegExp(
    `(${terms.map(escapeRegex).join('|')})`,
    'gi'
  );
  // Split, escape pieces individually, wrap matches.
  const parts = text.split(pattern);
  return parts
    .map((part, i) => {
      const escaped = escapeHtml(part);
      // Odd-indexed parts are captured groups (matches).
      return i % 2 === 1 ? `<mark>${escaped}</mark>` : escaped;
    })
    .join('');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
