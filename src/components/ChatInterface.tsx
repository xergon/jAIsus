'use client';

import { useState, useEffect, useEffectEvent, useRef, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import type { ActivePanel } from '@/lib/types';
import { FIRST_VISION_PROMPT, VISION_PROMPTS, isVisionPingText } from '@/lib/vision-prompts';
import { useSpeechRecognition, type SpeechSessionEnd } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis, setStoredVoiceId, getVoiceOverride, setVoiceOverride } from '@/hooks/useSpeechSynthesis';
import { useVoiceState } from '@/hooks/useVoiceState';
import { useChatHistory, CHAT_HISTORY_KEY } from '@/hooks/useChatHistory';
import { useCamera } from '@/hooks/useCamera';
import { emotionAt, stripAllEmotionTags, type Emotion, type HeroState } from '@/lib/emotions';
import { HeroSection } from './HeroSection';
import { ActionButtons } from './ActionButtons';
import { ChatMessage, stripPartialEmotionTag } from './ChatMessage';
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
import { recordActivity } from '@/lib/streaks';
import { MoodSelector } from './MoodSelector';
import { hasSeenOnboarding, markOnboardingSeen } from '@/lib/onboarding';
import { track } from '@/lib/analytics';
import { useLongTermMemory } from '@/hooks/useLongTermMemory';
import { buildMemoryContext, currentSessionIdFor } from '@/lib/user-profile';
import { getCustomPersonality, isCustomId, CUSTOM_CHANGED_EVENT } from '@/lib/custom-personalities';
import { PersonalityCreator } from './PersonalityCreator';
import { useVoiceActivityDetection } from '@/hooks/useVoiceActivityDetection';
import { VADConsentPrompt, getVADConsent, setVADConsent, type VADConsent } from './VADConsentPrompt';
import { NotificationOptInPrompt, hasSeenNotificationPrompt } from './NotificationOptInPrompt';
import { VoiceMemoModal } from './VoiceMemoModal';
import { SavedMemosPanel } from './SavedMemosPanel';
import { isPushSupported, getPermissionState } from '@/lib/push-client';

/** A request is on its way. 'error' counts as idle: the user can ask again. */
function isChatBusy(status: string): boolean {
  return status === 'submitted' || status === 'streaming';
}

function chatErrorMessage(error: Error): string {
  if (/rate limit/i.test(error.message)) {
    return 'Too many questions at once. Please wait a moment, then try again.';
  }
  return "jAIsus couldn't answer just now. Check your connection and try again.";
}

// The camera's automatic prompts. They are sent as user messages but are not
// the user's words, so they are never shown as such.

function messageText(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function isVisionPing(message: UIMessage): boolean {
  return message.role === 'user' && isVisionPingText(messageText(message));
}

/** The voice picked for this personality in Settings, else its own voice. */
function applyPersonalityVoice(personalityId: string) {
  setStoredVoiceId(getVoiceOverride(personalityId) ?? getPersonality(personalityId).voiceId);
}

/** Any text with a letter or digit is worth speaking, even "Amen." or "Sad!". */
function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * Splits a long sentence at commas, semicolons and dashes. Short pieces
 * ("Oh,", "Yes,") are joined to the next piece instead of being dropped.
 */
function splitLongSentence(sentence: string): string[] {
  const parts = sentence.split(/(?<=[,;])\s+| — |—/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let carry = '';
  for (const part of parts) {
    const joined = carry ? `${carry} ${part}` : part;
    if (joined.length < 12) {
      carry = joined;
    } else {
      chunks.push(joined);
      carry = '';
    }
  }
  if (carry) {
    if (chunks.length > 0) chunks[chunks.length - 1] += ` ${carry}`;
    else chunks.push(carry);
  }
  return chunks;
}

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  // Audit fix: autoSpeak previously didn't persist across page reloads —
  // a user who turned it off in Settings would see it back on after a
  // refresh. Defaults to true (the voice-first experience) but honors
  // a prior setting if one exists.
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>('neutral');
  const [emotionCancelKey, setEmotionCancelKey] = useState(0);
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
  // Anything covering the screen. The hands-free mic and voice barge-in wait
  // while one is open, so speech isn't picked up (and sent) behind it.
  const anyModalOpen = activePanel !== 'none' || showVADPrompt || showNotificationPrompt || showOnboarding;
  const [pageHidden, setPageHidden] = useState(false);
  const isListeningRef = useRef(false);
  const personalityRef = useRef('mushroom-guru');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const prevStatusRef = useRef<string>('ready');
  const activeMessageIdRef = useRef<string | null>(null);
  const lastSpokenTextRef = useRef<string>('');
  // Audit fix (race #9): scope the spoken-text dedup to the message ID it
  // was set under so a coincidentally-identical short reply from a new
  // message doesn't get silently muted.
  const lastSpokenMessageIdRef = useRef<string | null>(null);
  // Audit fix: stash the deferred-recognition-start timer so a rapid double-tap
  // doesn't stack starts, and unmount cleanup can cancel it.
  const voiceToggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sendMessageRef = useRef<any>(null);

  const { loadMessages, saveMessages, clearHistory } = useChatHistory();
  const { voiceState, setVoiceState, startListening, startProcessing, startSpeaking, reset } = useVoiceState();
  const { speak, queueSentence, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();
  const spokenLengthRef = useRef(0);
  // A reply the user silenced while it was still streaming: the streaming-TTS
  // effect must not pick it back up (or restart it) as more text arrives.
  const mutedMessageIdRef = useRef<string | null>(null);
  // The same, for rendering: the hero doesn't "think" about a silenced reply.
  const [mutedReplyId, setMutedReplyId] = useState<string | null>(null);
  // The last reply that had a sentence queued. Speech ending before a reply
  // spoke at all was the previous reply's, not a stop of this one.
  const queuedMessageIdRef = useRef<string | null>(null);
  // Height of the voice-mode bottom bar, so the "Tap to interrupt" pill sits above it.
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);

  // Camera / vision
  const { isActive: cameraActive, sceneDescription, videoRef, toggle: toggleCamera, stop: stopCamera, isSupported: cameraSupported, error: cameraError } = useCamera();
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
      // vv.height also shrinks with pinch zoom; scaling it back leaves only
      // the keyboard.
      const offset = Math.max(0, window.innerHeight - vv.height * vv.scale);
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

  // The voice-mode bar only exists after mount with auto-speak on; its height
  // changes with the keyboard padding and the status lines.
  useEffect(() => {
    const bar = bottomBarRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBottomBarHeight(bar.offsetHeight));
    observer.observe(bar);
    return () => observer.disconnect();
  }, [autoSpeak, mounted]);

  // The chat so far, for the transport body (which isn't given it).
  const messagesRef = useRef<UIMessage[]>([]);

  // Transport with dynamic body — reads sceneRef and personalityRef on each request
  const transport = useMemo(() => new DefaultChatTransport({
    api: '/api/chat',
    body: () => {
      const scene = sceneRef.current;
      // What jAIsus remembers about the user (name, facts, recent conversation
      // summaries). Read INSIDE the body callback so each request sees what
      // was learned a moment ago; sized to fit the server's 6000-char cap.
      // This chat's own summary is labeled as such, not as a past conversation.
      const memoryContext = buildMemoryContext(
        undefined,
        currentSessionIdFor(messagesRef.current.map(m => m.id))
      );
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

  const {
    messages, sendMessage, regenerate, status, setMessages, stop: stopChat,
    error: chatError, clearError: clearChatError,
  } = useChat({ transport });
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Long-term memory: learns about the user in the background as replies
  // finish and when the page is hidden, so later sessions know them.
  const { rememberNow } = useLongTermMemory({ messages, status, personalityId });

  // Text mode: nothing is spoken, so the hero follows the reply's latest
  // emotion tag while it streams (AnimatedJesus latches it, so it still
  // plays once after the stream ends).
  const textModeEmotion = useMemo<Emotion | null>(() => {
    if (autoSpeak || status !== 'streaming') return null;
    const last = messages[messages.length - 1];
    if (last?.role !== 'assistant') return null;
    const text = last.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join('');
    return stripAllEmotionTags(text).lastEmotion;
  }, [autoSpeak, status, messages]);

  // Open arms once when the app opens.
  const [welcomeDone, setWelcomeDone] = useState(false);
  useEffect(() => {
    if (!mounted || welcomeDone) return;
    const t = setTimeout(() => setWelcomeDone(true), 1500);
    return () => clearTimeout(t);
  }, [mounted, welcomeDone]);

  // Auto-vision: periodic + immediate first reaction
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);
  // Audit fix (race #5): auto-vision ping must not fire while TTS is still
  // draining the previous reply's sentence queue. statusRef returns to
  // 'ready' the moment streaming ends, but TTS can keep playing for many
  // more seconds. Mirror isSpeaking into a ref so the interval can gate on
  // it without re-binding to React state on every tick.
  const isSpeakingRef = useRef(isSpeaking);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

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
    // Fire once when we get the first scene description. A wait already in
    // progress keeps going: a new scene arrives every ~10 s, and cancelling
    // the wait on each one lost the reaction for the whole camera session.
    if (hasReactedToCamera.current || tryFirstTimeoutRef.current !== null) return;
    if (!sceneDescription) return;
    if (!mountedRef.current) return;

    // Wait until jAIsus is free and it isn't the user's turn to talk, then
    // send. The recursive setTimeout is tracked in a ref so turning the
    // camera off / unmounting cancels it.
    const tryFirst = () => {
      tryFirstTimeoutRef.current = null;
      if (!mountedRef.current || hasReactedToCamera.current) return;
      if (isChatBusy(statusRef.current) || isSpeakingRef.current || isMicBusy() || isUserComposing()) {
        tryFirstTimeoutRef.current = setTimeout(tryFirst, 500);
        return;
      }
      hasReactedToCamera.current = true;
      // So the periodic ping doesn't fire right on top of this one.
      lastVisionPingTimeRef.current = Date.now();
      console.log('First camera reaction — immediate vision ping');
      try {
        sendMessageRef.current({ text: FIRST_VISION_PROMPT });
      } catch (err) {
        console.warn('Immediate vision sendMessage failed:', err);
      }
    };
    tryFirst();
  }, [cameraActive, sceneDescription]);

  useEffect(() => {
    return () => {
      if (tryFirstTimeoutRef.current !== null) clearTimeout(tryFirstTimeoutRef.current);
    };
  }, []);

  // Recurring auto-vision: periodic prompts while camera is active
  // Uses a fast tick (2s) but tracks time since last successful ping
  // so it fires immediately once jAIsus finishes speaking
  useEffect(() => {
    if (!cameraActive || !autoSpeak) return;

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
      // Wait for the chat to be idle — but because we tick every 2s, we'll
      // catch the moment jAIsus finishes speaking almost immediately
      if (isChatBusy(statusRef.current)) return;
      // Audit fix (race #5): also wait for TTS to actually finish reading
      // the previous response. status flips to 'ready' the moment streaming
      // ends, but the sentence queue can still have 3-4 unspoken sentences
      // draining. Firing here would stack two queues into the same warm
      // audio element and silently drop the in-flight onended handlers.
      if (isSpeakingRef.current) return;
      // The user's turn comes first: a ping while the mic was open cut them
      // off mid-sentence. Pings pause during a hands-free conversation and
      // resume once it ends (10 s of silence, or the user stops it).
      if (isMicBusy() || isUserComposing()) return;

      lastVisionPingTimeRef.current = Date.now();
      const prompt = VISION_PROMPTS[promptIndex % VISION_PROMPTS.length];
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
    let storedPid = getStoredPersonalityId();
    // A custom personality deleted since (or in another tab) would make every
    // message fail; start with the default one instead.
    if (isCustomId(storedPid) && !getCustomPersonality(storedPid)) {
      storedPid = DEFAULT_PERSONALITY_ID;
      setStoredPersonalityId(storedPid);
    }
    setPersonalityId(storedPid);
    personalityRef.current = storedPid;
    applyPersonalityVoice(storedPid);
    // Audit fix: rehydrate the persisted autoSpeak preference.
    try {
      const stored = localStorage.getItem('jaisus-auto-speak');
      if (stored === '0') setAutoSpeak(false);
      else if (stored === '1') setAutoSpeak(true);
    } catch { /* storage unavailable — keep default true */ }
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

  // Another tab (or the installed app) saved its conversation or cleared it:
  // show that here too. Otherwise this tab's next save wrote its stale list
  // over the other tab's messages. Not mid-reply, which would be cut short.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CHAT_HISTORY_KEY && e.key !== null) return;
      if (isChatBusy(statusRef.current)) return;
      setMessages(loadMessages());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [loadMessages, setMessages]);

  // Streaming TTS: feed sentences to the queue as they arrive during streaming
  useEffect(() => {
    // Keep prevStatusRef current while auto-speak is off, or turning it back
    // on would flush a stale tail of an old reply.
    if (!autoSpeak) {
      prevStatusRef.current = status;
      return;
    }
    if (messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant') return;
    if (lastMessage.id === mutedMessageIdRef.current) {
      prevStatusRef.current = status;
      return;
    }

    const rawText = lastMessage.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map(p => p.text)
      .join('');

    if (!rawText) return;

    // The hero shows each sentence's emotion when that sentence starts
    // playing (queueSentence's onStart), not when its text arrives, which is
    // several sentences ahead of the voice.
    const { cleanText: fullText, marks } = stripAllEmotionTags(rawText);
    const showEmotionAt = (offset: number) => {
      const emo = emotionAt(marks, offset);
      return emo ? () => setCurrentEmotion(emo) : undefined;
    };

    if (status === 'streaming' && activeMessageIdRef.current !== lastMessage.id) {
      // Dedup: if the AI SDK replaces the message object with a new ID but same text, don't re-speak.
      // Audit fix: previously we set activeMessageIdRef.current = id and returned WITHOUT resetting
      // spokenLengthRef. Subsequent streaming tokens then ran the splitter
      // against the new message's text using the OLD spokenLength offset → wrong chunks queued.
      // Now: seed spokenLength to the already-spoken text length so further streaming picks up
      // cleanly from there.
      //
      // Audit fix (race #9): the equality dedup is only valid for the SAME
      // message ID swap. If a regenerate / retry produces a new message ID
      // whose opening tokens coincidentally equal the previous message's
      // full text (common for short replies like "Yes."), this used to
      // silently mute the new message. Pair lastSpokenTextRef with the id
      // it was set under, and only honor the equality check when ids match.
      if (
        fullText &&
        fullText === lastSpokenTextRef.current &&
        lastSpokenMessageIdRef.current === lastMessage.id
      ) {
        activeMessageIdRef.current = lastMessage.id;
        spokenLengthRef.current = fullText.length;
        prevStatusRef.current = status;
        return;
      }
      // New message ID — clear the stale spoken-text marker so it can't
      // falsely match a subsequent unrelated message.
      lastSpokenTextRef.current = '';
      lastSpokenMessageIdRef.current = null;
      activeMessageIdRef.current = lastMessage.id;
      spokenLengthRef.current = 0;
    }

    // startSpeaking() runs only when a sentence is actually queued, in the
    // same batch as the queue's isSpeaking = true. Calling it on the first
    // token made the speaking state flicker until the first sentence was done.
    // spokenLengthRef makes sure each part of the text is queued once.
    if (status === 'streaming' || (prevStatusRef.current === 'streaming' && status === 'ready')) {
      const unprocessed = fullText.slice(spokenLengthRef.current);
      // Split on sentence-ending punctuation followed by whitespace, so
      // "3.16" or "$4.99" (or a "3." whose digits haven't streamed in yet)
      // isn't cut mid-number. The end-of-stream flush below speaks the rest.
      const sentenceRegex = /[\s\S]*?[.!?]+["'”’)]*(?=\s)/g;
      let match;
      let lastEnd = 0;
      while ((match = sentenceRegex.exec(unprocessed)) !== null) {
        const trimmed = match[0].trim();
        const start = spokenLengthRef.current + match.index + (match[0].length - match[0].trimStart().length);
        let onStart = showEmotionAt(start);
        // Break long sentences (>120 chars) at em-dashes or commas to avoid TTS timeouts
        const chunks = trimmed.length > 120 ? splitLongSentence(trimmed) : [trimmed];
        for (const c of chunks) {
          if (isSpeakable(c)) {
            startSpeaking();
            queueSentence(c, onStart);
            onStart = undefined;
            queuedMessageIdRef.current = lastMessage.id;
          }
        }
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd > 0) {
        spokenLengthRef.current += lastEnd;
      }
    }

    // Audit fix (race #10): also flush on 'error' transition, not only
    // 'ready'. If a network drop or server abort flips status straight to
    // 'error', the end-of-stream queueSentence(null) sentinel would never
    // be sent and processQueue would block forever on its 100ms wait.
    if (prevStatusRef.current === 'streaming' && (status === 'ready' || status === 'error')) {
      const tail = fullText.slice(spokenLengthRef.current);
      const remaining = tail.trim();
      if (isSpeakable(remaining)) {
        startSpeaking();
        queueSentence(remaining, showEmotionAt(spokenLengthRef.current + tail.length - tail.trimStart().length));
      }
      queueSentence(null);
      lastSpokenTextRef.current = fullText; // Track for dedup
      lastSpokenMessageIdRef.current = lastMessage.id;
      spokenLengthRef.current = 0;
    }

    prevStatusRef.current = status;
  }, [status, messages, autoSpeak, queueSentence, startSpeaking]);

  useEffect(() => {
    if (!isSpeaking && voiceState === 'speaking') {
      // Speech was stopped from elsewhere (a panel's player) while the reply
      // is still streaming: don't start speaking it again on the next token.
      // Not when this reply hasn't spoken yet: then it was the previous
      // reply that finished (a question typed while it was still being
      // read), and muting would leave the new reply silent.
      if (
        statusRef.current === 'streaming' &&
        activeMessageIdRef.current &&
        queuedMessageIdRef.current === activeMessageIdRef.current
      ) {
        mutedMessageIdRef.current = activeMessageIdRef.current;
        setMutedReplyId(activeMessageIdRef.current);
      }
      activeMessageIdRef.current = null;
      setCurrentEmotion('neutral');
      reset();
    }
  }, [isSpeaking, voiceState, reset]);

  // A request that ends without any speech (auto-speak off, a chat error, an
  // abort) has to leave 'processing' too; only startSpeaking() did before.
  // Keyed to the busy -> idle transition because 'processing' starts a moment
  // before useChat reports 'submitted'. Functional, so a startSpeaking() from
  // the final flush in the same commit wins.
  const prevChatStatusRef = useRef(status);
  useEffect(() => {
    const wasBusy = prevChatStatusRef.current === 'submitted' || prevChatStatusRef.current === 'streaming';
    prevChatStatusRef.current = status;
    if (wasBusy && status !== 'submitted' && status !== 'streaming') {
      setVoiceState(s => (s === 'processing' ? 'idle' : s));
      // A failed request ends the hands-free conversation; the error banner
      // says what happened, and the mic doesn't reopen on its own.
      if (status === 'error') voiceLoopActiveRef.current = false;
    }
  }, [status, setVoiceState]);

  // A question asked while a reply was still on its way (see sendText),
  // sent once the stopped request has ended. Declared after the effect above
  // so its 'processing' wins over the reset there.
  const pendingSendRef = useRef<{ text: string; voice: boolean } | null>(null);
  useEffect(() => {
    if (isChatBusy(status) || !pendingSendRef.current) return;
    const { text, voice } = pendingSendRef.current;
    pendingSendRef.current = null;
    if (voice) startProcessing();
    sendMessage({ text });
  }, [status, sendMessage, startProcessing]);

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
    if (showOnboarding || showVADPrompt || activePanel !== 'none') return;
    // Not in the middle of a reply or the user's turn to talk.
    if (isChatBusy(status) || isSpeaking || voiceState === 'listening') return;
    // Nothing to offer where push can't work (iOS Safari outside the Home
    // Screen app) or the browser already has an answer for this site.
    if (!isPushSupported() || getPermissionState() !== 'default') return;
    if (hasSeenNotificationPrompt()) return;
    // Audit fix: previously this filtered all messages on every render —
    // a long thread would do O(N) work per keystroke. Now we bail early if
    // even the total message count is below the threshold (it never can be
    // when filtered count is high enough), and short-circuit the filter
    // once we've found enough visible messages.
    if (messages.length < 4) return;
    // The user's own questions and the replies to them. Replies to camera
    // pings don't count, or the camera alone triggered the prompt.
    let visibleCount = 0;
    let answersUser = false;
    for (const m of messages) {
      if (m.role === 'user') {
        answersUser = !isVisionPing(m);
        if (answersUser) visibleCount++;
      } else if (answersUser) {
        visibleCount++;
        answersUser = false;
      }
      if (visibleCount >= 4) break;
    }
    if (visibleCount < 4) return;
    notifPromptShownRef.current = true;
    setShowNotificationPrompt(true);
  }, [messages, showOnboarding, showVADPrompt, mounted, activePanel, status, isSpeaking, voiceState]);

  // Text mode: auto-scroll to the latest message, but only while the user is
  // near the bottom, so scrolling up to re-read isn't undone by every token.
  // The page scrolls, not the list (it has no height limit). The position is
  // measured on scroll, before new content grows the page: a new bubble can
  // be taller than the threshold.
  const atBottomRef = useRef(true);
  useEffect(() => {
    const update = () => {
      atBottomRef.current =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  useEffect(() => {
    if (!chatEndRef.current || messages.length === 0) return;
    // The user's own question always comes into view.
    if (status === 'submitted') atBottomRef.current = true;
    if (atBottomRef.current) {
      // The very bottom, so the sticky input bar sits below the last message
      // instead of over it.
      window.scrollTo({ top: document.documentElement.scrollHeight });
    }
  }, [messages, status, autoSpeak]);

  // Voice-mode transcript box: keep the newest lines in view, unless the user
  // has scrolled up inside it.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptAtBottomRef = useRef(true);
  useEffect(() => {
    const box = transcriptRef.current;
    if (box && transcriptAtBottomRef.current) box.scrollTop = box.scrollHeight;
  }, [messages, showTranscript]);

  // Hands-free conversation flag (user request: "i press mic, jesus
  // answers, i have to press mic again. would be better if he would
  // just listen"). When the user initiates a voice turn (via the mic
  // button OR a barge-in), this flips true. After TTS finishes
  // speaking, an effect below auto-restarts recognition for the next
  // turn. Only armed with auto-speak on (the loop can't run without it).
  // Reset by:
  //   - User typing a text message (back to text mode)
  //   - User manually stopping TTS / recognition (explicit pause)
  //   - User clearing history, or toggling auto-speak
  //   - A listen that hears nothing for 10 s, or a recognition error
  //   - A failed chat request
  const voiceLoopActiveRef = useRef(false);

  // Every path that starts listening arms voiceLoopActiveRef itself, so a
  // result must not re-arm it: that undid a manual stop or Clear history.
  const handleVoiceResult = (transcript: string) => {
    console.log('handleVoiceResult called:', transcript);
    sendText(transcript, true);
  };

  // A listen that heard nothing (10 s of silence) or failed ends the
  // hands-free loop; otherwise the mic reopened forever after silence.
  const handleVoiceSessionEnd = useCallback((reason: SpeechSessionEnd) => {
    if (reason !== 'result') voiceLoopActiveRef.current = false;
  }, []);

  const {
    interimTranscript, isListening, isSupported, error: voiceError,
    start: startRecognition, stop: stopRecognition, cancel: cancelRecognition,
    clearError: clearVoiceError,
  } = useSpeechRecognition(handleVoiceResult, handleVoiceSessionEnd);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  // First time we hit speaking state in a session, and consent hasn't been
  // decided yet, surface the one-time consent prompt. The ref guard ensures
  // it only shows once per page-load even if the user toggles in/out of
  // speaking state multiple times. We also avoid stacking on top of
  // onboarding (looks awful, the user will dismiss without reading).
  // Nor over an open panel or the notification prompt: it waits for the next
  // reply instead (the ref is only set once it actually shows).
  // Barge-in needs speech recognition to hear what was said, so it isn't
  // offered without it (e.g. Firefox).
  useEffect(() => {
    if (vadConsent !== null) return;
    if (vadPromptShownRef.current) return;
    if (!isSupported) return;
    if (voiceState !== 'speaking') return;
    if (showOnboarding || showNotificationPrompt || activePanel !== 'none') return;
    vadPromptShownRef.current = true;
    setShowVADPrompt(true);
  }, [vadConsent, voiceState, showOnboarding, showNotificationPrompt, activePanel, isSupported]);

  // VAD hook — fully dormant unless consent is granted AND jAIsus is
  // currently speaking. When it detects sustained voice activity, it
  // stops TTS, resets the voice state machine, AND starts speech
  // recognition so the user's barge-in is actually captured.
  //
  // User-reported bug fix: previously this only stopped TTS without
  // starting recognition — so when the user spoke while jAIsus was
  // speaking, jAIsus would go quiet but their voice was lost into
  // the void. They had to tap the mic AGAIN to be heard.
  // Off without speech recognition: any sound would cut the reply off with
  // nothing listening, and the armed loop would hold camera pings forever.
  useVoiceActivityDetection({
    enabled: vadConsent === 'accepted' && voiceState === 'speaking' && !anyModalOpen && isSupported,
    onSpeechStart: () => {
      // Barge-in is the clearest possible signal that the user wants
      // voice mode — they're literally interrupting with their voice.
      // Arm the hands-free loop (it only runs with auto-speak on).
      voiceLoopActiveRef.current = autoSpeak;
      // Also ends a reply still streaming, so the user's words don't start a
      // second request alongside it.
      interruptSpeech(true);
      // Tiny delay lets the TTS audio element release the mic resources
      // before recognition tries to acquire them. Without it, some
      // browsers (Safari especially) fail to start recognition because
      // the audio output device is still in use.
      setTimeout(() => {
        if (mountedRef.current && isSupported) {
          startRecognition();
        }
      }, 150);
    },
  });

  // TTS started while the mic was open: drop the partial speech rather than
  // sending half a sentence in the middle of a reply.
  useEffect(() => {
    if (isSpeaking && isListening) {
      cancelRecognition();
    }
  }, [isSpeaking, isListening, cancelRecognition]);

  // Same when a panel or prompt opens over a live mic. The hands-free loop
  // stays armed, so the mic reopens once it closes.
  useEffect(() => {
    if (anyModalOpen && isListening) {
      cancelRecognition();
    }
  }, [anyModalOpen, isListening, cancelRecognition]);

  // Voice errors are shown for a while, not until the next listen.
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(clearVoiceError, 8000);
    return () => clearTimeout(t);
  }, [voiceError, clearVoiceError]);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  // Hands-free: when TTS finishes AND the conversation is in voice mode,
  // automatically re-arm recognition for the next user turn. Guards:
  //   - voiceLoopActiveRef: user must have started this leg by voice
  //   - !isSpeaking: TTS has actually finished
  //   - !isListening: not already listening
  //   - chat is idle (not mid-stream)
  //   - isSupported: browser has recognition
  //   - autoSpeak: only in voice-first mode (text mode users shouldn't
  //     suddenly find their mic listening)
  //   - no panel or prompt open, page visible: the loop waits and resumes
  //     once it closes or the user comes back
  const autoListenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Clear any pending timer when conditions change.
    if (autoListenTimerRef.current) {
      clearTimeout(autoListenTimerRef.current);
      autoListenTimerRef.current = null;
    }
    if (!voiceLoopActiveRef.current) return;
    if (!autoSpeak) return;
    if (!isSupported) return;
    if (isSpeaking || isListening) return;
    if (isChatBusy(status)) return;
    if (anyModalOpen || pageHidden) return;

    // Defer slightly so the user has a beat after TTS ends to interrupt
    // (e.g., turn off the mic if they're done) and so the audio output
    // device releases before recognition tries to acquire the mic.
    autoListenTimerRef.current = setTimeout(() => {
      autoListenTimerRef.current = null;
      // Re-check conditions at fire time (state may have changed).
      if (!voiceLoopActiveRef.current) return;
      if (isSpeakingRef.current) return;
      if (isChatBusy(statusRef.current)) return;
      if (document.hidden) return;
      console.log('Hands-free: auto-restarting recognition');
      startRecognition();
    }, 500);

    return () => {
      if (autoListenTimerRef.current) {
        clearTimeout(autoListenTimerRef.current);
        autoListenTimerRef.current = null;
      }
    };
  }, [isSpeaking, isListening, status, autoSpeak, isSupported, startRecognition, anyModalOpen, pageHidden]);

  // It's the user's turn to talk: the mic is open, about to reopen, or a
  // hands-free conversation is going on. Camera pings wait for it.
  function isMicBusy() {
    return isListeningRef.current
      || voiceLoopActiveRef.current
      || autoListenTimerRef.current !== null
      || voiceToggleTimerRef.current !== null;
  }

  // The user is typing a question: camera pings wait too, or one takes the
  // turn and Send is blocked until its reply is over. Not focus alone (the
  // input stays focused after a send), and a draft left alone for 15 s
  // doesn't hold them back forever.
  const inputDraftRef = useRef('');
  const lastTypedAtRef = useRef(0);
  function isUserComposing() {
    return inputDraftRef.current.trim() !== '' && Date.now() - lastTypedAtRef.current < 15000;
  }

  useEffect(() => {
    if (isListening) {
      startListening();
    } else if (voiceState === 'listening') {
      if (status !== 'submitted' && status !== 'streaming') {
        reset();
      }
    }
  }, [isListening, voiceState, status, startListening, reset]);

  // Cancel any pending voice-toggle deferred-start on unmount so the timer
  // doesn't fire `startRecognition` on a stale closure after the component
  // is gone. Audit fix.
  useEffect(() => {
    return () => {
      if (voiceToggleTimerRef.current) {
        clearTimeout(voiceToggleTimerRef.current);
        voiceToggleTimerRef.current = null;
      }
    };
  }, []);

  // Every message the user sends goes through here. A question asked while
  // a reply is still on its way (a voice result, a panel's "Ask") stops that
  // reply and is sent once the stopped request has ended: two requests at
  // once duplicated and interleaved the replies.
  function sendText(text: string, voice = false) {
    clearVoiceError();
    recordActivity();
    if (isChatBusy(status)) {
      pendingSendRef.current = { text, voice };
      interruptSpeech(true);
    } else {
      sendMessage({ text });
    }
    if (voice) startProcessing();
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isChatBusy(status)) return;
    // Text input means the user is in keyboard mode — exit the hands-free
    // voice loop so the mic doesn't auto-re-arm after the reply finishes.
    voiceLoopActiveRef.current = false;
    sendText(input);
    setInput('');
    inputDraftRef.current = '';
  }

  function handleInputChange(value: string) {
    setInput(value);
    inputDraftRef.current = value;
    lastTypedAtRef.current = Date.now();
    if (voiceError) clearVoiceError();
  }

  function handleAskAbout(prompt: string) {
    sendText(prompt);
  }

  function handleRetry() {
    if (messages.length === 0) {
      clearChatError();
      return;
    }
    // Drops a half-written reply and asks the last question again.
    regenerate().catch(err => console.warn('Retry failed:', err));
  }

  function handleAskQuestion() {
    if (isSupported) {
      // User explicitly tapped "Ask a Question". The hands-free loop only
      // runs with auto-speak on.
      voiceLoopActiveRef.current = autoSpeak;
      startRecognition();
    } else {
      // No speech recognition (e.g. Firefox): start() only shows the "not
      // supported" message. Offer the keyboard instead of doing nothing.
      startRecognition();
      textInputRef.current?.focus();
    }
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  // Stops jAIsus mid-reply. A reply still streaming is muted, so the
  // streaming-TTS effect doesn't resume it with the next sentence or restart
  // it from the first. stopStream also aborts the stream, for when the user is
  // about to say something new (two requests at once would collide).
  function interruptSpeech(stopStream = false) {
    const busy = status === 'submitted' || status === 'streaming';
    const last = messages[messages.length - 1];
    if (status === 'streaming' && last?.role === 'assistant') {
      mutedMessageIdRef.current = last.id;
      setMutedReplyId(last.id);
    }
    if (stopStream && busy) {
      try { stopChat(); } catch { /* may not be available */ }
    }
    stopSpeaking();
    reset();
    // The effect that resets the emotion when speech ends never sees this
    // stop ('speaking' and isSpeaking end together): without this the hero
    // kept the interrupted sentence's emotion, also into later replies.
    setCurrentEmotion('neutral');
    // ...and an emotion of that reply still waiting for its clip.
    setEmotionCancelKey(k => k + 1);
  }

  function handleVoiceToggle() {
    // Audit fix (race): clear any pending toggle-timer at the TOP of the
    // function, not only in the speaking branch. Without this, the sequence
    // "speaking → tap → idle within 150ms → tap → idle branch starts
    // recognition directly" would still let the original 150ms timer fire
    // afterwards and double-start the recognition state machine.
    if (voiceToggleTimerRef.current) {
      clearTimeout(voiceToggleTimerRef.current);
      voiceToggleTimerRef.current = null;
    }
    if (voiceState === 'listening') {
      // Manual stop while listening: send what was said so far and keep the
      // hands-free loop going; with nothing said, pause the conversation.
      const sent = stopRecognition();
      voiceLoopActiveRef.current = sent && autoSpeak;
    } else if (voiceState === 'processing') {
      // The amber button while thinking means "stop": cancel the question
      // and end the hands-free loop rather than opening the mic.
      voiceLoopActiveRef.current = false;
      pendingSendRef.current = null;
      interruptSpeech(true);
    } else if (voiceState === 'speaking' || isSpeaking) {
      // Bug fix (audit): distinguish the two meanings of "tap mic during TTS":
      //   - If the hands-free loop is ALREADY armed, the user is asking to
      //     STOP the conversation (they'd otherwise get auto-restarted after
      //     this reply finishes). Kill TTS, disarm the loop, do NOT start
      //     recognition. Without this branch there was NO way to exit the
      //     hands-free loop while jAIsus was speaking.
      //   - Otherwise (they typed the last message, so loop is off) they're
      //     barging in to say something new. Kill TTS, arm the loop, start
      //     recognition after a short delay.
      const wasLoopArmed = voiceLoopActiveRef.current;
      // Barging in also ends the stream; stopping keeps its text on screen.
      // Without speech recognition the button can only stop.
      interruptSpeech(!wasLoopArmed && isSupported);
      if (wasLoopArmed || !isSupported) {
        voiceLoopActiveRef.current = false;
      } else {
        voiceLoopActiveRef.current = autoSpeak;
        voiceToggleTimerRef.current = setTimeout(() => {
          voiceToggleTimerRef.current = null;
          startRecognition();
        }, 150);
      }
    } else {
      // Fresh mic press from idle — arm hands-free loop (voice mode only).
      // With a spoken reply on its way, the user is talking over it: drop
      // the reply, or its speech would cut this listen off as soon as it
      // started. A text-mode reply keeps streaming until the question is
      // actually sent (sendText stops it then).
      if (autoSpeak && (status === 'submitted' || status === 'streaming')) {
        interruptSpeech(true);
      }
      voiceLoopActiveRef.current = autoSpeak;
      startRecognition();
    }
  }

  function handleClearHistory({ remember = true }: { remember?: boolean } = {}) {
    // Clearing history exits the hands-free loop too.
    voiceLoopActiveRef.current = false;
    // Also discard any speech in progress, which would otherwise be sent
    // into the freshly cleared conversation.
    cancelRecognition();
    // Audit fix: abort the in-flight chat stream FIRST. Without this, a clear
    // during streaming would let tokens keep arriving on a destroyed message,
    // useChat would re-insert under a new ID, and the streaming-TTS effect
    // would re-engage with stale spokenLength / activeMessageId state.
    // Muting the reply covers tokens already on their way. Also stops speech
    // and leaves 'processing'.
    interruptSpeech(true);
    pendingSendRef.current = null;
    clearChatError();
    setCurrentEmotion('neutral');

    // Before wiping, let long-term memory take in what it hasn't yet (facts
    // and this conversation's summary). Best-effort, in the background. Not
    // when the clear is part of "Forget everything".
    if (remember) rememberNow(messages);
    // Reset streaming-TTS state so stale references from the cleared
    // conversation can't re-fire next time. Previously: prevStatusRef stayed
    // 'streaming' if a clear happened mid-stream, causing the next message to
    // skip the start-up branch and replay sentences from the old activeMessageId.
    prevStatusRef.current = 'ready';
    spokenLengthRef.current = 0;
    activeMessageIdRef.current = null;
    lastSpokenTextRef.current = '';
    lastSpokenMessageIdRef.current = null;
    clearHistory();
    setMessages([]);
  }

  function handlePersonalityChange(id: string) {
    // Audit fix (race #2): if a chat is currently streaming when the user
    // switches personality, stop it. Without this, the in-flight response
    // (from the OLD personality) keeps streaming AND subsequent sentences
    // are passed to TTS with the NEW personality's voice — old text in a
    // new voice. Aborting the stream is the least-surprising behavior;
    // the user can re-ask under the new persona.
    // Speech is stopped even once the text has finished streaming: TTS lags
    // the stream, and the rest would be read in the new personality's voice.
    const busy = status === 'submitted' || status === 'streaming';
    if (busy || (isSpeaking && id !== personalityRef.current)) {
      interruptSpeech(true);
    }
    if (busy) {
      // Bug fix (audit): also reset the streaming-TTS effect state so the
      // NEXT message starts cleanly. Without this, activeMessageIdRef +
      // prevStatusRef stayed at their mid-stream values; the next reply
      // would take the end-of-stream flush path with a spurious null
      // sentinel before the new-message branch ever ran.
      prevStatusRef.current = 'ready';
      spokenLengthRef.current = 0;
      activeMessageIdRef.current = null;
      lastSpokenTextRef.current = '';
      lastSpokenMessageIdRef.current = null;
    }
    setPersonalityId(id);
    personalityRef.current = id;
    setStoredPersonalityId(id);
    // Auto-switch voice to match personality
    applyPersonalityVoice(id);
  }

  // The active custom personality was deleted (here or in another tab): every
  // message would fail with it, so fall back to the default personality.
  const dropMissingPersonality = useEffectEvent(() => {
    const id = personalityRef.current;
    if (isCustomId(id) && !getCustomPersonality(id)) {
      handlePersonalityChange(DEFAULT_PERSONALITY_ID);
    }
  });
  useEffect(() => {
    const onChange = () => dropMissingPersonality();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'jaisus-custom-personalities' || e.key === null) dropMissingPersonality();
    };
    window.addEventListener(CUSTOM_CHANGED_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CUSTOM_CHANGED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function handleVisionIntervalChange(seconds: number) {
    setVisionInterval(seconds);
    try {
      localStorage.setItem('jaisus-vision-interval', String(seconds));
    } catch { /* */ }
  }

  const chatErrorBanner = chatError ? (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 py-1.5 pl-3 pr-1.5 bg-amber-50/90 border border-amber-200 rounded-lg text-amber-700 text-xs mb-2 animate-fade-in"
    >
      <span className="text-left">{chatErrorMessage(chatError)}</span>
      <button
        type="button"
        onClick={handleRetry}
        className="shrink-0 min-h-9 rounded-md bg-amber-100 px-3 font-semibold text-amber-800 active:scale-95 transition-transform"
      >
        Try again
      </button>
    </div>
  ) : null;

  // What the hero shows: the conversation's state first (he listens while
  // you talk, thinks until his reply starts; not about a reply the user
  // silenced), then the reply's emotions. States are passed apart from
  // emotions: they end, while an emotion plays once even if short-lived.
  const replyMuted = status === 'streaming' && messages[messages.length - 1]?.id === mutedReplyId;
  const heroState: HeroState | null =
    voiceState === 'listening' ? 'listening'
    : status === 'submitted' || (autoSpeak && status === 'streaming' && !isSpeaking && !replyMuted) ? 'thinking'
    : null;
  const heroEmotion: Emotion =
    textModeEmotion ?? (mounted && !welcomeDone ? 'welcome' : currentEmotion);

  return (
    // dvh, not 100vh: mobile browsers size vh to the screen without their
    // toolbars, which pushed content below the visible bottom.
    <div className="flex flex-col min-h-screen [@supports(height:1dvh)]:min-h-dvh bg-stone-50">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        <HeroSection
          voiceState={voiceState}
          interimTranscript={interimTranscript}
          emotion={heroEmotion}
          heroState={heroState}
          emotionCancelKey={emotionCancelKey}
        />

        {/* Live-audit fix: PersonalitySwitcher was rendered HERE as a flex
            child between the hero and the spacer. On mobile (375x812) with
            the hero at 85vh, the sticky input row's height (≈130px) was
            larger than the remaining 15vh, so the switcher ended up visually
            BEHIND the sticky bar — completely unreachable. Moved into the
            sticky bottom container below so it's always above the input. */}

        {mounted && !autoSpeak && (
          <ActionButtons
            onAskQuestion={handleAskQuestion}
            onOpenPanel={setActivePanel}
          />
        )}

        {/* The layout depends on a saved setting that is read after mount.
            Until then neither layout is shown, so users with auto-speak off
            don't see the voice layout first and then a jump. */}
        {!mounted ? (
          <div className="flex-1" aria-hidden="true" />
        ) : autoSpeak ? (
          <>
            <div className="flex-1" />

            {/* Floating buttons + text input: settings, mic, camera, transcript.
                The camera preview, status lines and transcript are in this
                sticky bar too: on phones the hero and the bar are taller than
                the screen, and anything between them ended up behind the bar. */}
            <div
              ref={bottomBarRef}
              className="sticky bottom-0 bg-stone-50/90 backdrop-blur-sm px-4 py-3"
              // UX audit fix: respect the iPhone home-indicator safe area so
              // the mic button doesn't sit under the indicator's touch region.
              // Keyboard-open padding takes precedence when the soft keyboard
              // is up (visualViewport tracks that separately).
              style={{
                paddingBottom: keyboardHeight > 0
                  ? 12 + keyboardHeight
                  : 'max(12px, env(safe-area-inset-bottom))',
              }}
            >
              {/* Camera preview + scene caption */}
              <div className={`pb-2 ${cameraActive ? '' : 'hidden'}`}>
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
              {(voiceError || cameraError || chatError || isChatBusy(status) || isSpeaking) && (
                <div className="text-center">
                  {(voiceError || cameraError) && (
                    <div className="py-2 px-3 bg-amber-50/90 border border-amber-200 rounded-lg text-amber-700 text-xs mb-2">
                      {voiceError || cameraError}
                    </div>
                  )}
                  {chatErrorBanner}
                  {isChatBusy(status) && !isSpeaking && !replyMuted && (
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
              )}

              {/* Transcript overlay */}
              {showTranscript && messages.length > 0 && (
                <div
                  ref={transcriptRef}
                  onScroll={e => {
                    const box = e.currentTarget;
                    transcriptAtBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
                  }}
                  className="mb-2 max-h-48 overflow-y-auto rounded-xl"
                >
                  <div className="bg-black/60 backdrop-blur-sm rounded-xl p-3 space-y-2">
                    {messages.map(message => {
                      if (isVisionPing(message)) return null;
                      const rawMsgText = messageText(message);
                      const displayText = message.role === 'assistant'
                        ? stripPartialEmotionTag(stripAllEmotionTags(rawMsgText).cleanText)
                        : rawMsgText;
                      return (
                        <div key={message.id} className={`text-xs [overflow-wrap:anywhere] ${message.role === 'user' ? 'text-teal-300' : 'text-stone-200'}`}>
                          <span className="font-bold">{message.role === 'user' ? 'You' : 'jAIsus'}:</span>{' '}
                          {displayText}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Personality switcher — moved into the sticky container so it's
                  always above the input row regardless of hero height.
                  Bug fix: previously had `-mx-4 px-4` on this wrapper which
                  double-padded against PersonalitySwitcher's own `px-4`
                  internal padding. The result was chips overflowing the
                  viewport on both left and right edges. The sticky parent
                  already has px-4, so this row just needs `-mx-4` to let
                  the chip strip extend edge-to-edge for horizontal scroll. */}
              <div className="flex items-center gap-2 mb-2 -mx-4">
                <div className="flex-1 min-w-0">
                  <PersonalitySwitcher
                    activeId={personalityId}
                    onChange={handlePersonalityChange}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setActivePanel('personality-creator')}
                  className="shrink-0 mr-4 w-11 h-11 rounded-full bg-white border border-stone-200 text-stone-600 text-xl leading-none flex items-center justify-center hover:border-amber-300 active:scale-95"
                  aria-label="Create custom personality"
                  title="Create your own jAIsus"
                >
                  +
                </button>
              </div>
              {/* Text input row — always visible for keyboard questions.
                  Audit fix: explicit inputMode / autoComplete / autoCapitalize /
                  enterKeyHint so iOS doesn't autocorrect prayer/scripture
                  words and shows a Send key on the return button. */}
              <form onSubmit={handleTextSubmit} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  placeholder="Type your question..."
                  inputMode="text"
                  enterKeyHint="send"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="sentences"
                  spellCheck={false}
                  // Not disabled while jAIsus replies: that dropped focus (and closed
                  // the phone keyboard) after every send. A send while busy is
                  // ignored and the draft kept. 16px text, or iOS zooms the page
                  // in when the input is focused.
                  className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2 text-base
                    focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                />
                {input.trim() && (
                  <button
                    type="submit"
                    disabled={isChatBusy(status)}
                    className="w-11 h-11 rounded-full bg-teal-500 text-white flex items-center justify-center active:scale-95 transition-transform shadow-sm disabled:opacity-50"
                    aria-label="Send"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                  </button>
                )}
              </form>

              {/* Audit fix: bump 10×10 (40px) icon buttons up to 11×11 (44px)
                  to meet WCAG 2.5.5 / iOS HIG touch-target minimum. */}
              <div className="flex items-center justify-center gap-3">
                {/* Settings */}
                <button
                  type="button"
                  onClick={() => setActivePanel('settings')}
                  className="w-11 h-11 rounded-full bg-stone-200 flex items-center justify-center text-stone-500 active:scale-95 transition-transform shadow-sm"
                  aria-label="Settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </svg>
                </button>

                {/* Camera toggle */}
                {cameraSupported && (
                  <button
                    type="button"
                    onClick={toggleCamera}
                    className={`w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-sm ${
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
                  type="button"
                  onClick={() => {
                    transcriptAtBottomRef.current = true;
                    setShowTranscript(!showTranscript);
                  }}
                  className={`w-11 h-11 rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-sm ${
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
              {messages.length === 0 && (
                <div className="space-y-4 py-2 animate-fade-in">
                  <div className="flex justify-center">
                    {/* The streak is recorded when the user sends something. */}
                    <StreakBadge autoRecord={false} />
                  </div>
                  <GreetingHeader />
                  <DailyVerse />
                  <DailyKindness />
                  <SuggestedPrompts
                    onPick={(text) => {
                      track('suggestion.picked');
                      sendText(text);
                    }}
                  />
                  <MoodSelector
                    onPick={(mood, content) => {
                      track('mood.picked', { mood: mood.id });
                      // Compose a natural opener combining the mood label and a starter prompt
                      const text = content.promptText ?? `I'm feeling ${mood.label.toLowerCase()}.`;
                      sendText(text);
                    }}
                  />
                </div>
              )}
              {messages.map((message, i) => (
                isVisionPing(message) ? null : (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isStreaming={status === 'streaming' && message.role === 'assistant' && i === messages.length - 1}
                  />
                )
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
              {chatErrorBanner}
              <div ref={chatEndRef} />
            </div>

            <div
              className="sticky bottom-0 bg-stone-50/95 backdrop-blur-sm border-t border-stone-200 px-4 py-3"
              style={keyboardHeight > 0 ? { paddingBottom: 12 + keyboardHeight } : undefined}
            >
              {/* Here rather than at the top of the list, which can be far
                  above the screen in a long conversation. */}
              {voiceError && (
                <div className="text-center py-2 px-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs mb-2 animate-fade-in">
                  {voiceError}
                </div>
              )}
              <form onSubmit={handleTextSubmit} className="flex items-center gap-2">
                <input
                  ref={textInputRef}
                  type="text"
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  placeholder="Type your question..."
                  // Stays enabled and 16px, as in the voice-mode bar.
                  className="flex-1 rounded-full border border-stone-300 bg-white px-4 py-2.5 text-base
                    focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
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
        personalityId={personalityId}
      />
      <SettingsPanel
        isOpen={activePanel === 'settings'}
        onClose={() => setActivePanel('none')}
        // Export the chat as shown, not the 100-message saved copy.
        messages={messages}
        autoSpeak={autoSpeak}
        onToggleAutoSpeak={() => {
          const next = !autoSpeak;
          // Turning it off mid-reply silences the reply; otherwise 'speaking'
          // never ended, because the end-of-stream signal was never sent.
          if (!next) interruptSpeech();
          // The camera's preview and off switch exist only in voice mode, so
          // it can't keep running in text mode. stop() also cancels a camera
          // still waiting on its permission prompt (not yet active).
          if (!next) stopCamera();
          // An old hands-free flag would otherwise open the mic by itself
          // (behind Settings) as soon as auto-speak came back on.
          voiceLoopActiveRef.current = false;
          setAutoSpeak(next);
          try { localStorage.setItem('jaisus-auto-speak', next ? '1' : '0'); } catch { /* */ }
        }}
        onClearHistory={handleClearHistory}
        onTestVoice={() => {
          // Mute a streaming reply, or its next sentences would play after the test.
          interruptSpeech();
          speak('Peace be with you, my friend. I have walked among you for two thousand years.');
        }}
        visionInterval={visionInterval}
        onVisionIntervalChange={handleVisionIntervalChange}
        cameraActive={cameraActive}
        personalityId={personalityId}
        // Re-tapping the current personality changes nothing, so it must not
        // abort a reply that's on its way.
        onPersonalityChange={(id) => {
          if (id !== personalityRef.current) handlePersonalityChange(id);
        }}
        vadEnabled={vadConsent === 'accepted'}
        onToggleVad={() => {
          const next: VADConsent = vadConsent === 'accepted' ? 'declined' : 'accepted';
          setVADConsent(next);
          setVadConsent(next);
        }}
        onOpenCreator={() => setActivePanel('personality-creator')}
        onOpenMemories={() => setActivePanel('memories')}
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
        onAskAgain={(text) => sendText(text)}
      />
      <MemoriesPanel
        isOpen={activePanel === 'memories'}
        onClose={() => setActivePanel('none')}
        onForgetEverything={() => handleClearHistory({ remember: false })}
      />
      <SearchPanel
        isOpen={activePanel === 'search'}
        onClose={() => setActivePanel('none')}
        onAskAbout={(text) => sendText(text)}
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
          // The voice just picked in the creator wins over one set in Settings.
          setVoiceOverride(p.id, null);
          handlePersonalityChange(p.id);
        }}
        onDeleted={(deletedId) => {
          setVoiceOverride(deletedId, null);
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
        // Closed without an answer: asked again on a later visit.
        onDismiss={() => setShowVADPrompt(false)}
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
          by an ancestor's overflow). In voice mode it sits just above the
          bottom bar, not on top of the text input. */}
      <SpeakingHint
        voiceState={voiceState}
        onInterrupt={() => interruptSpeech()}
        bottomPx={autoSpeak && bottomBarHeight > 0 ? bottomBarHeight + 8 : undefined}
      />
    </div>
  );
}
