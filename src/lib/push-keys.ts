/**
 * VAPID public key — exposed to the client so it can build a PushSubscription.
 *
 * Web Push requires the browser to know an application server's public key
 * (the "applicationServerKey" passed to PushManager.subscribe()). This is
 * NOT a secret. The matching private key stays on the server (VAPID_PRIVATE_KEY)
 * and is used to sign push requests.
 *
 * Required env vars for the full push flow:
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY  (this file — base64url, ~87 chars)
 *   - VAPID_PRIVATE_KEY             (server only — base64url, ~43 chars)
 *   - VAPID_SUBJECT                 (server only — e.g. "mailto:you@example.com")
 *   - CRON_SECRET                   (server only — Vercel injects on cron calls)
 *
 * Generate a keypair with:
 *   npx web-push generate-vapid-keys
 * Or in code using the Node `crypto` module (ECDSA P-256, base64url-encoded).
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
