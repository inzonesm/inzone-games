// apiConfig — single source of truth for API URL.
// In a real Vite project: import.meta.env.VITE_API_URL.
// Here we accept either window.__API_URL__ (injected) or fall back to relative path.

const apiConfig = {
  apiUrl: (typeof window !== 'undefined' && window.__API_URL__) || '',
};

window.apiConfig = apiConfig;
