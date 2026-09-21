/**
 * InZone conversation invite — not a game match join.
 *
 * Games that call InZoneSDK.sendChallenge / openChat (Flutter social-loop)
 * get a playSessions conversation link. Nightclub has no working same-match
 * room API. Kart Host/Join stays inside the Unity lobby and is never this
 * path. Never invent a URL; only return a link after createPlaySession.
 */

export const PLAY_INVITE_CHANNEL = 'inzone-play-invite';
export const PLAY_INVITE_PROTOCOL = 1;
export const GAME_INVITE_BRIDGE_MARKER = '__inzonePlayInvite';

export const INVITE_SCOPE = {
  conversation: 'conversation',
  match: 'match',
} as const;

export type InviteScope = (typeof INVITE_SCOPE)[keyof typeof INVITE_SCOPE];

export const PLAY_INVITE_COPY = {
  conversationHint:
    'This invite joins the InZone conversation — chat and membership. It is not a shared Nightclub match.',
  conversationToast: 'InZone chat invite copied. This is conversation membership, not a shared match.',
  conversationReady: 'Invite is ready, but the link couldn’t be copied. Copy it from the address bar.',
  missingSdkNever:
    'This game cannot complete an invite without the InZone SDK.',
} as const;

/** Games that expose a working in-game room/join we are allowed to call a match. None today. */
export const MATCH_JOIN_GAME_IDS: readonly string[] = Object.freeze([]);

export function inviteScopeForGame(gameId: string): InviteScope {
  return MATCH_JOIN_GAME_IDS.includes(gameId) ? INVITE_SCOPE.match : INVITE_SCOPE.conversation;
}

export type PlayInviteRequest = {
  channel: typeof PLAY_INVITE_CHANNEL;
  v: number;
  id: string;
  type: 'req';
  method: 'sendChallenge' | 'openChat';
  payload?: unknown;
};

export type PlayInviteResponse = {
  channel: typeof PLAY_INVITE_CHANNEL;
  v: number;
  id: string;
  type: 'res';
  ok: boolean;
  result?: PlayInviteResult;
  error?: { code: string; message: string };
};

export type PlayInviteResult = {
  kind: InviteScope;
  matchJoined: false;
  challenge: {
    challengeId: string;
    gameDeepLink: string;
    expiresAt: string;
    status: 'pending';
  };
  share: {
    url: string;
    text: string;
    gameDeepLink: string;
  };
  conversation: {
    conversationId: string;
    participants: string[];
  };
};

export function isPlayInviteRequest(data: unknown): data is PlayInviteRequest {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    d.channel === PLAY_INVITE_CHANNEL &&
    d.v === PLAY_INVITE_PROTOCOL &&
    d.type === 'req' &&
    typeof d.id === 'string' &&
    d.id.length > 0 &&
    d.id.length <= 100 &&
    (d.method === 'sendChallenge' || d.method === 'openChat')
  );
}

export function conversationInviteResult(input: {
  sessionId: string;
  url: string;
  expiresAt: number;
}): PlayInviteResult {
  return {
    kind: INVITE_SCOPE.conversation,
    matchJoined: false,
    challenge: {
      challengeId: input.sessionId,
      gameDeepLink: input.url,
      expiresAt: new Date(input.expiresAt).toISOString(),
      status: 'pending',
    },
    share: {
      url: input.url,
      text: PLAY_INVITE_COPY.conversationHint,
      gameDeepLink: input.url,
    },
    conversation: {
      conversationId: input.sessionId,
      participants: [],
    },
  };
}
