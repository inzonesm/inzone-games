import { defineHexclaveConfig } from "@hexclave/next";

// Hexclave is used for analytics only. Authentication stays on Firebase Auth,
// so no Hexclave auth app or auth settings are enabled here.
export const config = defineHexclaveConfig({
  apps: {
    installed: {
      analytics: { enabled: true },
    },
  },
});
