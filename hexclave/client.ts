import { HexclaveClientApp } from "@hexclave/next";

// Analytics-only Hexclave client. Auth is handled by Firebase (see lib/firebase.ts);
// this app object exists so HexclaveProvider can serialize toClientJson for the
// browser. The Provider reconstructs a distinct client via fromClientJson; that
// reconstructed app is the one that sends $page-view / $click. Campaign events
// bind to it with useHexclaveApp(). Construct one app per consented request and
// pass that instance to the Provider — wrapping a different module instance
// never sees Provider batches.
//
// Preview deploys often omit HEXCLAVE_PROJECT_ID (it is production-only on Vercel).
// Constructing HexclaveClientApp without a UUID throws during `next build`
// page-data collection, so skip analytics when the id is missing. Production
// keeps the existing env-driven client.
//
// Hexclave's SDK defaults session replay to on. We pass explicit flags from
// the visitor's tracking choice; both stay false until that choice is granted.
export function createHexclaveClientApp(options?: { analytics?: boolean; replay?: boolean }) {
  try {
    return new HexclaveClientApp({
      tokenStore: "nextjs-cookie",
      urls: {
        default: {
          type: "hosted",
        },
      },
      analytics: {
        enabled: Boolean(options?.analytics),
        replays: { enabled: Boolean(options?.replay) },
      },
    });
  } catch {
    return null;
  }
}

/** Build-safe disabled instance. Live requests use createHexclaveClientApp from consent. */
export const hexclaveClientApp = createHexclaveClientApp({ analytics: false, replay: false });
