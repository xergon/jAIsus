/**
 * Auto-vision pings: the hidden "user" messages ChatInterface sends while the
 * camera is on. Shared so the chat route, search and export recognise them by
 * exact text — a shape test like "starts with '(' and ends with ')'" also
 * matched real messages the user typed in parentheses.
 */
export const FIRST_VISION_PROMPT = '(You just opened your eyes and can see the user for the first time. React with excitement and warmth to what you see!)';

export const VISION_PROMPTS = [
  '(observe what you see and comment naturally)',
  '(look around and share what catches your eye)',
  '(react to what you see right now)',
  '(notice something about the scene and mention it)',
  '(comment on what is happening around you)',
];

const VISION_PING_TEXTS = new Set([FIRST_VISION_PROMPT, ...VISION_PROMPTS]);

export function isVisionPingText(text: string): boolean {
  return VISION_PING_TEXTS.has(text.trim());
}
