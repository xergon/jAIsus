/**
 * Favorites persistence + state logic.
 *
 * Pure module — no React imports. Backed by localStorage. Survives reloads.
 * Mutations dispatch a `jaisus-favorites-changed` CustomEvent on `window`
 * so any subscribed hook (across components or tabs via storage) can re-read.
 */

export interface Favorite {
  /** Stable hash of (kind + content) so toggling is idempotent. */
  id: string;
  kind: 'message' | 'teaching' | 'verse' | 'parable';
  /** The text being favorited. */
  content: string;
  /** Optional: which conversation/personality/topic this came from. */
  context?: string;
  /** Date.now() at creation. */
  createdAt: number;
}

const STORAGE_KEY = 'jaisus-favorites';
const MAX_FAVORITES = 200;
const CHANGE_EVENT = 'jaisus-favorites-changed';

/**
 * Unicode-safe base64. `btoa` chokes on non-Latin1 characters, so we encode
 * to UTF-8 bytes via TextEncoder first. Falls back to a simple non-crypto
 * hash if either is unavailable (older environments / SSR edge cases).
 */
function unicodeSafeBase64(input: string): string {
  try {
    if (typeof TextEncoder !== 'undefined' && typeof btoa !== 'undefined') {
      const bytes = new TextEncoder().encode(input);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }
  } catch {
    // fall through to fallback hash
  }
  // Fallback: djb2-ish hash rendered as base36. Deterministic, collision-rare
  // enough for our small bounded set.
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/**
 * Deterministic ID for a favorite. Same (kind, content) always yields the
 * same id, which is what makes toggling idempotent across reloads.
 *
 * Previously this took only the first 200 chars of content, which caused
 * collisions for long messages that shared an opener (toggling A removed B).
 * Fix: combine a content-length prefix with a sample from the START AND END
 * of the content. Still bounded so the id stays short, but distinguishes
 * messages whose first 200 chars match while their endings differ.
 */
export function favoriteId(kind: Favorite['kind'], content: string): string {
  const len = content.length;
  // For short content the prefix is the whole thing; for long content,
  // include a tail slice so endings differentiate near-duplicate openers.
  const seed = len <= 240
    ? content
    : `${len}|${content.slice(0, 120)}|${content.slice(-120)}`;
  return `${kind}:${unicodeSafeBase64(seed)}`;
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // CustomEvent unsupported — silently ignore.
  }
}

function readAll(): Favorite[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: ensure each entry has the expected shape.
    return parsed.filter(
      (f): f is Favorite =>
        f &&
        typeof f === 'object' &&
        typeof f.id === 'string' &&
        typeof f.content === 'string' &&
        typeof f.createdAt === 'number' &&
        (f.kind === 'message' ||
          f.kind === 'teaching' ||
          f.kind === 'verse' ||
          f.kind === 'parable')
    );
  } catch {
    return [];
  }
}

function writeAll(favorites: Favorite[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Audit fix: sort newest-first BEFORE slicing so a corrupted / migrated
    // storage order can't cause us to drop the newest entries on trim.
    const trimmed = [...favorites]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_FAVORITES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage unavailable — drop silently.
  }
}

/** Returns favorites, newest first. */
export function listFavorites(): Favorite[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

/** Synchronous check by id. */
export function isFavorite(id: string): boolean {
  return readAll().some(f => f.id === id);
}

/**
 * Add a favorite. If a favorite with the same id already exists, returns
 * the existing one without modifying storage.
 */
export function addFavorite(fav: Omit<Favorite, 'id' | 'createdAt'>): Favorite {
  const id = favoriteId(fav.kind, fav.content);
  const all = readAll();
  const existing = all.find(f => f.id === id);
  if (existing) return existing;

  const entry: Favorite = {
    id,
    kind: fav.kind,
    content: fav.content,
    context: fav.context,
    createdAt: Date.now(),
  };
  // Newest first; cap at MAX_FAVORITES.
  const next = [entry, ...all].slice(0, MAX_FAVORITES);
  writeAll(next);
  emitChange();
  return entry;
}

/** Remove a favorite by id. No-op if not present. */
export function removeFavorite(id: string): void {
  const all = readAll();
  const next = all.filter(f => f.id !== id);
  if (next.length === all.length) return;
  writeAll(next);
  emitChange();
}

/**
 * Toggle a favorite. Returns the new Favorite if added, or null if removed.
 * Idempotent w.r.t. the (kind, content) pair.
 */
export function toggleFavorite(
  fav: Omit<Favorite, 'id' | 'createdAt'>
): Favorite | null {
  const id = favoriteId(fav.kind, fav.content);
  if (isFavorite(id)) {
    removeFavorite(id);
    return null;
  }
  return addFavorite(fav);
}

/** Wipe all favorites. */
export function clearFavorites(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
  emitChange();
}
