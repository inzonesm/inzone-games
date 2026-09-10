'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { PurchaseConfirmDialog } from '@/components/PurchaseConfirmDialog';
import { createSaveLoadClient } from '@/lib/game-sdk/backend';
import { HostSdkError } from '@/lib/game-sdk/errors';
import { createFixtureCheckoutClient } from '@/lib/game-sdk/fixture-checkout';
import { handleHostSdkMessage } from '@/lib/game-sdk/host-bridge';
import { createLiveCheckoutClient } from '@/lib/game-sdk/live-client';
import { PENDING_CAPABILITIES, GAME_IFRAME_SANDBOX, SDK_VERSION, SUPPORTED_CAPABILITIES } from '@/lib/game-sdk/protocol';
import { createPurchaseController, type CatalogOfferPrompt, type CheckoutPort } from '@/lib/game-sdk/purchase-session';
import { createMemoryStore, type KeyValueStore } from '@/lib/game-sdk/persist';

export type GameSdkHostMode = 'live' | 'fixture';

type FixtureHandle = ReturnType<typeof createFixtureCheckoutClient>;

function browserStore(): KeyValueStore {
  if (typeof window === 'undefined' || !window.localStorage) return createMemoryStore();
  return window.localStorage;
}

export function GameSdkHost({
  src,
  title,
  gameId,
  user,
  mode = 'live',
  fixtureAccountId,
  reloadKey = 0,
  iframeRef,
  onFrameLoaded,
  fixtureControlRef,
}: {
  src: string;
  title: string;
  gameId: string;
  user: User | null;
  mode?: GameSdkHostMode;
  fixtureAccountId?: string;
  reloadKey?: number;
  iframeRef?: React.Ref<HTMLIFrameElement>;
  onFrameLoaded?: () => void;
  fixtureControlRef?: React.MutableRefObject<FixtureHandle['control'] | null>;
}) {
  const innerRef = useRef<HTMLIFrameElement | null>(null);
  const setRefs = useCallback((node: HTMLIFrameElement | null) => {
    innerRef.current = node;
    if (typeof iframeRef === 'function') iframeRef(node);
    else if (iframeRef) {
      (iframeRef as React.MutableRefObject<HTMLIFrameElement | null>).current = node;
    }
  }, [iframeRef]);

  const accountId = user?.uid ?? (mode === 'fixture' ? (fixtureAccountId || 'fixture-player') : null);
  const [prompt, setPrompt] = useState<CatalogOfferPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmWaiter = useRef<{ resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback((next: CatalogOfferPrompt) => {
    if (confirmWaiter.current) confirmWaiter.current.resolve(false);
    setPrompt(next);
    return new Promise<boolean>((resolve) => {
      confirmWaiter.current = { resolve };
    });
  }, []);

  const closePrompt = useCallback((accepted: boolean) => {
    confirmWaiter.current?.resolve(accepted);
    confirmWaiter.current = null;
    setPrompt(null);
    setBusy(false);
  }, []);

  useEffect(() => () => {
    confirmWaiter.current?.resolve(false);
    confirmWaiter.current = null;
  }, [gameId, accountId, reloadKey]);

  const fixture = useMemo(() => {
    if (mode !== 'fixture') return null;
    const created = createFixtureCheckoutClient(gameId);
    if (fixtureControlRef) fixtureControlRef.current = created.control;
    return created;
  }, [mode, gameId, fixtureControlRef]);

  const client: CheckoutPort | null = useMemo(() => {
    if (mode === 'fixture') return fixture?.client ?? null;
    try {
      return createLiveCheckoutClient({
        gameId,
        getToken: async () => {
          if (!user) return null;
          return user.getIdToken();
        },
      });
    } catch {
      return null;
    }
  }, [mode, fixture, gameId, user]);

  const controller = useMemo(() => {
    if (!client) return null;
    return createPurchaseController({
      accountId,
      gameId,
      client,
      store: browserStore(),
      confirm,
    });
  }, [accountId, gameId, client, confirm, reloadKey]);

  const saveLoad = useMemo(() => {
    if (mode === 'fixture') {
      const slots = new Map<string, { state: unknown; metadata?: unknown; version: number }>();
      return {
        async loadState() {
          if (!accountId) throw new HostSdkError('UNAUTHENTICATED');
          const row = slots.get(`${accountId}:${gameId}`);
          return row
            ? { gameId, playerId: accountId, state: row.state, version: row.version, metadata: row.metadata ?? {}, updatedAt: new Date().toISOString() }
            : { gameId, playerId: accountId, state: {}, version: 0, metadata: {}, updatedAt: null };
        },
        async saveState(payload: unknown) {
          if (!accountId) throw new HostSdkError('UNAUTHENTICATED');
          const body = payload && typeof payload === 'object' ? payload as { state?: unknown; metadata?: unknown } : {};
          const state = body.state ?? payload;
          if (state === null || typeof state !== 'object' || Array.isArray(state)) {
            throw new HostSdkError('INVALID_STATE');
          }
          const prev = slots.get(`${accountId}:${gameId}`);
          const version = (prev?.version ?? 0) + 1;
          slots.set(`${accountId}:${gameId}`, { state, metadata: body.metadata, version });
          return { gameId, playerId: accountId, version, bytes: JSON.stringify(state).length, savedAt: new Date().toISOString() };
        },
      };
    }
    try {
      return createSaveLoadClient({
        baseUrl: process.env.NEXT_PUBLIC_INZONE_API_ORIGIN,
        gameId,
        getUserId: () => accountId,
        getToken: async () => (user ? user.getIdToken() : null),
      });
    } catch {
      return null;
    }
  }, [mode, accountId, gameId, user]);

  useEffect(() => {
    const allowedOrigin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      const frame = innerRef.current;
      if (!frame?.contentWindow) return;
      void handleHostSdkMessage(event, {
        boundSource: frame.contentWindow,
        allowedOrigin,
        postToSource: (source, data) => {
          const target = source as Window;
          const origin = event.origin === 'null' ? '*' : event.origin;
          target.postMessage(data, origin);
        },
        methods: {
          getConfig: async () => ({
            sdkVersion: SDK_VERSION,
            protocol: 1,
            gameId,
            fixtureMode: mode === 'fixture',
            isolation: 'opaque-origin-frame',
            capabilities: SUPPORTED_CAPABILITIES,
            pendingCapabilities: PENDING_CAPABILITIES,
            signedIn: Boolean(accountId),
          }),
          getCatalog: async () => {
            if (!controller) throw new HostSdkError('CHECKOUT_UNAVAILABLE');
            return controller.getCatalog();
          },
          requestPurchase: async (payload) => {
            if (!controller) throw new HostSdkError('CHECKOUT_UNAVAILABLE');
            return controller.requestPurchase(payload);
          },
          getInventory: async (payload) => {
            if (!controller) throw new HostSdkError('CHECKOUT_UNAVAILABLE');
            return controller.getInventory(payload);
          },
          getReceipt: async (payload) => {
            if (!controller) throw new HostSdkError('CHECKOUT_UNAVAILABLE');
            return controller.getReceipt(payload);
          },
          saveState: async (payload) => {
            if (!saveLoad) throw new HostSdkError('INZONE_UNSUPPORTED_CAPABILITY');
            const body = payload && typeof payload === 'object' ? payload as { state?: unknown; metadata?: unknown } : {};
            return saveLoad.saveState(body.state ?? payload, body.metadata);
          },
          loadState: async () => {
            if (!saveLoad) throw new HostSdkError('INZONE_UNSUPPORTED_CAPABILITY');
            return saveLoad.loadState();
          },
        },
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [accountId, controller, gameId, mode, saveLoad]);

  function handleLoad() {
    if (confirmWaiter.current) closePrompt(false);
    onFrameLoaded?.();
  }

  return (
    <>
      <iframe
        ref={setRefs}
        key={`${gameId}-${reloadKey}`}
        src={src}
        title={title}
        scrolling="no"
        sandbox={GAME_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        onLoad={handleLoad}
        allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
        allowFullScreen
        data-inzone-sdk-host="1"
      />
      {prompt && (
        <PurchaseConfirmDialog
          prompt={prompt}
          signedIn={Boolean(accountId)}
          busy={busy}
          onCancel={() => closePrompt(false)}
          onConfirm={() => {
            setBusy(true);
            closePrompt(true);
          }}
        />
      )}
    </>
  );
}
