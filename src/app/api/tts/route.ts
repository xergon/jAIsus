import { ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL_ID, TTS_SETTINGS } from '@/lib/constants';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { text }: { text: string } = await req.json();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: TTS_SETTINGS,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('ElevenLabs error:', response.status, error);
    return Response.json({
      error: 'TTS generation failed',
      status: response.status,
      detail: error.slice(0, 200),
      keyPresent: !!apiKey,
      keyPrefix: apiKey.slice(0, 6),
    }, { status: 500 });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
}
