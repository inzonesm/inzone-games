'use client';

/* Creator dashboard data layer — ports the influencer-hub dashboard reads
 * (influencers, humanUsers, referrals, influencers_referral_stats,
 * humanPosts, postComments) into this app and rewires earnings to the NEW
 * economy model (see lib/creator-economy.ts and the July 2026 brief).
 *
 * ── Identity: everything is keyed by the APP-account uid ──────────────
 * The hub's attribution data hangs off the influencer's app account, not the
 * web session (backend/app.py):
 *
 *   influencers/{docId}          docId may be the app uid OR the email; the
 *                                doc's `uid` FIELD is the app-account uid
 *   referral_link (field)        the working AppsFlyer OneLink, set at
 *                                approval — also copied to humanUsers
 *   referrals.referrerId         == app uid (appsflyer_service, from
 *                                deep_link_sub1 when an install lands)
 *   humanPosts.user_document_id  == app uid
 *
 * We resolve the influencer doc every way the hub/backend does, then query
 * with every plausible id (app uid, doc id, session uid) and merge.
 *
 * ── Performance ────────────────────────────────────────────────────────
 * All independent query groups (profile link, click stats, referrals,
 * ledger, payouts, content) run CONCURRENTLY, and per-candidate-id queries
 * inside each group run in parallel too — the dashboard costs a couple of
 * network round-trips, not a dozen serial ones.
 *
 * ── Earnings: new model only ───────────────────────────────────────────
 *   · signup = pending attribution; money moves only on referred coin
 *     purchases inside the attribution window
 *   · authoritative earnings = append-only `ledger_entries` (balances are
 *     derived, never stored); estimates from typed `transactions` until then
 *   · no flat bounties ($10/signup, 30/ad, 5/post) anywhere in this path
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fbLimit,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import { getDb, getFirebaseAuth } from './firebase';
import {
  computeSplit,
  fetchEconomyConfig,
  isWithinAttributionWindow,
  round2,
  type Channel,
  type EconomyConfig,
} from './creator-economy';

/* ── Types ─────────────────────────────────────────────────────────── */

export interface CreatorProfile {
  name: string;
  referralCode: string;
  referralLink: string;
  /** The app-account uid attribution is keyed by (deep_link_sub1). */
  appUid: string | null;
}

export interface CreatorReferralStats {
  total: number;
  active24h: number;
  /** Referred users still inside their attribution window (their purchases pay you). */
  inWindow: number;
  expired: number;
  /** Link clicks / conversions from influencers_referral_stats (carried over). */
  clicks: number;
  conversions: number;
}

export interface CommissionEntry {
  id: string;
  amount: number;
  ago: string;
  createdAt: Date | null;
  channel: Channel | null;
  /** 'ledger' = immutable ledger row; 'estimated' = derived from raw purchases. */
  source: 'ledger' | 'estimated';
}

export interface CreatorEarnings {
  lifetime: number;
  paid: number;
  pending: number;
  entries: CommissionEntry[];
  /** True when amounts come from real ledger_entries rows (not estimates). */
  ledgerLive: boolean;
}

export interface ContentPost {
  id: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  ago: string;
}

export interface CreatorContentStats {
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  engagementRate: number; // %
  recentPosts: ContentPost[];
}

export interface CreatorPayoutRecord {
  id: string;
  period: string;
  amount: number;
  status: 'pending' | 'paid' | 'failed';
  createdAt: Date | null;
}

export interface CreatorDashboardData {
  profile: CreatorProfile;
  referrals: CreatorReferralStats;
  earnings: CreatorEarnings;
  content: CreatorContentStats;
  payouts: CreatorPayoutRecord[];
  config: EconomyConfig;
}

type Row = Record<string, unknown>;

/* ── Small helpers (same conventions as lib/dashboard.ts) ──────────── */

function toDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof (val as { toDate?: unknown }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatTimeAgo(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function asChannel(v: unknown): Channel | null {
  return v === 'ios' || v === 'android' || v === 'web' ? v : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The Flutter app soft-deletes posts by overwriting their text with this
 *  marker (post_card.dart) — the doc stays in humanPosts, so filter it out. */
const DELETED_POST_MARKER = '[This post has been deleted';

function isDeletedPost(p: Row): boolean {
  const nested = (p.post as Row) || {};
  const texts = [nested.text_content, p.text_content, p.content, nested.content];
  return texts.some((t) => typeof t === 'string' && t.includes(DELETED_POST_MARKER));
}

/** Same rule the hub uses when an influencer doc has no referralCode yet. */
export function deriveReferralCode(uid: string): string {
  return uid.substring(0, 8).toUpperCase();
}

/** The AppsFlyer OneLink the backend generates at approval — the link that
 *  actually attributes installs (writes `referrals` via deep_link_sub1). */
export function buildAppsFlyerLink(appUid: string): string {
  return `https://join-inzone.onelink.me/SACg?af_xp=custom&pid=my_media_source&deep_link_value=referral&deep_link_sub1=${appUid}`;
}

/** The hub's device-aware store redirect (ReferralRedirectPage) — last-resort
 *  fallback when no app uid is known; tracks clicks but not installs. */
export function buildReferralLink(referralCode: string): string {
  return `https://inzone.ai/download?ref=${referralCode}`;
}

export function emptyCreatorDashboard(config: EconomyConfig): CreatorDashboardData {
  return {
    profile: { name: 'Creator', referralCode: '', referralLink: '', appUid: null },
    referrals: { total: 0, active24h: 0, inWindow: 0, expired: 0, clicks: 0, conversions: 0 },
    earnings: { lifetime: 0, paid: 0, pending: 0, entries: [], ledgerLive: false },
    content: { totalPosts: 0, totalViews: 0, totalLikes: 0, engagementRate: 0, recentPosts: [] },
    payouts: [],
    config,
  };
}

/* ── Identity resolution (shared by dashboard, payouts, and signup) ── */

async function resolveInfluencer(
  db: Firestore,
  uid: string,
  email: string | null,
): Promise<{ inf: Row | null; infDocId: string | null; cleanEmail: string | null }> {
  let inf: Row | null = null;
  let infDocId: string | null = null;
  const cleanEmail = email ? email.replace(/\+web@/, '@') : null;
  try {
    // 1. Keyed by the current session uid (AmbassadorPendingDashboard).
    const byUid = await getDoc(doc(db, 'influencers', uid));
    if (byUid.exists()) {
      inf = byUid.data() as Row;
      infDocId = byUid.id;
    }
    // 2. By email field — clean, +web variant, and lowercase forms (Firestore
    //    equality is case-sensitive; auth emails are lowercased while
    //    application docs keep the email as typed).
    if (!inf && cleanEmail) {
      const [local, domain] = cleanEmail.split('@');
      const webEmail = `${local}+web@${domain}`;
      const candidates = [
        ...new Set([cleanEmail, webEmail, cleanEmail.toLowerCase(), webEmail.toLowerCase()]),
      ];
      for (const candidate of candidates) {
        const snap = await getDocs(
          query(collection(db, 'influencers'), where('email', '==', candidate), fbLimit(1)),
        );
        if (!snap.empty) {
          inf = snap.docs[0].data() as Row;
          infDocId = snap.docs[0].id;
          break;
        }
      }
    }
    // 3. Legacy docs keyed by the email itself (backend fallback path).
    if (!inf && cleanEmail) {
      const byEmailId = await getDoc(doc(db, 'influencers', cleanEmail));
      if (byEmailId.exists()) {
        inf = byEmailId.data() as Row;
        infDocId = byEmailId.id;
      }
    }
  } catch {
    /* influencers lookup is non-fatal */
  }
  return { inf, infDocId, cleanEmail };
}

function candidatesFrom(inf: Row | null, infDocId: string | null, uid: string): { appUid: string | null; candidateIds: string[] } {
  const appUid =
    asString(inf?.uid) ||
    asString(inf?.userId) ||
    asString(inf?.user_id) ||
    (infDocId && !infDocId.includes('@') ? infDocId : null);
  const candidateIds = [...new Set([appUid, infDocId, uid].filter((x): x is string => !!x && !x.includes('@')))];
  return { appUid, candidateIds };
}

/** Every id this user's attribution/ledger/payout rows may be keyed by
 *  (session uid, influencer doc id, app-account uid). Used by /payouts. */
export async function resolveCandidateIds(uid: string, email: string | null): Promise<string[]> {
  const db = getDb();
  const { inf, infDocId } = await resolveInfluencer(db, uid, email);
  return candidatesFrom(inf, infDocId, uid).candidateIds;
}

/* ── Signup provisioning: humanUsers + influencers docs ───────────────
 * Runs on every sign-in AND every /creators visit; whichever of the two
 * docs is missing gets created (returning users are left untouched, the
 * Flutter rule). Field shapes come from the three reference codebases:
 *
 *   humanUsers/{uid}   inzone-backend/inzoneapi profile_service.create_profile
 *                      (the endpoint the hub's SignupPage calls). Like the
 *                      Flutter app's sign-in seeding (auth_work.dart) we
 *                      deliberately do NOT set `createdAt` — that's the
 *                      app's onboarding-complete marker.
 *
 *   influencers/{uid}  hub SignupPage + pending-dashboard referralCode
 *                      backfill; referral_link stays null until approval
 *                      issues the AppsFlyer OneLink (backend app.py).       */

// Once-per-session guard so auth-state changes / page visits don't re-run
// the (read-heavy) provisioning for the same account.
const provisioned = new Set<string>();

export async function ensureCreatorDocs(
  uid: string,
  email: string | null,
  displayName: string | null,
  photoURL?: string | null,
): Promise<void> {
  if (!uid || provisioned.has(uid)) return;

  // Prefer the server route: it provisions with the Admin SDK, so it works
  // even when the DEPLOYED client rules still deny influencers/humanUsers
  // writes (the usual reason "nothing gets created"). Falls back to direct
  // client writes when the API is unavailable (503 without a service
  // account) — with a hard timeout so it can never stall callers.
  try {
    const authUser = getFirebaseAuth().currentUser;
    if (authUser) {
      const idToken = await authUser.getIdToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch('/api/creators', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          signal: controller.signal,
        });
        if (res.ok) {
          provisioned.add(uid);
          return;
        }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    /* API unavailable → client-side fallback below */
  }

  const db = getDb();
  const cleanEmail = email ? email.replace(/\+web@/, '@') : null;

  // Shared username: derived from the email local part (the hub prompts for
  // one), de-collided against humanUsers with a uid suffix.
  let username = (cleanEmail?.split('@')[0] || `creator${uid.slice(0, 6)}`)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '');
  try {
    const taken = await getDocs(
      query(collection(db, 'humanUsers'), where('username', '==', username), fbLimit(1)),
    );
    if (!taken.empty && taken.docs[0].id !== uid) {
      username = `${username}${uid.slice(0, 4).toLowerCase()}`;
    }
  } catch {
    /* availability check is best-effort */
  }

  /* ── influencers doc (any keying convention counts as existing) ───── */
  let hasInfluencer = false;
  try {
    const { inf } = await resolveInfluencer(db, uid, email);
    hasInfluencer = !!inf;
  } catch {
    /* resolution is best-effort */
  }
  let wroteOk = true;
  if (!hasInfluencer) {
    try {
      await setDoc(
        doc(db, 'influencers', uid),
        {
          uid,
          email: cleanEmail,
          username,
          name: displayName || username,
          profile_picture: photoURL || '',
          date_created: serverTimestamp(),
          is_authenticated: false, // approved later, exactly like the hub
          referral_link: null, // issued at approval (AppsFlyer OneLink)
          referralCode: deriveReferralCode(uid),
        },
        { merge: true },
      );
      hasInfluencer = true;
    } catch (e) {
      wroteOk = false;
      console.warn('influencers doc create failed (check deployed rules):', e);
    }
  }

  /* ── humanUsers doc (backend create_profile shape, Flutter seeding rule) */
  try {
    const huRef = doc(db, 'humanUsers', uid);
    const hu = await getDoc(huRef);
    if (!hu.exists()) {
      await setDoc(huRef, {
        uid,
        email: cleanEmail,
        username,
        name: displayName || username,
        bio: '',
        age: null,
        gender: null,
        profilePicture: photoURL || '',
        user_interests: [],
        blockout: [],
        liked_posts: [],
        followers: [],
        following: [],
        balance: 200, // backend's starting user-side InCash seed
        is_influencer: hasInfluencer,
        date_created: serverTimestamp(),
        // no `createdAt` on purpose — the app's onboarding marker
      });
    } else if (hasInfluencer && (hu.data() as Row).is_influencer !== true) {
      // Existing app user who just became a creator → flip the flag the
      // backend keeps in sync with the influencers collection.
      await setDoc(huRef, { uid, is_influencer: true }, { merge: true });
    }
  } catch (e) {
    wroteOk = false;
    console.warn('humanUsers doc create failed (check deployed rules):', e);
  }

  // Only remember success — failed attempts retry on the next sign-in or
  // /creators visit instead of being silently skipped for the session.
  if (wroteOk) provisioned.add(uid);
}

/** @deprecated superseded by ensureCreatorDocs (kept for old imports). */
export const ensureInfluencerDoc = ensureCreatorDocs;

/* ── Fetch ─────────────────────────────────────────────────────────── */

/** Full creator dashboard for the signed-in user. Always resolves.
 *  Pass { includeContent: false } for lighter loads (e.g. /payouts). */
export async function fetchCreatorDashboard(
  uid: string,
  email: string | null,
  displayName: string | null,
  opts: { includeContent?: boolean } = {},
): Promise<CreatorDashboardData> {
  const includeContent = opts.includeContent !== false;
  if (!uid) return emptyCreatorDashboard(await fetchEconomyConfig());
  const db = getDb();

  // Config + identity resolution have no dependency on each other; every
  // remaining query group fans out concurrently after them.
  const [config, { inf, infDocId, cleanEmail }] = await Promise.all([
    fetchEconomyConfig(),
    resolveInfluencer(db, uid, email),
  ]);
  const data = emptyCreatorDashboard(config);
  const { appUid, candidateIds } = candidatesFrom(inf, infDocId, uid);
  const referralCode = asString(inf?.referralCode) || deriveReferralCode(appUid || uid);

  /* ── Profile / referral link (humanUsers fallbacks in parallel) ───── */
  const profileP = (async (): Promise<CreatorProfile> => {
    let referralLink = asString(inf?.referral_link);
    let humanUser: Row | null = null;
    if (!referralLink) {
      try {
        const snaps = await Promise.all(candidateIds.map((id) => getDoc(doc(db, 'humanUsers', id))));
        for (const snap of snaps) {
          if (!snap.exists()) continue;
          const hu = snap.data() as Row;
          humanUser = humanUser || hu;
          const link = asString(hu.referral_link);
          if (link) {
            referralLink = link;
            break;
          }
        }
      } catch {
        /* humanUsers lookup is non-fatal */
      }
    }
    if (!referralLink) {
      referralLink = appUid ? buildAppsFlyerLink(appUid) : buildReferralLink(referralCode);
    }
    return {
      name:
        asString(inf?.name) ||
        asString(inf?.username) ||
        asString(humanUser?.username) ||
        displayName ||
        cleanEmail?.split('@')[0] ||
        'Creator',
      referralCode,
      referralLink,
      appUid,
    };
  })();

  /* ── Link clicks + conversions ────────────────────────────────────── */
  const statsP = (async () => {
    try {
      const snap = await getDoc(doc(db, 'influencers_referral_stats', referralCode));
      if (snap.exists()) {
        const s = snap.data() as Row;
        return { clicks: (s.clicks as number) || 0, conversions: (s.conversions as number) || 0 };
      }
    } catch {
      /* stats doc is non-fatal */
    }
    return { clicks: 0, conversions: 0 };
  })();

  /* ── Referrals — pending attributions, the join key for earnings ──── */
  const referralsP = (async () => {
    const attributionStartByUser: Record<string, Date | null> = {};
    let total = 0;
    let active24h = 0;
    let inWindow = 0;
    const snaps = await Promise.all(
      candidateIds.map(async (id) => {
        try {
          return await getDocs(query(collection(db, 'referrals'), where('referrerId', '==', id)));
        } catch {
          return null;
        }
      }),
    );
    const seenRefs = new Set<string>();
    const now = new Date();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const snap of snaps) {
      if (!snap) continue;
      snap.docs.forEach((d) => {
        if (seenRefs.has(d.id)) return;
        seenRefs.add(d.id);
        total += 1;
        const r = d.data() as Row;
        const installerId =
          (r.installerId as string) || (r.installer_id as string) || d.id.split('_')[1] || d.id;
        const start =
          toDate(r.attribution_start) ||
          toDate(r.attributedAt) ||
          toDate(r.createdAt) ||
          toDate(r.created_at) ||
          toDate(r.timestamp) ||
          toDate(r.installTime);
        attributionStartByUser[installerId] = start;
        const lastSeen = (r.installerLastSignInTime as number) || 0;
        if (lastSeen > dayAgo) active24h += 1;
        if (!start || isWithinAttributionWindow(start, now, config)) inWindow += 1;
      });
    }
    return { total, active24h, inWindow, expired: total - inWindow, attributionStartByUser };
  })();

  /* ── Ledger — single source of truth for earnings ─────────────────── */
  const ledgerP = (async () => {
    const entries: CommissionEntry[] = [];
    const seen = new Set<string>();
    const snaps = await Promise.all(
      candidateIds.map(async (sid) => {
        try {
          return await getDocs(
            query(
              collection(db, 'ledger_entries'),
              where('stakeholder_type', '==', 'creator'),
              where('stakeholder_id', '==', sid),
              fbLimit(500),
            ),
          );
        } catch {
          return null;
        }
      }),
    );
    for (const snap of snaps) {
      if (!snap) continue;
      snap.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const e = d.data() as Row;
        const createdAt = toDate(e.created_at) || toDate(e.createdAt);
        entries.push({
          id: d.id,
          amount: round2(Number(e.amount) || 0),
          ago: formatTimeAgo(createdAt),
          createdAt,
          channel: asChannel(e.channel),
          source: 'ledger',
        });
      });
    }
    return entries;
  })();

  /* ── Payout records ───────────────────────────────────────────────── */
  const payoutsP = (async () => {
    const records: CreatorPayoutRecord[] = [];
    const snaps = await Promise.all(
      candidateIds.map(async (sid) => {
        try {
          return await getDocs(
            query(
              collection(db, 'payouts'),
              where('stakeholder_type', '==', 'creator'),
              where('stakeholder_id', '==', sid),
            ),
          );
        } catch {
          return null;
        }
      }),
    );
    for (const snap of snaps) {
      if (!snap) continue;
      snap.docs.forEach((d) => {
        if (records.some((p) => p.id === d.id)) return;
        const p = d.data() as Row;
        const status = p.status === 'paid' || p.status === 'failed' ? p.status : 'pending';
        const ps = toDate(p.period_start);
        const pe = toDate(p.period_end);
        const fmt = (x: Date | null) =>
          x ? x.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
        records.push({
          id: d.id,
          period: ps || pe ? `${fmt(ps)}${ps && pe ? ' – ' : ''}${fmt(pe)}` : (p.period as string) || '—',
          amount: round2(Number(p.amount) || 0),
          status,
          createdAt: toDate(p.created_at),
        });
      });
    }
    records.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    return records;
  })();

  /* ── Content metrics (carried over — metrics only, deleted filtered) ─ */
  const contentP = includeContent
    ? (async (): Promise<CreatorContentStats> => {
        const empty: CreatorContentStats = { totalPosts: 0, totalViews: 0, totalLikes: 0, engagementRate: 0, recentPosts: [] };
        try {
          const seenPosts = new Set<string>();
          const rawPosts: { d: Row; id: string }[] = [];
          const snaps = await Promise.all(
            candidateIds.map(async (id) => {
              try {
                return await getDocs(
                  query(collection(db, 'humanPosts'), where('user_document_id', '==', id)),
                );
              } catch {
                return null;
              }
            }),
          );
          for (const snap of snaps) {
            if (!snap) continue;
            snap.docs.forEach((d) => {
              if (seenPosts.has(d.id)) return;
              seenPosts.add(d.id);
              const p = d.data() as Row;
              // Soft-deleted posts stay in the collection — exclude them
              // from the list AND the totals.
              if (isDeletedPost(p)) return;
              rawPosts.push({ d: p, id: d.id });
            });
          }
          let views = 0;
          let likes = 0;
          let comments = 0;
          const posts = rawPosts
            .map(({ d: p, id }) => {
              const nested = (p.post as Row) || {};
              const postViews = (p.viewcount as number) || (p.views as number) || 0;
              const postLikes = (p.likes as number) || 0;
              const inlineComments = Array.isArray(p.comments) ? p.comments.length : 0;
              views += postViews;
              likes += postLikes;
              comments += inlineComments;
              const posted =
                toDate(p.date_posted) || toDate(p.datePosted) || toDate(p.timestamp);
              const text = ((nested.text_content as string) || (p.text_content as string) || '').trim();
              return {
                id,
                title: text ? (text.length > 60 ? `${text.slice(0, 60)}…` : text) : 'Untitled post',
                views: postViews,
                likes: postLikes,
                comments: inlineComments,
                ago: formatTimeAgo(posted),
                posted,
              };
            })
            .sort((a, b) => (b.posted?.getTime() ?? 0) - (a.posted?.getTime() ?? 0));

          // Real comment counts live in postComments/{postId} (hub Overview);
          // fetch them for the recent posts only, in parallel.
          const recent = posts.slice(0, 5);
          try {
            const commentDocs = await Promise.all(
              recent.map((p) => getDoc(doc(db, 'postComments', p.id))),
            );
            commentDocs.forEach((cSnap, i) => {
              if (!cSnap.exists()) return;
              const c = cSnap.data() as { comments?: unknown[] };
              if (Array.isArray(c?.comments)) {
                comments += c.comments.length - recent[i].comments;
                recent[i].comments = c.comments.length;
              }
            });
          } catch {
            /* postComments lookup is non-fatal */
          }

          return {
            totalPosts: posts.length,
            totalViews: views,
            totalLikes: likes,
            engagementRate: views > 0 ? Math.round(((likes + comments) / views) * 100) : 0,
            recentPosts: recent.map(({ posted: _posted, ...rest }) => rest),
          };
        } catch {
          return empty;
        }
      })()
    : null;

  /* ── Assemble ─────────────────────────────────────────────────────── */
  const [profile, stats, refs, ledgerEntries, payoutRecords] = await Promise.all([
    profileP,
    statsP,
    referralsP,
    ledgerP,
    payoutsP,
  ]);

  data.profile = profile;
  data.referrals = {
    total: refs.total,
    active24h: refs.active24h,
    inWindow: refs.inWindow,
    expired: refs.expired,
    clicks: stats.clicks,
    conversions: stats.conversions,
  };
  data.payouts = payoutRecords;

  if (ledgerEntries.length > 0) {
    ledgerEntries.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    const lifetime = round2(ledgerEntries.reduce((s, e) => s + e.amount, 0));
    data.earnings = { lifetime, paid: 0, pending: lifetime, entries: ledgerEntries.slice(0, 12), ledgerLive: true };
  } else {
    /* No ledger yet → conservative ESTIMATE from typed purchases (chunks in
     * parallel; in-game split so the estimate never overstates the ledger). */
    const referredIds = Object.keys(refs.attributionStartByUser);
    const estimates: CommissionEntry[] = [];
    const chunkSnaps = await Promise.all(
      chunk(referredIds, 10)
        .slice(0, 3) // Firestore `in` caps at 10 ids; cap total work
        .map(async (ids) => {
          try {
            return await getDocs(
              query(
                collection(db, 'transactions'),
                where('type', '==', 'purchase'),
                where('user_id', 'in', ids),
              ),
            );
          } catch {
            return null;
          }
        }),
    );
    for (const snap of chunkSnaps) {
      if (!snap) continue;
      snap.docs.forEach((d) => {
        const tx = d.data() as Row;
        const createdAt = toDate(tx.created_at) || toDate(tx.createdAt);
        const start = refs.attributionStartByUser[(tx.user_id as string) || ''];
        // Unknown purchase time or attribution start → count it (best-effort).
        if (start && createdAt && !isWithinAttributionWindow(start, createdAt, config)) return;
        const channel = asChannel(tx.channel) || 'ios';
        const gross = Number(tx.gross_amount) || 0;
        if (gross <= 0) return;
        const split = computeSplit({ gross, channel, spend: 'in_game', referred: true }, config);
        if (split.creator <= 0) return;
        estimates.push({
          id: d.id,
          amount: split.creator,
          ago: formatTimeAgo(createdAt),
          createdAt,
          channel,
          source: 'estimated',
        });
      });
    }
    estimates.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    const lifetime = round2(estimates.reduce((s, e) => s + e.amount, 0));
    data.earnings = { lifetime, paid: 0, pending: lifetime, entries: estimates.slice(0, 12), ledgerLive: false };
  }

  const paid = round2(data.payouts.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0));
  data.earnings.paid = paid;
  data.earnings.pending = Math.max(0, round2(data.earnings.lifetime - paid));

  if (contentP) data.content = await contentP;

  return data;
}
