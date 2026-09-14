'use client';

import type { HubGame } from '@/lib/types';
import type { PlayMemberDoc } from '@/lib/play-session';
import { IX_COPY } from '@/lib/experience-reset';
import { ExperienceArt } from './ExperienceArt';

export type SessionMode = 'invite' | 'preview' | 'joined' | 'expired';

export type ThreadItem =
  | { kind: 'chat'; id: string; from: string; text: string; you: boolean }
  | { kind: 'suggest'; id: string; from: string; game: HubGame; fixture?: boolean; status: 'pending' | 'opened' | 'kept' };

export function ExperienceSession({
  mode,
  game,
  docked,
  members,
  thread,
  draft,
  sending,
  toast,
  inviteBusy,
  fixture,
  onClose,
  onCopy,
  onJoin,
  onLeave,
  onPlayAlone,
  onDraft,
  onSend,
  onOpenSuggest,
  onKeepSuggest,
}: {
  mode: SessionMode;
  game: HubGame | null;
  docked: boolean;
  members: PlayMemberDoc[];
  thread: ThreadItem[];
  draft: string;
  sending: boolean;
  toast: string | null;
  inviteBusy: boolean;
  fixture: boolean;
  onClose: () => void;
  onCopy: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onPlayAlone: () => void;
  onDraft: (v: string) => void;
  onSend: () => void;
  onOpenSuggest: (id: string) => void;
  onKeepSuggest: (id: string) => void;
}) {
  const panel = (
    <aside className="ix-panel" aria-label={IX_COPY.session}>
      <div className="ix-panel-head">
        <h2>
          {mode === 'invite' && IX_COPY.inviteTitle}
          {mode === 'preview' && IX_COPY.previewTitle}
          {mode === 'joined' && IX_COPY.session}
          {mode === 'expired' && IX_COPY.expiredTitle}
        </h2>
        <button type="button" className="ix-btn ix-btn-ghost" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>
      <div className="ix-panel-body">
        {fixture && <span className="ix-fixture">{IX_COPY.fixture}</span>}
        {mode === 'invite' && (
          <>
            <p className="ix-note">{IX_COPY.copyHint}</p>
            <button type="button" className="ix-btn ix-btn-primary" disabled={inviteBusy} onClick={onCopy}>
              {IX_COPY.copyLink}
            </button>
          </>
        )}
        {mode === 'preview' && (
          <>
            <p className="ix-note">{IX_COPY.joinHint}</p>
            {game && (
              <div className="ix-detail" style={{ marginBottom: 16 }}>
                <ExperienceArt game={game} />
                <strong>{game.name}</strong>
              </div>
            )}
            <div className="ix-locked">
              <p className="ix-note">Private conversation is locked until you join.</p>
            </div>
            <div className="ix-dialog-actions" style={{ marginTop: 16 }}>
              <button type="button" className="ix-btn ix-btn-primary" disabled={inviteBusy} onClick={onJoin}>
                {IX_COPY.join}
              </button>
              <button type="button" className="ix-btn ix-btn-ghost" onClick={onPlayAlone}>
                {IX_COPY.playAlone}
              </button>
            </div>
          </>
        )}
        {mode === 'expired' && (
          <>
            <p className="ix-note">{IX_COPY.expiredBody}</p>
            <div className="ix-dialog-actions">
              <button type="button" className="ix-btn ix-btn-primary" onClick={onPlayAlone}>
                {IX_COPY.playAlone}
              </button>
              <button type="button" className="ix-btn ix-btn-ghost" onClick={onCopy}>
                {IX_COPY.newSession}
              </button>
            </div>
          </>
        )}
        {mode === 'joined' && (
          <>
            <p className="ix-note">{IX_COPY.differentGames}</p>
            <div className="ix-people">
              {members.length ? members.filter((m) => m.status === 'active').map((m) => (
                <div className="ix-person" key={m.actorId}>
                  <div className="ix-avatar">{(m.actorName || '?').slice(0, 1)}</div>
                  <div>
                    <strong>{m.actorName}</strong>
                    <div className="ix-note" style={{ margin: 0 }}>{m.anonymous ? 'Guest' : 'Playing'}</div>
                  </div>
                </div>
              )) : (
                <p className="ix-note">{IX_COPY.emptySession}</p>
              )}
            </div>
            <div className="ix-thread">
              {thread.map((item) => {
                if (item.kind === 'chat') {
                  return (
                    <div key={item.id} className={`ix-bubble${item.you ? ' is-you' : ''}`}>
                      <small>{item.from}</small>
                      {item.text}
                    </div>
                  );
                }
                return (
                  <div key={item.id} className="ix-suggest">
                    {item.fixture && <span className="ix-fixture">{IX_COPY.fixture}</span>}
                    <small>{item.from} suggested</small>
                    <div className="ix-person" style={{ margin: '8px 0' }}>
                      <ExperienceArt game={item.game} />
                      <strong>{item.game.name}</strong>
                    </div>
                    {item.status === 'pending' && (
                      <div className="ix-dialog-actions">
                        <button type="button" className="ix-btn ix-btn-primary" onClick={() => onOpenSuggest(item.id)}>
                          {IX_COPY.play}
                        </button>
                        <button type="button" className="ix-btn ix-btn-ghost" onClick={() => onKeepSuggest(item.id)}>
                          Dismiss
                        </button>
                      </div>
                    )}
                    {item.status === 'kept' && <p className="ix-note">You kept playing.</p>}
                    {item.status === 'opened' && <p className="ix-note">Opened on this device.</p>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      {mode === 'joined' && (
        <>
          <form
            className="ix-compose"
            onSubmit={(e) => {
              e.preventDefault();
              onSend();
            }}
          >
            <input
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              placeholder="Send a message…"
              aria-label={IX_COPY.chat}
              disabled={sending}
            />
            <button type="submit" className="ix-btn ix-btn-ghost" disabled={sending}>{IX_COPY.send}</button>
          </form>
          <button type="button" className="ix-btn ix-btn-ghost" style={{ margin: '0 12px 12px' }} onClick={onLeave}>
            {IX_COPY.leave}
          </button>
        </>
      )}
      {toast && <div className="ix-toast" role="status">{toast}</div>}
    </aside>
  );

  if (docked && mode === 'joined') {
    return <div className="ix-dock">{panel}</div>;
  }

  return (
    <div className={`ix-sheet${docked && mode === 'joined' ? ' is-session-desktop' : ''}`}>
      <button type="button" className="ix-scrim" aria-label="Close session" onClick={onClose} />
      {panel}
    </div>
  );
}
