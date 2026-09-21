# InZone / Rook — approved visual and motion handoff

Approved by Jayme on September 21, 2026. Temporary name: Rook.

## Files
- concept-board.png: approved material, silhouette, and placement direction. Illustrative game imagery is NOT a game asset or a redesign of Nightclub.
- motion-preview.html: interactive motion reference. Open in a browser; starts in Speaking. No mic or provider requests. Speech motion is simulated.
- ribbon-renderer.js: the exact procedural reference used in the approved expressive prototype. This is prototype source, not a production React component.
- design-tokens.json: proposed implementation values drawn from the approved prototype.
- CURSOR-PROMPT.md: integration instruction.

## Approval boundary
The final expressive version is approved: visible folding/opening and travelling deformation, not the earlier static/speed-only variants. Keep the larger silhouette changes and smooth transitions. The render is a procedural interpretation of the sculptural concept; the concept's material fidelity remains the target. No new approval loop for minor implementation tuning. Product-wide redesign is a subsequent visual review, not authorized production changes.

## Visual contract
Pearl/silver ribbon, icy cyan edge light, restrained violet reflections. Compact recognizable open knot, not a sphere or robot face. Dark graphite surfaces, quiet typography, sparse controls. Preserve gameplay area and pointer targets. Do not use concept-board game imagery as a shipped screenshot.

Resting: low-energy breathing.
Listening: visibly opens toward the user; show capture status truthfully.
Thinking: continuous travelling twist, no loading spinner and no simulated progress.
Speaking: expressive folds driven by actual output audio energy; settles between phrases.
Muted/ended: restrained static silhouette and explicit status. Muting capture is distinct from stopping speech; controls must say which action they perform.
Error/disconnected: stable pose with a concise actionable status, not perpetual thinking.

## Production animation binding
The demo's sine-wave speaking envelope is ONLY a motion sample. Replace it with a smoothed amplitude envelope from the actual audio output, where available. Suggested starting envelope: 70–100 ms attack, 180–280 ms release. Tune to the approved visual; cap deformation so it never jumps or flashes. Do not access microphone before consent. Do not create a second mic stream solely for animation.

Transition shape weights with frame-rate-independent damping; prototype k=3.1/sec. Maintain continuous accumulated twist phase, so changing states does not snap orientation. Begin speaking motion only with real playback, not text generation or a successful fetch. Silence reduces expression. Stop/interruption cancels playback immediately; visual settling must not delay cancellation. Provider fallback without analysable output must use an honestly playback-bound restrained motion rather than claimed audio reactivity.

## Responsive and performance contract
Prototype presence approximately 60–76 CSS px in its shelf; adapt smaller only when still legible. Preserve a 44px accessible control target. Captions optional; no chat input required. Choose a stable reserved host area or verified safe gutter; never shrink/remount the iframe on each state change. No animated layout dimensions. Avoid covering game HUD or recovery.

The demo CPU mesh is not a production performance prescription. Profile on a phone while a real game runs. Use cached geometry, adaptive resolution and a modest frame budget; pause rendering offscreen/backgrounded and dispose all resources on unmount. One ribbon renderer per player. Reduced motion uses static state silhouettes; no forced loop. Text status must remain accessible independently of color or motion. A static fallback should survive renderer failure.

## Test only what matters
Actual game play + mic conversation + interruption + invite remain functional. Verify iframe AND document identity across state changes; no focus stealing, canvas stretch, stale listeners, or duplicate audio nodes. Confirm controls remain reachable in portrait/landscape with keyboard and safe-area insets. Use the current PR's functional checks, not a second test framework.

## Wider InZone design — next review
Use the same palette/material/motion discipline across: arrival/discovery, active gameplay with companion, inviting/joining friends, conversation, and returning. Start with arrival/discovery and show desktop plus phone layouts before changing product code. Feature real supported titles; no fake player counts, promises of shared match state, progress restoration or invented game art presented as shipped content. Preserve useful solo play and optional social expansion. Premium means a coherent hierarchy and deliberate behavior, not extra glow or glass on every surface.

