/* Upload page — checklist-driven upload flow for Unity + HTML games.
 *
 * Flow:  idle → review (checklist) → uploading → parsing → success
 *
 * Accepts:
 *   - ZIP files    → scanned with JSZip for game, logo, description
 *   - Folders      → scanned via webkitGetAsEntry for the same
 *   - Individual   → categorised and merged into the checklist
 *
 * The three required files:
 *   1. Game file   (.html, .zip, .unitypackage)
 *   2. Logo        (.jpg, .jpeg, .png)
 *   3. Description (.md, .docx, .pdf, .txt)
 *
 * All three must be present before "Submit" is enabled. */

const { useState, useEffect, useRef } = React;

/* ── Style tokens ─────────────────────────────────────────────── */
const uploadStyles = {
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

  /* Review checklist styles */
  clRow: { display: 'grid', gridTemplateColumns: '28px 1fr auto', gap: 12, alignItems: 'center', padding: '14px 16px', borderRadius: 12, transition: 'background .2s, border-color .2s' },
  clDot: { width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', transition: 'background .2s, border-color .2s, box-shadow .2s' },
  clCheck: { width: 10, height: 5, borderLeft: '1.5px solid oklch(0.18 0.05 155)', borderBottom: '1.5px solid oklch(0.18 0.05 155)', transform: 'rotate(-45deg) translate(1px, -1px)' },
  clBrowse: { height: 30, padding: '0 14px', borderRadius: 8, background: 'oklch(0.25 0.04 245 / 0.5)', border: '1px solid var(--line)', color: 'var(--blue-1)', cursor: 'pointer', fontFamily: "'Geist Mono', monospace", fontSize: 11, letterSpacing: '0.04em' },
  clClear: { width: 28, height: 28, borderRadius: 8, background: 'transparent', border: '1px solid var(--line-soft)', color: 'var(--ink-4)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'border-color .2s, color .2s' },
  clTitle: { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16, marginBottom: 20 },
  clInput: { height: 42, padding: '0 14px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 15, fontWeight: 500, letterSpacing: '-0.01em', outline: 'none', transition: 'border-color .2s' },
};

/* ── File-type detection ──────────────────────────────────────── */
const HTML_EXT_RE = /\.html?$/i;
const UNITY_EXT_RE = /\.(zip|unitypackage)$/i;
const NON_UNITY_EXT_RE = /\.(uproject|uasset|wasm|godot|tres|tscn|pck)$/i;
const LOGO_EXT_RE = /\.(jpg|jpeg|png)$/i;
const DESC_EXT_RE = /\.(md|docx|pdf|txt)$/i;

function isHtmlGame(file) { return file && HTML_EXT_RE.test(file.name); }
function isUnityBuild(file) {
  if (!file) return false;
  if (NON_UNITY_EXT_RE.test(file.name)) return false;
  return UNITY_EXT_RE.test(file.name);
}
function isSupportedBuild(file) { return isHtmlGame(file) || isUnityBuild(file); }
function isLogoFile(file) { return file && LOGO_EXT_RE.test(file.name); }
function isDescFile(file) { return file && DESC_EXT_RE.test(file.name); }

function categorizeFile(file) {
  if (!file) return null;
  if (isHtmlGame(file)) return 'game';
  if (isUnityBuild(file)) return 'game';
  if (isLogoFile(file)) return 'logo';
  if (isDescFile(file)) return 'desc';
  return null;
}

function bytes(n) {
  if (n > 1e9) return (n / 1e9).toFixed(1) + ' GB';
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n > 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}

function titleFromFilename(filename) {
  if (!filename) return '';
  return filename
    .replace(/\.(zip|unitypackage|html?)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b(v\d+(\.\d+)*|mobile|build|release|final|prod)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ') || 'Untitled Game';
}

function engineLabel(file) {
  if (!file) return 'BUILD';
  if (HTML_EXT_RE.test(file.name)) return 'HTML';
  return 'UNITY';
}

/* ── Async helpers ────────────────────────────────────────────── */

/** Read text from .md/.txt description files. .docx/.pdf get a fallback. */
async function readDescriptionText(file) {
  if (!file) return '';
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result || '');
      reader.onerror = () => resolve('');
      reader.readAsText(file);
    });
  }
  return `Description provided via ${file.name}`;
}

/**
 * Scan a ZIP file for game, logo, and description files using JSZip.
 * If no HTML file is found inside, the zip itself is treated as a Unity build.
 */
async function scanZipContents(zipFile) {
  const result = { gameFile: null, logoFile: null, descFile: null };

  if (!window.JSZip) {
    // No JSZip — fall back: treat zip as Unity build
    result.gameFile = zipFile;
    return result;
  }

  try {
    const zip = await window.JSZip.loadAsync(zipFile);

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const filename = path.split('/').pop();
      const lo = filename.toLowerCase();

      if (HTML_EXT_RE.test(lo) && !result.gameFile) {
        const blob = await entry.async('blob');
        result.gameFile = new File([blob], filename, { type: 'text/html' });
      }
      if (LOGO_EXT_RE.test(lo) && !result.logoFile) {
        const mime = lo.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const blob = await entry.async('blob');
        result.logoFile = new File([blob], filename, { type: mime });
      }
      if (DESC_EXT_RE.test(lo) && !result.descFile) {
        const blob = await entry.async('blob');
        result.descFile = new File([blob], filename);
      }
    }

    // No HTML inside → treat the whole zip as a Unity build
    if (!result.gameFile) result.gameFile = zipFile;
  } catch (err) {
    console.warn('ZIP scan failed, treating as Unity build:', err);
    result.gameFile = zipFile;
  }

  return result;
}

/** Recursively traverse a DataTransferEntry directory tree. */
async function traverseFolderEntry(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file(resolve, () => resolve(null)));
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const allEntries = await new Promise((resolve) => {
      const acc = [];
      const readBatch = () => {
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(acc);
          else { acc.push(...batch); readBatch(); }
        }, () => resolve(acc));
      };
      readBatch();
    });
    const files = [];
    for (const e of allEntries) {
      const r = await traverseFolderEntry(e);
      if (Array.isArray(r)) files.push(...r);
      else if (r) files.push(r);
    }
    return files;
  }
  return [];
}

/** Categorise an array of File objects into checklist slots. */
function categorizeFiles(files) {
  const result = { gameFile: null, logoFile: null, descFile: null };
  for (const f of files) {
    const cat = categorizeFile(f);
    if (cat === 'game' && !result.gameFile) result.gameFile = f;
    if (cat === 'logo' && !result.logoFile) result.logoFile = f;
    if (cat === 'desc' && !result.descFile) result.descFile = f;
  }
  return result;
}

/* ── Component ────────────────────────────────────────────────── */

function UploadPage({ onGameRegistered, hasGames }) {
  /* state: idle | hover | review | uploading | parsing | success | error | waitlist */
  const [state, setState] = useState('idle');
  const [file, setFile] = useState(null);
  const [percent, setPercent] = useState(0);
  const [result, setResult] = useState(null);
  const [extracted, setExtracted] = useState(null);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistEngine, setWaitlistEngine] = useState('Unreal');
  const [errorMsg, setErrorMsg] = useState('');
  const [parseStep, setParseStep] = useState(0);
  const [isUpdateMode, setIsUpdateMode] = useState(false);
  const [existingGames, setExistingGames] = useState([]);
  const [selectedGameToUpdate, setSelectedGameToUpdate] = useState(null);

  /* Checklist */
  const [checklist, setChecklist] = useState({ gameFile: null, logoFile: null, descFile: null });
  const [gameTitle, setGameTitle] = useState('');
  const [scanning, setScanning] = useState(false);
  const [reviewDragOver, setReviewDragOver] = useState(false);

  /* Refs */
  const fileInputRef = useRef(null);
  const gameInputRef = useRef(null);
  const logoInputRef = useRef(null);
  const descInputRef = useRef(null);
  const Link = window.RouterLink;

  const auth = window.useAuth();
  const currentUser = auth?.user;

  // Load developer's existing games for update detection
  useEffect(() => {
    if (!currentUser?.uid) return;
    if (window.uploadPipeline?.listDeveloperHtmlGames) {
      window.uploadPipeline.listDeveloperHtmlGames(currentUser.uid).then(setExistingGames);
    }
  }, [currentUser?.uid]);

  // Reset on idle
  useEffect(() => {
    if (state === 'idle') {
      setPercent(0);
      setFile(null);
      setResult(null);
      setExtracted(null);
      setParseStep(0);
      setChecklist({ gameFile: null, logoFile: null, descFile: null });
      setGameTitle('');
      setScanning(false);
      setReviewDragOver(false);
    }
  }, [state]);

  /* ── Checklist helpers ──────────────────────────────────────── */

  const mergeChecklist = (found) => {
    setChecklist((prev) => ({
      gameFile: found.gameFile || prev.gameFile,
      logoFile: found.logoFile || prev.logoFile,
      descFile: found.descFile || prev.descFile,
    }));
    if (found.gameFile && !gameTitle) {
      setGameTitle(titleFromFilename(found.gameFile.name));
    }
  };

  const allPresent = !!(checklist.gameFile && checklist.logoFile && checklist.descFile);
  const missingItems = [
    !checklist.gameFile && 'Game file',
    !checklist.logoFile && 'Logo',
    !checklist.descFile && 'Description',
  ].filter(Boolean);

  /* ── Process incoming files (zip / folder / individual) ─────── */

  const processIncomingFiles = async (files, items) => {
    setScanning(true);
    try {
      // 1. Check for folder drop via webkitGetAsEntry
      if (items?.length) {
        for (const item of items) {
          const entry = item.webkitGetAsEntry?.();
          if (entry?.isDirectory) {
            const folderFiles = await traverseFolderEntry(entry);
            const found = categorizeFiles(folderFiles.filter(Boolean));
            mergeChecklist(found);
            setState('review');
            return;
          }
        }
      }

      const fileList = [...files];

      // 2. Single zip → scan contents
      if (fileList.length === 1 && /\.zip$/i.test(fileList[0].name)) {
        const found = await scanZipContents(fileList[0]);
        mergeChecklist(found);
        setState('review');
        return;
      }

      // 3. Individual / multiple files → categorise
      const found = categorizeFiles(fileList);

      // Check for unsupported engine files (Unreal, Godot etc.)
      const unsupported = fileList.find((f) => NON_UNITY_EXT_RE.test(f.name));
      if (unsupported && !found.gameFile) {
        setState('waitlist');
        return;
      }

      mergeChecklist(found);
      setState('review');
    } finally {
      setScanning(false);
    }
  };

  /* ── Submit (all 3 items present) ──────────────────────────── */

  const handleSubmit = async () => {
    const { gameFile: gf, logoFile: lf, descFile: df } = checklist;
    if (!gf) return;

    setFile(gf);
    setState('uploading');
    setPercent(0);

    const descText = df ? await readDescriptionText(df) : '';
    const title = gameTitle || titleFromFilename(gf.name);

    const meta = {
      gameTitle: title,
      iconPreviewUrl: lf ? URL.createObjectURL(lf) : 'assets/logo.jpg',
      description: descText || `${title} — a social mobile game on InZone.`,
      iconFound: !!lf,
      descriptionFound: !!df,
    };
    setExtracted(meta);

    try {
      const pipelineResult = await window.uploadPipeline.runUploadPipeline({
        htmlFile: gf,
        iconFile: lf || null,
        gameTitle: title,
        description: meta.description,
        uploaderId: currentUser?.uid || 'anonymous',
        uploaderName:
          currentUser?.displayName ||
          currentUser?.email?.split('@')[0] ||
          'Developer',
        isUpdate: isUpdateMode,
        onProgress: (pct) => {
          setPercent(pct);
          if (pct >= 100) setTimeout(() => setState('parsing'), 300);
        },
        onStep: (stepIdx) => {
          setParseStep(stepIdx);
          if (stepIdx >= 2) setExtracted((m) => ({ ...m, iconFound: true }));
          if (stepIdx >= 3) setExtracted((m) => ({ ...m, descriptionFound: true }));
        },
      });

      setParseStep(6);
      await new Promise((r) => setTimeout(r, 300));
      setResult({
        ...pipelineResult,
        gameId: pipelineResult.slug,
        liveUrl: pipelineResult.gameUrl,
        gameKey: pipelineResult.gameKey,
      });
      setState('success');

      // Notify AppShell so game appears in sidebar
      if (typeof onGameRegistered === 'function' && !isUpdateMode) {
        const initials = title
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0].toUpperCase())
          .join('') || 'NG';
        const palettes = [
          'radial-gradient(120% 100% at 30% 20%, oklch(0.78 0.12 232), oklch(0.50 0.13 250))',
          'radial-gradient(120% 100% at 30% 20%, oklch(0.80 0.14 340), oklch(0.55 0.16 320))',
          'radial-gradient(120% 100% at 30% 20%, oklch(0.82 0.14 75),  oklch(0.60 0.16 50))',
          'radial-gradient(120% 100% at 30% 20%, oklch(0.86 0.14 155), oklch(0.62 0.16 145))',
        ];
        const hash = [...pipelineResult.slug].reduce((a, c) => a + c.charCodeAt(0), 0);
        onGameRegistered({
          gameId: pipelineResult.slug,
          name: title,
          initials,
          studio: currentUser?.displayName || 'Studio',
          status: 'live',
          gradient: palettes[hash % palettes.length],
        });
      }
    } catch (err) {
      console.error('Upload pipeline error:', err);
      setErrorMsg(err.message || 'UPLOAD_FAILED');
      setState('error');
    }
  };

  /* ── Drag & drop handlers ──────────────────────────────────── */

  const onDrop = async (e) => {
    e.preventDefault();
    setReviewDragOver(false);

    // Only process in idle, hover, or review states
    if (state !== 'idle' && state !== 'hover' && state !== 'review') return;

    const items = e.dataTransfer.items ? [...e.dataTransfer.items] : null;
    const files = e.dataTransfer.files;
    await processIncomingFiles(files, items);
  };

  const onDragOver = (e) => {
    e.preventDefault();
    if (state === 'idle') setState('hover');
    if (state === 'review') setReviewDragOver(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    if (state === 'hover') setState('idle');
    if (state === 'review') setReviewDragOver(false);
  };

  /** Main "Browse files" in idle state — accepts everything. */
  const handleBrowseAll = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    processIncomingFiles(files, null);
    e.target.value = '';
  };

  /* Individual category inputs inside the review checklist */
  const handleGameInput = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      const cat = categorizeFile(f);
      if (cat === 'game') {
        mergeChecklist({ gameFile: f, logoFile: null, descFile: null });
        if (!gameTitle) setGameTitle(titleFromFilename(f.name));
      }
    }
    e.target.value = '';
  };
  const handleLogoInput = (e) => {
    const f = e.target.files?.[0];
    if (f && isLogoFile(f)) mergeChecklist({ gameFile: null, logoFile: f, descFile: null });
    e.target.value = '';
  };
  const handleDescInput = (e) => {
    const f = e.target.files?.[0];
    if (f && isDescFile(f)) mergeChecklist({ gameFile: null, logoFile: null, descFile: f });
    e.target.value = '';
  };

  const isDropState = state === 'idle' || state === 'hover';

  /* ── Checklist row sub-component ────────────────────────────── */

  const ChecklistRow = ({ label, file: clFile, hint, onBrowse, onClear }) => {
    const found = !!clFile;
    return (
      <div
        style={{
          ...uploadStyles.clRow,
          background: found ? 'oklch(0.78 0.14 155 / 0.06)' : 'var(--bg-2)',
          border: `1px solid ${found ? 'oklch(0.78 0.14 155 / 0.25)' : 'var(--line)'}`,
        }}
      >
        <span
          style={{
            ...uploadStyles.clDot,
            background: found ? 'var(--pos)' : 'var(--bg-3)',
            border: `1px solid ${found ? 'var(--pos)' : 'var(--line)'}`,
            boxShadow: found ? '0 0 10px oklch(0.78 0.14 155 / 0.4)' : 'none',
          }}
        >
          {found && <span style={uploadStyles.clCheck}></span>}
          {!found && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--ink-4)',
              }}
            ></span>
          )}
        </span>

        <div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: found ? 'var(--ink)' : 'var(--ink-3)',
            }}
          >
            {label}
          </div>
          {found ? (
            <div
              style={{
                marginTop: 2,
                fontFamily: "'Geist Mono', monospace",
                fontSize: 11,
                color: 'var(--pos)',
                letterSpacing: '0.03em',
              }}
            >
              {clFile.name} · {bytes(clFile.size)}
            </div>
          ) : (
            <div
              style={{
                marginTop: 2,
                fontFamily: "'Geist Mono', monospace",
                fontSize: 10.5,
                color: 'var(--ink-4)',
                letterSpacing: '0.04em',
              }}
            >
              {hint}
            </div>
          )}
        </div>

        {found ? (
          <button
            style={uploadStyles.clClear}
            onClick={onClear}
            aria-label={`Remove ${label}`}
            title={`Remove ${label}`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6 6l12 12" />
              <path d="M6 18 18 6" />
            </svg>
          </button>
        ) : (
          <button style={uploadStyles.clBrowse} onClick={onBrowse}>
            Browse
          </button>
        )}
      </div>
    );
  };

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <main className="stage" style={{ paddingTop: 48, paddingBottom: 80 }}>
      <div style={uploadStyles.pageHead}>
        <div style={uploadStyles.crumb}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--pos)',
              boxShadow: '0 0 8px var(--pos)',
            }}
          ></span>
          {hasGames ? 'Step 1 · Drop a build' : 'First game · Welcome to InZone'}
        </div>
        <h1 style={uploadStyles.h1}>
          {hasGames ? (
            <>
              Ship a build.{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, var(--blue-1), var(--blue-3))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                It's already live.
              </span>
            </>
          ) : (
            <>
              Register your first game.{' '}
              <span
                style={{
                  background: 'linear-gradient(135deg, var(--blue-1), var(--blue-3))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                It only takes a minute.
              </span>
            </>
          )}
        </h1>
        <p style={uploadStyles.lede}>
          {hasGames
            ? 'Drop your Unity or HTML game build. We parse it, wire the social layer, and return a shareable URL the moment parse completes.'
            : "Drop your Unity or HTML game build to unlock the dashboard, endpoints, players, and payouts. We'll parse it, wire the social layer, and hand back a shareable URL."}
        </p>
      </div>

      <div
        style={
          state === 'hover'
            ? { ...uploadStyles.uploader, ...uploadStyles.uploaderHover }
            : reviewDragOver
              ? { ...uploadStyles.uploader, ...uploadStyles.uploaderHover }
              : uploadStyles.uploader
        }
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {/* ─── IDLE / HOVER ─────────────────────────────────────── */}
        {isDropState && (
          <div style={uploadStyles.panel}>
            <div
              style={
                state === 'hover'
                  ? { ...uploadStyles.drop, ...uploadStyles.dropHover }
                  : uploadStyles.drop
              }
              onClick={() => fileInputRef.current?.click()}
            >
              {state === 'hover' && (
                <span className="drop-ring" aria-hidden="true"></span>
              )}

              <div style={uploadStyles.dropGlyph}>
                <svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v13" />
                  <path d="m6 9 6-6 6 6" />
                  <path d="M5 21h14" />
                </svg>
              </div>
              <h2 style={uploadStyles.dropTitle}>
                {state === 'hover'
                  ? 'Release to upload'
                  : 'Drop your Unity or HTML game build'}
              </h2>
              <div style={uploadStyles.dropHint}>
                .html · .unitypackage · .zip · folder
              </div>
              {state === 'idle' && (
                <>
                  <div
                    style={{ marginTop: 22, fontSize: 13, color: 'var(--ink-3)' }}
                  >
                    — or —
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    style={{
                      marginTop: 12,
                      height: 40,
                      padding: '0 22px',
                      borderRadius: 999,
                      fontSize: 14,
                      fontWeight: 500,
                      background: 'var(--ink)',
                      color: 'var(--bg)',
                      cursor: 'pointer',
                      border: 0,
                    }}
                  >
                    Browse files
                  </button>
                  <div
                    style={{
                      marginTop: 28,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                    }}
                  >
                    {['Unity + HTML', 'iOS · Android · Web', 'Auto file detect'].map(
                      (t) => (
                        <span
                          key={t}
                          style={{
                            padding: '5px 10px',
                            borderRadius: 999,
                            background: 'oklch(0.20 0.02 245 / 0.4)',
                            border: '1px solid var(--line-soft)',
                            fontFamily: "'Geist Mono', monospace",
                            fontSize: 10.5,
                            color: 'var(--ink-3)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {t}
                        </span>
                      ),
                    )}
                  </div>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.unitypackage,.html,.htm,.jpg,.jpeg,.png,.md,.docx,.pdf,.txt"
                multiple
                style={{ display: 'none' }}
                onChange={handleBrowseAll}
              />
            </div>

            {scanning && (
              <div
                style={{
                  marginTop: 16,
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'oklch(0.55 0.18 240 / 0.08)',
                  border: '1px solid oklch(0.72 0.13 235 / 0.2)',
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 11.5,
                  color: 'var(--blue-1)',
                  letterSpacing: '0.03em',
                  textAlign: 'center',
                }}
              >
                Scanning contents...
              </div>
            )}
          </div>
        )}

        {/* ─── REVIEW (checklist) ───────────────────────────────── */}
        {state === 'review' && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.parseHead}>
              <div style={uploadStyles.engine}>
                {checklist.gameFile ? engineLabel(checklist.gameFile) : 'BUILD'}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  Build Contents
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {allPresent
                    ? 'All files ready — submit when you are'
                    : `${missingItems.length} item${missingItems.length > 1 ? 's' : ''} still needed`}
                </div>
              </div>
              <span
                style={{
                  ...uploadStyles.badge,
                  ...(allPresent
                    ? {
                        background: 'oklch(0.78 0.14 155 / 0.15)',
                        border: '1px solid oklch(0.78 0.14 155 / 0.3)',
                        color: 'var(--pos)',
                      }
                    : {}),
                }}
              >
                {allPresent ? 'READY' : 'REVIEW'}
              </span>
            </div>

            {/* Title field */}
            <div style={uploadStyles.clTitle}>
              <label
                style={{
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 10.5,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                }}
              >
                Game Title
              </label>
              <input
                type="text"
                value={gameTitle}
                onChange={(e) => setGameTitle(e.target.value)}
                placeholder="Enter game title..."
                style={uploadStyles.clInput}
              />
            </div>

            {/* Checklist rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <ChecklistRow
                label="Game file"
                file={checklist.gameFile}
                hint=".html · .zip · .unitypackage"
                onBrowse={() => gameInputRef.current?.click()}
                onClear={() =>
                  setChecklist((p) => ({ ...p, gameFile: null }))
                }
              />
              <ChecklistRow
                label="Logo"
                file={checklist.logoFile}
                hint=".jpg · .jpeg · .png"
                onBrowse={() => logoInputRef.current?.click()}
                onClear={() =>
                  setChecklist((p) => ({ ...p, logoFile: null }))
                }
              />
              <ChecklistRow
                label="Description"
                file={checklist.descFile}
                hint=".md · .docx · .pdf · .txt"
                onBrowse={() => descInputRef.current?.click()}
                onClear={() =>
                  setChecklist((p) => ({ ...p, descFile: null }))
                }
              />
            </div>

            {/* Hidden file inputs for each category */}
            <input
              ref={gameInputRef}
              type="file"
              accept=".html,.htm,.zip,.unitypackage"
              style={{ display: 'none' }}
              onChange={handleGameInput}
            />
            <input
              ref={logoInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              style={{ display: 'none' }}
              onChange={handleLogoInput}
            />
            <input
              ref={descInputRef}
              type="file"
              accept=".md,.docx,.pdf,.txt"
              style={{ display: 'none' }}
              onChange={handleDescInput}
            />

            {/* Missing items hint */}
            {!allPresent && (
              <div
                style={{
                  marginTop: 18,
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: '1px dashed oklch(0.55 0.12 220 / 0.3)',
                  background: reviewDragOver
                    ? 'oklch(0.20 0.06 245 / 0.2)'
                    : 'transparent',
                  textAlign: 'center',
                  transition: 'background .2s',
                }}
              >
                <div
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    color: 'var(--ink-4)',
                    letterSpacing: '0.04em',
                  }}
                >
                  Drop additional files here or use the Browse buttons above
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 10.5,
                    color: 'var(--warm)',
                    letterSpacing: '0.03em',
                  }}
                >
                  Missing: {missingItems.join(' · ')}
                </div>
              </div>
            )}

            {/* Actions */}
            <div
              style={{
                marginTop: 24,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <button
                className="btn-ghost"
                onClick={() => setState('idle')}
                style={{ height: 40 }}
              >
                ← Start over
              </button>
              <button
                className="btn-primary"
                disabled={!allPresent || !gameTitle.trim()}
                onClick={handleSubmit}
                style={{
                  height: 40,
                  opacity: allPresent && gameTitle.trim() ? 1 : 0.45,
                  cursor:
                    allPresent && gameTitle.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Submit Game →
              </button>
            </div>
          </div>
        )}

        {/* ─── UPLOADING ────────────────────────────────────────── */}
        {state === 'uploading' && file && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.fileCard}>
              <span style={uploadStyles.fileIco}>{engineLabel(file)}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{file.name}</div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {bytes(file.size)} · uploading...
                </div>
              </div>
              <button
                style={uploadStyles.cancelBtn}
                onClick={() => setState('idle')}
                aria-label="Cancel"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12" />
                  <path d="M6 18 18 6" />
                </svg>
              </button>
            </div>

            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                  }}
                >
                  Uploading to storage
                </span>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 500,
                    letterSpacing: '-0.02em',
                    fontFeatureSettings: "'tnum'",
                  }}
                >
                  {Math.round(percent)}%
                </span>
              </div>
              <div style={uploadStyles.barTrack}>
                <div
                  style={{ ...uploadStyles.barFill, width: `${percent}%` }}
                ></div>
              </div>
              <div
                style={{
                  marginTop: 14,
                  display: 'flex',
                  gap: 24,
                  flexWrap: 'wrap',
                  fontFamily: "'Geist Mono', monospace",
                  fontSize: 11.5,
                  color: 'var(--ink-3)',
                  letterSpacing: '0.02em',
                }}
              >
                <span>
                  <b style={{ color: 'var(--ink)', fontWeight: 500 }}>
                    {bytes((file.size * percent) / 100)}
                  </b>{' '}
                  / {bytes(file.size)}
                </span>
                <span>
                  <b style={{ color: 'var(--ink)', fontWeight: 500 }}>
                    {(Math.random() * 10 + 8).toFixed(1)} MB/s
                  </b>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ─── PARSING ──────────────────────────────────────────── */}
        {state === 'parsing' && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.parseHead}>
              <div style={uploadStyles.engine}>{file ? engineLabel(file) : 'BUILD'}</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {file?.name || 'build'}
                </div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    letterSpacing: '0.04em',
                  }}
                >
                  {file ? `${engineLabel(file)} · ${bytes(file.size)}` : ''}
                </div>
              </div>
              <span style={uploadStyles.badge}>PARSING</span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                paddingTop: 14,
              }}
            >
              {[
                {
                  label: 'Upload received',
                  meta: file ? bytes(file.size) : '',
                },
                {
                  label: 'Title from bundle filename',
                  meta: extracted?.gameTitle || '—',
                },
                {
                  label: 'Reading logo',
                  meta: extracted?.iconFound ? 'found' : '...',
                },
                {
                  label: 'Reading description',
                  meta: extracted?.descriptionFound ? 'found' : '...',
                },
                {
                  label: 'Registering with Firestore',
                  meta: parseStep >= 5 ? 'done' : '—',
                },
              ].map((s, i) => {
                const isDone = i < parseStep;
                const isActive = i === parseStep;
                const dotBg = isDone
                  ? 'var(--pos)'
                  : isActive
                    ? 'oklch(0.20 0.06 240 / 0.5)'
                    : 'var(--bg-3)';
                const dotBorder = isDone
                  ? 'var(--pos)'
                  : isActive
                    ? 'var(--blue-1)'
                    : 'var(--line)';
                return (
                  <div key={s.label} style={uploadStyles.step}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: dotBg,
                        border: `1px solid ${dotBorder}`,
                        display: 'grid',
                        placeItems: 'center',
                        boxShadow: isDone
                          ? '0 0 12px oklch(0.78 0.14 155 / 0.5)'
                          : 'none',
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
                        ></span>
                      )}
                      {isActive && (
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--blue-1)',
                            animation: 'pulse 1.2s ease-in-out infinite',
                          }}
                        ></span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 13.5,
                        color:
                          i <= parseStep ? 'var(--ink)' : 'var(--ink-4)',
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "'Geist Mono', monospace",
                        fontSize: 10.5,
                        color: 'var(--ink-3)',
                        letterSpacing: '0.04em',
                      }}
                    >
                      {s.meta}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ─── SUCCESS ──────────────────────────────────────────── */}
        {state === 'success' && result && extracted && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.successHead}>
              <div style={uploadStyles.check}>
                <span
                  style={{
                    width: 14,
                    height: 7,
                    borderLeft: '2px solid oklch(0.15 0.04 155)',
                    borderBottom: '2px solid oklch(0.15 0.04 155)',
                    transform: 'rotate(-45deg) translate(1px, -2px)',
                  }}
                ></span>
                <span className="sparkle s1" aria-hidden="true"></span>
                <span className="sparkle s2" aria-hidden="true"></span>
                <span className="sparkle s3" aria-hidden="true"></span>
                <span className="sparkle s4" aria-hidden="true"></span>
                <span className="sparkle s5" aria-hidden="true"></span>
                <span className="sparkle s6" aria-hidden="true"></span>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 500,
                    letterSpacing: '-0.018em',
                  }}
                >
                  {extracted.gameTitle} is live.
                </div>
                <div
                  style={{
                    marginTop: 4,
                    color: 'var(--ink-3)',
                    fontSize: 13.5,
                  }}
                >
                  Build registered · social loop wired · ready to share
                </div>
              </div>
            </div>

            <div style={uploadStyles.urlCard}>
              <div>
                <div
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 10.5,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    marginBottom: 6,
                  }}
                >
                  Live URL
                </div>
                <div
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 13,
                    color: 'var(--blue-1)',
                    wordBreak: 'break-all',
                  }}
                >
                  {result.liveUrl}
                </div>
              </div>
              <button
                style={uploadStyles.copyBtn}
                onClick={() => navigator.clipboard?.writeText(result.liveUrl)}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
                Copy
              </button>
            </div>

            <div style={uploadStyles.urlCard}>
              <div>
                <div
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 10.5,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-3)',
                    marginBottom: 6,
                  }}
                >
                  Game key ·{' '}
                  <span style={{ color: 'var(--warm)' }}>
                    save this — shown once
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 13,
                    color: 'var(--blue-1)',
                    wordBreak: 'break-all',
                  }}
                >
                  {result.gameKey}
                </div>
              </div>
              <button
                style={uploadStyles.copyBtn}
                onClick={() =>
                  navigator.clipboard?.writeText(result.gameKey)
                }
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
                Copy
              </button>
            </div>

            {/* Extracted-from-bundle panel */}
            <div
              style={{
                marginTop: 24,
                paddingTop: 24,
                borderTop: '1px solid var(--line-soft)',
              }}
            >
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
                Extracted from your bundle
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '64px 1fr',
                  gap: 14,
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 14,
                    overflow: 'hidden',
                    border: '1px solid var(--line)',
                    background: 'var(--bg-2)',
                    display: 'grid',
                    placeItems: 'center',
                    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.06)',
                  }}
                >
                  <img
                    src={extracted.iconPreviewUrl}
                    alt="Game icon"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                    }}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 10,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 500,
                        color: 'var(--ink)',
                      }}
                    >
                      {extracted.gameTitle}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      color: 'var(--ink-2)',
                      fontSize: 13.5,
                      lineHeight: 1.5,
                    }}
                  >
                    {extracted.description}
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {extracted.iconFound && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: 'oklch(0.78 0.14 155 / 0.15)',
                          border: '1px solid oklch(0.78 0.14 155 / 0.3)',
                          fontFamily: "'Geist Mono', monospace",
                          fontSize: 10.5,
                          color: 'var(--pos)',
                          letterSpacing: '0.06em',
                        }}
                      >
                        logo ✓
                      </span>
                    )}
                    {extracted.descriptionFound && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: 'oklch(0.78 0.14 155 / 0.15)',
                          border: '1px solid oklch(0.78 0.14 155 / 0.3)',
                          fontFamily: "'Geist Mono', monospace",
                          fontSize: 10.5,
                          color: 'var(--pos)',
                          letterSpacing: '0.06em',
                        }}
                      >
                        description ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <Link to="/dashboard" className="btn-primary">
                Open dashboard <span>→</span>
              </Link>
              <button className="btn-ghost" onClick={() => setState('idle')}>
                Upload another
              </button>
            </div>
          </div>
        )}

        {/* ─── ERROR ────────────────────────────────────────────── */}
        {state === 'error' && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.errorHead}>
              <div style={uploadStyles.errorX}>
                <span
                  style={{
                    position: 'absolute',
                    width: 16,
                    height: 2,
                    background: 'oklch(0.15 0.04 25)',
                    borderRadius: 1,
                    transform: 'rotate(45deg)',
                  }}
                ></span>
                <span
                  style={{
                    position: 'absolute',
                    width: 16,
                    height: 2,
                    background: 'oklch(0.15 0.04 25)',
                    borderRadius: 1,
                    transform: 'rotate(-45deg)',
                  }}
                ></span>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    letterSpacing: '-0.018em',
                  }}
                >
                  Upload failed
                </div>
                <div
                  style={{
                    marginTop: 4,
                    color: 'var(--ink-3)',
                    fontSize: 13.5,
                  }}
                >
                  Something went wrong during the upload process.
                </div>
              </div>
            </div>
            <p
              style={{
                color: 'var(--ink-2)',
                fontSize: 14,
                lineHeight: 1.55,
                maxWidth: '56ch',
              }}
            >
              Check that your game file is a valid <b>.html</b>,{' '}
              <b>.zip</b>, or <b>.unitypackage</b> and try again. If this
              persists, make sure you're signed in with a Firebase account (not
              a local stub session).
            </p>
            <span
              style={{
                display: 'inline-block',
                marginTop: 14,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'oklch(0.20 0.02 245 / 0.6)',
                fontFamily: "'Geist Mono', monospace",
                fontSize: 11.5,
                color: 'var(--neg)',
                letterSpacing: '0.04em',
                alignSelf: 'flex-start',
              }}
            >
              {errorMsg || 'UPLOAD_FAILED'}
            </span>
            <div
              style={{
                marginTop: 22,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <button
                className="btn-primary"
                onClick={() => setState('idle')}
              >
                Try another file
              </button>
              <button className="btn-ghost">Contact support</button>
            </div>
          </div>
        )}

        {/* ─── WAITLIST ─────────────────────────────────────────── */}
        {state === 'waitlist' && (
          <div style={uploadStyles.panel}>
            <div style={uploadStyles.waitlistHead}>
              <div style={uploadStyles.waitlistGlyph}>◆</div>
              <div>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    letterSpacing: '-0.018em',
                  }}
                >
                  We currently support Unity + HTML.
                </div>
                <div
                  style={{
                    marginTop: 4,
                    color: 'var(--ink-3)',
                    fontSize: 13.5,
                  }}
                >
                  Your build looks like it's another engine — leave a note and
                  we'll ping you.
                </div>
              </div>
            </div>
            <p
              style={{
                color: 'var(--ink-2)',
                fontSize: 14.5,
                lineHeight: 1.55,
                maxWidth: '52ch',
                margin: '0 0 18px',
              }}
            >
              We launched with{' '}
              <b style={{ color: 'var(--ink)' }}>Unity mobile</b> and{' '}
              <b style={{ color: 'var(--ink)' }}>HTML games</b> first because
              it's where most of our founding-cohort developers are. Unreal,
              Godot, and others are{' '}
              <b style={{ color: 'var(--ink)' }}>on the roadmap</b>. Tell us
              which engine you're shipping and we'll prioritize.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginBottom: 16,
              }}
            >
              {['Unreal', 'WebGL', 'Godot', 'Other'].map((opt) => (
                <button
                  key={opt}
                  onClick={() => setWaitlistEngine(opt)}
                  style={{
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 8,
                    background:
                      waitlistEngine === opt
                        ? 'oklch(0.30 0.08 245 / 0.5)'
                        : 'var(--bg-2)',
                    border: `1px solid ${waitlistEngine === opt ? 'var(--blue-2)' : 'var(--line)'}`,
                    color:
                      waitlistEngine === opt ? 'var(--ink)' : 'var(--ink-2)',
                    fontFamily: "'Geist Mono', monospace",
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                alert(
                  `Added to waitlist for ${waitlistEngine}: ${waitlistEmail}`,
                );
                setState('idle');
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 8,
              }}
            >
              <input
                className="input"
                type="email"
                placeholder="dev@yourstudio.com"
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                required
              />
              <button className="btn-primary" type="submit">
                Join waitlist
              </button>
            </form>
            <div style={{ marginTop: 16 }}>
              <button
                className="btn-ghost"
                onClick={() => setState('idle')}
                style={{ height: 36 }}
              >
                ← Back
              </button>
            </div>
          </div>
        )}
      </div>

      {(state === 'idle' || state === 'hover') && <window.BundleSpecs />}

      {/* ApiNote commented out
      <window.ApiNote
        endpoint={window.inzoneAPI.REGISTER_GAME_ENDPOINT}
        source={result?.source}
      >
        <span style={{ color: 'var(--ink-4)' }}>
          · file step is direct-to-storage (placeholder)
        </span>
      </window.ApiNote>
      */}

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
  );
}

window.UploadPage = UploadPage;
