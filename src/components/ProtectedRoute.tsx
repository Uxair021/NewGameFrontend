import { Navigate } from "react-router-dom";
import { ReactNode } from "react";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, authError, retryAuthCheck } = useAuth();

  if (authError) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-8 text-center text-white/70">
        <p>{authError}</p>
        <button
          onClick={retryAuthCheck}
          className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-500"
        >
          Retry
        </button>
      </div>
    );
  }
  if (loading) {
    return <div className="p-8 text-center text-white/70">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
