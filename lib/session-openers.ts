/**
 * Session opener suggestions — the "obvious what to do next" for both sides
 * of a fresh conversation.
 *
 * The measurement that motivated this: 10 accepted invites → 10 joins →
 * 2 chat messages in 7 days. The mechanics of joining work; the
 * conversation dies at silence. Both the joiner AND the inviter stare at
 * an empty chat with no prompt.
 *
 * Rules this module is designed around:
 *
 *   1. Chips are *offered*, never auto-sent. The user still confirms with
 *      the send button — a message never leaves the browser without a
 *      deliberate tap. This preserves the CLAUDE.md rule that chat
 *      content is user-authored: `sanitizeData` blocks anything that
 *      would leak session ids / URLs / secrets, and pre-writing a message
 *      never bypasses that pipeline.
 *
 *   2. The affordance appears only when it can be useful: `liveJoined`
 *      is true (the user is actually in the session) AND the thread has
 *      no real messages yet. Once a real message exists, the coach steps
 *      out of the way.
 *
 *   3. Copy uses "conversation" per the CLAUDE.md contract — the invite
 *      creates a shared chat, NOT a shared match / synchronised game.
 *      Copy that promised anything more would be misleading.
 */

/** The three suggested openers. Kept short so a mobile thumb hits them. */
export const SESSION_OPENERS = ['Hi 👋', 'You in?', 'Same game?'] as const;

/** Coach line shown above the input when openers are visible. */
export const SESSION_OPENER_COACH = 'Say hi to start the conversation';

export type SessionOpener = (typeof SESSION_OPENERS)[number];

/**
 * Predicate: should the opener chips be shown to the current user?
 *
 * `threadLength` counts REAL messages (not system rows). Zero means the
 * conversation hasn't started yet from anyone. Once anyone (either side)
 * sends a real message, the chips retire.
 */
export function shouldShowSessionOpeners(input: {
  liveJoined: boolean;
  threadLength: number;
}): boolean {
  return input.liveJoined && input.threadLength === 0;
}
