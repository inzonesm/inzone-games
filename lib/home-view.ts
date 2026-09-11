import { createElement as h, type ReactNode } from 'react';
import type { HubGame } from './types';
import type { HomeRow } from './home-rows';

export function HomeView({
  hero,
  rows,
}: {
  hero: HubGame | null;
  rows: HomeRow[];
}): ReactNode {
  return h(
    'main',
    { className: 'player-home' },
    hero
      ? h(
          'section',
          { className: 'home-hero', 'data-featured-slug': hero.id },
          h(
            'a',
            { href: `/games/${encodeURIComponent(hero.id)}`, className: 'home-hero-card' },
            h(HeroThumb, { game: hero }),
            h(
              'div',
              { className: 'home-hero-copy' },
              h('p', { className: 'home-kicker' }, 'Featured'),
              h('h1', null, hero.name),
              h('span', { className: 'home-hero-play' }, 'Play'),
            ),
          ),
        )
      : null,
    ...rows.map((row) =>
      h(
        'section',
        { key: row.id, className: 'home-row', 'data-row': row.id, 'aria-label': row.title },
        h('h2', { className: 'hub-section-title' }, row.title),
        row.games.length > 0
          ? h(
              'div',
              { className: 'hub-row' },
              ...row.games.map((game) =>
                h(
                  'a',
                  {
                    key: `${row.id}-${game.id}`,
                    href: `/games/${encodeURIComponent(game.id)}`,
                    className: 'game-card',
                  },
                  h(
                    'div',
                    { className: 'thumb' },
                    game.iconUrl
                      ? h('img', { src: game.iconUrl, alt: game.name })
                      : h('span', { 'aria-hidden': 'true' }, '🎮'),
                  ),
                  h('div', { className: 'name' }, game.name),
                ),
              ),
            )
          : h('p', { className: 'home-row-empty' }, 'More games coming soon.'),
      ),
    ),
  );
}

function HeroThumb({ game }: { game: HubGame }) {
  const url = game.preview?.posterUrl?.trim() || game.iconUrl;
  if (!url) {
    return h(
      'div',
      { className: 'home-hero-art home-hero-fallback', 'aria-hidden': 'true' },
      h('span', null, (game.name.trim()[0] || '?').toUpperCase()),
    );
  }
  return h('img', { className: 'home-hero-art', src: url, alt: '' });
}
