'use client';

import { useState, useRef } from 'react';
import { parables } from '@/lib/parables';
import type { Parable } from '@/lib/types';
import { useModalA11y } from '@/hooks/useModalA11y';
import { EmptyState } from '@/components/EmptyState';
import { ParableReader } from '@/components/ParableReader';

interface ParablesDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onAskAbout: (prompt: string) => void;
}

export function ParablesDrawer({ isOpen, onClose, onAskAbout }: ParablesDrawerProps) {
  const [search, setSearch] = useState('');
  const [readingParable, setReadingParable] = useState<Parable | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

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
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parables-title"
        className={`absolute bottom-0 left-0 right-0 max-h-[80vh] bg-white rounded-t-2xl shadow-2xl
          transition-transform duration-300 ease-out ${
          isOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <div className="px-4 pb-2">
          <h2 id="parables-title" className="text-lg font-bold text-stone-800">Explore Parables</h2>
          <label htmlFor="parables-search" className="sr-only">Search parables</label>
          <input
            id="parables-search"
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search parables or themes..."
            className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>

        <div className="overflow-y-auto px-4 pb-6 max-h-[60vh] modal-scroll">
          {filtered.length === 0 && search !== '' && (
            <EmptyState
              icon="🔍"
              title="No parables match"
              description={`Nothing for "${search}". Try another word or theme.`}
            />
          )}
          {filtered.length === 0 && search === '' && (
            <EmptyState
              icon="📖"
              title="No parables available"
              description="There aren't any parables loaded right now."
            />
          )}
          <div className="space-y-2 pt-2">
            {filtered.map(parable => (
              <button
                key={parable.id}
                onClick={() => setReadingParable(parable)}
                className="w-full flex items-start gap-3 p-3 text-left rounded-xl border border-stone-200 bg-stone-50 active:scale-[0.99] transition-transform"
                aria-label={`Open ${parable.title} in reading mode`}
              >
                <span className="text-2xl shrink-0" aria-hidden="true">📖</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-stone-800 text-sm">{parable.title}</p>
                  <p className="text-xs text-stone-500">{parable.reference}</p>
                  <p className="text-xs text-stone-600 mt-1 line-clamp-2">{parable.summary}</p>
                </div>
                <svg
                  className="w-4 h-4 shrink-0 text-stone-400"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Full-screen reading mode for the picked parable */}
      <ParableReader
        parable={readingParable}
        onClose={() => setReadingParable(null)}
        onAskAbout={(prompt) => {
          onAskAbout(prompt);
          setReadingParable(null);
          onClose(); // also close the drawer so user lands in chat
        }}
      />
    </div>
  );
}
