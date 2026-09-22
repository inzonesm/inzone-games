# Component, motion and responsive contract

## Foundations
Graphite background #090e13; surfaced panels #111a22; raised #17222c; boundary #2a3945; primary text #eff3f5; secondary #a8b8c5; pearl action #d8e8ef; cyan accent #93d9e4. Art supplies color; do not glow every card. Body uses the existing site's supported sans family. Serif display prototype uses system Georgia, avoiding a new font dependency. Scale 4/8/12/16/20/24/32/48px. Card radius 18px, feature 24px, controls pill.

## Components
AppHeader: stable identity, Play, active conversation, search and guest identity. No empty permanent friends sidebar. Actual account/friends navigation requires its own verified product flow.
GameCard: approved artwork with fixed aspect; name/category; primary Play; secondary Invite or Suggest while in a session. Never make all card surfaces conflicting click targets. No made-up counts. Loading skeleton holds dimensions; absent artwork uses an abstract neutral placeholder with title alt text.
ConversationStrip: actual members only; ongoing conversation survives discovery navigation. 'Open chat' and Leave. Name overflow truncates visually with full accessible name. Do not equate heartbeat presence with verified gameplay.
InviteDialog: focus trap, dismiss/Escape, return focus to trigger. Session creation pending/error/retry; only offer Copy after actual success. Clipboard rejection offers selectable link. Do not expose raw session values in analytics.
RecipientCard: invitation validity checked before membership; actual inviter/game data; explicit join; missing/expired/revoked states. No side-effectful joining on page view.
PlayerStage: reuse the existing mounted game. Prototype intentionally uses a placeholder; do NOT replace actual gameplay with this surface. Its composition expresses spatial relationships only. Never re-render/remount iframe to animate UI.
ConversationDock: desktop width 300px only if sufficient game space remains; otherwise overlay/sheet chosen from available game area and title constraints. Prototype shows a stacked mobile conversation for review; production should offer a collapsed unread chip and explicit sheet rather than adding document scroll to a live fixed player. On-screen keyboard must not shrink/reinitialize the game engine. Closing chat restores deliberate focus; don't focus-loop during speech.
RookPresence: approved expressive animation at roughly 48–76px. Primary voice action; actual mic state. Secondary settings expandable. No unsafe overflow. Mic mute and audio stop are separate states. Rook remains available alone or in a conversation; group conversation listening is NOT implied.
ReturnCard: browser-local last game record, separate conversation validity check. No claim of restoring score or progress. An unavailable conversation offers a fresh invite.

## Motion
Hover: lift game card 3px over 320ms, art 1.025 scale over 550ms. Never shift surrounding layout. Buttons 180ms color/border transition. Screen entry 6px/opacity over 320ms; no loading delays added for theatrical effect. Production persistent social strip stays mounted across navigation, not replaying its entrance each time.
Invite dialog: backdrop fade 160ms, surface ease-out 220ms, max translate 8px. Participant join: one restrained 200ms reveal; do not repeatedly pulse presence. New messages: 120ms fade only when relevant; do not steal scroll from someone reading history. Unread uses label/count sourced from actual messages, not fake notifications.
Rook: use approved expressive renderer. Real playback amplitude envelope (initial tuning 85ms attack/230ms release), actual speaking state; reduced motion is static state silhouette. Never use the prototype's ambient fallback breathing as fake speech.
Reduced motion: eliminate translations, scaling and perpetual decorative loops. State/content remains immediate and accessible. Background/offscreen renderers pause.

## Responsive
Desktop >1000px: header 48px side inset, three equal cards, conversation 300px beside usable stage. 701–1000px: 28px inset, tighter cards, optional 270px conversation only when title remains usable. <=700px: 20px inset, horizontal-art list cards, 44px touch targets, clear title then actions, no miniature desktop. At 320px every action must wrap without clipping. Safe area applied in fixed player/footer when integrated; this document preview is not fixed.
Do not force landscape or squeeze games into a phone-shaped slot. Use actual title input/orientation requirements and verified stage sizing. Conversations don't establish shared game state.

## States that integration must bind
Catalogue loading/empty/error/retry; game unavailable; session creating/error; invite valid/expired/revoked/full if supported; join pending/error; connected/reconnecting/disconnected; member leave; send pending/retry; voice permissions/unsupported/listening/thinking/speaking/muted/interrupted/error; return record stale. These are contracts, not claims the standalone prototype implements all backend branches.

## Acceptance
Solo starts without account/friend wall. Two isolated users deliberately join. Both exchange persisted messages. Suggest does not switch. Self switch preserves conversation and the other user's game. Leave actually revokes prior-room access. Expired links recover cleanly. Voice works while playing without layout overflow. No iframe/document replacement on state or caption updates. Verify real mobile/Safari separately from viewport emulation. Screen-reader status and keyboard flows stay usable. No QA user/chat transcript in product analytics.
