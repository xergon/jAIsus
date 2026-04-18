# jAIsus — Developer Handover

## What was just shipped (commit `8c168c2`)

**Gemini Vision Feature** — Jesus can now "see" the user through their camera and react to what he sees.

### Architecture

```
Camera (getUserMedia) → Canvas frame capture (every 5s) → /api/vision (Gemini 2.0 Flash) → sceneDescription → /api/chat (appended to system prompt) → Claude Haiku responds with awareness of what it sees
```

### New/Modified Files

| File | Status | Purpose |
|------|--------|---------|
| `src/app/api/vision/route.ts` | **NEW** | Receives base64 JPEG frame, sends to Gemini 2.0 Flash, returns scene description |
| `src/hooks/useCamera.ts` | **NEW** | Manages camera stream, captures frames every 5s to offscreen canvas (512px max, JPEG 0.7), sends to `/api/vision`, exposes `sceneDescription` |
| `src/app/api/chat/route.ts` | Modified | Accepts `sceneDescription` in request body, appends vision context to system prompt |
| `src/components/ChatInterface.tsx` | Modified | Integrates `useCamera` hook, camera toggle button with live preview, passes scene to chat via `DefaultChatTransport` `body` function |
| `package.json` | Modified | Added `@google/generative-ai` dependency |

### Before it works on Vercel

**You MUST add `GEMINI_API_KEY` to Vercel environment variables:**
1. Go to [Vercel Dashboard](https://vercel.com) → jAIsus project → Settings → Environment Variables
2. Add `GEMINI_API_KEY` with your Google AI Studio API key
3. Redeploy (or it picks up on next push)

Get a key at: https://aistudio.google.com/apikeys

### Key Technical Details

- **`DefaultChatTransport` body function**: The `body` option is typed as `Resolvable<object>` which means `() => object` is valid. We use this to dynamically include `sceneDescription` without re-creating the transport on every scene update. The scene is stored in a ref (`sceneRef`) and read at call time.

- **Frame capture pipeline**: `useCamera` creates an offscreen `<canvas>`, draws scaled video frames (max 512px), exports as JPEG at 0.7 quality. First capture after 1.5s warmup, then every 5s.

- **Vision prompt**: Gemini is told to be "the eyes of Jesus Christ" and describe the scene factually in 1-2 sentences (people, setting, vibe). No moralizing.

- **Chat integration**: When `sceneDescription` is present, it's appended to the system prompt as a `VISION` block. Claude is told to react naturally, like a friend who can see them, not robotically.

### Known Considerations

- **`body` as function**: Verified that `Resolvable<T> = MaybePromiseLike<T> | (() => MaybePromiseLike<T>)` in `@ai-sdk/provider-utils`. The function approach is correct and avoids re-creating the transport/chat instance on every scene update.

- **Camera on mobile**: Uses `facingMode: 'user'` (front camera). Should work on mobile Chrome/Safari with HTTPS (Vercel provides this).

- **Rate limiting**: Gemini Flash is called every 5s while camera is active. Monitor usage if many concurrent users.

---

## Existing Architecture (for reference)

### Core Flow
```
Voice Input (Web Speech API) → Chat (Claude Haiku via AI SDK) → Sentence-streaming TTS (ElevenLabs) → Emotion-matched video playback
```

### Key Files

| File | Purpose |
|------|---------|
| `src/components/ChatInterface.tsx` | Main chat UI, orchestrates voice → chat → TTS → video |
| `src/components/AnimatedJesus.tsx` | Dual-video emotion-matched playback engine |
| `src/components/HeroSection.tsx` | Hero layout with gradient overlay |
| `src/hooks/useSpeechRecognition.ts` | Web Speech API wrapper, `continuous=false`, `isFinal`-based + `onend` fallback |
| `src/hooks/useSpeechSynthesis.ts` | ElevenLabs TTS with sentence-queue streaming, warm Audio element |
| `src/hooks/useCamera.ts` | Camera + Gemini vision |
| `src/lib/system-prompt.ts` | Jesus character system prompt |
| `src/lib/emotions.ts` | `[EMOTION:tag]` parsing and video mapping |
| `src/lib/constants.ts` | Voice IDs, API config |
| `src/app/api/chat/route.ts` | Claude Haiku chat endpoint |
| `src/app/api/tts/route.ts` | ElevenLabs TTS proxy |
| `src/app/api/vision/route.ts` | Gemini vision endpoint |

### Important Patterns

- **Warm Audio**: A single `<audio>` element is created once and reused. Never clear `audio.src` — only overwrite it. This avoids Chrome autoplay policy issues.
- **Sentence-queue TTS**: AI response is streamed, sentences are extracted as they complete, queued for TTS. Set-based dedup (`queuedSentencesRef`) prevents repeats.
- **Emotion tags**: Claude emits `[EMOTION:joyful]` before sentences. These are parsed out before display/TTS and used to select the matching video clip.
- **Video playback**: `SKIP_END_SECONDS = 0.333` stops clips at 7s16f to avoid the last 8 frames (blending artifact). Dual `<video>` elements swap visibility for seamless transitions.
- **Speech recognition**: `continuous = false` is critical. `continuous = true` broke submission entirely because `onend` fired and cancelled the silence timer. Current approach: browser decides when utterance ends (`isFinal`), with `onend` fallback for cases where no final result is produced.

### Environment Variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude Haiku for chat |
| `ELEVENLABS_API_KEY` | TTS |
| `GEMINI_API_KEY` | **NEW** — Gemini Flash for camera vision |

### Deployment

- GitHub repo: `xergon/jAIsus`
- Auto-deploys to Vercel on push to `main`
- Mac local path: `/Users/resorb/Documents/Claude Sessions/Jaisus/`

### Default Voice

Antoni (`ErXwobaYiN019PkySvjV`) via ElevenLabs `eleven_flash_v2_5`
