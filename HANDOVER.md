# jAIsus — Complete Handover Document

**Last updated**: 2026-05-22
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

## Recent Additions — Wave 7 (Feature expansions)

Wave 7 added five user-facing features that all share the same shape: pure lib in `src/lib/`, optional React hook in `src/hooks/`, presentational component in `src/components/`. Mutations dispatch `CustomEvent`s on `window`; subscribers re-read on the next tick. Safe to call from anywhere (libs, async callbacks, event handlers).

### New libs (`src/lib/`)
- **`conversation-memory.ts`** — persists one-sentence summaries of past sessions ("yesterday we talked about your father…"). Same shape as `favorites.ts`: `ConversationMemory` interface (`id`, `summary`, `timestamp`, `personalityId`, `messageCount`), capped at 30 entries, `crypto.randomUUID()` with timestamp fallback, dispatches `jaisus-memories-changed` on change. `memoriesAsContext(limit)` renders the most recent N as a system-prompt-ready block. **Currently saved locally only — not yet sent server-side.**
- **`streaks.ts`** — consecutive-day streak tracker. `StreakState` (`current`, `longest`, `lastActive` as `YYYY-MM-DD`, `totalDays`). LOCAL-time calendar math (a "day" matches the user's wall clock across timezones), DST-safe via `Math.round(ms/86_400_000)`. Same-day re-entry no-op, yesterday → `current+=1`, anything older → reset to 1. Dispatches `jaisus-streak-changed`. Exports `dateKey(d)`, `recordActivity(now?)`, `clearStreak()`.
- **`mood-content.ts`** — 10 moods (`anxious`, `grateful`, `sad`, `angry`, `lonely`, `doubting`, `hopeful`, `overwhelmed`, `peaceful`, `lost`) → themed subsets of verses / kindness / parables / prompts. Selection is the FIRST match in each pool, so mood → bundle is stable (no `Math.random`). `MoodInfo` has `id`, `label`, `emoji`, `acknowledgment`, plus four arrays of theme/category keys. `getMoodContent(mood)` returns `{ verse, kindness, parableTitle, parableId, promptText }` with first-pool fallbacks so verse/kindness are never null when data is present.
- **`conversation-export.ts`** — markdown/JSON/plaintext export of chat + favorites. Pure helpers `buildExport()` and `formatExport(payload, format)` are SSR-safe. `downloadExport({format, …})` does the Blob + object URL + temporary anchor dance, returns true on success. Validates persisted shapes defensively — older clients writing a different schema can't bleed fields into the download. Strips `[EMOTION:tag]` prefixes from assistant messages. Favorites grouped by kind (`message` → `teaching` → `verse` → `parable`), newest first within each group.

### New hooks (`src/hooks/`)
- **`useConversationMemory.ts`** — wraps the conversation-memory lib. Hydrates after mount, subscribes to both `jaisus-memories-changed` and the cross-tab `storage` event. Workhorse: `summarizeAndSave(messages, personalityId)` strips messages to `{role, text}`, skips trivial conversations (<2 messages or <100 chars), POSTs `/api/summarize`, persists the returned summary. Errors are swallowed — never interrupts the user with a failed background save.
- **`usePullToRefresh.ts`** — generic pull-to-refresh gesture. Engages only when scroll container is at the top, vertical-only (aborts on horizontal swipe past 8px), 0.5x resistance for rubbery feel, clamps to `maxPull` (default 120px), triggers at `threshold` (default 80px). Holds indicator during async `onRefresh()`, animates back to 0 with ease-out cubic over 220ms (instant under `prefers-reduced-motion`). Gesture state in refs; React state updated via rAF.
- **`useLongPress.ts`** — touch-and-hold (+ optional right-click). 500ms default threshold, 10px movement budget so a real scroll/drag cancels naturally. On successful long-press, trailing `touchend`/`mouseup` gets `preventDefault()` so the parent's `onClick` doesn't also fire. `enableRightClick` (default true) fires immediately on `contextmenu`. Returns a `UseLongPressBind` ready to spread on any React element.

### New components (`src/components/`)
- **`StreakBadge.tsx`** — chip "🔥 N day streak". Tiers at 7+ (richer amber) and 30+ (gradient + white). `autoRecord` (default true) calls `recordActivity()` once on mount — idempotent within the calendar day. Renders `null` on SSR + first paint (state depends on localStorage + local-time math). `role="status" aria-live="polite"` with longest-streak in the aria-label.
- **`MoodSelector.tsx`** — 2-col-mobile / 5-col-desktop grid of 10 mood chips with emoji + label. Tapped tile flashes amber for ~300ms (visual feedback only; selected state lives in the parent). On pick: `getMoodContent(mood.id)` then `onPick(mood, content)`.
- **`PullToRefreshIndicator.tsx`** — circular rotating arrow / spinner overlay paired with `usePullToRefresh`. NOT wired yet — available for future use.
- **`ContextMenu.tsx`** — anchor-positioned dropdown. Position clamped to viewport via `useLayoutEffect` (renders off-screen on first frame to measure, snaps on next layout). Keyboard: ArrowUp/Down wrap-around, Tab/Shift+Tab cycle focus, Escape closes, Enter/Space activates. First menuitem auto-focused. 120ms fade + scale-from-0.95 open animation. `destructive` items get rose palette. NOT wired into ChatMessage yet — available for future use.
- **`ParableReader.tsx`** — full-screen immersive reading mode. Serif typography, drop-cap, TTS playback toggle, `FavoriteButton`, `ShareButton`, slide-in-from-right (instant under reduced motion). Replaces the inline `expanded` state from `ParablesDrawer`. Modal a11y via `useModalA11y`. Fires `parable.opened`/`parable.closed`/`parable.listen` analytics. `Ask jAIsus about this parable` CTA closes the reader AND the drawer above it.
- **`ExportButton.tsx`** — trigger + dropdown menu for the three export formats. Click-outside / Escape close (Escape returns focus to the trigger). Arrow keys / Home / End navigate options. Calls `downloadExport({format})`, toasts success/failure, fires `export.downloaded`.

### Wiring
- **`ChatInterface.tsx`** mounts `<StreakBadge />` and `<MoodSelector />` in the empty-state block. Mood pick → `sendMessage({text: content.promptText ?? "I'm feeling {label}"})` with `mood.picked` analytics. Imports `useConversationMemory`; `handleClearHistory` calls `summarizeAndSave(messages, personalityRef.current)` (best-effort, async, doesn't block clearing) before wiping.
- **`ParablesDrawer.tsx`** uses `readingParable: Parable | null` state; tapping a card opens the full `ParableReader`.
- **`SettingsPanel.tsx`** mounts `<ExportButton />` in the data section above the Clear-history button.

---

## Recent Additions — Wave 8 (System features)

Wave 8 added infrastructure plumbing: a service worker for offline / app-shell caching, an OpenGraph image generator for social unfurls, and the `/api/summarize` route that powers `useConversationMemory`. None of this is visible to the user during normal chat — it's the "feels like a real app" layer.

### New API routes
- **`/api/summarize`** — POST. Generates a single-sentence summary of a conversation via Claude Haiku for cross-session memory. Request `{messages: Array<{role, text}>}`. Response `{summary: string}` (empty on LLM failure — graceful no-op). Rate-limited (burst 20, 1/15s sustained). Truncates input from the FRONT so the most recent 8000 chars survive. 60-token output cap, past tense from the user's perspective. `maxDuration = 15`.
- **`/api/og`** — GET. Dynamic OpenGraph PNG via `next/og` (Satori-backed). Three variants: `?type=default` (branded "Talk to jAIsus." card), `?type=verse&text=&ref=` (verse card with translucent ornamental quote marks), `?type=message&text=` (message card with "FROM JAISUS" header). Shared `cardFrame` with cream background, amber radial glow upper-right, brand wordmark + tagline bottom-left, URL bottom-right. **Edge runtime**, 1200x630 PNG, `Cache-Control: public, max-age=3600, s-maxage=86400, immutable`. Defensive: unknown `type` → default; control chars stripped; length-clamped; render exceptions fall back to default rather than 500. File is `.ts` (not `.tsx`), so JSX is built with `React.createElement` calls. **NOT yet wired** into `metadata.openGraph` — see Pending Work.

### New libs
- **`sw-config.ts`** — `SW_VERSION = 'v1'` (must match `CACHE_VERSION` in `public/sw.js` — these version independently of build IDs since the SW cache strategy can change without a code deploy) + `SW_PATH = '/sw.js'`.

### New components
- **`ServiceWorkerRegistration.tsx`** — production-only client component that registers `/sw.js` via `requestIdleCallback` (1.5s `setTimeout` fallback). Short-circuits in dev to avoid HMR confusion. Returns `null` (pure side-effect). Mounted in `layout.tsx` between `<AnalyticsInit />` and `<ToastProvider />`.

### New public asset
- **`public/sw.js`** — vanilla JS service worker. Strategies:
  - **`/api/*`** — pass through (never cache chat/TTS/vision/version/summarize)
  - **HTML navigations** — network-first with 3s timeout, fall back to cache, fall back to an inline offline HTML page (warm radial gradient, "j**AI**sus" wordmark, pulsing "Waiting for a signal" dot)
  - **Static assets** — cache-first with background revalidation. Cap of 50 entries via FIFO eviction; only `response.type === 'basic'` (same-origin) responses are stored.
  - **App shell** precached on `install`: `/`, `/manifest.json`, `/jaisus-embraces.mp4`, `/jaisus-prays.mp4`. Individual 404s are silently skipped (install never fails).
  - `skipWaiting()` + `clients.claim()` on activate. Old `jaisus-*` caches with non-matching `CACHE_VERSION` are deleted.
  - Accepts `{type: 'SKIP_WAITING'}` postMessage for forced activation (not currently sent — VersionCheck owns the reload-on-deploy path).

### NOT yet wired (intentional)
- `usePullToRefresh` + `PullToRefreshIndicator` — empty state integration is a small follow-up.
- `useLongPress` + `ContextMenu` — attach to ChatMessage for Copy / Save / Share / Quote.
- `conversationMemory` server-side injection — memories save locally but `/api/chat` doesn't read them yet. `memoriesAsContext()` is ready to slot in.
- `metadata.openGraph` in `layout.tsx` doesn't yet point at `/api/og`.

---

## Recent Additions — Wave 10 + 11 (Memories panel, search, speaking hint, server-side memory)

Wave 10 added three new user-facing panels for browsing/searching/discovery. Wave 11 was a comprehensive wire-up pass that landed server-side memory (the long-promised cross-session continuity) and connected long-press menus + the keyboard-aware input. After Wave 11, jAIsus actually carries a thread of memory across sessions instead of just persisting summaries locally.

### New components (`src/components/`)
- **`MemoriesPanel.tsx`** — slide-up drawer (`role="dialog"`, `useModalA11y`) listing every saved conversation memory. Each row has a personality chip (emoji + name), a relative date label (`today` / `yesterday` / `N days ago` / `N weeks ago` / formatted date), the one-sentence summary, a message-count badge, and a per-row remove button. Header "Clear all" is a two-tap confirm with a 3s timeout (tap once → "Sure? Tap again to confirm" → tap again or wait → reset). `now` is pinned in state and only refreshed when the panel opens so relative times don't churn on every render. Empty state shows "No memories yet" via `EmptyState`.
- **`SearchPanel.tsx`** — slide-up drawer with a search input that queries across chat history + favorites + parables via the new `search.ts` lib. 150ms debounce on typing; explicit quick-tip chips ("Try searching for 'love'") skip the debounce. Each result has a colour-coded source chip (`chat` blue, `favorite` rose, `parable` amber), a context label, and the matched excerpt with `<mark>`-highlighted terms (pure JSX `HighlightedText` — no `dangerouslySetInnerHTML`). Chat results are clickable and trigger `onAskAbout` (which sends the text back to chat). Auto-focuses the search input on open via `requestAnimationFrame` so the slide-in finishes before the mobile keyboard pops. `aria-busy={isDebouncing}` + `role="region" aria-live="polite"` for screen readers.
- **`SpeakingHint.tsx`** — discreet "Tap to interrupt" pill that surfaces near the bottom of the screen while jAIsus is speaking. Capped at **3 appearances per page-load session** (after the user's learned, stop nagging) and auto-hides after **4 seconds** even if speech continues. Fades in via `scale-90 → scale-100` + opacity, fades out with the same. Respects `prefers-reduced-motion: reduce` (instant show/hide). Tap fires `onInterrupt?.()` and hides immediately. Tracks the rising edge of `voiceState === 'speaking'` with a ref so it shows once per speech session up to the cap; resets the rising-edge gate when speech ends so the next session can show again. Lives at the chat root, outside the scrollable container, so its `fixed` positioning anchors to the viewport.

### New libs (`src/lib/`)
- **`search.ts`** — pure indexing + ranking over the three local data sources. No precomputed index (datasets are small: ≤100 messages, ≤200 favorites, ~50 parables — search is O(N) per call and that's fine). Public API: `searchAll(query)` returns `SearchResult[]`, capped at 50. Each result has `{id, source, text, context?, timestamp?, score}`. Scoring: term frequency × source weight (`chat: 2.0`, `favorite: 1.5`, `parable: 1.0`), plus an **exponential recency decay** on chat results (14-day half-life, floored at 0.4× so a six-month-old gold match doesn't disappear). Query is split on whitespace and ALL terms must appear in the searchable text (AND semantics). Excerpting centers the window on the first match and snaps to nearby word boundaries. Reads localStorage fresh on every call — no subscriptions, no stale state. Also exports `highlightMatches(text, query)` for callers that prefer `dangerouslySetInnerHTML` (SearchPanel uses a JSX-based highlighter instead).

### Wire-ups in existing files

- **`chat/route.ts`** — POST body now destructures an optional `memoryContext: string`. Server applies a defensive `slice(0, 4000)` cap (anything longer is noise or a malformed request — truncate, don't 400). Injected as a SEPARATE non-cached system message AFTER the cached personality prompt. For Claude this keeps the prompt-cache prefix stable (personality prompt is identical → cache hit) while letting the variable memory tail change per request. For Grok/DeepSeek it's just a plain system message in order. **Skipped entirely on vision pings** — those use a one-shot constrained prompt where memory context would be off-topic and cache would miss anyway. The scene-context system message still comes last (after both personality + memory).
- **`ChatInterface.tsx`** — transport `body()` callback now includes `memoryContext: memoriesAsContext(5)` on every request. Called INSIDE the callback (not at component mount) so each new request sees the latest memories. Capped at 5 to keep the system prompt size reasonable; server applies its own 4000-char safety net. Also mounts `<MemoriesPanel>`, `<SearchPanel>`, `<SpeakingHint>` at the bottom of the JSX (SpeakingHint outside the chat container so its `fixed` positioning anchors to the viewport). **Mobile soft-keyboard fix**: a new `useEffect` subscribes to `window.visualViewport`'s `resize`/`scroll` events; when the keyboard opens, `visualViewport.height` shrinks but `window.innerHeight` doesn't — we compute the delta and push it as `padding-bottom` on the sticky input container so the text field rises above the keyboard. Guarded so older browsers (no `visualViewport` support) skip this entirely.
- **`ChatMessage.tsx`** — long-press / right-click context menu now wired. Uses `useLongPress` to detect the gesture (500ms threshold, 10px movement budget so real scrolls cancel) and `ContextMenu` to render the dropdown anchored to the touch/click position (`x`, `y` from `clientX/Y`). Three items: Copy (via `navigator.clipboard.writeText`), Share (via `navigator.share` with clipboard fallback; quiet on user-cancellation `AbortError`), Save/Unsave (toggles a favorite — label flips based on current state). Header icons (Favorite, Share) stay; long-press is a power-user shortcut. Hook is called every render regardless of branch so React's rules-of-hooks contract holds, and the `bind` props are only spread onto the assistant bubble.
- **`ActionButtons.tsx`** — added a third 2-col row beneath the existing 3-col Saved/Community/Settings row, with **Search** and **Memories** buttons. Mirrors the existing button styling for visual consistency. Layout rationale in the inline comment: at a 375px viewport, fitting 5 entries on a single row would crowd labels like "Memories" — two rows keeps labels comfortably readable and matches existing muscle memory.
- **`types.ts`** — `ActivePanel` union extended with `'memories'` and `'search'` (now: `'none' | 'parables' | 'prayer' | 'teachings' | 'settings' | 'community' | 'favorites' | 'memories' | 'search'`).

### Server-side memory is now LIVE
The "wire `useConversationMemory` into transport body" item from Wave 8's pending list is **complete**. The pipeline now runs end-to-end:
1. User clears history → `summarizeAndSave` POSTs to `/api/summarize` → Claude Haiku returns a one-sentence past-tense summary → persisted to localStorage.
2. On every subsequent `/api/chat` request, `memoriesAsContext(5)` renders the most recent 5 memories as a system-prompt block and the transport ships it in the body.
3. Server destructures `memoryContext`, slices to 4000 chars max, injects as a separate non-cached system message AFTER the cached personality prompt.
4. Claude (or Grok/DeepSeek) sees the memory block alongside the personality prompt — produces responses that reference past conversations naturally.

The prompt-cache breakpoint sits BEFORE the memory message, so the cache prefix (personality prompt) stays stable across requests — only the memory tail changes per call. This is the **split system message + cached prefix + fresh tail** pattern (see Key Design Decisions #25 below).

### NOT yet wired (intentionally — note as pending)
- `usePullToRefresh` + `PullToRefreshIndicator` — still shipped, still unused. Empty-state integration is a small follow-up.
- ~~Notifications opt-in — not built yet; on the roadmap.~~ (Landed in Wave 13/14 — see below.)

---

## Recent Additions — Wave 13 + 14 (Voice barge-in + push notifications + distributed rate limit + E2E scaffold)

Wave 13 built four big features in parallel: voice activity detection for natural mid-speech interruption, the full Web Push stack for daily-verse notifications, an Upstash-backed distributed rate limiter, and a Playwright end-to-end test scaffold. Wave 14 was the wire-up pass that landed the consent prompts in `ChatInterface`, refreshed this doc, and did a final type/lint sweep. After this tier, jAIsus has a real notification channel, can be interrupted naturally while speaking, scales rate limits across instances, and has a CI-ready smoke-test net underneath the critical flows.

### New hooks (`src/hooks/`)
- **`useVoiceActivityDetection.ts`** — Web Audio API hook that listens for the user's voice while TTS plays back, fires `onSpeechStart` once sustained RMS > threshold for >150ms. Fully dormant when `enabled = false` (no `getUserMedia`, no `AudioContext`, no rAF loop, no permission prompt). When enabled, opens a `MediaStream` → `AnalyserNode` graph at `fftSize = 2048` and computes RMS on `getByteTimeDomainData` each frame. Edge detection uses two ref timestamps (`aboveSinceRef` / `belowSinceRef`) plus a `firedRef` so onSpeechStart fires exactly once per utterance — a sustained falling edge for `SILENCE_MS=400ms` resets the gate. Falling edge also calls optional `onSpeechEnd`. The analyser is NOT connected to `ctx.destination` — we never want mic-through-speakers (would also feed TTS back into VAD and create a runaway loop). A `cancelled` local + cleanup function handles the rapid enable/disable race: if `enabled` flips off while `getUserMedia` is still pending, the resolved stream's tracks are stopped immediately. Returns `{ isMonitoring, isSpeaking, error, isSupported }`.
- **`usePushSubscription.ts`** — React wrapper over the `push-client` lib. On mount probes support + current permission + existing `PushSubscription` via `serviceWorker.ready`. Returns `{ isSupported, permission, subscription, error, subscribe, unsubscribe }`. `subscribe()` runs the full opt-in flow (permission → subscribe via PushManager → POST `/api/push/subscribe`) and returns the `SubscribeResult` so callers can branch (e.g. close a modal on success). State is locally updated on every operation so the UI re-renders without waiting for the next mount. Errors are surfaced via the `error` field — the lib never throws.

### New components (`src/components/`)
- **`VADConsentPrompt.tsx`** — one-time mic-listen consent modal. Pure presentational shell built on `useModalA11y` (focus trap, scroll lock, Escape, focus restore). Persists `'accepted'` or `'declined'` to the `jaisus-vad-consent` localStorage key. Exports a `getVADConsent()` reader (returns `'accepted' | 'declined' | null`) and a `setVADConsent(v)` writer alongside the component. ChatInterface gates the actual VAD hook on `getVADConsent() === 'accepted'` so a declined user never triggers `getUserMedia`. Modal copy explains exactly what the mic is used for (interrupt TTS, no recording, no audio leaves the device).
- **`NotificationOptInPrompt.tsx`** — daily-verse push opt-in modal. Uses `usePushSubscription` internally to drive the accept path. Persists a `'1'` sentinel to `jaisus-notification-prompt-seen` localStorage on both Accept and Decline (we never re-prompt — the choice is final; user can re-enable from Settings later, on the roadmap). Exports `hasSeenNotificationPrompt()` and `markNotificationPromptSeen()` for the parent's gating logic. On Accept calls `subscribe()`, then `onAccepted?.()` if `result.ok`, else `onDeclined()` (we accept the failure as "they tried, don't keep nagging"). Uses `useModalA11y` for the same a11y guarantees as every other modal.

### New libs (`src/lib/`)
- **`push-keys.ts`** — exports `VAPID_PUBLIC_KEY` from `process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''`. Module is intentionally one line — keeps the env-var indirection in one place and lets the client and the cron handler import the same constant. Empty-string fallback so production builds without the var don't crash; instead `requestPermissionAndSubscribe()` errors out with a `'Push not configured'` message.
- **`push-client.ts`** — client-side helpers: `isPushSupported()`, `getPermissionState()`, `getCurrentSubscription()`, `requestPermissionAndSubscribe()`, `unsubscribe()`, plus the `urlBase64ToUint8Array()` helper (spec-standard VAPID key decoding). All functions are safe to call during SSR (short-circuit when `typeof window === 'undefined'`). Never throws — every failure is communicated via the returned object (`{ ok: false, error }`). The subscribe flow reuses an existing `PushSubscription` if present rather than overwriting, so re-running the opt-in is idempotent.
- **`push-server.ts`** — in-memory `Map<endpoint, PushSubscriptionJSON>` mirrored to `/tmp/jaisus-push.json` for warm-restart persistence. Exports `addSubscription(sub)`, `removeSubscription(endpoint)`, `listSubscriptions()`. The /tmp mirror gives best-effort persistence across function warm restarts but loses everything on cold start, diverges across regions, and races under burst subscribes. **TODO: migrate to Vercel KV / Upstash Redis / Postgres before scale.** Concurrency is left to Node's per-instance module loading (the Map is a singleton per instance); the disk writes are non-atomic but the next read just overwrites whatever's there. Adequate for an MVP with a handful of opted-in testers.
- **`rate-limit.ts`** (UPDATED) — added `rateLimitAsync(key, config)` alongside the existing synchronous `rateLimit(key, config)`. When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set, the async path uses an Upstash pipeline `[INCR, EXPIRE]` against a windowed key (`rl:<key>:<windowIndex>`) for distributed limiting. 1-second timeout via `AbortController` ensures a slow Upstash never blocks the real request. On any failure (env not set, timeout, non-2xx, malformed JSON, command-level error) falls back to the in-memory bucket — and emits a SINGLE `console.warn` the first time fallback is triggered (subsequent fallbacks stay quiet). Result shape is identical to `rateLimit()` so `rateLimitResponse(rl)` keeps working unchanged; migrating a route is just changing `const rl = rateLimit(...)` to `const rl = await rateLimitAsync(...)`.

### New API routes (`src/app/api/`)
- **`/api/push/subscribe`** — POST. Stores a `PushSubscriptionJSON` server-side. Validates the shape manually (no zod dep): `endpoint` must start with `https://`, `keys.p256dh` and `keys.auth` must be non-empty base64url-like strings. Rate-limited per-IP at 10/min (capacity 10, refill 10/60 per sec). Returns `{ ok: true }` on success, `{ error }` with 400 on bad shape, 429 on rate-limit, 401 if `CRON_SECRET` is misused (push-subscribe doesn't require it, but the parallel cron route does).
- **`/api/push/unsubscribe`** — POST. Removes an endpoint from the store. Same 10/min rate limit. We deliberately do NOT authenticate the endpoint URL — the URL itself is the per-device secret, and the worst-case unauthorized call is the same outcome as the user clicking "Disable notifications" themselves (no harm beyond their own UX). No-op when the endpoint doesn't exist.
- **`/api/push/send-daily`** — Vercel cron handler (GET, mirrored to POST for manual debugging). Authed via `Authorization: Bearer ${CRON_SECRET}` — Vercel injects this header automatically when `CRON_SECRET` is set in the project. Builds a VAPID JWT from scratch using Node's `crypto`: ECDSA over P-256 with SHA-256 (`ES256`), audience = push endpoint origin, expiration = now + 12h. Signing uses `dsaEncoding: 'ieee-p1363'` so the output is raw r||s (64 bytes) for JWS rather than the default ASN.1 DER. Payload is encrypted per RFC 8291 `aes128gcm`: ephemeral ECDH keypair per send, shared secret via `crypto.diffieHellman`, HKDF-derived CEK + nonce, plaintext padded with `0x02` delimiter (single-record), GCM-encrypted, body laid out as `salt(16) || rs(4) || idlen(1) || keyid(65) || ciphertext`. POSTs to each subscription with TTL=86400 (24h) and `Urgency: normal`. 201/202/200 → counted as sent. 404/410 → subscription is gone, removed from store. Other failures → counted as failed but left in place. Runs all sends in parallel via `Promise.all` and returns `{ sent, failed, removed }`. `maxDuration = 60` for headroom.

### New config
- **`vercel.json`** — declares the daily-verse cron at `0 9 * * *` UTC pointing at `/api/push/send-daily`. Single cron entry; no other Vercel-level config (build settings, routes, env are all set via the dashboard).

### Service worker (`public/sw.js`) updates
- **`push` event listener** — receives JSON payload (`{ title, body, url }`), falls back to a generic copy if missing/unparseable, and renders a notification with `tag: 'daily-verse'` so duplicate sends collapse into one notification.
- **`notificationclick` listener** — on tap, focuses any open jAIsus tab (`clients.matchAll({ type: 'window', includeUncontrolled: true })`); if none open, calls `clients.openWindow(url)` where `url` came from the payload's `data` field. Notification is closed on click. Together this gives the user a single-tap path from notification → live app, regardless of whether they had it open.
- `CACHE_VERSION` stays at `'v1'` (matches `SW_VERSION` in `src/lib/sw-config.ts`). The push/notificationclick additions do NOT change the caching strategy, so no version bump.

### New testing scaffold
- **`playwright.config.ts`** — single Mobile Chrome (Pixel 5) project. `webServer.command = "npm run dev"` boots the dev server automatically (reuses an existing one locally). HTML reporter; `screenshot: only-on-failure`, `video: retain-on-failure`, `trace: on-first-retry`. 30s per-test timeout, 5s expect timeout. Retries: 1 in CI, 0 locally (so flakes don't hide bugs during iteration). `fullyParallel: true` since each test gets fresh storage + mocks.
- **`e2e/fixtures.ts`** — two auto-fixtures: `clearStorage` (init script that wipes localStorage on every nav, so each test starts from a clean slate) + `mockApis` (route handlers stubbing `/api/chat` with a single assistant text part `"Peace be with you, friend."`, `/api/tts` returning 500 to force Web Speech fallback, `/api/vision`, `/api/teachings`, `/api/summarize`, `/api/daily`). All mocks are intercepted with `page.route()` so the tests never hit Claude, ElevenLabs, Gemini, or any other paid service.
- **`e2e/onboarding.spec.ts`** — verifies the first-run overlay appears on fresh storage, can be dismissed via the CTA, and that the flag persists across reloads.
- **`e2e/chat.spec.ts`** — types a message, asserts the stubbed assistant reply appears, checks the message bubble layout.
- **`e2e/favorites.spec.ts`** — taps the heart on an assistant bubble, opens the Saved drawer, asserts the favorite shows up; double-tap clear-all path.
- **`e2e/parables.spec.ts`** — opens ParablesDrawer, picks a parable, asserts ParableReader content + close path.
- **`e2e/settings-export.spec.ts`** — opens Settings, taps Export, picks a format, asserts the download fires.
- **`e2e/README.md`** — run instructions (`npx playwright install chromium` once; then `npm run test:e2e` / `npm run test:e2e:ui`) and a mocks rundown.
- **`package.json`** scripts: added `test:e2e` (`playwright test`) and `test:e2e:ui` (`playwright test --ui`). `@playwright/test` added as a devDependency.

### Wiring (Wave 14)
- **`ChatInterface.tsx`** imports `useVoiceActivityDetection`, `VADConsentPrompt`/`getVADConsent`/`setVADConsent`, and `NotificationOptInPrompt`/`hasSeenNotificationPrompt`. State added: `vadConsent`, `showVADPrompt` (gated by a `vadPromptShownRef` so it only shows once per session even if the user toggles voice multiple times), `showNotificationPrompt`. The `didLoadRef` mount block now reads `getVADConsent()` into state so the hook can decide whether to engage. A new effect surfaces `<VADConsentPrompt>` the first time `voiceState === 'speaking'` AND consent is still null AND `!showOnboarding` (no modal stacking). The VAD hook is mounted with `enabled: vadConsent === 'accepted' && voiceState === 'speaking'` — dormant otherwise. `onSpeechStart` calls `stopSpeaking()` + `reset()` for natural mid-speech barge-in interrupt. A separate effect surfaces `<NotificationOptInPrompt>` once `messages.length >= 4` (2+ exchanges) AND `!showOnboarding && !showVADPrompt` AND `!hasSeenNotificationPrompt()`. Both new prompts mount alongside the existing FavoritesPanel/MemoriesPanel/SearchPanel/OnboardingOverlay block.

### New env vars users need to set on Vercel
| Variable | Type | Purpose |
|----------|------|---------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | client-readable | The base64url-encoded P-256 public key the browser sends to its push service so it can match against our signed VAPID JWT. |
| `VAPID_PRIVATE_KEY` | server only | base64url-encoded 32-byte P-256 private scalar. Signs every push request's JWT. |
| `VAPID_SUBJECT` | server only | `mailto:` or `https://` URL identifying the application server. Push services may use this to contact us about abuse. |
| `CRON_SECRET` | server only | Any random string. Vercel cron injects it as `Authorization: Bearer ${CRON_SECRET}` so we can reject unauthenticated cron URLs. |
| `UPSTASH_REDIS_REST_URL` | server only (optional) | Upstash REST endpoint. When set together with the token, enables distributed rate limiting via `rateLimitAsync`. |
| `UPSTASH_REDIS_REST_TOKEN` | server only (optional) | Upstash REST bearer token. Pairs with the URL above. |

Generate the VAPID keypair with `npx web-push generate-vapid-keys` (no dep install needed via `npx`). The public/private split: public goes to `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, private to `VAPID_PRIVATE_KEY`.

### Server-side memory + push notifications + barge-in are now LIVE
- **Barge-in**: with consent granted, the user can interrupt jAIsus mid-sentence by simply talking. No tap required. The VAD hook fires `stopSpeaking()` + `reset()` on sustained voice activity for >150ms above threshold.
- **Daily verse push**: Vercel cron hits `/api/push/send-daily` at 09:00 UTC; native VAPID + aes128gcm fans out to every stored subscription; service worker `push` listener renders the notification; tap focuses or opens the app.
- **Distributed rate limit**: when Upstash env vars are set, `rateLimitAsync` enforces per-IP windows across all Vercel instances. Existing in-memory `rateLimit` continues to work where it's already used (no forced migration).
- **E2E smoke tests**: 13 tests cover onboarding, chat, favorites, parables, and settings/export. All paid endpoints are mocked. Run with `npm run test:e2e`.

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
│   │   ├── og/route.ts            # Dynamic OG PNG (next/og, edge runtime, 3 variants)
│   │   ├── push/
│   │   │   ├── subscribe/route.ts    # NEW (Wave 13): stores PushSubscription, rate-limited 10/min/IP
│   │   │   ├── unsubscribe/route.ts  # NEW (Wave 13): removes a subscription endpoint
│   │   │   └── send-daily/route.ts   # NEW (Wave 13): Vercel cron — VAPID JWT + RFC 8291 fan-out
│   │   ├── summarize/route.ts     # 1-sentence conversation summary (Claude Haiku, rate-limited)
│   │   ├── teachings/route.ts     # Teaching generation (Haiku, topic allowlist, rate limit)
│   │   ├── tts/route.ts           # ElevenLabs TTS wrapper (voiceId allowlist)
│   │   ├── version/route.ts       # Returns deployed build ID for stale-build self-heal
│   │   └── vision/route.ts        # Gemini 2.5 Flash REST (key in header, no error leakage)
│   ├── layout.tsx                 # Root layout — VersionCheck, AnalyticsInit, ServiceWorkerRegistration, ToastProvider, ErrorBoundary + OG/Twitter metadata
│   ├── page.tsx                   # Entry → ChatInterface
│   └── globals.css                # Tailwind + custom animations
├── components/
│   ├── ActionButtons.tsx          # Tab bar + feature buttons (Saved, Community, Settings, Prayer, Parables, Teachings)
│   ├── AnalyticsInit.tsx          # Boots analytics + initial app.boot event
│   ├── AnimatedJesus.tsx          # Dual-video engine with emotion swapping, decoder-safe probes
│   ├── ChatInterface.tsx          # Main orchestrator (~700 lines)
│   ├── ChatMessage.tsx            # Message display with favorite + share buttons
│   ├── CommunityPlaceholder.tsx   # "Coming soon" placeholder sheet
│   ├── ContextMenu.tsx            # NEW: anchored, keyboard-navigable dropdown (unwired — for future use)
│   ├── DailyKindness.tsx          # Act-of-kindness-of-the-day card
│   ├── DailyVerse.tsx             # Verse-of-the-day card
│   ├── EmptyState.tsx             # Friendly empty state (icon + title + description + CTA)
│   ├── ErrorBoundary.tsx          # Class-based error boundary with warm fallback UI
│   ├── ExportButton.tsx           # NEW: dropdown menu over conversation-export lib (markdown/json/txt)
│   ├── FavoriteButton.tsx         # Heart toggle on every message
│   ├── FavoritesPanel.tsx         # Slide-up sheet listing all favorites
│   ├── GreetingHeader.tsx         # Time-aware greeting (local time → UTC SSR guarded)
│   ├── HeroSection.tsx            # Jesus visual + voice visualizers
│   ├── MemoriesPanel.tsx          # Slide-up drawer for saved conversation memories
│   ├── MoodSelector.tsx           # 2x5 / 5x2 grid of 10 mood chips
│   ├── NotificationOptInPrompt.tsx # NEW (Wave 13): daily-verse push opt-in modal
│   ├── OnboardingOverlay.tsx      # 4-slide first-run tour
│   ├── ParableReader.tsx          # Full-screen immersive reading mode + TTS + drop-cap typography
│   ├── ParablesDrawer.tsx         # Parable browser (tap opens ParableReader instead of inline expand)
│   ├── PersonalitySwitcher.tsx    # Horizontal chip strip below hero (9 personalities)
│   ├── PrayerRequestForm.tsx      # Prayer submission (localStorage)
│   ├── PullToRefreshIndicator.tsx # Visual companion to usePullToRefresh (unwired — for future use)
│   ├── SearchPanel.tsx            # NEW (Wave 10): slide-up drawer for searching chat + favorites + parables
│   ├── ServiceWorkerRegistration.tsx # Production-only client component that registers /sw.js
│   ├── SettingsPanel.tsx          # All settings (personality, autoSpeak, vision interval, voice, EXPORT, clear)
│   ├── ShareButton.tsx            # Web Share API + clipboard fallback
│   ├── Skeleton.tsx               # Shimmer placeholders (Skeleton + SkeletonMessage + SkeletonCard)
│   ├── SpeakingHint.tsx           # NEW (Wave 10): discreet "Tap to interrupt" pill while jAIsus speaks
│   ├── StreakBadge.tsx            # "🔥 N day streak" chip; auto-records activity on mount
│   ├── SuggestedPrompts.tsx       # Daily rotating horizontal chip strip
│   ├── TeachingPlayer.tsx         # Teaching generator + player (topic chips + TTS)
│   ├── Toast.tsx                  # ToastProvider — top-center stack, max 3 visible
│   ├── VADConsentPrompt.tsx       # NEW (Wave 13): one-time mic-listen consent modal
│   ├── VersionCheck.tsx           # Polls /api/version on focus, hard-reloads on mismatch
│   └── VoiceButton.tsx            # Mic button
├── hooks/
│   ├── useCamera.ts               # Camera + Gemini vision loop + generation-counter race guard
│   ├── useChatHistory.ts          # localStorage persistence (100-message cap)
│   ├── useConversationMemory.ts   # NEW: wraps conversation-memory lib + summarizeAndSave() POSTs /api/summarize
│   ├── useFavorites.ts            # React wrapper over favorites lib + cross-tab sync
│   ├── useHaptics.ts              # 8 named patterns, prefers-reduced-motion, opt-out
│   ├── useLongPress.ts            # NEW: touch-and-hold + right-click gesture (unwired — for future use)
│   ├── useModalA11y.ts            # Focus trap + scroll lock + Escape + focus restore
│   ├── usePullToRefresh.ts        # Pull-to-refresh gesture (unwired — for future use)
│   ├── usePushSubscription.ts     # NEW (Wave 13): wraps push-client lib (permission/subscribe/unsubscribe)
│   ├── useSpeechRecognition.ts    # STT — continuous mode, 2s silence timeout
│   ├── useSpeechSynthesis.ts      # TTS with streaming queue, blob URL leak tracking
│   ├── useVoiceActivityDetection.ts # NEW (Wave 13): dormant-by-default mic listener for barge-in
│   └── useVoiceState.ts           # State machine (idle/listening/processing/speaking)
└── lib/
    ├── analytics.ts               # Privacy-first event buffer (sendBeacon-batched)
    ├── constants.ts               # 16 teaching topics, 12 voice options, ElevenLabs settings
    ├── conversation-export.ts     # NEW: markdown/json/plaintext export of chat + favorites
    ├── conversation-memory.ts     # NEW: persists one-sentence summaries of past sessions (localStorage)
    ├── daily-kindness.ts          # 45 kindness acts, day-of-year rotation
    ├── daily-verse.ts             # 63 verses, deterministic UTC day-of-year pick
    ├── emotions.ts                # Emotion→video mapping + alias table
    ├── favorites.ts               # localStorage + CustomEvent change-broadcast
    ├── greeting.ts                # Time-of-day + day-of-week greeting pool
    ├── mood-content.ts            # NEW: 10 moods → curated verse/kindness/parable/prompt bundles
    ├── onboarding.ts              # First-run flag persistence
    ├── parables.ts                # 50 parables database
    ├── personalities.ts           # 9 personalities with prompts + provider
    ├── push-client.ts             # NEW (Wave 13): browser PushManager wrappers (subscribe/unsubscribe/permission)
    ├── push-keys.ts               # NEW (Wave 13): exposes NEXT_PUBLIC_VAPID_PUBLIC_KEY
    ├── push-server.ts             # NEW (Wave 13): in-memory Map + /tmp mirror — TODO Vercel KV before scale
    ├── rate-limit.ts              # UPDATED (Wave 13): added rateLimitAsync (Upstash + in-memory fallback)
    ├── search.ts                  # Client-side search across chat + favorites + parables
    ├── streaks.ts                 # Consecutive-day streak (local-time calendar, DST-safe)
    ├── suggested-prompts.ts       # 30 curated chips, daily round-robin
    ├── sw-config.ts               # SW_VERSION + SW_PATH constants
    ├── system-prompt.ts           # TEACHING_PROMPT only (SYSTEM_PROMPT removed)
    ├── toast.ts                   # Imperative toast API (CustomEvent dispatcher)
    └── types.ts                   # ActivePanel (incl. memories/search), VoiceState, Parable, PrayerRequest

public/
├── sw.js                          # Service worker — push + notificationclick added in Wave 13
├── manifest.json                  # PWA manifest
├── icon-{192,512}.png
└── (video + image assets…)

e2e/                               # NEW (Wave 13): Playwright end-to-end tests
├── README.md                      # Run + mocking instructions
├── fixtures.ts                    # clearStorage + mockApis auto-fixtures
├── onboarding.spec.ts             # First-run overlay
├── chat.spec.ts                   # Send + assistant reply
├── favorites.spec.ts              # Heart-tap + Saved drawer
├── parables.spec.ts               # ParablesDrawer + Reader
└── settings-export.spec.ts        # Settings → Export

playwright.config.ts               # NEW (Wave 13): Mobile Chrome (Pixel 5), dev-server auto-boot
vercel.json                        # NEW (Wave 13): daily-verse cron at 09:00 UTC
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

### 21. Pull-to-Refresh Resistance Pattern (NEW)
`usePullToRefresh` applies square-root-like resistance (`dy * 0.5`) so the indicator feels rubbery rather than 1:1 with the finger — a 100px finger drag becomes a 50px indicator pull. The clamp is at `maxPull` (default 120px) so the user can't drag arbitrarily far even with a fast flick. Gesture state lives in refs (`startYRef`, `startXRef`, `activeRef`, `abortedRef`, `pullRef`) so touchmove doesn't re-render React. React state is only updated via `requestAnimationFrame`, capping repaints at one per frame. On release past threshold: `pullRef` snaps to the threshold, `setIsRefreshing(true)`, the async `onRefresh()` promise drives the lifecycle, and the indicator animates back to 0 via ease-out cubic over 220ms (instant under `prefers-reduced-motion`).

### 22. Long-Press Movement-Cancel Pattern (NEW)
`useLongPress` arms a `setTimeout(threshold, …)` on touchstart/mousedown, but cancels it if the pointer moves past `movementCancelThreshold` (default 10px) — this lets the user scroll or drag naturally without triggering a context menu. Distance is checked as `dx² + dy² > t²` to avoid the sqrt. On a successful long-press, the trailing `touchend`/`mouseup` gets `preventDefault()` so the parent's `onClick` doesn't fire too (otherwise tapping to dismiss a long-press menu would also click the underlying message). `enableRightClick` (default true) fires immediately on `contextmenu` since right-click already has the intended semantics with no hold delay needed.

### 23. Service Worker + VersionCheck Coexistence (NEW)
The SW deliberately PASSES THROUGH `/api/*` requests so `VersionCheck`'s `/api/version` poll is unaffected — fresh build IDs are always fetched from network, never from cache. For HTML navigations the SW is network-first with a 3s timeout, so a new deploy is fetched and cached on first visit; offline / network-timeout users get the previous cached HTML. Static assets are cache-first with background revalidation. Together: when `VersionCheck` detects a build mismatch, it hard-reloads to `?_v=Date.now()`; the SW pulls the new HTML and updates its cache. The SW also has its own `CACHE_VERSION` separate from build IDs so the cache strategy can change without a code deploy (bump `SW_VERSION` in `src/lib/sw-config.ts` AND `CACHE_VERSION` in `public/sw.js` together — they must match).

### 24. Edge-Runtime OG Image Rendering (NEW)
`/api/og` uses `export const runtime = 'edge'` and `next/og`'s `ImageResponse` (Satori-backed React-to-PNG). Edge is fast and globally distributed; PNGs are deterministic for the same input, so they're aggressively cached (`max-age=3600, s-maxage=86400, immutable`). Three variants (`default`, `verse`, `message`) share a common `cardFrame` builder. JSX is built via explicit `createElement` calls rather than .tsx syntax — the route file is `.ts` per the project spec, and the visual output is identical. Defensive throughout: malformed input is sanitized, unknown `type` falls back to default, and even a Satori render exception falls back to the default card rather than 500ing — crawlers send weird stuff and we never want a broken image to be the unfurl.

### 25. Split System Messages: Cached Prefix + Fresh Tail (NEW)
Anthropic's prompt cache rewards a **stable prefix** — the cache hit is determined by the LONGEST exact-prefix match across system + messages. To exploit this while still injecting per-request context, `/api/chat` splits its system message into ordered fragments:

```
[ system: personality prompt          ] ← marked cacheControl: ephemeral (Claude only)
[ system: memoryContext (capped 4000c) ] ← uncached, varies per request
[ system: scene context (camera only)  ] ← uncached, varies per request
```

The personality prompt is identical across requests for a given personality → Anthropic re-serves the cached tokens at ~10% the original cost for ~5 minutes. The variable tails come AFTER the breakpoint so they don't invalidate the cache. Vision pings bypass this entirely — they use a one-shot constrained prompt where the cache would never hit and memory would be off-topic.

Generalizable rule: when you have stable + variable system content, put stable FIRST with a cache_control marker, then variable content after. Don't interleave — interleaving forces the cache to recompute from the diverged point. For non-Claude providers (Grok, DeepSeek) the same ordered list just becomes plain system messages — no harm, no benefit, but the architecture is uniform.

### 26. Visual-Viewport Keyboard Fix (NEW)
On iOS Safari, the soft keyboard shrinks `window.visualViewport.height` but leaves `window.innerHeight` unchanged. `position: sticky` elements anchored to the bottom of the viewport end up HIDDEN behind the keyboard. `ChatInterface` solves this by subscribing to `visualViewport.{resize,scroll}` events, computing `delta = window.innerHeight - visualViewport.height`, and adding that as `padding-bottom` on the sticky input container. Guarded against older browsers (no `visualViewport` support) — they skip the listener and get the original layout. The delta is also useful for any other bottom-anchored UI that needs to rise above the keyboard.

### 27. Per-Session Show Cap Pattern (NEW)
`SpeakingHint` is a "teach once, then stop nagging" UI. It tracks two pieces of state:
1. `shownThisEventRef` — has the hint already shown on THIS rising-edge of `voiceState === 'speaking'`? Reset when speech ends.
2. `sessionShowCountRef` — total appearances in this page-load session, capped at 3.

Combined: the hint can show MULTIPLE times per session (so the user genuinely encounters it once they start chatting), but never twice in the same speech turn, and never more than 3 total per page-load. Generalizable to any "discoverability nudge" UI — the per-event ref enforces "one per occurrence" while the per-session counter caps the lifetime nag count. Also pairs well with an `autoHideMs` so the hint doesn't linger even if the trigger condition stays active.

### 28. VAD with Dormant Gating (NEW)
`useVoiceActivityDetection` is fully dormant when `enabled = false` — no `AudioContext` is constructed, no `getUserMedia` is called, no rAF loop runs, no permission is requested. This is the privacy-conscious default: the hook is a no-op until the caller flips the gate. Wiring in `ChatInterface` is `enabled: vadConsent === 'accepted' && voiceState === 'speaking'` — so the mic engages ONLY when (a) the user has explicitly consented via `VADConsentPrompt`, AND (b) jAIsus is currently speaking. The hook's main effect depends on `[enabled]` so it spins up + tears down cleanly on every toggle. The cleanup function:
1. Cancels the rAF loop first (so we don't read freed buffers).
2. Disconnects the analyser graph (`source.disconnect()`, `analyser.disconnect()`).
3. Closes the `AudioContext` (releases the audio worklet thread).
4. Stops every mic track (this is what releases the OS recording indicator).
5. Clears every ref to null.

A `cancelled` local closure-flag handles the rapid enable/disable race: if `enabled` flips off while `getUserMedia` is still pending, the resolved stream's tracks are stopped immediately and the install is skipped — same pattern as `useCamera`'s generation counter (Key Design Decision #15), but a single-shot flag suffices here since the hook only runs one init at a time. Generalizable to ANY sensor hook (mic, camera, geolocation, accelerometer): start dormant, gate on explicit consent + a contextual condition, clean up aggressively on disable.

### 29. Native VAPID JWT Signing + RFC 8291 (NEW)
The `web-push` npm package is the obvious dep for Web Push — it's also ~100KB and pulls in a native binding for ECC operations. For an MVP-scale push channel, we don't need any of that — Node's stdlib `crypto` module already does ES256 ECDSA over P-256 and AES-128-GCM with HKDF. The cron handler at `/api/push/send-daily` implements the full protocol from scratch in ~250 lines.

**VAPID JWT** (`buildVapidAuth`): builds a JWS header (`{ typ: 'JWT', alg: 'ES256' }`) + payload (`{ aud: <endpoint origin>, exp: now + 12h, sub: VAPID_SUBJECT }`), base64url-encodes both, concatenates with `.`, and signs with `crypto.sign('SHA256', signingInput, { key, dsaEncoding: 'ieee-p1363' })`. The `ieee-p1363` encoding option is the load-bearing detail — without it, Node defaults to ASN.1 DER (which JWS does NOT accept; JWS expects raw r||s = 64 bytes for P-256). The private key is materialised as a JWK (`kty: 'EC', crv: 'P-256', x, y, d`) then loaded with `crypto.createPrivateKey({ format: 'jwk' })`.

**RFC 8291 aes128gcm payload encryption** (`encryptPayload`): generates an ephemeral P-256 keypair per send via `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`. Computes the ECDH shared secret with `crypto.diffieHellman({ privateKey: eph, publicKey: ua })` (the UA's pubkey is materialised from the JWK form of its `keys.p256dh`). Derives the IKM via HKDF over `(authSecret, sharedSecret, "WebPush: info\0" || ua_pub || eph_pub, 32)`, then derives a CEK (`Content-Encoding: aes128gcm\0`, 16 bytes) and nonce (`Content-Encoding: nonce\0`, 12 bytes) via HKDF over `(salt, IKM)`. Plaintext is `payload || 0x02` (the `0x02` is the single-record delimiter — last record in the aes128gcm content encoding). AES-128-GCM encrypts; output is `salt(16) || rs(4 = 4096) || idlen(1 = 65) || keyid(65 = ephemeral pubkey) || ciphertext || authTag`.

POSTed to the subscription endpoint with `Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`, `TTL: 86400`, `Urgency: normal`, and the VAPID JWT in `Authorization`. 201/202/200 → counted as sent; 404/410 → the subscription is gone, dropped from store; everything else → counted as failed and left in place (transient).

Generalizable rule: before reaching for a 100KB dep, check if the stdlib already supports the underlying primitive. `crypto.sign(..., { dsaEncoding: 'ieee-p1363' })` is a one-line replacement for almost any JWS-with-EC library; HKDF is six lines of HMAC-SHA-256 chaining.

### 30. Synchronous + Async Rate-Limit Duality (NEW)
`rate-limit.ts` keeps the original synchronous in-memory `rateLimit(key, config)` AND adds a new `rateLimitAsync(key, config)` backed by Upstash Redis. Both functions return the same `RateLimitResult` shape, so the existing helper `rateLimitResponse(rl)` works unchanged. Migration for a route is one keyword swap:

```typescript
const rl = rateLimit(`chat:${ip}`, CHAT_LIMIT);          // before
const rl = await rateLimitAsync(`chat:${ip}`, CHAT_LIMIT); // after
```

The async path is also self-healing: when Upstash env vars (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) are missing OR any pipeline call fails (network timeout >1s, non-2xx, malformed JSON, command-level error), it falls back to the in-memory limiter. A single `console.warn` is emitted on the FIRST fallback (subsequent fallbacks stay quiet to keep logs clean). The 1s timeout via `AbortController` is the load-bearing safety: a slow or down Upstash MUST NOT block the actual request — better to drift back to per-instance limits than to add latency to every API call.

Window math: fixed-window approximation with `windowSec = ceil(capacity / refillRatePerSec)`. So `{ capacity: 30, refillRatePerSec: 1 }` → 30s window, 30 requests allowed. The boundary edge case (a client can briefly see ~2x capacity at window rollover) is acceptable for these endpoints. Atomicity comes from an Upstash pipeline of `[INCR, EXPIRE]` — INCR returns the post-increment count, EXPIRE is harmless to re-set per call (the TTL bounds itself within the window).

Generalizable rule: when adding a distributed version of an existing utility, keep the OLD API working and add a NEW one with the same return shape. Don't force every caller to migrate at once — let the migration be incremental, lazy, and reversible. The fallback path also doubles as a local-dev "no extra infra needed" mode for free.

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
- ~~Find a Trump-like voice~~ — still placeholder.
- ~~Remove debug `console.log` from chat route~~ — done.
- ~~Mobile video first-load reliability~~ — much improved with dimension check + rAF + 12s safety.
- ~~Rate limiting on vision API calls~~ — done across chat/teachings/daily; vision route itself still unrate-limited (camera capture is throttled client-side to 10s).
- ~~Conversation export (markdown / audio mix)~~ — markdown + JSON + plaintext shipped in Wave 7 (`ExportButton` in Settings).
- ~~FavoritesPanel sharing-export — export all favorites as markdown~~ — covered by the conversation export above.
- ~~PWA service worker for offline shell + push notification readiness~~ — service worker shipped (Wave 8); push notifications still TODO.
- ~~Wire conversation memory server-side~~ — Wave 11 landed it. `memoriesAsContext(5)` ships in the transport body; `/api/chat` destructures `memoryContext`, caps at 4000 chars, injects as a separate non-cached system message after the cached personality prompt. Cache prefix preserved.
- ~~Wire OG meta tags into `layout.tsx`~~ — Wave 12 landed `metadata.openGraph` + `metadata.twitter` pointing at `/api/og?type=default`. Crawlers can now find the preview card.
- ~~Wire `useLongPress` + `ContextMenu` into `ChatMessage`~~ — Wave 11 landed it. Long-press / right-click on an assistant bubble opens a context menu with Copy / Share / Save-Unsave.
- ~~Memory management UI~~ — Wave 10 landed `MemoriesPanel` (slide-up drawer with per-row remove + two-tap clear-all).

### High Priority
- [ ] **Add `XAI_API_KEY` and `DEEPSEEK_API_KEY` to `.env.local`** for local testing
- [ ] **Find a Trump-like voice** in ElevenLabs (current Bill voice is placeholder)
- [ ] **Implement `/api/analytics`** to actually receive events. Right now the client sends to a 404 and drops the events.
- [ ] **Add provider error fallback** — if DeepSeek/Grok fails, fall back to Claude gracefully
- [ ] **Verse-variant OG image on the daily verse share button** — `/api/og?type=verse&text=&ref=` already supports it; just need ShareButton to use the verse-typed URL on verse shares.

### Medium Priority
- [ ] **Wire `usePullToRefresh` + `PullToRefreshIndicator`** into the empty state — pulls down to refresh the daily verse + kindness + suggested prompts.
- ~~Notifications opt-in~~ — landed in Wave 13/14. Full Web Push stack (subscribe + unsubscribe + cron + RFC 8291 encryption) shipped along with the consent UX. **Pending follow-up: generate VAPID keys + set env vars in production** (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`).
- ~~Voice interruption~~ — landed in Wave 13/14. `useVoiceActivityDetection` + `VADConsentPrompt` shipped; once consent is granted, sustained voice activity during TTS triggers `stopSpeaking()` + `reset()`.
- [ ] **Rate limit on `/api/vision`** — capture is client-throttled but server should still cap per-IP.
- ~~Distributed rate limiter (`@upstash/ratelimit`)~~ — landed in Wave 13/14. `rateLimitAsync` in `src/lib/rate-limit.ts` uses Upstash Redis when env vars are set, falls back to in-memory bucket otherwise. **Pending follow-up: migrate `/api/chat`, `/api/daily`, `/api/teachings`, `/api/summarize` to call `rateLimitAsync` (currently they all still use the sync `rateLimit`).**
- [ ] **Replace `/tmp/jaisus-push.json` push subscription storage** with Vercel KV / Upstash / Postgres. Current in-memory + `/tmp` mirror loses subscriptions on cold start, diverges across regions, and doesn't survive function-pool rotation. See `push-server.ts` TODO comment.
- [ ] **Re-enable notifications from Settings** — `NotificationOptInPrompt` records `markNotificationPromptSeen()` on both Accept and Decline and we never re-prompt. Settings should expose an explicit toggle so a declined user can change their mind.
- [ ] **Better error display** when provider API keys are missing — surface a real toast instead of silent failure.

### Ideas / Backlog
- [ ] **Community features** (prayer wall, shared experiences)
- [ ] **More video clips** for richer emotion mapping (currently 7 files mapped across 9 emotions)
- [ ] **Voice cloning** for personality-specific voices (e.g. real Trump voice for Trump Jesus)
- [ ] **User accounts / cloud persistence** (favorites + history + memories + streaks + prayers sync across devices)
- [ ] **Multi-language support** — verses, kindness acts, prompts, greetings all translatable
- [ ] **Streak rewards / milestones** — unlock a new personality skin / voice / parable collection at 7/30/100 days
- [ ] **Mood-driven home screen** — when MoodSelector is picked, show the curated bundle directly in the empty state rather than jumping into chat
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

### Conversation Memory Flow (NEW)
1. User hits `Clear` in `SettingsPanel` → `handleClearHistory` in `ChatInterface`
2. If `messages.length >= 2`, `summarizeAndSave(messages, personalityRef.current)` fires (async, no await — best-effort)
3. Hook strips messages to `{role, text}`, skips trivial conversations (<2 messages or <100 chars), POSTs to `/api/summarize`
4. `/api/summarize` rate-limits per IP (burst 20, 1/15s), truncates input from the front to 8000 chars, calls Claude Haiku with a 60-token cap and a tight system prompt
5. Response `{summary}` → `addMemory({summary, personalityId, messageCount})` → localStorage write → `jaisus-memories-changed` event
6. Any mounted `useConversationMemory` consumer (none yet, but the hook subscribes) re-reads via the event listener
7. **LIVE (Wave 11)**: the transport body for `/api/chat` includes `memoryContext: memoriesAsContext(5)` on every request. The server destructures it, caps at 4000 chars, and injects as a separate non-cached system message AFTER the cached personality prompt. Vision pings skip this entirely (one-shot prompt). Cross-session continuity is real now — jAIsus actually references past conversations.

### Service Worker Flow (NEW)
1. `layout.tsx` mounts `<ServiceWorkerRegistration />` in production only
2. After `requestIdleCallback`, `navigator.serviceWorker.register('/sw.js', {scope: '/'})` runs
3. SW `install`: precaches `/`, `/manifest.json`, the two hero videos. Individual 404s are tolerated.
4. SW `activate`: deletes any old `jaisus-*` caches whose version differs from `CACHE_VERSION`, then `clients.claim()`
5. `fetch` events:
   - `/api/*` → pass through (network only)
   - HTML navigation → network-first with 3s timeout, fall back to cache, fall back to inline offline HTML
   - Static asset → cache-first with background revalidation (stale-while-revalidate)
6. `VersionCheck` poll-on-focus runs independently — when a new buildId is detected, the page hard-reloads to `?_v=Date.now()`, and the SW pulls fresh HTML on the new navigation.

### Push Notification Flow (NEW — Wave 13/14)
1. User completes ≥ 2 chat exchanges (`messages.length >= 4`) → `ChatInterface` mounts `<NotificationOptInPrompt>` (gated against `showOnboarding` and `showVADPrompt`).
2. User taps "Yes, daily verse" → `usePushSubscription.subscribe()` → `Notification.requestPermission()` → `serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID_PUBLIC_KEY> })`.
3. Browser returns a `PushSubscription` (endpoint + p256dh + auth). Client POSTs `{ subscription: sub.toJSON() }` to `/api/push/subscribe`.
4. `/api/push/subscribe` validates shape (https endpoint, base64url keys), rate-limits 10/min/IP, stores in the in-memory Map + `/tmp/jaisus-push.json` mirror.
5. Daily at 09:00 UTC: Vercel cron hits `/api/push/send-daily` with `Authorization: Bearer ${CRON_SECRET}` → handler authenticates → loads subscriptions → builds a VAPID JWT (ES256 / P-256, 12h expiry) → encrypts today's verse payload per RFC 8291 aes128gcm → fans out POSTs in parallel.
6. Each subscription's push service either returns 201/202/200 (delivered to UA) or 404/410 (gone — handler removes from store).
7. UA receives the push → SW `push` event fires → `self.registration.showNotification(title, { body, icon, badge, data: { url }, tag: 'daily-verse' })`.
8. User taps → SW `notificationclick` event fires → focuses an open jAIsus tab if any, else `clients.openWindow(url)`.

### VAD Barge-In Flow (NEW — Wave 13/14)
1. User completes consent for VAD via `<VADConsentPrompt>` (surfaces once per session, first time `voiceState === 'speaking'` and `getVADConsent() === null`).
2. `setVADConsent('accepted')` persists to `jaisus-vad-consent` localStorage; state updates re-render `ChatInterface`.
3. `useVoiceActivityDetection({ enabled: true, onSpeechStart })` engages — `getUserMedia({ audio: true })` → `AudioContext` → `MediaStreamSource` → `AnalyserNode` (fftSize=2048, smoothingTimeConstant=0.4). NOT connected to `ctx.destination`.
4. rAF loop computes RMS on `getByteTimeDomainData` each frame. If RMS > threshold (default 0.02) sustained for ≥ 150ms, `onSpeechStart` fires → `stopSpeaking()` + `reset()`. The barge-in is complete.
5. When `voiceState` exits 'speaking' (or consent revoked), the hook's cleanup tears everything down: cancel rAF → disconnect graph → close `AudioContext` → stop tracks → clear refs → release OS mic indicator.

### OG Image Flow (NEW)
1. A social media crawler / chat preview fetches `/api/og?type=default` (or `?type=verse&text=…&ref=…`, etc.)
2. Edge runtime invokes the GET handler; query params are sanitized and clamped
3. Variant-specific `cardFrame(body)` builds a `ReactElement` tree via `React.createElement`
4. `next/og`'s `ImageResponse` rasterizes Satori → 1200x630 PNG
5. Response served with `Cache-Control: public, max-age=3600, s-maxage=86400, immutable`
6. **LIVE (Wave 12)**: `layout.tsx` `metadata.openGraph.images` + `metadata.twitter.images` point at `/api/og?type=default`. Crawlers parsing the initial HTML find the preview card and unfurl it on social platforms.

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
<pending tier-7 commit>  feat: tier-7 — voice barge-in (VAD), Web Push daily verse, distributed rate limit, E2E scaffold
<tier-6 commit>          feat: tier-6 — memories panel, search panel, speaking hint, server-side memory, OG meta wired
9be302e feat: tier-5 wire-up + HANDOVER refresh
8f90533 feat: tier-5 wave 8 — PWA service worker, OG images, reading mode, export
259c442 feat: tier-5 wave 7 — conversation memory, streaks, mood, pull-to-refresh, long-press
5d9af2e feat: wire Wave 4 panels into main UI + refresh handover docs
937c1f0 feat: polish wire-up — toasts, skeletons, empty states, analytics events
ab9ca02 feat: panels and feature components — favorites, share, personality switcher, greeting, daily kindness
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
