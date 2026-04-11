'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { ActivePanel } from '@/lib/types';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '@/hooks/useSpeechSynthesis';
import { useVoiceState } from '@/hooks/useVoiceState';
import { useChatHistory } from '@/hooks/useChatHistory';
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
  const [mounted, setMounted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef<string>('ready');

  const { loadMessages, saveMessages, clearHistory } = useChatHistory();
  const { voiceState, startListening, startProcessing, startSpeaking, reset } = useVoiceState();
  const { speak, stop: stopSpeaking, isSpeaking } = useSpeechSynthesis();

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

  // Auto-speak AI responses when streaming completes
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready' && autoSpeak && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {
        const text = lastMessage.parts
          .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
          .map(p => p.text)
          .join('');
        if (text) {
          startSpeaking();
          speak(text).then(reset);
        }
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, autoSpeak, speak, startSpeaking, reset]);

  // Update voice state when speaking state changes
  useEffect(() => {
    if (!isSpeaking && voiceState === 'speaking') {
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
    } else if (voiceState === 'speaking') {
      stopSpeaking();
      reset();
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
        <HeroSection voiceState={voiceState} interimTranscript={interimTranscript} />

        {/* Action buttons (tabs, ask, features) */}
        <ActionButtons
          onAskQuestion={handleAskQuestion}
          onOpenPanel={setActivePanel}
        />

        {/* Chat history section */}
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

        {/* Input bar with floating mic */}
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
      />
      <CommunityPlaceholder
        isOpen={activePanel === 'community'}
        onClose={() => setActivePanel('none')}
      />
    </div>
  );
}
