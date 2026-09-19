import { adminAuth, adminCredentialsConfigured } from '../firebase-admin.ts';

export type CompanionActor = {
  uid: string;
  anonymous: boolean;
};

/**
 * Verify a Firebase ID token server-side. Anonymous guests are allowed.
 * Does not require a paid profile or coins. Existing account endpoints keep
 * their own auth; this path is only the web companion.
 */
export async function verifyCompanionActor(authorization: string | null): Promise<CompanionActor | null> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token || token.length > 4096) return null;

  if (adminCredentialsConfigured()) {
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      if (!decoded.uid) return null;
      return { uid: decoded.uid, anonymous: decoded.firebase?.sign_in_provider === 'anonymous' };
    } catch {
      return null;
    }
  }

  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      users?: Array<{ localId?: string; providerUserInfo?: Array<{ providerId?: string }> }>;
    };
    const user = body.users?.[0];
    if (!user) return null;
    const uid = user.localId?.trim();
    if (!uid) return null;
    const providers = user.providerUserInfo ?? [];
    const anonymous = providers.length === 0 || providers.every((p) => p.providerId === 'anonymous');
    return { uid, anonymous };
  } catch {
    return null;
  }
}
