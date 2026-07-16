/* Re-export shim — the canonical admin allow-list lives in lib/admin-shared.ts
 * (hub emails + jshim777@terpmail.umd.edu). Kept so either import path works. */
export { ADMIN_EMAILS, isAdminEmail } from './admin-shared';
