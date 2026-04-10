'use client';

import { useState } from 'react';
import type { ActivePanel } from '@/lib/types';

interface ActionButtonsProps {
  onAskQuestion: () => void;
  onOpenPanel: (panel: ActivePanel) => void;
}

export function ActionButtons({ onAskQuestion, onOpenPanel }: ActionButtonsProps) {
  const [activeTab, setActiveTab] = useState<'teachings' | 'listen'>('teachings');

  return (
    <div className="px-4 py-3 space-y-2.5">
      {/* Dynamic Teachings / Listen tab bar */}
      <div className="flex items-center bg-stone-100 rounded-xl p-1">
        <button
          onClick={() => {
            setActiveTab('teachings');
            onOpenPanel('teachings');
          }}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
            activeTab === 'teachings'
              ? 'bg-white text-teal-700 shadow-sm'
              : 'text-stone-500'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          Dynamic Teachings
        </button>
        <button
          onClick={() => setActiveTab('listen')}
          className={`flex-1 flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors ${
            activeTab === 'listen'
              ? 'bg-white text-teal-700 shadow-sm'
              : 'text-stone-500'
          }`}
        >
          Listen/app
        </button>
      </div>

      {/* Ask a Question — full width primary CTA */}
      <button
        onClick={onAskQuestion}
        className="w-full flex items-center justify-center gap-3 rounded-xl bg-blue-500 px-4 py-3 text-white font-semibold shadow-md shadow-blue-200 active:scale-[0.98] transition-transform"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="1" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
        Ask a Question
      </button>

      {/* Feature buttons row */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onOpenPanel('prayer')}
          className="flex items-center gap-2 rounded-xl bg-white border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-700 active:scale-[0.97] transition-transform shadow-sm"
        >
          <span className="text-lg">🙏</span>
          Request Prayer
        </button>
        <button
          onClick={() => onOpenPanel('parables')}
          className="flex items-center gap-2 rounded-xl bg-white border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-700 active:scale-[0.97] transition-transform shadow-sm"
        >
          <span className="text-lg">📖</span>
          Explore Parables
        </button>
      </div>

      {/* Second row: Community, Settings */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onOpenPanel('community')}
          className="flex items-center gap-2 rounded-xl bg-white border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.97] transition-transform shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          Community
        </button>
        <button
          onClick={() => onOpenPanel('settings')}
          className="flex items-center gap-2 rounded-xl bg-white border border-stone-200 px-3 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.97] transition-transform shadow-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </div>
    </div>
  );
}
