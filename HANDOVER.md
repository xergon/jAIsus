# jAIsus — Complete Handover Document

**Last updated**: 2026-04-20
**Repo**: github.com/xergon/jAIsus
**Live**: https://jaisus.vercel.app
**Deploy**: Auto-deploy from `main` via Vercel (GitHub integration)

---

## What This Is

jAIsus is a mobile-first AI spiritual companion featuring an animated photorealistic Jesus with voice chat, camera vision, and multiple personalities. Users talk to Jesus via voice or text, and he responds with streaming TTS (ElevenLabs), emotional video reactions, and optional camera-awareness (he can "see" you and comment).

---

## Tech Stack

- **Framework**: Next.js 16.2.3 (BREAKING CHANGES from older versions — always check `node_modules/next/dist/docs/` before writing code)
- **React**: 19.2.4
- **AI SDK**: v6 (`ai` package) with `@ai-sdk/anthropic`, `@ai-sdk/xai`, `@ai-sdk/deepseek`
- **Vision**: Google Gemini 2.0 Flash (`@google/generative-ai`)
- **TTS**: ElevenLabs API (primary) + Web Speech API (fallback)
- **STT**: Web Speech API (browser native)
- **CSS**: Tailwind v4 via PostCSS
- **Deployment**: Vercel (auto-deploy on push to main)
- **Testing**: Playwright (E2E, mostly scaffolded)

---

## Environment Variables

### Local (`.env.local`)
```
ANTHROPIC_API_KEY=sk-ant-...        # Claude Haiku for nice personalities
ELEVENLABS_API_KEY=sk_...           # TTS voice synthesis
GEMINI_API_KEY=AIzaSy...            # Camera vision analysis
XAI_API_KEY=xai-...                 # Grok for Son of God personality (NOT in local yet)
DEEPSEEK_API_KEY=sk-...             # DeepSeek for unhinged personalities (NOT in local yet)
```

### Vercel Environment Variables (Production)
All of the above are set on Vercel. The vision route accepts BOTH `GOOGLE_API_KEY` and `GEMINI_API_KEY` (checks both).

**IMPORTANT**: If testing Grok/DeepSeek personalities locally, you MUST add `XAI_API_KEY` and `DEEPSEEK_API_KEY` to `.env.local`. Currently only Anthropic/ElevenLabs/Gemini keys are there.

---

## Architecture Overview

### Core Flow
```
User speaks → Web Speech API → text → /api/chat (streamed) → sentences queued → ElevenLabs TTS → audio playback
                                                                    ↓
                                                          [EMOTION:tag] parsed → video swap
```

### Camera/Vision Flow
```
Camera captures frame (every 10s) → /api/vision (Gemini) → scene description stored
                                                                    ↓
                                              Auto-vision ping sent every N seconds (default 30s)
                                              OR scene appended to regular chat context if <30s old
```

### Multi-Model Architecture
| Provider | Model | Used By | Why |
|----------|-------|---------|-----|
| Anthropic | claude-haiku-4-5-20251001 | Mushroom Guru, Gentle Shepherd | Kind, follows instructions well |
| xAI | grok-3-mini-fast | Son of God | Sarcastic/arrogant without refusing |
| DeepSeek | deepseek-chat | Anti-Jesus, Trump Jesus, Suffering Servant | No guardrails, plays unhinged characters |

**Selection logic** in `/api/chat/route.ts`:
```typescript
const model = personality.provider === 'deepseek'
  ? deepseek('deepseek-chat')
  : personality.provider === 'grok'
    ? xai('grok-3-mini-fast')
    : anthropic('claude-haiku-4-5-20251001');
```

---

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # Main chat — multi-model, vision-aware
│   │   ├── teachings/route.ts     # Teaching generation (Claude Sonnet)
│   │   ├── tts/route.ts           # ElevenLabs TTS wrapper
│   │   └── vision/route.ts        # Gemini vision frame analysis
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Entry → ChatInterface
│   └── globals.css                # Tailwind + custom animations
├── components/
│   ├── AnimatedJesus.tsx          # Dual-video engine with emotion swapping
│   ├── ChatInterface.tsx          # Main orchestrator (600+ lines)
│   ├── ChatMessage.tsx            # Message display
│   ├── HeroSection.tsx            # Jesus visual + voice visualizers
│   ├── ActionButtons.tsx          # Tab bar + feature buttons
│   ├── TeachingPlayer.tsx         # Teaching generator + player
│   ├── ParablesDrawer.tsx         # Parable browser
│   ├── PrayerRequestForm.tsx      # Prayer submission
│   ├── SettingsPanel.tsx          # All settings
│   └── VoiceButton.tsx            # Mic button
├── hooks/
│   ├── useCamera.ts              # Camera + Gemini vision loop
│   ├── useChatHistory.ts         # localStorage persistence
│   ├── useSpeechRecognition.ts   # STT
│   ├── useSpeechSynthesis.ts     # TTS with streaming queue
│   └── useVoiceState.ts          # State machine
├── lib/
│   ├── constants.ts              # Teaching topics, voice options
│   ├── emotions.ts               # Emotion→video mapping
│   ├── parables.ts               # 10 parables database
│   ├── personalities.ts          # 6 personalities with prompts
│   ├── system-prompt.ts          # Shared prompt rules
│   └── types.ts                  # TypeScript types
└── public/
    ├── jaisus-embraces.mp4       # Love/warmth emotion
    ├── jaisus-loves-you.mp4      # Encouragement
    ├── jaisus-prays.mp4          # Prayer/neutral
    ├── jAisus-angry.mp4          # Anger/disapproval
    ├── jAisus-suffers.mp4        # Sadness
    ├── jAisus-shakinghead.mp4    # Disapproval
    └── jAisus_thumps_up.mp4      # Encouragement/wonder
```

---

## Key Design Decisions & Patterns

### 1. `sendMessageRef` Pattern
The `useChat` hook returns a new `sendMessage` reference on every render. Using it as a dependency in `useEffect` or `setInterval` causes constant teardown/recreation. Solution:
```typescript
const sendMessageRef = useRef<any>(null);
useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
// In intervals/callbacks: sendMessageRef.current(...)
```

### 2. Content-Based TTS Dedup
AI SDK sometimes replaces message objects with new IDs (same content). Without dedup, TTS replays the whole message. Solution: `lastSpokenTextRef` tracks the last spoken text content — if same text arrives with new ID, skip.

### 3. Scene Freshness
Scene descriptions from Gemini can go stale (user moved). Only include in chat transport if timestamp is <30 seconds old:
```typescript
const isFresh = scene && sceneTimestampRef.current > 0 && age < 30000;
```

### 4. Vision Ping vs Regular Chat
Vision pings are auto-generated parenthetical messages like `(You just opened your eyes...)` or `(You notice the user is still at their desk...)`. Detected by:
```typescript
const isVisionPing = lastText.startsWith('(') && lastText.endsWith(')');
```
Vision pings get a completely different system prompt (force 1 sentence, max 60 tokens). Regular questions with camera just get a scene description appended to their personality prompt.

### 5. Dual-Video Engine (AnimatedJesus)
- Two `<video>` elements, only ONE decoder active at a time
- At 80% through current video, preload next video in hidden element
- When current ends (minus last 8 frames to avoid glitch), instant swap
- Emotion-driven: `EMOTION_VIDEO_MAP` maps emotions to preferred video files
- Fallback chain: videos → static image → canvas animation with particles

### 6. Audio Unlock Strategy
Mobile browsers block autoplay. Solution:
- Persistent `AudioContext` + reusable "warm" `<audio>` element
- On first user gesture (touch/click/key), play silence to unlock both paths
- All subsequent TTS reuses the unlocked element

### 7. Streaming TTS Sentence Queue
Instead of waiting for full AI response, sentences are queued for TTS as they arrive:
- Regex splits on `.!?` punctuation
- Long sentences (>120 chars) further split at commas/em-dashes
- Each chunk sent individually to ElevenLabs → played sequentially
- 30s safety timeout prevents infinite hangs

### 8. Emotion Tags
Every sentence from the AI is prefixed with `[EMOTION:tag]`. Tags are:
`love, warmth, prayer, anger, sadness, disapproval, encouragement, wonder, neutral`

Stripped before display/TTS. Used to drive video selection in AnimatedJesus.

---

## The 6 Personalities

| ID | Name | Emoji | Provider | Voice | Character |
|----|------|-------|----------|-------|-----------|
| `mushroom-guru` | Mushroom Guru | 🍄 | Claude | ErXwobaYiN019PkySvjV (Antoni) | Tipsy, trippy, deeply loving. Default. |
| `son-of-god` | Son of God | ⚡ | Grok | onwK4e9ZLuTAKqWW03F9 (Daniel) | Wrathful, arrogant, Old Testament tyrant |
| `gentle-shepherd` | Gentle Shepherd | 🐑 | Claude | 4QLC5fepxZkYmdD2IGRU | Traditional, kind, comforting |
| `suffering-servant` | Suffering Servant | 😩 | DeepSeek | D38z5RcWu1voky8WS1ja (Fin) | Depressive, whiny, Irish |
| `trump-jesus` | Trump Jesus | 🟠 | DeepSeek | pqHfZKP75CvOlQylNhV4 (Bill) | Trump speech patterns, MAGA messiah |
| `anti-jesus` | Anti-Jesus | 😈 | DeepSeek | N2lVS1w4EtoT3dr4eOWO (Callum II) | Blackout drunk roaster, zero filter |

---

## Known Issues & Gotchas

### Confirmed Issues
1. **First-load video distortion on mobile**: Sometimes the video appears distorted/black on first load. Workaround: multiple reveal event listeners + 3s timeout. May still happen occasionally.
2. **Grok refuses extreme evil**: Grok will play sarcastic/arrogant but refuses truly unhinged content (stops mid-sentence, says "I can't do that"). That's why Anti-Jesus/Trump/Suffering went to DeepSeek.
3. **TTS sentence skipping**: Long sentences could timeout (was 15s, now 30s). Also now splits long sentences at commas/em-dashes to keep chunks short.
4. **Local testing limited**: Without `XAI_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`, Grok/DeepSeek personalities will error silently.

### TypeScript Strict Mode
Vercel builds with strict TypeScript. Common issue: refs used inside nested functions lose their null narrowing. Always add `if (!ref)` guards inside closures that use refs.

### AI SDK v6 Specifics
- `useChat` returns `{ messages, sendMessage, status, setMessages }`
- `status` values: `'ready' | 'streaming' | 'error'`
- `UIMessage` has `.parts` array (not `.content` string)
- Parts are typed as a union — use `p.type === 'text'` filter before accessing `.text`
- Transport uses `body: () => ({...})` function for dynamic request bodies

### Next.js 16.2.3
- This is NOT standard Next.js from training data
- Check `node_modules/next/dist/docs/` for current API conventions
- Some APIs/conventions differ from Next.js 14/15

---

## Deployment

### Push to Deploy
```bash
git add . && git commit -m "message" && git push origin main
```
Vercel auto-deploys from `main`. Build takes ~45-60s. Check https://vercel.com/xergon/jaisus/deployments for status.

### Common Build Failures
1. TypeScript strict null errors (add guards)
2. ESLint `@typescript-eslint/no-explicit-any` (add `// eslint-disable-next-line` comments)
3. Missing imports when adding new providers

### Git Identity & Repo Location
The Mac user is `resorb` and the repo lives at:
```
/Users/resorb/Documents/Claude Sessions/Jaisus
```
Git commits show as `resorb <resorb@resorbs-MacBook-Pro.local>`. No global git identity configured.

To push from Cowork/Claude, use osascript:
```typescript
do shell script "cd '/Users/resorb/Documents/Claude Sessions/Jaisus' && git add ... && git commit -m '...' && git push origin main"
```

---

## Pending / Future Work

### High Priority
- [ ] Add XAI_API_KEY and DEEPSEEK_API_KEY to .env.local for local testing
- [ ] Find a Trump-like voice in ElevenLabs (current Bill voice is placeholder)
- [ ] Verify DeepSeek personalities work end-to-end on production
- [ ] Verify Grok Son of God doesn't refuse on production
- [ ] Better error handling when a provider's API key is missing (currently fails silently)

### Medium Priority
- [ ] Mobile video first-load reliability — investigate further
- [ ] Voice selection per personality — currently auto-switches but UI could be clearer
- [ ] Rate limiting on vision API calls (Gemini has quotas)
- [ ] Graceful fallback to Claude when Grok/DeepSeek errors

### Ideas / Backlog
- [ ] Community features (prayer wall, shared experiences)
- [ ] More video clips for richer emotion mapping
- [ ] Voice cloning for personality-specific voices
- [ ] PWA offline support
- [ ] Analytics / usage tracking
- [ ] More parables / teaching content
- [ ] User accounts / cloud persistence

---

## API Keys & Services

| Service | Key Env Var | Purpose | Dashboard |
|---------|-------------|---------|-----------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude Haiku chat | console.anthropic.com |
| ElevenLabs | `ELEVENLABS_API_KEY` | TTS voice synthesis | elevenlabs.io |
| Google/Gemini | `GEMINI_API_KEY` | Camera vision | aistudio.google.com |
| xAI | `XAI_API_KEY` | Grok chat | console.x.ai |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek chat | platform.deepseek.com |

---

## Critical Code Paths

### Chat Message Flow
1. User speaks/types → `ChatInterface` calls `sendMessage()`
2. Transport body function reads `personalityRef.current` and fresh `sceneDescription`
3. `/api/chat` selects model based on personality provider
4. Stream arrives → `messages` updates → streaming TTS useEffect fires
5. Sentences extracted via regex → `queueSentence()` called per chunk
6. `processQueue()` plays each chunk via ElevenLabs sequentially
7. Emotion tags parsed → `setCurrentEmotion()` → `AnimatedJesus` swaps video

### Camera Vision Flow
1. `useCamera` hook: `getUserMedia()` → video element → canvas capture every 10s
2. Frame sent as base64 to `/api/vision` → Gemini returns witty description
3. Description stored in `sceneDescription` state + `sceneTimestamp`
4. Auto-vision interval (default 30s): sends parenthetical ping to chat
5. Regular messages: if scene is <30s old, appended to system prompt

### Video Playback Flow
1. On mount: probe all 7 video files for availability
2. Available videos ordered per playlist
3. Active video plays → at 80%, preload next (emotion-driven selection)
4. At end (minus 8 frames), pause + instant swap to preloaded
5. Stall watchdog: if stuck >8s, force swap
6. Visibility API: pause when tab hidden, resume when visible

---

## Prompt Engineering Notes

### Shared Rules (ALL personalities)
- NO stage directions, asterisks, narration, scene-setting
- Every sentence MUST have `[EMOTION:tag]` prefix
- Output goes directly to TTS — if it sounds insane read aloud, cut it
- Forbidden: *smiles*, (softly), [nods], emotional labels

### Vision Ping Prompt (overrides personality)
Extremely constrained: ONE sentence, max 15 words, witty/cheeky. Examples provided in prompt. Max 60 output tokens.

### Regular Chat with Camera
Personality prompt + appended note: `[You can see the user right now: "{scene}" — briefly reference what you see, but focus on answering their question.]` Max 300 tokens.

### Teaching Prompt
Separate `teachingPrompt` per personality. 300-400 words, oral delivery style, structured in 4 parts. Uses Claude Sonnet (not Haiku) for higher quality.

---

## Running Locally

```bash
cd /path/to/jAIsus
npm install
npm run dev
# Open http://localhost:3000
```

Requires `.env.local` with at minimum `ANTHROPIC_API_KEY`. Other keys enable additional features:
- Without `ELEVENLABS_API_KEY`: falls back to browser TTS
- Without `GEMINI_API_KEY`: camera feature won't work
- Without `XAI_API_KEY`: Grok personalities error silently
- Without `DEEPSEEK_API_KEY`: DeepSeek personalities error silently
