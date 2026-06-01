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
