import type { Metadata } from 'next';
import './session-prototype.css';

export const metadata: Metadata = {
  title: 'InZone — Just play',
  description:
    'Play, discover, and suggest a game without unloading the current one. Chat is simulated in this demo.',
  robots: { index: false, follow: false },
};

export default function SessionPrototypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
