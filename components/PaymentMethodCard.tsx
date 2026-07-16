'use client';

/* Payout method card — the one payment-details widget, shared by /payouts
 * and /settings so both pages present the exact same inputs (port of the
 * hub's PaymentInformationCard). Bank routes via Stripe; PayPal and Venmo
 * route via PayPal. Details persist to influencers/{uid}/private/paymentInfo
 * with the method type mirrored onto the influencer doc (lib/payouts.ts). */

import { useEffect, useState, type CSSProperties } from 'react';
import {
  loadPaymentInfo,
  savePaymentInfo,
  type PaymentInfo,
  type PaymentMethodType,
} from '@/lib/payouts';

const mono: CSSProperties = { fontFamily: "'Geist Mono', monospace" };
const iconBox: CSSProperties = { width: 40, height: 40, borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', flexShrink: 0 };

export function PaymentMethodCard({
  uid,
  onSaved,
  bare = false,
}: {
  uid: string;
  onSaved?: () => void;
  /** true → no .card wrapper (for embedding in the Settings form column). */
  bare?: boolean;
}) {
  const [info, setInfo] = useState<PaymentInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState<PaymentMethodType>('bank');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadPaymentInfo(uid).then((i) => {
      if (cancelled) return;
      setInfo(i);
      if (i) {
        setMethod(i.paymentMethod);
        setFields({
          bankName: i.bankName || '', accountHolder: i.accountHolder || '',
          accountNumber: i.accountNumber || '', routingNumber: i.routingNumber || '',
          paypalEmail: i.paypalEmail || '', venmoUsername: i.venmoUsername || '',
        });
      }
    });
    return () => { cancelled = true; };
  }, [uid]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await savePaymentInfo(uid, { paymentMethod: method, ...fields });
      setInfo({ paymentMethod: method, ...fields });
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save payment info.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [k]: e.target.value }));
  const inputStyle: CSSProperties = { height: 36, fontSize: 13 };

  const methodLabel = { bank: 'Bank account · via Stripe', paypal: 'PayPal', venmo: 'Venmo' } as const;

  const body = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <div style={{ ...iconBox, color: 'var(--blue-1)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h2" /></svg>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: '-0.015em' }}>Payout method</div>
          <div style={{ marginTop: 3, ...mono, fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
            {info ? methodLabel[info.paymentMethod] : 'bank / PayPal / Venmo · monthly, 15th'}
          </div>
        </div>
        <span style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 999, ...mono, fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', background: info ? 'oklch(0.78 0.14 155 / 0.15)' : 'var(--bg-3)', color: info ? 'var(--pos)' : 'var(--ink-3)', border: '1px solid var(--line)' }}>
          {info ? 'Configured' : 'Not set up'}
        </span>
      </div>

      {!editing ? (
        <>
          <p style={{ margin: '0 0 14px', color: 'var(--ink-2)', fontSize: 13.5, lineHeight: 1.5 }}>
            {info
              ? 'Payouts transfer to this account automatically on the 15th. Bank routes via Stripe; PayPal and Venmo route via PayPal.'
              : 'Add a payout method to receive automated monthly transfers of your developer and creator earnings.'}
          </p>
          <button className="btn-ghost" style={{ height: 36, fontSize: 13 }} onClick={() => setEditing(true)} type="button">
            {info ? 'Update method' : 'Set up payouts'}
          </button>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field">
            <span className="field-label">Method</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodType)} style={inputStyle}>
              <option value="bank">Bank account (Stripe)</option>
              <option value="paypal">PayPal</option>
              <option value="venmo">Venmo</option>
            </select>
          </label>
          {method === 'bank' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field"><span className="field-label">Bank name</span>
                  <input className="input" style={inputStyle} value={fields.bankName || ''} onChange={set('bankName')} /></label>
                <label className="field"><span className="field-label">Account holder</span>
                  <input className="input" style={inputStyle} value={fields.accountHolder || ''} onChange={set('accountHolder')} /></label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field"><span className="field-label">Account number</span>
                  <input className="input" style={inputStyle} value={fields.accountNumber || ''} onChange={set('accountNumber')} inputMode="numeric" /></label>
                <label className="field"><span className="field-label">Routing number</span>
                  <input className="input" style={inputStyle} value={fields.routingNumber || ''} onChange={set('routingNumber')} inputMode="numeric" /></label>
              </div>
            </>
          )}
          {method === 'paypal' && (
            <label className="field"><span className="field-label">PayPal email</span>
              <input className="input" style={inputStyle} type="email" value={fields.paypalEmail || ''} onChange={set('paypalEmail')} /></label>
          )}
          {method === 'venmo' && (
            <label className="field"><span className="field-label">Venmo username</span>
              <input className="input" style={inputStyle} value={fields.venmoUsername || ''} onChange={set('venmoUsername')} /></label>
          )}
          {error && <div style={{ ...mono, fontSize: 11, color: 'var(--neg)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" style={{ height: 36, fontSize: 13 }} onClick={() => void save()} disabled={busy} type="button">
              {busy ? 'Saving…' : 'Save method'}
            </button>
            <button className="btn-ghost" style={{ height: 36, fontSize: 13 }} onClick={() => setEditing(false)} disabled={busy} type="button">
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );

  return bare ? <div>{body}</div> : <article className="card">{body}</article>;
}
