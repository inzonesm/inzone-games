/* Path-based router for InZone Studio.
 *
 * Uses History API (pushState / popstate) so URLs are clean paths:
 *   /signin, /dashboard, /upload, /endpoints, /players, /payouts, /settings
 *
 * This is required for Framer Multi-Site rewrites, which proxy by URL path.
 * Hash fragments (#/...) are invisible to the server and can't be rewritten.
 *
 * In a real Vite/CRA project, replace with react-router-dom v6:
 *   import { BrowserRouter, Routes, Route, Link, useNavigate } from 'react-router-dom';
 *
 * Components below have the same names so call sites don't change. */

const { useState, useEffect, useContext, createContext } = React;

const RouterContext = createContext(null);

const parseRoute = () => {
  const pathname = window.location.pathname;
  // Strip leading slash → 'dashboard', 'upload', etc.
  // Default to 'signin' if at root.
  const raw = pathname.replace(/^\/+/, '') || 'signin';
  const path = raw.split('?')[0];
  const params = {};
  const searchParams = new URLSearchParams(window.location.search);
  searchParams.forEach((v, k) => { params[k] = v; });
  return { path, params };
};

function Router({ children }) {
  const [route, setRoute] = useState(() => parseRoute());

  useEffect(() => {
    // Back / forward button
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);

    // If landing on bare root, redirect to /signin
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/signin');
      setRoute({ path: 'signin', params: {} });
    }

    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (to) => {
    // Normalise: ensure leading slash
    const target = to.startsWith('/') ? to : `/${to}`;
    if (window.location.pathname !== target) {
      window.history.pushState(null, '', target);
      setRoute(parseRoute());
    }
  };

  return <RouterContext.Provider value={{ route, navigate }}>{children}</RouterContext.Provider>;
}

function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside <Router>');
  return ctx;
}

function useNavigate() {
  return useRouter().navigate;
}

function Link({ to, className, children, onClick, ...rest }) {
  const navigate = useNavigate();
  const handle = (e) => {
    e.preventDefault();
    if (onClick) onClick(e);
    navigate(to);
  };
  const href = to.startsWith('/') ? to : `/${to}`;
  return <a href={href} className={className} onClick={handle} {...rest}>{children}</a>;
}

window.Router = Router;
window.useRouter = useRouter;
window.useNavigate = useNavigate;
window.RouterLink = Link;
