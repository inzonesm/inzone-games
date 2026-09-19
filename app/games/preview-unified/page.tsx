import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PlayPreview from './play-preview';

export const metadata: Metadata = {
  title: 'InZone — Play starts here',
  robots: { index: false, follow: false },
};

export default function UnifiedPreviewPage() {
  if (process.env.VERCEL_ENV === 'production') notFound();
  if (process.env.VERCEL_ENV !== 'preview' && process.env.INZONE_UNIFIED_PREVIEW !== '1') notFound();
  return <PlayPreview />;
}
