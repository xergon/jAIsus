/**
 * Streak persistence + math.
 *
 * Pure module — no React imports. Backed by localStorage. Survives reloads.
 * `recordActivity` dispatches a `jaisus-streak-changed` CustomEvent on `window`
 * after a real state change so any subscribed hook/component can re-read.
 *
 * Calendar-day boundaries are local time, not UTC — a "day" should match
 * the user's wall clock, even across timezones.
 */

export interface StreakState {
  /** Current consecutive-day streak. */
  current: number;
  /** Longest streak ever achieved. */
  longest: number;
  /** Last active calendar date as 'YYYY-MM-DD' (local time). */
  lastActive: string | null;
  /** Total days user has ever been active. */
  totalDays: number;
}

const STORAGE_KEY = 'jaisus-streak';
const CHANGE_EVENT = 'jaisus-streak-changed';

const DEFAULT_STATE: StreakState = {
  current: 0,
  longest: 0,
  lastActive: null,
  totalDays: 0,
};

/**
 * Convert a Date to 'YYYY-MM-DD' in local time. Exported so tests and
 * components can format identically to what's persisted.
 */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse a 'YYYY-MM-DD' key into a Date at local midnight. Returns null if
 * the key is malformed.
 */
function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  // Local midnight — using the multi-arg Date constructor keeps it in local TZ.
  const d = new Date(year, month - 1, day);
  // Sanity check: constructor normalises out-of-range values, so verify round trip.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return d;
}

/**
 * Whole-calendar-day difference between two local-midnight Dates. Rounds to
 * the nearest integer so DST shifts (which add/remove an hour) don't fool us.
 */
function daysBetween(earlier: Date, later: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.round(ms / 86_400_000);
}

function isValidState(value: unknown): value is StreakState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.current === 'number' &&
    typeof v.longest === 'number' &&
    typeof v.totalDays === 'number' &&
    (v.lastActive === null || typeof v.lastActive === 'string')
  );
}

function readRaw(): StreakState {
  if (typeof window === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed: unknown = JSON.parse(raw);
    if (!isValidState(parsed)) return { ...DEFAULT_STATE };
    return {
      current: Math.max(0, Math.floor(parsed.current)),
      longest: Math.max(0, Math.floor(parsed.longest)),
      lastActive: parsed.lastActive,
      totalDays: Math.max(0, Math.floor(parsed.totalDays)),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeRaw(state: StreakState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage unavailable — drop silently.
  }
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // CustomEvent unsupported — silently ignore.
  }
}

/** Read current state. Always returns a valid StreakState (defaults to all-zero). */
export function getStreakState(): StreakState {
  return readRaw();
}

/**
 * Record a use of the app. Idempotent within a single calendar day.
 *
 * Logic:
 *  - If lastActive is today: no change.
 *  - If lastActive was yesterday: current += 1, longest = max(longest, current), totalDays += 1.
 *  - If lastActive was older OR null: current = 1, totalDays += 1.
 *  - In all "new day" cases, lastActive becomes today.
 *
 * Returns the updated state. Dispatches a 'jaisus-streak-changed' CustomEvent
 * on window after a real change.
 */
export function recordActivity(now?: Date): StreakState {
  const today = now ?? new Date();
  const todayKey = dateKey(today);
  const prev = readRaw();

  // Same-day re-entry — no-op, no event.
  if (prev.lastActive === todayKey) {
    return prev;
  }

  // Compute calendar-day gap from previous activity (if any).
  let gap = Infinity;
  if (prev.lastActive) {
    const lastMidnight = parseDateKey(prev.lastActive);
    const todayMidnight = parseDateKey(todayKey);
    if (lastMidnight && todayMidnight) {
      gap = daysBetween(lastMidnight, todayMidnight);
    }
  }

  let nextCurrent: number;
  if (gap === 1) {
    // Yesterday → extend the streak.
    nextCurrent = prev.current + 1;
  } else {
    // First-ever use, missed a day, or some weird non-positive gap (e.g.
    // user rolled their clock back). Treat as a fresh streak starting today.
    nextCurrent = 1;
  }

  const next: StreakState = {
    current: nextCurrent,
    longest: Math.max(prev.longest, nextCurrent),
    lastActive: todayKey,
    totalDays: prev.totalDays + 1,
  };

  writeRaw(next);
  emitChange();
  return next;
}

/** Clear all streak data (e.g. from Settings). */
export function clearStreak(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
  emitChange();
}
