'use client';

/**
 * Preview-only recorder for the Nightclub resume interaction.
 *
 * Opt-in by `?inzoneDiag=1`, and refused outright on production hosts — see
 * `diagnosticsEnabled`. It attaches pointer listeners to the host document and,
 * where the frame is same-origin, to the frame's document too, samples the
 * engine's pause state either side of every tap, and shows the log with a copy
 * and a download button.
 *
 * It is a recorder and nothing else. It never clicks the canvas, never calls
 * resume, and never changes the hold, because a diagnostic that nudges the
 * thing it is measuring produces a reading of itself. It has no transport: the
 * log leaves this device only if the person exports it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyTap,
  describeTarget,
  resumeOutcome,
  summarise,
  type PauseState,
  type ResumeRecord,
} from '@/lib/resume-diagnostics';
import { sampleNightclubPause } from '@/lib/nightclub-companion-focus';
import { classifyHost } from '@/lib/qa-traffic';

/** Production never runs this, whatever the query string says. */
export function diagnosticsEnabled(search: string, hostname: string): boolean {
  if (classifyHost(hostname) === 'production') return false;
  try {
    return new URLSearchParams(search).get('inzoneDiag') === '1';
  } catch {
    return false;
  }
}

const MAX_RECORDS = 200;
/** Long enough for the engine to act on a tap, short enough to attribute it. */
const SETTLE_MS = 600;

export function ResumeDiagnostics({
  gameId,
  iframeRef,
}: {
  gameId: string;
  iframeRef: { current: HTMLIFrameElement | null };
}) {
  const [enabled, setEnabled] = useState(false);
  const [records, setRecords] = useState<ResumeRecord[]>([]);
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState('');
  const startedAt = useRef(Date.now());

  useEffect(() => {
    setEnabled(diagnosticsEnabled(window.location.search, window.location.hostname));
  }, []);

  const read = useCallback((): PauseState => {
    const s = sampleNightclubPause(iframeRef.current);
    return {
      mainPaused: s.mainPaused,
      overlay: s.overlay,
      iframeFocused: s.iframeFocused,
      hold: s.hold,
      visibility: s.visibility,
    };
  }, [iframeRef]);

  const canvasRect = useCallback(() => {
    const frame = iframeRef.current;
    if (!frame) return null;
    try {
      const doc = frame.contentDocument;
      if (!doc) return null;
      const canvases = Array.from(doc.querySelectorAll('canvas'))
        .filter((c) => c.clientWidth > 0 && c.clientHeight > 0)
        .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
      const canvas = canvases[0];
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    } catch {
      return null;
    }
  }, [iframeRef]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    const record = (target: Element | null, point: { x: number; y: number }, inFrame: boolean) => {
      const before = read();
      const rect = canvasRect();
      const path = describeTarget(target);
      const zone = classifyTap({ inFrame, path, point, canvasRect: rect });
      const hostFocused = typeof document !== 'undefined' && document.hasFocus();
      window.setTimeout(() => {
        if (disposed) return;
        const after = read();
        setRecords((prev) => {
          const next = prev.concat({
            at: Date.now() - startedAt.current,
            zone,
            point,
            canvasRect: rect,
            path,
            before,
            after,
            outcome: resumeOutcome(before, after),
            hostFocused,
          });
          return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
        });
      }, SETTLE_MS);
    };

    const onHost = (e: PointerEvent) => record(e.target as Element | null, { x: Math.round(e.clientX), y: Math.round(e.clientY) }, false);
    document.addEventListener('pointerdown', onHost, true);

    /* The frame's own pointer events, where it is same-origin. Coordinates are
       already in the frame's viewport, which is the stage box, so they compare
       directly with the canvas rect read from the same document. */
    let frameDoc: Document | null = null;
    const onFrame = (e: Event) => {
      const pe = e as PointerEvent;
      record(pe.target as Element | null, { x: Math.round(pe.clientX), y: Math.round(pe.clientY) }, true);
    };
    const attach = () => {
      try {
        frameDoc = iframeRef.current?.contentDocument ?? null;
        frameDoc?.addEventListener('pointerdown', onFrame, true);
      } catch {
        frameDoc = null;
      }
    };
    attach();
    // The frame can be replaced by a retry; re-attach rather than go silent.
    const retry = window.setInterval(() => {
      try {
        const current = iframeRef.current?.contentDocument ?? null;
        if (current && current !== frameDoc) {
          frameDoc = current;
          frameDoc.addEventListener('pointerdown', onFrame, true);
        }
      } catch { /* cross-origin */ }
    }, 2000);

    /* State transitions that happen without a tap: focus, visibility, and the
       overlay appearing on its own. Sampled, never nudged. */
    let last = '';
    const watch = window.setInterval(() => {
      const s = read();
      const key = `${s.overlay}|${s.mainPaused}|${s.iframeFocused}|${s.hold}|${s.visibility}`;
      if (key === last) return;
      last = key;
      setRecords((prev) => prev.concat({
        at: Date.now() - startedAt.current,
        zone: 'host-other',
        point: { x: -1, y: -1 },
        canvasRect: null,
        path: [{ tag: 'state-change' }],
        before: s,
        after: s,
        outcome: 'unknown',
        hostFocused: document.hasFocus(),
      }).slice(-MAX_RECORDS));
    }, 500);

    return () => {
      disposed = true;
      document.removeEventListener('pointerdown', onHost, true);
      window.clearInterval(retry);
      window.clearInterval(watch);
      try { frameDoc?.removeEventListener('pointerdown', onFrame, true); } catch { /* frame gone */ }
    };
  }, [enabled, read, canvasRect, iframeRef]);

  const summary = useMemo(() => summarise(records.filter((r) => r.point.x >= 0)), [records]);

  const payload = useCallback(() => JSON.stringify({
    gameId,
    userAgent: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    visualViewport: window.visualViewport
      ? { w: Math.round(window.visualViewport.width), h: Math.round(window.visualViewport.height) }
      : null,
    summary,
    records,
  }, null, 2), [gameId, records, summary]);

  if (!enabled) return null;

  return (
    <div className={`diag-panel${open ? '' : ' is-min'}`} data-testid="resume-diagnostics">
      <div className="diag-head">
        <strong>Resume diagnostic</strong>
        <span className="diag-count">{summary.canvasTaps} canvas / {summary.taps} taps</span>
        <button type="button" onClick={() => setOpen((o) => !o)}>{open ? '–' : '+'}</button>
      </div>
      {open && (
        <>
          <p className="diag-verdict">{summary.verdict}</p>
          <ol className="diag-log">
            {records.slice(-12).map((r, i) => (
              <li key={`${r.at}-${i}`}>
                <code>
                  {String(Math.round(r.at / 100) / 10).padStart(5)}s {r.zone}
                  {r.point.x >= 0 ? ` (${r.point.x},${r.point.y})` : ''} → {r.outcome}
                  {` [overlay ${String(r.before.overlay)}→${String(r.after.overlay)}, focus ${String(r.before.iframeFocused)}, hold ${r.before.hold ? 'y' : 'n'}]`}
                </code>
              </li>
            ))}
          </ol>
          <div className="diag-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(payload());
                  setCopied('Copied');
                } catch {
                  setCopied('Copy blocked — use Download');
                }
                window.setTimeout(() => setCopied(''), 2500);
              }}
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([payload()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `resume-diagnostic-${gameId}.json`;
                a.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 2000);
              }}
            >
              Download
            </button>
            <button type="button" onClick={() => setRecords([])}>Clear</button>
            {copied && <span className="diag-copied">{copied}</span>}
          </div>
        </>
      )}
    </div>
  );
}
