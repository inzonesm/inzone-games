Continue InZone's web SDK integration. Read docs/handoff/WEB_SDK_HANDOFF.md on
branch docs/web-sdk-handoff in inzonesm/inzone-games first. That is the cross-account
handoff; do not require the previous chat or its local files.

You own frontend integration in inzonesm/inzone-games, targeting main. Backend source
is inzonesm/inzone-backend on game-analytics, not main. PRs #8, #9, #10 are merged.
Check for the separate host-side checkout client PR and reuse its implementation;
do not duplicate it or rebuild saves, purchases, receipts or inventory.

Deliver one bounded PR connecting the versioned browser SDK to a trusted host:
existing Firebase auth, isolated iframe communication, catalog-driven host purchase
confirmation, cancellation, persisted request IDs, receipt recovery and inventory.
Keep Hexclave analytics-only. Preserve existing games, hosting and working SDK
features. No Flutter work or broad discovery redesign in this PR.

Inspect current source and make the necessary implementation decisions yourself.
Exercise the real iframe/hosting path in a browser with an already working game,
and verify payment behavior using safe fixtures/emulator. Test spoofed messages,
account/game changes, cancellation, uncertain request recovery and relative assets.
Publish integration instructions, a minimal example and an accurate capability list.
Do not claim the full SDK is production-ready based only on mock tests.

Use authenticated GitHub connector tools if gh is unauthenticated. Do not repeat
known access failures or ask me to move artifacts between accounts. Publish a real
reviewable PR, with exact head SHA, actual tests and screenshots. Do not merge,
deploy, enable checkout flags or make live charges. Finish with the precise review
prompt I should give Claude and the remaining release condition, if any.
