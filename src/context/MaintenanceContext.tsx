import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "../api/client";

/**
 * Maintenance mode (switched on the admin dashboard). The backend stores it and refuses player
 * requests while it's on (503 { maintenance: true }); this keeps the frontend in step:
 * - checks GET /api/site/status on load, every 30s, and when the tab becomes visible again;
 * - switches immediately when any API call comes back with that 503 (e.g. mid-game).
 * App.tsx then shows the maintenance page to everyone except admins.
 *
 * Also carries the country block (admin dashboard): the same status call says whether THIS visitor
 * is blocked (their IP's country), and a 451 { geoBlocked: true } from any call switches straight
 * to the "not available in your region" page.
 */

interface MaintenanceValue {
  maintenance: boolean;
  message: string;
  /** this visitor is in a country the admin has blocked */
  geoBlocked: boolean;
  /** false until the first status check has answered (or failed) — App.tsx waits for it, so a
   *  visitor is never routed (e.g. to /login) before it's known whether the site is in maintenance */
  ready: boolean;
  /** re-check now (e.g. the maintenance page's "Try again", or after an admin toggles it) */
  refresh: () => Promise<void>;
}

const POLL_MS = 30000;

const MaintenanceContext = createContext<MaintenanceValue | null>(null);

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [maintenance, setMaintenance] = useState(false);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [geoBlocked, setGeoBlocked] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get<{ maintenance: boolean; message: string; geoBlocked?: boolean }>(
        "/api/site/status"
      );
      setMaintenance(!!data.maintenance);
      setMessage(data.message ?? "");
      setGeoBlocked(!!data.geoBlocked);
    } catch {
      /* status unreachable — keep the last known state rather than locking players out */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    // any request refused because of maintenance → switch straight away
    const interceptor = apiClient.interceptors.response.use(undefined, (error) => {
      const data = error?.response?.data;
      if (error?.response?.status === 503 && data?.maintenance) {
        setMaintenance(true);
        setMessage(typeof data.message === "string" ? data.message : "");
      }
      if (error?.response?.status === 451 && data?.geoBlocked) setGeoBlocked(true);
      return Promise.reject(error);
    });

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      apiClient.interceptors.response.eject(interceptor);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ maintenance, message, geoBlocked, ready, refresh }),
    [maintenance, message, geoBlocked, ready, refresh]
  );
  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

export function useMaintenance(): MaintenanceValue {
  const ctx = useContext(MaintenanceContext);
  if (!ctx) throw new Error("useMaintenance must be used inside MaintenanceProvider");
  return ctx;
}
