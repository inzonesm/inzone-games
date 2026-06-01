'use client';

import { Sidebar } from './Sidebar';

/** Sidebar + main shell used by every signed-in page (hub + upload). */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">{children}</div>
    </div>
  );
}
