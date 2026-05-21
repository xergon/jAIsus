# jAIsus — Complete Handover Document

**Last updated**: 2026-04-26
**Repo**: github.com/xergon/jAIsus
**Live**: https://jaisus.vercel.app
**Deploy**: Auto-deploy from `main` via Vercel (GitHub integration)

---

## What This Is

jAIsus is a mobile-first AI spiritual companion featuring an animated photorealistic Jesus with voice chat, camera vision, and multiple personalities. Users talk to Jesus via voice or text, and he responds with streaming TTS (ElevenLabs), emotional video reactions, and optional camera-awareness (he can "see" you and comment).

In the last session the app grew from a single-screen voice app into a much richer companion: 50 parables, 9 personalities, 16 teaching topics, a daily verse + reflection, a daily act of kindness, time-aware greetings, suggested prompts, a favorites system, a share button, a toast system, first-run onboarding, an error boundary, server-side rate limiting, Anthropic prompt caching, and privacy-first analytics. Most of this is wired into one of two empty-state experiences (autoSpeak vs scroll), and accessible from the Saved/Settings/Parables/Teachings/Community/Prayer modals.

---

## Recent Additions (this session — Waves 1-5)

The app grew substantially in a multi-wave parallel-agent session. The headline expansions:

### Content (Wave 1)
- **Parables**: 15 → 50 (Hidden Treasure, Persistent Widow, Pearl of Great Price, Wedding Banquet, Wicked Tenants, ...)
- **Personalities**: 6 → 9. Added **Zen Jesus** 🧘‍♂️ (Claude, koan-like, present), **Surfer Jesus** 🏄 (Claude, salty optimistic Californian), **Therapist Jesus** 🪑 (Claude, Rogerian — asks more than answers). The kind ones are now ordered first in the `PERSONALITIES` array, then the wrathful/depressive/satirical/unhinged.
- **Teaching topics**: 8 → 16 (added peace, courage, joy, grief, identity, calling, surrender, friendship). Server allowlist in `/api/teachings/route.ts` was synced.

### New API routes (Wave 3)
- `/api/version` — returns the deployed Vercel commit SHA so the client can self-heal stale builds on iOS PWAs.
- `/api/daily` — returns today's verse (deterministic UTC day-of-year pick) and a one-sentence Claude-Haiku-generated reflection question. The LLM call is cached per-verse-id for 24h in a module-level `Map`, and the response is CDN-cached for an hour with SWR for a day.

### Server hardening (Wave 3)
- **Rate limiting**: token-bucket per-IP via the new `src/lib/rate-limit.ts`. Applied to `/api/chat` (30 burst, 1/s sustained), `/api/teachings` (5 burst, 1/min), `/api/daily` (60 burst, 10/min). Backed by an in-memory `Map` with a 10-minute cleanup interval. Adequate for a small personal app on Vercel Fluid Compute. Note: cold starts and multi-instance fanout can let users multiply their quota — when traffic warrants, swap for `@upstash/ratelimit`.
- **Prompt caching**: `/api/chat` now splits its system message into a cached personality prompt (`cache_control: { type: 'ephemeral' }`) and an uncached scene-context message. Anthropic re-serves cached personality tokens for ~5 minutes at ~10% the original cost. Only applied for Claude personalities, since Grok and DeepSeek don't support the cache directive.
- **Topic allowlist**: `/api/teachings` validates the `topic` body field against a hardcoded `Set` (mirrors `TEACHING_TOPICS` in client constants). Server is the source of truth.
- **Vision route hardening**: model corrected to `gemini-2.5-flash` (the older route used `gemini-3-flash-preview`, which doesn't exist), Google API key moved from URL query string to `x-goog-api-key` header so it doesn't leak into access logs / proxies / error traces, and Gemini error bodies are no longer leaked to clients.
- **Teachings model**: corrected to `claude-haiku-4-5-20251001` (was previously `claude-sonnet-4-6` which didn't exist — endpoint was broken).
- **TTS voice ID validation**: `/api/tts` now checks `voiceId` against the `VOICE_OPTIONS` allowlist; falls back to `DEFAULT_VOICE_ID` otherwise.

### New libs (Wave 3 + Wave 4)
All in `src/lib/`:
- `rate-limit.ts` — token-bucket per-IP, in-memory.
- `daily-verse.ts` — 63 verses, deterministic UTC day-of-year selection.
- `favorites.ts` — heart/save messages, teachings, verses, parables. localStorage-backed, 200-entry cap, deterministic IDs from `(kind, content)` so toggle is idempotent across reloads. Mutations dispatch a `jaisus-favorites-changed` CustomEvent so subscribed hooks update without prop-drilling.
- `toast.ts` — imperative `toast.success(...)` API. Decoupled from React: dispatches `jaisus-toast` / `jaisus-toast-dismiss` CustomEvents on `window`. Provider lives in `Toast.tsx` and is the sole listener. Safe to call from libs, hooks, async callbacks, anywhere.
- `onboarding.ts` — first-run flag persistence (`jaisus-onboarding-seen`). On read failure (private mode etc.) defaults to "already seen" so users aren't pestered.
- `analytics.ts` — privacy-first client-side event buffer. No PII, no content, no IPs, no UA fingerprinting. Batched via debounced timer; flushed via `sendBeacon` on `visibilitychange`/`pagehide`. Honors `navigator.doNotTrack === '1'`. No retries — lost is lost. Calls a `/api/analytics` endpoint that doesn't exist yet — failures are silent.
- `suggested-prompts.ts` — 30 curated starter chips across 6 categories. Day-of-year-deterministic round-robin so each day rotates a fresh set across categories.
- `greeting.ts` — time-of-day + day-of-week greeting candidate pool. 5 buckets (morning/afternoon/evening/night/late-night), 4 candidates per bucket, 7 sublines per candidate. Selection is `(dayOfYear + dayOfWeek) % pool.length`.
- `daily-kindness.ts` — 45 acts of kindness across 6 categories. Day-of-year selection with a prime offset (7) so the kindness cycle isn't in lockstep with the verse cycle.

### New hooks (Wave 2)
All in `src/hooks/`:
- `useFavorites.ts` — wraps the favorites lib. Hydrates after mount to avoid SSR mismatch. Subscribes to both the local `jaisus-favorites-changed` CustomEvent and the cross-tab `storage` event.
- `useHaptics.ts` — 8 named patterns (`tap`, `light`, `medium`, `heavy`, `success`, `warning`, `error`, `doubleTap`). Respects `prefers-reduced-motion`, persists user opt-out under `jaisus-haptics-enabled`. Also exports a low-level `triggerHaptic` for non-React callers.
- `useModalA11y.ts` — focus trap + iOS-safe body scroll lock (`position: fixed; top: -scrollY`) + Escape dismiss + focus restore. One hook, all five panels use it.

### New components (Wave 2 + 4)
All in `src/components/`:
- `ErrorBoundary.tsx` — class component, wraps `{children}` in `layout.tsx`. Warm fallback UI ("We hit a small bump.") with `Try again` (reset state) and `Reload` (window.location.reload). Does NOT catch async errors or event-handler throws — those must be caught locally and surfaced to state.
- `Toast.tsx` — `ToastProvider`. Top-center stack, max 3 visible, FIFO eviction, per-toast auto-dismiss timers tracked in a `Map`, slide-in/out transitions disabled when `prefers-reduced-motion`. Errors get `role="alert" aria-live="assertive"`, others get polite status.
- `Skeleton.tsx` — `Skeleton` (text/circle/rect variants), `SkeletonMessage` (mimics ChatMessage layout), `SkeletonCard` (rounded card). Inline keyframes for the shimmer, scoped via `data-jaisus-skeleton` attribute. Only `SkeletonCard` is currently wired (in `TeachingPlayer`); the others are general-purpose primitives.
- `EmptyState.tsx` — friendly empty state (icon + title + description + optional CTA). Used in `ParablesDrawer`, `TeachingPlayer`, `FavoritesPanel`.
- `OnboardingOverlay.tsx` — 4-slide first-run tour (Meet jAIsus → Tap the mic → He has many voices → Begin). Swipe left/right + skip + page indicators + `useModalA11y`. Shown on first mount when `hasSeenOnboarding()` is false; tap outside or tap last-slide CTA marks seen.
- `DailyVerse.tsx` — verse-of-the-day card in the empty state. Amber-themed, shows verse text + reference + theme chip.
- `DailyKindness.tsx` — act-of-kindness-of-the-day card. Teal-themed.
- `GreetingHeader.tsx` — time-aware welcome (mounted-only render to avoid LOCAL-time vs UTC SSR mismatch).
- `SuggestedPrompts.tsx` — horizontal scroll-snapping chip strip. Daily rotation across categories. On pick, fires `track('suggestion.picked')` + `sendMessage`.
- `FavoriteButton.tsx` — heart toggle on every assistant message. Off → on toasts; on → off stays silent (no spam on remove).
- `ShareButton.tsx` — Web Share API with clipboard fallback. Format varies by kind: verses get quotation + attribution, parables get a "From the {context}" preamble, others get a default footer. Stays quiet on user-cancelled share (AbortError).
- `FavoritesPanel.tsx` — slide-up sheet listing all favorites with relative dates, "ask again" link that re-sends the favorite to chat, double-tap-to-confirm clear-all.
- `PersonalitySwitcher.tsx` — top-of-screen horizontal chip strip for instant personality switching. Roving-tabindex radiogroup keyboard nav (Arrow/Home/End/Space/Enter), active chip auto-scrolls into view. Lives just under the hero.
- `VersionCheck.tsx` — polls `/api/version` on focus/visibilitychange (also a 5min interval). If buildId differs from the one baked into the page, hard-reloads to a cache-busted URL. Critical for iOS PWAs that aggressively cache HTML.
- `AnalyticsInit.tsx` — calls `initAnalytics()` and `track('app.boot')` once at app boot. Mounted in `layout.tsx`.
- `CommunityPlaceholder.tsx` — minimal "Coming Soon" sheet behind the Community action button.

### Mobile / leak fixes (no new files, important changes)
- **`AnimatedJesus.tsx`**: probe video decoder leak fixed (7 probe `<video>` elements now release their `src` + `.load()` as soon as `loadedmetadata` fires or errors; iOS caps active decoders at ~16 and often allows only 1, so leaking 7 could block real playback). Reveal logic now waits for `videoWidth > 0 && videoHeight > 0` plus a `requestAnimationFrame` to prevent Chrome's distorted first-frame flash. A 12-second safety with retries falls back to canvas if no dimensions ever materialise. Image probes also get their handlers nulled on unmount.
- **`useCamera.ts`**: rapid-toggle race fixed via a `generationRef` counter. `stopCamera()` bumps the generation; any in-flight `getUserMedia` that resolves into a stale generation immediately `getTracks().forEach(t => t.stop())` instead of installing the stream. Also skips vision when `document.hidden` so Gemini quota isn't burned while the tab is in the background.
- **`useSpeechSynthesis.ts`**: blob URL tracking via `Set<string>`. `stop()` revokes ALL outstanding URLs. Unmount cleanup hooked. Audio-unlock listeners use `{ once: true, capture: true, passive: true }` so they self-remove and don't leak across HMR reloads. `voiceschanged` listener now references a stable handler so cleanup actually detaches.
- **`ChatInterface.tsx`**: load-history race fixed with a `didLoadRef` once-only guard — previously the effect depended on `[loadMessages, setMessages]` which could re-fire and clobber in-flight messages with the stale localStorage snapshot. Saves are debounced (500ms during streaming, immediate flush on `status === 'ready'`). Onboarding overlay shown on first mount. Suggested prompts + Daily Verse + Daily Kindness + Greeting wired into the chat-mode empty state. Personality switcher chip strip lives just under the hero.

### Modal accessibility (Wave 2)
All 5 panels — `ParablesDrawer`, `PrayerRequestForm`, `TeachingPlayer`, `SettingsPanel`, `CommunityPlaceholder` (and the newer `FavoritesPanel`, `OnboardingOverlay`) — now use `useModalA11y`. That gives them: focus trap, iOS-safe body scroll lock, Escape dismissal, focus restore to the opener, `role="dialog" aria-modal="true"` for the dialog node, and a labelled heading via `aria-labelledby`.

### Type system
- `ActivePanel` now includes `'favorites'`.
- `Teaching` removed from `types.ts` (was unused).

### Cache / stale-build
- `next.config.ts` now sends `Cache-Control: no-store` on the root HTML route (was the longer redundant `no-cache, must-revalidate, max-age=0` directive — `no-store` implies all of those).
- `layout.tsx` preloads the first two hero videos with `<link rel="preload" as="video">` so the browser has them in cache before React hydrates — eliminates the "load twice to fix distortion" issue. Also sets `<meta http-equiv="Cache-Control">` etc. as defense-in-depth.
- `BUILD_ID` falls back to `'dev'` (was `Date.now()` — generated a fresh ID on each module load, which mismatched `/api/version`'s `'dev'` fallback and triggered an infinite reload loop locally).

### Removed (no longer in the tree)
- `Header.tsx` (was dead, zero importers)
- `VoiceVisualizer.tsx` (was dead, zero importers)
- `SYSTEM_PROMPT` export from `system-prompt.ts` (replaced by per-personality prompts; only `TEACHING_PROMPT` remains)
- `Teaching` type from `types.ts` (unused)

---

## Tech Stack

- **Framework**: Next.js 16.2.3 (BREAKING CHANGES from older versions — always check `node_modules/next/dist/docs/` before writing code)
- **React**: 19.2.4
- **AI SDK**: v6 (`ai` package) with `@ai-sdk/anthropic`, `@ai-sdk/xai`, `@ai-sdk/deepseek`
- **Vision**: Google Gemini 2.5 Flash (REST API, not SDK — sidesteps base64 encoding bugs)
- **TTS**: ElevenLabs API (primary) + Web Speech API (fallback)
- **STT**: Web Speech API (browser native, continuous mode with 2s silence timeout)
- **CSS**: Tailwind v4 via PostCSS
- **Deployment**: Vercel (auto-deploy on push to main)
- **Testing**: Playwright (E2E, mostly scaffolded)

---

## Environment Variables

### Local (`.env.local`)
```
ANTHROPIC_API_KEY=sk-ant-...        # Claude Haiku for kind personalities + teachings + daily reflection
ELEVENLABS_API_KEY=sk_...           # TTS voice synthesis
GEMINI_API_KEY=AIzaSy...            # Camera vision analysis (GOOGLE_API_KEY also accepted)
XAI_API_KEY=xai-...                 # Grok for Son of God personality (NOT in local .env.local yet!)
DEEPSEEK_API_KEY=sk-...             # DeepSeek for unhinged personalities (NOT in local .env.local yet!)
```

### Vercel Environment Variables (Production)
All five keys are set on Vercel. The vision route accepts BOTH `GOOGLE_API_KEY` and `GEMINI_API_KEY` (checks both).

**IMPORTANT**: If testing Grok/DeepSeek personalities locally, you MUST add `XAI_API_KEY` and `DEEPSEEK_API_KEY` to `.env.local`. Currently only Anthropic/ElevenLabs/Gemini keys are in local `.env.local`.

---

## Architecture Overview

### Core Flow
```
User speaks/types → Web Speech API or keyboard → text → /api/chat (streamed) → sentences queued → ElevenLabs TTS → audio playback
                                                                    ↓
                                                          [EMOTION:tag] parsed → video swap
```

### Camera/Vision Flow
```
Camera captures frame (every 10s) → /api/vision (Gemini) → scene description stored
                                                                    ↓
                                              Auto-vision ping fires via fast 2s tick
                                              (checks if N seconds elapsed since last ping)
                                              OR scene included in regular chat context
```

### Multi-Model Architecture
| Provider | Model | Used By | Why |
|----------|-------|---------|-----|
| Anthropic | claude-haiku-4-5-20251001 | Mushroom Guru, Gentle Shepherd, Zen Jesus, Surfer Jesus, Therapist Jesus | Kind/contemplative personalities + all teachings + daily reflection. Prompt caching applied. |
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
│   │   ├── chat/route.ts          # Multi-model chat with prompt caching + rate limit
│   │   ├── daily/route.ts         # Daily verse + Haiku-generated reflection (24h cache)
│   │   ├── teachings/route.ts     # Teaching generation (Haiku, topic allowlist, rate limit)
│   │   ├── tts/route.ts           # ElevenLabs TTS wrapper (voiceId allowlist)
│   │   ├── version/route.ts       # Returns deployed build ID for stale-build self-heal
│   │   └── vision/route.ts        # Gemini 2.5 Flash REST (key in header, no error leakage)
│   ├── layout.tsx                 # Root layout — VersionCheck, AnalyticsInit, ToastProvider, ErrorBoundary
│   ├── page.tsx                   # Entry → ChatInterface
│   └── globals.css                # Tailwind + custom animations
├── components/
│   ├── ActionButtons.tsx          # Tab bar + feature buttons (Saved, Community, Settings, Prayer, Parables, Teachings)
│   ├── AnalyticsInit.tsx          # Boots analytics + initial app.boot event
│   ├── AnimatedJesus.tsx          # Dual-video engine with emotion swapping, decoder-safe probes
│   ├── ChatInterface.tsx          # Main orchestrator (~680 lines)
│   ├── ChatMessage.tsx            # Message display with favorite + share buttons
│   ├── CommunityPlaceholder.tsx   # "Coming soon" placeholder sheet
│   ├── DailyKindness.tsx          # Act-of-kindness-of-the-day card
│   ├── DailyVerse.tsx             # Verse-of-the-day card
│   ├── EmptyState.tsx             # Friendly empty state (icon + title + description + CTA)
│   ├── ErrorBoundary.tsx          # Class-based error boundary with warm fallback UI
│   ├── FavoriteButton.tsx         # Heart toggle on every message
│   ├── FavoritesPanel.tsx         # Slide-up sheet listing all favorites
│   ├── GreetingHeader.tsx         # Time-aware greeting (local time → UTC SSR guarded)
│   ├── HeroSection.tsx            # Jesus visual + voice visualizers
│   ├── OnboardingOverlay.tsx      # 4-slide first-run tour
│   ├── ParablesDrawer.tsx         # Parable browser (search + expand + Ask jAIsus)
│   ├── PersonalitySwitcher.tsx    # Horizontal chip strip below hero (9 personalities)
│   ├── PrayerRequestForm.tsx      # Prayer submission (localStorage)
│   ├── SettingsPanel.tsx          # All settings (personality, autoSpeak, vision interval, voice, clear history)
│   ├── ShareButton.tsx            # Web Share API + clipboard fallback
│   ├── Skeleton.tsx               # Shimmer placeholders (Skeleton + SkeletonMessage + SkeletonCard)
│   ├── SuggestedPrompts.tsx       # Daily rotating horizontal chip strip
│   ├── TeachingPlayer.tsx         # Teaching generator + player (topic chips + TTS)
│   ├── Toast.tsx                  # ToastProvider — top-center stack, max 3 visible
│   ├── VersionCheck.tsx           # Polls /api/version on focus, hard-reloads on mismatch
│   └── VoiceButton.tsx            # Mic button
├── hooks/
│   ├── useCamera.ts               # Camera + Gemini vision loop + generation-counter race guard
│   ├── useChatHistory.ts          # localStorage persistence (100-message cap)
│   ├── useFavorites.ts            # React wrapper over favorites lib + cross-tab sync
│   ├── useHaptics.ts              # 8 named patterns, prefers-reduced-motion, opt-out
│   ├── useModalA11y.ts            # Focus trap + scroll lock + Escape + focus restore
│   ├── useSpeechRecognition.ts    # STT — continuous mode, 2s silence timeout
│   ├── useSpeechSynthesis.ts      # TTS with streaming queue, blob URL leak tracking
│   └── useVoiceState.ts           # State machine (idle/listening/processing/speaking)
└── lib/
    ├── analytics.ts               # Privacy-first event buffer (sendBeacon-batched)
    ├── constants.ts               # 16 teaching topics, 12 voice options, ElevenLabs settings
    ├── daily-kindness.ts          # 45 kindness acts, day-of-year rotation
    ├── daily-verse.ts             # 63 verses, deterministic UTC day-of-year pick
    ├── emotions.ts                # Emotion→video mapping + alias table
    ├── favorites.ts               # localStorage + CustomEvent change-broadcast
    ├── greeting.ts                # Time-of-day + day-of-week greeting pool
    ├── onboarding.ts              # First-run flag persistence
    ├── parables.ts                # 50 parables database
    ├── personalities.ts           # 9 personalities with prompts + provider
    ├── rate-limit.ts              # Token-bucket per-IP
    ├── suggested-prompts.ts       # 30 curated chips, daily round-robin
    ├── system-prompt.ts           # TEACHING_PROMPT only (SYSTEM_PROMPT removed)
    ├── toast.ts                   # Imperative toast API (CustomEvent dispatcher)
    └── types.ts                   # ActivePanel, VoiceState, Parable, PrayerRequest
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

### 3. Vision: Always Send Latest Scene
The transport body always includes the latest `sceneDescription` if the camera is active — no freshness cutoff. Previous versions had a 30s freshness check that caused Jesus to miss scene changes when he was busy speaking.

### 4. Vision Ping vs Regular Chat
Vision pings are auto-generated parenthetical messages like `(You just opened your eyes...)`. Detected by:
```typescript
const isVisionPing = lastText.startsWith('(') && lastText.endsWith(')');
```
Vision pings get a completely different system prompt (force 1 sentence, max 15 words, 60 tokens) and skip prompt caching (cache would miss anyway). Regular questions with camera get the personality prompt (cached for Claude) plus a separate uncached scene context message.

### 5. Fast-Tick Auto-Vision
The auto-vision interval uses a 2-second tick that tracks `lastPingTime`. This means when jAIsus finishes speaking, within 2s it checks "has the configured interval elapsed?" and fires immediately if so. Previous approach: fixed 30s `setInterval` that skipped when speaking, causing up to 55s dead zones.

### 6. Dual-Video Engine (AnimatedJesus)
- Two `<video>` elements, only ONE decoder active at a time
- At 80% through current video, preload next video in hidden element
- When current ends (minus last 8 frames to avoid glitch), instant swap
- Emotion-driven: `EMOTION_VIDEO_MAP` maps emotions to preferred video files
- Fallback chain: videos → static image → canvas animation with particles
- **Video reveal**: waits for `videoWidth > 0` + `requestAnimationFrame` before making visible, preventing Chrome's distorted first-frame flash
- **Probe leak fix**: 7 probe `<video>` elements (one per file) release their `src` and `.load()` immediately after `loadedmetadata` fires (or errors). iOS caps active decoders at ~16 and often allows only 1, so leaking probes could block real playback.

### 7. Audio Unlock Strategy
Mobile browsers block autoplay. Solution:
- Persistent `AudioContext` + reusable "warm" `<audio>` element
- On first user gesture (touch/click/key), play silence to unlock both paths
- All subsequent TTS reuses the unlocked element
- Listeners use `{ once: true }` so they self-remove and don't leak across HMR

### 8. Streaming TTS Sentence Queue
Instead of waiting for full AI response, sentences are queued for TTS as they arrive:
- Regex splits on `.!?` punctuation
- Long sentences (>120 chars) further split at commas/em-dashes
- Each chunk sent individually to ElevenLabs → played sequentially
- 30s safety timeout prevents infinite hangs (was 15s, caused skipping)
- Blob URLs tracked in a `Set` and revoked on stop/unmount (preventing memory leaks)

### 9. Emotion Tags
Every sentence from the AI is prefixed with `[EMOTION:tag]`. Tags are:
`love, warmth, prayer, anger, sadness, disapproval, encouragement, wonder, neutral`

A second alias table maps natural variants (`angry`, `compassionate`, `tender`, ...) to the canonical 9. Stripped before display/TTS. Used to drive video selection in AnimatedJesus.

### 10. Speech Recognition — Continuous with Silence Timeout
Changed from `continuous = false` (browser decides end-of-speech, too aggressive) to `continuous = true` with a 2-second silence timeout. This prevents mid-sentence cutoffs when the user pauses briefly to think. The timeout submits accumulated text and stops recognition.

### 11. Text Input in AutoSpeak Mode
Both voice and keyboard input are available in autoSpeak mode. A text field sits above the floating buttons (mic, camera, settings, transcript). Text-submitted messages trigger the same TTS response pipeline as voice input because `autoSpeak` is `true`.

### 12. Anthropic Prompt Caching (NEW)
The chat route splits its system message into two parts:
```typescript
// Cached — personality prompt is stable across requests for a given personality.
{ role: 'system', content: personality.systemPrompt,
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } }
// Uncached — scene context varies per request.
{ role: 'system', content: `[You can see the user right now: "${scene}"...]` }
```
Anthropic caches the personality prompt on the first hit and re-serves it for ~5 minutes at ~10% of original token cost. Only applied when `personality.provider === 'claude'` (Grok and DeepSeek don't support the directive). Vision pings bypass caching entirely (different one-shot prompt; cache would miss).

### 13. Decoupled CustomEvent Pattern (NEW)
The toast and favorites systems intentionally avoid React Context. Any code (libs, hooks, async callbacks, event handlers) can call `toast.success('Saved')` or `toggleFavorite(...)` — these dispatch `CustomEvent`s on `window`, and the corresponding provider/hook listens. Benefits:
- No prop-drilling.
- Works from outside the React tree (e.g. inside a fetch callback).
- Safe during SSR (no-op when `typeof window === 'undefined'`).
- The favorites lib also listens to the cross-tab `storage` event so changes in another tab propagate.

### 14. Deterministic Day-of-Year Picker Pattern (NEW)
`daily-verse.ts`, `daily-kindness.ts`, `suggested-prompts.ts`, and `greeting.ts` all share a `dayOfYear(date)` helper (the canonical version lives in `daily-verse.ts`; others import). Each derives its selection deterministically from `(dayOfYear + offset) % pool.length` so the server (UTC) and client agree (no hydration mismatch) and the content rotates daily without persisting anything. Kindness uses a prime offset (7) so its cycle isn't in lockstep with the verse cycle. Greeting uses LOCAL time + a mounted-only render to avoid SSR mismatch for "good morning" vs "good night" across timezones.

### 15. Generation-Counter Race Guard Pattern (NEW)
In `useCamera`, rapid toggling could leave orphaned `MediaStream` tracks if the user turned the camera off while `getUserMedia` was still resolving. Solution: a `generationRef` counter that `stopCamera` and unmount bump. `startCamera` snapshots the current generation before awaiting; if the generation differs by the time the promise resolves, the freshly-acquired stream is immediately stopped and discarded. Same pattern would work for any other async resource where the lifecycle can be cancelled before resolution.

### 16. Once-Only Effect Pattern (NEW)
`ChatInterface` loads chat history + settings exactly once on mount via a `didLoadRef.current` guard. Previously the effect depended on `[loadMessages, setMessages]`, which could change identity across renders (especially `setMessages` after streaming starts) — re-running would overwrite in-flight messages with the stale localStorage snapshot. The ref makes the effect idempotent regardless of what the dependency array technically allows.

### 17. Modal Accessibility (`useModalA11y`)
One hook gives every panel: focus trap (Tab/Shift+Tab cycles inside), iOS-safe scroll lock (`position: fixed; top: -scrollY` — `overflow:hidden` alone is ignored by iOS Safari), Escape key dismissal, and focus restore to whatever opened the modal. Used by all 7 modals in the app. Hook auto-detects focusables via a CSS selector, filtering out `aria-hidden` and zero-size nodes.

### 18. Imperative Toast API (CustomEvent-Based)
`import { toast } from '@/lib/toast'; toast.success('Saved!')` works from anywhere — no provider context needed. The lib dispatches `CustomEvent`s; `ToastProvider` in `Toast.tsx` is the sole listener. Variants: `default`, `success`, `error`, `info`. Auto-dismisses after `duration` ms (4000 default; 0 disables). Returns an id you can pass to `toast.dismiss(id)`. Provider caps visible toasts at 3 and evicts FIFO; respects `prefers-reduced-motion`.

### 19. Privacy-First Analytics
`track('event.name', { property: value })` buffers events in memory (no localStorage — explicit choice so we don't have to answer awkward retention questions), flushes every 5s via debounced timer, force-flushes on `visibilitychange`/`pagehide` using `sendBeacon`. Auto-disables if `navigator.doNotTrack === '1'`. Sanitizes properties to string/number/boolean only — anything else is dropped silently. Never sends content, audio, scene descriptions, IPs, or UA. Posts to `/api/analytics` which doesn't exist yet — failures are silent by design.

### 20. iOS-PWA Stale-Build Self-Heal
`VersionCheck` polls `/api/version` on focus / `visibilitychange` / a 5-minute interval. If the server's buildId differs from the one baked into the page, it hard-navigates to a cache-busted URL (`?_v=Date.now()`). The buildId is `VERCEL_GIT_COMMIT_SHA` on prod and `'dev'` locally; the local check short-circuits so we don't infinite-loop reload in dev. `next.config.ts` sends `Cache-Control: no-store` on HTML routes; `layout.tsx` adds defense-in-depth `<meta http-equiv>` cache headers.

---

## The 9 Personalities

| ID | Name | Emoji | Provider | Voice | Character |
|----|------|-------|----------|-------|-----------|
| `mushroom-guru` | Mushroom Guru | 🍄 | Claude | ErXwobaYiN019PkySvjV (Antoni) | Tipsy, trippy, deeply loving. Default. |
| `gentle-shepherd` | Gentle Shepherd | 🐑 | Claude | 4QLC5fepxZkYmdD2IGRU | Traditional, kind, comforting |
| `zen-jesus` | Zen Jesus | 🧘‍♂️ | Claude | cjVigY5qzO86Huf0OWal (Eric) | Quiet, present, koan-like. Gospel + Zen. |
| `surfer-jesus` | Surfer Jesus | 🏄 | Claude | iP95p4xoKVk53GoZ742B (Chris) | Californian beach philosopher. Surf metaphors. |
| `therapist-jesus` | Therapist Jesus | 🪑 | Claude | JBFqnCBsd6RMkjVDRZzb (George) | Rogerian therapist. Asks more than answers. |
| `son-of-god` | Son of God | ⚡ | Grok | onwK4e9ZLuTAKqWW03F9 (Daniel) | Wrathful, arrogant, Old Testament tyrant |
| `suffering-servant` | Suffering Servant | 😩 | DeepSeek | D38z5RcWu1voky8WS1ja (Fin) | Depressive, whiny, Irish |
| `trump-jesus` | Trump Jesus | 🟠 | DeepSeek | pqHfZKP75CvOlQylNhV4 (Bill) | Trump speech patterns, MAGA messiah |
| `anti-jesus` | Anti-Jesus | 😈 | DeepSeek | N2lVS1w4EtoT3dr4eOWO (Callum II) | Blackout drunk roaster, zero filter |

Kind personalities are now ordered first in `PERSONALITIES`. The `DEFAULT_PERSONALITY_ID` is `'mushroom-guru'`.

### Provider Selection History
- Originally all personalities used Claude Haiku
- Evil personalities moved to Grok (`grok-3-mini-fast`) — but Grok refused truly unhinged content (stopped mid-sentence, broke character)
- Grok can handle sarcastic/arrogant (Son of God) but NOT evil/unhinged
- Anti-Jesus, Trump Jesus, Suffering Servant moved to DeepSeek (`deepseek-chat`) which has no content refusal issues
- New kind personalities (Zen, Surfer, Therapist) added on Claude — all kind/contemplative work uses Claude

---

## Known Issues & Gotchas

### Confirmed Issues
1. **First-load video distortion**: Improved significantly (dimension check + rAF delay + 12s safety + canvas fallback) but may still occasionally flash on very slow connections.
2. **Grok refuses extreme evil**: Grok plays sarcastic/arrogant fine but refuses truly unhinged content. That's why only Son of God uses Grok.
3. **Local testing limited**: Without `XAI_API_KEY` and `DEEPSEEK_API_KEY` in `.env.local`, Grok/DeepSeek personalities fail silently.
4. **Trump Jesus voice**: Current Bill voice is a placeholder — needs a more Trump-like ElevenLabs voice.
5. **No error fallback**: If a provider's API key is missing or the provider errors, there's no fallback to another model. Fails silently.
6. **In-memory rate limiter**: Buckets reset on cold start and don't share across function instances. Adequate for now; swap for `@upstash/ratelimit` when traffic warrants.
7. **`/api/analytics` doesn't exist**: The analytics lib targets `/api/analytics` but the route is unimplemented. Events are buffered and lost (silent failure). Add the route when you want to start collecting.

### Lint Warnings (non-blocking, intentional)
ESLint flags a handful of things the build allows:
- `react-hooks/set-state-in-effect` on lazy-hydrate patterns in `GreetingHeader`, `useFavorites`, `useHaptics`, `useSpeechRecognition`, `useCamera`, `SettingsPanel`, `OnboardingOverlay`, `FavoritesPanel`, `PrayerRequestForm`. These are deliberate SSR-safe hydration patterns — they read browser-only state (localStorage / `navigator` / `matchMedia`) after mount and update React state. Acceptable until a fundamental refactor.
- `react-hooks/refs` on `PersonalitySwitcher` line 38 — sizes the refs array to match `PERSONALITIES.length` during render. Could be moved into a `useEffect`.
- `jsx-a11y/role-supports-aria-props` on `PersonalitySwitcher` — `aria-pressed` set on `role="radio"`. Either `aria-checked` alone is sufficient; the `aria-pressed` is redundant.

### TypeScript Strict Mode
Vercel builds with strict TypeScript. Common issue: refs used inside nested functions lose their null narrowing. Always add `if (!ref)` guards inside closures that use refs.

### AI SDK v6 Specifics
- `useChat` returns `{ messages, sendMessage, status, setMessages }`
- `status` values: `'ready' | 'streaming' | 'error' | 'submitted'`
- `UIMessage` has `.parts` array (not `.content` string)
- Parts are typed as a union — use `p.type === 'text'` filter before accessing `.text`
- Transport uses `body: () => ({...})` function (Resolvable<object>) for dynamic request bodies — function is called per-request
- `DefaultChatTransport` from `'ai'` package
- For Anthropic prompt caching, use `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on the system message itself, NOT as a request-level option.

### Next.js 16.2.3
- This is NOT standard Next.js from training data
- Check `node_modules/next/dist/docs/` for current API conventions
- Some APIs/conventions differ from Next.js 14/15

---

## Deployment

### Push to Deploy
From Cowork/Claude, use osascript:
```
do shell script "cd '/Users/resorb/Documents/Claude Sessions/Jaisus' && git add <files> && git commit -m '<message>' && git push origin main"
```
Vercel auto-deploys from `main`. Build takes ~45-60s.

### Cache-Control
- `next.config.ts` sends `Cache-Control: no-store` on the root HTML route — `no-store` is the strongest directive and implies all the others.
- `layout.tsx` also sets `<meta http-equiv>` cache headers as defense-in-depth for iOS Safari versions that ignore HTTP headers in PWA shells.
- Static assets (`_next/static`) are content-hashed by Next.js and safe to cache.
- `VersionCheck` is the runtime self-heal for stale builds — polls `/api/version` on focus/visibility-change.

### Common Build Failures
1. TypeScript strict null errors (add guards in closures)
2. ESLint `@typescript-eslint/no-explicit-any` (add `// eslint-disable-next-line` comments — used sparingly, only on `useChat` ref typing)
3. Missing imports when adding new providers

### Git Identity & Repo Location
The Mac user is `resorb` and the repo lives at:
```
/Users/resorb/Documents/Claude Sessions/Jaisus
```

---

## Pending / Future Work

### Recently Completed (struck through items from prior handover)
- ~~Verify personality switching works end-to-end~~ — works; prompt caching applied.
- ~~Add `XAI_API_KEY` and `DEEPSEEK_API_KEY` to `.env.local`~~ — still pending locally; needed for full local testing.
- ~~Find a Trump-like voice~~ — still placeholder.
- ~~Remove debug `console.log` from chat route~~ — done.
- ~~Mobile video first-load reliability~~ — much improved with dimension check + rAF + 12s safety.
- ~~Rate limiting on vision API calls~~ — done across chat/teachings/daily; vision route itself still unrate-limited (camera capture is throttled client-side to 10s).

### High Priority
- [ ] **Add `XAI_API_KEY` and `DEEPSEEK_API_KEY` to `.env.local`** for local testing
- [ ] **Find a Trump-like voice** in ElevenLabs (current Bill voice is placeholder)
- [ ] **Implement `/api/analytics`** to actually receive events. Right now the client sends to a 404 and drops the events.
- [ ] **Add provider error fallback** — if DeepSeek/Grok fails, fall back to Claude gracefully

### Medium Priority
- [ ] **Voice interruption** — let the user cut off jAIsus mid-sentence by holding the mic (currently you must wait for the sentence to finish)
- [ ] **PWA service worker** for offline shell + push notification readiness
- [ ] **Push notifications** for daily verse / kindness reminders (opt-in)
- [ ] **Rate limit on `/api/vision`** — capture is client-throttled but server should still cap per-IP
- [ ] **Distributed rate limiter** (`@upstash/ratelimit`) when traffic outgrows the in-memory bucket
- [ ] **Better error display** when provider API keys are missing — surface a real toast instead of silent failure

### Ideas / Backlog
- [ ] **FavoritesPanel sharing-export** — export all favorites as a markdown file, share-sheet integration
- [ ] **Community features** (prayer wall, shared experiences)
- [ ] **More video clips** for richer emotion mapping (currently 7 files mapped across 9 emotions)
- [ ] **Voice cloning** for personality-specific voices (e.g. real Trump voice for Trump Jesus)
- [ ] **User accounts / cloud persistence** (favorites + history + prayers sync across devices)
- [ ] **Multi-language support** — verses, kindness acts, prompts, greetings all translatable
- [ ] **Conversation export** — markdown / audio mix
- [ ] **More personalities** — Lawyer Jesus (legal advice), Engineer Jesus (debugger of souls), Toddler Jesus

---

## API Keys & Services

| Service | Key Env Var | Purpose | Dashboard |
|---------|-------------|---------|-----------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude Haiku chat + teachings + daily reflection (with prompt caching) | console.anthropic.com |
| ElevenLabs | `ELEVENLABS_API_KEY` | TTS voice synthesis | elevenlabs.io |
| Google/Gemini | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | Camera vision (Gemini 2.5 Flash REST) | aistudio.google.com |
| xAI | `XAI_API_KEY` | Grok chat (Son of God personality) | console.x.ai |
| DeepSeek | `DEEPSEEK_API_KEY` | DeepSeek chat (Anti-Jesus, Trump Jesus, Suffering Servant) | platform.deepseek.com |

---

## Critical Code Paths

### Chat Message Flow
1. User speaks (2s silence timeout) or types → `ChatInterface` calls `sendMessage()`
2. Transport body function reads `personalityRef.current` and latest `sceneDescription`
3. `/api/chat` rate-limit checks IP → selects model based on personality provider
4. System message is split into cached personality + uncached scene context (Claude only)
5. Stream arrives → `messages` updates → streaming TTS effect fires
6. Sentences extracted via regex → long ones split at commas/dashes → `queueSentence()` per chunk
7. `processQueue()` plays each chunk via ElevenLabs sequentially (30s safety timeout each)
8. Emotion tags parsed → `setCurrentEmotion()` → `AnimatedJesus` swaps video
9. Messages debounced-saved to localStorage (500ms during streaming, instant on `status === 'ready'`)

### Camera Vision Flow
1. `useCamera` hook: `getUserMedia()` → video element → canvas capture every 10s
2. Generation counter snapshots before `getUserMedia`; stale resolves immediately stop tracks
3. Frame sent as base64 to `/api/vision` → Gemini 2.5 Flash returns witty scene description
4. Description stored in `sceneDescription` state + `sceneTimestamp`
5. Auto-vision: 2s tick checks if configured interval has elapsed since last ping → fires immediately when ready
6. Regular messages: latest scene always included in transport body if camera active
7. Tab hidden → vision skipped (Gemini quota saved)

### Video Playback Flow
1. On mount: probe all 7 video files for availability; release each probe's `src` after metadata loads
2. Available videos ordered per playlist
3. Active video plays → at 80%, preload next (emotion-driven selection)
4. At end (minus 8 frames), pause + instant swap to preloaded; old element's `src` removed and `.load()`-ed
5. Reveal: waits for `videoWidth > 0` + `requestAnimationFrame`, then makes visible
6. Stall watchdog: if stuck >8s, force swap
7. Safety: if no dimensions after 12s of retries, fall back to canvas mode
8. Visibility API: pause when tab hidden, resume when visible

### Daily Verse Flow
1. Page mounts → `DailyVerse` component renders
2. Server-side render: `getDailyVerse()` picks via `dayOfYear(new Date()) % verses.length` in UTC
3. Client-side hydrate: same calculation, same result (UTC = SSR-safe)
4. (Optional) `/api/daily` GET fetches verse + Claude-Haiku-generated reflection question
5. Reflection cached per-verse-id in a module-level `Map` (24h TTL); response CDN-cached 1h with SWR for a day

### Onboarding Flow
1. `ChatInterface` mounts → calls `hasSeenOnboarding()` from localStorage
2. If unseen: `setShowOnboarding(true)` → `OnboardingOverlay` renders modal with 4 slides
3. User swipes / taps Next / clicks indicators → `setIndex`
4. Last slide CTA "Start talking" or tap-outside or skip-link → `onComplete` → `markOnboardingSeen()` + close
5. `track('onboarding.completed')` fires once

---

## Prompt Engineering Notes

### Shared Rules (ALL personalities)
- NO stage directions, asterisks, narration, scene-setting
- Every sentence MUST have `[EMOTION:tag]` prefix
- Output goes directly to TTS — if it sounds insane read aloud, cut it
- Forbidden: *smiles*, (softly), [nods], emotional labels
- 2-4 sentences max for chat, 300-400 words for teachings

### Vision Ping Prompt (overrides personality)
Extremely constrained: ONE sentence, max 15 words, witty/cheeky. Max 60 output tokens. Completely replaces personality system prompt. No prompt caching (one-shot).

### Regular Chat with Camera
Personality prompt (CACHED for Claude personalities) + separate uncached system message: `[You can see the user right now: "{scene}" — you may briefly reference what you see, but focus on answering their question.]` Max 300 tokens.

### Teaching Prompt
Separate `teachingPrompt` per personality. 300-400 words, oral delivery style, structured in 4 parts. Uses Claude Haiku (was incorrectly `claude-sonnet-4-6` which didn't exist).

### Daily Reflection Prompt
`/api/daily` uses a fixed system prompt: `"You are jAIsus. Given a scripture verse, write ONE warm reflection question someone could sit with today. Maximum 20 words. No preamble, no quotes, just the question."` 60 token cap. Result cached for 24h per verse ID.

---

## Running Locally

```bash
cd "/path/to/jAIsus"
npm install
npm run dev
# Open http://localhost:3000
```

Requires `.env.local` with at minimum `ANTHROPIC_API_KEY`. Other keys enable additional features:
- Without `ELEVENLABS_API_KEY`: falls back to browser TTS
- Without `GEMINI_API_KEY`/`GOOGLE_API_KEY`: camera feature won't work
- Without `XAI_API_KEY`: Grok personalities (Son of God) error silently
- Without `DEEPSEEK_API_KEY`: DeepSeek personalities (Anti-Jesus, Trump, Suffering Servant) error silently

In local dev, `BUILD_ID` is `'dev'` and `VersionCheck` short-circuits — no reload loop.

---

## Recent Commit History (newest first)

```
53ec164 feat: wire new UX into the app
3231c99 feat: UX building blocks — error boundary, toasts, haptics, onboarding, favorites, daily verse, suggested prompts, analytics
47e568f feat: massive content expansion — parables, personalities, teaching topics
8f4267f feat: modal accessibility — focus trap, scroll lock, Escape, ARIA
d930431 feat: prompt caching, rate limiting, and topic allowlist
5a35bef fix: memory leaks and races in mobile-critical paths
7cd0189 fix: tier-1 audit findings — broken endpoints, leaks, dead code
c093e0a fix: prevent stale builds on iOS PWA + first-load video distortion
4de7f9c docs: update handover with all session fixes and pending issues
9a1fc68 fix: speech recognition uses silence timeout (no early cutoff) + text input in autoSpeak mode
461e815 fix: no-cache headers on HTML to prevent stale builds on mobile
01affd6 fix: video first-load distortion — wait for dimensions + rAF before reveal
da2ff62 fix: vision reactivity — always send latest scene, fast-tick auto-ping
```
