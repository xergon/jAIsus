'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { UIMessage } from 'ai';
import { isVisionPingText } from '@/lib/vision-prompts';
import { CHAT_HISTORY_KEY } from '@/hooks/useChatHistory';
import {
  getSessionMemory,
  removeMemory,
  upsertSessionMemory,
  wereMemoriesRemovedSince,
} from '@/lib/conversation-memory';
import {
  applyExtraction,
  canStoreMemory,
  getMemoryProgress,
  getProfile,
  markMessagesProcessed,
  profileForRequest,
  readExtraction,
  startMemorySession,
  subscribeProfile,
  wasForgottenSince,
  type ExtractionResult,
} from '@/lib/user-profile';

/** New user messages after which a finished reply sends the conversation. */
const REPLY_TRIGGER_USER_MESSAGES = 2;
/** The server reads at most 12000 chars too. A longer backlog is sent oldest
 *  first, in parts; the rest goes next. */
const MAX_PAYLOAD_CHARS = 12000;
const MAX_USER_CHARS = 4000;
/** Replies are context for the user's words; their tail adds little. */
const MAX_ASSISTANT_CHARS = 1500;
const REQUEST_TIMEOUT_MS = 25000;
/** Browsers refuse keepalive bodies over 64 KB (all in flight together). */
const KEEPALIVE_MAX_BYTES = 60000;
/** After load, before taking in what the last visit didn't get to. */
const LOAD_DELAY_MS = 5000;

interface RememberMessage {
  role: 'user' | 'assistant';
  text: string;
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function isBusy(status: string): boolean {
  return status === 'submitted' || status === 'streaming';
}

/**
 * What the server reads: the user's own words and jAIsus' replies, without
 * camera pings and the replies to them (not the user's words), emotion tags,
 * or empty turns. Oldest first within MAX_PAYLOAD_CHARS: `cut` is the index
 * in `batch` where it stopped (batch.length when all of it fits), and the
 * rest is sent next. It only stops at a message that is sent, so a ping and
 * its skipped reply stay together. `startsAfterPing`: the message before the
 * batch was a ping, so a reply opening the batch answers it.
 */
function toPayload(batch: UIMessage[], startsAfterPing = false): { payload: RememberMessage[]; cut: number } {
  const payload: RememberMessage[] = [];
  let afterPing = startsAfterPing;
  let total = 0;
  let lastSent = -1;
  for (let i = 0; i < batch.length; i++) {
    const m = batch[i];
    const raw = textOf(m);
    let text = '';
    if (m.role === 'user') {
      afterPing = isVisionPingText(raw);
      if (!afterPing) text = raw.trim().slice(0, MAX_USER_CHARS);
    } else if (m.role === 'assistant') {
      if (afterPing) {
        afterPing = false;
        continue;
      }
      text = raw.replace(/\[EMOTION:[^\]\[\n]{0,40}\]\s*/gi, '').trim().slice(0, MAX_ASSISTANT_CHARS);
    }
    if (!text) continue;
    // Always at least one, so a backlog can't get stuck.
    if (payload.length > 0 && total + text.length > MAX_PAYLOAD_CHARS) {
      // A reply goes with the message it answers (else it would be left
      // over on its own, with no user words to send it with).
      if (m.role === 'assistant' && payload.length > 1 && payload[payload.length - 1].role === 'user') {
        payload.pop();
        return { payload, cut: lastSent };
      }
      return { payload, cut: i };
    }
    total += text.length;
    payload.push({ role: m.role === 'user' ? 'user' : 'assistant', text });
    lastSent = i;
  }
  return { payload, cut: batch.length };
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 3;
  }
}

/** POST /api/remember. Null on any failure: the messages are tried again later. */
async function requestExtraction(body: string, keepalive: boolean): Promise<ExtractionResult | null> {
  // Without AbortSignal.timeout (Safari < 16) a hung request would hold up
  // every later one (one at a time, see useLongTermMemory).
  const controller = typeof AbortSignal.timeout === 'function' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const res = await fetch('/api/remember', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // keepalive lets the request finish while the page closes.
      keepalive: keepalive && byteLength(body) < KEEPALIVE_MAX_BYTES,
      signal: controller ? controller.signal : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return readExtraction(await res.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One trip to /api/remember. */
interface Run {
  /** A chat about to be cleared (rememberNow); null = the chat on screen
   *  when the run starts. */
  list: UIMessage[] | null;
  minUserMessages: number;
  keepalive: boolean;
}

/**
 * Queues a run behind the request in flight. Runs for cleared chats keep
 * their order and go first; runs for the chat on screen merge into one, kept
 * last, as it reads the newest messages when it starts.
 */
function enqueue(queue: Run[], run: Run): void {
  const live = queue.length > 0 && queue[queue.length - 1].list === null ? queue.pop() ?? null : null;
  if (run.list !== null) {
    queue.push(run);
    if (live) queue.push(live);
  } else if (live) {
    queue.push({
      list: null,
      minUserMessages: Math.min(live.minUserMessages, run.minUserMessages),
      keepalive: live.keepalive || run.keepalive,
    });
  } else {
    queue.push(run);
  }
}

interface UseLongTermMemoryOptions {
  messages: UIMessage[];
  /** useChat status. */
  status: string;
  /** Shown on the conversation's summary in the Memories panel. */
  personalityId: string;
}

/**
 * Learns about the user in the background (user-profile.ts holds what was
 * learned; buildMemoryContext sends it with every chat request).
 *
 * The part of the chat not taken in yet goes to /api/remember:
 *   - when a reply finishes and the user has said 2+ new things,
 *   - when the page is hidden or closed (1+), with keepalive — if the page
 *     is gone before the answer, it's lost and the next visit redoes it,
 *   - a moment after load (1+), for whatever the last visit didn't get to,
 *   - on rememberNow (Clear history), so nothing said is lost.
 *
 * Dedup: progress lives in storage (user-profile.ts): the ids of messages
 * already taken in (and in this tab's memory, should storage be full).
 * Everything after the newest such message in the chat is new, so nothing is
 * sent twice and a reload continues where it left off. One request at a time
 * per tab: a trigger while one is on its way runs after it, against what it
 * stored (a failed batch is then sent again, and the summary builds on the
 * newest one). A chat with none of its messages taken in is a new
 * conversation and gets its own summary (one per conversation, upserted as
 * it goes on).
 *
 * "Forget everything" (here or in another tab) marks everything said before
 * it as taken in, and drops answers that were on their way: only what is
 * said afterwards is learned.
 */
export function useLongTermMemory({ messages, status, personalityId }: UseLongTermMemoryOptions) {
  const messagesRef = useRef(messages);
  const statusRef = useRef(status);
  const personalityRef = useRef(personalityId);
  useEffect(() => {
    messagesRef.current = messages;
    statusRef.current = status;
    personalityRef.current = personalityId;
  }, [messages, status, personalityId]);

  // Messages sent and not answered yet (this tab only).
  const pendingIdsRef = useRef<Set<string>>(new Set());
  // Messages this tab has taken in, also when storage couldn't record them
  // (full): otherwise every trigger would send them again.
  const processedRef = useRef<Set<string>>(new Set());
  // One request at a time; triggers meanwhile wait here (see enqueue).
  const inFlightRef = useRef(false);
  const queueRef = useRef<Run[]>([]);
  const rememberRef = useRef<(run: Run) => void>(() => {});
  // The forgetGeneration this tab has acted on (set on mount).
  const seenForgetRef = useRef<number | null>(null);

  const markProcessed = useCallback((ids: string[]) => {
    for (const id of ids) processedRef.current.add(id);
    markMessagesProcessed(ids);
  }, []);

  /**
   * After a "Forget everything" this tab hasn't acted on yet: everything said
   * before it counts as taken in (the chat on screen, messages on their way,
   * chats queued before Clear history, `ids`), so it isn't learned again.
   * True when there was one.
   */
  const catchUpForget = useCallback((ids: string[] = []): boolean => {
    const generation = getMemoryProgress().forgetGeneration;
    const seen = seenForgetRef.current;
    seenForgetRef.current = generation;
    if (seen === null || seen === generation) return false;
    const before: string[] = [];
    for (const run of queueRef.current) {
      if (run.list) before.push(...run.list.map(m => m.id));
    }
    // The chat on screen last: storage keeps only the newest ids.
    before.push(...ids, ...pendingIdsRef.current, ...messagesRef.current.map(m => m.id));
    markProcessed([...new Set(before)]);
    return true;
  }, [markProcessed]);

  // forgetEverything notifies synchronously in this tab, and through the
  // profile's storage event in others; remember() checks again in case an
  // event never came (another tab with no profile stored).
  useEffect(() => {
    seenForgetRef.current = getMemoryProgress().forgetGeneration;
    return subscribeProfile(() => {
      catchUpForget();
    });
  }, [catchUpForget]);

  const remember = useCallback((run: Run) => {
    // Nothing learned could be kept on this device: don't pay for it.
    if (!canStoreMemory()) return;
    if (inFlightRef.current) {
      enqueue(queueRef.current, run);
      return;
    }
    const list = run.list ?? messagesRef.current;
    if (catchUpForget(list.map(m => m.id))) return;

    // A reply still on its way isn't finished: it's taken in next time.
    let end = list.length;
    if (isBusy(statusRef.current) && list[end - 1]?.role === 'assistant') end--;

    const progress = getMemoryProgress();
    const done = new Set(progress.processedIds);
    for (const id of processedRef.current) done.add(id);
    for (const id of pendingIdsRef.current) done.add(id);
    let start = -1;
    for (let i = end - 1; i >= 0; i--) {
      if (done.has(list[i].id)) {
        start = i + 1;
        break;
      }
    }
    const continuing = start !== -1;
    const from = continuing ? start : 0;
    const batch = list.slice(from, end);
    // The batch may open with the reply to a camera ping taken in last time.
    const before = from > 0 ? list[from - 1] : undefined;
    const startsAfterPing = before?.role === 'user' && isVisionPingText(textOf(before));
    const { payload, cut } = toPayload(batch, startsAfterPing);
    // A backlog cut to size goes out whatever its share of user messages.
    if (cut === batch.length && payload.filter(m => m.role === 'user').length < run.minUserMessages) return;

    const sessionId = continuing && progress.sessionId ? progress.sessionId : startMemorySession();
    const previousSummary = getSessionMemory(sessionId)?.summary;
    // Only what was actually sent is marked; the rest of a cut batch goes next.
    const ids = batch.slice(0, cut).map(m => m.id);
    const generation = progress.forgetGeneration;
    const startedAt = Date.now();
    const personality = personalityRef.current;
    const sentProfile = profileForRequest();
    const body = JSON.stringify({
      messages: payload,
      profile: sentProfile,
      ...(previousSummary ? { previousSummary } : {}),
    });

    for (const id of ids) pendingIdsRef.current.add(id);
    inFlightRef.current = true;
    let more = false;
    void requestExtraction(body, run.keepalive)
      .then(result => {
        // "Forget everything" while this was on its way: all of it was said
        // before the forget, so it is never learned, nor sent again.
        const forgotten = wasForgottenSince(generation);
        if (!result && !forgotten) return;
        markProcessed(ids);
        if (!result || forgotten) return;
        // Closing the page sends one part; the next visit sends the rest.
        more = cut < batch.length && !run.keepalive;
        // A name removed or changed in the Memories panel meanwhile stands.
        const nameKept = getProfile().name === sentProfile.name;
        applyExtraction({
          ...result,
          name: nameKept ? result.name : null,
          forgetName: nameKept && result.forgetName,
        });
        const own = getSessionMemory(sessionId);
        const removedMeanwhile = wereMemoriesRemovedSince(startedAt);
        // Earlier conversations the user asked to forget. This one's own
        // summary is replaced below (the answer leaves that part out).
        for (const id of result.forgetConversations) {
          if (id !== own?.id) removeMemory(id);
        }
        // This conversation's summary deleted while the answer was on its
        // way: the answer restates it, so it stays deleted.
        if (result.summary && (own || (!previousSummary && !removedMeanwhile))) {
          upsertSessionMemory(sessionId, {
            summary: result.summary,
            personalityId: personality,
            messageCount: (own?.messageCount ?? 0) + payload.length,
          });
        }
      })
      .finally(() => {
        for (const id of ids) pendingIdsRef.current.delete(id);
        inFlightRef.current = false;
        // The rest of a cut batch first (same chat: its session and summary
        // hold), then whatever came up meanwhile. Stops at the first failure.
        if (more) queueRef.current.unshift({ list, minUserMessages: 1, keepalive: false });
        // A run with nothing to send returns at once: go on to the next.
        while (!inFlightRef.current && queueRef.current.length > 0) {
          const next = queueRef.current.shift();
          if (next) rememberRef.current(next);
        }
      });
  }, [catchUpForget, markProcessed]);
  useEffect(() => {
    rememberRef.current = remember;
  }, [remember]);

  // A reply just finished.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === 'streaming' && status === 'ready') {
      remember({ list: null, minUserMessages: REPLY_TRIGGER_USER_MESSAGES, keepalive: false });
    }
  }, [status, remember]);

  // Leaving: switching apps or tabs, or closing the page. Both events can
  // fire; the second waits for the first and finds its messages taken in.
  useEffect(() => {
    const flush = () => remember({ list: null, minUserMessages: 1, keepalive: true });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [remember]);

  // Back again with a saved chat: take in what the last visit didn't get to
  // (e.g. its last answer was lost when the page closed), and a chat from
  // before long-term memory existed. Mid-reply, the reply trigger does it.
  useEffect(() => {
    let hadHistory = false;
    try {
      hadHistory = localStorage.getItem(CHAT_HISTORY_KEY) !== null;
    } catch {
      // Storage unavailable: nothing saved to catch up on.
    }
    if (!hadHistory) return;
    const timer = setTimeout(() => {
      if (!isBusy(statusRef.current)) remember({ list: null, minUserMessages: 1, keepalive: false });
    }, LOAD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [remember]);

  /** Take in everything not yet taken in, e.g. before the chat is cleared. */
  const rememberNow = useCallback(
    (list: UIMessage[]) => remember({ list, minUserMessages: 1, keepalive: false }),
    [remember]
  );

  return { rememberNow };
}
