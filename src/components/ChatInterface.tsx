'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { ActivePanel } from '@/lib/types';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis, setStoredVoiceId } from '@/hooks/useSpeechSynthesis';
import { useVoiceState } from '@/hooks/useVoiceState';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useCamera } from '@/hooks/useCamera';
import { stripAllEmotionTags, type Emotion } from '@/lib/emotions';
import { HeroSection } from './HeroSection';
import { ActionButtons } from './ActionButtons';
import { ChatMessage } from './ChatMessage';
import { VoiceButton } from './VoiceButton';
import { ParablesDrawer } from './ParablesDrawer';
import { PrayerRequestForm } from './PrayerRequestForm';
import { TeachingPlayer } from './TeachingPlayer';
import { SettingsPanel, getStoredVisionInterval } from './SettingsPanel';
import { getPersonality, getStoredPersonalityId, setStoredPersonalityId, DEFAULT_PERSONALITY_ID } from '@/lib/personalities';
import { CommunityPlaceholder } from './CommunityPlaceholder';
import { OnboardingOverlay } from './OnboardingOverlay';
import { SuggestedPrompts } from './SuggestedPrompts';
import { DailyVerse } from './DailyVerse';
import { DailyKindness } from './DailyKindness';
import { GreetingHeader } from './GreetingHeader';
import { FavoritesPanel } from './FavoritesPanel';
import { MemoriesPanel } from './MemoriesPanel';
import { SearchPanel } from './SearchPanel';
import { SpeakingHint } from './SpeakingHint';
import { PersonalitySwitcher } from './PersonalitySwitcher';
import { StreakBadge } from './StreakBadge';
import { MoodSelector } from './MoodSelector';
import { hasSeenOnboarding, markOnboardingSeen } from '@/lib/onboarding';
import { track } from '@/lib/analytics';
import { useConversationMemory } from '@/hooks/useConversationMemory';
import { memoriesAsContext } from '@/lib/conversation-memory';
import { getCustomPersonality, isCustomId } from '@/lib/custom-personalities';
import { PersonalityCreator } from './PersonalityCreator';
import { useVoiceActivityDetection } from '@/hooks/useVoiceActivityDetection';
import { VADConsentPrompt, getVADConsent, setVADConsent, type VADConsent } from './VADConsentPrompt';
import { NotificationOptInPrompt, hasSeenNotificationPrompt } from './NotificationOptInPrompt';
import { VoiceMemoModal } from './VoiceMemoModal';
import { SavedMemosPanel } from './SavedMemosPanel';

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>('neutral');
  const [visionInterval, setVisionInterval] = useState(60);
  const [personalityId, setPersonalityId] = useState('mushroom-guru');
  // iOS soft-keyboard offset. visualViewport shrinks when the keyboard opens;
  // we add that gap to the input container's padding-bottom so the text input
  // doesn't get hidden behind the keyboard. Skipped if visualViewport is
  // unsupported (older browsers — they get the original layout).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // VAD consent + visibility. `vadConsent` starts null on mount (we read the
  // persisted value inside the didLoadRef effect below). `showVADPrompt`
  // toggles the modal; we guard with `vadPromptShownRef` so the prompt only
  // surfaces once per session even if the user re-enters speaking state.
  const [vadConsent, setVadConsent] = useState<VADConsent | null>(null);
  const [showVADPrompt, setShowVADPrompt] = useState(false);
  const vadPromptShownRef = useRef(false);
  // Notification opt-in modal — gated behind a few conditions checked in the
  // effect below (enough messages, no other modal open, not previously seen).
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const personalityRef = useRef('mushroom-guru');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>('ready');
  const activeMessageIdRef = useRef<string | null>(null);
  const lastSpokenTextRef = useRef<string>('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendMessageRef = useRef<any>(null);

  const { loadMessages, saveMessages, clearHistory } = useChatHistory();
  const { summarizeAndSave } = useConversationMemory();
  const { voiceState, startListening, startProcessing, startSpeaking, reset } = useVoiceState();
  const { speak, queueSentence, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();
  const spokenLengthRef = useRef(0);
  const queuedSentencesRef = useRef<Set<string>>(new Set());

  // Camera / vision
  const { isActive: cameraActive, sceneDescription, videoRef, toggle: toggleCamera, isSupported: cameraSupported, error: cameraError } = useCamera();
  // Keep scene in a ref so the transport body can access it without re-creating
  const sceneRef = useRef<string | null>(null);
  useEffect(() => { sceneRef.current = sceneDescription; }, [sceneDescription]);

  // iOS mobile-keyboard fix: when the soft keyboard opens, the visualViewport
  // shrinks but window.innerHeight stays the same. We compute the delta and
  // push that as padding-bottom on the sticky input container so the text
  // field rises above the keyboard. Guarded so older browsers (no visualViewport)
  // skip this entirely.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height);
      setKeyboardHeight(offset);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Transport with dynamic body — reads sceneRef and personalityRef on each request
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => {
      const scene = sceneRef.current;
      // memoriesAsContext() reads localStorage on every call, so we invoke it
      // INSIDE the body callback (not at component mount) — that way each new
      // request sees the latest memories. Cap at 5 to keep the system prompt
      // size reasonable; the server applies its own 4000-char safety net.
      const memoryContext = memoriesAsContext(5);
      // Always include the latest scene if camera is active — the AI needs
      // the most current view even if the capture is a few seconds old.
      // Only omit if there's genuinely no scene at all.
      // If the active personality is a user-authored custom one, also include
      // the full definition inline. The server can't reach into the client's
      // localStorage to look it up by id alone — so we send it on every
      // request when relevant. Server-side validation enforces the same
      // length caps and locks provider to 'claude'.
      let customPersonality: ReturnType<typeof getCustomPersonality> | undefined;
      if (isCustomId(personalityRef.current)) {
        customPersonality = getCustomPersonality(personalityRef.current) ?? undefined;
      }
      return {
        personalityId: personalityRef.current,
        ...(scene ? { sceneDescription: scene } : {}),
        ...(memoryContext ? { memoryContext } : {}),
        ...(customPersonality ? { customPersonality } : {}),
      };
    },
  }), []);

  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  // Auto-vision: periodic + immediate first reaction
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  const mountedRef = useRef(false);
  useEffect(() => { mountedRef.current = mounted; }, [mounted]);

  // Immediate first reaction when camera turns on and first scene arrives.
  // `tryFirstTimeoutRef` tracks the recursive setTimeout chain so we can
  // cancel it on camera-off / unmount and prevent a stale sendMessage when
  // the user disables the camera mid-poll.
  const hasReactedToCamera = useRef(false);
  const tryFirstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `lastVisionPingTimeRef` persists across re-runs of the auto-vision effect.
  // Previously this lived as `let lastPingTime` inside the effect, which
  // meant changing the vision-interval slider reset it to Date.now() — a
  // user who shortened the interval mid-session waited the FULL new interval
  // before the next ping. With a ref the timestamp survives effect remounts.
  const lastVisionPingTimeRef = useRef(0);
  useEffect(() => {
    // Reset when camera turns off
    if (!cameraActive) {
      hasReactedToCamera.current = false;
      if (tryFirstTimeoutRef.current !== null) {
        clearTimeout(tryFirstTimeoutRef.current);
        tryFirstTimeoutRef.current = null;
      }
      return;
    }
    // Fire once when we get the first scene description
    if (hasReactedToCamera.current) return;
    if (!sceneDescription) return;
    if (!mountedRef.current) return;

    hasReactedToCamera.current = true;
    console.log('First camera reaction — immediate vision ping');

    // Wait for status to be ready, then send. The recursive setTimeout is
    // tracked in a ref so we can cancel it if the user turns the camera
    // off / the component unmounts during the wait.
    const tryFirst = () => {
      tryFirstTimeoutRef.current = null;
      if (!mountedRef.current || !cameraActive) return;
      if (statusRef.current !== 'ready') {
        tryFirstTimeoutRef.current = setTimeout(tryFirst, 500);
        return;
      }
      try {
        sendMessageRef.current({ text: '(You just opened your eyes and can see the user for the first time. React with excitement and warmth to what you see!)' });
      } catch (err) {
        console.warn('Immediate vision sendMessage failed:', err);
      }
    };
    tryFirst();

    return () => {
      if (tryFirstTimeoutRef.current !== null) {
        clearTimeout(tryFirstTimeoutRef.current);
        tryFirstTimeoutRef.current = null;
      }
    };
  }, [cameraActive, sceneDescription]);

  // Recurring auto-vision: periodic prompts while camera is active
  // Uses a fast tick (2s) but tracks time since last successful ping
  // so it fires immediately once jAIsus finishes speaking
  useEffect(() => {
    if (!cameraActive || !autoSpeak) return;

    const visionPrompts = [
      '(observe what you see and comment naturally)',
      '(look around and share what catches your eye)',
      '(react to what you see right now)',
      '(notice something about the scene and mention it)',
      '(comment on what is happening around you)',
    ];
    let promptIndex = 0;
    // First-ever auto-ping after camera activation: seed to "now" so we don't
    // immediately fire (the first-reaction effect already handled that path).
    // On subsequent effect re-runs (e.g. visionInterval slider changes), the
    // ref's previous value survives — so a shortened interval can fire
    // immediately if enough time has already elapsed since the last ping.
    if (lastVisionPingTimeRef.current === 0) {
      lastVisionPingTimeRef.current = Date.now();
    }

    console.log('Auto-vision interval set to', visionInterval, 'seconds');
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      if (!sceneRef.current) return;
      // Skip while tab is hidden — user can't see the response and Gemini
      // quota is finite. Resumes naturally when the tab returns.
      if (typeof document !== 'undefined' && document.hidden) return;
      // Check if enough time has elapsed since last successful ping
      const elapsed = (Date.now() - lastVisionPingTimeRef.current) / 1000;
      if (elapsed < visionInterval) return;
      // Wait for ready status — but because we tick every 2s, we'll
      // catch the moment jAIsus finishes speaking almost immediately
      if (statusRef.current !== 'ready') return;

      lastVisionPingTimeRef.current = Date.now();
      const prompt = visionPrompts[promptIndex % visionPrompts.length];
      promptIndex++;
      console.log('Auto-vision ping:', prompt);
      try {
        sendMessageRef.current({ text: prompt });
      } catch (err) {
        console.warn('Auto-vision sendMessage failed:', err);
      }
    }, 2000); // Fast tick — actual interval controlled by lastVisionPingTimeRef

    return () => clearInterval(interval);
  }, [cameraActive, autoSpeak, visionInterval]);

  // Reset the auto-vision timestamp when the camera turns off so the next
  // camera activation seeds fresh from "now" rather than firing immediately.
  useEffect(() => {
    if (!cameraActive) {
      lastVisionPingTimeRef.current = 0;
    }
  }, [cameraActive]);

  // Load history + settings on mount
  // Load history + settings exactly ONCE on mount.
  // Previously this depended on [loadMessages, setMessages] — both of which can
  // change identity across renders (especially setMessages from useChat after
  // streaming starts). Re-running would overwrite in-flight messages with the
  // stale snapshot from localStorage. The didLoadRef guard makes this idempotent.
  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    const saved = loadMessages();
    if (saved.length > 0) {
      setMessages(saved);
    }
    setVisionInterval(getStoredVisionInterval());
    const storedPid = getStoredPersonalityId();
    setPersonalityId(storedPid);
    personalityRef.current = storedPid;
    // Set voice to match personality
    const p = getPersonality(storedPid);
    setStoredVoiceId(p.voiceId);
    setMounted(true);
    // Show first-run onboarding overlay when localStorage says we haven't yet.
    // Checked here (client-side, post-mount) to avoid SSR hydration mismatch.
    if (!hasSeenOnboarding()) {
      setShowOnboarding(true);
    }
    // Read persisted VAD consent (null = never decided). The prompt itself
    // is gated by a separate effect that fires when voiceState first hits
    // 'speaking', so we just need the value in state here.
    setVadConsent(getVADConsent());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleOnboardingComplete() {
    markOnboardingSeen();
    setShowOnboarding(false);
    track('onboarding.completed');
  }

  // Save messages with debouncing.
  // Previously fired on every render with a `messages` change — including each
  // streaming token, which meant a localStorage write per chunk (main-thread
  // jank on mobile and unnecessary I/O). Now coalesces rapid changes into a
  // single write every 500ms, with a final flush when status returns to ready.
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!mounted || messages.length === 0) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    // Flush immediately when status is ready (end of turn); otherwise debounce.
    const delay = status === 'ready' ? 0 : 500;
    saveTimeoutRef.current = setTimeout(() => {
      saveMessages(messages);
      saveTimeoutRef.current = null;
    }, delay);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [messages, saveMessages, mounted, status]);

  // Streaming TTS: feed sentences to the queue as they arrive during streaming
  useEffect(() => {
    if (!autoSpeak || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    const rawText = lastMessage.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join('');

    if (!rawText) return;

    const { lastEmotion, cleanText: fullText } = stripAllEmotionTags(rawText);
    if (lastEmotion !== 'neutral') {
      setCurrentEmotion(lastEmotion);
    }

    if (status === 'streaming' && activeMessageIdRef.current !== lastMessage.id) {
      // Dedup: if the AI SDK replaces the message object with a new ID but same text, don't re-speak
      if (fullText && fullText === lastSpokenTextRef.current) {
        activeMessageIdRef.current = lastMessage.id;
        // Skip — already spoken this exact text
        prevStatusRef.current = status;
        return;
      }
      activeMessageIdRef.current = lastMessage.id;
      startSpeaking();
      spokenLengthRef.current = 0;
      queuedSentencesRef.current = new Set();
    }

    if (status === 'streaming' || (prevStatusRef.current === 'streaming' && status === 'ready')) {
      const unprocessed = fullText.slice(spokenLengthRef.current);
      // Split on sentence-ending punctuation
      const sentenceRegex = /[^.!?]+[.!?]+/g;
      let match;
      let lastEnd = 0;
      while ((match = sentenceRegex.exec(unprocessed)) !== null) {
        const trimmed = match[0].trim();
        // Break long sentences (>120 chars) at em-dashes or commas to avoid TTS timeouts
        const chunks = trimmed.length > 120
          ? trimmed.split(/(?<=[,;])\s+| — |—/).filter(c => c.trim().length > 3)
          : [trimmed];
        for (const chunk of chunks) {
          const c = chunk.trim();
          if (c.length > 5 && !queuedSentencesRef.current.has(c)) {
            queuedSentencesRef.current.add(c);
            queueSentence(c);
          }
        }
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd > 0) {
        spokenLengthRef.current += lastEnd;
      }
    }

    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      const remaining = fullText.slice(spokenLengthRef.current).trim();
      if (remaining.length > 5 && !queuedSentencesRef.current.has(remaining)) {
        queuedSentencesRef.current.add(remaining);
        queueSentence(remaining);
      }
      queueSentence(null);
      lastSpokenTextRef.current = fullText; // Track for dedup
      spokenLengthRef.current = 0;
    }

    prevStatusRef.current = status;
  }, [status, messages, autoSpeak, queueSentence, startSpeaking]);

  useEffect(() => {
    if (!isSpeaking && voiceState === 'speaking') {
      activeMessageIdRef.current = null;
      reset();
    }
  }, [isSpeaking, voiceState, reset]);

  // First time we hit speaking state in a session, and consent hasn't been
  // decided yet, surface the one-time consent prompt. The ref guard ensures
  // it only shows once per page-load even if the user toggles in/out of
  // speaking state multiple times. We also avoid stacking on top of
  // onboarding (looks awful, the user will dismiss without reading).
  useEffect(() => {
    if (vadConsent !== null) return;
    if (vadPromptShownRef.current) return;
    if (voiceState !== 'speaking') return;
    if (showOnboarding) return;
    vadPromptShownRef.current = true;
    setShowVADPrompt(true);
  }, [vadConsent, voiceState, showOnboarding]);

  // VAD hook — fully dormant unless consent is granted AND jAIsus is
  // currently speaking. When it detects sustained voice activity, it
  // stops TTS and resets the voice state machine so the user can talk
  // naturally without tapping anything. (Barge-in interrupt.)
  useVoiceActivityDetection({
    enabled: vadConsent === 'accepted' && voiceState === 'speaking',
    onSpeechStart: () => {
      stopSpeaking();
      reset();
    },
  });

  // Notification opt-in — surface once the user has clearly engaged with
  // the app. Gated against stacking with onboarding or the VAD prompt so
  // modals never pile up. We also check `hasSeenNotificationPrompt()` so a
  // previous decision is honored.
  //
  // Rising-edge guard: a useRef ensures we only EVER set the prompt to true
  // once per page load. Without it, the effect could re-fire (e.g. when
  // showVADPrompt flips off and messages keep arriving from vision pings)
  // and re-open the prompt even after the user dismissed it but before
  // hasSeenNotificationPrompt() has been persisted by the modal.
  //
  // Engagement gate also filters out auto-vision parenthetical pings so the
  // "engagement" threshold reflects real user-driven exchanges, not just
  // ambient camera commentary.
  const notifPromptShownRef = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (notifPromptShownRef.current) return;
    if (showOnboarding || showVADPrompt) return;
    if (hasSeenNotificationPrompt()) return;
    // Count only user-visible messages (skip auto-vision pings starting with '(')
    const visibleCount = messages.filter((m) => {
      if (m.role !== 'user') return true;
      const text = m.parts
        ?.filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('') ?? '';
      return !(text.startsWith('(') && text.endsWith(')'));
    }).length;
    if (visibleCount < 4) return;
    notifPromptShownRef.current = true;
    setShowNotificationPrompt(true);
  }, [messages, showOnboarding, showVADPrompt, mounted]);

  // Auto-scroll the chat to the latest message, but only when the user is
  // already near the bottom. Previously this fired on every streaming token
  // with `behavior: 'smooth'`, which:
  //   1. Hijacked the page scroll if the user scrolled up to re-read.
  //   2. Jank-locked iOS Safari during long streams (queued smooth-scrolls
  //      compete with the user's touch-scroll inertia).
  // Now: 'auto' instead of 'smooth', and only scrolls if the user is within
  // 120px of the bottom (i.e., they hadn't deliberately scrolled away).
  useEffect(() => {
    const end = chatEndRef.current;
    if (!end) return;
    // Find the scrollable ancestor. The chat list lives inside an
    // overflow-y-auto container; if we can't find one, fall back to the
    // viewport so the behavior degrades gracefully.
    let scroller: HTMLElement | null = end.parentElement;
    while (scroller && scroller !== document.body) {
      const style = window.getComputedStyle(scroller);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') break;
      scroller = scroller.parentElement;
    }
    const nearBottom = scroller && scroller !== document.body
      ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120
      : window.innerHeight + window.scrollY > document.body.offsetHeight - 120;
    if (nearBottom) {
      end.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [messages]);

  const handleVoiceResult = useCallback((transcript: string) => {
    console.log('handleVoiceResult called:', transcript);
    startProcessing();
    try {
      sendMessage({ text: transcript });
    } catch (err) {
      console.error('sendMessage error:', err);
    }
  }, [startProcessing, sendMessage]);

  const { interimTranscript, isListening, isSupported, error: voiceError, start: startRecognition, stop: stopRecognition } = useSpeechRecognition(handleVoiceResult);

  useEffect(() => {
    if (isSpeaking && isListening) {
      stopRecognition();
    }
  }, [isSpeaking, isListening, stopRecognition]);

  useEffect(() => {
    if (isListening) {
      startListening();
    } else if (voiceState === 'listening') {
      if (status !== 'submitted' && status !== 'streaming') {
        reset();
      }
    }
  }, [isListening, voiceState, status, startListening, reset]);

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || status !== 'ready') return;
    sendMessage({ text: input });
    setInput('');
  }

  function handleAskAbout(prompt: string) {
    sendMessage({ text: prompt });
  }

  function handleAskQuestion() {
    if (isSupported) {
      startRecognition();
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function handleVoiceToggle() {
    if (voiceState === 'listening') {
      stopRecognition();
    } else if (voiceState === 'speaking' || isSpeaking) {
      stopSpeaking();
      reset();
      setTimeout(() => startRecognition(), 150);
    } else {
      startRecognition();
    }
  }

  function handleClearHistory() {
    // Before wiping, save a one-sentence summary of the conversation so jAIsus
    // can carry a thread of memory into the next session. Best-effort, async,
    // doesn't block clearing.
    if (messages.length >= 2) {
      summarizeAndSave(messages, personalityRef.current).catch(() => { /* silent */ });
    }
    // Reset streaming-TTS state so stale references from the cleared
    // conversation can't re-fire next time. Previously: prevStatusRef stayed
    // 'streaming' if a clear happened mid-stream, causing the next message to
    // skip the start-up branch and replay sentences from the old activeMessageId.
    stopSpeaking();
    prevStatusRef.current = 'ready';
    spokenLengthRef.current = 0;
    queuedSentencesRef.current.clear();
    activeMessageIdRef.current = null;
    lastSpokenTextRef.current = '';
    clearHistory();
    setMessages([]);
  }

  function handlePersonalityChange(id: string) {
    setPersonalityId(id);
    personalityRef.current = id;
    setStoredPersonalityId(id);
    // Auto-switch voice to match personality
    const p = getPersonality(id);
    setStoredVoiceId(p.voiceId);
  }

  function handleVisionIntervalChange(seconds: number) {
    setVisionInterval(seconds);
    try {
      localStorage.setItem('jaisus-vision-interval', String(seconds));
    } catch { /* */ }
  }

  return (
    <div className="flex flex-col min-h-screen bg-stone-50">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <HeroSection voiceState={voiceState} interimTranscript={interimTranscript} emotion={currentEmotion} />

        {/* Fast personality switcher — lives just below the hero so the user
            can taste-test different vibes without opening Settings. The "+"
            chip on the right opens the PersonalityCreator. */}
        {mounted && (
          <div className="px-4 pt-2 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <PersonalitySwitcher
                activeId={personalityId}
                onChange={handlePersonalityChange}
              />
            </div>
            <button
              type="button"
              onClick={() => setActivePanel('personality-creator')}
              className="shrink-0 w-10 h-10 rounded-full bg-white border border-stone-200 text-stone-600 text-xl leading-none flex items-center justify-center hover:border-amber-300 active:scale-95"
              aria-label="Create custom personality"
              title="Create your own jAIsus"
            >
              +
            </button>
          </div>
        )}

        {!autoSpeak && (
          <ActionButtons
            onAskQuestion={handleAskQuestion}
            onOpenPanel={setActivePanel}
          />
        )}

        {autoSpeak ? (
          <>
            <div className="flex-1" />

            {/* Camera preview + scene caption */}
            <div className={`px-4 pb-2 ${cameraActive ? '' : 'hidden'}`}>
              <div className="flex items-end gap-3 justify-center">
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-amber-400/50 shadow-lg flex-shrink-0">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                </div>
                {sceneDescription && (
                  <div className="bg-stone-800/80 backdrop-blur-sm rounded-xl px-3 py-2 max-w-[220px] shadow-md">
                    <p className="text-xs text-stone-200 leading-relaxed">{sceneDescription}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Status indicators */}
            <div className="px-4 py-3 text-center">
              {(voiceError || cameraError) && (
                <div className="py-2 px-3 bg-amber-50/90 border border-amber-200 rounded-lg text-amber-700 text-xs mb-2">
                  {voiceError || cameraError}
                </div>
              )}
              {(status === 'submitted' || status === 'streaming') && (
                <div className="flex items-center justify-center gap-2 py-2 text-stone-400 text-xs">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <span>thinking...</span>
                </div>
              )}
              {isSpeaking && (
                <div className="flex items-center justify-center gap-2 py-2 text-amber-600 text-xs">
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map(i => {
                      const heights = [12, 14, 10, 15, 11];
                      return (
                        <div key={i} className="w-1 rounded-full bg-amber-400 animate-pulse" style={{ height: `${heights[i]}px`, animationDelay: `${i * 0.15}s` }} />
                      );
                    })}
                  </div>
                  <span>speaking...</span>
                </div>
              )}
            </div>

            {/* Transcript overlay */}
            {showTranscript && messages.length > 0 && (
              <div className="px-4 pb-2 max-h-48 overflow-y-auto">
                <div className="bg-black/60 backdrop-blur-sm rounded-xl p-3 space-y-2">
                  {messages.map(message => {
                    const rawMsgText = message.parts
                      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
                      .map(p => p.text)
                      .join('');
                    // Hide auto-vision ping messages from transcript
                    if (message.role === 'user' && rawMsgText.startsWith('(') && rawMsgText.endsWith(')')) return null;
                    const displayText = message.role === 'assistant' ? stripAllEmotionTags(rawMsgText).cleanText : rawMsgText;
                    return (
                      <div key={message.id} className={`text-xs ${message.role === 'user' ? 'text-teal-300' : 'text-stone-200'}`}>
                        <span className="font-bold">{message.role === 'user' ? 'You' : 'jAIsus'}:</span>{' '}
                        {displayText}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Floating buttons + text input: settings, mic, camera, transcript */}
            <div
              className="sticky bottom-0 bg-stone-50/90 backdrop-blur-sm px-4 py-3"
              style={keyboardHeight > 0 ? { paddingBottom: 12 + keyboardHeight } : undefined}
            >
              {/* Text input row — always visible for keyboard questions */}
              <form onSubmit={handleTextSubmit} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={status !== 'ready'}
                  placeholder="Type your question..."
                  className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent
                    disabled:opacity-50"
                />
                {input.trim() && (
                  <button
                    type="submit"
                    disabled={status !== 'ready'}
                    className="w-9 h-9 rounded-full bg-teal-500 text-white flex items-center justify-center active:scale-95 transition-transform shadow-sm disabled:opacity-50"
                    aria-label="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                )}
              </form>

              <div className="flex items-center justify-center gap-3">
                {/* Settings */}
                <button
                  onClick={() => setActivePanel('settings')}
                  className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 active:scale-95 transition-transform shadow-sm"
                  aria-label="Settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </svg>
                </button>

                {/* Camera toggle */}
                {cameraSupported && (
                  <button
                    onClick={toggleCamera}
                    className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-sm ${
                      cameraActive ? 'bg-amber-500 text-white' : 'bg-stone-200 text-stone-500'
                    }`}
                    aria-label={cameraActive ? 'Turn off camera' : 'Let Jesus see you'}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {cameraActive ? (
                        <>
                          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                        </>
                      ) : (
                        <>
                          <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                          <line x1="1" y1="1" x2="23" y2="23" strokeWidth="2"/>
                        </>
                      )}
                    </svg>
                  </button>
                )}

                {/* Mic */}
                <VoiceButton
                  voiceState={voiceState}
                  onStart={handleVoiceToggle}
                  onStop={handleVoiceToggle}
                  isSupported={isSupported}
                />

                {/* Transcript toggle */}
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-sm ${
                    showTranscript ? 'bg-teal-500 text-white' : 'bg-stone-200 text-stone-500'
                  }`}
                  aria-label="Show transcript"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 px-4 py-2 space-y-3 overflow-y-auto border-t border-stone-200">
              {voiceError && (
                <div className="text-center py-2 px-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs animate-fade-in">
                  {voiceError}
                </div>
              )}
              {messages.length === 0 && mounted && !voiceError && (
                <div className="space-y-4 py-2 animate-fade-in">
                  <div className="flex justify-center">
                    <StreakBadge />
                  </div>
                  <GreetingHeader />
                  <DailyVerse />
                  <DailyKindness />
                  <SuggestedPrompts
                    onPick={(text) => {
                      track('suggestion.picked');
                      sendMessage({ text });
                    }}
                  />
                  <MoodSelector
                    onPick={(mood, content) => {
                      track('mood.picked', { mood: mood.id });
                      // Compose a natural opener combining the mood label and a starter prompt
                      const text = content.promptText ?? `I'm feeling ${mood.label.toLowerCase()}.`;
                      sendMessage({ text });
                    }}
                  />
                </div>
              )}
              {messages.map(message => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {status === 'submitted' && (
                <div className="flex justify-start animate-fade-in">
                  <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map(i => (
                        <div key={i} className="w-2 h-2 rounded-full bg-teal-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div
              className="sticky bottom-0 bg-stone-50/95 backdrop-blur-sm border-t border-stone-200 px-4 py-3"
              style={keyboardHeight > 0 ? { paddingBottom: 12 + keyboardHeight } : undefined}
            >
              <form onSubmit={handleTextSubmit} className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  disabled={status !== 'ready'}
                  placeholder="Type your question..."
                  className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm
                    focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent
                    disabled:opacity-50"
                />
                <VoiceButton
                  voiceState={voiceState}
                  onStart={handleVoiceToggle}
                  onStop={handleVoiceToggle}
                  isSupported={isSupported}
                />
              </form>
            </div>
          </>
        )}
      </div>

      {/* Panels */}
      <ParablesDrawer
        isOpen={activePanel === 'parables'}
        onClose={() => setActivePanel('none')}
        onAskAbout={handleAskAbout}
      />
      <PrayerRequestForm
        isOpen={activePanel === 'prayer'}
        onClose={() => setActivePanel('none')}
      />
      <TeachingPlayer
        isOpen={activePanel === 'teachings'}
        onClose={() => setActivePanel('none')}
        onSpeak={speak}
        isSpeaking={isSpeaking}
        onStopSpeaking={stopSpeaking}
      />
      <SettingsPanel
        isOpen={activePanel === 'settings'}
        onClose={() => setActivePanel('none')}
        autoSpeak={autoSpeak}
        onToggleAutoSpeak={() => setAutoSpeak(!autoSpeak)}
        onClearHistory={handleClearHistory}
        onTestVoice={() => speak('Peace be with you, my friend. I have walked among you for two thousand years.')}
        visionInterval={visionInterval}
        onVisionIntervalChange={handleVisionIntervalChange}
        cameraActive={cameraActive}
        personalityId={personalityId}
        onPersonalityChange={handlePersonalityChange}
      />
      <CommunityPlaceholder
        isOpen={activePanel === 'community'}
        onClose={() => setActivePanel('none')}
      />
      <OnboardingOverlay
        isOpen={showOnboarding}
        onComplete={handleOnboardingComplete}
      />
      <FavoritesPanel
        isOpen={activePanel === 'favorites'}
        onClose={() => setActivePanel('none')}
        onAskAgain={(text) => sendMessage({ text })}
      />
      <MemoriesPanel
        isOpen={activePanel === 'memories'}
        onClose={() => setActivePanel('none')}
      />
      <SearchPanel
        isOpen={activePanel === 'search'}
        onClose={() => setActivePanel('none')}
        onAskAbout={(text) => sendMessage({ text })}
      />

      {/* Voice memo / journal mode. Records up to 5 min, sends to /api/memo
          (Gemini STT → Claude reflection), shows summary + themes + response,
          plays back via the parent's TTS so the same voice the user just
          picked in the personality switcher is the one reflecting back. */}
      <VoiceMemoModal
        isOpen={activePanel === 'voice-memo'}
        onClose={() => setActivePanel('none')}
        onSpeak={speak}
        onStopSpeaking={stopSpeaking}
        isSpeaking={isSpeaking}
        onOpenSaved={() => setActivePanel('saved-memos')}
      />

      {/* Saved memos list — reactive to MEMOS_CHANGED_EVENT + cross-tab
          storage, so new memos appear instantly. Listen replays the
          response in the currently-active personality voice (the voice
          that was active at record time is intentionally NOT carried —
          the user picks their guide today, not historically). */}
      <SavedMemosPanel
        isOpen={activePanel === 'saved-memos'}
        onClose={() => setActivePanel('none')}
        onSpeak={speak}
        onStopSpeaking={stopSpeaking}
        isSpeaking={isSpeaking}
      />

      {/* User-authored personality designer. On save, auto-switches to the
          new personality so the user can immediately try it. */}
      <PersonalityCreator
        isOpen={activePanel === 'personality-creator'}
        onClose={() => setActivePanel('none')}
        onSaved={(p) => {
          handlePersonalityChange(p.id);
        }}
        onDeleted={(deletedId) => {
          // If the deleted personality was the active one, snap back to the
          // default so the transport doesn't keep sending a stale id (which
          // would silently fall back to Mushroom Guru server-side without
          // any UI indication).
          if (personalityRef.current === deletedId) {
            handlePersonalityChange(DEFAULT_PERSONALITY_ID);
          }
        }}
      />

      {/* VAD consent — fired once per session when voiceState first hits
          'speaking' and consent is still null. Persists to localStorage. */}
      <VADConsentPrompt
        isOpen={showVADPrompt}
        onAccept={() => {
          setVADConsent('accepted');
          setVadConsent('accepted');
          setShowVADPrompt(false);
        }}
        onDecline={() => {
          setVADConsent('declined');
          setVadConsent('declined');
          setShowVADPrompt(false);
        }}
      />

      {/* Daily-verse push opt-in — surfaced after the user has had a couple
          of exchanges. The prompt's own component records the seen-flag. */}
      <NotificationOptInPrompt
        isOpen={showNotificationPrompt}
        onDeclined={() => setShowNotificationPrompt(false)}
        onAccepted={() => setShowNotificationPrompt(false)}
      />

      {/* SpeakingHint lives at the root, outside the scrollable chat container,
          so its `fixed` positioning is anchored to the viewport (not clipped
          by an ancestor's overflow). */}
      <SpeakingHint
        voiceState={voiceState}
        onInterrupt={() => stopSpeaking()}
      />
    </div>
  );
}
