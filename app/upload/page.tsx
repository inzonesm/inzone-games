'use client';

/* Upload page — ported 1:1 from inzone-games-upload/src/pages/Upload.jsx,
 * adapted to the merged Next.js app. The aesthetic is preserved verbatim
 * (same inline styles, same animations) so the merged hub + upload UI
 * share the studio's visual language. */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { BundleSpecs } from '@/components/BundleSpecs';
import { FirstUploadSteps } from '@/components/FirstUploadSteps';
import { GameMetaEditor } from '@/components/GameMetaEditor';
import { ServerDeployPanel } from '@/components/ServerDeployPanel';
import { Shell } from '@/components/Shell';
import {
  runUploadPipeline,
  listDeveloperHtmlGames,
  getExistingHtmlGame,
  type Engine,
  type PipelineResult,
} from '@/lib/upload-pipeline';

/** The existing game being updated, when the page is opened as /upload?update=<id>. */
interface UpdateTarget {
  id: string;
  name: string;
  description: string;
  engine: Engine;
  iconUrl: string;
  serverUrl: string;
  version: number;
}

// ──────────────────────────────────────────────────────────────────
// Styles (verbatim from the original Upload.jsx — kept inline so
// the studio's exact visual language survives the port)
// ──────────────────────────────────────────────────────────────────

const uploadStyles: Record<string, CSSProperties> = {
  pageHead: { textAlign: 'center', padding: '8px 0 4px' },
  crumb: { display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14, fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' },
  h1: { margin: 0, fontSize: 'clamp(36px, 5vw, 52px)', fontWeight: 500, letterSpacing: '-0.032em', lineHeight: 1 },
  lede: { margin: '16px auto 0', maxWidth: '48ch', color: 'var(--ink-2)', fontSize: 15, lineHeight: 1.5 },

  uploader: { position: 'relative', minHeight: 420, borderRadius: 24, background: 'linear-gradient(180deg, oklch(0.20 0.02 245 / 0.5), oklch(0.165 0.018 245 / 0.5))', border: '1px solid var(--line)', backdropFilter: 'blur(14px) saturate(160%)', overflow: 'hidden', boxShadow: '0 30px 80px -30px oklch(0.50 0.15 250 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.05)' },
  uploaderHover: { borderColor: 'var(--blue-2)', boxShadow: '0 30px 80px -30px oklch(0.55 0.18 240 / 0.6), inset 0 0 0 1px oklch(0.72 0.13 235 / 0.4)' },

  panel: { padding: '36px 36px 32px', minHeight: 420, display: 'flex', flexDirection: 'column' },

  drop: { flex: 1, border: '1px dashed oklch(0.55 0.12 220 / 0.35)', borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', textAlign: 'center', transition: 'border-color .25s, background .25s, box-shadow .25s', cursor: 'pointer', position: 'relative', overflow: 'hidden', animation: 'idle-glow 3.2s ease-in-out infinite' },
  dropHover: { borderColor: 'var(--blue-2)', borderStyle: 'solid', background: 'oklch(0.20 0.06 245 / 0.3)', boxShadow: 'inset 0 0 80px oklch(0.55 0.18 240 / 0.18), 0 0 60px -10px oklch(0.55 0.18 240 / 0.4)', animation: 'none' },
  dropGlyph: { width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, oklch(0.30 0.06 245 / 0.5), oklch(0.20 0.04 245 / 0.5))', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', marginBottom: 20, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.08)', color: 'var(--blue-1)' },
  dropTitle: { margin: 0, fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em' },
  dropHint: { marginTop: 10, fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.04em' },

  fileCard: { display: 'grid', gridTemplateColumns: '44px 1fr auto', gap: 14, alignItems: 'center', padding: '16px 18px', background: 'var(--bg-2)', borderRadius: 14, border: '1px solid var(--line)' },
  fileIco: { width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, oklch(0.40 0.10 250), oklch(0.30 0.08 250))', display: 'grid', placeItems: 'center', fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--blue-1)', letterSpacing: '0.05em' },
  cancelBtn: { width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--ink-3)', cursor: 'pointer', display: 'grid', placeItems: 'center' },

  barTrack: { height: 8, borderRadius: 4, background: 'oklch(0.20 0.02 245 / 0.6)', overflow: 'hidden', position: 'relative' },
  barFill: { height: '100%', background: 'linear-gradient(90deg, var(--blue-3), var(--blue-1))', borderRadius: 4, boxShadow: '0 0 12px oklch(0.72 0.13 235 / 0.6)', transition: 'width .3s ease' },

  parseHead: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, marginBottom: 4, borderBottom: '1px solid var(--line-soft)' },
  engine: { width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg, oklch(0.32 0.04 245), oklch(0.22 0.03 245))', display: 'grid', placeItems: 'center', fontFamily: "'Geist Mono', monospace", fontSize: 9, fontWeight: 600, color: 'var(--blue-1)', letterSpacing: '0.08em', border: '1px solid var(--line)' },
  badge: { marginLeft: 'auto', padding: '5px 10px', borderRadius: 999, background: 'oklch(0.55 0.18 240 / 0.18)', border: '1px solid oklch(0.72 0.13 235 / 0.3)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--blue-1)', letterSpacing: '0.06em' },

  step: { display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 14, alignItems: 'center', padding: '11px 0' },

  successHead: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid var(--line-soft)' },
  check: { width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, var(--pos), oklch(0.65 0.16 160))', display: 'grid', placeItems: 'center', boxShadow: '0 0 24px oklch(0.78 0.14 155 / 0.5), inset 0 1px 0 oklch(1 0 0 / 0.3)', position: 'relative' },

  urlCard: { background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 12, padding: '14px 16px', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center', marginBottom: 10 },
  copyBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--ink-2)', cursor: 'pointer', fontSize: 12.5, fontFamily: "'Geist Mono', monospace", letterSpacing: '0.04em' },

  errorHead: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid var(--line-soft)' },
  errorX: { width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, var(--neg), oklch(0.62 0.18 25))', display: 'grid', placeItems: 'center', boxShadow: '0 0 24px oklch(0.72 0.16 25 / 0.4)', position: 'relative', color: 'oklch(0.15 0.04 25)' },

  waitlistHead: { display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, marginBottom: 18, borderBottom: '1px solid var(--line-soft)' },
  waitlistGlyph: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--warm), oklch(0.65 0.16 50))', display: 'grid', placeItems: 'center', boxShadow: '0 0 24px oklch(0.78 0.14 75 / 0.35)', color: 'oklch(0.18 0.04 60)', fontSize: 22 },

  engineTabs: { display: 'inline-flex', gap: 4, margin: '22px auto 0', padding: 4, borderRadius: 999, background: 'oklch(0.18 0.02 245 / 0.5)', border: '1px solid var(--line)' },
  engineTab: { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 18px', borderRadius: 999, background: 'transparent', border: 0, color: 'var(--ink-3)', cursor: 'pointer', fontSize: 13, fontWeight: 500, letterSpacing: '-0.005em', transition: 'background .15s, color .15s' },
  engineTabActive: { background: 'var(--ink)', color: 'var(--bg)', boxShadow: '0 1px 0 oklch(1 0 0 / 0.05) inset' },
  engineTabSub: { fontFamily: "'Geist Mono', monospace", fontSize: 9.5, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.6 },
};

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const HTML_EXT_RE = /\.html?$/i;
const ZIP_EXT_RE = /\.zip$/i;
const UNITY_PKG_RE = /\.unitypackage$/i;
const OTHER_ENGINE_RE = /\.(uproject|uasset|godot|tres|tscn|pck|apk|ipa|exe)$/i;

function isHtmlGame(file: File | null | undefined): boolean {
  return !!file && HTML_EXT_RE.test(file.name);
}
function isHtmlBundle(file: File | null | undefined): boolean {
  return !!file && ZIP_EXT_RE.test(file.name);
}
function isUnityBuild(file: File | null | undefined): boolean {
  return !!file && (ZIP_EXT_RE.test(file.name) || UNITY_PKG_RE.test(file.name));
}
function isSupportedForEngine(file: File | null | undefined, engine: Engine): boolean {
  if (!file) return false;
  if (OTHER_ENGINE_RE.test(file.name)) return false;
  if (engine === 'unity') return isUnityBuild(file) && !isHtmlGame(file);
  return isHtmlGame(file) || isHtmlBundle(file);
}
function engineLabel(file: File | null | undefined, engine: Engine): string {
  if (engine === 'unity') return 'UNITY';
  if (isHtmlBundle(file)) return 'HTML5 · BUNDLE';
  return 'HTML5';
}

function bytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}

function titleFromFilename(filename: string): string {
  if (!filename) return '';
  return (
    filename
      .replace(/\.(zip|unitypackage|html?)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b(v\d+(\.\d+)*|mobile|build|release|final|prod)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' ') || 'Untitled Game'
  );
}

function placeholderDescription(title: string, engine: Engine, isBundle: boolean): string {
  if (engine === 'unity') {
    return `${title} — a Unity mobile build. Awaiting Unity runtime support to go live on the hub.`;
  }
  if (isBundle) {
    return `${title} — a multi-file HTML5 game. Backend will pull this from README.md (or description.md) at the bundle root.`;
  }
  return `${title} — a single-page HTML5 game.`;
}

interface ExtractedMeta {
  gameTitle: string;
  iconPreviewUrl: string;
  description: string;
  iconFound: boolean;
  descriptionFound: boolean;
  engine: Engine;
  isBundle: boolean;
  entryPath: string | null;
}

function mockExtractMetadata(file: File, engine: Engine): ExtractedMeta {
  const title = titleFromFilename(file.name);
  const bundle = engine === 'html5' && isHtmlBundle(file);
  return {
    gameTitle: title,
    iconPreviewUrl: 'assets/logo.jpg',
    description: placeholderDescription(title, engine, bundle),
    iconFound: false,
    descriptionFound: false,
    engine,
    isBundle: bundle,
    entryPath: bundle ? null : engine === 'unity' ? file?.name : file?.name || 'index.html',
  };
}

type UploadState = 'idle' | 'hover' | 'uploading' | 'parsing' | 'success' | 'error' | 'waitlist';

interface UIResult extends PipelineResult {
  gameId: string;
}

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const [engine, setEngine] = useState<Engine>('html5');
  const [state, setState] = useState<UploadState>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number>(0);
  const [result, setResult] = useState<UIResult | null>(null);
  const [extracted, setExtracted] = useState<ExtractedMeta | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState<string>('');
  const [waitlistEngine, setWaitlistEngine] = useState<string>('Unreal');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [parseStep, setParseStep] = useState<number>(0);
  const [iconFile] = useState<File | null>(null); // separate icon picker not exposed yet
  // Optional multiplayer server endpoint (wss://…). Set this when the game
  // needs a backend; the iframe passes it to the client as ?serverUrl=…
  const [serverUrl, setServerUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [hasGames, setHasGames] = useState<boolean>(false);

  // Update mode: /upload?update=<gameId> rebinds the dropzone to an existing
  // game so a dropped build replaces that game's live build (new version) instead
  // of creating a new game. `updateTarget` is the game being updated; while it's
  // resolving (`updateChecking`) we hold off so we don't flash the create copy.
  const [updateTarget, setUpdateTarget] = useState<UpdateTarget | null>(null);
  const [updateChecking, setUpdateChecking] = useState<boolean>(true);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Anonymous → /login. Wait for auth to finish loading before deciding so we
  // don't flash-redirect a signed-in user mid-bootstrap.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  // First-time developer flow: latched once we've confirmed the dev has no
  // games yet. Drives the four-step onboarding strip above the portal. Latched
  // (rather than derived from hasGames) so the strip stays visible — with steps
  // 3–4 flipped green — through the success screen of that very first upload.
  const [firstUploadFlow, setFirstUploadFlow] = useState<boolean>(false);

  // Load developer's existing games — drives the "first game" vs "another build"
  // copy at the top of the page.
  useEffect(() => {
    if (!user?.uid) return;
    listDeveloperHtmlGames(user.uid).then((list) => {
      setHasGames(list.length > 0);
      if (list.length === 0) setFirstUploadFlow(true);
    });
  }, [user?.uid]);

  // Resolve ?update=<gameId> against the signed-in user. Read straight from the
  // URL (rather than useSearchParams) so the page doesn't need a Suspense
  // boundary. Engine, server URL, name and description are inherited from the
  // existing game so an update only swaps the build.
  useEffect(() => {
    if (!user?.uid) return;
    const id = new URLSearchParams(window.location.search).get('update');
    if (!id) { setUpdateChecking(false); return; }
    let cancelled = false;
    setUpdateChecking(true);
    getExistingHtmlGame(id).then((g) => {
      if (cancelled) return;
      if (!g) {
        setUpdateError('That game no longer exists.');
      } else if (g.uploaderId && g.uploaderId !== user.uid) {
        setUpdateError('You can only update games you uploaded.');
      } else {
        const eng: Engine = g.engine === 'unity' ? 'unity' : 'html5';
        setEngine(eng);
        setServerUrl(((g.serverUrl as string) || '').trim());
        setUpdateTarget({
          id: g.id as string,
          name: ((g.name as string) || (g.id as string)).trim(),
          description: ((g.description as string) || '').trim(),
          engine: eng,
          iconUrl: ((g.iconUrl as string) || '').trim(),
          serverUrl: ((g.serverUrl as string) || '').trim(),
          version: Number(g.version) || 1,
        });
      }
      setUpdateChecking(false);
    }).catch(() => {
      if (cancelled) return;
      setUpdateError('Could not load that game to update.');
      setUpdateChecking(false);
    });
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Reset everything when returning to idle
  useEffect(() => {
    if (state === 'idle') {
      setPercent(0);
      setFile(null);
      setResult(null);
      setExtracted(null);
      setParseStep(0);
    }
  }, [state]);

  // Real upload via Firebase Storage (engineOverride is set when auto-switching
  // because setEngine hasn't flushed yet at the call site).
  const startUpload = async (chosen: File, engineOverride?: Engine) => {
    const updating = !!updateTarget;
    // In update mode the engine is locked to the existing game and the title /
    // description are inherited so the build swap doesn't clobber curated metadata.
    const useEngine: Engine = updating ? updateTarget!.engine : engineOverride || engine;
    setFile(chosen);
    setState('uploading');
    setPercent(0);

    const meta = mockExtractMetadata(chosen, useEngine);
    const title = updating ? updateTarget!.name : meta.gameTitle;
    const description = updating ? updateTarget!.description : meta.description;
    setExtracted({
      ...meta,
      gameTitle: title,
      description,
      iconFound: !!iconFile,
      descriptionFound: useEngine === 'html5' && isHtmlGame(chosen),
    });

    try {
      const pipelineResult = await runUploadPipeline({
        htmlFile: chosen,
        iconFile: iconFile || null,
        gameTitle: title,
        description,
        uploaderId: user?.uid || 'anonymous',
        uploaderName: user?.displayName || user?.email?.split('@')[0] || 'Developer',
        gameId: updating ? updateTarget!.id : undefined,
        engine: useEngine,
        serverUrl: serverUrl.trim(),
        onProgress: (pct) => {
          setPercent(pct);
          if (pct >= 100) setTimeout(() => setState('parsing'), 300);
        },
        onStep: (stepIdx, stepMeta) => {
          setParseStep(stepIdx);
          if (stepMeta && typeof stepMeta.iconFound === 'boolean') {
            setExtracted((m) => (m ? { ...m, iconFound: stepMeta.iconFound! } : m));
          }
          if (stepMeta && typeof stepMeta.descriptionFound === 'boolean') {
            setExtracted((m) => (m ? { ...m, descriptionFound: stepMeta.descriptionFound! } : m));
          }
          if (stepMeta && stepMeta.entryPath) {
            const ep = stepMeta.entryPath;
            setExtracted((m) => (m ? { ...m, entryPath: ep } : m));
          }
        },
      });

      setParseStep(6);
      await new Promise((r) => setTimeout(r, 300));
      setResult({ ...pipelineResult, gameId: pipelineResult.slug });
      setState('success');
      setHasGames(true);
    } catch (err) {
      console.error('Upload pipeline error:', err);
      setErrorMsg(err instanceof Error ? err.message : 'UPLOAD_FAILED');
      setState('error');
    }
  };

  const handleFile = (chosen: File | null | undefined) => {
    if (!chosen) return;
    // Don't act on a drop while we're still resolving ?update=, or if that id was
    // bad — otherwise an intended update could silently create a new game.
    if (updateChecking || updateError) return;
    // Update mode: the engine is fixed to the existing game. Reject a build for a
    // different engine rather than auto-switching or creating a new game.
    if (updateTarget) {
      if (isSupportedForEngine(chosen, updateTarget.engine)) {
        void startUpload(chosen);
      } else {
        setErrorMsg(`ENGINE_LOCKED: ${updateTarget.name} is a ${updateTarget.engine.toUpperCase()} game — drop a ${updateTarget.engine.toUpperCase()} build to update it.`);
        setState('error');
      }
      return;
    }
    if (isSupportedForEngine(chosen, engine)) {
      void startUpload(chosen);
      return;
    }
    const otherEngine: Engine = engine === 'html5' ? 'unity' : 'html5';
    if (isSupportedForEngine(chosen, otherEngine)) {
      setEngine(otherEngine);
      void startUpload(chosen, otherEngine);
      return;
    }
    setState('waitlist');
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setState((s) => (s === 'hover' ? 'idle' : s));
    const f = e.dataTransfer.files?.[0];
    handleFile(f);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (state === 'idle') setState('hover');
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (state === 'hover') setState('idle');
  };

  const isDropState = state === 'idle' || state === 'hover';
  const updating = !!updateTarget;
  const nextVersion = updateTarget ? updateTarget.version + 1 : 0;
  const gradient = { background: 'linear-gradient(135deg, var(--blue-1), var(--blue-3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as const;

  return (
    <Shell>
      <main className="stage" style={{ paddingTop: 48, paddingBottom: 80 }}>
        <div style={uploadStyles.pageHead}>
          <div style={uploadStyles.crumb}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: updateError ? 'var(--neg)' : 'var(--pos)', boxShadow: `0 0 8px ${updateError ? 'var(--neg)' : 'var(--pos)'}` }} />
            {updateError ? 'Update · unavailable' : updating ? `Update · ${updateTarget!.name}` : hasGames ? 'Step 1 · Drop a build' : 'First game · Welcome to InZone'}
          </div>
          <h1 style={uploadStyles.h1}>
            {updateError ? (
              <>Can&apos;t load that game.</>
            ) : updating ? (
              <>Ship an update.{' '}<span style={gradient}>Now serving v{nextVersion}.</span></>
            ) : (
              <>Ship a build.{' '}<span style={gradient}>It&apos;s already live.</span></>
            )}
          </h1>
          <p style={uploadStyles.lede}>
            {updateError
              ? `${updateError} Head back to My Games to pick a game to update.`
              : updating
                ? `Drop a new build to replace the live one. Your URL, name, description, icon and players stay put — only the files change. This ships v${nextVersion}; you can roll back anytime from My Games.`
                : engine === 'unity'
                  ? hasGames
                    ? 'Drop your Unity mobile build. We register it for distribution once the Unity runtime is wired into the hub.'
                    : 'Drop your Unity mobile build to unlock the dashboard, endpoints, players, and payouts.'
                  : hasGames
                    ? 'Drop your HTML5 game — a single .html file or a .zip bundle with index.html + assets. We parse it, wire the social layer, and return a shareable URL.'
                    : "Drop your HTML5 game (.html or .zip bundle) to unlock the dashboard, endpoints, players, and payouts. We'll parse it, wire the social layer, and hand back a shareable URL."}
          </p>
          {(updating || updateError) && (
            <div style={{ marginTop: 12 }}>
              <Link href="/manage" className="btn-ghost" style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}>← My Games</Link>
            </div>
          )}

          {isDropState && !updating && !updateError && (
            <div role="tablist" aria-label="Engine" style={uploadStyles.engineTabs}>
              {[
                { key: 'html5' as const, label: 'HTML5', sub: 'live' },
                { key: 'unity' as const, label: 'Unity', sub: 'runtime pending' },
              ].map((opt) => {
                const active = engine === opt.key;
                return (
                  <button
                    key={opt.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setEngine(opt.key)}
                    style={active ? { ...uploadStyles.engineTab, ...uploadStyles.engineTabActive } : uploadStyles.engineTab}
                  >
                    <span>{opt.label}</span>
                    <span style={uploadStyles.engineTabSub}>{opt.sub}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Four-step onboarding strip — first-time developers only. Returning
            devs (hasGames) and update mode get the standard portal untouched.
            Kept visible through the first upload's success screen so the dev
            sees steps 3–4 flip green; disappears once they have a game. */}
        {firstUploadFlow && !updating && !updateChecking && !updateError && (!hasGames || state === 'success') && (
          <FirstUploadSteps uploaded={state === 'success'} />
        )}

        <div
          style={state === 'hover' ? { ...uploadStyles.uploader, ...uploadStyles.uploaderHover } : uploadStyles.uploader}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {/* IDLE / HOVER share the drop zone */}
          {isDropState && (
            <div style={uploadStyles.panel}>
              <div
                style={state === 'hover' ? { ...uploadStyles.drop, ...uploadStyles.dropHover } : uploadStyles.drop}
                onClick={() => fileInputRef.current?.click()}
              >
                {state === 'hover' && <span className="drop-ring" aria-hidden="true" />}

                <div style={uploadStyles.dropGlyph}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v13" /><path d="m6 9 6-6 6 6" /><path d="M5 21h14" />
                  </svg>
                </div>
                <h2 style={uploadStyles.dropTitle}>
                  {state === 'hover'
                    ? 'Release to upload'
                    : engine === 'unity'
                      ? 'Drop your Unity mobile build'
                      : 'Drop your HTML5 game'}
                </h2>
                <div style={uploadStyles.dropHint}>
                  {engine === 'unity' ? '.unitypackage · .zip · up to 2GB' : '.html · .zip bundle · up to 2GB'}
                </div>
                {state === 'idle' && (
                  <>
                    <div style={{ marginTop: 22, fontSize: 13, color: 'var(--ink-3)' }}>— or —</div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      style={{ marginTop: 12, height: 40, padding: '0 22px', borderRadius: 999, fontSize: 14, fontWeight: 500, background: 'var(--ink)', color: 'var(--bg)', cursor: 'pointer', border: 0 }}
                    >Browse files</button>
                    <div style={{ marginTop: 28, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                      {(engine === 'unity'
                        ? ['Unity 2021 LTS+', 'iOS · Android', 'Runtime pending']
                        : ['Single-file .html', 'Multi-file .zip bundle', 'Auto entry detect']
                      ).map((t) => (
                        <span key={t} style={{ padding: '5px 10px', borderRadius: 999, background: 'oklch(0.20 0.02 245 / 0.4)', border: '1px solid var(--line-soft)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{t}</span>
                      ))}
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={engine === 'unity' ? '.zip,.unitypackage' : '.zip,.html,.htm'}
                  style={{ display: 'none' }}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>
            </div>
          )}

          {/* UPLOADING */}
          {state === 'uploading' && file && (
            <div style={uploadStyles.panel}>
              <div style={uploadStyles.fileCard}>
                <span style={uploadStyles.fileIco}>{engineLabel(file, engine)}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{file.name}</div>
                  <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                    {bytes(file.size)} · {engine === 'html5' && isHtmlBundle(file) ? 'extracting + uploading…' : 'uploading…'}
                  </div>
                </div>
                <button style={uploadStyles.cancelBtn} onClick={() => setState('idle')} aria-label="Cancel">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12" /><path d="M6 18 18 6" />
                  </svg>
                </button>
              </div>

              <div style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>Uploading to storage</span>
                  <span style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', fontFeatureSettings: "'tnum'" }}>{Math.round(percent)}%</span>
                </div>
                <div style={uploadStyles.barTrack}>
                  <div style={{ ...uploadStyles.barFill, width: `${percent}%` }} />
                </div>
                <div style={{ marginTop: 14, display: 'flex', gap: 24, flexWrap: 'wrap', fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--ink-3)', letterSpacing: '0.02em' }}>
                  <span><b style={{ color: 'var(--ink)', fontWeight: 500 }}>{bytes((file.size * percent) / 100)}</b> / {bytes(file.size)}</span>
                </div>
              </div>

              <div style={{ marginTop: 28, padding: 12, borderRadius: 10, border: '1px dashed var(--line)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
                {engine === 'unity'
                  ? `Uploading Unity build to gs://inzone-html/${result?.slug || '<slug>'}.* — the file is stored as-is. Playback awaits the Unity runtime.`
                  : engine === 'html5' && isHtmlBundle(file)
                    ? `Extracting bundle and uploading every file to gs://inzone-html/${result?.slug || '<slug>'}/ — relative paths in your index.html resolve to siblings.`
                    : 'Uploading the .html file to Firebase Storage. The page is served from a tokenized download URL.'}
              </div>
            </div>
          )}

          {/* PARSING */}
          {state === 'parsing' && (
            <div style={uploadStyles.panel}>
              <div style={uploadStyles.parseHead}>
                <div style={uploadStyles.engine}>{engineLabel(file, engine)}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{file?.name || 'build'}</div>
                  <div style={{ marginTop: 3, fontFamily: "'Geist Mono', monospace", fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                    {engine === 'unity' ? 'Unity build' : isHtmlBundle(file) ? 'HTML5 bundle' : 'HTML5 page'}
                    {engine !== 'unity' && extracted?.entryPath ? ` · entry ${extracted.entryPath}` : ''}
                    {file ? ` · ${bytes(file.size)}` : ''}
                  </div>
                </div>
                <span style={uploadStyles.badge}>{engine === 'unity' ? 'REGISTERING' : 'PARSING'}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 14 }}>
                {(engine === 'unity'
                  ? [
                      { label: 'Upload received', meta: file ? bytes(file.size) : '' },
                      { label: 'Title from bundle filename', meta: extracted?.gameTitle || '—' },
                      { label: 'Uploading Unity binary to storage', meta: parseStep > 2 ? 'done' : '…' },
                      { label: 'Reading optional icon', meta: extracted?.iconFound ? 'found' : parseStep > 3 ? 'none' : '…' },
                      { label: 'Registering with Firestore (pending runtime)', meta: parseStep >= 5 ? 'done' : '—' },
                    ]
                  : [
                      { label: 'Upload received', meta: file ? bytes(file.size) : '' },
                      { label: 'Title from bundle filename', meta: extracted?.gameTitle || '—' },
                      { label: isHtmlBundle(file) ? 'Reading logo.{jpg,png,…} from bundle' : 'Reading icon (from picker)', meta: extracted?.iconFound ? 'found' : parseStep > 2 ? 'not found' : '…' },
                      { label: isHtmlBundle(file) ? 'Reading README.md from bundle' : 'Description from page', meta: extracted?.descriptionFound ? 'found' : parseStep > 3 ? 'not found' : '…' },
                      { label: 'Registering with Firestore', meta: parseStep >= 5 ? 'done' : '—' },
                    ]
                ).map((s, i) => {
                  const isDone = i < parseStep;
                  const isActive = i === parseStep;
                  const dotBg = isDone ? 'var(--pos)' : isActive ? 'oklch(0.20 0.06 240 / 0.5)' : 'var(--bg-3)';
                  const dotBorder = isDone ? 'var(--pos)' : isActive ? 'var(--blue-1)' : 'var(--line)';
                  return (
                    <div key={s.label} style={uploadStyles.step}>
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: dotBg, border: `1px solid ${dotBorder}`, display: 'grid', placeItems: 'center', boxShadow: isDone ? '0 0 12px oklch(0.78 0.14 155 / 0.5)' : 'none' }}>
                        {isDone && <span style={{ width: 7, height: 4, borderLeft: '1.5px solid oklch(0.18 0.05 155)', borderBottom: '1.5px solid oklch(0.18 0.05 155)', transform: 'rotate(-45deg) translate(1px, -1px)' }} />}
                        {isActive && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue-1)', animation: 'pulse 1.2s ease-in-out infinite' }} />}
                      </span>
                      <span style={{ fontSize: 13.5, color: i <= parseStep ? 'var(--ink)' : 'var(--ink-4)' }}>{s.label}</span>
                      <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>{s.meta}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SUCCESS */}
          {state === 'success' && result && extracted && (
            <div style={uploadStyles.panel}>
              <div style={uploadStyles.successHead}>
                <div style={uploadStyles.check}>
                  <span style={{ width: 14, height: 7, borderLeft: '2px solid oklch(0.15 0.04 155)', borderBottom: '2px solid oklch(0.15 0.04 155)', transform: 'rotate(-45deg) translate(1px, -2px)' }} />
                  <span className="sparkle s1" aria-hidden="true" />
                  <span className="sparkle s2" aria-hidden="true" />
                  <span className="sparkle s3" aria-hidden="true" />
                  <span className="sparkle s4" aria-hidden="true" />
                  <span className="sparkle s5" aria-hidden="true" />
                  <span className="sparkle s6" aria-hidden="true" />
                </div>
                <div>
                  <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.018em' }}>
                    {result.isUpdate
                      ? `${extracted.gameTitle} updated.`
                      : result.engine === 'unity'
                        ? `${extracted.gameTitle} is registered.`
                        : `${extracted.gameTitle} is live.`}
                  </div>
                  <div style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 13.5 }}>
                    {result.isUpdate
                      ? `Now serving v${result.version} · live URL unchanged · roll back anytime from My Games`
                      : result.engine === 'unity'
                        ? 'Unity build stored · awaiting runtime to go live on the hub'
                        : 'Build registered · social loop wired · ready to share'}
                  </div>
                </div>
              </div>

              <div style={uploadStyles.urlCard}>
                <div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
                    {result.engine === 'unity' ? 'Storage URL' : 'Live URL'}
                  </div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: 'var(--blue-1)', wordBreak: 'break-all' }}>{result.liveUrl}</div>
                </div>
                <button style={uploadStyles.copyBtn} onClick={() => navigator.clipboard?.writeText(result.liveUrl)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                  Copy
                </button>
              </div>

              <div style={uploadStyles.urlCard}>
                <div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>Game key · <span style={{ color: 'var(--warm)' }}>save this — shown once</span></div>
                  <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: 'var(--blue-1)', wordBreak: 'break-all' }}>{result.gameKey}</div>
                </div>
                <button style={uploadStyles.copyBtn} onClick={() => navigator.clipboard?.writeText(result.gameKey)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
                  </svg>
                  Copy
                </button>
              </div>

              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--line-soft)' }}>
                <div style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>
                  {result.engine === 'unity' ? 'Your build details' : 'Your game details'}
                </div>
                <p style={{ margin: '0 0 14px', color: 'var(--ink-3)', fontSize: 12.5, lineHeight: 1.5 }}>
                  We pulled these from your {result.engine === 'unity' ? 'build' : 'bundle'}. Tweak the image, name, description or server URL below — it saves to your live game without a re-upload.
                </p>

                {(extracted.iconFound || extracted.descriptionFound || result.bundleStats) && (
                  <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {extracted.iconFound && (
                      <span style={{ padding: '4px 10px', borderRadius: 999, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--pos)', letterSpacing: '0.06em' }}>icon ✓</span>
                    )}
                    {extracted.descriptionFound && (
                      <span style={{ padding: '4px 10px', borderRadius: 999, background: 'oklch(0.78 0.14 155 / 0.15)', border: '1px solid oklch(0.78 0.14 155 / 0.3)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--pos)', letterSpacing: '0.06em' }}>README.md ✓</span>
                    )}
                    {result.bundleStats && (
                      <span style={{ padding: '4px 10px', borderRadius: 999, background: 'oklch(0.20 0.06 245 / 0.4)', border: '1px solid var(--line)', fontFamily: "'Geist Mono', monospace", fontSize: 10.5, color: 'var(--blue-1)', letterSpacing: '0.06em' }}>{result.bundleStats.fileCount} files · {result.bundleStats.entryPath}</span>
                    )}
                  </div>
                )}

                <GameMetaEditor
                  gameId={result.slug}
                  idPrefix={`new-${result.slug}`}
                  initial={{ name: extracted.gameTitle, description: extracted.description, serverUrl, iconUrl: result.iconUrl }}
                  saveLabel="Save details"
                  note={
                    <p style={{ margin: 0, fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', lineHeight: 1.5 }}>
                      Saved straight to your live game — the URL and build don’t change. You can also edit later from My Games.
                    </p>
                  }
                  onSaved={(patch) => {
                    setExtracted((m) => (m ? { ...m, gameTitle: patch.name, description: patch.description } : m));
                    setResult((r) => (r ? { ...r, iconUrl: patch.iconUrl ?? r.iconUrl } : r));
                    setServerUrl(patch.serverUrl);
                  }}
                />
              </div>

              {/* Multiplayer-server deploy. Skipped for Unity uploads (no
                  runtime yet) so we don't tempt devs into wiring a server
                  for a game that can't launch. */}
              {result.engine === 'html5' && (
                <ServerDeployPanel
                  gameSlug={result.slug}
                  initialServerUrl={serverUrl}
                />
              )}

              <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Link href={`/games/${encodeURIComponent(result.slug)}`} className="btn-primary">Play it now <span>→</span></Link>
                <Link href="/manage" className="btn-ghost">Manage my games</Link>
                <Link href="/games" className="btn-ghost">Back to hub</Link>
                <button className="btn-ghost" onClick={() => setState('idle')}>Upload another</button>
              </div>
            </div>
          )}

          {/* ERROR */}
          {state === 'error' && (
            <div style={uploadStyles.panel}>
              <div style={uploadStyles.errorHead}>
                <div style={uploadStyles.errorX}>
                  <span style={{ position: 'absolute', width: 16, height: 2, background: 'oklch(0.15 0.04 25)', borderRadius: 1, transform: 'rotate(45deg)' }} />
                  <span style={{ position: 'absolute', width: 16, height: 2, background: 'oklch(0.15 0.04 25)', borderRadius: 1, transform: 'rotate(-45deg)' }} />
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.018em' }}>Upload failed</div>
                  <div style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 13.5 }}>
                    {errorMsg && errorMsg.startsWith('NO_ENTRY_POINT')
                      ? "We couldn't find an index.html in your bundle."
                      : errorMsg && errorMsg.startsWith('EMPTY_BUNDLE')
                        ? 'Your zip was empty (or only contained system junk).'
                        : 'We hit an error uploading or extracting the bundle.'}
                  </div>
                </div>
              </div>
              <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.55, maxWidth: '56ch' }}>
                {errorMsg && errorMsg.startsWith('NO_ENTRY_POINT') ? (
                  <>Your bundle needs an <b>index.html</b> — either at the root, under <b>src/index.html</b>, or anywhere one level deeper. Re-zip with the entry point at one of those locations.</>
                ) : errorMsg && errorMsg.startsWith('EMPTY_BUNDLE') ? (
                  <>Make sure you zipped the contents of your game folder (or the folder itself). We strip macOS/Git junk and need at least one real file.</>
                ) : (
                  <>Check your network connection and try again. If this keeps happening, your bundle may be too large for the current Firebase Storage rules (2GB cap by default).</>
                )}
              </p>
              <span style={{ display: 'inline-block', marginTop: 14, padding: '6px 10px', borderRadius: 6, background: 'oklch(0.20 0.02 245 / 0.6)', fontFamily: "'Geist Mono', monospace", fontSize: 11.5, color: 'var(--neg)', letterSpacing: '0.04em', alignSelf: 'flex-start' }}>{errorMsg || 'PARSE_FAILED'}</span>
              <div style={{ marginTop: 22, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn-primary" onClick={() => setState('idle')}>Try another file</button>
              </div>
            </div>
          )}

          {/* WAITLIST */}
          {state === 'waitlist' && (
            <div style={uploadStyles.panel}>
              <div style={uploadStyles.waitlistHead}>
                <div style={uploadStyles.waitlistGlyph}>◆</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.018em' }}>We support HTML5 and Unity today.</div>
                  <div style={{ marginTop: 4, color: 'var(--ink-3)', fontSize: 13.5 }}>Your build looks like it&apos;s another engine — leave a note and we&apos;ll ping you when it&apos;s supported.</div>
                </div>
              </div>
              <p style={{ color: 'var(--ink-2)', fontSize: 14.5, lineHeight: 1.55, maxWidth: '52ch', margin: '0 0 18px' }}>
                We currently accept <b style={{ color: 'var(--ink)' }}>HTML5</b> (single-file .html or multi-file .zip bundle) and <b style={{ color: 'var(--ink)' }}>Unity</b> (.zip / .unitypackage, runtime pending). <b style={{ color: 'var(--ink)' }}>Unreal</b> and <b style={{ color: 'var(--ink)' }}>Godot</b> are on the roadmap. Tell us which engine you&apos;re shipping and we&apos;ll prioritize.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {['Unreal', 'Godot', 'WebGL', 'Other'].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setWaitlistEngine(opt)}
                    style={{
                      height: 32, padding: '0 12px', borderRadius: 8,
                      background: waitlistEngine === opt ? 'oklch(0.30 0.08 245 / 0.5)' : 'var(--bg-2)',
                      border: `1px solid ${waitlistEngine === opt ? 'var(--blue-2)' : 'var(--line)'}`,
                      color: waitlistEngine === opt ? 'var(--ink)' : 'var(--ink-2)',
                      fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em', cursor: 'pointer',
                    }}
                  >{opt}</button>
                ))}
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); alert(`Added to waitlist for ${waitlistEngine}: ${waitlistEmail}`); setState('idle'); }}
                style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}
              >
                <input
                  className="input"
                  type="email"
                  placeholder="dev@yourstudio.com"
                  value={waitlistEmail}
                  onChange={(e) => setWaitlistEmail(e.target.value)}
                  required
                />
                <button className="btn-primary" type="submit">Join waitlist</button>
              </form>
              <div style={{ marginTop: 16 }}>
                <button className="btn-ghost" onClick={() => setState('idle')} style={{ height: 36 }}>← Back</button>
              </div>
            </div>
          )}
        </div>

        {(state === 'idle' || state === 'hover') && <BundleSpecs engine={engine} />}

        {/* Optional multiplayer server URL. Hidden during upload/parse/success
            so it doesn't compete with progress states; shown again on retry. */}
        {(state === 'idle' || state === 'hover') && (
          <section style={{ marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
              <span
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                }}
              >
                Multiplayer server · optional
              </span>
              <span style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
              <span
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10,
                  letterSpacing: '0.04em',
                  color: 'var(--ink-4)',
                }}
              >
                Leave blank for single-player
              </span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="server-url">WebSocket endpoint</label>
              <input
                id="server-url"
                className="input"
                type="url"
                inputMode="url"
                placeholder="wss://your-game.fly.dev"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p
                style={{
                  margin: '6px 0 0',
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10.5,
                  color: 'var(--ink-4)',
                  letterSpacing: '0.04em',
                  lineHeight: 1.5,
                }}
              >
                If your game has a backend (matchmaking, persistent state, multiplayer),
                paste its wss:// URL here. We&apos;ll pass it to your client iframe as
                <code style={{ padding: '2px 6px', borderRadius: 4, background: 'var(--bg-2)', color: 'var(--blue-1)', margin: '0 4px' }}>?serverUrl=…</code>
                so your client can dial in.
              </p>
            </div>
          </section>
        )}

        <div className="api-note">
          <b>Wired to →</b>
          <code>gs://inzone-html</code>
          <span style={{ color: 'var(--ink-4)' }}>· direct Firebase Storage + Firestore writes (no backend in dev)</span>
        </div>

        <style>{`
          @keyframes pulse { 0%, 100% { opacity: 0.4; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1); } }

          @keyframes idle-glow {
            0%, 100% { border-color: oklch(0.55 0.12 220 / 0.35); box-shadow: inset 0 0 0 0 oklch(0.72 0.13 235 / 0); }
            50%      { border-color: oklch(0.65 0.13 220 / 0.5); box-shadow: inset 0 0 40px oklch(0.72 0.13 235 / 0.06); }
          }

          .drop-ring {
            position: absolute; left: 50%; top: 50%;
            width: 60px; height: 60px;
            margin-left: -30px; margin-top: -30px;
            border-radius: 50%;
            border: 2px solid oklch(0.72 0.13 235);
            opacity: 0;
            pointer-events: none;
            animation: ring-snap 1.6s linear infinite;
          }
          @keyframes ring-snap {
            0%   { opacity: 0; transform: scale(0.4); border-width: 3px; }
            20%  { opacity: 0.9; transform: scale(1); border-width: 2px; }
            70%  { opacity: 0; transform: scale(5); border-width: 0.5px; }
            100% { opacity: 0; transform: scale(5); }
          }

          .sparkle {
            position: absolute; left: 50%; top: 50%;
            width: 4px; height: 4px; border-radius: 50%;
            background: oklch(0.85 0.14 220);
            box-shadow: 0 0 10px oklch(0.85 0.14 220);
            opacity: 0;
            pointer-events: none;
            animation: sparkle-out 1.4s ease-out forwards;
          }
          .sparkle.s1 { --dx: -36px; --dy: -28px; animation-delay: 0.05s; }
          .sparkle.s2 { --dx:  36px; --dy: -28px; animation-delay: 0.10s; background: var(--warm); box-shadow: 0 0 10px var(--warm); }
          .sparkle.s3 { --dx: -42px; --dy:   4px; animation-delay: 0.15s; }
          .sparkle.s4 { --dx:  42px; --dy:   4px; animation-delay: 0.20s; background: var(--pink); box-shadow: 0 0 10px var(--pink); }
          .sparkle.s5 { --dx: -28px; --dy:  30px; animation-delay: 0.25s; }
          .sparkle.s6 { --dx:  28px; --dy:  30px; animation-delay: 0.30s; }
          @keyframes sparkle-out {
            0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
            25%  { opacity: 1; transform: translate(calc(-50% + var(--dx) * 0.4), calc(-50% + var(--dy) * 0.4)) scale(1.2); }
            75%  { opacity: 0.5; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(0.9); }
            100% { opacity: 0; transform: translate(calc(-50% + var(--dx) * 1.3), calc(-50% + var(--dy) * 1.3)) scale(0.4); }
          }
        `}</style>
      </main>
    </Shell>
  );
}
