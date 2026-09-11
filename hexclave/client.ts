import { HexclaveClientApp } from "@hexclave/next";

// Analytics-only Hexclave client. Auth is handled by Firebase (see lib/firebase.ts);
// this app object exists so HexclaveProvider can serialize toClientJson for the
// browser. The Provider reconstructs a distinct client via fromClientJson; that
// reconstructed app is the one that sends $page-view / $click. Campaign events
// bind to it with useHexclaveApp(). Do not construct a second HexclaveClientApp
// for ingest — wrapping this module instance never sees Provider batches.
//
// Preview deploys often omit HEXCLAVE_PROJECT_ID (it is production-only on Vercel).
// Constructing HexclaveClientApp without a UUID throws during `next build`
// page-data collection, so skip analytics when the id is missing. Production
// keeps the existing env-driven client.
function createHexclaveClientApp() {
  try {
    return new HexclaveClientApp({
      tokenStore: "nextjs-cookie",
      urls: {
        default: {
          type: "hosted",
        },
      },
    });
  } catch {
    return null;
  }
}

export const hexclaveClientApp = createHexclaveClientApp();
