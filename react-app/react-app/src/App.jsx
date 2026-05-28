/* InZone Studio — App shell.
 *
 * Owns: auth guard, game-list state, current page render, sidebar.
 *
 * Game persistence
 * ----------------
 * We persist the developer's registered games in localStorage under
 * `inzone.studio.games`. On first run the list is empty — the auth guard
 * routes a logged-in user with zero games straight to the Upload page so
 * the very first thing they do is register a game. After a successful
 * upload, the game is appended to the list and the Overview page becomes
 * the natural landing for return visits.
 *
 * To reset to "no game" during design review, clear localStorage or call
 * `window.inzoneStudio.resetGames()` from the devtools console. */

const { useState, useEffect } = React;

const GAMES_KEY = 'inzone.studio.games';
const LAST_GAME_KEY = 'inzone.studio.lastGame';

function readStoredGames() {
  try {
    const raw = localStorage.getItem(GAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredGames(list) {
  try {
    localStorage.setItem(GAMES_KEY, JSON.stringify(list));
  } catch {}
}

function AppShell() {
  const { route } = window.useRouter();
  const { user } = window.useAuth();
  const navigate = window.useNavigate();

  const [games, setGames] = useState(() => readStoredGames());
  const [currentGame, setCurrentGame] = useState(null);
  const [gamesLoaded, setGamesLoaded] = useState(false);

  // On login, fetch the developer's games from Firestore and merge with
  // anything already in localStorage.  This ensures games created outside
  // the Studio portal (e.g. via the Flutter app) also appear.
  useEffect(() => {
    if (!user) { setGamesLoaded(false); return; }

    let cancelled = false;
    (async () => {
      try {
        const result = await window.inzoneAPI.listGames();
        if (cancelled) return;
        if (result.games && result.games.length > 0) {
          setGames(prev => {
            // Merge: Firestore is source of truth, but keep any local-only
            // entries that haven't synced yet.
            const map = new Map();
            // Firestore first (authoritative)
            result.games.forEach(g => map.set(g.gameId, g));
            // Then local — only fills gaps
            prev.forEach(g => { if (!map.has(g.gameId)) map.set(g.gameId, g); });
            const merged = [...map.values()];
            writeStoredGames(merged);
            return merged;
          });
        }
      } catch (e) {
        console.warn('Firestore game list fetch failed, using localStorage:', e);
      }
      if (!cancelled) setGamesLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Sync currentGame with the stored list (whenever it changes)
  useEffect(() => {
    if (!user) return;
    if (games.length === 0) {
      setCurrentGame(null);
      return;
    }
    const storedId = localStorage.getItem(LAST_GAME_KEY);
    const found = games.find(g => g.gameId === storedId) || games[0];
    setCurrentGame(found);
  }, [user?.uid, games]);

  // Auth guard + no-game funnel.
  // If the user has zero registered games, force them to /upload until they
  // have one. Otherwise pages that need a currentGame would crash or render
  // empty. Settings is allowed without a game (so a fresh sign-up can still
  // sign out / configure their profile).
  useEffect(() => {
    const path = route.path;
    const onProtectedRoute = path !== 'signin' && path !== '';

    if (!user && onProtectedRoute) {
      navigate('/signin');
      return;
    }

    if (user && (path === 'signin' || path === '')) {
      navigate(games.length === 0 ? '/upload' : '/dashboard');
      return;
    }

    // No-game funnel: Overview, Players, and Payouts require a registered
    // game. Upload, Endpoints, and Settings stay reachable so a fresh
    // sign-up can configure their account or preview the API surface.
    const restricted = ['dashboard', 'players', 'payouts'];
    if (user && games.length === 0 && restricted.includes(path)) {
      navigate('/upload');
    }
  }, [user, route.path, games.length]);

  const onSelectGame = (g) => {
    setCurrentGame(g);
    localStorage.setItem(LAST_GAME_KEY, g.gameId);
  };

  // Called by UploadPage after a successful registerGame() response.
  const onGameRegistered = (game) => {
    setGames(prev => {
      // Replace if same gameId already there; otherwise append.
      const existing = prev.findIndex(p => p.gameId === game.gameId);
      const next = existing >= 0
        ? prev.map((p, i) => i === existing ? game : p)
        : [...prev, game];
      writeStoredGames(next);
      return next;
    });
    localStorage.setItem(LAST_GAME_KEY, game.gameId);
  };

  // Debug helper — surface a reset in the console so design review can demo
  // the "no games yet" state without clearing localStorage manually.
  useEffect(() => {
    window.inzoneStudio = window.inzoneStudio || {};
    window.inzoneStudio.resetGames = () => {
      localStorage.removeItem(GAMES_KEY);
      localStorage.removeItem(LAST_GAME_KEY);
      setGames([]);
      setCurrentGame(null);
      navigate('/upload');
    };
    window.inzoneStudio.seedGames = () => {
      // Useful for quickly populating the dashboard with mock data.
      const seed = window.inzoneAPI.MOCK_GAMES_SEED || [];
      setGames(seed);
      writeStoredGames(seed);
      if (seed[0]) localStorage.setItem(LAST_GAME_KEY, seed[0].gameId);
    };
  }, []);

  // Routing
  if (!user || route.path === 'signin') {
    return (
      <div className="app signin">
        <window.Motes />
        <window.SigninPage />
      </div>
    );
  }

  const active = route.path;
  const hasGames = games.length > 0;

  return (
    <div className="app">
      <window.Motes />
      <window.SparkDefs />

      <window.Sidebar
        active={active}
        games={games}
        currentGame={currentGame}
        onSelectGame={onSelectGame}
        hasGames={hasGames}
      />

      <div className="main">
        {active === 'dashboard' && hasGames && (
          <window.DashboardPage
            games={games}
            currentGame={currentGame}
            onSelectGame={onSelectGame}
          />
        )}
        {active === 'upload' && (
          <window.UploadPage onGameRegistered={onGameRegistered} hasGames={hasGames} />
        )}
        {active === 'endpoints' && (
          <window.EndpointsPage currentGame={currentGame} />
        )}
        {active === 'players' && hasGames && (
          <window.PlayersPage currentGame={currentGame} />
        )}
        {active === 'payouts' && hasGames && (
          <window.PayoutsPage />
        )}
        {active === 'settings' && (
          <window.SettingsPage currentGame={currentGame} />
        )}
        {/* Fallback: any unknown route lands on dashboard (or upload if no games). */}
        {!['dashboard','upload','endpoints','players','payouts','settings'].includes(active) && (
          hasGames
            ? <window.DashboardPage games={games} currentGame={currentGame} onSelectGame={onSelectGame} />
            : <window.UploadPage onGameRegistered={onGameRegistered} hasGames={hasGames} />
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <window.Router>
      <window.AuthProvider>
        <AppShell />
      </window.AuthProvider>
    </window.Router>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
