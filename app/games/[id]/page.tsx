'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { fetchApprovedGames, fetchGameById, gameShareLink, gameWebLink } from '@/lib/games';
import {
  addComment,
  fetchCommentCount,
  fetchComments,
  fetchLikeSummary,
  likeComment,
  setLike,
  MAX_COMMENT_LEN,
  type GameComment,
} from '@/lib/engagement';
import {
  getLikedCommentIds,
  resolveIdentity,
  setCommentLiked,
  type Identity,
} from '@/lib/identity';
import { sameOriginGameUrl } from '@/lib/game-hosting';
import type { HubGame } from '@/lib/types';

/* ── Sizing ──────────────────────────────────────────────────────
   The iframe is exactly the visible game area (see .game-frame-body iframe in
   globals.css), so the game sees the same `window.innerWidth/Height` the
   InZone app's WebView gives it — no manual zoom. Games with oversized or
   fixed-size canvases are fitted *inside* the page by the viewport-fit script
   (the same one the Flutter app injects into its WebView — see
   community_game_screen.dart). It reaches the game two ways: baked into the
   entry HTML at upload, and injected at request time by the same-origin /gcs
   route this page loads bucket-hosted games through (which is what covers
   builds uploaded before the script existed). A deployment-wide zoom-out
   escape hatch remains as --game-fit in CSS. */

export default function GamePlayerPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const gameId = id ? decodeURIComponent(id) : '';

  const [game, setGame] = useState<HubGame | null>(null);
  const [loading, setLoading] = useState(true);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sibling games (hub order) — drives the up/down navigation + mobile swipe.
  const [order, setOrder] = useState<string[]>([]);

  // Engagement state.
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [comments, setComments] = useState<GameComment[]>([]);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Comments UI extras: sort order, which comment we're replying to, expanded
  // reply threads, and the viewer's locally-remembered comment likes.
  const [sort, setSort] = useState<'top' | 'newest'>('top');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const composeRef = useRef<HTMLTextAreaElement>(null);

  // Once the user toggles a like, a late-arriving server fetch must NOT clobber
  // their choice (which would look like the like "undoing itself"). Reset per game.
  const likeTouchedRef = useRef(false);
  useEffect(() => { likeTouchedRef.current = false; }, [gameId]);

  // ── Load the game ───────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    setFrameLoaded(false);
    try {
      const g = await fetchGameById(gameId);
      if (!g) {
        setError('Game not found or no longer available.');
        setGame(null);
      } else {
        setGame(g);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load game.');
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => { if (gameId) load(); }, [gameId, load]);

  // ── Sibling order for navigation (fetched once) ──
  useEffect(() => {
    let cancelled = false;
    fetchApprovedGames()
      .then((games) => { if (!cancelled) setOrder(games.map((g) => g.id)); })
      .catch(() => { /* navigation just stays disabled */ });
    return () => { cancelled = true; };
  }, []);

  // ── Resolve who's acting (signed-in user or persistent guest) ──
  useEffect(() => {
    let cancelled = false;
    resolveIdentity(user).then((idn) => { if (!cancelled) setIdentity(idn); });
    return () => { cancelled = true; };
  }, [user]);

  // ── Likes + comment count, refreshed per game + identity ──
  useEffect(() => {
    if (!gameId || !identity) return;
    let cancelled = false;
    fetchLikeSummary(gameId, identity.id).then((s) => {
      if (cancelled) return;
      setLikeCount(s.count);
      if (!likeTouchedRef.current) setLiked(s.liked);
    });
    fetchCommentCount(gameId).then((n) => { if (!cancelled) setCommentCount(n); });
    return () => { cancelled = true; };
  }, [gameId, identity]);

  // ── Prev / next in hub order (wraps around) ──
  const { prevId, nextId } = useMemo(() => {
    if (order.length < 2 || !gameId) return { prevId: null, nextId: null };
    const i = order.indexOf(gameId);
    if (i === -1) return { prevId: null, nextId: null };
    const n = order.length;
    return {
      prevId: order[(i - 1 + n) % n],
      nextId: order[(i + 1) % n],
    };
  }, [order, gameId]);

  const goTo = useCallback((target: string | null) => {
    if (!target || target === gameId) return;
    router.push(`/games/${encodeURIComponent(target)}`);
  }, [router, gameId]);

  // ── Toast helper ─────────────────────────────────────────────────
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // ── Actions ─────────────────────────────────────────────────────
  function handleReplay() {
    setFrameLoaded(false);
    setReloadKey((k) => k + 1);
  }

  async function handleToggleLike() {
    if (!identity || likeBusy) return;
    likeTouchedRef.current = true;
    const next = !liked;
    // Optimistic — snap the UI, reconcile if the write fails.
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setLikeBusy(true);
    try {
      await setLike(gameId, identity, next);
    } catch (e) {
      // Most commonly this means the Firestore rules for the likes
      // subcollection aren't deployed yet — see firestore.rules.
      console.warn('[InZone] like write failed (deploy firestore.rules?):', e);
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
      flashToast("Couldn't save like");
    } finally {
      setLikeBusy(false);
    }
  }

  const openComments = useCallback(async () => {
    setCommentsOpen(true);
    setCommentsLoading(true);
    setLikedComments(getLikedCommentIds(gameId));
    try {
      const list = await fetchComments(gameId);
      setComments(list);
      setCommentCount(list.length);
    } finally {
      setCommentsLoading(false);
    }
  }, [gameId]);

  async function handlePostComment() {
    if (!identity || posting) return;
    const text = draft.trim();
    if (!text) return;
    const parentId = replyTo?.id ?? null;
    setPosting(true);
    setCommentError(null);
    try {
      const created = await addComment(gameId, identity, text, parentId);
      setComments((prev) => [created, ...prev]);
      setCommentCount((c) => c + 1);
      setDraft('');
      if (parentId) setExpanded((s) => new Set(s).add(parentId)); // show the thread we just replied in
      setReplyTo(null);
      requestAnimationFrame(() => autoGrow(composeRef.current));
    } catch (e) {
      setCommentError(e instanceof Error ? e.message : 'Could not post comment.');
    } finally {
      setPosting(false);
    }
  }

  // Optimistic per-comment like toggle. The shared tally moves on the server;
  // the viewer's own "liked" flag is remembered locally (guest-friendly).
  async function handleLikeComment(commentId: string) {
    const next = !likedComments.has(commentId);
    setLikedComments((prev) => {
      const s = new Set(prev);
      if (next) s.add(commentId); else s.delete(commentId);
      return s;
    });
    setComments((prev) => prev.map((c) =>
      c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount + (next ? 1 : -1)) } : c,
    ));
    setCommentLiked(gameId, commentId, next);
    try {
      await likeComment(gameId, commentId, next);
    } catch (e) {
      // Revert on failure (most likely undeployed rules).
      console.warn('[InZone] comment like failed (deploy firestore.rules?):', e);
      setLikedComments((prev) => {
        const s = new Set(prev);
        if (next) s.delete(commentId); else s.add(commentId);
        return s;
      });
      setComments((prev) => prev.map((c) =>
        c.id === commentId ? { ...c, likeCount: Math.max(0, c.likeCount + (next ? -1 : 1)) } : c,
      ));
      setCommentLiked(gameId, commentId, !next);
    }
  }

  function startReply(c: GameComment) {
    setReplyTo({ id: c.parentId ?? c.id, name: c.authorName });
    requestAnimationFrame(() => composeRef.current?.focus());
  }

  // Split comments into top-level (sorted by the chosen order) and replies
  // grouped under their parent (oldest first within a thread).
  const { topLevel, repliesByParent } = useMemo(() => {
    const tops: GameComment[] = [];
    const byParent = new Map<string, GameComment[]>();
    for (const c of comments) {
      if (c.parentId) {
        const arr = byParent.get(c.parentId) ?? [];
        arr.push(c);
        byParent.set(c.parentId, arr);
      } else {
        tops.push(c);
      }
    }
    for (const arr of byParent.values()) {
      arr.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    }
    tops.sort((a, b) => {
      if (sort === 'top' && b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
    return { topLevel: tops, repliesByParent: byParent };
  }, [comments, sort]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  function renderComment(c: GameComment, isReply: boolean) {
    const replies = repliesByParent.get(c.id) ?? [];
    const isLiked = likedComments.has(c.id);
    const open = expanded.has(c.id);
    return (
      <div key={c.id} className={`comment${isReply ? ' reply' : ''}`}>
        <div className="comment-avatar" aria-hidden="true">{initial(c.authorName)}</div>
        <div className="comment-body">
          <div className="comment-meta">
            <span className="comment-author">{c.authorName}</span>
            {c.createdAt && <span className="comment-time">{timeAgo(c.createdAt)}</span>}
          </div>
          <p className="comment-text">{c.text}</p>
          <div className="comment-actions">
            <button
              className={`comment-like${isLiked ? ' liked' : ''}`}
              onClick={() => handleLikeComment(c.id)}
              aria-pressed={isLiked}
              aria-label={isLiked ? 'Unlike comment' : 'Like comment'}
            >
              <HeartIcon filled={isLiked} size={16} />
              {c.likeCount > 0 && <span>{formatCount(c.likeCount)}</span>}
            </button>
            <button className="comment-reply-btn" onClick={() => startReply(c)}>Reply</button>
          </div>
          {!isReply && replies.length > 0 && (
            <button className="comment-replies-toggle" onClick={() => toggleExpanded(c.id)}>
              <span className={`replies-caret${open ? ' open' : ''}`}><ChevronDownIcon /></span>
              {open ? 'Hide replies' : `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
            </button>
          )}
          {!isReply && open && replies.length > 0 && (
            <div className="comment-replies">{replies.map((r) => renderComment(r, true))}</div>
          )}
        </div>
      </div>
    );
  }

  // Share = copy the plain public website link (NOT the app deep link).
  async function handleShare() {
    const url = gameWebLink(gameId);
    try {
      await navigator.clipboard.writeText(url);
      flashToast('Link copied');
    } catch {
      flashToast(url);
    }
  }

  // App = open / share the InZone app deep link, keeping the native share card.
  async function handleOpenApp() {
    const url = gameShareLink(gameId);
    const title = game?.name ? `Play ${game.name} on InZone` : 'Play this game on InZone';
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title, url }); } catch { /* user dismissed */ }
      return;
    }
    // No share sheet (most desktops) → copy the deep link so it can be opened on a phone.
    try {
      await navigator.clipboard.writeText(url);
      flashToast('App link copied');
    } catch {
      window.open(url, '_blank', 'noopener');
    }
  }

  // ── Mobile swipe (drag the screen) via edge gutters over the iframe ──
  const SWIPE_THRESHOLD = 60; // px
  const touchStartY = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) { touchStartY.current = e.touches[0].clientY; }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartY.current = null;
    if (dy <= -SWIPE_THRESHOLD) goTo(nextId);   // swipe up → next
    else if (dy >= SWIPE_THRESHOLD) goTo(prevId); // swipe down → previous
  }

  const navDisabled = !prevId && !nextId;

  return (
    <div className="game-frame-shell">
      <div className="game-frame-body">
        {error ? (
          <div className="empty" style={{ position: 'absolute', inset: 0 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
            <h2>Couldn&apos;t load game</h2>
            <p>{error}</p>
            <button onClick={load} className="btn-primary">Retry</button>
          </div>
        ) : (
          <>
            {game && (
              // `scrolling="no"` only kicks in when a game overflows: it
              // suppresses the iframe's scrollbars. A game that fits the
              // window is completely unaffected (no resize, no clipping).
              <iframe
                ref={iframeRef}
                key={reloadKey}
                src={sameOriginGameUrl(withServerUrl(game.gameUrl, game.serverUrl))}
                title={game.name}
                scrolling="no"
                onLoad={() => setFrameLoaded(true)}
                allow="camera; microphone; geolocation; encrypted-media; autoplay; fullscreen; gamepad; accelerometer; gyroscope"
                allowFullScreen
              />
            )}

            {/* Edge gutters: capture vertical drags to switch games on touch
                devices without stealing taps from the game itself. */}
            {!navDisabled && (
              <>
                <div className="swipe-gutter left" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-hidden="true" />
                <div className="swipe-gutter right" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-hidden="true" />
              </>
            )}

            {(loading || !frameLoaded) && (
              <div className="empty" style={{ position: 'absolute', inset: 0, background: 'var(--bg)', zIndex: 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', borderTop: '4px solid var(--blue-1)', borderRight: '4px solid transparent', borderBottom: '4px solid var(--blue-2)', borderLeft: '4px solid transparent', margin: '0 auto', animation: 'spin 1s linear infinite' }} />
                <p style={{ marginTop: 14 }}>Loading {game?.name ?? 'game'}…</p>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              </div>
            )}
          </>
        )}

        {/* ── Engagement rail (right on desktop, bottom bar on mobile) ── */}
        <div className="game-rail" role="toolbar" aria-label="Game actions">
          <button className="rail-btn" onClick={handleReplay} disabled={!game} aria-label="Replay game">
            <ReplayIcon />
            <span className="rail-cap">Replay</span>
          </button>

          <Link href="/games" className="rail-btn" aria-label="Home">
            <HomeIcon />
            <span className="rail-cap">Home</span>
          </Link>

          <button
            className={`rail-btn${liked ? ' active' : ''}`}
            onClick={handleToggleLike}
            disabled={!game || !identity}
            aria-pressed={liked}
            aria-label={liked ? 'Unlike game' : 'Like game'}
          >
            <HeartIcon filled={liked} />
            <span className="rail-cap">{formatCount(likeCount)}</span>
          </button>

          <button className="rail-btn" onClick={openComments} disabled={!game} aria-label="Comments">
            <CommentIcon />
            <span className="rail-cap">{formatCount(commentCount)}</span>
          </button>

          <button className="rail-btn" onClick={handleShare} disabled={!game} aria-label="Copy share link">
            <LinkIcon />
            <span className="rail-cap">Share</span>
          </button>

          <button className="rail-btn" onClick={handleOpenApp} disabled={!game} aria-label="Open in InZone app">
            <AppIcon />
            <span className="rail-cap">App</span>
          </button>

          <div className="rail-nav">
            <button className="rail-btn nav" onClick={() => goTo(prevId)} disabled={!prevId} aria-label="Previous game">
              <ChevronUpIcon />
            </button>
            <button className="rail-btn nav" onClick={() => goTo(nextId)} disabled={!nextId} aria-label="Next game">
              <ChevronDownIcon />
            </button>
          </div>
        </div>

        {toast && <div className="share-toast" role="status">{toast}</div>}
      </div>

      {/* ── Comments panel ── */}
      {commentsOpen && (
        <>
          <div className="comments-backdrop" onClick={() => setCommentsOpen(false)} />
          <aside className="comments-panel" aria-label="Comments">
            <header className="comments-head">
              <div className="comments-title">
                <h2>Comments</h2>
                <span className="comments-count">{formatCount(commentCount)}</span>
              </div>
              <div className="comments-head-actions">
                <div className="sort-wrap">
                  <button
                    className="icon-btn"
                    onClick={() => setSortMenuOpen((o) => !o)}
                    aria-haspopup="menu"
                    aria-expanded={sortMenuOpen}
                    aria-label="Sort comments"
                  >
                    <SortIcon />
                  </button>
                  {sortMenuOpen && (
                    <>
                      <div className="sort-menu-backdrop" onClick={() => setSortMenuOpen(false)} />
                      <div className="sort-menu" role="menu">
                        <button role="menuitemradio" aria-checked={sort === 'top'} className={sort === 'top' ? 'active' : ''} onClick={() => { setSort('top'); setSortMenuOpen(false); }}>
                          Top {sort === 'top' && <CheckIcon />}
                        </button>
                        <button role="menuitemradio" aria-checked={sort === 'newest'} className={sort === 'newest' ? 'active' : ''} onClick={() => { setSort('newest'); setSortMenuOpen(false); }}>
                          Newest {sort === 'newest' && <CheckIcon />}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button className="icon-btn" onClick={() => setCommentsOpen(false)} aria-label="Close comments">
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="comments-list">
              {commentsLoading ? (
                <div className="comments-empty">Loading…</div>
              ) : topLevel.length === 0 ? (
                <div className="comments-empty">No comments yet. Be the first!</div>
              ) : (
                topLevel.map((c) => renderComment(c, false))
              )}
            </div>

            <div className="comments-compose">
              {replyTo && (
                <div className="reply-banner">
                  Replying to <b>{replyTo.name}</b>
                  <button className="reply-cancel" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                    <CloseIcon />
                  </button>
                </div>
              )}
              {identity && (
                <div className="compose-as">
                  Commenting as <b>{identity.username}</b>
                  {identity.anonymous && <span className="guest-tag">guest</span>}
                </div>
              )}
              {commentError && <div className="compose-err">{commentError}</div>}
              <div className="compose-row">
                <textarea
                  ref={composeRef}
                  className="compose-input"
                  placeholder={replyTo ? `Reply to ${replyTo.name}…` : 'Add a comment…'}
                  value={draft}
                  rows={1}
                  maxLength={MAX_COMMENT_LEN}
                  onChange={(e) => { setDraft(e.target.value); autoGrow(e.target); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); }
                  }}
                />
                <button
                  className="compose-send"
                  onClick={handlePostComment}
                  disabled={posting || !draft.trim() || !identity}
                  aria-label="Post comment"
                >
                  {posting ? <span className="compose-spin" aria-hidden="true" /> : <SendIcon />}
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/** Append `?serverUrl=…` to the game's gameUrl so the client iframe can read
 *  it from `window.location.search` and dial the right multiplayer backend.
 *  Skips appending when serverUrl is empty (single-player game). */
function withServerUrl(gameUrl: string, serverUrl: string): string {
  if (!gameUrl) return gameUrl;
  if (!serverUrl) return gameUrl;
  try {
    const u = new URL(gameUrl);
    u.searchParams.set('serverUrl', serverUrl);
    return u.toString();
  } catch {
    const sep = gameUrl.includes('?') ? '&' : '?';
    return `${gameUrl}${sep}serverUrl=${encodeURIComponent(serverUrl)}`;
  }
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`.replace('.0', '');
  return `${(n / 1_000_000).toFixed(1)}M`.replace('.0', '');
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function ReplayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function HeartIcon({ filled, size = 22 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="6" y1="12" x2="18" y2="12" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/** Grow a comment textarea to fit its content, up to the CSS max-height. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
}

function CommentIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function AppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}
