import { DEFAULT_VOICE_ID, VOICE_OPTIONS, VOICE_MODELS, ELEVENLABS_MODEL_ID, TTS_SETTINGS } from '@/lib/constants';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 30;

// TTS hits paid ElevenLabs per request. Cap to a generous-but-firm budget:
// 60-request burst, ~2/sec sustained. Streaming TTS chunks short sentences
// so legitimate use can spike, but anything beyond is abuse.
const TTS_LIMIT = { capacity: 60, refillRatePerSec: 2 };

// ElevenLabs bills per character, and the request limit alone still let one
// IP send 60 x 1500 characters at once and ~3000/s after that. This second
// bucket meters characters: 6000 at once, 100/s after (speech plays at
// ~15/s per listener and the app fetches at most one chunk ahead, so this
// leaves room for several people behind one shared IP). Over the limit the
// client reads the rest of that reply with the browser voice.
const TTS_CHAR_LIMIT = { capacity: 6000, refillRatePerSec: 100 };

// Hard ceiling on per-request text. ElevenLabs charges per character, so
// truncating uninvited 100kb dumps prevents a single curl from draining budget.
const MAX_TTS_TEXT_LENGTH = 1500;

export async function POST(req: Request) {
  const rl = rateLimit(`tts:${clientKey(req)}`, TTS_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { text?: unknown; voiceId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Trim before checking — a single space is also "empty" for billing purposes
  // and shouldn't reach ElevenLabs.
  if (typeof body.text !== 'string' || body.text.trim().length === 0) {
    return Response.json({ error: 'text is required' }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
  }

  // Cap length to avoid budget drain. Truncate silently — the caller is the
  // app's own useSpeechSynthesis hook, which sends a sentence or a chunk of
  // ~220 characters at a time; this is a server-side safety net.
  const text = body.text.slice(0, MAX_TTS_TEXT_LENGTH);

  const charRl = rateLimit(`tts-chars:${clientKey(req)}`, TTS_CHAR_LIMIT, text.length);
  if (!charRl.ok) return rateLimitResponse(charRl);

  // Validate voice ID — only allow known voices
  const validIds = VOICE_OPTIONS.map(v => v.id) as readonly string[];
  const selectedVoice =
    typeof body.voiceId === 'string' && validIds.includes(body.voiceId)
      ? body.voiceId
      : DEFAULT_VOICE_ID;

  // Most voices run on the fast flash model; a few only sound right on another.
  const { modelId, settings } =
    VOICE_MODELS[selectedVoice] ?? { modelId: ELEVENLABS_MODEL_ID, settings: TTS_SETTINGS };

  // Audit fix: wire req.signal so closing the client mid-stream cancels the
  // upstream ElevenLabs request — they bill per character even after disconnect.
  let response: Response;
  try {
    response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: settings,
        }),
        signal: req.signal,
      }
    );
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      return new Response(null, { status: 499 }); // nginx-style client-closed-request
    }
    console.error('ElevenLabs fetch error:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'TTS generation failed' }, { status: 502 });
  }

  if (!response.ok) {
    const error = await response.text();
    console.error('ElevenLabs error:', response.status, error.slice(0, 200));
    return Response.json({ error: 'TTS generation failed' }, { status: 500 });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
}
