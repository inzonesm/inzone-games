import { HexclaveClientApp } from "@hexclave/next";
import { wrapHexclaveAnalyticsTransport } from "@/lib/campaign-analytics";

// Analytics-only Hexclave client. Auth is handled by Firebase (see lib/firebase.ts);
// this app object exists so the SDK can record $page-view / $click events and
// session replays. A persistent token store is required for analytics capture.
// Automatic page/click batches are rewritten so session URLs and chat text
// never reach ingest (see wrapHexclaveAnalyticsTransport).
//
// Preview deploys often omit HEXCLAVE_PROJECT_ID (it is production-only on Vercel).
// Constructing HexclaveClientApp without a UUID throws during `next build`
// page-data collection, so skip analytics when the id is missing. Production
// keeps the existing env-driven client.
function createHexclaveClientApp() {
  try {
    const app = new HexclaveClientApp({
      tokenStore: "nextjs-cookie",
      urls: {
        default: {
          type: "hosted",
        },
      },
    });
    wrapHexclaveAnalyticsTransport(app);
    return app;
  } catch {
    return null;
  }
}

export const hexclaveClientApp = createHexclaveClientApp();
