'use client';

/* Shared editor for a game's display metadata — icon (profile pic), name,
 * description, and optional multiplayer server URL. Used both on the upload
 * success screen (edit right after uploading) and on the My Games page, so the
 * two never drift. It owns its own busy/error state and writes straight to
 * Firestore/Storage via updateGameIcon + updateGameMetadata; the parent just
 * receives the saved patch through onSaved. */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { updateGameIcon, updateGameMetadata } from '@/lib/games';

const MAX_ICON_BYTES = 5 * 1024 * 1024; // 5 MB

export interface GameMetaPatch {
  name: string;
  description: string;
  serverUrl: string;
  /** Set only when the icon was replaced. */
  iconUrl?: string;
}

interface GameMetaEditorProps {
  gameId: string;
  initial: { name: string; description: string; serverUrl: string; iconUrl: string };
  onSaved: (patch: GameMetaPatch) => void;
  onCancel?: () => void;
  /** Namespace for input ids so labels stay unique if several editors render. */
  idPrefix?: string;
  saveLabel?: string;
  /** Footer note under the fields. Omit for the default; pass null to hide. */
  note?: ReactNode;
}

export function GameMetaEditor({
  gameId,
  initial,
  onSaved,
  onCancel,
  idPrefix,
  saveLabel = 'Save changes',
  note,
}: GameMetaEditorProps) {
  const prefix = idPrefix ?? gameId;

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);

  // Pending icon replacement: the picked File plus a local object-URL preview.
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imgFailed, setImgFailed] = useState(false);
  const showFallback = !initial.iconUrl || imgFailed;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Any edit clears the "Saved ✓" confirmation so it never reads stale.
  const touch = () => setJustSaved((s) => (s ? false : s));

  // A fresh iconUrl (after a save) should clear a stale broken-image flag.
  useEffect(() => { setImgFailed(false); }, [initial.iconUrl]);
  // Revoke the object URL when it changes or the editor unmounts.
  useEffect(() => () => { if (iconPreview) URL.revokeObjectURL(iconPreview); }, [iconPreview]);

  const clearIconPick = () => {
    setIconFile(null);
    setIconPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onPickIcon = (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Pick an image file (PNG, JPG, WebP, …).'); return; }
    if (file.size > MAX_ICON_BYTES) { setErr('Image is larger than 5 MB.'); return; }
    setErr(null);
    touch();
    setIconFile(file);
    setIconPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
  };

  const save = async () => {
    if (!name.trim()) { setErr('Name can’t be empty.'); return; }
    setBusy(true);
    setErr(null);
    try {
      const patch: GameMetaPatch = {
        name: name.trim(),
        description: description.trim(),
        serverUrl: serverUrl.trim(),
      };
      // Upload the new icon first (if one was picked) so iconUrl rides along.
      if (iconFile) {
        patch.iconUrl = await updateGameIcon(gameId, iconFile);
      }
      await updateGameMetadata(gameId, { name: patch.name, description: patch.description, serverUrl: patch.serverUrl });
      clearIconPick();
      setJustSaved(true);
      onSaved(patch);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="field">
        <label className="field-label">Game image</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center' }}>
            {iconPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconPreview} alt="New icon preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : !showFallback ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={initial.iconUrl} alt={name} onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 26 }} role="img" aria-label="No icon">🎮</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-ghost" style={{ height: 34, padding: '0 14px', fontSize: 13 }} onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {iconPreview ? 'Choose another' : 'Change image'}
              </button>
              {iconPreview && (
                <button type="button" className="btn-ghost" style={{ height: 34, padding: '0 12px', fontSize: 13 }} onClick={clearIconPick} disabled={busy}>Remove</button>
              )}
            </div>
            <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em' }}>
              {iconFile ? iconFile.name : 'PNG, JPG, WebP · up to 5 MB'}
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => onPickIcon(e.target.files?.[0])}
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`name-${prefix}`}>Name</label>
        <input id={`name-${prefix}`} className="input" value={name} onChange={(e) => { setName(e.target.value); touch(); }} maxLength={80} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`desc-${prefix}`}>Description</label>
        <textarea id={`desc-${prefix}`} className="textarea" value={description} onChange={(e) => { setDescription(e.target.value); touch(); }} maxLength={600} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`server-${prefix}`}>Multiplayer server URL · optional</label>
        <input id={`server-${prefix}`} className="input" type="url" inputMode="url" placeholder="wss://your-game.fly.dev" value={serverUrl} onChange={(e) => { setServerUrl(e.target.value); touch(); }} autoComplete="off" spellCheck={false} />
      </div>
      {note === undefined ? (
        <p style={{ margin: 0, fontFamily: "'Geist Mono', monospace", fontSize: 10, color: 'var(--ink-4)', letterSpacing: '0.04em', lineHeight: 1.5 }}>
          Editing details won’t change your live URL or version. To ship a new build, use “Update build” on this game — your URL stays the same and the old build is kept for rollback.
        </p>
      ) : note}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn-primary" style={{ height: 38, padding: '0 18px', fontSize: 13 }} onClick={save} disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
        {onCancel && (
          <button className="btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 13 }} onClick={onCancel} disabled={busy}>Cancel</button>
        )}
        {justSaved && !busy && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--pos)' }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: 'oklch(0.78 0.14 155 / 0.2)', border: '1px solid oklch(0.78 0.14 155 / 0.4)', display: 'grid', placeItems: 'center' }}>
              <span style={{ width: 6, height: 3, borderLeft: '1.5px solid var(--pos)', borderBottom: '1.5px solid var(--pos)', transform: 'rotate(-45deg) translate(0.5px, -0.5px)' }} />
            </span>
            Saved · your changes are live
          </span>
        )}
      </div>
      {err && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'oklch(0.72 0.16 25 / 0.12)', border: '1px solid oklch(0.72 0.16 25 / 0.3)', color: 'var(--neg)', fontSize: 12.5 }}>{err}</div>
      )}
    </div>
  );
}
