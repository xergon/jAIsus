/**
 * GET /api/push/send-daily
 *
 * Cron handler: fans out today's verse as a Web Push notification to every
 * subscribed device. Triggered by Vercel cron (see vercel.json).
 *
 * AUTHENTICATION
 * Vercel cron jobs include an `Authorization: Bearer ${CRON_SECRET}` header
 * automatically when CRON_SECRET is set in project env. We reject anything else
 * to keep the endpoint from being abused as a free notification spammer.
 *
 * IMPLEMENTATION CHOICE
 * The npm `web-push` library is NOT installed (it wasn't worth adding a 100KB
 * dep with native bindings for a tiny MVP). Instead we implement the bare
 * Web Push protocol directly using Node's `crypto` module:
 *
 *   1. Build a VAPID JWT (ES256 over P-256) for the Authorization header
 *   2. Encrypt the JSON payload using RFC 8291 (aes128gcm content-encoding)
 *      with HKDF + ECDH derived keys
 *   3. POST to the subscription endpoint with TTL/urgency headers
 *
 * If the push service returns 404 or 410, the subscription is gone — we drop
 * it from the store so we don't keep retrying. Other failures are counted
 * but left in place (transient network issues, throttling, etc).
 *
 * REQUIRED ENV VARS (set in Vercel dashboard):
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY  (also exposed to client)
 *   - VAPID_PRIVATE_KEY             (base64url, private half of P-256 keypair)
 *   - VAPID_SUBJECT                 (e.g. "mailto:hello@example.com")
 *   - CRON_SECRET                   (any random string; Vercel injects into cron header)
 *
 * Generate the VAPID keypair with `npx web-push generate-vapid-keys` (one-shot
 * via npx, no dep install needed) or with Node's `crypto.generateKeyPairSync`.
 */

import crypto from 'crypto';
import { getDailyVerse } from '@/lib/daily-verse';
import { listSubscriptions, removeSubscription } from '@/lib/push-server';

// Web Push fan-out can take a while if there are many subs; allow up to 60s.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// ---------- base64url helpers ----------

function b64urlEncode(buf: Buffer | Uint8Array): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  // Restore standard base64 padding
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

// ---------- VAPID JWT (ES256 / P-256) ----------

/**
 * Build a VAPID Authorization header value for a given push endpoint.
 *
 * Format: "vapid t=<JWT>, k=<base64url(public key)>"
 *
 * The JWT is signed with ES256 (ECDSA over P-256 with SHA-256). Audience is
 * the origin of the push endpoint; subject is our VAPID_SUBJECT (mailto:);
 * expiration is now + 12 hours (max allowed is 24).
 */
function buildVapidAuth(
  endpoint: string,
  publicKeyB64Url: string,
  privateKeyB64Url: string,
  subject: string
): string {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp, sub: subject };

  const signingInput =
    b64urlEncode(Buffer.from(JSON.stringify(header))) +
    '.' +
    b64urlEncode(Buffer.from(JSON.stringify(payload)));

  // Build a P-256 private key in JWK form. We have the public key (uncompressed
  // 65-byte: 0x04 || X(32) || Y(32)) and the private scalar d (32 bytes).
  const publicKey = b64urlDecode(publicKeyB64Url);
  const privateKey = b64urlDecode(privateKeyB64Url);
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('Invalid VAPID public key (expected 65-byte uncompressed P-256 point)');
  }
  if (privateKey.length !== 32) {
    throw new Error('Invalid VAPID private key (expected 32-byte P-256 scalar)');
  }
  const x = publicKey.subarray(1, 33);
  const y = publicKey.subarray(33, 65);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64urlEncode(x),
    y: b64urlEncode(y),
    d: b64urlEncode(privateKey),
  };
  const keyObject = crypto.createPrivateKey({ key: jwk, format: 'jwk' });

  // Node's sign() returns ASN.1 DER by default for ECDSA; we need raw r||s
  // (64 bytes) for JWS. dsaEncoding: 'ieee-p1363' yields exactly that.
  const signature = crypto.sign(
    'SHA256',
    Buffer.from(signingInput),
    { key: keyObject, dsaEncoding: 'ieee-p1363' }
  );

  const jwt = signingInput + '.' + b64urlEncode(signature);
  return `vapid t=${jwt}, k=${publicKeyB64Url}`;
}

// ---------- RFC 8291 payload encryption (aes128gcm content-encoding) ----------

/**
 * HKDF (RFC 5869) with SHA-256.
 */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  let okm = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  let counter = 1;
  while (okm.length < length) {
    prev = crypto
      .createHmac('sha256', prk)
      .update(Buffer.concat([prev, info, Buffer.from([counter])]))
      .digest();
    okm = Buffer.concat([okm, prev]);
    counter++;
  }
  return okm.subarray(0, length);
}

/**
 * Encrypt a payload for a single PushSubscription per RFC 8291 (aes128gcm).
 *
 * Returns the raw request body (header + ciphertext) the push service expects.
 * The body layout for aes128gcm:
 *   salt (16) || rs (4, big-endian) || idlen (1) || keyid (idlen) || ciphertext
 * Where keyid is our ephemeral ECDH public key (65 bytes, uncompressed).
 */
function encryptPayload(
  payload: Buffer,
  uaPublicKeyB64Url: string,
  authSecretB64Url: string
): Buffer {
  const uaPublicKey = b64urlDecode(uaPublicKeyB64Url);
  const authSecret = b64urlDecode(authSecretB64Url);

  if (uaPublicKey.length !== 65 || uaPublicKey[0] !== 0x04) {
    throw new Error('Invalid client public key');
  }

  // Ephemeral keypair (each push needs its own).
  const eph = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  // Build the uncompressed EC point from the JWK form (encoding-stable).
  // Previously this sliced the LAST 65 bytes off the SPKI DER, which worked
  // only because Node's current ASN.1 layout happens to end with the point.
  // Reconstructing from JWK x/y is portable across Node/OpenSSL versions
  // and matches the same approach already used for `uaKeyObject` below.
  const ephJwk = eph.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const ephPublicKey = Buffer.concat([
    Buffer.from([0x04]), // uncompressed-point prefix
    b64urlDecode(ephJwk.x),
    b64urlDecode(ephJwk.y),
  ]);
  if (ephPublicKey.length !== 65) {
    throw new Error('Unexpected ephemeral key length');
  }

  // ECDH shared secret. We compute IKM via diffieHellman with the UA key.
  const uaKeyObject = crypto.createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64urlEncode(uaPublicKey.subarray(1, 33)),
      y: b64urlEncode(uaPublicKey.subarray(33, 65)),
    },
    format: 'jwk',
  });
  const sharedSecret = crypto.diffieHellman({
    privateKey: eph.privateKey,
    publicKey: uaKeyObject,
  });

  // Random salt (16 bytes).
  const salt = crypto.randomBytes(16);

  // Step 1: PRK_key = HKDF(authSecret, sharedSecret, "WebPush: info\0" || uaPub || ephPub, 32)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublicKey,
    ephPublicKey,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  // Step 2: CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);

  // Step 3: NONCE = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Plaintext with single-record padding delimiter: payload || 0x02
  // (0x02 = last record in the aes128gcm content encoding)
  const plaintext = Buffer.concat([payload, Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // Record size = ciphertext length + 1 (delimiter)... but the field in the
  // header is the maximum record size the receiver should expect. Since we
  // send only one record containing everything, 4096 is the conventional
  // value (most push services accept this).
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);

  const idlen = Buffer.from([ephPublicKey.length]);

  return Buffer.concat([salt, rs, idlen, ephPublicKey, ciphertext]);
}

// ---------- Cron handler ----------

interface SendResult {
  sent: number;
  failed: number;
  removed: number;
}

export async function GET(req: Request) {
  // Vercel cron auth — FAIL CLOSED when the secret isn't configured.
  // Previously: `if (cronSecret)` skipped the check entirely when env var was
  // missing, leaving the route open to anyone (push fan-out / budget abuse).
  // Now: missing env var → 500 (deployment is misconfigured); wrong header → 401.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.VAPID_SUBJECT ?? '';

  if (!publicKey || !privateKey || !subject) {
    return new Response(
      JSON.stringify({
        error: 'Push not configured — set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const verse = getDailyVerse();
  const payload = Buffer.from(
    JSON.stringify({
      title: 'Today’s verse',
      body: `${verse.text} — ${verse.reference}`,
      url: '/',
    })
  );

  const subs = await listSubscriptions();
  const result: SendResult = { sent: 0, failed: 0, removed: 0 };

  // Fire requests in parallel — push services are happy with this and it keeps
  // us under the 60s function ceiling even with a few hundred subs.
  await Promise.all(
    subs.map(async (sub) => {
      if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        result.failed++;
        return;
      }
      try {
        const body = encryptPayload(payload, sub.keys.p256dh, sub.keys.auth);
        const authHeader = buildVapidAuth(sub.endpoint, publicKey, privateKey, subject);

        const res = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400', // 24h — push services drop after this if undelivered
            Urgency: 'normal',
          },
          body: body as unknown as BodyInit,
        });

        if (res.status === 201 || res.status === 202 || res.status === 200) {
          result.sent++;
          return;
        }
        // 404 / 410 = subscription expired or unsubscribed; drop it.
        if (res.status === 404 || res.status === 410) {
          await removeSubscription(sub.endpoint);
          result.removed++;
          return;
        }
        result.failed++;
      } catch {
        result.failed++;
      }
    })
  );

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST mirrors GET so manual triggers (curl) work for debugging.
export const POST = GET;
