'use client';

import { useState } from 'react';
import { parables } from '@/lib/parables';

interface ParablesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onAskAbout: (prompt: string) => void;
}

export function ParablesDrawer({ isOpen, onClose, onAskAbout }: ParablesDrawerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = parables.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.themes.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${
        isOpen ? 'visible' : 'invisible'
      }`}
    >
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`absolute bottom-0 left-0 right-0 max-h-[80vh] bg-white rounded-t-2xl shadow-2xl
          transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" />
        </div>

        <div className="px-4 pb-2">
          <h2 className="text-lg font-bold text-stone-800">Explore Parables</h2>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search parables or themes..."
            className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>

        <div className="overflow-y-auto px-4 pb-6 max-h-[60vh]">
          <div className="space-y-2 pt-2">
            {filtered.map(parable => (
              <div
                key={parable.id}
                className="rounded-xl border border-stone-200 bg-stone-50 overflow-hidden"
              >
                <button
                  onClick={() => setExpanded(expanded === parable.id ? null : parable.id)}
                  className="w-full flex items-start gap-3 p-3 text-left"
                >
                  <span className="text-2xl shrink-0">📖</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-stone-800 text-sm">{parable.title}</p>
                    <p className="text-xs text-stone-500">{parable.reference}</p>
                    <p className="text-xs text-stone-600 mt-1 line-clamp-2">{parable.summary}</p>
                  </div>
                  <svg
                    className={`w-4 h-4 shrink-0 text-stone-400 transition-transform ${
                      expanded === parable.id ? 'rotate-180' : ''
                    }`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {expanded === parable.id && (
                  <div className="px-3 pb-3 animate-fade-in">
                    <p className="text-xs text-stone-600 leading-relaxed border-t border-stone-200 pt-2">
                      {parable.fullText}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {parable.themes.map(theme => (
                        <span
                          key={theme}
                          className="rounded-full bg-teal-100 text-teal-700 px-2 py-0.5 text-xs"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        onAskAbout(parable.suggestPrompt);
                        onClose();
                      }}
                      className="mt-3 w-full rounded-lg bg-teal-500 text-white text-sm py-2 font-medium active:scale-[0.98] transition-transform"
                    >
                      Ask jAIsus about this parable
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
