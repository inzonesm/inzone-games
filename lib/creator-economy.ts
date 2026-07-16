'use client';

/* Creator & developer economy — the config-driven revenue-split engine from
 * the InZone Creator Platform backend brief (July 2026).
 *
 * The one governing principle: NO payout is ever owed until a coin is
 * actually spent. Creator earnings are a commission on realized coin spend
 * by referred users — never a flat bounty on signups, ads, or posts.
 *
 * Every rate lives in the Firestore `config` collection so economics can be
 * changed without a deploy; the constants below are only fallbacks. All
 * splits are computed on NET revenue (after the app-store cut), and the
 * developer's number never moves based on referral status — the creator
 * commission comes out of the platform's share.
 *
 * Worked example this engine must reproduce to the penny (brief §3):
 *   $10 iOS purchase, referred user, spent in-game →
 *   fee $3.00 · dev $5.60 · creator $0.35 · platform $1.05 (sums to $10). */

import { collection, getDocs } from 'firebase/firestore';
import { getDb } from './firebase';

export type Channel = 'ios' | 'android' | 'web';
export type TransactionType = 'purchase' | 'in_game_spend' | 'platform_spend';
/** Where the purchased coins end up being consumed. */
export type SpendContext = 'in_game' | 'platform';

export interface EconomyConfig {
  /** Developer share of net on coins spent inside their game (0.80). */
  devShare: number;
  /** Platform share of net on in-game spend — the remainder (0.20). */
  platformShareInGame: number;
  /** Creator commission — % of the PLATFORM's net take, never the dev's (0.25). */
  creatorCommission: number;
  /** Months from a referred user's signup during which their purchases credit the creator (12). */
  attributionWindowMonths: number;
  /** Gross → net factor per purchase channel (ios/android store cut vs web processing). */
  netFactors: Record<Channel, number>;
}

export const DEFAULT_ECONOMY_CONFIG: EconomyConfig = {
  devShare: 0.8,
  platformShareInGame: 0.2,
  creatorCommission: 0.25,
  attributionWindowMonths: 12,
  netFactors: { ios: 0.7, android: 0.7, web: 0.97 },
};

/** Round to cents, half-up. Splits must reconcile to the penny (brief §3).
 *  toPrecision(12) shakes off binary float dust first (9.70 × 0.25 evaluates
 *  to 2.4249999…, which must round to 2.43, not 2.42). */
export function round2(n: number): number {
  return Math.round(Number((n * 100).toPrecision(12))) / 100;
}

/* ── Config (Firestore `config` collection, keys per the brief §8) ──
 * Docs are { key, value } (or doc.id as the key). Missing keys fall back to
 * the defaults above; a denied/missing collection falls back entirely. */
export async function fetchEconomyConfig(): Promise<EconomyConfig> {
  const cfg: EconomyConfig = {
    ...DEFAULT_ECONOMY_CONFIG,
    netFactors: { ...DEFAULT_ECONOMY_CONFIG.netFactors },
  };
  try {
    const snap = await getDocs(collection(getDb(), 'config'));
    snap.docs.forEach((d) => {
      const data = d.data() as Record<string, unknown>;
      const key = (data.key as string) || d.id;
      const value = Number(data.value);
      if (!isFinite(value)) return;
      switch (key) {
        case 'dev_share': cfg.devShare = value; break;
        case 'platform_share_ingame': cfg.platformShareInGame = value; break;
        case 'creator_commission': cfg.creatorCommission = value; break;
        case 'attribution_window_months': cfg.attributionWindowMonths = value; break;
        case 'net_factor_ios': cfg.netFactors.ios = value; break;
        case 'net_factor_android': cfg.netFactors.android = value; break;
        case 'net_factor_web': cfg.netFactors.web = value; break;
      }
    });
  } catch {
    /* config collection not readable yet → defaults */
  }
  return cfg;
}

/* ── Split computation ────────────────────────────────────────────── */

export interface SplitInput {
  /** Gross fiat purchase amount (sticker price). */
  gross: number;
  /** Purchase channel — materially changes net (brief §1). */
  channel: Channel;
  /** Where the coins are spent: a developer's game or platform features. */
  spend: SpendContext;
  /** Was the purchasing user referred by a creator, within their window? */
  referred: boolean;
}

export interface SplitResult {
  gross: number;
  /** App-store cut (ios/android) or payment processing (web). */
  storeFee: number;
  net: number;
  /** Developer leg — 0 for platform-feature spend. Never affected by `referred`. */
  developer: number;
  /** The platform's take BEFORE any creator commission is drawn from it. */
  platformBase: number;
  /** Creator commission — drawn from platformBase, 0 if not referred. */
  creator: number;
  /** What the platform keeps after the creator commission. */
  platform: number;
}

/** Gross → net for a channel. */
export function netFromGross(gross: number, channel: Channel, cfg: EconomyConfig = DEFAULT_ECONOMY_CONFIG): number {
  return round2(gross * (cfg.netFactors[channel] ?? 1));
}

/**
 * The revenue waterfall for one purchase. Reconciles to the penny:
 * gross === storeFee + developer + creator + platform, and the developer
 * number is identical whether or not the user was referred.
 */
export function computeSplit(input: SplitInput, cfg: EconomyConfig = DEFAULT_ECONOMY_CONFIG): SplitResult {
  const gross = round2(input.gross);
  const net = netFromGross(gross, input.channel, cfg);
  const storeFee = round2(gross - net);

  // Developer leg exists only for in-game spend, computed from net —
  // independent of referral status by design (brief §2).
  const developer = input.spend === 'in_game' ? round2(net * cfg.devShare) : 0;
  const platformBase = round2(net - developer);

  // Creator commission comes out of the platform's share, never the dev's.
  const creator = input.referred ? round2(platformBase * cfg.creatorCommission) : 0;
  const platform = round2(platformBase - creator);

  return { gross, storeFee, net, developer, platformBase, creator, platform };
}

/* ── Attribution window (brief §2/§5) ─────────────────────────────── */

export function attributionWindowEnd(attributionStart: Date, cfg: EconomyConfig = DEFAULT_ECONOMY_CONFIG): Date {
  const end = new Date(attributionStart);
  end.setMonth(end.getMonth() + cfg.attributionWindowMonths);
  return end;
}

/**
 * Does a purchase at `at` credit the creator, given the referred user's
 * signup time? A signup alone creates only a PENDING attribution — no money
 * moves until a purchase lands inside this window.
 */
export function isWithinAttributionWindow(
  attributionStart: Date,
  at: Date,
  cfg: EconomyConfig = DEFAULT_ECONOMY_CONFIG,
): boolean {
  return at >= attributionStart && at <= attributionWindowEnd(attributionStart, cfg);
}

/* Verified against the brief §3 worked examples — all three reconcile to the
 * penny and the developer share is invariant to referral status. */
