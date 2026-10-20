'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { downloadExport, type ExportFormat } from '@/lib/conversation-export';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';

interface ExportButtonProps {
  /** Optional className applied to the trigger button */
  className?: string;
  /** The chat as shown on screen. Without it the export reads the saved
   *  copy, which keeps only the last 100 messages. */
  messages?: ReadonlyArray<unknown>;
}

interface FormatOption {
  format: ExportFormat;
  label: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  { format: 'markdown', label: 'Markdown (.md)' },
  { format: 'json', label: 'JSON (.json)' },
  { format: 'plaintext', label: 'Plain text (.txt)' },
];

/**
 * Small download icon — outline style, matches the iconography elsewhere in
 * the app (compare with ShareButton.tsx). Inline SVG so we don't pull in an
 * icon library for one glyph.
 */
function DownloadIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

/**
 * "Export your data" button + dropdown menu.
 *
 * The dropdown is intentionally lightweight — no portal, no transition, no
 * floating-ui — it sits in the same stacking context as its trigger and is
 * positioned with `absolute` below + right-aligned. Click-outside and
 * Escape close it. First option is auto-focused on open, arrow keys move
 * focus between options.
 */
export function ExportButton({ className, messages }: ExportButtonProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Click-outside handler. We listen on `mousedown` rather than `click` so a
  // press-and-drag that ends inside the menu still closes when the press
  // started outside — feels more correct than waiting for the full click.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const root = containerRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && root.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isOpen, close]);

  // Escape closes — listened at document level since the menu may steal focus
  // from arbitrary descendants. Closing returns focus to the trigger so
  // keyboard users don't lose their place. Capture phase + preventDefault so
  // the Settings sheet's own Escape handler (useModalA11y, bubble phase on
  // document) doesn't also close the whole sheet.
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [isOpen, close]);

  // When the menu opens, focus the first option.
  useEffect(() => {
    if (!isOpen) return;
    // rAF lets the elements actually mount before we grab the ref.
    const id = requestAnimationFrame(() => {
      optionRefs.current[0]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  const handleSelect = useCallback(
    (format: ExportFormat) => {
      close();
      // Return focus to the trigger so screen readers announce where we are.
      triggerRef.current?.focus();

      const ok = downloadExport({ format, messages });
      if (ok) {
        toast.success('Export ready — download starting');
        track('export.downloaded', { format });
      } else {
        toast.error('Could not export — please try again');
      }
    },
    [close, messages]
  );

  // Roving focus via Arrow keys on the menu options.
  const handleOptionKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = (index + 1) % FORMAT_OPTIONS.length;
        optionRefs.current[next]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev =
          (index - 1 + FORMAT_OPTIONS.length) % FORMAT_OPTIONS.length;
        optionRefs.current[prev]?.focus();
      } else if (event.key === 'Home') {
        event.preventDefault();
        optionRefs.current[0]?.focus();
      } else if (event.key === 'End') {
        event.preventDefault();
        optionRefs.current[FORMAT_OPTIONS.length - 1]?.focus();
      }
    },
    []
  );

  const triggerClasses = [
    'inline-flex items-center gap-2',
    'rounded-xl border border-stone-200 px-4 py-2',
    'text-sm font-medium text-stone-700',
    'bg-white',
    'transition-transform active:scale-[0.98]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={triggerClasses}
      >
        <DownloadIcon />
        <span>Export your data</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Export format"
          className={[
            // Position: directly below trigger, right-aligned.
            'absolute right-0 top-full mt-2 z-50',
            // Card chrome — matches the spec precisely.
            'min-w-[200px] bg-white rounded-xl shadow-lg',
            'border border-stone-200 p-2',
          ].join(' ')}
        >
          {FORMAT_OPTIONS.map((opt, idx) => (
            <button
              key={opt.format}
              ref={el => {
                optionRefs.current[idx] = el;
              }}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(opt.format)}
              onKeyDown={e => handleOptionKey(e, idx)}
              className={[
                'block w-full text-left',
                'rounded-lg px-3 py-2',
                'text-sm font-medium text-stone-700',
                'hover:bg-stone-50',
                'focus:outline-none focus:bg-stone-100',
                'transition-colors',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
