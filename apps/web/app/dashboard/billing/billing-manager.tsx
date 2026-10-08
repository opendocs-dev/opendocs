'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { BillingResponse } from '@/lib/server-api';
import { formatPlanName } from '../usage-format';

export interface BillingManagerProps {
  initialBilling: BillingResponse;
}

export function BillingManager({ initialBilling }: BillingManagerProps) {
  const [billing] = useState<BillingResponse>(initialBilling);

  // Invoice details form state
  const [email, setEmail] = useState(initialBilling.invoice_details?.email ?? '');
  const [company, setCompany] = useState(initialBilling.invoice_details?.company ?? '');
  const [taxId, setTaxId] = useState(initialBilling.invoice_details?.tax_id ?? '');
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [invoiceMessage, setInvoiceMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Cancellation and Plan Change states
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelMessage, setCancelMessage] = useState<string | null>(null);
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  // Selected credit pack
  const [selectedPack, setSelectedPack] = useState<number>(1000);

  const { subscription, payment_method, invoices, portal_url, ai_credits } = billing;
  const isPaid = subscription.plan === 'enterprise' || subscription.plan === 'pro';
  const isCanceled = subscription.status === 'canceled' || subscription.status === 'canceled_at_period_end';

  const handleOpenPortal = async () => {
    if (portal_url) {
      window.open(portal_url, '_blank') || (window.location.href = portal_url);
      return;
    }
    setIsOpeningPortal(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/v1/billing/portal', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'Failed to open payment portal');
      }
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank') || (window.location.href = data.url);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to open payment portal';
      setPortalError(msg);
    } finally {
      setIsOpeningPortal(false);
    }
  };

  const handleSaveInvoiceDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingDetails(true);
    setInvoiceMessage(null);

    try {
      const res = await fetch('/api/v1/billing/invoice-details', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, company, tax_id: taxId }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || 'Failed to save invoice details');
      }

      setInvoiceMessage({ text: 'Invoice details saved successfully.', isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save invoice details';
      setInvoiceMessage({ text: msg, isError: true });
    } finally {
      setIsSavingDetails(false);
    }
  };

  const renderBadge = () => {
    switch (subscription.status) {
      case 'active':
        return <span className="badge badge-ok">Active</span>;
      case 'past_due':
        return <span className="badge badge-warn">Past due</span>;
      case 'canceled_at_period_end':
        return <span className="badge badge-warn">Canceled (active until period end)</span>;
      case 'canceled':
        return <span className="badge badge-bad">Canceled</span>;
      case 'free':
      default:
        return <span className="badge badge-muted">Free</span>;
    }
  };

  return (
    <div className="stack">
      <div className="adm-pane-header">
        <div>
          <h1>Billing</h1>
          <div style={{ color: 'var(--a-muted)', fontSize: 13 }}>Only owners can see this page</div>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--a-muted)' }}>
            Payment is handled by our payment provider, so card details are never entered here.
          </p>
        </div>
        {isPaid && (
          <button
            type="button"
            onClick={handleOpenPortal}
            disabled={isOpeningPortal}
            className="btn"
            aria-label="Open payment portal"
          >
            {isOpeningPortal ? 'Opening portal...' : 'Open payment portal'}
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ marginLeft: 6, verticalAlign: 'middle' }}
            >
              <path d="M11 3h2v2M8 8l5-5M13 9v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
            </svg>
          </button>
        )}
      </div>

      {portalError && (
        <p className="msg msg-bad" role="alert">
          {portalError}
        </p>
      )}

      {cancelMessage && (
        <p className="msg" role="status">
          {cancelMessage}
        </p>
      )}

      {/* Grid 1: Subscription and Payment Method */}
      <div className="grid2">
        {/* Card 1: Subscription */}
        <div className="card">
          <h3>Subscription</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{formatPlanName(subscription.plan)}</span>
            {renderBadge()}
          </div>

          <div style={{ marginTop: 8, fontSize: 14 }}>
            {isPaid ? (
              subscription.status === 'past_due' ? (
                <p className="msg warn" role="alert">
                  Payment is past due. Please update your payment method to keep your subscription active.
                </p>
              ) : subscription.status === 'canceled_at_period_end' ? (
                <p style={{ color: 'var(--a-warn)' }}>
                  Subscription canceled. Access continues until {subscription.next_invoice_date || 'end of period'}.
                </p>
              ) : (
                <p style={{ color: 'var(--a-muted)' }}>
                  Billed monthly.{subscription.next_invoice_date ? ` Next invoice on ${subscription.next_invoice_date}.` : ''}
                </p>
              )
            ) : (
              <p style={{ color: 'var(--a-muted)' }}>
                You are on the Free plan. Upgrade to unlock extra storage, AI credits, and custom domains.
              </p>
            )}
          </div>

          <div className="btns" style={{ marginTop: 16 }}>
            {isPaid ? (
              <>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowChangePlan((prev) => !prev)}
                >
                  Change plan
                </button>
                {!isCanceled && (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setShowCancelConfirm(true)}
                  >
                    Cancel subscription
                  </button>
                )}
              </>
            ) : (
              <Link href="/dashboard/plan" className="btn btn-primary">
                Choose Pro
              </Link>
            )}
          </div>

          {/* Confirm Cancel Flow */}
          {showCancelConfirm && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--a-bad)',
                background: 'var(--a-bad-bg)',
              }}
            >
              <p style={{ fontWeight: 600, color: 'var(--a-bad)', margin: '0 0 6px' }}>
                Are you sure you want to cancel your subscription?
              </p>
              <p style={{ fontSize: 13, margin: '0 0 12px', color: 'var(--a-bad)' }}>
                Cancellations are completed in the customer portal. You will retain access until the end of your billing cycle.
              </p>
              <div className="btns">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={isOpeningPortal}
                  onClick={async () => {
                    await handleOpenPortal();
                    setShowCancelConfirm(false);
                    setCancelMessage('Complete cancellation in the payment portal. Access continues until the end of your billing cycle.');
                  }}
                >
                  {isOpeningPortal ? 'Opening portal...' : 'Continue to portal'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowCancelConfirm(false)}
                >
                  Keep subscription
                </button>
              </div>
            </div>
          )}

          {/* Change Plan Flow */}
          {showChangePlan && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--a-line)',
                background: 'var(--a-bg)',
              }}
            >
              <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Manage subscription or upgrade:</p>
              <div className="btns" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  disabled={isOpeningPortal}
                  className="btn btn-primary"
                >
                  {isOpeningPortal ? 'Opening portal...' : 'Manage in payment portal'}
                </button>
                <a
                  href="mailto:sales@example.com"
                  className="btn"
                >
                  Contact sales for Enterprise
                </a>
                <Link href="/dashboard/plan" className="btn">
                  Compare all plans
                </Link>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowChangePlan(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Card 2: Payment Method */}
        <div className="card">
          <h3>Payment method</h3>
          <div style={{ marginTop: 8 }}>
            {payment_method?.brand && payment_method?.last4 ? (
              <div className="stack" style={{ gap: 4 }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {payment_method.brand} ending {payment_method.last4}
                </div>
                <div style={{ fontSize: 13, color: 'var(--a-muted)' }}>
                  Expires {String(payment_method.exp_month).padStart(2, '0')}/{payment_method.exp_year}
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--a-muted)', fontSize: 14 }}>
                No payment method on file.
              </div>
            )}
          </div>
          {isPaid && (
            <div className="btns" style={{ marginTop: 16 }}>
              <button
                type="button"
                onClick={handleOpenPortal}
                disabled={isOpeningPortal}
                className="btn"
              >
                {isOpeningPortal ? 'Opening portal...' : 'Update in payment portal'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Grid 2: Invoice details and Add AI credits */}
      <div className="grid2">
        {/* Card 3: Invoice details */}
        <div className="card">
          <h3>Invoice details</h3>
          <form onSubmit={handleSaveInvoiceDetails} className="stack" style={{ gap: 12, marginTop: 8 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Send invoices to</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="billing@example.com"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Company name</span>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={120}
                placeholder="Acme Corp"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>Tax ID</span>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                maxLength={40}
                placeholder="US123456789 or EU VAT"
              />
            </label>

            {invoiceMessage && (
              <p
                className={invoiceMessage.isError ? 'msg warn' : 'msg'}
                role={invoiceMessage.isError ? 'alert' : 'status'}
              >
                {invoiceMessage.text}
              </p>
            )}

            <div className="btns">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSavingDetails}
              >
                {isSavingDetails ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>

        {/* Card 4: Add AI credits */}
        <div className="card">
          <h3>Add AI credits</h3>
          <p className="sub" style={{ margin: '4px 0 12px' }}>
            Extra credits are added to this month and expire with it. 1 credit = 1 reply.
          </p>

          <div className="stack" style={{ gap: 8 }}>
            {ai_credits.packs.map((pack) => (
              <label key={pack.credits} className="radio-label">
                <input
                  type="radio"
                  name="credit_pack"
                  value={pack.credits}
                  checked={selectedPack === pack.credits}
                  onChange={() => setSelectedPack(pack.credits)}
                />
                <span>
                  <strong>{pack.credits.toLocaleString()} credits</strong>
                  <small>{pack.price}</small>
                </span>
              </label>
            ))}
          </div>

          <div className="btns" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled
              title="Price to be set"
            >
              Buy credits
            </button>
          </div>
        </div>
      </div>

      {/* Card 5: Invoices */}
      <div className="card">
        <h3>Invoices</h3>
        {billing.invoices_unavailable ? (
          <p className="sub" style={{ marginTop: 8, color: 'var(--a-warn)' }}>
            Invoices are temporarily unavailable. Please check the payment portal.
          </p>
        ) : invoices.length === 0 ? (
          <p className="sub" style={{ marginTop: 8 }}>
            No invoices yet.
          </p>
        ) : (
          <div className="tw" style={{ marginTop: 8 }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Number</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th className="num">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>{inv.date}</td>
                    <td>{inv.number}</td>
                    <td className="num">{inv.amount}</td>
                    <td>
                      <span className="badge badge-ok">
                        {inv.status === 'paid' ? 'Paid' : inv.status}
                      </span>
                    </td>
                    <td className="num">
                      {inv.pdf_url ? (
                        <a
                          href={inv.pdf_url}
                          className="btn"
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: '2px 8px', fontSize: 12 }}
                        >
                          Download PDF
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
