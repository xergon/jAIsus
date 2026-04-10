'use client';

import { useCallback } from 'react';
import type { UIMessage } from 'ai';

const STORAGE_KEY = 'jaisus-chat-history';
const MAX_MESSAGES = 100;

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
      const trimmed = messages.slice(-MAX_MESSAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // Storage full or unavailable
    }
  }, []);

  const clearHistory = useCallback(() => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { loadMessages, saveMessages, clearHistory };
}
