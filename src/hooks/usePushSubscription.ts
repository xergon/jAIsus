'use client';

/**
 * React hook around the push-client lib.
 *
 * On mount: detects support, reads current permission, and probes for an
 * existing PushSubscription. Re-renders the caller as those values resolve.
 *
 * subscribe()/unsubscribe() are stable callbacks that update local state and
 * return the result so callers can react (e.g., dismiss a modal on success).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  getCurrentSubscription,
  getPermissionState,
  isPushSupported,
  requestPermissionAndSubscribe,
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

  // Initial probe — runs once after hydration so we don't desync SSR HTML.
  useEffect(() => {
    let cancelled = false;
    const supported = isPushSupported();
    setIsSupported(supported);
    setPermission(getPermissionState());

    if (!supported) return;

    (async () => {
      const sub = await getCurrentSubscription();
      if (!cancelled) setSubscription(sub);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    setError(null);
    const result = await requestPermissionAndSubscribe();
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
