'use client';

/* ServerDeployPanel — shown on the upload page's success state. Lets the
 * dev deploy a multiplayer game server to InZone's Fly.io org by uploading
 * a zip with Dockerfile + source. Streams build progress + logs via the
 * backend's Firestore status doc. */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDeploymentLogs,
  startServerDeploy,
  studioApiConfigured,
  subscribeToDeployment,
  subscribeToDeploymentLogs,
  type DeploymentLogLine,
  type DeploymentSnapshot,
  type DeployStatus,
} from '@/lib/server-deploy';

interface Props {
  gameSlug: string;
  /** wss:// URL already on the game doc (from a previous deploy or BYO URL). */
  initialServerUrl?: string;
}

const STAGES: { key: DeployStatus; label: string }[] = [
  { key: 'queued',     label: 'Queued' },
  { key: 'extracting', label: 'Extracting' },
  { key: 'validating', label: 'Validating' },
  { key: 'building',   label: 'Building' },
  { key: 'releasing',  label: 'Releasing' },
  { key: 'live',       label: 'Live' },
];

export function ServerDeployPanel({ gameSlug, initialServerUrl }: Props) {
  const [zip, setZip] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [upload, setUpload] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [deployment, setDeployment] = useState<DeploymentSnapshot | null>(null);
  const [logs, setLogs] = useState<DeploymentLogLine[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiConfigured = studioApiConfigured();

  // Subscribe to the deployment doc + its log subcollection once we have an
  // id. The id is known before the backend creates the doc, and restrictive
  // rules can deny reads on a not-yet-existing doc — which permanently kills
  // the listener — so on error we tear down and retry until the doc lands.
  useEffect(() => {
    if (!deploymentId) return;
    let cancelled = false;
    let unsubStatus = () => {};
    let unsubLogs = () => {};
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const retry = () => {
      if (cancelled || retryTimer) return; // both listeners can error at once
      unsubStatus();
      unsubLogs();
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        if (!cancelled) subscribe();
      }, 3000);
    };
    const subscribe = () => {
      unsubStatus = subscribeToDeployment(deploymentId, setDeployment, retry);
      unsubLogs = subscribeToDeploymentLogs(deploymentId, setLogs, retry);
    };
    subscribe();
    return () => {
      cancelled = true;
      unsubStatus();
      unsubLogs();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [deploymentId]);

  // First paint: if a stale deployment is around (page refresh), best-effort
  // try to surface its logs so we don't show an empty panel.
  useEffect(() => {
    if (deploymentId && logs.length === 0) {
      fetchDeploymentLogs(deploymentId).then(setLogs).catch(() => undefined);
    }
  }, [deploymentId, logs.length]);

  const onSubmit = useCallback(async () => {
    setError(null);
    if (!zip) {
      setError('Pick a server.zip first.');
      return;
    }
    setSubmitting(true);
    setUpload({ loaded: 0, total: zip.size });
    try {
      const res = await startServerDeploy({
        serverZip: zip,
        gameSlug,
        // Subscribe to the status doc right away — on backends that honor the
        // client-supplied id, stages stream in while the POST is still open.
        onDeploymentId: setDeploymentId,
        onUploadProgress: (loaded, total) => setUpload({ loaded, total }),
      });
      // Authoritative id from the response (differs only on older backends).
      setDeploymentId(res.deploymentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setSubmitting(false);
      setUpload(null);
    }
  }, [zip, gameSlug]);

  // Once a deployment lands, the html_games doc's serverUrl is updated by
  // the backend. We reflect it locally so the dev sees the new endpoint.
  const liveServerUrl = deployment?.status === 'live'
    ? deployment.serverUrl
    : initialServerUrl;

  const isInFlight = !!deployment && deployment.status !== 'live' && deployment.status !== 'failed';

  return (
    <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}>
      <div
        style={{
          fontFamily: "'Geist Mono', monospace",
          fontSize: 10.5,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
          marginBottom: 14,
        }}
      >
        Multiplayer server · deploy on InZone
      </div>

      {!apiConfigured && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px dashed var(--line)',
            fontFamily: "'Geist Mono', monospace",
            fontSize: 11,
            color: 'var(--warm)',
            lineHeight: 1.5,
          }}
        >
          Studio backend not configured — set <code>NEXT_PUBLIC_STUDIO_API_BASE</code> in
          your .env.local (e.g. <code>https://studio-api.inzone.gg</code>) to enable
          server deploys.
        </div>
      )}

      {liveServerUrl && !isInFlight && (
        <div
          style={{
            background: 'oklch(0.78 0.14 155 / 0.08)',
            border: '1px solid oklch(0.78 0.14 155 / 0.3)',
            borderRadius: 12,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--pos)',
              boxShadow: '0 0 8px var(--pos)',
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10.5,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--ink-3)',
              }}
            >
              Server connected
            </div>
            <div
              style={{
                fontFamily: "'Geist Mono', monospace",
                fontSize: 13,
                color: 'var(--blue-1)',
                wordBreak: 'break-all',
              }}
            >
              {liveServerUrl}
            </div>
          </div>
        </div>
      )}

      {!isInFlight && (
        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            padding: '16px 18px',
          }}
        >
          <div
            style={{
              fontSize: 13.5,
              color: 'var(--ink-2)',
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Upload a <code style={inlineCode}>.zip</code> with a{' '}
            <code style={inlineCode}>Dockerfile</code> at the root and your server source. We
            build it on Fly&apos;s remote builder and deploy it under the InZone org as{' '}
            <code style={inlineCode}>inz-{gameSlug}-XXXX.fly.dev</code>.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || !apiConfigured}
              className="btn-ghost"
              style={{ height: 42, justifyContent: 'flex-start', textAlign: 'left' }}
            >
              <UploadIcon />
              {zip ? zip.name : 'Choose server.zip…'}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!zip || submitting || !apiConfigured}
              className="btn-primary"
              style={{ height: 42 }}
            >
              {submitting
                ? upload && upload.loaded < upload.total
                  ? `Uploading ${Math.round((upload.loaded / upload.total) * 100)}%`
                  : 'Deploying…'
                : liveServerUrl ? 'Replace server' : 'Deploy server'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              style={{ display: 'none' }}
              onChange={(e) => setZip(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Upload status bar — visible until the backend's status doc takes
              over (or, on older backends, until the POST resolves). */}
          {upload && !deployment && (
            <UploadProgressBar
              fileName={zip?.name ?? 'server.zip'}
              loaded={upload.loaded}
              total={upload.total}
            />
          )}

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'oklch(0.72 0.16 25 / 0.12)',
                border: '1px solid oklch(0.72 0.16 25 / 0.3)',
                color: 'var(--neg)',
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}

      {/* In-flight progress + log tail */}
      {deployment && (
        <DeployProgress deployment={deployment} logs={logs} />
      )}
    </div>
  );
}

const inlineCode = {
  padding: '2px 6px',
  borderRadius: 4,
  background: 'var(--bg-3)',
  color: 'var(--blue-1)',
  fontFamily: "'Geist Mono', monospace",
  fontSize: 11.5,
};

function UploadProgressBar({
  fileName,
  loaded,
  total,
}: {
  fileName: string;
  loaded: number;
  total: number;
}) {
  const sent = total > 0 && loaded >= total;
  const pct = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 7,
          fontFamily: "'Geist Mono', monospace",
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {sent
            ? 'Upload received — building on Fly (takes a few minutes)…'
            : `Uploading ${fileName}…`}
        </span>
        <span style={{ flexShrink: 0 }}>
          {formatBytes(loaded)} / {formatBytes(total)} · {pct}%
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: 'var(--bg-3)',
          border: '1px solid var(--line-soft)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: sent ? 'var(--pos)' : 'var(--blue-1)',
            transition: 'width 0.25s ease',
            animation: sent ? 'pulse-dot 1.4s ease-in-out infinite' : 'none',
          }}
        />
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function UploadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v13" />
      <path d="m6 9 6-6 6 6" />
      <path d="M5 21h14" />
    </svg>
  );
}

function DeployProgress({
  deployment,
  logs,
}: {
  deployment: DeploymentSnapshot;
  logs: DeploymentLogLine[];
}) {
  const currentIdx = STAGES.findIndex((s) => s.key === deployment.status);
  const isFailed = deployment.status === 'failed';

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 12,
          padding: '16px 18px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {STAGES.map((s, i) => {
            const isDone = !isFailed && i < currentIdx;
            const isActive = !isFailed && i === currentIdx;
            const isCurrentFailed = isFailed && i === currentIdx;
            const dotBg = isDone
              ? 'var(--pos)'
              : isActive
                ? 'oklch(0.20 0.06 240 / 0.5)'
                : isCurrentFailed
                  ? 'var(--neg)'
                  : 'var(--bg-3)';
            const dotBorder = isDone
              ? 'var(--pos)'
              : isActive
                ? 'var(--blue-1)'
                : isCurrentFailed
                  ? 'var(--neg)'
                  : 'var(--line)';
            return (
              <div
                key={s.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr',
                  gap: 14,
                  alignItems: 'center',
                  padding: '9px 0',
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: dotBg,
                    border: `1px solid ${dotBorder}`,
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: isDone ? '0 0 12px oklch(0.78 0.14 155 / 0.5)' : 'none',
                  }}
                >
                  {isDone && (
                    <span
                      style={{
                        width: 7,
                        height: 4,
                        borderLeft: '1.5px solid oklch(0.18 0.05 155)',
                        borderBottom: '1.5px solid oklch(0.18 0.05 155)',
                        transform: 'rotate(-45deg) translate(1px, -1px)',
                      }}
                    />
                  )}
                  {isActive && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'var(--blue-1)',
                        animation: 'pulse-dot 1.2s ease-in-out infinite',
                      }}
                    />
                  )}
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    color: i <= currentIdx ? 'var(--ink)' : 'var(--ink-4)',
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {logs.length > 0 && (
          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'oklch(0.10 0.015 245 / 0.8)',
              border: '1px solid var(--line-soft)',
              maxHeight: 220,
              overflowY: 'auto',
              fontFamily: "'Geist Mono', monospace",
              fontSize: 11,
              color: 'var(--ink-3)',
              lineHeight: 1.55,
            }}
          >
            {logs.map((l) => (
              <div key={l.id}>{l.line}</div>
            ))}
          </div>
        )}

        {isFailed && deployment.error && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'oklch(0.72 0.16 25 / 0.12)',
              border: '1px solid oklch(0.72 0.16 25 / 0.3)',
              color: 'var(--neg)',
              fontSize: 12.5,
            }}
          >
            {deployment.error}
          </div>
        )}
      </div>
    </div>
  );
}
