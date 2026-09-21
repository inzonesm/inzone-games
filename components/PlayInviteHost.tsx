'use client';

import { useEffect } from 'react';
import {
  PLAY_INVITE_CHANNEL,
  PLAY_INVITE_PROTOCOL,
  isPlayInviteRequest,
  type PlayInviteResponse,
} from '@/lib/play-invite';

/**
 * Same-origin conversation invite listener.
 * Games that are not on the isolated SDK host postMessage here.
 */
export function PlayInviteHost({
  iframeRef,
  onRequest,
}: {
  iframeRef: { current: HTMLIFrameElement | null };
  onRequest: (method: 'sendChallenge' | 'openChat') => Promise<unknown>;
}) {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      if (event.source !== frame.contentWindow) return;
      if (!isPlayInviteRequest(event.data)) return;
      const req = event.data;
      const reply = (response: Omit<PlayInviteResponse, 'channel' | 'v' | 'id' | 'type'>) => {
        const origin = event.origin === 'null' ? '*' : event.origin;
        (event.source as Window).postMessage(
          {
            channel: PLAY_INVITE_CHANNEL,
            v: PLAY_INVITE_PROTOCOL,
            id: req.id,
            type: 'res',
            ...response,
          } satisfies PlayInviteResponse,
          origin,
        );
      };
      void (async () => {
        try {
          const result = await onRequest(req.method);
          reply({ ok: true, result: result as PlayInviteResponse['result'] });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'denied';
          reply({
            ok: false,
            error: {
              code: message === 'denied' ? 'denied' : 'create_failed',
              message: 'Couldn’t start a live session. Try again.',
            },
          });
        }
      })();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframeRef, onRequest]);
  return null;
}
