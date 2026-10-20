'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  type Favorite,
  type FavoriteToggleResult,
  favoriteId,
  getFavoritesSnapshot,
  getServerFavoritesSnapshot,
  isFavorite as isFavoriteId,
  subscribeFavorites,
  toggleFavorite,
  toggleFavoriteResult,
} from '@/lib/favorites';

/**
 * React hook over the favorites lib.
 *
 * - `favorites` is empty during SSR and the hydration render (server
 *   snapshot), then follows localStorage — no hydration mismatch.
 * - Subscribes to the `jaisus-favorites-changed` window event so all mounted
 *   instances stay in sync after a mutation anywhere in the tree.
 * - Also listens to the cross-tab `storage` event so changes in another tab
 *   are reflected here too.
 */
export function useFavorites() {
  const favorites = useSyncExternalStore(
    subscribeFavorites,
    getFavoritesSnapshot,
    getServerFavoritesSnapshot
  );

  /** Synchronous check derived from current state — no storage read. */
  const isFavorited = useCallback(
    (kind: Favorite['kind'], content: string): boolean => {
      const id = favoriteId(kind, content);
      // Prefer in-memory state (cheap, matches what UI just rendered),
      // fall back to the lib (handles the brief pre-hydration window).
      if (favorites.length > 0) return favorites.some(f => f.id === id);
      return isFavoriteId(id);
    },
    [favorites]
  );

  /** Wraps lib's toggleFavorite. The change event it dispatches updates
   *  `favorites` synchronously. Prefer `toggleWithStatus`, which also
   *  reports a failed write. */
  const toggle = useCallback(
    (payload: Omit<Favorite, 'id' | 'createdAt'>): Favorite | null =>
      toggleFavorite(payload),
    []
  );

  /** Toggle and report 'added' / 'removed' / 'failed' (storage full or
   *  blocked), so callers only confirm a save that happened. */
  const toggleWithStatus = useCallback(
    (payload: Omit<Favorite, 'id' | 'createdAt'>): FavoriteToggleResult =>
      toggleFavoriteResult(payload),
    []
  );

  return { favorites, isFavorited, toggle, toggleWithStatus };
}
