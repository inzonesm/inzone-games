export type HubGameSource = 'community' | 'simula';

export interface CommunityGameDoc {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  gameUrl: string;
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
  iconFallback?: string;
}
