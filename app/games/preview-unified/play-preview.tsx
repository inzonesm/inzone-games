'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchApprovedGames } from '@/lib/games';
import type { HubGame } from '@/lib/types';
import styles from './play-preview.module.css';

function Cover({ game, large = false }: { game: HubGame; large?: boolean }) {
  const src = game.preview?.posterUrl || game.iconUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && !failed ? (
    // Catalogue assets retain the existing image delivery model.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" onError={() => setFailed(true)} loading={large ? 'eager' : 'lazy'} />
  ) : <span className={styles.coverFallback} aria-hidden="true">{game.name.slice(0, 1)}</span>;
}

export default function PlayPreview() {
  const [games, setGames] = useState<HubGame[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [attribution, setAttribution] = useState('');

  useEffect(() => {
    const query = new URLSearchParams();
    const incoming = new URLSearchParams(window.location.search);
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = incoming.get(key);
      if (value) query.set(key, value);
    }
    setAttribution(query.toString());
  }, []);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    fetchApprovedGames().then(items => {
      if (!active) return;
      setGames(items);
      setSelected(current => items.some(g => g.id === current) ? current : items[0]?.id || '');
      setStatus('ready');
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [attempt]);

  const game = games.find(g => g.id === selected);
  const visibleGames = games.filter(g => g.name.toLowerCase().includes(search.trim().toLowerCase()));
  const playHref = (id: string) => '/games/' + encodeURIComponent(id) + (attribution ? '?' + attribution : '');

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#play-main">Skip to games</a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/games">INZONE<span> / PLAY</span></Link>
        <span className={styles.preview}>Design preview</span>
        <Link className={styles.catalogueLink} href="/games">Current Game Hub ↗</Link>
      </header>
      <main id="play-main" className={styles.main}>
        <div className={styles.intro}>
          <div><p className={styles.eyebrow}>A little competition. A good time.</p><h1>Your next<br />“one more round.”</h1></div>
          <p>Find your game. Get straight into it.<br />Bring your friends when you feel like it.</p>
        </div>
        {status === 'loading' && <div className={styles.state} role="status">Finding your next game…</div>}
        {status === 'error' && <div className={styles.state} role="alert"><h2>Games couldn’t load.</h2><p>Try again, or return to the Game Hub.</p><button onClick={() => setAttempt(n => n + 1)}>Try again</button> <Link href="/games">Back to games</Link></div>}
        {status === 'ready' && !game && <div className={styles.state}><h2>No games available yet.</h2><p>Check back soon.</p><button onClick={() => setAttempt(n => n + 1)}>Refresh games</button></div>}
        {status === 'ready' && game && <>
          <section className={styles.feature} aria-labelledby="selected-game">
            <div className={styles.art} key={game.id}><Cover game={game} large /><div className={styles.artShade} /><span className={styles.artLabel}>INZONE / {game.name}</span></div>
            <div className={styles.details}>
              <p className={styles.eyebrow}>On your radar</p>
              <h2 id="selected-game">{game.name}</h2>
              <p className={styles.description}>{game.description || 'Open the game and see what you can do.'}</p>
              <Link className={styles.play} href={playHref(game.id)}>Play now <span aria-hidden="true">↗</span></Link>
              <p className={styles.micro}>Opens in your browser.</p>
              <div className={styles.socialNote}><span aria-hidden="true">↗</span><div><strong>Good games are worth sharing.</strong><p>Use Invite in the player to share a session and chat. Shared matches depend on the game.</p></div></div>
            </div>
          </section>
          <section className={styles.browse} aria-labelledby="browse-title">
            <div className={styles.browseHeader}><div><p className={styles.eyebrow}>Follow your curiosity</p><h2 id="browse-title">Something else in mind?</h2></div><label className={styles.search}><span>Find a game</span><input type="search" placeholder="Search games" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
            <p className={styles.resultCount} role="status">{visibleGames.length} {visibleGames.length === 1 ? 'game' : 'games'}</p>
            <div className={styles.grid}>{visibleGames.map(item => <article key={item.id} className={styles.card}>
              <button className={styles.select} aria-pressed={item.id === selected} onClick={() => { setSelected(item.id); document.getElementById('selected-game')?.scrollIntoView({ block: 'center' }); }} aria-label={'Show details for ' + item.name}><div className={styles.thumb}><Cover game={item} /></div><strong>{item.name}</strong></button>
              <Link className={styles.cardPlay} href={playHref(item.id)} aria-label={'Play ' + item.name}>Play ↗</Link>
            </article>)}</div>
            {visibleGames.length === 0 && <p className={styles.state}>No matches. Try another game name.</p>}
          </section>
        </>}
        <footer className={styles.footer}><span>INZONE</span><p>A place to play. Company optional.</p><Link href="/upload">Publish a game ↗</Link></footer>
      </main>
    </div>
  );
}
