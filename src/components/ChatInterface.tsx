'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { ActivePanel } from '@/lib/types';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useVoiceState } from '@/hooks/useVoiceState';
import { useChatHistory } from '@/hooks/useChatHistory';
import { parseEmotionTag, type Emotion } from '@/lib/emotions';
import { HeroSection } from './HeroSection';
import { ActionButtons } from './ActionButtons';
import { ChatMessage } from './ChatMessage';
import { VoiceButton } from './VoiceButton';
import { ParablesDrawer } from './ParablesDrawer';
import { PrayerRequestForm } from './PrayerRequestForm';
import { TeachingPlayer } from './TeachingPlayer';
import { SettingsPanel } from './SettingsPanel';
import { CommunityPlaceholder } from './CommunityPlaceholder';

const transport = new DefaultChatTransport({ api: '/api/chat' });

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [currentEmotion, setCurrentEmotion] = useState<Emotion>('neutral');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>('ready');

  const { loadMessages, saveMessages, clearHistory } = useChatHistory();
  const { voiceState, startListening, startProcessing, startSpeaking, reset } = useVoiceState();
  const { speak, queueSentence, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();
  const spokenLengthRef = useRef(0); // Track how much text we've already queued for TTS

  const { messages, sendMessage, status, setMessages } = useChat({
    transport,
  });

  // Load history on mount
  useEffect(() => {
    const saved = loadMessages();
    if (saved.length > 0) {
      setMessages(saved);
    }
    setMounted(true);
  }, [loadMessages, setMessages]);

  // Save messages when they change
  useEffect(() => {
    if (mounted && messages.length > 0) {
      saveMessages(messages);
    }
  }, [messages, saveMessages, mounted]);

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

    // Parse emotion tag from the full response text
    const { emotion, cleanText: fullText } = parseEmotionTag(rawText);
    setCurrentEmotion(emotion);

    // When streaming starts, mark this message as speaking
    if (status === 'streaming' && !speakingMessageId) {
      setSpeakingMessageId(lastMessage.id);
      startSpeaking();
      spokenLengthRef.current = 0;
    }

    // Extract new sentences from the unprocessed portion
    if (status === 'streaming' || (prevStatusRef.current === 'streaming' && status === 'ready')) {
      const unprocessed = fullText.slice(spokenLengthRef.current);
      // Match complete sentences (ending with . ! ? or ...)
      const sentenceRegex = /[^.!?]+[.!?]+/g;
      let match;
      let lastEnd = 0;
      while ((match = sentenceRegex.exec(unprocessed)) !== null) {
        const sentence = match[0].trim();
        if (sentence.length > 5) { // Skip very short fragments
          queueSentence(sentence);
        }
        lastEnd = match.index + match[0].length;
      }
      if (lastEnd > 0) {
        spokenLengthRef.current += lastEnd;
      }
    }

    // When streaming completes, flush any remaining text and signal end
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      const remaining = fullText.slice(spokenLengthRef.current).trim();
      if (remaining.length > 5) {
        queueSentence(remaining);
      }
      queueSentence(null); // Signal end of stream
      spokenLengthRef.current = 0;
    }

    prevStatusRef.current = status;
  }, [status, messages, autoSpeak, queueSentence, speakingMessageId, startSpeaking]);

  // Update voice state when speaking state changes
  useEffect(() => {
    if (!isSpeaking && voiceState === 'speaking') {
      setSpeakingMessageId(null);
      reset();
    }
  }, [isSpeaking, voiceState, reset]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle voice recognition result
  const handleVoiceResult = useCallback((transcript: string) => {
    startProcessing();
    sendMessage({ text: transcript });
  }, [startProcessing, sendMessage]);

  const { interimTranscript, isListening, isSupported, error: voiceError, start: startRecognition, stop: stopRecognition } = useSpeechRecognition(handleVoiceResult);

  // Stop mic when TTS starts speaking to prevent self-listening loop
  useEffect(() => {
    if (isSpeaking && isListening) {
      stopRecognition();
    }
  }, [isSpeaking, isListening, stopRecognition]);

  // Sync listening state
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
      // Interrupt: stop TTS and immediately start listening
      stopSpeaking();
      setSpeakingMessageId(null);
      reset();
      // Small delay to let audio fully stop before opening mic
      setTimeout(() => startRecognition(), 150);
    } else {
      startRecognition();
    }
  }

  function handleClearHistory() {
    clearHistory();
    setMessages([]);
  }

  return (
    <div className="flex flex-col min-h-screen bg-stone-50">
      <div className="flex-1 flex flex-col max-w-md mx-auto w-full">
        {/* Dark hero with title, visualizers, image */}
        <HeroSection voiceState={voiceState} interimTranscript={interimTranscript} emotion={currentEmotion} />

        {/* Action buttons — hidden in voice-only mode */}
        {!autoSpeak && (
          <ActionButtons
            onAskQuestion={handleAskQuestion}
            onOpenPanel={setActivePanel}
          />
        )}

        {/* Voice-only mode: no chat text, just a floating mic and status */}
        {autoSpeak ? (
          <>
            <div className="flex-1" />
            {/* Status indicator overlay */}
            <div className="px-4 py-3 text-center">
              {voiceError && (
                <div className="py-2 px-3 bg-amber-50/90 border border-amber-200 rounded-lg text-amber-700 text-xs mb-2">
                  {voiceError}
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
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i} className="w-1 rounded-full bg-amber-400 animate-pulse" style={{ height: `${8 + Math.random() * 8}px`, animationDelay: `${i * 0.15}s` }} />
                    ))}
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
                    const displayText = message.role === 'assistant' ? parseEmotionTag(rawMsgText).cleanText : rawMsgText;
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
            {/* Floating mic + settings + transcript buttons */}
            <div className="sticky bottom-0 bg-transparent px-4 py-4">
              <div className="flex items-center justify-center gap-4">
                {/* Settings button */}
                <button
                  onClick={() => setActivePanel('settings')}
                  className="w-10 h-10 rounded-full bg-stone-200 flex items-center justify-center
                    text-stone-500 active:scale-95 transition-transform shadow-sm"
                  aria-label="Settings"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                  </svg>
                </button>
                <VoiceButton
                  voiceState={voiceState}
                  onStart={handleVoiceToggle}
                  onStop={handleVoiceToggle}
                  isSupported={isSupported}
                />
                {/* Transcript toggle */}
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className={`w-10 h-10 rounded-full flex items-center justify-center
                    active:scale-95 transition-transform shadow-sm ${showTranscript ? 'bg-teal-500 text-white' : 'bg-stone-200 text-stone-500'}`}
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
            {/* Chat history section — only shown when autoSpeak is off */}
            <div className="flex-1 px-4 py-2 space-y-3 overflow-y-auto border-t border-stone-200">
              {voiceError && (
                <div className="text-center py-2 px-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-xs animate-fade-in">
                  {voiceError}
                </div>
              )}
              {messages.length === 0 && mounted && !voiceError && (
                <div className="text-center py-4 text-stone-400">
                  <p className="text-sm">Ask a question to begin your journey</p>
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
                        <div
                          key={i}
                          className="w-2 h-2 rounded-full bg-teal-400 animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar — only in text mode */}
            <div className="sticky bottom-0 bg-stone-50/95 backdrop-blur-sm border-t border-stone-200 px-4 py-3">
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
      />
      <CommunityPlaceholder
        isOpen={activePanel === 'community'}
        onClose={() => setActivePanel('none')}
      />
    </div>
  );
}
