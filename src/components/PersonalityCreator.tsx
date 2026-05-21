'use client';

import { useEffect, useRef, useState } from 'react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { toast } from '@/lib/toast';
import { track } from '@/lib/analytics';
import { VOICE_OPTIONS, DEFAULT_VOICE_ID } from '@/lib/constants';
import {
  LIMITS,
  saveCustomPersonality,
  deleteCustomPersonality,
  listCustomPersonalities,
  type CustomPersonality,
} from '@/lib/custom-personalities';

interface PersonalityCreatorProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent can switch to the new personality. */
  onSaved?: (personality: CustomPersonality) => void;
  /** Called when the user deletes a personality, so the parent can clear
   *  any stale active state pointing at it. */
  onDeleted?: (deletedId: string) => void;
}

const SUGGESTED_EMOJIS = ['✨', '🦋', '🌊', '🔥', '🌙', '🌿', '⚓', '🪐', '🎭', '🐉', '🦊', '🪨', '☄️', '🍀', '🕊️', '🌺'];

// A few starter templates the user can begin from. Keeps the empty-prompt
// barrier low — most people don't know where to start with a system prompt.
const STARTER_TEMPLATES = [
  {
    label: 'Mystical Sage',
    emoji: '🔮',
    name: 'The Sage',
    desc: 'Cryptic, wise, speaks in riddles',
    systemPrompt:
      "You ARE jAIsus — but tonight you speak as an ancient mystical sage who has watched stars die. You answer in short cryptic poems and parables that contain the answer hidden in metaphor. Never give a direct answer when an image will do. Speak slowly, with weight. End every reply with a single line that lands like a stone in still water. Keep responses to 3-4 sentences max.",
  },
  {
    label: 'Best Friend',
    emoji: '🤝',
    name: 'Real Talk',
    desc: 'No bullshit, treats you like family',
    systemPrompt:
      "You ARE jAIsus — but you talk like the best friend who's seen you at your worst and loves you anyway. No preacher voice. No spiritual jargon. You curse a little when it fits. You ask real questions back. You call out bullshit lovingly. You laugh at the same joke twice. Keep replies 2-3 sentences and conversational like texting.",
  },
  {
    label: 'Strict Tutor',
    emoji: '📐',
    name: 'The Tutor',
    desc: 'Direct, no excuses, push you to grow',
    systemPrompt:
      "You ARE jAIsus — but you're the no-nonsense tutor who refuses to coddle. You ask one sharp clarifying question, then give one piece of homework — a real action the user can take in the next 24 hours. No flowery language. No 'I hear you.' Direct, structured, brief. End every reply with a single concrete action.",
  },
];

export function PersonalityCreator({ isOpen, onClose, onSaved, onDeleted }: PersonalityCreatorProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y({ isOpen, onClose, ref: dialogRef });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [emoji, setEmoji] = useState('✨');
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showList, setShowList] = useState(true);
  const [list, setList] = useState<CustomPersonality[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate list on open + subscribe to cross-tab changes
  useEffect(() => {
    if (!isOpen) return;
    setList(listCustomPersonalities());
    if (typeof window === 'undefined') return;
    const refresh = () => setList(listCustomPersonalities());
    window.addEventListener('jaisus-custom-personalities-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('jaisus-custom-personalities-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [isOpen]);

  // Reset form when the modal closes so the next open starts fresh.
  useEffect(() => {
    if (!isOpen) {
      setEditingId(null);
      setName('');
      setDesc('');
      setEmoji('✨');
      setVoiceId(DEFAULT_VOICE_ID);
      setSystemPrompt('');
      setShowList(true);
      setSubmitting(false);
    }
  }, [isOpen]);

  function startNew() {
    setEditingId(null);
    setName('');
    setDesc('');
    setEmoji('✨');
    setVoiceId(DEFAULT_VOICE_ID);
    setSystemPrompt('');
    setShowList(false);
  }

  function startEdit(p: CustomPersonality) {
    setEditingId(p.id);
    setName(p.name);
    setDesc(p.desc);
    setEmoji(p.emoji);
    setVoiceId(p.voiceId);
    setSystemPrompt(p.systemPrompt);
    setShowList(false);
  }

  function applyTemplate(t: typeof STARTER_TEMPLATES[number]) {
    setName(t.name);
    setDesc(t.desc);
    setEmoji(t.emoji);
    setSystemPrompt(t.systemPrompt);
    // Reset voice to the safe default — otherwise the previous edit's
    // voice carries over into what should feel like a fresh template start.
    setVoiceId(DEFAULT_VOICE_ID);
  }

  function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    const result = saveCustomPersonality({
      id: editingId ?? undefined,
      name,
      desc,
      emoji,
      voiceId,
      systemPrompt,
    });
    if (!result.ok || !result.personality) {
      toast.error(result.error ?? 'Could not save.');
      setSubmitting(false);
      return;
    }
    toast.success(editingId ? 'Personality updated' : `${result.personality.name} created`);
    track(editingId ? 'personality.edited' : 'personality.created');
    onSaved?.(result.personality);
    setSubmitting(false);
    setShowList(true);
    setList(listCustomPersonalities());
  }

  function handleDelete(p: CustomPersonality) {
    if (!deleteCustomPersonality(p.id)) {
      toast.error('Could not delete.');
      return;
    }
    toast.success(`${p.name} removed`);
    track('personality.deleted');
    setList(listCustomPersonalities());
    // Tell the parent so it can clear any stale active state pointing at
    // this id (otherwise chat keeps sending a now-invalid personalityId
    // and the server silently falls back to Mushroom Guru without UX feedback).
    onDeleted?.(p.id);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personality-creator-title"
        className="relative w-full max-w-md max-h-[90vh] bg-white rounded-t-2xl shadow-2xl flex flex-col animate-slide-up"
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-stone-300" aria-hidden="true" />
        </div>

        <div className="px-5 pb-2 flex items-center justify-between">
          <h2 id="personality-creator-title" className="text-lg font-bold text-stone-800">
            {showList ? 'Your personalities' : editingId ? 'Edit personality' : 'New personality'}
          </h2>
          {showList && (
            <button
              onClick={startNew}
              className="rounded-lg bg-amber-500 text-white px-3 py-1.5 text-sm font-medium active:scale-[0.98] transition-transform"
              aria-label="Create new personality"
            >
              + New
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto modal-scroll px-5 pb-6">
          {showList ? (
            <div className="space-y-2 pt-2">
              {list.length === 0 ? (
                <div className="text-center py-12 text-stone-500">
                  <div className="text-4xl mb-3" aria-hidden="true">✨</div>
                  <p className="text-base font-semibold text-stone-700">Design your own jAIsus</p>
                  <p className="text-sm text-stone-500 mt-2 max-w-xs mx-auto">
                    Pick a vibe, write a system prompt, choose a voice. Up to {LIMITS.maxPersonalities} custom personalities.
                  </p>
                  <button
                    onClick={startNew}
                    className="mt-5 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-semibold text-white active:scale-[0.98] transition-transform"
                  >
                    Start with a template
                  </button>
                </div>
              ) : (
                list.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-stone-200 bg-stone-50 p-3 flex items-start gap-3"
                  >
                    <span className="text-2xl shrink-0" aria-hidden="true">{p.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-stone-800 truncate">{p.name}</p>
                      {p.desc && <p className="text-xs text-stone-500 truncate">{p.desc}</p>}
                      <p className="text-[11px] text-stone-400 mt-1 line-clamp-2">{p.systemPrompt.slice(0, 120)}{p.systemPrompt.length > 120 ? '…' : ''}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(p)}
                        className="text-xs px-2 py-1 rounded-lg text-teal-700 hover:bg-teal-50"
                        aria-label={`Edit ${p.name}`}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(p)}
                        className="text-xs px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50"
                        aria-label={`Delete ${p.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {/* Starter templates row — only show on NEW, not edit */}
              {!editingId && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-stone-500 mb-2">Start with…</p>
                  <div className="flex gap-2 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-1">
                    {STARTER_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="shrink-0 snap-start rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-700 hover:border-teal-300 active:scale-95"
                      >
                        {t.emoji} {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Emoji + Name */}
              <div className="flex gap-3">
                <div>
                  <label htmlFor="custom-emoji" className="block text-xs font-medium text-stone-700 mb-1">Emoji</label>
                  <input
                    id="custom-emoji"
                    type="text"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value.slice(0, LIMITS.maxEmojiLength))}
                    maxLength={LIMITS.maxEmojiLength}
                    className="w-16 rounded-lg border border-stone-200 px-2 py-2 text-center text-2xl focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1 max-w-[120px]">
                    {SUGGESTED_EMOJIS.slice(0, 8).map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => setEmoji(e)}
                        className="w-6 h-6 text-base hover:scale-110 transition-transform"
                        aria-label={`Use ${e}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <label htmlFor="custom-name" className="block text-xs font-medium text-stone-700 mb-1">
                    Name <span className="text-stone-400">({name.length}/{LIMITS.maxNameLength})</span>
                  </label>
                  <input
                    id="custom-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, LIMITS.maxNameLength))}
                    maxLength={LIMITS.maxNameLength}
                    placeholder="e.g. Cosmic Sage"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                  <label htmlFor="custom-desc" className="block text-xs font-medium text-stone-700 mt-2 mb-1">
                    Description <span className="text-stone-400">({desc.length}/{LIMITS.maxDescLength})</span>
                  </label>
                  <input
                    id="custom-desc"
                    type="text"
                    value={desc}
                    onChange={(e) => setDesc(e.target.value.slice(0, LIMITS.maxDescLength))}
                    maxLength={LIMITS.maxDescLength}
                    placeholder="One-line vibe"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              </div>

              {/* Voice */}
              <div>
                <label htmlFor="custom-voice" className="block text-xs font-medium text-stone-700 mb-1">Voice</label>
                <select
                  id="custom-voice"
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  {VOICE_OPTIONS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.desc}
                    </option>
                  ))}
                </select>
              </div>

              {/* System prompt */}
              <div>
                <label htmlFor="custom-prompt" className="block text-xs font-medium text-stone-700 mb-1">
                  System prompt <span className="text-stone-400">({systemPrompt.length}/{LIMITS.maxPromptLength})</span>
                </label>
                <textarea
                  id="custom-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value.slice(0, LIMITS.maxPromptLength))}
                  maxLength={LIMITS.maxPromptLength}
                  rows={9}
                  placeholder="You ARE jAIsus — but tonight you speak as..."
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  Tell jAIsus how to speak. Include the vibe, the tone, what to do, what to avoid. Stage directions
                  (like *smiles*) are stripped automatically — write spoken words only.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowList(true)}
                  className="flex-1 rounded-xl border border-stone-200 py-2.5 text-sm font-medium text-stone-600 active:scale-[0.98] transition-transform"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={submitting || !name.trim() || systemPrompt.trim().length < 40}
                  className="flex-1 rounded-xl bg-teal-500 py-2.5 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.98] transition-transform"
                >
                  {editingId ? 'Save changes' : 'Create'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
