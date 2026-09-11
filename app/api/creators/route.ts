/* Creator provisioning API — creates whichever of influencers/{uid} and
 * humanUsers/{uid} is missing for the signed-in caller, using the Admin SDK
 * so it works regardless of the deployed client Firestore rules (the reason
 * client-side provisioning can silently do nothing).
 *
 * Field shapes mirror the three reference codebases:
 *   humanUsers  → inzone-backend/inzoneapi profile_service.create_profile
 *                 (no `createdAt` — that's the Flutter app's onboarding
 *                 marker, set by its interests screen)
 *   influencers → hub SignupPage + pending-dashboard referralCode backfill,
 *                 plus the hub application's lifecycle fields (pending
 *                 status, preview access) — this app has no application
 *                 form, so signup counts as the application
 *
 * POST /api/creators  (Bearer ID token) → { influencers, humanUsers } each
 * 'created' | 'exists'. Idempotent; never touches existing docs except to
 * flip humanUsers.is_influencer once the influencer doc exists. */

import { NextResponse, type NextRequest } from 'next/server';
import { adminAuth, adminCredentialsConfigured, adminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

type Row = Record<string, unknown>;

function deriveReferralCode(uid: string): string {
  return uid.substring(0, 8).toUpperCase();
}

/** Does an influencer doc exist under any of the hub's keying conventions?
 *  Email matching is CASE-INSENSITIVE by scanning the (small) collection —
 *  Firestore equality queries are case-sensitive, and application docs store
 *  the email as typed while Firebase Auth lowercases it. That mismatch is
 *  exactly how duplicate influencer docs were being created. */
async function influencerExists(db: Firestore, uid: string, email: string | null): Promise<boolean> {
  const byUid = await db.collection('influencers').doc(uid).get();
  if (byUid.exists) return true;
  if (!email) return false;
  const target = email.trim().toLowerCase().replace('+web@', '@');
  const snap = await db.collection('influencers').get();
  return snap.docs.some((d) => {
    const data = d.data() as Row;
    const docEmail = typeof data.email === 'string' ? data.email.trim().toLowerCase().replace('+web@', '@') : '';
    const docId = d.id.trim().toLowerCase().replace('+web@', '@');
    return docEmail === target || docId === target || data.uid === uid;
  });
}

export async function POST(req: NextRequest) {
  // Fail fast when no service account is configured — otherwise admin init
  // stalls on metadata-server probes and the client hangs, then 500s.
  if (!adminCredentialsConfigured()) {
    return NextResponse.json({ error: 'ADMIN_NOT_CONFIGURED' }, { status: 503 });
  }
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });

  let uid = '';
  let email: string | null = null;
  let name: string | null = null;
  let picture: string | null = null;
  let signInProvider: string | null = null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email ?? null;
    name = (decoded.name as string | undefined) ?? null;
    picture = (decoded.picture as string | undefined) ?? null;
    signInProvider = decoded.firebase?.sign_in_provider ?? null;
  } catch {
    return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
  }
  if (signInProvider === 'anonymous') {
    return NextResponse.json({ error: 'ANONYMOUS_NOT_ALLOWED' }, { status: 403 });
  }

  const db = adminDb();
  const cleanEmail = email ? email.replace(/\+web@/, '@') : null;

  try {
    // Shared username — email local part, de-collided against humanUsers
    // (the hub's availability check).
    let username = (cleanEmail?.split('@')[0] || `creator${uid.slice(0, 6)}`)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '');
    try {
      const taken = await db.collection('humanUsers').where('username', '==', username).limit(1).get();
      if (!taken.empty && taken.docs[0].id !== uid) {
        username = `${username}${uid.slice(0, 4).toLowerCase()}`;
      }
    } catch {
      /* best-effort */
    }

    /* ── influencers ─────────────────────────────────────────────────── */
    let influencers: 'created' | 'exists' = 'exists';
    if (!(await influencerExists(db, uid, email))) {
      // This app has no application form, so every signup is seeded with the
      // hub application's lifecycle/status fields (pending, not accepted,
      // preview access) so the admin can review + authenticate with no
      // missing-field issues — same doc shape a hub applicant would have.
      const authProvider =
        signInProvider === 'google.com' ? 'google' : signInProvider === 'apple.com' ? 'apple' : 'email';
      const nowIso = new Date().toISOString();
      await db.collection('influencers').doc(uid).set(
        {
          uid,
          email: cleanEmail,
          username,
          name: name || username,
          profile_picture: picture || '',
          date_created: FieldValue.serverTimestamp(),
          is_authenticated: false, // approved later, exactly like the hub
          referral_link: null, // issued at approval (AppsFlyer OneLink)
          referralCode: deriveReferralCode(uid),
          // ── auto-filled application (hub ApplicationForm shape) ────────
          authProvider,
          applicationStatus: 'pending', // hub ApplicationForm lifecycle field
          status: 'pending', // review lifecycle: pending → accepted/rejected
          is_accepted: false,
          dashboardAccessLevel: 'preview',
          isActive: false,
          applied_at: FieldValue.serverTimestamp(), // hub /api/apply field
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true },
      );
      influencers = 'created';
    }

    /* ── humanUsers ──────────────────────────────────────────────────── */
    let humanUsers: 'created' | 'exists' = 'exists';
    const huRef = db.collection('humanUsers').doc(uid);
    const hu = await huRef.get();
    if (!hu.exists) {
      await huRef.set({
        uid,
        email: cleanEmail,
        username,
        name: name || username,
        bio: '',
        age: null,
        gender: null,
        profilePicture: picture || '',
        user_interests: [],
        blockout: [],
        liked_posts: [],
        followers: [],
        following: [],
        balance: 200, // backend's starting user-side InCash seed
        is_influencer: true,
        date_created: FieldValue.serverTimestamp(),
        // no `createdAt` — the app's onboarding-complete marker
      });
      humanUsers = 'created';
    } else if ((hu.data() as Row).is_influencer !== true) {
      await huRef.set({ is_influencer: true }, { merge: true });
    }

    return NextResponse.json({ success: true, influencers, humanUsers });
  } catch (e) {
    console.error('creator provisioning failed:', e);
    return NextResponse.json({ error: 'PROVISION_FAILED' }, { status: 500 });
  }
}
