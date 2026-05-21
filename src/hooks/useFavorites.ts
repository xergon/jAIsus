'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  type Favorite,
  favoriteId,
  isFavorite as isFavoriteId,
  listFavorites,
  toggleFavorite,
} from '@/lib/favorites';

const CHANGE_EVENT = 'jaisus-favorites-changed';

/**
 * React hook over the favorites lib.
 *
 * - `favorites` is empty during SSR and on first render; hydrated in an effect
 *   to avoid hydration mismatches.
 * - Subscribes to the `jaisus-favorites-changed` window event so all mounted
 *   instances stay in sync after a mutation anywhere in the tree.
 * - Also listens to the cross-tab `storage` event so changes in another tab
 *   are reflected here too.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  const refresh = useCallback(() => {
    setFavorites(listFavorites());
  }, []);

  useEffect(() => {
    // Initial hydrate after mount (avoids SSR mismatch).
    refresh();

    if (typeof window === 'undefined') return;

    const onChange = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jaisus-favorites' || e.key === null) refresh();
    };

    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

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

  /** Wraps lib's toggleFavorite and re-reads local state. */
  const toggle = useCallback(
    (payload: Omit<Favorite, 'id' | 'createdAt'>): Favorite | null => {
      const result = toggleFavorite(payload);
      // toggleFavorite already dispatches the change event, which our listener
      // picks up — but in the same tick the listener hasn't fired yet, so
      // refresh eagerly so the calling component sees the update immediately.
      refresh();
      return result;
    },
    [refresh]
  );

  return { favorites, isFavorited, toggle };
}
