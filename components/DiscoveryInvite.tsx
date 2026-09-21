'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createConversationInvite } from '@/lib/play-invite-action';
import { PLAY_INVITE_COPY } from '@/lib/play-invite';
import { PLAY_SESSION_COPY } from '@/lib/play-session-core';
import { trackInviteCopiedAfterWrite } from '@/lib/campaign-analytics';
import { DISCOVERY_COPY } from '@/lib/discovery';
import type { HubGame } from '@/lib/types';

type Phase = 'idle' | 'creating' | 'ready' | 'error';

export function DiscoveryInvite({
  game,
  existingSessionId,
  onClose,
  onCreated,
}: {
  game: HubGame;
  existingSessionId?: string | null;
  onClose: () => void;
  onCreated: (input: { sessionId: string; url: string; gameId: string }) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [url, setUrl] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => dialog.removeEventListener('cancel', onCancel);
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute('disabled'));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => dialog.removeEventListener('keydown', onKey);
  }, []);

  async function createInvite() {
    setPhase('creating');
    setError(null);
    setCopyState('idle');
    try {
      const created = await createConversationInvite({
        gameId: game.id,
        origin: window.location.origin,
        existingSessionId,
      });
      setUrl(created.url);
      setSessionId(created.sessionId);
      setPhase('ready');
      onCreated({ sessionId: created.sessionId, url: created.url, gameId: game.id });
    } catch (err) {
      console.warn('createPlaySession failed', err instanceof Error ? err.message : err);
      setError(PLAY_SESSION_COPY.createFailed);
      setPhase('error');
    }
  }

  async function copyLink() {
    if (!url) return;
    const ok = await trackInviteCopiedAfterWrite(
      async (text) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch (err) {
          console.warn('clipboard write failed', err instanceof Error ? err.message : err);
          throw err;
        }
      },
      url,
      game.id,
    );
    setCopyState(ok ? 'copied' : 'failed');
  }

  return (
    <dialog
      ref={dialogRef}
      className="discovery-dialog"
      data-testid="discovery-invite"
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="discovery-dialog-top">
        <span className="discovery-eyebrow">Your invitation</span>
        <button
          ref={closeRef}
          type="button"
          className="discovery-icon-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <h2 id={titleId}>{DISCOVERY_COPY.inviteTitle}</h2>
      <p>
        They’ll join your conversation and open {game.name}. Each of you keeps your own game.
      </p>
      {phase === 'idle' ? (
        <button type="button" className="discovery-play discovery-dialog-primary" onClick={() => void createInvite()}>
          Create invitation
        </button>
      ) : null}
      {phase === 'creating' ? <p className="discovery-note">{DISCOVERY_COPY.creating}</p> : null}
      {phase === 'error' ? (
        <div className="discovery-dialog-actions">
          <p className="discovery-error">{error}</p>
          <button type="button" className="discovery-play" onClick={() => void createInvite()}>
            Retry
          </button>
        </div>
      ) : null}
      {phase === 'ready' && url ? (
        <>
          <div className="discovery-linkbox">
            <input readOnly value={url} aria-label="Invitation link" />
            <button type="button" className="discovery-play" onClick={() => void copyLink()}>
              {copyState === 'copied' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="discovery-note">
            {copyState === 'copied' ? PLAY_INVITE_COPY.conversationToast : PLAY_INVITE_COPY.conversationHint}
          </p>
          {copyState === 'failed' ? (
            <p className="discovery-note">{PLAY_SESSION_COPY.copyFailed}</p>
          ) : null}
        </>
      ) : null}
      {sessionId ? <span className="sr-only">Conversation ready</span> : null}
    </dialog>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="m5 5 14 14M19 5 5 19" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
