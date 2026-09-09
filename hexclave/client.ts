import { HexclaveClientApp } from "@hexclave/next";

// Analytics-only Hexclave client. Auth is handled by Firebase (see lib/firebase.ts);
// this app object exists so the SDK can record $page-view / $click events and
// session replays. A persistent token store is required for analytics capture.
export const hexclaveClientApp = new HexclaveClientApp({
  tokenStore: "nextjs-cookie",
  urls: {
    default: {
      type: "hosted",
    },
  },
});
