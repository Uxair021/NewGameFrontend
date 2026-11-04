import { useState } from "react";
import { Wrench, RefreshCw } from "lucide-react";
import { useMaintenance } from "../context/MaintenanceContext";

/**
 * Shown to every visitor except admins while maintenance mode is on (admin dashboard → Overview).
 * Fits any screen, portrait or landscape (it is shown instead of the RotatePhone / swipe-up flow).
 * Re-checks the status by itself every 30s (MaintenanceContext), so players are let back in
 * automatically when maintenance ends; "Try again" checks immediately.
 */
export function MaintenancePage() {
  const { message, refresh } = useMaintenance();
  const [checking, setChecking] = useState(false);

  const retry = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#050a1e] px-5 py-10 text-white supports-[height:100dvh]:min-h-[100dvh] [padding-bottom:max(2.5rem,env(safe-area-inset-bottom))] [padding-top:max(2.5rem,env(safe-area-inset-top))]">
      {/* soft glows */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" />

      <div className="relative w-full max-w-lg rounded-3xl border border-amber-400/40 bg-gradient-to-b from-[#16244f]/90 to-[#0a1230]/90 p-7 text-center shadow-[0_0_40px_rgba(251,191,36,0.15)] backdrop-blur [@media(max-height:500px)]:p-5 sm:p-10">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-400/70 bg-amber-400/10 shadow-[0_0_24px_rgba(251,191,36,0.35)] [@media(max-height:500px)]:mb-3 [@media(max-height:500px)]:h-12 [@media(max-height:500px)]:w-12">
          <Wrench className="h-8 w-8 text-amber-300 [@media(max-height:500px)]:h-6 [@media(max-height:500px)]:w-6" />
        </div>
        <h1 className="mb-2 text-2xl font-extrabold tracking-wide text-amber-300 [@media(max-height:500px)]:text-xl sm:text-3xl">
          We&apos;ll be right back
        </h1>
        <p className="mb-1 text-sm text-white/80 sm:text-base">Website is undergoing scheduled maintenance.</p>
        <p className="mb-6 text-sm text-white/60 [@media(max-height:500px)]:mb-4 sm:text-base">
          {message || "We're making improvements and will be back online shortly. Thank you for your patience."}
        </p>

        <button
          type="button"
          onClick={() => void retry()}
          disabled={checking}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-b from-yellow-300 to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-900 shadow-[0_4px_14px_rgba(251,191,36,0.35)] hover:brightness-110 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
          {checking ? "Checking..." : "Try again"}
        </button>

      </div>
    </div>
  );
}
