/* Admin allow-list — shared by the client (nav/page gating) and the
 * /api/admin route (real enforcement). Ported from the hub backend's
 * is_admin() (app.py) with jshim777@terpmail.umd.edu added; the +web@
 * variants mirror the hub's dual-account email convention. The API route
 * additionally honors humanUsers/{email}.isAdmin like the hub does. */

export const ADMIN_EMAILS = [
  'contact@inzone.ai',
  'contact+web@inzone.ai',
  'inzonesm@gmail.com',
  'inzonesm+web@gmail.com',
  'inzonesm@outlook.com',
  'inzonesm+web@outlook.com',
  'jshim777@terpmail.umd.edu',
  'jshim777+web@terpmail.umd.edu',
] as const;

/** Static allow-list check (hub is_admin, minus the Firestore fallback). */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.includes('+web@') ? email.replace('+web@', '@') : email;
  return (ADMIN_EMAILS as readonly string[]).includes(email)
    || (ADMIN_EMAILS as readonly string[]).includes(normalized);
}
