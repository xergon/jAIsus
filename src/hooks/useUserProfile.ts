'use client';

import { useSyncExternalStore } from 'react';
import {
  type UserProfile,
  getProfileSnapshot,
  getServerProfileSnapshot,
  subscribeProfile,
} from '@/lib/user-profile';

/**
 * What jAIsus remembers about the user (name + facts), from the user-profile
 * lib. Empty during SSR and the hydration render (server snapshot), then
 * follows localStorage — no hydration mismatch. Updates after a change
 * anywhere in the tree or in another tab.
 */
export function useUserProfile(): UserProfile {
  return useSyncExternalStore(subscribeProfile, getProfileSnapshot, getServerProfileSnapshot);
}
