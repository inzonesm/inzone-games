# InZone: social discovery and play — design kit v1

Open index.html after extracting the ZIP. It is a working local interaction prototype, not a live InZone app. No credentials, APIs, microphone, analytics, invites or game engines are called. The journey selector is a design-review control and MUST NOT ship. Names and messages are fixtures.

## What this changes
Social interaction is part of each game choice, not an isolated footer banner. An active conversation persists above discovery and beside gameplay. Switching a game changes one person's game; it never changes the other person's game. Alone is a complete starting state with curated games and optional Rook. People are invited deliberately, not invented to make the page look busy.

## Connected states
1. Arrive alone: three curated choices, Play and Invite on each. No fake presence.
2. Invite: explains conversation membership; production must mint a real playSession before claiming link creation.
3. Join: recipient sees inviter, game and what joining does before explicitly joining. Guest name is a proposed UI field: use actual supported guest identity handling during integration.
4. Together: persistent participant context + independent game + conversation. Demo chat exists only in memory.
5. Switch: retain conversation/messages; suggest does not move either player. Choosing moves only self.
6. Return: reopen last game, separately check last conversation. No saved progress, waiting friends, or guaranteed membership implied.
7. Expired: offer a new solo game without a dead end.

## Deliverables
- index.html / styles.css / app.js: responsive component and interaction reference.
- assets/icons.svg and six individual icon-*.svg files: editable interface icons.
- assets/ribbon-mark.svg: static Rook fallback, not replacement for approved animated source.
- assets/cover-*.svg: abstract placeholder art only; never market this as actual game graphics.
- assets/rook-approved-renderer.js: approved expressive procedural motion reference from the previous handoff. DOM-bound prototype; port deliberately.
- tokens.json: design/motion/responsive tokens.
- COMPONENTS.md: layout, motion and behavior contract.
- ASSET-MANIFEST.json: file purpose, approval boundary and replacement requirements.
- CURSOR-PROMPT.md: integration instructions.
- previews/: captured browser screenshots when verification succeeds.

## Artwork completeness
UI assets are provided as editable files. Official game artwork is NOT supplied by this kit. Use catalogue-approved thumbnails/posters after validating title/build correspondence. Nightclub, Karate and Elytra labels demonstrate layout; Karate and Elytra gameplay acceptance is not established by this prototype. Kart and Escape Road are not secretly removed from production; the prototype simply does not recommend unresolved journeys. Never promote a title solely because this mockup includes it.

Do not crop the earlier generated concept board to make game thumbnails. Its gameplay imagery was illustrative and is not a faithful representation of shipped games.

## What is intentionally outside this slice
Account social graph, persistent friends/follows, shared voice rooms, cross-device resume, synchronized multiplayer and model tool actions are not implemented by this prototype. Use existing supported conversation/session APIs. A 'social' visual does not grant these capabilities.

The static Rook footer previews placement only. Production must use the approved expressive animation driven by real mic/model/playback state, with no autonomous microphone activation.
