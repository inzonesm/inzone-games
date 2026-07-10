'use client';

/* The four-step onboarding strip shown above the upload
 * portal, but only for first-time developers shipping their first game.
 * Returning developers never see this; they get the standard upload portal
 * untouched. Steps 1–2 are already done by the time a signed-in dev reaches
 * /upload; step 3 is live while they upload and 3–4 flip green on success. */

import type { CSSProperties, ReactNode } from 'react';

type StepStatus = 'done' | 'active' | 'pending';

interface Step {
  n: number;
  title: string;
  desc: string;
  status: StepStatus;
  icon: ReactNode;
}

const s: Record<string, CSSProperties> = {
  card: {
    position: 'relative',
    borderRadius: 16,
    border: '1px solid var(--line)',
    background: 'linear-gradient(180deg, oklch(0.19 0.02 245 / 0.55), oklch(0.16 0.018 245 / 0.55))',
    backdropFilter: 'blur(10px)',
    padding: '18px 18px 20px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.04)',
  },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 22,
    height: 22,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
  },
  icoTile: {
    width: 42,
    height: 42,
    borderRadius: 12,
    margin: '2px auto 0',
    background: 'linear-gradient(135deg, oklch(0.28 0.05 245 / 0.6), oklch(0.20 0.04 245 / 0.6))',
    border: '1px solid var(--line)',
    display: 'grid',
    placeItems: 'center',
    color: 'var(--blue-1)',
    boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.07)',
  },
  title: { margin: '14px 0 0', fontSize: 14.5, fontWeight: 500, letterSpacing: '-0.01em', textAlign: 'center' },
  desc: { margin: '6px auto 0', maxWidth: '24ch', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-3)', textAlign: 'center' },
};

function Badge({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span
        style={{
          ...s.badge,
          background: 'linear-gradient(135deg, var(--pos), oklch(0.65 0.16 160))',
          boxShadow: '0 0 14px oklch(0.78 0.14 155 / 0.45), inset 0 1px 0 oklch(1 0 0 / 0.3)',
        }}
        aria-label="Complete"
      >
        <span style={{ width: 8, height: 4, borderLeft: '1.6px solid oklch(0.15 0.04 155)', borderBottom: '1.6px solid oklch(0.15 0.04 155)', transform: 'rotate(-45deg) translate(0.5px, -1px)' }} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        style={{ ...s.badge, background: 'oklch(0.20 0.06 240 / 0.5)', border: '1px solid var(--blue-1)' }}
        aria-label="In progress"
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue-1)', animation: 'fus-pulse 1.2s ease-in-out infinite' }} />
      </span>
    );
  }
  return <span style={{ ...s.badge, background: 'var(--bg-3)', border: '1px solid var(--line)' }} aria-label="Pending" />;
}

const ICONS = {
  account: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  ),
  sdk: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /><path d="m13.5 4-3 16" />
    </svg>
  ),
  upload: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" />
    </svg>
  ),
  live: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-3.6" /><path d="m8.2 13.2 7.6 3.6" />
    </svg>
  ),
};

/** `uploaded` = the first upload just succeeded; steps 3 & 4 flip green. */
export function FirstUploadSteps({ uploaded }: { uploaded: boolean }) {
  const steps: Step[] = [
    { n: 1, title: 'Create Account', desc: 'Sign up and access your developer workspace.', status: 'done', icon: ICONS.account },
    { n: 2, title: 'Integrate SDK', desc: 'Add our SDK to your game in under 30 minutes.', status: 'done', icon: ICONS.sdk },
    { n: 3, title: 'Upload Build', desc: "Drop your HTML5 build and we'll handle the rest.", status: uploaded ? 'done' : 'active', icon: ICONS.upload },
    { n: 4, title: 'Go Live', desc: 'Get your shareable link and start growing your community.', status: uploaded ? 'done' : 'pending', icon: ICONS.live },
  ];

  return (
    <section aria-label="Getting started steps" style={{ margin: '6px 0 12px' }}>
      <div className="fus-grid">
        {steps.map((step) => (
          <div key={step.n} className="fus-card" style={s.card}>
            <Badge status={step.status} />
            <div style={s.icoTile}>{step.icon}</div>
            <h3 style={s.title}>{step.n}. {step.title}</h3>
            <p style={s.desc}>{step.desc}</p>
          </div>
        ))}
      </div>

      <style>{`
        .fus-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
        .fus-card:not(:first-child)::before {
          content: '';
          position: absolute;
          top: 50%;
          left: -15px;
          width: 15px;
          height: 1px;
          background: var(--line);
        }
        @keyframes fus-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.7); } 50% { opacity: 1; transform: scale(1); } }
        @media (max-width: 860px) {
          .fus-grid { grid-template-columns: 1fr 1fr; }
          .fus-card::before { display: none; }
        }
        @media (max-width: 480px) {
          .fus-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </section>
  );
}
