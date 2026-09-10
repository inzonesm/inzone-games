import type { Metadata } from 'next';
import './session-prototype.css';

export const metadata: Metadata = {
  title: 'InZone social session prototype',
  description:
    'Review-only prototype: play, discover, and suggest a game without unloading the current one. Conversation is simulated and labeled. Production routes are unchanged.',
  robots: { index: false, follow: false },
};

export default function SessionPrototypeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
