'use client';

import type { CatalogOfferPrompt } from '@/lib/game-sdk/purchase-session';

export function PurchaseConfirmDialog({
  prompt,
  signedIn,
  busy,
  onConfirm,
  onCancel,
}: {
  prompt: CatalogOfferPrompt;
  signedIn: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sdk-confirm-backdrop" role="presentation">
      <div
        className="sdk-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sdk-confirm-title"
        data-testid="purchase-confirm"
      >
        <h2 id="sdk-confirm-title">Confirm purchase</h2>
        <p className="sdk-confirm-copy">This charge uses your InZone coin balance. The game cannot set the price.</p>
        <dl className="sdk-confirm-details">
          <div>
            <dt>Item</dt>
            <dd data-testid="confirm-title">{prompt.title}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd data-testid="confirm-price">{prompt.coins} {prompt.currency}</dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd data-testid="confirm-quantity">{prompt.quantity}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{prompt.kind}</dd>
          </div>
        </dl>
        {!signedIn && (
          <p className="sdk-confirm-auth" data-testid="confirm-signin">Sign in with your InZone account to complete this purchase.</p>
        )}
        <div className="sdk-confirm-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy} data-testid="confirm-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy || !signedIn}
            data-testid="confirm-buy"
          >
            {busy ? 'Working…' : 'Buy'}
          </button>
        </div>
      </div>
    </div>
  );
}
