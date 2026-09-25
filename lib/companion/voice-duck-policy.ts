/**
 * Pure voice-turn → game-duck policy for Rook.
 *
 * The game ducks (not mutes) while anyone is talking: Rook speaking, a
 * turn in flight (fetching/thinking), or the user audibly speaking
 * (interim result seen, final not yet). Quiet hands-free listening leaves
 * the game at full volume — ducking the whole session would make every
 * game feel muted, which is not what the phone test complained about.
 * Muted voice or voice off never ducks.
 */

export type VoiceDuckState = {
  voiceEnabled: boolean;
  muted: boolean;
  /** Rook's TTS is currently playing. */
  speaking: boolean;
  /** A playTurn is in flight (fetching the reply / about to speak). */
  turnActive: boolean;
  /** Interim speech seen since the last final result. */
  userSpeaking: boolean;
};

export function shouldDuckGameAudio(state: VoiceDuckState): boolean {
  if (!state.voiceEnabled || state.muted) return false;
  return state.speaking || state.turnActive || state.userSpeaking;
}
