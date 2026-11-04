import axios from "axios";

const TOKEN_KEY = "texas-slots-token";

/**
 * VITE_API_URL is normally "http://localhost:4000" for local dev, which only resolves
 * correctly when the page itself is loaded from "localhost" — opened from a phone via
 * the dev machine's LAN IP instead, "localhost" would point at the phone. In that case,
 * fall back to talking to the same host the page was loaded from.
 *
 * That `hostname:4000` guess is a dev-only convenience, not a real deployment topology —
 * the backend (see backEnd/.env.example's CORS_ORIGIN comment) is a separate host reached
 * cross-origin via CORS, not something reverse-proxied under the frontend's own origin on
 * port 4000. In a production build, guessing it anyway is actively harmful: if VITE_API_URL
 * wasn't set as a real deployment-time env var (so Vite baked in the committed .env's
 * "localhost" value instead), every request would silently target
 * "https://<your-production-domain>:4000", which almost certainly isn't listening — and
 * browsers can take a long time to give up on a dead connection like that (iOS Safari
 * especially), which is exactly what produces an indefinite "Loading..." hang. So this
 * fallback only applies in dev; in a production build we log loudly instead of guessing
 * silently, and rely on the request timeout below + ProtectedRoute's error/retry state to
 * surface the failure instead of hanging forever.
 */
export function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL as string | undefined;
  const pageIsLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (envUrl && (pageIsLocalhost || !envUrl.includes("localhost"))) {
    return envUrl;
  }
  if (import.meta.env.DEV) {
    // Keep VITE_API_URL's port, so a phone on the LAN reaches this project's backend and not
    // another local copy listening on the default port.
    const devPort = envUrl?.match(/:(\d+)\/?$/)?.[1] ?? "4000";
    return `${window.location.protocol}//${window.location.hostname}:${devPort}`;
  }
  console.error(
    `[api] VITE_API_URL is not set to a usable backend URL in this production build (got: ${
      envUrl ?? "undefined"
    }). Set VITE_API_URL in your deployment platform's environment variables to the backend's real ` +
      "public URL — falling back to a guess that is very likely wrong."
  );
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  // Bounds every request so a dead/misconfigured backend URL surfaces as a visible error
  // within a few seconds instead of leaving the UI (e.g. ProtectedRoute's auth check) stuck
  // on an indefinite loading state.
  timeout: 15000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
