# Unified InZone: first build

## Direction

InZone helps people have a good time through games, with company optional. The first audience hypothesis is recent graduates aged roughly 22–28 whose friends are dispersed and who struggle to coordinate playing together. Validate this with participants; it is not a proven market segment.

Lead with a small selection of ambitious, polished games. A visitor must get value alone before anyone accepts an invitation. Friends, conversation and optional agents should improve the activity without adding setup. Never invent human presence, popularity, multiplayer support or agent capabilities.

For developers, the proposed value is more people actually playing, returning and bringing others into a game. Treat that as a hypothesis to measure against ordinary distribution, not a guaranteed uplift. An upload form alone does not deliver that promise.

## This pull request

An isolated discovery prototype at `/games/preview-unified` uses the approved Firebase catalogue and links into the existing player. It offers a selected game, immediate Play links, search, honest invitation copy, responsive desktop/mobile layouts, and loading/error/empty states. Campaign UTMs carry into the player; session secrets do not.

This is a foundation for review, not the complete social product. Existing homepage, player, sessions, auth, rules, payments and measurement adapters are unchanged. No new agent, shared match, account continuity or native-to-web progress transfer is implemented. The catalogue's current first item is not an editorial endorsement or a Hexclave flagship selection.

The route is noindex and returns 404 when VERCEL_ENV=production. Vercel previews enable it; local development requires INZONE_UNIFIED_PREVIEW=1. Do not merge for a public launch without a separate release decision. Existing root analytics behavior is inherited; this does not resolve the outstanding consent or ingestion work.

## Next vertical slice

Select one actual Hexclave build and verify its browser/device requirements, first meaningful action, load/ready/error signals, pause/end signals, supported solo mode and genuine multiplayer semantics. Obtain permitted artwork, controls and a stable build version. Do not market unspecified future games as available.

Build and test: arrival → meaningful solo play → optional invitation → friend joins supported experience → return to play. Preserve game state when social UI opens. For games without shared state, describe shared chat and independent play accurately. An agent teammate or opponent requires an explicit game integration and visible AI labeling; defer it until such an integration exists.

Evaluate Next.js and Flutter web against that same slice before choosing a migration. Compare cold-load cost, input latency, browser compatibility, accessibility, deep links and maintainability. Do not port the entire native screen inventory by default.

## Validation

Recruit a small initial group in the audience hypothesis, including people arriving alone. Observe unaided game choice, first play, recovery from a failed load, invitation, return navigation and understanding of what is shared. Check desktop keyboard/mouse and physical iPhone/Android touch; viewport emulation is not device proof.

Measure time to verified first action, load failures, verified engaged visits, successful invite joins and next-day return, separated by acquisition and game/build. Distinguish rounds from people. Treat replay canvas blanks as capture limitations unless correlated with actual failures. Check queryable analytics before relying on funnel counts.

For the developer proposition, compare an explicitly defined distribution baseline with InZone: verified players, retention and invite-attributed new players. Record sample sizes and acquisition differences; do not infer causal uplift from an uncontrolled comparison.

## Review gates

1. Visual and interaction review of this discovery foundation.
2. One real flagship integration and solo-first end-to-end usability.
3. Supported social interaction and honest instrumentation.
4. Measured iteration with users before extending the catalogue or social surface.

Ads, production deployment, native releases and backend migrations are outside this draft.
