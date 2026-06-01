'use client';

import type { CSSProperties } from 'react';
import type { Engine } from '@/lib/upload-pipeline';

interface SpecCard {
  n: string;
  title: string;
  code: string;
  body: React.ReactNode;
}

const html5Cards: SpecCard[] = [
  {
    n: '01',
    title: 'Entry point',
    code: '/index.html',
    body: (
      <>
        Single .html file works for self-contained games. For multi-file games,
        zip a folder with an <b>index.html</b> at the root (or under{' '}
        <b>src/</b>). We auto-detect the entry.
      </>
    ),
  },
  {
    n: '02',
    title: 'Title',
    code: 'your-game-name.zip',
    body: (
      <>
        Filename becomes your game title (Title Cased). Use hyphens or
        underscores between words; version tags like v1.4.2 are stripped.
      </>
    ),
  },
  {
    n: '03',
    title: 'Icon',
    code: '/logo.{jpg,png}',
    body: (
      <>
        Place a logo.jpg or logo.png at the bundle root. Square works best — we
        render it at 1x, 2x, and 3x for store listings.
      </>
    ),
  },
  {
    n: '04',
    title: 'Description',
    code: '/README.md',
    body: (
      <>
        Include a README.md or description.md. First non-heading paragraph
        becomes the library blurb on inzone.gg.
      </>
    ),
  },
];

const unityCards: SpecCard[] = [
  {
    n: '01',
    title: 'Build artifact',
    code: 'your-game.zip · .unitypackage',
    body: (
      <>
        Export a Unity 2021 LTS+ mobile build (iOS or Android), zip the build
        folder, and upload. <b>.unitypackage</b> also works for source-only
        flows.
      </>
    ),
  },
  {
    n: '02',
    title: 'Title',
    code: 'your-game-name.zip',
    body: (
      <>
        Filename becomes your game title (Title Cased). Hyphens/underscores
        split words; version tags like v1.4.2 are stripped.
      </>
    ),
  },
  {
    n: '03',
    title: 'Icon',
    code: '(picker)',
    body: (
      <>
        Icon is not auto-extracted from Unity builds yet. Add one via the icon
        picker, or update later from the Settings page.
      </>
    ),
  },
  {
    n: '04',
    title: 'Runtime status',
    code: 'pending',
    body: (
      <>
        Unity builds are stored as artifacts. They go live on the hub once the
        Unity WebGL/native runtime is wired in (tracked separately).
      </>
    ),
  },
];

const card: CSSProperties = {
  padding: '16px 18px',
  borderRadius: 14,
  border: '1px solid var(--line-soft)',
  background: 'oklch(0.18 0.02 245 / 0.3)',
};
const num: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'var(--bg-3)',
  border: '1px solid var(--line)',
  display: 'grid',
  placeItems: 'center',
  color: 'var(--blue-1)',
  fontFamily: "'Geist Mono', monospace",
  fontSize: 11,
  fontWeight: 600,
};
const code: CSSProperties = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 11.5,
  color: 'var(--blue-1)',
  marginBottom: 6,
};
const body: CSSProperties = {
  margin: 0,
  color: 'var(--ink-3)',
  fontSize: 12.5,
  lineHeight: 1.5,
};

export function BundleSpecs({ engine }: { engine: Engine }) {
  const isUnity = engine === 'unity';
  const cards = isUnity ? unityCards : html5Cards;

  return (
    <section style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
        <span
          style={{
            fontFamily: "'Geist Mono', monospace",
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
          }}
        >
          {isUnity ? 'Unity build expectations' : 'What to include in your HTML5 bundle'}
        </span>
        <span style={{ flex: 1, height: 1, background: 'var(--line-soft)' }} />
      </div>
      <div
        className="bundle-spec-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}
      >
        {cards.map((c) => (
          <div key={c.n} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={num}>{c.n}</span>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)' }}>{c.title}</span>
            </div>
            <div style={code}>{c.code}</div>
            <p style={body}>{c.body}</p>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 980px) { .bundle-spec-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 540px) { .bundle-spec-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  );
}
