'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * PWA install affordance.
 *
 * Modern browsers no longer show an automatic install popup. Instead:
 *  - Chromium (Android / desktop) fires `beforeinstallprompt`, which we capture
 *    and surface as a top banner with a real "Install App" button.
 *  - iOS Safari never fires that event, so for iOS we show a bottom sheet with
 *    the manual "Add to Home Screen" steps.
 *
 * The banner is dismissible and snoozed for a while via localStorage, and it
 * never shows once the app is already installed (running standalone).
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'inzone-install-dismissed';
const DISMISS_DAYS = 14;

function recentlyDismissed(): boolean {
  try {
    const ts = window.localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    const days = (Date.now() - Number(ts)) / (1000 * 60 * 60 * 24);
    return days < DISMISS_DAYS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

const ShareIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ verticalAlign: 'middle' }}
  >
    <path d="M12 15V3" />
    <path d="m8 7 4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);

const DownloadIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;

    if (isIOS()) {
      setIos(true);
      setShowBanner(true);
      return;
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };
    const onInstalled = () => {
      setShowBanner(false);
      setShowSheet(false);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setShowBanner(false);
  }, []);

  const install = useCallback(async () => {
    if (ios) {
      setShowSheet(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setShowBanner(false);
  }, [ios, deferred]);

  if (!showBanner && !showSheet) return null;

  return (
    <>
      <style>{`
        @keyframes inzone-slide-down { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes inzone-slide-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes inzone-fade { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {showBanner && (
        <div
          role="dialog"
          aria-label="Install InZone"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding:
              'calc(env(safe-area-inset-top, 0px) + 12px) 16px 12px',
            background: 'var(--bg-1, #0f141b)',
            borderBottom: '1px solid var(--line, rgba(255,255,255,0.10))',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            animation: 'inzone-slide-down 0.35s var(--ease, cubic-bezier(0.2,0.7,0.2,1))',
          }}
        >
          <button
            aria-label="Dismiss install banner"
            onClick={dismiss}
            style={{
              flex: '0 0 auto',
              width: 30,
              height: 30,
              borderRadius: 999,
              border: '1px solid var(--line, rgba(255,255,255,0.10))',
              background: 'transparent',
              color: 'var(--ink-2, #c8ccd2)',
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            ×
          </button>

          <img
            src="/icons/icon-192.png"
            alt=""
            width={44}
            height={44}
            style={{ flex: '0 0 auto', borderRadius: 10 }}
          />

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                color: 'var(--ink, #f4f5f7)',
                fontWeight: 600,
                fontSize: 15,
                lineHeight: 1.25,
              }}
            >
              Get the InZone App
            </div>
            <div style={{ color: 'var(--ink-3, #8a909a)', fontSize: 13 }}>
              on your smartphone or tablet
            </div>
          </div>

          <button
            onClick={install}
            style={{
              flex: '0 0 auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 16px',
              borderRadius: 12,
              border: 'none',
              cursor: 'pointer',
              fontSize: 15,
              fontWeight: 600,
              color: '#fff',
              background:
                'linear-gradient(135deg, var(--blue-2, #4f8cff), var(--blue-3, #3358d6))',
              boxShadow: '0 4px 14px rgba(51,88,214,0.45)',
            }}
          >
            <DownloadIcon />
            Install App
          </button>
        </div>
      )}

      {showSheet && (
        <div
          onClick={() => setShowSheet(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1001,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            animation: 'inzone-fade 0.2s ease',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Install instructions"
            style={{
              width: '100%',
              maxWidth: 520,
              background: 'var(--bg-1, #0f141b)',
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              border: '1px solid var(--line, rgba(255,255,255,0.10))',
              padding:
                '10px 22px calc(env(safe-area-inset-bottom, 0px) + 22px)',
              animation:
                'inzone-slide-up 0.3s var(--ease, cubic-bezier(0.2,0.7,0.2,1))',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 40,
                height: 4,
                borderRadius: 999,
                background: 'var(--line-strong, rgba(255,255,255,0.18))',
                margin: '8px auto 18px',
              }}
            />
            <h2
              style={{
                color: 'var(--ink, #f4f5f7)',
                fontSize: 18,
                fontWeight: 600,
                textAlign: 'center',
                margin: '0 0 18px',
              }}
            >
              Install the App
            </h2>

            <ol
              style={{
                listStyle: 'none',
                counterReset: 'step',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              {[
                <>
                  Tap the Share button <ShareIcon /> in Safari&apos;s toolbar
                </>,
                <>Scroll down and tap &ldquo;Add to Home Screen&rdquo;</>,
                <>Tap &ldquo;Add&rdquo; in the top corner</>,
                <>Look for the InZone icon on your home screen</>,
              ].map((step, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    color: 'var(--ink-2, #c8ccd2)',
                    fontSize: 15,
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      flex: '0 0 auto',
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      background: 'var(--bg-3, #232a33)',
                      color: 'var(--ink, #f4f5f7)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <button
              onClick={() => setShowSheet(false)}
              style={{
                marginTop: 22,
                width: '100%',
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid var(--line, rgba(255,255,255,0.10))',
                background: 'transparent',
                color: 'var(--ink, #f4f5f7)',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
