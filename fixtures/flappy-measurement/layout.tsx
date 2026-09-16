import { MetaPixel } from '@/components/MetaPixel';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html><body style={{ margin: 0 }}>{children}<MetaPixel /></body></html>;
}
