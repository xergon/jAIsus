/**
 * User-created custom personalities.
 *
 * Lives alongside the 9 built-in personalities in `personalities.ts`. Users
 * design these in the PersonalityCreator UI. Stored in localStorage; up to
 * 20 personalities, ~2000 chars per prompt, defensively bounded so a poisoned
 * payload can't drive the chat route's input limit.
 *
 * The shape MIRRORS `Personality` from personalities.ts but adds an `isCustom`
 * marker so the UI can distinguish "ones you can edit/delete" from the
 * built-ins. Provider is locked to 'claude' — we don't expose Grok/DeepSeek
 * selection to user-authored prompts (they tend to be safer with Claude's
 * built-in guardrails).
 */
import type { Personality } from './personalities';

export interface CustomPersonality extends Personality {
  isCustom: true;
  /** When the user created or last edited this personality (ms since epoch). */
  updatedAt: number;
}

const STORAGE_KEY = 'jaisus-custom-personalities';
export const CUSTOM_CHANGED_EVENT = 'jaisus-custom-personalities-changed';

/** Caps that prevent unbounded prompts from inflating Anthropic input cost. */
export const LIMITS = {
  maxPersonalities: 20,
  maxNameLength: 50,
  maxDescLength: 120,
  maxPromptLength: 2000,
  maxTeachingPromptLength: 2000,
  /** Single grapheme cluster, but we don't enforce that strictly — JS string length is fine. */
  maxEmojiLength: 8,
};

/** ID prefix so we never collide with built-in IDs like 'mushroom-guru'. */
const ID_PREFIX = 'custom-';

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return ID_PREFIX + crypto.randomUUID();
  }
  return ID_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(CUSTOM_CHANGED_EVENT));
  } catch {
    // CustomEvent unsupported — silently ignore.
  }
}

/** Read raw — does NOT validate beyond Array.isArray. Most consumers want listCustomPersonalities(). */
function readAll(): CustomPersonality[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidCustomPersonality);
  } catch {
    return [];
  }
}

function writeAll(list: CustomPersonality[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, LIMITS.maxPersonalities)));
    emitChange();
    return true;
  } catch {
    // Quota or private-mode storage — surface to caller.
    return false;
  }
}

function isValidCustomPersonality(value: unknown): value is CustomPersonality {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === 'string' && p.id.startsWith(ID_PREFIX) &&
    typeof p.name === 'string' && p.name.length > 0 && p.name.length <= LIMITS.maxNameLength &&
    typeof p.desc === 'string' && p.desc.length <= LIMITS.maxDescLength &&
    typeof p.emoji === 'string' && p.emoji.length > 0 && p.emoji.length <= LIMITS.maxEmojiLength &&
    typeof p.voiceId === 'string' && p.voiceId.length > 0 &&
    p.provider === 'claude' &&
    typeof p.systemPrompt === 'string' && p.systemPrompt.length > 0 &&
    typeof p.teachingPrompt === 'string' &&
    typeof p.updatedAt === 'number' &&
    p.isCustom === true
  );
}

export function listCustomPersonalities(): CustomPersonality[] {
  // Newest first so the creator's most recent shows up at the top.
  return [...readAll()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getCustomPersonality(id: string): CustomPersonality | null {
  return readAll().find(p => p.id === id) ?? null;
}

export interface PersonalityDraft {
  /** Pass an existing id to update; omit to create. */
  id?: string;
  name: string;
  desc: string;
  emoji: string;
  voiceId: string;
  systemPrompt: string;
  /** Optional — if omitted, we generate a small "teach me about X" wrapper. */
  teachingPrompt?: string;
}

export interface CreateResult {
  ok: boolean;
  /** Present on success. */
  personality?: CustomPersonality;
  /** Present on failure — a short, user-friendly message. */
  error?: string;
}

/** Clamp + validate + persist. Returns the saved CustomPersonality or an error. */
export function saveCustomPersonality(draft: PersonalityDraft): CreateResult {
  const name = (draft.name ?? '').trim().slice(0, LIMITS.maxNameLength);
  const desc = (draft.desc ?? '').trim().slice(0, LIMITS.maxDescLength);
  const emoji = (draft.emoji ?? '').trim().slice(0, LIMITS.maxEmojiLength);
  const voiceId = (draft.voiceId ?? '').trim();
  const systemPrompt = (draft.systemPrompt ?? '').trim().slice(0, LIMITS.maxPromptLength);
  const teachingPrompt = (draft.teachingPrompt ?? `You ARE jAIsus, generating a 2-3 minute spoken teaching. ${systemPrompt}\n\nDeliver the teaching with the same voice and character.`).slice(0, LIMITS.maxTeachingPromptLength);

  if (!name) return { ok: false, error: 'Name is required.' };
  if (!emoji) return { ok: false, error: 'Pick an emoji.' };
  if (!voiceId) return { ok: false, error: 'Pick a voice.' };
  if (systemPrompt.length < 40) return { ok: false, error: 'System prompt needs at least 40 characters so jAIsus has something to work with.' };

  const list = readAll();
  const now = Date.now();

  let updated: CustomPersonality;
  if (draft.id) {
    // Edit
    const existing = list.find(p => p.id === draft.id);
    if (!existing) return { ok: false, error: 'Personality not found — it may have been deleted on another tab.' };
    updated = { ...existing, name, desc, emoji, voiceId, systemPrompt, teachingPrompt, updatedAt: now };
    const idx = list.findIndex(p => p.id === draft.id);
    list[idx] = updated;
  } else {
    // Create
    if (list.length >= LIMITS.maxPersonalities) {
      return { ok: false, error: `You can save up to ${LIMITS.maxPersonalities} personalities. Remove an old one first.` };
    }
    updated = {
      id: newId(),
      name,
      desc,
      emoji,
      voiceId,
      provider: 'claude',
      systemPrompt,
      teachingPrompt,
      isCustom: true,
      updatedAt: now,
    };
    list.push(updated);
  }

  if (!writeAll(list)) {
    return { ok: false, error: "Couldn't save — your browser storage might be full." };
  }
  return { ok: true, personality: updated };
}

export function deleteCustomPersonality(id: string): boolean {
  const list = readAll();
  const next = list.filter(p => p.id !== id);
  if (next.length === list.length) return false;
  return writeAll(next);
}

export function isCustomId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(ID_PREFIX);
}
