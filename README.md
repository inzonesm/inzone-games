# Inzone Games — Web

A Next.js web version of the Inzone game hub. Signs in with the same Firebase project as the Flutter app (`inzone-f93e4`), reads community games from the `html_games` Firestore collection, and plays them in-page via iframe.

## Setup

1. **Add a Web app to the existing Firebase project** (`inzone-f93e4`):
   - Firebase Console → Project settings → *Your apps* → Add app → Web.
   - Copy the resulting `apiKey` and `appId`.

2. **Configure environment:**
   ```bash
   cp .env.local.example .env.local
   # then fill in NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID
   ```

3. **Enable sign-in providers** in Firebase Console → Authentication → Sign-in method:
   - Google
   - Apple (requires Apple Developer setup — see Firebase docs)

4. **Authorize your domain** in Firebase Console → Authentication → Settings → Authorized domains:
   - `localhost` (dev)
   - Your production domain

5. **Install + run:**
   ```bash
   npm install
   npm run dev    # http://localhost:3000
   ```

6. **Build:**
   ```bash
   npm run build
   npm start
   ```

## What's here

- `/login` — Google + Apple sign-in
- `/games` — auth-gated grid of approved community games
- `/games/[id]` — iframe game player

## Color & style

Matched to `lib/theme/app_colors.dart` in the Flutter app — primary `#2196F3`, background `#E8F5FE`, card radius 14px, Apple SD Gothic Neo if available (falls back to system sans).

## Notes

- Only **community** games (Firestore `html_games`, `status == 'approved'`) are shown on web. The Flutter app also pulls from the Simula ad SDK, which is mobile-only and intentionally skipped.
- Firestore rules need to allow authenticated reads on `html_games` for this to work. The Flutter app already reads this collection, so existing rules likely cover it.
- The iframe is not sandboxed — games are trusted via the `status == 'approved'` moderation flag, same as on mobile.
