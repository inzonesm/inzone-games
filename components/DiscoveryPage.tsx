'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { DiscoveryCard } from '@/components/DiscoveryCard';
import { DiscoveryInvite } from '@/components/DiscoveryInvite';
import { DiscoveryRook } from '@/components/DiscoveryRook';
import {
  DiscoveryChatSheet,
  DiscoveryConversationStrip,
  DiscoveryRecipient,
  joinErrorCopy,
  useDiscoverySession,
} from '@/components/DiscoverySocial';
import { CAMPAIGN_EVENTS, mergeAttributionSearch, trackCampaignEvent } from '@/lib/campaign-analytics';
import {
  DISCOVERY_COPY,
  DISCOVERY_PACE,
  type DiscoveryPace,
  filterDiscoveryGames,
  gamesForDiscoveryFeatured,
} from '@/lib/discovery';
import { fetchApprovedGames } from '@/lib/games';
import { isPlaySessionId, PLAY_SESSION_COPY } from '@/lib/play-session-core';
import type { HubGame } from '@/lib/types';

export function DiscoveryPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuth();
  const sessionFromUrl = (search.get('session') || '').trim();
  const sessionId = isPlaySessionId(sessionFromUrl) ? sessionFromUrl : null;

  const [games, setGames] = useState<HubGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pace, setPace] = useState<DiscoveryPace | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [inviteGame, setInviteGame] = useState<HubGame | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [tab, setTab] = useState<'play' | 'friends' | 'you'>('play');
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [dismissRecipient, setDismissRecipient] = useState(false);

  const session = useDiscoverySession(sessionId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await fetchApprovedGames();
      setGames(items);
      if (items.length === 0) setError('No games available right now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load games.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    trackCampaignEvent(CAMPAIGN_EVENTS.discoverView);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const featured = useMemo(() => gamesForDiscoveryFeatured(games), [games]);
  const featuredIds = useMemo(() => featured.map((game) => game.id), [featured]);
  const byId = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const browse = useMemo(() => {
    if (!pace && !query.trim()) return [];
    return filterDiscoveryGames(games, {
      query,
      pace: pace || 'all',
      excludeIds: pace === 'all' || query.trim() ? [] : featuredIds,
    });
  }, [games, pace, query, featuredIds]);

  const rookGame = featured[0] || byId.get(session.gameId) || null;
  const sessionGame = (session.gameId && byId.get(session.gameId)) || inviteGame || rookGame;
  const youLabel = user?.displayName?.split(/\s+/)[0] || user?.email?.[0]?.toUpperCase() || 'Y';
  const inviter = session.members.find((member) => member.actorId !== user?.uid) || session.members[0];
  const showRecipient =
    Boolean(sessionId) &&
    !session.joined &&
    !dismissRecipient &&
    (session.error === 'expired' || session.error === 'ended' || session.error === null || session.error === 'invalid');

  function rememberSession(next: { sessionId: string; gameId: string }) {
    const path = mergeAttributionSearch(`/games?session=${next.sessionId}`);
    router.replace(path);
  }

  function openInvite(game: HubGame) {
    setInviteGame(game);
    setTab('friends');
  }

  function openFriends() {
    setTab('friends');
    if (sessionId && session.joined) {
      setChatOpen(true);
      return;
    }
    if (sessionId && !session.joined) {
      setDismissRecipient(false);
      return;
    }
    const target = rookGame;
    if (target) setInviteGame(target);
  }

  return (
    <div className="discovery" data-testid="discovery">
      <header className="discovery-header">
        <Link href="/games" className="discovery-wordmark" onClick={() => setTab('play')}>
          INZONE<span aria-hidden="true">●</span>
        </Link>
        <nav className="discovery-nav" aria-label="Discovery">
          <button
            type="button"
            className={tab === 'play' ? 'is-active' : ''}
            onClick={() => setTab('play')}
          >
            Play
          </button>
          <button
            type="button"
            className={tab === 'friends' ? 'is-active' : ''}
            onClick={openFriends}
          >
            Friends
          </button>
        </nav>
        <button
          type="button"
          className="discovery-icon-btn discovery-search-btn"
          aria-label="Search games"
          onClick={() => setSearchOpen((open) => !open)}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="discovery-avatar discovery-you"
          aria-label="You"
          onClick={() => setTab('you')}
        >
          {youLabel.slice(0, 1)}
        </button>
      </header>

      {sessionId && session.joined ? (
        <DiscoveryConversationStrip
          members={session.members}
          onOpen={() => setChatOpen(true)}
          onLeave={() => {
            void session.leave().then(() => {
              router.replace('/games');
              setChatOpen(false);
            }).catch((err) => {
              console.warn('leavePlaySession failed', err instanceof Error ? err.message : err);
            });
          }}
        />
      ) : null}

      {searchOpen ? (
        <div className="discovery-search" data-testid="discovery-search">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={DISCOVERY_COPY.searchPlaceholder}
            aria-label="Search games"
          />
        </div>
      ) : null}

      <main className="discovery-main">
        {showRecipient ? (
          <DiscoveryRecipient
            game={sessionGame}
            inviterName={inviter?.actorName || 'Someone'}
            expired={session.error === 'expired' || session.error === 'ended'}
            joining={joinBusy}
            error={joinError || (session.error === 'invalid' ? joinErrorCopy(session.error) : null)}
            onJoin={() => {
              setJoinBusy(true);
              setJoinError(null);
              void session
                .join()
                .then(() => {
                  setJoinBusy(false);
                  setChatOpen(true);
                })
                .catch((err) => {
                  setJoinBusy(false);
                  setJoinError(PLAY_SESSION_COPY.joinFailed);
                });
            }}
            onExplore={() => {
              setDismissRecipient(true);
              setTab('play');
            }}
          />
        ) : null}

        {tab === 'you' ? (
          <section className="discovery-you-panel" data-review-surface="you">
            <span className="discovery-eyebrow">You</span>
            <h1>{user?.displayName || 'Guest'}</h1>
            <p>Alone is a complete starting state. Sign-in is only needed for studio tools.</p>
            {user && !user.isAnonymous ? (
              <p className="discovery-note">{user.email}</p>
            ) : (
              <Link href="/login?next=%2Fgames" className="discovery-play">
                Sign in
              </Link>
            )}
          </section>
        ) : (
          <>
            <section className="discovery-intro">
              <h1>{DISCOVERY_COPY.headline}</h1>
              <p>{DISCOVERY_COPY.lede}</p>
            </section>

            {loading && games.length === 0 ? (
              <div className="discovery-grid" aria-busy="true">
                <div className="discovery-card is-skeleton" />
                <div className="discovery-card is-skeleton" />
                <div className="discovery-card is-skeleton" />
              </div>
            ) : error && games.length === 0 ? (
              <div className="discovery-empty">
                <h2>No games yet</h2>
                <p>{error}</p>
                <button type="button" className="discovery-play" onClick={() => void load()}>
                  Retry
                </button>
              </div>
            ) : (
              <>
                {featured.length > 0 && !query.trim() && pace !== 'all' ? (
                  <section className="discovery-grid" aria-label="Featured games">
                    {featured.map((game) => (
                      <DiscoveryCard key={game.id} game={game} onInvite={openInvite} />
                    ))}
                  </section>
                ) : null}

                <section className="discovery-pace" aria-label={DISCOVERY_COPY.paceTitle}>
                  <h2>{DISCOVERY_COPY.paceTitle}</h2>
                  <div className="discovery-pace-row">
                    {DISCOVERY_PACE.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`discovery-pace-tile${pace === item.id ? ' is-active' : ''}`}
                        onClick={() => setPace((current) => (current === item.id ? null : item.id))}
                      >
                        <PaceIcon id={item.id} />
                        <strong>{item.title}</strong>
                        <span>{item.line}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {browse.length > 0 ? (
                  <section className="discovery-browse" aria-label="Games">
                    {browse.map((game) => (
                      <DiscoveryCard
                        key={`browse-${game.id}`}
                        game={game}
                        onInvite={openInvite}
                        layout="list"
                      />
                    ))}
                  </section>
                ) : null}

                <section className="discovery-company">
                  <div>
                    <h2>{DISCOVERY_COPY.companyTitle}</h2>
                    <p>{DISCOVERY_COPY.companyLede}</p>
                  </div>
                  <button
                    type="button"
                    className="discovery-play"
                    onClick={() => (rookGame ? openInvite(rookGame) : openFriends())}
                  >
                    {DISCOVERY_COPY.inviteFriend}
                  </button>
                </section>
              </>
            )}
          </>
        )}
      </main>

      <DiscoveryRook gameId={rookGame?.id} gameName={rookGame?.name} />

      <nav className="discovery-dock" aria-label="Primary">
        <button type="button" className={tab === 'play' ? 'is-active' : ''} onClick={() => setTab('play')}>
          Play
        </button>
        <button type="button" className={tab === 'friends' ? 'is-active' : ''} onClick={openFriends}>
          Friends
        </button>
        <button type="button" className={tab === 'you' ? 'is-active' : ''} onClick={() => setTab('you')}>
          You
        </button>
      </nav>

      {inviteGame ? (
        <DiscoveryInvite
          game={inviteGame}
          existingSessionId={sessionId}
          onClose={() => setInviteGame(null)}
          onCreated={(created) => {
            rememberSession(created);
          }}
        />
      ) : null}

      {chatOpen && sessionGame ? (
        <DiscoveryChatSheet
          gameId={sessionGame.id}
          sessionId={sessionId}
          onClose={() => setChatOpen(false)}
          onPlayGame={(id) => router.push(`/games/${encodeURIComponent(id)}`)}
        />
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m15 15 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PaceIcon({ id }: { id: DiscoveryPace }) {
  if (id === 'quick') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8v5l3 2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (id === 'action') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M13 3 6 14h6l-1 7 7-11h-6l1-7z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  if (id === 'explore') {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="m9 15 2-6 6-2-2 6z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
