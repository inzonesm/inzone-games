import type { Metadata } from 'next';
import './experience.css';

export const metadata: Metadata = {
  title: 'InZone — experience prototype',
  robots: { index: false, follow: false },
};

export default function ExperienceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
