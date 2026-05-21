/**
 * Daily Kindness — deterministic act-of-kindness-of-the-day selection.
 *
 * Companion to daily-verse: gives the user a concrete, doable action rather
 * than a reflection. Same UTC-day-of-year mechanism so server and client
 * render identical content (no hydration mismatch).
 *
 * Selection rotates daily via `(dayOfYear + OFFSET) % ALL_KINDNESS_ACTS.length`.
 * The prime offset (7) ensures the kindness and verse cycles don't lock in
 * step — a given verse won't always pair with the same kindness.
 */

import { dayOfYear } from './daily-verse';

export interface KindnessAct {
  id: string;
  /** Short imperative — the actual act */
  text: string;
  /** Loose category */
  category:
    | 'connection'
    | 'service'
    | 'presence'
    | 'words'
    | 'self-care'
    | 'stranger';
}

/**
 * Pool of specific, doable acts. Each one is concrete enough to be done
 * in under five minutes (with a few small-letter exceptions). Avoid
 * generic platitudes — favor actions someone can start right now.
 */
export const ALL_KINDNESS_ACTS: KindnessAct[] = [
  // connection — reaching out to people you already know
  {
    id: 'voice-note-thinking-of',
    text: 'Send one voice note to someone you’ve been thinking about.',
    category: 'connection',
  },
  {
    id: 'call-family-two-min',
    text: 'Call a parent or sibling, even for two minutes.',
    category: 'connection',
  },
  {
    id: 'text-old-friend',
    text: 'Send one text you’ve been putting off to an old friend.',
    category: 'connection',
  },
  {
    id: 'reply-unanswered-message',
    text: 'Reply to that one message that’s been sitting unanswered for weeks.',
    category: 'connection',
  },
  {
    id: 'check-in-grieving',
    text: 'Check in on someone who lost someone — they’re still grieving past the funeral.',
    category: 'connection',
  },
  {
    id: 'photo-memory-share',
    text: 'Find an old photo of you with someone and send it to them with no caption.',
    category: 'connection',
  },
  {
    id: 'invite-no-agenda',
    text: 'Invite someone to coffee or a walk with no agenda, just to catch up.',
    category: 'connection',
  },

  // service — doing something tangible for someone
  {
    id: 'donate-five-minutes',
    text: 'Donate five minutes — or five dollars — to a cause you actually believe in.',
    category: 'service',
  },
  {
    id: 'pick-up-trash',
    text: 'Pick up one piece of trash on the street that isn’t yours.',
    category: 'service',
  },
  {
    id: 'return-cart',
    text: 'Return a stray shopping cart that someone left in the parking lot.',
    category: 'service',
  },
  {
    id: 'hold-door',
    text: 'Hold the door for someone behind you, even if they’re ten steps back.',
    category: 'service',
  },
  {
    id: 'offer-ride',
    text: 'Offer someone a ride or run a small errand for a busy friend.',
    category: 'service',
  },
  {
    id: 'clean-shared-space',
    text: 'Clean up a shared space — kitchen, sidewalk, break room — without being asked.',
    category: 'service',
  },
  {
    id: 'donate-clothes',
    text: 'Set aside three things from your closet you don’t wear and donate them this week.',
    category: 'service',
  },
  {
    id: 'leave-tip-cash',
    text: 'Leave a cash tip somewhere it isn’t expected — barista, delivery driver, hotel housekeeper.',
    category: 'service',
  },

  // presence — being fully where you are with someone (or yourself)
  {
    id: 'phone-down-meal',
    text: 'Put your phone in another room during one meal today.',
    category: 'presence',
  },
  {
    id: 'listen-without-fixing',
    text: 'Let someone talk for ten minutes without trying to fix what they’re saying.',
    category: 'presence',
  },
  {
    id: 'eye-contact-cashier',
    text: 'Make eye contact and actually thank the next cashier or server who helps you.',
    category: 'presence',
  },
  {
    id: 'ask-how-really',
    text: 'Ask someone "how are you, really?" and wait for the second answer.',
    category: 'presence',
  },
  {
    id: 'no-multitask-conversation',
    text: 'Have one conversation today where you’re not also doing something else.',
    category: 'presence',
  },
  {
    id: 'notice-three-things',
    text: 'On your next walk, name three things you’ve never noticed on that route before.',
    category: 'presence',
  },

  // words — what you say or write
  {
    id: 'specific-coworker-appreciation',
    text: 'Tell a coworker something specific you appreciate about how they work.',
    category: 'words',
  },
  {
    id: 'thank-you-text',
    text: 'Send a thank-you text to someone who helped you this month, even if you already thanked them.',
    category: 'words',
  },
  {
    id: 'real-review-small-business',
    text: 'Leave an honest review for a small business you actually love.',
    category: 'words',
  },
  {
    id: 'compliment-creator',
    text: 'Comment something kind on the work of an artist, writer, or creator you follow.',
    category: 'words',
  },
  {
    id: 'handwritten-note',
    text: 'Write a one-page letter — by hand — to someone who shaped you.',
    category: 'words',
  },
  {
    id: 'tell-them-now',
    text: 'Tell someone today the thing about them you usually only think.',
    category: 'words',
  },
  {
    id: 'praise-publicly',
    text: 'Praise someone publicly — in a thread, a meeting, in front of their boss.',
    category: 'words',
  },

  // self-care — kindness turned inward, since it has to start somewhere
  {
    id: 'forgive-yourself',
    text: 'Forgive yourself for that thing you keep replaying. Out loud, if you can.',
    category: 'self-care',
  },
  {
    id: 'three-not-anxious',
    text: 'Write down three things you’re not anxious about today.',
    category: 'self-care',
  },
  {
    id: 'five-minutes-silence',
    text: 'Sit in silence for five minutes before opening your phone.',
    category: 'self-care',
  },
  {
    id: 'drink-glass-water',
    text: 'Drink a full glass of water before your next coffee or scroll.',
    category: 'self-care',
  },
  {
    id: 'no-self-criticism-hour',
    text: 'Go one hour today without criticizing yourself in your own head.',
    category: 'self-care',
  },
  {
    id: 'one-thing-proud',
    text: 'Name one thing you did this week you’re actually proud of.',
    category: 'self-care',
  },
  {
    id: 'rest-without-earning',
    text: 'Rest for ten minutes without earning it first.',
    category: 'self-care',
  },
  {
    id: 'unfollow-one-account',
    text: 'Unfollow one account that consistently makes you feel worse.',
    category: 'self-care',
  },

  // stranger — small mercies to people you’ll never see again
  {
    id: 'coffee-for-next-stranger',
    text: 'Buy coffee for the next stranger in line, no expectation.',
    category: 'stranger',
  },
  {
    id: 'let-them-merge',
    text: 'Let someone merge in traffic without sighing about it.',
    category: 'stranger',
  },
  {
    id: 'let-them-go-first',
    text: 'Let the person behind you with fewer items go first at the checkout.',
    category: 'stranger',
  },
  {
    id: 'smile-three-strangers',
    text: 'Smile at three strangers today and mean it.',
    category: 'stranger',
  },
  {
    id: 'pay-toll-behind',
    text: 'Pay for the order behind you at the drive-thru and drive off.',
    category: 'stranger',
  },
  {
    id: 'extra-umbrella',
    text: 'If it’s raining, offer to share your umbrella with someone caught in it.',
    category: 'stranger',
  },
  {
    id: 'give-up-seat',
    text: 'Give up your seat for someone who looks like they need it more.',
    category: 'stranger',
  },
  {
    id: 'tip-extra-twenty',
    text: 'Tip an extra twenty percent on your next bill without making a thing of it.',
    category: 'stranger',
  },
  {
    id: 'help-with-bag',
    text: 'Offer to help someone struggling with a bag, a stroller, or a door.',
    category: 'stranger',
  },
];

/** Prime offset so kindness cycle isn’t in lockstep with the verse cycle. */
const KINDNESS_OFFSET = 7;

/**
 * Deterministically selects the kindness act for the given day
 * (defaults to today). Same UTC calendar day always returns the same
 * act on server and client.
 *
 * Falls back to a safe default if the acts array is empty.
 */
export function getDailyKindness(date?: Date): KindnessAct {
  if (ALL_KINDNESS_ACTS.length === 0) {
    return {
      id: 'fallback',
      text: '',
      category: 'presence',
    };
  }
  const d = date ?? new Date();
  const index =
    (dayOfYear(d) + KINDNESS_OFFSET) % ALL_KINDNESS_ACTS.length;
  return ALL_KINDNESS_ACTS[index];
}
