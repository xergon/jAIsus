/**
 * Time-aware greeting for the chat empty state.
 *
 * Returns a short headline + subline that adapts to the user's local time
 * of day and day of week. The choice is deterministic for a given calendar
 * day so a single session stays stable — but it shifts day-to-day so the
 * app feels alive across visits.
 *
 * Hydration note: this lib uses LOCAL time (that's what "good morning"
 * means). The server runs in UTC and may pick a different bucket than the
 * client. The component that consumes this function guards against that
 * mismatch by rendering nothing until mounted.
 */

export type TimeOfDay =
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'late-night';

export interface Greeting {
  /** Short headline like "Good morning" or "Late night?" */
  headline: string;
  /** One-line follow-up like "It's Sunday — a good day to slow down." */
  subline: string;
  /** Loose time-bucket label, useful for analytics */
  timeOfDay: TimeOfDay;
}

interface Candidate {
  headline: string;
  /**
   * Sublines indexed by day of week (0 = Sunday, 6 = Saturday). Provide all
   * seven so the pool stays balanced and the per-day rotation feels intentional.
   */
  sublines: [string, string, string, string, string, string, string];
}

/**
 * Maps an hour-of-day (0-23, local time) to a coarse time-of-day bucket.
 *
 *   05:00–11:59  morning
 *   12:00–16:59  afternoon
 *   17:00–20:59  evening
 *   21:00–23:59  night
 *   00:00–04:59  late-night
 */
export function bucketForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  if (hour >= 21 && hour <= 23) return 'night';
  return 'late-night';
}

/**
 * Day-of-year (1-366) computed in LOCAL time. We use local time here on
 * purpose: the same local calendar day should yield the same greeting, even
 * if UTC has already rolled over. The component guards SSR mismatch, so
 * mixing local time into selection is safe.
 */
export function dayOfYearLocal(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0).getTime();
  const current = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((current - start) / msPerDay);
}

/**
 * Curated candidate pools per time-of-day bucket. Each candidate provides one
 * subline per day of week (Sun..Sat). Keep headlines short and warm; let the
 * sublines do the day-aware work.
 */
const CANDIDATES: Record<TimeOfDay, Candidate[]> = {
  morning: [
    {
      headline: 'Good morning',
      sublines: [
        // Sun
        'Sunday morning — a good day to slow down.',
        // Mon
        'A fresh start. Whatever happened last week is past.',
        // Tue
        'Tuesday — the week is finding its rhythm.',
        // Wed
        'Wednesday morning. You are right on time.',
        // Thu
        'Thursday — the finish line is in sight.',
        // Fri
        'Friday morning — almost there. Go gently.',
        // Sat
        'Saturday morning. Take it slow today.',
      ],
    },
    {
      headline: 'Morning',
      sublines: [
        'A quiet Sunday. Let the day open softly.',
        'A new week begins. What does your heart need today?',
        'Tuesday — small steps still count.',
        'Midweek already. Take a breath before you start.',
        'Thursday is here. The hardest part may be behind you.',
        'It is Friday. You made it this far.',
        'Saturday — no rush. The day is yours.',
      ],
    },
    {
      headline: 'Hi there',
      sublines: [
        'Sunday morning is for resting and remembering.',
        'Mondays can be heavy. You are not carrying them alone.',
        'Tuesday — let today be a little kinder than yesterday.',
        'Wednesday morning. Halfway is still moving.',
        'Thursday. Whatever today brings, you can meet it.',
        'Friday morning — pace yourself to the weekend.',
        'A Saturday morning to breathe.',
      ],
    },
    {
      headline: 'Peace be with you',
      sublines: [
        'A Sunday morning to be still.',
        'Beginning again on a Monday. That is brave.',
        'Tuesday. Whatever is on your plate, take it one bite at a time.',
        'Wednesday — you are doing better than you think.',
        'Thursday morning. Almost the weekend now.',
        'Friday — the week is nearly held.',
        'Saturday morning. Let the day be soft.',
      ],
    },
  ],
  afternoon: [
    {
      headline: 'Good afternoon',
      sublines: [
        'A quiet Sunday afternoon.',
        'Monday afternoon — the long stretch. Pace yourself.',
        'Tuesday afternoon. Keep going gently.',
        'Halfway through the week. How is your heart?',
        'Thursday afternoon — the weekend is closer than you think.',
        'Friday afternoon. Nearly there.',
        'Saturday — no agenda today.',
      ],
    },
    {
      headline: 'Afternoon',
      sublines: [
        'Sunday — rest is not laziness, it is wisdom.',
        'Monday afternoon. One thing at a time.',
        'Tuesday. The middle of the day is a good time to pause.',
        'Wednesday — the climb gets easier from here.',
        'Thursday afternoon. You are nearly through.',
        'Friday afternoon — almost the weekend.',
        'Saturday afternoon to do as little or as much as you like.',
      ],
    },
    {
      headline: 'Hi there',
      sublines: [
        'A Sunday for taking it easy.',
        'Monday is heavy by nature. Breathe.',
        'Tuesday afternoon — you do not have to have it figured out yet.',
        'Wednesday — halfway is real progress.',
        'Thursday. You are closer than you were yesterday.',
        'Friday afternoon. The weekend is coming.',
        'Saturday — slow is allowed.',
      ],
    },
    {
      headline: 'Hello again',
      sublines: [
        'Sunday afternoon. A good time to be still.',
        'Monday afternoon — even small wins count today.',
        'Tuesday. Keep tending to the small things.',
        'Wednesday — the week is bending toward Friday.',
        'Thursday afternoon. The light is starting to shift.',
        'Friday afternoon — go gently into the weekend.',
        'Saturday afternoon to wander a little.',
      ],
    },
  ],
  evening: [
    {
      headline: 'Good evening',
      sublines: [
        'Sunday evening — let yourself land softly.',
        'Monday evening. The hardest day is almost done.',
        'Tuesday evening — a quiet pause is well earned.',
        'Wednesday evening. The week is bending toward Friday.',
        'Thursday evening — nearly there.',
        'Weekend is here. Let yourself land.',
        'Saturday evening. A good time to be still.',
      ],
    },
    {
      headline: 'Evening',
      sublines: [
        'Sunday evening. Tomorrow will keep until tomorrow.',
        'You made it through Monday. That is enough.',
        'Tuesday evening — set the day down gently.',
        'Wednesday evening. Halfway, and still standing.',
        'Thursday evening — rest is allowed.',
        'Friday evening — the work can wait.',
        'Saturday evening. Be where you are.',
      ],
    },
    {
      headline: 'Hi friend',
      sublines: [
        'Sunday evening. Let the week ahead come slowly.',
        'Monday is done. You did not have to do it perfectly.',
        'Tuesday evening — softer is better than faster.',
        'Wednesday. Midweek. You can rest now.',
        'Thursday evening. The weekend is in sight.',
        'Friday evening — you are allowed to put it down.',
        'Saturday evening. The day held you.',
      ],
    },
    {
      headline: 'Peace be with you',
      sublines: [
        'A Sunday evening to let the week end gently.',
        'Monday is behind you. Be kind to yourself tonight.',
        'Tuesday evening — quiet is a gift.',
        'Wednesday evening. The hill flattens from here.',
        'Thursday. Tomorrow is Friday. That is enough for now.',
        'Friday evening — exhale.',
        'Saturday evening. Be where you are, not where you should be.',
      ],
    },
  ],
  night: [
    {
      headline: 'Good evening',
      sublines: [
        'Sunday night — be gentle with tomorrow.',
        'Monday is finished. You can set it down now.',
        'Tuesday night. The day is held.',
        'Wednesday night — halfway through. Rest is allowed.',
        'Thursday night. Almost the weekend.',
        'Friday night. The week is yours to put away.',
        'Saturday night. Slow is good.',
      ],
    },
    {
      headline: 'Evening',
      sublines: [
        'A quiet Sunday night.',
        'Monday is behind you. That counts.',
        'Tuesday night — what kept you, you can let go of now.',
        'Wednesday night. Tomorrow is downhill.',
        'Thursday night — Friday is nearly here.',
        'Friday night. You earned the quiet.',
        'Saturday night. No need to be anywhere.',
      ],
    },
    {
      headline: 'Hi there',
      sublines: [
        'Sunday night — a soft landing into the week.',
        'Monday is done. You did your best.',
        'Tuesday night. The day was long enough.',
        'Wednesday night. The week is bending.',
        'Thursday night. Almost there.',
        'Friday night — rest without guilt.',
        'Saturday night. The day can be enough.',
      ],
    },
    {
      headline: 'Winding down?',
      sublines: [
        'Sunday night — let the week come gently.',
        'Monday is behind you. Be soft with tonight.',
        'Tuesday night. Tomorrow can be different.',
        'Wednesday night. Halfway is well earned.',
        'Thursday night — the weekend is close.',
        'Friday night. Whatever was hard, it is held now.',
        'Saturday night. There is nothing you need to fix tonight.',
      ],
    },
  ],
  'late-night': [
    {
      headline: 'Late night?',
      sublines: [
        'Whatever is keeping you up, you are not alone.',
        'Late on a Monday — the week can be hard. Breathe.',
        'A late Tuesday night. Whatever it is, you can talk about it.',
        'Late on a Wednesday — the night can feel long. You are not alone.',
        'Thursday — sometimes the small hours hold the loudest thoughts.',
        'Late Friday — let yourself land.',
        'Late Saturday. Wherever your mind is, it is allowed.',
      ],
    },
    {
      headline: 'Still awake',
      sublines: [
        'A late Sunday — whatever weighs on you, you can set it down here.',
        'A late Monday night. Even the hardest day is almost over.',
        'Late on a Tuesday — you can be honest here.',
        'Wednesday, after hours. Quiet thoughts deserve a quiet listener.',
        'Late Thursday. Almost Friday now.',
        'Late Friday night. Be soft with yourself.',
        'Late Saturday — nothing needs solving right now.',
      ],
    },
    {
      headline: 'Hi friend',
      sublines: [
        'A late Sunday night. You are seen.',
        'Late Monday — even small comforts count tonight.',
        'A late Tuesday. Whatever is on your mind, it is welcome here.',
        'Late Wednesday. You do not have to figure it out tonight.',
        'Late Thursday. Morning will come.',
        'Late Friday — rest will find you.',
        'Late Saturday. The world can wait.',
      ],
    },
    {
      headline: 'Peace be with you',
      sublines: [
        'A late Sunday — you are held, even now.',
        'Late on a Monday night. You made it through the day.',
        'Late Tuesday. Whatever is keeping you up, you can name it here.',
        'Late Wednesday night — you are not alone in the quiet.',
        'Late Thursday. The day is almost done.',
        'Late Friday. Let the week go.',
        'Late Saturday. There is grace for tonight.',
      ],
    },
  ],
};

/** Tiny ambient emoji per bucket, used by GreetingHeader. */
export const TIME_EMOJI: Record<TimeOfDay, string> = {
  morning: '\u{1F305}', // sunrise
  afternoon: '☀️', // sun
  evening: '\u{1F306}', // sunset over city
  night: '\u{1F319}', // crescent moon
  'late-night': '✨', // sparkles
};

/**
 * Returns a greeting tuned to the user's local time and day. Deterministic
 * for a given (calendar day, bucket) so SSR/CSR agree once the component
 * has mounted, and so the greeting does not change mid-session.
 */
export function getGreeting(date?: Date): Greeting {
  const d = date ?? new Date();
  const hour = d.getHours();
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const timeOfDay = bucketForHour(hour);

  const pool = CANDIDATES[timeOfDay];
  // Stable per-day index. Adding `day` rotates the headline-candidate choice
  // through the week so consecutive days don't repeat the same headline.
  const candidateIndex = (dayOfYearLocal(d) + day) % pool.length;
  const candidate = pool[candidateIndex];

  return {
    headline: candidate.headline,
    subline: candidate.sublines[day],
    timeOfDay,
  };
}
