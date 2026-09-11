const withPWAInit = require('@ducanh2912/next-pwa').default;

/**
 * Runtime caching rules (order matters — first match wins).
 *  - Firebase Auth / Firestore / Storage and other API calls -> NetworkFirst,
 *    so we never serve stale game / player data but still degrade gracefully
 *    when the network is unavailable.
 *  - Static build output, images, and fonts -> CacheFirst for instant repeat loads.
 *  - App navigations -> NetworkFirst, falling back to cache and finally the
 *    offline page when everything else fails.
 */
const runtimeCaching = [
  {
    urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
    handler: 'StaleWhileRevalidate',
    options: {
      cacheName: 'google-fonts-stylesheets',
      expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'google-fonts-webfonts',
      cacheableResponse: { statuses: [0, 200] },
      expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    // Firebase Auth, Firestore, secure token exchange -> always try network first.
    urlPattern: /^https:\/\/(firestore|identitytoolkit|securetoken)\.googleapis\.com\/.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'firebase-api',
      networkTimeoutSeconds: 10,
      cacheableResponse: { statuses: [0, 200] },
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
    },
  },
  {
    // Firebase Storage / GCS assets (game thumbnails, bundles) -> network first,
    // fall back to cache so previously seen assets survive offline.
    urlPattern: /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'firebase-storage',
      networkTimeoutSeconds: 10,
      cacheableResponse: { statuses: [0, 200] },
      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
    },
  },
  {
    // Resized game-icon thumbnails from the image CDN — immutable per URL, so
    // CacheFirst makes repeat visits paint instantly (and survive offline).
    urlPattern: /^https:\/\/images\.weserv\.nl\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'game-icon-thumbs',
      cacheableResponse: { statuses: [0, 200] },
      expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
    },
  },
  {
    urlPattern: /\/_next\/static\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'next-static',
      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    urlPattern: /\.(?:js|css)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-resources',
      expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
    },
  },
  {
    urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-images',
      expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
    },
  },
  {
    urlPattern: /\.(?:woff|woff2|ttf|otf|eot)$/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'static-fonts',
      expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
    },
  },
  {
    // App navigations & anything else -> network first with offline fallback.
    urlPattern: /.*/i,
    handler: 'NetworkFirst',
    options: {
      cacheName: 'others',
      networkTimeoutSeconds: 10,
      expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 },
    },
  },
];

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  fallbacks: {
    // Served when a navigation request fails and nothing is cached.
    document: '/~offline',
  },
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching,
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@inzone/checkout-host-client'],
  experimental: {
    // The example game is read from disk in the route handler; include it in
    // the serverless trace so /sdk-example works on Vercel Preview.
    outputFileTracingIncludes: {
      '/sdk-example/game': ['./fixtures/sdk-example/game/**/*'],
      '/sdk-example/game/[[...path]]': ['./fixtures/sdk-example/game/**/*'],
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: '**.cloudfront.net' },
      { protocol: 'https', hostname: '**.simula.dev' },
    ],
  },
  async redirects() {
    return [
      {
        source: '/session-prototype',
        destination: '/',
        permanent: true,
        missing: [{ type: 'query', key: 'game' }],
      },
    ];
  },
};

module.exports = withPWA(nextConfig);
