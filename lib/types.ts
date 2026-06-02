export type HubGameSource = 'community' | 'simula';

export interface CommunityGameDoc {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  /** WebSocket endpoint for multiplayer games (wss://…). Empty for single-player. */
  serverUrl: string;
  uploaderId: string;
  createdAt: number | null;
}

/** A game as seen by its owner on the "My Games" management page — includes
 *  moderation status and engine so the developer can see Unity builds that are
 *  still pending a runtime, not just the publicly-approved ones. */
export interface DeveloperGame {
  /** Firestore doc id (the slug). Stable — editing the display name leaves it unchanged. */
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  serverUrl: string;
  engine: 'html5' | 'unity';
  status: string;
  createdAt: number | null;
}

export interface HubGame {
  id: string;
  source: HubGameSource;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
  /** Passed through to the iframe as `?serverUrl=…` so multiplayer clients know where to dial. */
  serverUrl: string;
  iconFallback?: string;
}
