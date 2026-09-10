'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { GameSdkHost } from '@/components/GameSdkHost';
import { createFixtureCheckoutClient } from '@/lib/game-sdk/fixture-checkout';
import { PENDING_STORAGE_KEY, readPending } from '@/lib/game-sdk/persist';

type FixtureHandle = ReturnType<typeof createFixtureCheckoutClient>;

export default function SdkExamplePage() {
  const { user } = useAuth();
  const [account, setAccount] = useState('fixture-player');
  const [reloadKey, setReloadKey] = useState(0);
  const [failMode, setFailMode] = useState<FixtureHandle['control']['failNextPurchase']>(null);
  const controlRef = useRef<FixtureHandle['control'] | null>(null);

  const pending = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return readPending(window.localStorage, account, 'sdk-example');
    // reloadKey + failMode force a reread after actions.
  }, [account, reloadKey, failMode]);

  function applyFailMode(mode: FixtureHandle['control']['failNextPurchase']) {
    setFailMode(mode);
    if (controlRef.current) controlRef.current.failNextPurchase = mode;
  }

  return (
    <div className="sdk-example-shell">
      <aside className="sdk-example-panel">
        <p className="sdk-example-kicker">Integration preview</p>
        <h1>Web SDK host example</h1>
        <p>
          The game on the right is served through the same HTML instrumentation as <code>/gcs</code>,
          inside an opaque-origin iframe. Tokens stay in this trusted host. Checkout flags stay off;
          this page uses an in-memory fixture catalog, not live coins.
        </p>
        <dl>
          <div>
            <dt>Firebase user</dt>
            <dd>{user?.uid ?? 'not signed in (fixture account in use)'}</dd>
          </div>
          <div>
            <dt>Fixture account</dt>
            <dd>
              <button type="button" className={account === 'fixture-player' ? 'active' : ''} onClick={() => setAccount('fixture-player')}>A</button>
              <button type="button" className={account === 'fixture-other' ? 'active' : ''} onClick={() => setAccount('fixture-other')}>B</button>
            </dd>
          </div>
          <div>
            <dt>Next purchase</dt>
            <dd>
              <button type="button" onClick={() => applyFailMode(null)}>succeed</button>
              <button type="button" data-testid="fail-network" onClick={() => applyFailMode('network')}>fail network</button>
            </dd>
          </div>
          <div>
            <dt>Persisted request</dt>
            <dd data-testid="pending-json"><pre>{pending ? JSON.stringify(pending, null, 2) : 'none'}</pre></dd>
          </div>
          <div>
            <dt>Posts / recovery GETs</dt>
            <dd data-testid="fixture-counts">
              {controlRef.current
                ? `${controlRef.current.purchasePosts} / ${controlRef.current.receiptGets}`
                : '0 / 0'}
            </dd>
          </div>
        </dl>
        <p>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>Reload game frame</button>
          {' '}
          <button type="button" onClick={() => { try { localStorage.removeItem(PENDING_STORAGE_KEY); } catch {} setReloadKey((k) => k + 1); }}>Clear pending</button>
        </p>
        <p><Link href="/docs/inzone-web-sdk.md">Developer instructions</Link></p>
      </aside>
      <div className="sdk-example-frame">
        <GameSdkHost
          src="/sdk-example/game/index.html"
          title="InZone SDK example"
          gameId="sdk-example"
          user={user}
          mode="fixture"
          fixtureAccountId={account}
          reloadKey={reloadKey}
          fixtureControlRef={controlRef}
        />
      </div>
    </div>
  );
}
