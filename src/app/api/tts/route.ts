import { DEFAULT_VOICE_ID, VOICE_OPTIONS, ELEVENLABS_MODEL_ID, TTS_SETTINGS } from '@/lib/constants';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { text, voiceId }: { text: string; voiceId?: string } = await req.json();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
  }

  // Validate voice ID — only allow known voices
  const validIds = VOICE_OPTIONS.map(v => v.id) as readonly string[];
  const selectedVoice = voiceId && validIds.includes(voiceId) ? voiceId : DEFAULT_VOICE_ID;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice}`,
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
    return Response.json({ error: 'TTS generation failed' }, { status: 500 });
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache',
    },
  });
}
