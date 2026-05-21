/**
 * Voice memos — long-form recorded reflections with a structured jAIsus reply.
 *
 * Saved client-side only. Each memo carries the transcript, the AI's
 * 1-sentence summary, 3 themes, and jAIsus's full voiced response.
 *
 * Storage policy: cap at 50 memos (FIFO eviction), transcript clamped to 5000
 * chars, response clamped to 3000 chars so a single poisoned write can't blow
 * localStorage quota.
 */

export interface VoiceMemo {
  id: string;
  /** When recorded (ms since epoch). */
  createdAt: number;
  /** Duration of the original recording in seconds (rounded). */
  durationSec: number;
  /** Verbatim transcription of the audio. */
  transcript: string;
  /** 1-sentence emotional summary jAIsus heard. */
  summary: string;
  /** Up to 3 themes touched. */
  themes: string[];
  /** jAIsus's structured response (will be played via TTS on demand). */
  response: string;
}

const STORAGE_KEY = 'jaisus-voice-memos';
export const MEMOS_CHANGED_EVENT = 'jaisus-voice-memos-changed';

export const MEMO_LIMITS = {
  maxMemos: 50,
  /** Server uses the same cap. ≈45 seconds of speech per 5000 chars. */
  maxTranscriptLength: 5000,
  maxResponseLength: 3000,
  maxSummaryLength: 240,
  maxThemes: 3,
  /** Maximum duration of a single recording in seconds. Enforced both
   *  client-side (stop after this) and server-side (reject if exceeded). */
  maxDurationSec: 300,
};

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(MEMOS_CHANGED_EVENT));
  } catch {
    /* CustomEvent unsupported — silently ignore. */
  }
}

function readAll(): VoiceMemo[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidMemo);
  } catch {
    return [];
  }
}

function writeAll(list: VoiceMemo[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // FIFO eviction: keep newest first; slice keeps the LAST maxMemos by
    // sorting newest-first then taking the head.
    const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt).slice(0, MEMO_LIMITS.maxMemos);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sorted));
    emitChange();
    return true;
  } catch {
    return false;
  }
}

function isValidMemo(value: unknown): value is VoiceMemo {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' && m.id.length > 0 &&
    typeof m.createdAt === 'number' && m.createdAt > 0 &&
    typeof m.durationSec === 'number' && m.durationSec >= 0 &&
    typeof m.transcript === 'string' &&
    typeof m.summary === 'string' &&
    Array.isArray(m.themes) && m.themes.every((t) => typeof t === 'string') &&
    typeof m.response === 'string'
  );
}

export function listVoiceMemos(): VoiceMemo[] {
  return readAll(); // already sorted newest-first by writeAll
}

export function getVoiceMemo(id: string): VoiceMemo | null {
  return readAll().find((m) => m.id === id) ?? null;
}

export interface SaveMemoInput {
  durationSec: number;
  transcript: string;
  summary: string;
  themes: string[];
  response: string;
}

export function saveVoiceMemo(input: SaveMemoInput): VoiceMemo | null {
  const memo: VoiceMemo = {
    id: makeId(),
    createdAt: Date.now(),
    durationSec: Math.max(0, Math.round(input.durationSec)),
    transcript: String(input.transcript).slice(0, MEMO_LIMITS.maxTranscriptLength),
    summary: String(input.summary).slice(0, MEMO_LIMITS.maxSummaryLength),
    themes: input.themes.slice(0, MEMO_LIMITS.maxThemes).map((t) => String(t).slice(0, 40)),
    response: String(input.response).slice(0, MEMO_LIMITS.maxResponseLength),
  };
  const list = readAll();
  list.unshift(memo);
  return writeAll(list) ? memo : null;
}

export function deleteVoiceMemo(id: string): boolean {
  const list = readAll();
  const next = list.filter((m) => m.id !== id);
  if (next.length === list.length) return false;
  return writeAll(next);
}

export function clearVoiceMemos(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    emitChange();
  } catch {
    /* ignore */
  }
}
