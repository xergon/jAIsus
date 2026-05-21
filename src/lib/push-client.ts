/**
 * Client-side Web Push helpers.
 *
 * Wraps the browser PushManager API into a small, testable surface that the
 * NotificationOptInPrompt and usePushSubscription hook can call.
 *
 * Flow (happy path):
 *   1. requestPermissionAndSubscribe()
 *      -> Notification.requestPermission()
 *      -> navigator.serviceWorker.ready
 *      -> registration.pushManager.subscribe({ applicationServerKey: VAPID })
 *      -> POST /api/push/subscribe { subscription }
 *      -> resolve with the subscription object
 *
 * All functions are safe to call on the server (will short-circuit) — they
 * check for `window` / `navigator` first. None of them throw; failure is
 * communicated via the returned object.
 */
import { VAPID_PUBLIC_KEY } from '@/lib/push-keys';

/** True if the current browser supports the full Web Push stack we need. */
export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Current notification permission. Returns 'unsupported' if the browser
 * doesn't expose the Notification API at all (rather than misreporting it
 * as 'default').
 */
export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/** Returns the current PushSubscription if one already exists, else null. */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export interface SubscribeResult {
  ok: boolean;
  subscription?: PushSubscription;
  error?: string;
}

/**
 * Full opt-in flow: request permission, subscribe via the service worker,
 * and POST the subscription to the server.
 *
 * Returns `{ ok: false, error }` for any failure — never throws.
 */
export async function requestPermissionAndSubscribe(): Promise<SubscribeResult> {
  if (!isPushSupported()) {
    return { ok: false, error: 'Push not supported on this device' };
  }
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, error: 'Push not configured (missing VAPID key)' };
  }

  try {
    // 1. Permission. Calling on default/denied/granted is idempotent —
    //    once denied, this resolves immediately with 'denied'.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, error: `Permission ${permission}` };
    }

    // 2. Get (or wait for) the active service worker registration.
    const registration = await navigator.serviceWorker.ready;

    // 3. Check for an existing subscription; reuse if present and
    //    matches our current VAPID key, otherwise create a new one.
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    // 4. Tell the server. Best effort — if the POST fails we still hand
    //    the subscription back to the caller so the UI can reflect state.
    try {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
    } catch {
      // Network blip — server will get it on next subscribe attempt.
    }

    return { ok: true, subscription };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'subscribe failed';
    return { ok: false, error: msg };
  }
}

/**
 * Unsubscribe locally + tell the server to drop the endpoint.
 * Returns true if local unsubscribe succeeded.
 */
export async function unsubscribe(): Promise<boolean> {
  if (!isPushSupported()) return false;
  try {
    const subscription = await getCurrentSubscription();
    if (!subscription) return true; // already gone
    const endpoint = subscription.endpoint;
    const ok = await subscription.unsubscribe();
    if (ok) {
      // Best effort — server cleanup
      try {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        });
      } catch {
        // Server still has the stale endpoint, but next send will get a 410
        // and clean it up automatically.
      }
    }
    return ok;
  } catch {
    return false;
  }
}

/**
 * Decode a base64url-encoded VAPID public key into the Uint8Array that
 * PushManager.subscribe() expects as applicationServerKey.
 *
 * Standard helper from the Web Push spec — handles the base64url -> base64
 * conversion (replaces -/_ with +/, pads with =) and decodes into bytes.
 */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}
