'use client';

import { useEffect, useState } from 'react';
import { SocialPanel } from '@/components/SocialPanel';
import { DISCOVERY_COPY } from '@/lib/discovery';
import {
  ensurePlaySessionUser,
  joinPlaySession,
  leavePlaySession,
  playSessionActor,
  subscribePlayPreview,
  type PlayMemberDoc,
  type SessionLoadError,
} from '@/lib/play-session';
import { PLAY_SESSION_COPY } from '@/lib/play-session-core';
import type { HubGame } from '@/lib/types';

export function DiscoveryConversationStrip({
  members,
  onOpen,
  onLeave,
}: {
  members: PlayMemberDoc[];
  onOpen: () => void;
  onLeave: () => void;
}) {
  const active = members.filter((member) => member.status === 'active');
  const names = active.map((member) => member.actorName).filter(Boolean);
  const label = names.length > 1 ? names.slice(0, 3).join(' + ') : names[0] || 'Your conversation';
  return (
    <div className="discovery-connection" data-testid="discovery-conversation">
      <div className="discovery-avatars" aria-hidden="true">
        {(names.length ? names.slice(0, 3) : ['You']).map((name) => (
          <span key={name} className="discovery-avatar">
            {name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
      <div className="discovery-connection-copy">
        <strong>{label}</strong>
        <p>Same conversation. Your choice of game.</p>
      </div>
      <button type="button" className="discovery-small" onClick={onOpen}>
        Open chat
      </button>
      <button type="button" className="discovery-small discovery-ghost" onClick={onLeave}>
        Leave
      </button>
    </div>
  );
}

export function DiscoveryRecipient({
  game,
  inviterName,
  expired,
  joining,
  error,
  onJoin,
  onExplore,
}: {
  game: HubGame | null;
  inviterName: string;
  expired: boolean;
  joining: boolean;
  error: string | null;
  onJoin: () => void;
  onExplore: () => void;
}) {
  return (
    <section
      className="discovery-join"
      data-testid="discovery-recipient"
      data-review-surface="recipient"
      data-state={expired ? 'expired' : 'join'}
    >
      <div className="discovery-join-body">
        <div className="discovery-join-people">
          <span className="discovery-avatar">{(inviterName || 'Y').slice(0, 1).toUpperCase()}</span>
          <span className="discovery-eyebrow">
            {expired ? 'Invitation ended' : `${inviterName || 'Someone'} invited you`}
          </span>
        </div>
        <h1>{expired ? DISCOVERY_COPY.expiredTitle : DISCOVERY_COPY.joinTitle}</h1>
        <p>
          {expired
            ? DISCOVERY_COPY.expiredBody
            : game
              ? `Join the conversation and open ${game.name}. You each play your own game.`
              : DISCOVERY_COPY.joinBody}
        </p>
        {expired ? (
          <button type="button" className="discovery-play discovery-dialog-primary" onClick={onExplore}>
            Explore games
          </button>
        ) : (
          <button
            type="button"
            className="discovery-play discovery-dialog-primary"
            disabled={joining}
            onClick={onJoin}
          >
            {joining ? 'Joining…' : DISCOVERY_COPY.joinAction}
          </button>
        )}
        {error ? <p className="discovery-error">{error}</p> : null}
        <small>No download. Guest identity is the one InZone already supports.</small>
        <button type="button" className="discovery-ghost discovery-full" onClick={onExplore}>
          Explore games first
        </button>
      </div>
    </section>
  );
}

export function DiscoveryChatSheet({
  gameId,
  sessionId,
  onClose,
  onPlayGame,
}: {
  gameId: string;
  sessionId: string | null;
  onClose: () => void;
  onPlayGame?: (id: string) => void;
}) {
  return (
    <div className="discovery-sheet" data-review-surface="conversation">
      <div className="discovery-sheet-scrim" onClick={onClose} />
      <SocialPanel
        gameId={gameId}
        liveSession={sessionId}
        expanded
        onCloseRequest={onClose}
        onPlayGame={onPlayGame}
      />
    </div>
  );
}

export function useDiscoverySession(sessionId: string | null) {
  const [members, setMembers] = useState<PlayMemberDoc[]>([]);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<SessionLoadError | null>(null);
  const [gameId, setGameId] = useState('');

  useEffect(() => {
    if (!sessionId) {
      setMembers([]);
      setJoined(false);
      setError(null);
      setGameId('');
      return;
    }
    let stop = false;
    let unsub = () => {};
    void (async () => {
      try {
        const user = await ensurePlaySessionUser();
        if (stop) return;
        unsub = subscribePlayPreview(sessionId, {
          onSession: (session) => {
            setError(null);
            setGameId(session.gameId);
            setJoined(session.memberIds.includes(user.uid));
          },
          onMembers: setMembers,
          onError: (next) => {
            setError(next);
            setJoined(false);
          },
        });
      } catch {
        if (!stop) setError('denied');
      }
    })();
    return () => {
      stop = true;
      unsub();
    };
  }, [sessionId]);

  async function join() {
    if (!sessionId) return;
    const user = await ensurePlaySessionUser();
    const actor = await playSessionActor(user);
    const result = await joinPlaySession(sessionId, actor);
    if (result) throw new Error(result);
  }

  async function leave() {
    if (!sessionId) return;
    const user = await ensurePlaySessionUser();
    const actor = await playSessionActor(user);
    await leavePlaySession(sessionId, actor);
  }

  return { members, joined, error, gameId, join, leave };
}

export function joinErrorCopy(error: SessionLoadError | null): string | null {
  if (!error) return null;
  if (error === 'expired' || error === 'ended') return DISCOVERY_COPY.expiredBody;
  if (error === 'invalid') return PLAY_SESSION_COPY.joinFailed;
  return PLAY_SESSION_COPY.joinFailed;
}
