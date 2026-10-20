'use client';

import { memo, useMemo, useState } from 'react';
import type { UIMessage } from 'ai';
import { stripAllEmotionTags, stripTrailingEmotionTag } from '@/lib/emotions';
import { FavoriteButton } from './FavoriteButton';
import { ShareButton } from './ShareButton';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { useLongPress } from '@/hooks/useLongPress';
import { toggleFavoriteResult, favoriteId, isFavorite } from '@/lib/favorites';
import { toast } from '@/lib/toast';
import { parables } from '@/lib/parables';

interface ChatMessageProps {
  message: UIMessage;
  hidden?: boolean; // Voice-only mode: hide AI response text while speaking
  /** The reply is still arriving: no saving or sharing a partial text. */
  isStreaming?: boolean;
}

/**
 * Drops an [EMOTION:...] tag that is still arriving at the end of a streamed
 * reply ("My child. [EMOTION:wa"). stripAllEmotionTags now does this itself;
 * kept as an export for existing callers.
 */
export function stripPartialEmotionTag(text: string): string {
  return stripTrailingEmotionTag(text);
}

// Known parable names as they follow "Parable of the": "Mustard Seed", ...
// Longest first, so a name that starts with a shorter one wins.
const PARABLE_NAMES = parables
  .filter(p => p.title.startsWith('The '))
  .map(p => p.title.slice(4))
  .sort((a, b) => b.length - a.length);

/** "Parable of the Sower" for a reply that mentions one, else null. */
function parableLabel(text: string): string | null {
  // Dashes end the name too: "the talents—the servant who…".
  const match = text.match(/parable of the ([^.!?,;:\n"“”*()—–]+)/i);
  if (!match) return null;
  const rest = match[1].trim();
  const lower = rest.toLowerCase();
  // A known name followed by anything but a letter: "prodigal son's" and
  // "talents-" match, "net" does not match "network".
  const known = PARABLE_NAMES.find(name => {
    const n = name.toLowerCase();
    return lower.startsWith(n) && !/^[\p{L}\p{N}]/u.test(lower.slice(n.length));
  });
  // An unknown one: its first few words, not the rest of the sentence.
  const name = known ?? rest.split(/\s+/).slice(0, 3).join(' ');
  return name ? `Parable of the ${name}` : null;
}

function ChatMessageImpl({ message, hidden = false, isStreaming = false }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [expanded, setExpanded] = useState(false);
  // Long-press / right-click context menu (assistant messages only).
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const rawText = message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map(part => part.text)
    .join('');

  // Strip all per-sentence emotion tags from assistant messages
  // (also drops a half-streamed tag at the end).
  const textContent = !isUser ? stripAllEmotionTags(rawText).cleanText : rawText;

  // Detect parable context references
  const contextLabel = parableLabel(textContent);

  // useLongPress is called every render (hook rules) regardless of whether we
  // bind it; we only spread `bind` onto the assistant bubble below. The
  // callback extracts the pointer position from MouseEvent/TouchEvent for the
  // ContextMenu anchor.
  const bind = useLongPress({
    onLongPress: (e) => {
      let x = 0;
      let y = 0;
      if ('touches' in e && e.touches && e.touches.length > 0) {
        x = e.touches[0].clientX;
        y = e.touches[0].clientY;
      } else if ('changedTouches' in e && e.changedTouches && e.changedTouches.length > 0) {
        x = e.changedTouches[0].clientX;
        y = e.changedTouches[0].clientY;
      } else if ('clientX' in e) {
        x = (e as MouseEvent).clientX;
        y = (e as MouseEvent).clientY;
      }
      setMenu({ x, y });
    },
    enableRightClick: true,
  });

  // Build the menu items lazily. Defined here (above any early returns) so the
  // hook order is stable. The `items` array is only consumed below in the
  // assistant-message branch, but the memo runs unconditionally — cheap, and
  // keeps the rules-of-hooks contract.
  // Read from storage each time the menu opens: the heart button (or this
  // menu) may have changed it since.
  const alreadySaved = menu !== null && isFavorite(favoriteId('message', textContent));
  const items: ContextMenuItem[] = useMemo(() => {
    const handleCopy = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(textContent);
          toast.success('Copied');
        } else {
          toast.error("Couldn't copy");
        }
      } catch {
        toast.error("Couldn't copy");
      }
    };

    const handleShare = async () => {
      const shareText = `${textContent.trim()}\n\n— shared from jAIsus${contextLabel ? `\n${contextLabel}` : ''}`;
      const canNativeShare =
        typeof navigator !== 'undefined' && typeof navigator.share === 'function';
      if (canNativeShare) {
        try {
          await navigator.share({ title: 'jAIsus', text: shareText });
          toast.success('Shared!');
          return;
        } catch (err) {
          // User cancellation = quiet exit; other errors = fall through to clipboard.
          if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return;
        }
      }
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareText);
          toast.success('Copied!');
        }
      } catch {
        // Silent — no clipboard fallback either.
      }
    };

    const handleToggleSave = () => {
      const { status } = toggleFavoriteResult({
        kind: 'message',
        content: textContent,
        context: contextLabel ?? undefined,
      });
      if (status === 'failed') {
        toast.error("Couldn't save — storage unavailable");
      } else if (status === 'added') {
        toast.success('Saved to favorites');
      } else {
        toast('Removed from favorites');
      }
    };

    return [
      {
        id: 'copy',
        label: 'Copy',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        ),
        onClick: handleCopy,
      },
      {
        id: 'share',
        label: 'Share',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        ),
        onClick: handleShare,
      },
      {
        id: 'save',
        label: alreadySaved ? 'Unsave' : 'Save',
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill={alreadySaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={alreadySaved ? 'text-rose-500' : ''}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        ),
        onClick: handleToggleSave,
      },
    ];
  }, [textContent, contextLabel, alreadySaved]);

  if (!textContent) return null;

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="bg-blue-500 text-white rounded-2xl rounded-br-sm px-4 py-2.5 max-w-[85%] shadow-sm">
          <p className="text-sm leading-relaxed [overflow-wrap:anywhere]">{textContent}</p>
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
              <span className="text-xs text-stone-500 italic">speaking...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isLong = textContent.length > 300;
  // Audit fix: a raw .slice(0, 280) can land mid-emoji / mid-grapheme,
  // producing visible mojibake. Cut at the last word boundary at or before
  // 280 chars; fall back to the raw cut if no space is found in the head.
  const displayText = isLong && !expanded
    ? (() => {
        const wordBoundary = textContent.lastIndexOf(' ', 280);
        const cut = wordBoundary > 200 ? wordBoundary : 280;
        return textContent.slice(0, cut).trimEnd() + '…';
      })()
    : textContent;

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[90%]">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-semibold text-amber-700 tracking-wide">jAIsus</span>
          {contextLabel && (
            <span
              className="min-w-0 max-w-[10rem] truncate text-[10px] text-stone-600 bg-stone-100 rounded-full px-2 py-0.5"
              title={contextLabel}
            >
              {contextLabel}
            </span>
          )}
          {/* Hidden (not removed) while streaming, so the row keeps its height. */}
          <FavoriteButton
            kind="message"
            content={textContent}
            context={contextLabel ?? undefined}
            size="sm"
            className={isStreaming ? 'ml-auto invisible' : 'ml-auto'}
          />
          <ShareButton
            kind="message"
            content={textContent}
            context={contextLabel ?? undefined}
            size="sm"
            className={isStreaming ? '-mr-1 invisible' : '-mr-1'}
          />
        </div>
        {/* Long-press / right-click opens a context menu. The header icons
            (Favorite, Share) remain — long-press is a power-user shortcut. */}
        <div
          {...(isStreaming ? {} : bind)}
          className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm select-none"
        >
          <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{displayText}</p>
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
      <ContextMenu
        isOpen={menu !== null}
        position={menu}
        items={items}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

// Perf audit fix: memoize so a re-render of the chat list (ChatInterface
// re-renders on every streaming token) doesn't rebuild N ChatMessages.
// The `message` prop is a stable object reference from useChat until it
// actually changes; `hidden` is a boolean. Default shallow-equality is
// sufficient — no custom comparator needed.
export const ChatMessage = memo(ChatMessageImpl);
