'use client';

import { useState } from 'react';
import type { UIMessage } from 'ai';

interface ChatMessageProps {
  message: UIMessage;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [expanded, setExpanded] = useState(false);

  const textContent = message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('');

  if (!textContent) return null;

  // Detect parable context references
  const parableMatch = textContent.match(/(?:Parable of the |parable of the )([^.!?,]+)/i);
  const contextLabel = parableMatch ? `Parable of the ${parableMatch[1].trim()}` : null;

  const isLong = textContent.length > 300;
  const displayText = isLong && !expanded ? textContent.slice(0, 280) + '...' : textContent;

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="bg-blue-500 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] shadow-sm">
          <p className="text-sm leading-relaxed">{textContent}</p>
        </div>
      </div>
    );
  }

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
