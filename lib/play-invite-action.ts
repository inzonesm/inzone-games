'use client';

/**
 * Shared conversation-invite action. Host UI, SocialPanel, and in-game SDK
 * calls all create a playSession here. A URL is returned only after the write.
 */

import {
  createPlaySession,
  ensurePlaySessionUser,
  liveInviteUrl,
  playSessionActor,
} from './play-session';
import { isPlaySessionId } from './play-session-core';
import { conversationInviteResult, type PlayInviteResult } from './play-invite';

export async function createConversationInvite(input: {
  gameId: string;
  origin: string;
  existingSessionId?: string | null;
}): Promise<{ sessionId: string; url: string; expiresAt: number; result: PlayInviteResult }> {
  const gameId = (input.gameId || '').trim();
  if (!gameId) throw new Error('denied');
  const existing = (input.existingSessionId || '').trim();
  const authed = await ensurePlaySessionUser();
  const actor = await playSessionActor(authed);
  let sessionId = existing;
  let expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  if (!sessionId || !isPlaySessionId(sessionId)) {
    const created = await createPlaySession(actor, gameId);
    sessionId = created.id;
    expiresAt = created.expiresAt;
  }
  if (!sessionId || !isPlaySessionId(sessionId)) throw new Error('denied');
  const url = liveInviteUrl(input.origin, { gameId, sessionId });
  if (!url.includes('session=')) throw new Error('denied');
  return {
    sessionId,
    url,
    expiresAt,
    result: conversationInviteResult({ sessionId, url, expiresAt }),
  };
}
