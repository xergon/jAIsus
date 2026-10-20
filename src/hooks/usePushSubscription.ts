'use client';

/**
 * React hook around the push-client lib.
 *
 * On mount: detects support, reads current permission, and probes for an
 * existing PushSubscription. Re-renders the caller as those values resolve.
 * Also re-sends an existing subscription to the server (throttled; see
 * syncExistingSubscription) — NotificationOptInPrompt, and so this hook, is
 * mounted for the whole app session, so this runs once per app load.
 *
 * subscribe()/unsubscribe() are stable callbacks that update local state and
 * return the result so callers can react (e.g., dismiss a modal on success).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentSubscription,
  getPermissionState,
  isPushSupported,
  requestPermissionAndSubscribe,
  syncExistingSubscription,
  unsubscribe as unsubscribeLib,
  type SubscribeResult,
} from '@/lib/push-client';

export interface UsePushSubscriptionState {
  /** True once we've checked the environment — false during the initial SSR/first paint. */
  isSupported: boolean;
  /** Current notification permission, or 'unsupported' if the API isn't there. */
  permission: NotificationPermission | 'unsupported';
  /** The active PushSubscription, if the user is opted in. */
  subscription: PushSubscription | null;
  /** Last operation error, if any. Cleared on next subscribe/unsubscribe attempt. */
  error: string | null;
  /** Trigger the opt-in flow. Returns the SubscribeResult so callers can branch. */
  subscribe: () => Promise<SubscribeResult>;
  /** Unsubscribe locally + on the server. Returns true on success. */
  unsubscribe: () => Promise<boolean>;
}

export function usePushSubscription(): UsePushSubscriptionState {
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported'
  );
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Audit fix: track mount state so subscribe()/unsubscribe() resolving after
  // a parent unmount (e.g. modal closed while the browser permission prompt
  // is still open) don't call setState on a torn-down hook. Holding the
  // subscription object in a setState slot post-unmount also delays GC.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Initial probe — runs once after hydration so we don't desync SSR HTML.
  // State is set from the async probe (not synchronously in the effect body).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supported = isPushSupported();
      setIsSupported(supported);
      setPermission(getPermissionState());
      if (!supported) return;
      const sub = await getCurrentSubscription();
      if (!cancelled) setSubscription(sub);
      // A first POST that failed, or a store that lost it, heals here.
      if (sub) void syncExistingSubscription();
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    const result = await requestPermissionAndSubscribe();
    if (!mountedRef.current) return result;
    // Refresh derived state regardless of outcome — permission may have flipped
    // to 'denied' even if subscription didn't happen.
    setPermission(getPermissionState());
    if (result.ok && result.subscription) {
      setSubscription(result.subscription);
    } else if (result.error) {
      setError(result.error);
    }
    return result;
  }, []);

  const unsubscribe = useCallback(async () => {
    setError(null);
    const ok = await unsubscribeLib();
    if (!mountedRef.current) return ok;
    if (ok) setSubscription(null);
    return ok;
  }, []);

  return {
    isSupported,
    permission,
    subscription,
    error,
    subscribe,
    unsubscribe,
  };
}
