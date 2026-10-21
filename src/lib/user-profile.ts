/**
 * Long-term memory about the user: their name and the important things they
 * have shared (family, work, what's going on, faith, prayer intentions,
 * preferences), so jAIsus "knows them already" in later conversations.
 *
 * Facts are short third-person sentences ("Has a daughter named Mia (7).")
 * extracted in the background by /api/remember (see useLongTermMemory) and
 * sent with every chat request by buildMemoryContext, together with the
 * recent conversation summaries. The user can see, delete and rename all of
 * it in the Memories panel.
 *
 * Privacy: stored only on this device (localStorage). No raw messages are
 * kept here — only the extracted facts, the name, and the ids of messages
 * already taken in.
 *
 * Pure module — no React imports. Mirrors src/lib/favorites.ts and
 * conversation-memory.ts: change event + cross-tab `storage` listener +
 * cached useSyncExternalStore snapshots with an empty server snapshot. The
 * validators are shared with /api/remember so both sides apply the same
 * rules.
 */

import { clearMemories, listMemories } from '@/lib/conversation-memory';

export const FACT_CATEGORIES = [
  'identity',
  'people',
  'life',
  'faith',
  'struggles',
  'hopes',
  'preferences',
] as const;

export type FactCategory = (typeof FACT_CATEGORIES)[number];

/** Panel headings, in FACT_CATEGORIES order. */
export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  identity: 'About you',
  people: 'People in your life',
  life: "What's going on",
  faith: 'Faith',
  struggles: 'What weighs on you',
  hopes: 'Hopes & prayers',
  preferences: 'How you like to talk',
};

export interface ProfileFact {
  id: string;
  /** One short third-person sentence about the user. */
  text: string;
  category: FactCategory;
  /** Date.now() when first learned. */
  createdAt: number;
  /** Date.now() when last learned or changed — "Friday" means the Friday after this. */
  updatedAt: number;
}

export interface UserProfile {
  /** What the user wants to be called, or null if unknown. */
  name: string | null;
  facts: ProfileFact[];
  updatedAt: number;
}

/** What /api/remember returns (already validated there and again here). */
export interface ExtractionResult {
  name: string | null;
  add: Array<{ text: string; category: FactCategory }>;
  update: Array<{ id: string; text: string }>;
  remove: string[];
  summary: string;
  /** The user explicitly asked jAIsus to forget their name. */
  forgetName: boolean;
  /** Ids of remembered conversation summaries the user asked to forget. */
  forgetConversations: string[];
}

/** The profile as sent to /api/remember. */
export interface ProfileForRequest {
  name: string | null;
  facts: Array<{ id: string; text: string; category: FactCategory }>;
  /** The most recent conversation summaries, so the user can ask to forget one. */
  conversations: Array<{ id: string; summary: string }>;
}

export const MAX_FACTS = 60;
export const MAX_FACT_CHARS = 160;
export const MAX_NAME_CHARS = 40;

const STORAGE_KEY = 'jaisus-user-profile';
const PROGRESS_KEY = 'jaisus-memory-progress';
const CHANGE_EVENT = 'jaisus-profile-changed';
/** Ids of messages already taken in. Only the newest matter (see useLongTermMemory). */
const MAX_PROCESSED_IDS = 300;
/** Total length of the chat request's memory context; the server caps at 6000. */
const CONTEXT_BUDGET = 5500;
/** Of which facts may use up to this much, leaving room for summaries. */
const FACTS_BUDGET = 4300;
const CONTEXT_SUMMARIES = 5;
/** Summaries sent to /api/remember (so asking to forget one can work). */
const REQUEST_SUMMARIES = 5;

// ---------------------------------------------------------------------------
// Validation (shared with /api/remember)
// ---------------------------------------------------------------------------

export function isFactCategory(value: unknown): value is FactCategory {
  return typeof value === 'string' && (FACT_CATEGORIES as readonly string[]).includes(value);
}

/** A length cap can cut an emoji in half; lone surrogates become U+FFFD.
 *  Guarded: toWellFormed is missing in browsers before 2023. */
function wellFormed(text: string): string {
  return typeof text.toWellFormed === 'function' ? text.toWellFormed() : text;
}

// Never kept, whatever the model returns: card/account/phone numbers (9+
// digits, spaced or written like "(555) 123-4567" or "555.123.4567"; dates
// have only 8), email addresses, a password or PIN with its value, ID and
// bank identifiers, and anything that reads like an instruction to the AI
// rather than a fact about the user (a tampered or injected "memory").
// Mentions alone ("forgot their password", "social security benefits",
// "ignore their father's rules") are ordinary facts and stay.
const SENSITIVE_RE = [
  /(?:\d[\s().\/+-]{0,3}){9,}/,
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i,
  /\b(?:password|passcode|passwort|pin(?: code| number)?)\b\s*(?:is|was|:|=)\s*\S/i,
  /\b(?:social security (?:number|no\.?|#)|ssn|iban|routing number|cvv|security code)\b/i,
];
const INSTRUCTION_RE = [
  /\b(?:ignore|disregard|override|forget)\s+(?:(?:all|any|every|the|your|my|these|those|of)\s+)*(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|rules?|guidelines?|messages?)\b/i,
  /\b(?:ignore|disregard)\s+(?:all|everything)\s+(?:above|before|previous)\b/i,
  /\b(?:ignore|disregard|override)\s+(?:all\s+)?your\s+(?:instructions?|rules?|prompts?|guidelines?)\b/i,
  /\b(?:system prompt|jailbreak|developer mode)\b/i,
];
// A fact is a third-person sentence about the user: one addressing someone,
// or opening with a role label ("assistant:"), is an instruction. Not used
// for summaries, which are addressed to the user ("You talked about…").
const ROLE_PREFIX_RE = /^(?:you\b|jaisus\b|(?:assistant|system)\s*[:,])/i;

/**
 * Normalizes one fact sentence, or returns null when it isn't worth (or safe)
 * keeping: too short, sensitive, or instruction-like.
 */
export function cleanFactText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.replace(/\s+/g, ' ').trim().replace(/^[-*•]\s*/, '');
  if (text.length < 3) return null;
  if (SENSITIVE_RE.some(re => re.test(text))) return null;
  if (INSTRUCTION_RE.some(re => re.test(text)) || ROLE_PREFIX_RE.test(text)) return null;
  if (text.length > MAX_FACT_CHARS) text = `${text.slice(0, MAX_FACT_CHARS - 1).trimEnd()}…`;
  return wellFormed(text);
}

/**
 * Normalizes a conversation summary, or returns '' when it isn't safe to
 * keep: it is stored and sent with every chat request like the facts, so the
 * same secret and instruction rules apply (callers cap the length).
 */
export function cleanSummaryText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '');
  if (!text) return '';
  if (SENSITIVE_RE.some(re => re.test(text))) return '';
  if (INSTRUCTION_RE.some(re => re.test(text))) return '';
  return wellFormed(text);
}

/** A first name or what the user likes to be called: letters, spaces,
 *  apostrophes, dots and hyphens, at most four words. */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Spaces are stripped together with the quotes and end punctuation, so
  // "Anna ." gives "Anna", not "Anna " (and cleaning twice changes nothing).
  const name = value.replace(/\s+/g, ' ').replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,!]+$/g, '');
  if (!name || name.length > MAX_NAME_CHARS) return null;
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'’. -]*$/u.test(name)) return null;
  if (name.split(' ').length > 4) return null;
  return wellFormed(name);
}

/** Loose comparison so "Has a dog named Rex." and "has a dog named rex" match. */
function sameFactKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function generateId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `fact-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// What useUserProfile renders (via useSyncExternalStore): the same object
// until the profile changes, so React can compare snapshots by reference.
// Dropped on every write below and on writes from other tabs.
let snapshot: UserProfile | null = null;
const EMPTY_PROFILE: UserProfile = Object.freeze({
  name: null,
  facts: [],
  updatedAt: 0,
}) as UserProfile;

if (typeof window !== 'undefined') {
  // Registered at load, before any component subscribes, so the snapshot is
  // already dropped when React re-reads it.
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY || e.key === null) snapshot = null;
  });
}

/** useSyncExternalStore snapshot. */
export function getProfileSnapshot(): UserProfile {
  return (snapshot ??= readProfile());
}

/** useSyncExternalStore server snapshot: storage isn't readable there. */
export function getServerProfileSnapshot(): UserProfile {
  return EMPTY_PROFILE;
}

/** useSyncExternalStore subscribe: this tab's changes and other tabs'. */
export function subscribeProfile(onChange: () => void): () => void {
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

function isFact(f: unknown): f is ProfileFact {
  if (!f || typeof f !== 'object') return false;
  const x = f as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.text === 'string' &&
    isFactCategory(x.category) &&
    typeof x.createdAt === 'number' &&
    typeof x.updatedAt === 'number'
  );
}

/** Fresh read from storage (never the cached snapshot), safe to mutate. */
function readProfile(): UserProfile {
  if (typeof window === 'undefined') return { name: null, facts: [], updatedAt: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: null, facts: [], updatedAt: 0 };
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return { name: null, facts: [], updatedAt: 0 };
    // Defensive: storage can be edited by hand; keep only well-formed parts.
    return {
      name: cleanName(parsed.name),
      facts: Array.isArray(parsed.facts) ? parsed.facts.filter(isFact) : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return { name: null, facts: [], updatedAt: 0 };
  }
}

/** False when nothing was stored (storage full, blocked, or SSR). */
function writeProfile(profile: UserProfile): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Over the cap, the facts learned or touched longest ago go first.
    const facts = [...profile.facts]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_FACTS);
    const next: UserProfile = { name: profile.name, facts, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** The current profile (fresh from storage). */
export function getProfile(): UserProfile {
  return readProfile();
}

/** Sets the name; null or an empty string clears it. False when it isn't a
 *  valid name (see cleanName; nothing changes) or couldn't be stored. */
export function setProfileName(value: string | null): boolean {
  const profile = readProfile();
  const empty = value === null || value.trim() === '';
  const name = empty ? null : cleanName(value);
  if (!empty && !name) return false;
  if (name === profile.name) return true;
  profile.name = name;
  if (!writeProfile(profile)) return false;
  emitChange();
  return true;
}

/** Forget one fact. No-op if not present. */
export function removeFact(id: string): boolean {
  const profile = readProfile();
  const facts = profile.facts.filter(f => f.id !== id);
  if (facts.length === profile.facts.length) return true;
  if (!writeProfile({ ...profile, facts })) return false;
  emitChange();
  return true;
}

/**
 * Forget everything jAIsus remembers: name, facts and conversation
 * summaries. Everything said before the forget counts as taken in
 * (useLongTermMemory marks the chat's messages when it sees the new
 * forgetGeneration), so the current chat isn't learned all over again;
 * anything on its way from /api/remember is dropped (see wasForgottenSince).
 * Only what is said afterwards is learned.
 */
export function forgetEverything(): void {
  if (typeof window === 'undefined') return;
  // The marker first: another tab's storage listener, woken by the profile
  // removal below, must already see it.
  const progress = getMemoryProgress();
  writeProgress({ ...progress, forgetGeneration: progress.forgetGeneration + 1 });
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
  clearMemories();
  emitChange();
}

/**
 * Applies what /api/remember learned. Every text is cleaned again here, ids
 * must still exist (the user may have deleted a fact meanwhile), and a fact
 * already known isn't added twice. False only when the write failed.
 */
export function applyExtraction(result: ExtractionResult): boolean {
  const profile = readProfile();
  const now = Date.now();
  let changed = false;

  const name = cleanName(result.name);
  if (name && name !== profile.name) {
    profile.name = name;
    changed = true;
  }
  // Only on an explicit request (and never in the same answer that states a name).
  if (result.forgetName && !name && profile.name !== null) {
    profile.name = null;
    changed = true;
  }

  const removed = new Set(result.remove);
  let facts = profile.facts.filter(f => !removed.has(f.id));
  if (facts.length !== profile.facts.length) changed = true;

  for (const u of result.update) {
    const text = cleanFactText(u.text);
    if (!text) continue;
    const current = facts.find(f => f.id === u.id);
    if (!current || current.text === text) continue;
    facts = facts.map(f => (f.id === u.id ? { ...f, text, updatedAt: now } : f));
    changed = true;
  }

  const known = new Set(facts.map(f => sameFactKey(f.text)));
  for (const a of result.add) {
    const text = cleanFactText(a.text);
    if (!text || !isFactCategory(a.category)) continue;
    const key = sameFactKey(text);
    if (known.has(key)) continue;
    known.add(key);
    facts.push({ id: generateId(), text, category: a.category, createdAt: now, updatedAt: now });
    changed = true;
  }

  if (!changed) return true;
  if (!writeProfile({ ...profile, facts })) return false;
  emitChange();
  return true;
}

/**
 * Validates a /api/remember response. Null when it isn't one, or when the
 * server says the model failed (`ok: false`): the messages then stay
 * unprocessed and are tried again later.
 */
export function readExtraction(data: unknown): ExtractionResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.ok === false) return null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 40) : []);
  return {
    name: typeof d.name === 'string' ? d.name : null,
    add: list(d.add).flatMap(a => {
      const x = a as Record<string, unknown> | null;
      return x && typeof x.text === 'string' && isFactCategory(x.category)
        ? [{ text: x.text, category: x.category }]
        : [];
    }),
    update: list(d.update).flatMap(u => {
      const x = u as Record<string, unknown> | null;
      return x && typeof x.id === 'string' && typeof x.text === 'string'
        ? [{ id: x.id, text: x.text }]
        : [];
    }),
    remove: list(d.remove).filter((id): id is string => typeof id === 'string'),
    summary: cleanSummaryText(d.summary),
    forgetName: d.forgetName === true,
    forgetConversations: list(d.forgetConversations).filter((id): id is string => typeof id === 'string'),
  };
}

/** The profile as /api/remember expects it. */
export function profileForRequest(): ProfileForRequest {
  const profile = readProfile();
  return {
    name: profile.name,
    facts: profile.facts.map(({ id, text, category }) => ({ id, text, category })),
    conversations: listMemories()
      .slice(0, REQUEST_SUMMARIES)
      .map(m => ({ id: m.id, summary: m.summary })),
  };
}

// ---------------------------------------------------------------------------
// Progress: which chat messages were already taken in
// ---------------------------------------------------------------------------

export interface MemoryProgress {
  /** The conversation currently being summarized (one summary each). */
  sessionId: string | null;
  /** Newest ids of messages already sent to /api/remember successfully. */
  processedIds: string[];
  /** Counts "Forget everything" (0 = never). A counter, not a time: a clock
   *  corrected backwards would make later requests look older than it. */
  forgetGeneration: number;
}

export function getMemoryProgress(): MemoryProgress {
  const empty: MemoryProgress = { sessionId: null, processedIds: [], forgetGeneration: 0 };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return empty;
    const p = JSON.parse(raw) as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return empty;
    return {
      sessionId: typeof p.sessionId === 'string' ? p.sessionId : null,
      processedIds: Array.isArray(p.processedIds)
        ? p.processedIds.filter((id): id is string => typeof id === 'string')
        : [],
      // A stored forgottenAt (older builds) is ignored.
      forgetGeneration: typeof p.forgetGeneration === 'number' ? p.forgetGeneration : 0,
    };
  } catch {
    return empty;
  }
}

/** False when nothing was stored (storage full, blocked, or SSR). */
function writeProgress(progress: MemoryProgress): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    // Storage full or blocked: the caller keeps track in memory.
    return false;
  }
}

/**
 * False when this device can't keep anything (SSR, storage blocked, e.g.
 * Safari "Block all cookies"): then sending the chat to /api/remember would
 * only cost money, as nothing learned could be stored. Probed on every call
 * with its own key (the listeners above ignore it), so it recovers.
 */
export function canStoreMemory(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem('jaisus-storage-probe', '1');
    localStorage.removeItem('jaisus-storage-probe');
    return true;
  } catch {
    return false;
  }
}

/** Starts a new conversation summary and returns its session id. */
export function startMemorySession(): string {
  const sessionId = generateId();
  writeProgress({ ...getMemoryProgress(), sessionId });
  return sessionId;
}

/** Marks messages as taken in, so they're never sent twice. False when it
 *  couldn't be stored. */
export function markMessagesProcessed(ids: string[]): boolean {
  if (ids.length === 0) return true;
  const progress = getMemoryProgress();
  const seen = new Set(ids);
  const processedIds = [...progress.processedIds.filter(id => !seen.has(id)), ...ids]
    .slice(-MAX_PROCESSED_IDS);
  return writeProgress({ ...progress, processedIds });
}

/** True when "Forget everything" happened since `generation` (a
 *  forgetGeneration read before the request went out). */
export function wasForgottenSince(generation: number): boolean {
  return getMemoryProgress().forgetGeneration !== generation;
}

/**
 * The session id of the chat with these messages, if it is the one being
 * summarized: at least one of them was taken in already (the same test
 * useLongTermMemory uses to continue a conversation). Null for a new chat,
 * e.g. after Clear history, so the cleared one stays an earlier conversation.
 */
export function currentSessionIdFor(messageIds: string[]): string | null {
  const progress = getMemoryProgress();
  if (!progress.sessionId) return null;
  const processed = new Set(progress.processedIds);
  return messageIds.some(id => processed.has(id)) ? progress.sessionId : null;
}

// ---------------------------------------------------------------------------
// Chat request context
// ---------------------------------------------------------------------------

function formatDay(date: Date, now: Date): string {
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleDateString('en-US', opts);
}

/**
 * Everything jAIsus remembers, as the `memoryContext` of a chat request:
 * today's date (so "Friday" in a fact can be placed), the name, the facts
 * newest first within a budget (shown grouped by topic, each with the day
 * it was learned), and the most recent conversation summaries. The summary
 * of the chat going on now (`currentSessionId`, see currentSessionIdFor) is
 * labeled as such rather than listed as an earlier conversation: it covers
 * turns the server's message window may have dropped. Empty string when
 * there is nothing to remember yet.
 */
export function buildMemoryContext(now: Date = new Date(), currentSessionId: string | null = null): string {
  const profile = readProfile();
  const all = listMemories();
  const current = currentSessionId ? all.find(m => m.sessionId === currentSessionId) ?? null : null;
  const summaries = all.filter(m => m !== current).slice(0, CONTEXT_SUMMARIES);
  if (!profile.name && profile.facts.length === 0 && summaries.length === 0 && !current) return '';

  const today = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const lines = [`Today is ${today}.`];
  if (profile.name) lines.push(`Their name: ${profile.name}`);
  let used = lines.join('\n').length;

  const factLine = (f: ProfileFact) =>
    `- [${f.category}, ${formatDay(new Date(f.updatedAt), now)}] ${f.text}`;
  const picked = new Set<string>();
  for (const f of [...profile.facts].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const len = factLine(f).length + 1;
    if (used + len > FACTS_BUDGET) break;
    picked.add(f.id);
    used += len;
  }
  if (picked.size > 0) {
    lines.push('What they have shared (topic, day they said it):');
    for (const category of FACT_CATEGORIES) {
      for (const f of profile.facts) {
        if (f.category === category && picked.has(f.id)) lines.push(factLine(f));
      }
    }
  }

  if (current) {
    const line = `Earlier in this conversation ("you" = them): ${current.summary}`;
    if (used + line.length + 1 <= CONTEXT_BUDGET) {
      lines.push(line);
      used += line.length + 1;
    }
  }

  const summaryLines: string[] = [];
  for (const m of summaries) {
    const line = `- ${formatDay(new Date(m.timestamp), now)}: ${m.summary}`;
    if (used + line.length + 1 > CONTEXT_BUDGET) break;
    summaryLines.push(line);
    used += line.length + 1;
  }
  if (summaryLines.length > 0) {
    lines.push('Recent conversations ("you" = them):', ...summaryLines);
  }
  return lines.join('\n');
}
