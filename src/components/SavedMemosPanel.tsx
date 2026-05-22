'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import {
  type VoiceMemo,
  listVoiceMemos,
  deleteVoiceMemo,
  clearVoiceMemos,
  MEMOS_CHANGED_EVENT,
} from '@/lib/voice-memos';
import { EmptyState } from '@/components/EmptyState';
import { useHaptics } from '@/hooks/useHaptics';
import { toast } from '@/lib/toast';

interface SavedMemosPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Parent's TTS — so the voice matches the active personality. */
  onSpeak: (text: string) => void;
  onStopSpeaking: () => void;
  isSpeaking: boolean;
}

/**
 * Returns "today / yesterday / N days ago / Apr 25" relative time.
 * Snapshotted to a pinned "now" so the list doesn't churn on every render.
 */
function relativeTime(timestamp: number, now: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfCreated = new Date(timestamp);
  startOfCreated.setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfCreated.getTime()) / dayMs
  );
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  if (dayDiff < 14) return '1 week ago';
  if (dayDiff < 28) return `${Math.floor(dayDiff / 7)} weeks ago`;
  const created = new Date(timestamp);
  const sameYear = created.getFullYear() === new Date(now).getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return created.toLocaleDateString(undefined, opts);
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Panel listing saved voice memos. Each memo expands to show the full
 * transcript + jAIsus's response, with a Listen button that replays the
 * response via the parent's TTS (so it uses the currently-active
 * personality voice — not the voice that was active at record time).
 *
 * Storage is reactive: subscribes to MEMOS_CHANGED_EVENT + cross-tab
 * `storage` so newly-saved memos appear without a manual refresh.
 */
export function SavedMemosPanel({
  isOpen,
  onClose,
  onSpeak,
  onStopSpeaking,
  isSpeaking,
}: SavedMemosPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });
  const { vibrate } = useHaptics();

  const [memos, setMemos] = useState<VoiceMemo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The memo whose response is currently being read aloud. We track this
  // separately from isSpeaking because the parent's TTS is a singleton
  // shared with the main chat — multiple memos shouldn't all light up.
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Audit fix: per-item delete also two-taps to confirm.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const perItemConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pin "now" per-open so relative times don't shift while user reads.
  const [now, setNow] = useState<number>(() => Date.now());

  // Hydrate + subscribe. Empty initial state matches SSR.
  // Audit fix: the `storage` event fires for ANY localStorage key change
  // (favorites, voice-id, etc.). Filter to just our key so unrelated
  // mutations don't trigger needless work + re-renders.
  useEffect(() => {
    const refresh = () => setMemos(listVoiceMemos());
    refresh();
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      // `e.key === null` happens on localStorage.clear() — refresh in that case too.
      if (e.key === 'jaisus-voice-memos' || e.key === null) refresh();
    };
    window.addEventListener(MEMOS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(MEMOS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Audit fix: keep onStopSpeaking in a ref so the close+unmount effects
  // can call it without re-binding on every parent re-render (and without
  // the stale `speakingId` dep causing the cleanup branch to skip when
  // close + isSpeaking flip in the same tick).
  const onStopSpeakingRef = useRef(onStopSpeaking);
  useEffect(() => { onStopSpeakingRef.current = onStopSpeaking; }, [onStopSpeaking]);

  // Reset transient UI + refresh "now" snapshot on each open.
  // Audit fix: dropped `speakingId` from deps. Previously the close path
  // could miss the stop call when isSpeaking and isOpen flipped together
  // (the speakingId watcher below cleared the id before this effect ran).
  // We now unconditionally call onStopSpeaking on close — it's idempotent
  // in the parent — and rely on the ref to avoid re-binding noise.
  useEffect(() => {
    if (!isOpen) {
      setExpandedId(null);
      setConfirmingClear(false);
      setConfirmingDeleteId(null);
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      if (perItemConfirmTimerRef.current) {
        clearTimeout(perItemConfirmTimerRef.current);
        perItemConfirmTimerRef.current = null;
      }
      onStopSpeakingRef.current();
      setSpeakingId(null);
      return;
    }
    setNow(Date.now());
  }, [isOpen]);

  // If TTS naturally ends (or the parent stops it for another reason),
  // clear the per-memo speaking indicator so the icon flips back.
  useEffect(() => {
    if (!isSpeaking && speakingId) {
      setSpeakingId(null);
    }
  }, [isSpeaking, speakingId]);

  // Cleanup pending confirm timer on unmount.
  // Audit fix: also stop any in-flight TTS on unmount. Previously, a route
  // change / parent unmount mid-playback would leak the audio.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      if (perItemConfirmTimerRef.current) clearTimeout(perItemConfirmTimerRef.current);
      onStopSpeakingRef.current();
    };
  }, []);

  const handleListen = (m: VoiceMemo) => {
    vibrate('tap');
    if (speakingId === m.id && isSpeaking) {
      onStopSpeaking();
      setSpeakingId(null);
      return;
    }
    // Stop any prior playback before starting this one — the TTS hook is
    // a queue, but the caller (`onSpeak`) replaces the current utterance.
    if (isSpeaking) onStopSpeaking();
    onSpeak(m.response);
    setSpeakingId(m.id);
  };

  const handleDelete = (id: string) => {
    vibrate('tap');
    // Audit fix: two-tap confirm so a fat-finger doesn't silently erase a
    // memo. Same pattern as Clear-all below: first tap arms `confirmingId`,
    // second tap (or any tap within 3s) commits. Tap-elsewhere or 3s timeout
    // disarms.
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      if (perItemConfirmTimerRef.current) clearTimeout(perItemConfirmTimerRef.current);
      perItemConfirmTimerRef.current = setTimeout(() => {
        setConfirmingDeleteId(null);
        perItemConfirmTimerRef.current = null;
      }, 3000);
      return;
    }
    if (perItemConfirmTimerRef.current) {
      clearTimeout(perItemConfirmTimerRef.current);
      perItemConfirmTimerRef.current = null;
    }
    setConfirmingDeleteId(null);
    if (speakingId === id) {
      onStopSpeaking();
      setSpeakingId(null);
    }
    // Audit fix: surface failure too — writeAll can return false on quota
    // exhaustion / read-only filesystem. Previously we silently no-op'd.
    if (deleteVoiceMemo(id)) {
      toast.success('Memo deleted');
    } else {
      toast.error("Couldn't delete memo — storage unavailable.");
    }
  };

  const handleClearClick = () => {
    if (!confirmingClear) {
      setConfirmingClear(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingClear(false);
        confirmTimerRef.current = null;
      }, 3000);
      return;
    }
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
    if (isSpeaking) onStopSpeaking();
    setSpeakingId(null);
    clearVoiceMemos();
    setConfirmingClear(false);
    toast.success('All memos cleared');
  };

  return (
    <div
      className={`fixed inset-0 z-50 transition-all duration-300 ${
        isOpen ? 'visible' : 'invisible'
      }`}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-memos-title"
        className={`absolute bottom-0 left-0 right-0 max-h-[85vh] bg-white rounded-t-2xl shadow-2xl
          transition-transform duration-300 ease-out ${
            isOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <div className="px-4 pb-1 flex items-center justify-between gap-3">
          <h2 id="saved-memos-title" className="text-lg font-bold text-stone-800">
            Voice memos ({memos.length})
          </h2>
          {memos.length > 0 && (
            <button
              type="button"
              onClick={handleClearClick}
              aria-label={
                confirmingClear
                  ? 'Confirm clear all voice memos'
                  : 'Clear all voice memos'
              }
              className={`text-xs ${
                confirmingClear
                  ? 'text-rose-700 font-semibold'
                  : 'text-rose-600 hover:underline'
              } active:scale-[0.98] transition-transform`}
            >
              {confirmingClear ? 'Sure? Tap again to confirm' : 'Clear all'}
            </button>
          )}
        </div>

        <p className="px-4 text-xs text-stone-500 mt-1 pb-2">
          Reflections you&apos;ve recorded and saved. Tap any memo to expand,
          or hit Listen to replay jAIsus&apos;s response in the current voice.
        </p>

        <div className="overflow-y-auto px-4 pb-6 max-h-[70vh] modal-scroll">
          {memos.length === 0 ? (
            <EmptyState
              icon="🎙️"
              title="No memos yet"
              description="Record a voice memo and save it — your saved reflections will live here."
            />
          ) : (
            <ul className="pt-2" role="list">
              {memos.map((m) => {
                const isExpanded = expandedId === m.id;
                const isPlaying = speakingId === m.id && isSpeaking;
                return (
                  <li
                    key={m.id}
                    className="bg-stone-50 rounded-xl border border-stone-200 p-3 mb-2"
                  >
                    {/* Header row: date + duration + delete */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-stone-500 shrink-0">
                          {relativeTime(m.createdAt, now)}
                        </span>
                        <span className="text-[10px] text-stone-400 shrink-0">
                          · {fmtDuration(m.durationSec)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.id)}
                        aria-label={confirmingDeleteId === m.id ? 'Tap again to confirm delete' : 'Delete this memo'}
                        className={`min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-full active:scale-[0.95] transition-all text-xs px-2 ${
                          confirmingDeleteId === m.id
                            ? 'bg-rose-500 text-white font-semibold'
                            : 'text-stone-400 hover:text-rose-600 hover:bg-rose-50'
                        }`}
                      >
                        {confirmingDeleteId === m.id ? 'Confirm?' : <span aria-hidden="true">❌</span>}
                      </button>
                    </div>

                    {/* Summary (always visible) */}
                    <p className="text-sm text-amber-900 italic leading-relaxed">
                      &ldquo;{m.summary}&rdquo;
                    </p>

                    {/* Themes pills */}
                    {m.themes.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.themes.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-medium"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions row */}
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => handleListen(m)}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium active:scale-95 transition-transform ${
                          isPlaying
                            ? 'bg-rose-500 text-white'
                            : 'bg-teal-500 text-white'
                        }`}
                        aria-label={isPlaying ? 'Stop playback' : 'Listen to reflection'}
                      >
                        {isPlaying ? '■ Stop' : '▶ Listen'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          vibrate('tap');
                          setExpandedId(isExpanded ? null : m.id);
                        }}
                        className="rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 active:scale-95"
                        aria-expanded={isExpanded}
                        aria-controls={`memo-detail-${m.id}`}
                      >
                        {isExpanded ? 'Hide' : 'Read'}
                      </button>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div id={`memo-detail-${m.id}`} className="mt-3 space-y-3">
                        <div className="rounded-lg bg-white border border-stone-200 p-3">
                          <p className="text-[10px] uppercase tracking-wide text-teal-700 font-medium">
                            Reflection
                          </p>
                          <p className="text-sm text-stone-700 mt-1 leading-relaxed whitespace-pre-wrap">
                            {m.response}
                          </p>
                        </div>
                        {m.transcript && (
                          <details className="rounded-lg bg-stone-100 p-3">
                            <summary className="text-[10px] uppercase tracking-wide text-stone-500 font-medium cursor-pointer select-none">
                              Transcript
                            </summary>
                            <p className="text-xs text-stone-600 mt-1.5 leading-relaxed whitespace-pre-wrap">
                              {m.transcript}
                            </p>
                          </details>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
