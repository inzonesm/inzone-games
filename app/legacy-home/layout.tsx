import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'InZone — Game Hub (pre-#13 recovery)',
  robots: { index: false, follow: false },
};

export default function LegacyHomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
