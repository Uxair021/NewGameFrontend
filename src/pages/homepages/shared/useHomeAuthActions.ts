import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";

/**
 * Replaces the source project's LoginModalContext + roleHome for these ported pages: instead of
 * popping a login modal, a locked action sends the visitor to this app's own /login page (its
 * real login flow, not a copy of the modal one) — see the "wire to texasSlots's own auth"
 * decision these pages were ported under. Signed-in users run the action immediately.
 */
export function useHomeAuthActions() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const requireAuth = useCallback(
    (action?: () => void) => () => {
      if (user) action?.();
      else navigate("/login");
    },
    [user, navigate]
  );

  const goToDashboard = useCallback(() => {
    navigate(user?.role === "admin" ? "/admin" : "/panel");
  }, [user, navigate]);

  return { user, requireAuth, goToDashboard };
}
