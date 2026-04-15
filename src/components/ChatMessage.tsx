'use client';

import { useState } from 'react';
import type { UIMessage } from 'ai';
import { parseEmotionTag } from '@/lib/emotions';

interface ChatMessageProps {
  message: UIMessage;
  hidden?: boolean; // Voice-only mode: hide AI response text while speaking
}

export function ChatMessage({ message, hidden = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [expanded, setExpanded] = useState(false);

  const rawText = message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('');

  // Strip emotion tags from assistant messages
  const textContent = !isUser ? parseEmotionTag(rawText).cleanText : rawText;

  if (!textContent) return null;

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="bg-blue-500 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] shadow-sm">
          <p className="text-sm leading-relaxed">{textContent}</p>
        </div>
      </div>
    );
  }

  // Voice-only: while speaking, show a minimal indicator instead of the full text
  if (hidden) {
    return (
      <div className="flex justify-start animate-fade-in">
        <div className="max-w-[90%]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-semibold text-amber-700 tracking-wide">jAIsus</span>
          </div>
          <div className="bg-white/60 border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: `${i * 0.3}s` }} />
                ))}
              </div>
              <span className="text-xs text-stone-400 italic">speaking...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Detect parable context references
  const parableMatch = textContent.match(/(?:Parable of the |parable of the )([^.!?,]+)/i);
  const contextLabel = parableMatch ? `Parable of the ${parableMatch[1].trim()}` : null;

  const isLong = textContent.length > 300;
  const displayText = isLong && !expanded ? textContent.slice(0, 280) + '...' : textContent;

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[90%]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-semibold text-amber-700 tracking-wide">jAIsus</span>
          {contextLabel && (
            <span className="text-[10px] text-stone-400 bg-stone-100 rounded-full px-2 py-0.5">
              {contextLabel}
            </span>
          )}
        </div>
        <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
          <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{displayText}</p>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-teal-600 font-medium mt-1.5 hover:underline"
            >
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
