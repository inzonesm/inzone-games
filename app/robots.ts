/**
 * /robots.txt for inzone.games. Next generates it at build time from this
 * module. Every rule is either "everyone" or "no bot", so the file is
 * intentionally short — the disallow list carries the private routes the
 * app already gates at the request level, since telling crawlers not to
 * index them saves them a fetch that would return an unauthenticated
 * response and pollute Search Console.
 */

import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/seo/game-metadata';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/dashboard',
          '/api/',
          '/gcs/',
        ],
      },
    ],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
    host: SITE_ORIGIN,
  };
}
