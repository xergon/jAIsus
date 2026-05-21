/**
 * POST /api/memo
 *
 * Voice-memo processing pipeline:
 *   1. Receive a base64 audio blob (≤ ~5 MB → roughly 5 minutes at webm/opus 64 kbps).
 *   2. STT via Gemini 2.5 Flash multimodal — produces a verbatim transcript.
 *   3. Reflection via Claude Haiku — generates a 1-sentence summary, up to
 *      3 themes, and a warm 2-3 paragraph response in jAIsus's voice.
 *
 * Returns: { transcript, summary, themes, response }
 *
 * Rate-limited (6 memos / 10 min per IP) because each call is two LLM hops.
 * Server-side caps mirror the client lib so a poisoned client can't drive
 * up cost.
 */

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { clientKey, rateLimit, rateLimitResponse } from '@/lib/rate-limit';

export const maxDuration = 30;

// 6 memos burst, ~1 per 100s sustained — generous for normal use, costly
// enough to make a scripted attacker noisy.
const MEMO_LIMIT = { capacity: 6, refillRatePerSec: 1 / 100 };

// Hard caps mirror src/lib/voice-memos.ts MEMO_LIMITS.
const MAX_AUDIO_BASE64_LENGTH = 7_500_000; // ~5.6 MB binary = ~5 min webm/opus 64 kbps
const MAX_TRANSCRIPT_LENGTH = 5000;
const MAX_RESPONSE_LENGTH = 3000;
const MAX_SUMMARY_LENGTH = 240;
const MAX_THEMES = 3;

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
]);

interface MemoReflection {
  summary: string;
  themes: string[];
  response: string;
}

/** Strip the data URL prefix if present; tolerate missing-comma corner cases. */
function stripDataUrlPrefix(s: string): string {
  if (!s.includes(',')) return s;
  return s.split(',')[1] ?? '';
}

/** Strict-ish JSON extraction — finds the first {...} block in the model
 *  output. Claude tends to wrap structured output in prose unless told not to. */
function extractJsonObject<T = unknown>(text: string): T | null {
  // Try direct parse first
  try { return JSON.parse(text) as T; } catch { /* fall through */ }
  // Strip code-fence markers
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced && fenced[1]) {
    try { return JSON.parse(fenced[1]) as T; } catch { /* fall through */ }
  }
  // Find first {...} balanced
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { /* */ }
  }
  return null;
}

export async function POST(req: Request) {
  const rl = rateLimit(`memo:${clientKey(req)}`, MEMO_LIMIT);
  if (!rl.ok) return rateLimitResponse(rl);

  const geminiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return Response.json({ error: 'STT not configured' }, { status: 500 });
  }

  let body: { audioBase64?: unknown; mimeType?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body.audioBase64 !== 'string' || body.audioBase64.length === 0) {
    return Response.json({ error: 'audioBase64 required' }, { status: 400 });
  }
  if (body.audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
    return Response.json({ error: 'Audio too long — keep memos under 5 minutes.' }, { status: 413 });
  }
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
  // Normalize by stripping codec parameter for the allowlist check.
  const baseMime = mimeType.split(';')[0].trim();
  if (!ALLOWED_MIME.has(mimeType) && !ALLOWED_MIME.has(baseMime)) {
    return Response.json({ error: 'Unsupported audio format' }, { status: 415 });
  }

  const audioData = stripDataUrlPrefix(body.audioBase64);
  if (!audioData) {
    return Response.json({ error: 'Empty audio payload' }, { status: 400 });
  }

  // --- Step 1: STT via Gemini ---
  let transcript = '';
  try {
    const sttUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    const sttResp = await fetch(sttUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': geminiKey,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: 'Transcribe this audio verbatim. Output ONLY the spoken words, no commentary, no formatting, no speaker labels. Use natural punctuation.' },
            { inlineData: { mimeType: baseMime, data: audioData } },
          ],
        }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0 },
      }),
    });
    if (!sttResp.ok) {
      const errText = await sttResp.text();
      console.error('Memo STT failed:', sttResp.status, errText.slice(0, 200));
      return Response.json({ error: 'Could not transcribe audio' }, { status: 500 });
    }
    const sttData = await sttResp.json();
    transcript = String(sttData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
  } catch (err) {
    console.error('Memo STT error:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Could not transcribe audio' }, { status: 500 });
  }

  if (!transcript) {
    return Response.json({
      error: 'No speech detected — try moving closer to the mic or speaking up.',
    }, { status: 422 });
  }
  transcript = transcript.slice(0, MAX_TRANSCRIPT_LENGTH);

  // --- Step 2: Reflection via Claude Haiku ---
  let reflection: MemoReflection;
  try {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: `You are jAIsus reflecting back on a voice memo someone just recorded. Output STRICT JSON only — no preamble, no markdown fence, no commentary outside the object.

JSON shape:
{
  "summary": "ONE warm sentence (max 240 chars) capturing the emotional heart of what they said. Speak in second person ('You're carrying...'). Not a paraphrase of the words — the FEELING underneath.",
  "themes": ["theme1", "theme2", "theme3"],   // 1-3 single-word or short-phrase themes (e.g. "grief", "patience", "starting over"). Lowercase. No punctuation.
  "response": "Your reply, in jAIsus's voice. 2-3 paragraphs, warm, grounded in scripture/parables when natural. Speak directly to them. NO stage directions (no *smiles*, no asterisks). This will be read aloud via TTS so write in spoken cadence — short sentences, natural pauses via punctuation, no markdown."
}

CRITICAL: respond with VALID JSON only. If you violate the shape, the user sees an error.`,
      prompt: `Voice memo transcript:\n\n"""${transcript}"""\n\nReflect back as jAIsus.`,
      maxOutputTokens: 800,
    });
    const parsed = extractJsonObject<MemoReflection>(text);
    if (!parsed || typeof parsed.summary !== 'string' || typeof parsed.response !== 'string' || !Array.isArray(parsed.themes)) {
      // Defensive fallback so the user always gets SOMETHING usable even if
      // the model breaks JSON — they paid the STT cost already.
      reflection = {
        summary: 'Something stirred underneath what you said.',
        themes: ['reflection'],
        response: text.slice(0, MAX_RESPONSE_LENGTH) || 'I hear you. Let me sit with that for a moment, and we can come back to it together.',
      };
    } else {
      reflection = {
        summary: String(parsed.summary).slice(0, MAX_SUMMARY_LENGTH),
        themes: parsed.themes.slice(0, MAX_THEMES).map((t) => String(t).slice(0, 40)).filter(Boolean),
        response: String(parsed.response).slice(0, MAX_RESPONSE_LENGTH),
      };
    }
  } catch (err) {
    console.error('Memo reflection error:', err instanceof Error ? err.message : String(err));
    return Response.json({ error: 'Could not generate reflection' }, { status: 500 });
  }

  return Response.json({
    transcript,
    summary: reflection.summary,
    themes: reflection.themes,
    response: reflection.response,
  });
}
