/**
 * Conversation memory — cross-session continuity for jAIsus.
 *
 * Each conversation keeps ONE single-sentence summary here, upserted by its
 * session id as the conversation goes on (useLongTermMemory, via
 * /api/remember). Every chat request includes the most recent summaries
 * (user-profile.ts buildMemoryContext) so jAIsus has a sense of what was
 * previously discussed.
 *
 * Privacy: ONLY one-sentence summaries are kept, not the raw messages.
 *
 * Pure module — no React imports. Backed by localStorage. Mutations
 * dispatch a `jaisus-memories-changed` CustomEvent on `window` so any
 * subscribed hook (across components or tabs via storage) can re-read.
 *
 * Mirrors the shape of src/lib/favorites.ts (the canonical pattern in this
 * codebase) so the hook layer above can stay symmetrical.
 */

export interface ConversationMemory {
  /** UUID — crypto.randomUUID() when available, fallback otherwise. */
  id: string;
  /** Single sentence, ~80-150 chars typical. */
  summary: string;
  /** Date.now() at creation. */
  timestamp: number;
  /** Which personality was active for this conversation. */
  personalityId: string;
  /** How many UI messages went into the summary. */
  messageCount: number;
  /** The conversation this summarizes; one summary per session (see
   *  upsertSessionMemory). Absent on summaries saved before sessions. */
  sessionId?: string;
}

const STORAGE_KEY = 'jaisus-memories';
const MAX_MEMORIES = 30;
const CHANGE_EVENT = 'jaisus-memories-changed';

/**
 * Generate a unique id. Prefers `crypto.randomUUID` (standard in all modern
 * browsers + Node 18+), falls back to a timestamp + random suffix for the
 * unlikely environment where neither is present.
 */
function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// What useConversationMemory renders (via useSyncExternalStore): the same
// array until memories change, so React can compare snapshots by reference.
// Dropped on every write below and on writes from other tabs.
let snapshot: ConversationMemory[] | null = null;
const EMPTY: ConversationMemory[] = [];

if (typeof window !== 'undefined') {
  // Registered at load, before any component subscribes, so the snapshot is
  // already dropped when React re-reads it.
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY || e.key === null) snapshot = null;
  });
}

/** useSyncExternalStore snapshot: memories, newest first. */
export function getMemoriesSnapshot(): ConversationMemory[] {
  return (snapshot ??= listMemories());
}

/** useSyncExternalStore server snapshot: storage isn't readable there. */
export function getServerMemoriesSnapshot(): ConversationMemory[] {
  return EMPTY;
}

/** useSyncExternalStore subscribe: this tab's changes and other tabs'. */
export function subscribeMemories(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    snapshot = null;
    onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function emitChange(): void {
  snapshot = null;
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // CustomEvent unsupported — silently ignore.
  }
}

function readAll(): ConversationMemory[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: verify each entry has the expected shape before trusting it.
    return parsed.filter(
      (m): m is ConversationMemory =>
        m &&
        typeof m === 'object' &&
        typeof m.id === 'string' &&
        typeof m.summary === 'string' &&
        typeof m.timestamp === 'number' &&
        typeof m.personalityId === 'string' &&
        typeof m.messageCount === 'number' &&
        (m.sessionId === undefined || typeof m.sessionId === 'string')
    );
  } catch {
    return [];
  }
}

function writeAll(memories: ConversationMemory[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep newest first; cap at MAX_MEMORIES so localStorage stays bounded.
    const trimmed = memories.slice(0, MAX_MEMORIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage unavailable — drop silently.
  }
}

/** Returns memories, newest first. */
export function listMemories(): ConversationMemory[] {
  return readAll().sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Add a new memory. Returns the created entry. Trims the list so the
 * oldest memories beyond MAX_MEMORIES are pruned automatically.
 *
 * Empty/whitespace-only summaries are rejected (returns a memory with the
 * empty string preserved, but won't be persisted) — callers should validate
 * upstream, but this is a safety net.
 */
export function addMemory(
  mem: Omit<ConversationMemory, 'id' | 'timestamp'>
): ConversationMemory {
  const entry: ConversationMemory = {
    id: generateId(),
    summary: mem.summary,
    timestamp: Date.now(),
    personalityId: mem.personalityId,
    messageCount: mem.messageCount,
  };
  if (!entry.summary || !entry.summary.trim()) return entry;

  const all = readAll();
  // Prepend (newest first); cap at MAX_MEMORIES.
  const next = [entry, ...all].slice(0, MAX_MEMORIES);
  writeAll(next);
  emitChange();
  return entry;
}

/** The summary of one conversation, if it has one yet. */
export function getSessionMemory(sessionId: string): ConversationMemory | null {
  return readAll().find(m => m.sessionId === sessionId) ?? null;
}

/**
 * Add or replace the summary of one conversation. A conversation is
 * summarized again as it goes on; replacing keeps it to ONE entry (moved to
 * the top, since its timestamp is now) instead of one per update.
 */
export function upsertSessionMemory(
  sessionId: string,
  mem: Omit<ConversationMemory, 'id' | 'timestamp' | 'sessionId'>
): ConversationMemory | null {
  if (!mem.summary || !mem.summary.trim()) return null;
  const all = readAll();
  const existing = all.find(m => m.sessionId === sessionId);
  const entry: ConversationMemory = {
    id: existing?.id ?? generateId(),
    summary: mem.summary,
    timestamp: Date.now(),
    personalityId: mem.personalityId,
    messageCount: mem.messageCount,
    sessionId,
  };
  const next = [entry, ...all.filter(m => m.id !== entry.id)]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_MEMORIES);
  writeAll(next);
  emitChange();
  return entry;
}

// Date.now() of the last removal in this tab. A /api/remember answer already
// on its way was asked to build on the removed summary and must not bring
// it back (useLongTermMemory). Its answer always lands in the tab that sent
// it, so in memory is enough.
let lastRemovalAt = 0;

/** True when a summary was removed (or all cleared) at or after `t`. */
export function wereMemoriesRemovedSince(t: number): boolean {
  return lastRemovalAt >= t;
}

/** Remove a memory by id. No-op if not present. */
export function removeMemory(id: string): void {
  const all = readAll();
  const next = all.filter(m => m.id !== id);
  if (next.length === all.length) return;
  lastRemovalAt = Date.now();
  writeAll(next);
  emitChange();
}

/** Wipe all memories. */
export function clearMemories(): void {
  if (typeof window === 'undefined') return;
  lastRemovalAt = Date.now();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
  emitChange();
}

/**
 * Render the last `limit` memories as a system-prompt-ready block.
 *
 * Returns an empty string when there are no memories so callers can do
 * unconditional concatenation:
 *
 *   const system = basePrompt + memoriesAsContext();
 *
 * Format includes a leading newline so it joins cleanly to whatever
 * precedes it, regardless of trailing-whitespace style.
 */
export function memoriesAsContext(limit: number = 3): string {
  const recent = listMemories().slice(0, Math.max(0, limit));
  if (recent.length === 0) return '';
  const lines = recent.map(m => `- ${m.summary}`).join('\n');
  return `\nRecent conversations we've had:\n${lines}\n`;
}
