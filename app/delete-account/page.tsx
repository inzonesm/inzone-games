import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { AccountDeletionPanel } from '@/components/AccountDeletionPanel';
import styles from './delete-account.module.css';

/* Public account-deletion page declared to Google Play and the App Store.
 * Everything except the sign-in panel is static HTML so it can be read
 * without JavaScript and without an InZone account. Keep the lists below
 * in sync with inzone-backend docs/ACCOUNT_DELETION.md. */

export const metadata: Metadata = {
  title: 'Delete your InZone account',
  description:
    'Request deletion of your InZone account and data without reinstalling the app. Operated by InZone, INC.',
  alternates: { canonical: 'https://inzone.games/delete-account' },
  robots: { index: true, follow: true },
};

const CONTACT = 'contact@inzone.ai';

export default function DeleteAccountPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="InZone home">
          <Logo size={28} />
          <span>InZone</span>
        </Link>
      </header>

      <main className={styles.main}>
        <p className={styles.kicker}>InZone app · Account deletion</p>
        <h1 className={styles.title}>Delete your InZone account</h1>
        <p className={styles.lede}>
          This page is for the <strong>InZone</strong> app on Google Play and the App Store, operated by{' '}
          <strong>InZone, INC.</strong> (Riverdale, Maryland, USA). You can delete your account here without
          installing the app, or in the app under <em>Settings → Manage Account</em>.
        </p>

        <section className={styles.steps} aria-label="How it works">
          <ol>
            <li><strong>Sign in</strong> below with the account you want to delete. Signing in is how we verify the account is yours; we never act on a request made only with an email address.</li>
            <li><strong>Confirm the request.</strong> Your profile and posts are hidden from other people immediately.</li>
            <li><strong>30-day grace period.</strong> Sign in again and choose <em>Keep my account</em> any time before the date shown to cancel.</li>
            <li><strong>Permanent deletion</strong> starts automatically when the 30 days end and normally finishes within a day. Failed steps are retried automatically and escalated to our team.</li>
          </ol>
        </section>

        <AccountDeletionPanel />

        <section className={styles.section}>
          <h2>What is deleted</h2>
          <ul>
            <li>Your sign-in (email/password, Google or Apple link) and profile: name, username, photo, bio, followers and following.</li>
            <li>Your posts, reposts, comments, likes, and photos and videos you uploaded.</li>
            <li>Messages you sent in direct and group chats, and your chat history with AI characters, including voice-chat transcripts.</li>
            <li>Your coin balance, inventory, referral history, notifications and in-app feedback.</li>
            <li>Push-notification tokens for your devices, and your profile in our recommendation system.</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>What is kept, and why</h2>
          <ul>
            <li>
              <strong>Purchase records</strong>: the product, price, platform and date of each purchase, with the store
              receipt stored only as a one-way fingerprint. We keep these to handle refunds and chargebacks and to meet
              tax and accounting obligations. They are not linked to your profile, posts or messages, which are deleted.
            </li>
            <li>
              <strong>Reports</strong> you filed or that were filed about your account, where needed to investigate
              abuse and keep people safe.
            </li>
            <li>
              <strong>Messages other people sent you.</strong> Those belong to the people who wrote them and stay in
              their conversations. Your own messages are removed and your name no longer appears as a member.
            </li>
            <li>
              <strong>Records held by Google Play, the App Store and our payment processor</strong> for purchases you
              made. Those companies keep them under their own terms; contact them to request deletion there.
            </li>
          </ul>
          <p className={styles.muted}>
            If you use the same sign-in for another InZone, INC. product (Little Chapters, or publishing games on
            inzone.games), your InZone app data is still deleted, but we keep that sign-in so the other product keeps
            working and contact you to confirm before removing it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Can&apos;t sign in?</h2>
          <ul>
            <li>Forgot your password? Use <em>Forgot password?</em> above to get a reset link, then come back here.</li>
            <li>
              Lost access to the Google or Apple account you signed up with? Email{' '}
              <a href={`mailto:${CONTACT}?subject=InZone%20account%20deletion`}>{CONTACT}</a> <strong>from the email
              address on your InZone account</strong> with the subject &quot;InZone account deletion&quot;. We reply to
              that address to confirm before deleting anything, and we do not act on requests sent from any other
              address.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Delete some data without closing your account</h2>
          <p>
            You can delete individual posts in the app at any time. To ask for other specific data to be
            deleted while keeping your account, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address on
            your account.
          </p>
        </section>

        <footer className={styles.footer}>
          <p>InZone, INC. · Riverdale, Maryland 20737, USA · <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
        </footer>
      </main>
    </div>
  );
}
