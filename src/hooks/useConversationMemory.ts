'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  type ConversationMemory,
  addMemory,
  clearMemories as clearAllMemories,
  getMemoriesSnapshot,
  getServerMemoriesSnapshot,
  removeMemory as removeOneMemory,
  subscribeMemories,
} from '@/lib/conversation-memory';
import type { UIMessage } from 'ai';

/** Lower bounds for "worth summarizing" — skip trivial exchanges. */
const MIN_MESSAGES = 2;
const MIN_TOTAL_CHARS = 100;

interface UIMessagePartLike {
  type: string;
  text?: string;
}

/**
 * Extract plain text from a UIMessage's parts. Ignores file/tool/reasoning
 * parts entirely — only `type: 'text'` contributes.
 */
function extractText(msg: UIMessage): string {
  const parts = (msg.parts ?? []) as UIMessagePartLike[];
  return parts
    .filter(p => p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text as string)
    .join('');
}

/**
 * React hook over the conversation-memory lib.
 *
 * - `memories` is empty during SSR and the hydration render (server
 *   snapshot), then follows localStorage — no hydration mismatch.
 * - Subscribes to `jaisus-memories-changed` so all mounted instances stay
 *   in sync after a mutation anywhere in the tree.
 * - Also listens to the cross-tab `storage` event.
 *
 * `summarizeAndSave` is the workhorse: pass it the current UIMessages and
 * the active personality id, and it'll POST a stripped-down payload to
 * `/api/summarize`, then persist the returned one-sentence summary.
 * Errors are swallowed — this runs in the background at session-end and
 * we never want to interrupt the user with a failed background save.
 */
export function useConversationMemory() {
  const memories = useSyncExternalStore(
    subscribeMemories,
    getMemoriesSnapshot,
    getServerMemoriesSnapshot
  );

  const summarizeAndSave = useCallback(
    async (
      messages: UIMessage[],
      personalityId: string
    ): Promise<ConversationMemory | null> => {
      // Strip to {role, text} — privacy + payload size. Drop empty entries.
      const stripped = messages
        .map(m => ({ role: m.role as string, text: extractText(m) }))
        .filter(m => m.text.trim().length > 0);

      const totalChars = stripped.reduce((sum, m) => sum + m.text.length, 0);

      // Skip trivial conversations.
      if (stripped.length < MIN_MESSAGES || totalChars < MIN_TOTAL_CHARS) {
        return null;
      }

      try {
        const res = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: stripped }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { summary?: string };
        const summary = (data.summary ?? '').trim();
        if (!summary) return null;

        return addMemory({
          summary,
          personalityId,
          messageCount: stripped.length,
        });
      } catch {
        // Network error, JSON parse failure, etc. — silent no-op.
        return null;
      }
    },
    []
  );

  const removeMemory = useCallback((id: string) => {
    removeOneMemory(id);
  }, []);

  const clearMemories = useCallback(() => {
    clearAllMemories();
  }, []);

  return { memories, summarizeAndSave, removeMemory, clearMemories };
}
