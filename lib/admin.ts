'use client';

/* Admin client — talks to /api/admin (the hub's admin backend ported to a
 * Next route). Gating in the UI uses isAdminEmail (lib/admin-shared); the
 * route re-verifies on every call. */

import { getFirebaseAuth } from './firebase';
export { isAdminEmail } from './admin-shared';

export type AdminView = 'pending' | 'authenticated' | 'accepted-not-signed-up';

export interface AdminApplication {
  id: string;
  name?: string;
  email?: string;
  username?: string;
  followers?: string | number;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  twitch?: string;
  why?: string;
  status?: string;
  is_accepted?: boolean;
  is_authenticated?: boolean;
  uid?: string;
  referral_link?: string | null;
}

export interface MailchimpSyncResult {
  success: boolean;
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
  error?: string;
}

async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error('User not authenticated');
  const idToken = await user.getIdToken();
  const controller = new AbortController();
  // Mailchimp sync iterates the whole audience — give it more room.
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    return await fetch(path, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchApplications(view: AdminView): Promise<AdminApplication[]> {
  const res = await authedFetch(`/api/admin?view=${view}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to load applications');
  }
  const data = (await res.json()) as { applications?: AdminApplication[] };
  return data.applications ?? [];
}

export async function reviewApplication(email: string, status: 'accepted' | 'rejected'): Promise<void> {
  const res = await authedFetch('/api/admin', {
    method: 'POST',
    body: JSON.stringify({ action: 'review', email, status }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to update application');
  }
}

export async function syncMailchimp(): Promise<MailchimpSyncResult> {
  const res = await authedFetch('/api/admin', {
    method: 'POST',
    body: JSON.stringify({ action: 'sync-mailchimp' }),
  });
  const data = (await res.json().catch(() => ({}))) as MailchimpSyncResult;
  if (!res.ok && !data.total) {
    throw new Error(data.error || 'Mailchimp sync failed');
  }
  return data;
}

/** CSV download, exactly like the hub's Export to CSV button. */
export async function exportInfluencersCsv(): Promise<void> {
  const res = await authedFetch('/api/admin?view=export', { headers: { Accept: 'text/csv' } });
  if (!res.ok) throw new Error('Failed to export influencers');
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `influencers_export_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}
