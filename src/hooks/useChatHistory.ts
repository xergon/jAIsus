'use client';

import { useCallback } from 'react';
import type { UIMessage } from 'ai';

const STORAGE_KEY = 'jaisus-chat-history';
const MAX_MESSAGES = 100;

/** Storage key, for following saves made in another tab. */
export const CHAT_HISTORY_KEY = STORAGE_KEY;

/** Dispatched on window after every save/clear; SearchPanel listens for it. */
const HISTORY_CHANGED_EVENT = 'jaisus-chat-history-changed';

export function useChatHistory() {
  const loadMessages = useCallback((): UIMessage[] => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const messages = JSON.parse(stored) as UIMessage[];
      return messages.slice(-MAX_MESSAGES);
    } catch {
      return [];
    }
  }, []);

  const saveMessages = useCallback((messages: UIMessage[]) => {
    if (typeof window === 'undefined') return;
    try {
      const json = JSON.stringify(messages.slice(-MAX_MESSAGES));
      // Unchanged (e.g. just loaded from another tab's save): writing it
      // again would only bounce a storage event back to that tab.
      if (localStorage.getItem(STORAGE_KEY) === json) return;
      localStorage.setItem(STORAGE_KEY, json);
      // Same-tab listeners (an open Search panel); `storage` only fires in other tabs.
      window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
    } catch {
      // Storage full or unavailable
    }
  }, []);

  const clearHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    // Audit fix: localStorage.removeItem can throw in private mode / under
    // quota errors — match the other handlers' guarded pattern so clearing
    // doesn't surface as an uncaught exception.
    try {
      localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
    } catch {
      // Storage unavailable
    }
  }, []);

  return { loadMessages, saveMessages, clearHistory };
}
