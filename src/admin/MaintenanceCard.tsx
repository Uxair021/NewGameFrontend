import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Wrench, Power } from "lucide-react";
import { adminApi, type MaintenanceState } from "./adminApi";
import { useMaintenance } from "../context/MaintenanceContext";
import { formatRelativeTime } from "./format";

const swalStyle = {
  background: "#ffffff",
  color: "#1e293b",
  confirmButtonColor: "#6366f1",
  cancelButtonColor: "#e2e8f0",
};

/**
 * Admin dashboard (Overview): switches the whole website into / out of maintenance mode.
 * While it's on, every visitor except admins sees the maintenance page and the server refuses
 * all player requests (spins, wallet, jackpot, lobby). Admins keep full access.
 */
export function MaintenanceCard() {
  const [state, setState] = useState<MaintenanceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useMaintenance();

  useEffect(() => {
    adminApi
      .getMaintenance()
      .then(setState)
      .catch(() => setError("Couldn't load maintenance status"));
  }, []);

  const toggle = async () => {
    if (!state) return;
    const turningOn = !state.enabled;

    const confirm = await Swal.fire({
      title: turningOn ? "Put the website into maintenance mode?" : "Bring the website back online?",
      text: turningOn
        ? "Every player will see the maintenance page and all games, spins and wallet actions stop until you switch it off. Admins keep access."
        : "Players will be able to use the website and play again.",
      icon: turningOn ? "warning" : "question",
      ...(turningOn
        ? {
            input: "textarea" as const,
            inputLabel: "Message for players (optional)",
            inputPlaceholder: "e.g. We're upgrading our games — back at 6 PM.",
            inputValue: state.message,
            inputAttributes: { maxlength: "500" },
          }
        : {}),
      showCancelButton: true,
      confirmButtonText: turningOn ? "Turn maintenance ON" : "Turn maintenance OFF",
      ...swalStyle,
      confirmButtonColor: turningOn ? "#dc2626" : "#16a34a",
    });
    if (!confirm.isConfirmed) return;

    setBusy(true);
    setError(null);
    try {
      const message = turningOn ? String(confirm.value ?? "") : state.message;
      const next = await adminApi.setMaintenance(turningOn, message);
      setState(next);
      await refresh();
    } catch {
      setError("Couldn't change maintenance mode — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const on = !!state?.enabled;

  return (
    <div
      className={`mb-6 flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        on ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            on ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Wrench size={20} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Maintenance mode</h2>
            {state && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  on ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {on ? "ON — site offline" : "OFF — site live"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {on
              ? "Players see the maintenance page and can't play. Admins still have full access."
              : "Take the whole website offline for players while you work on it."}
          </p>
          {on && state?.message && <p className="mt-1 text-sm text-slate-700">Message: “{state.message}”</p>}
          {state?.updatedAt && (
            <p className="mt-1 text-xs text-slate-400">Last changed {formatRelativeTime(state.updatedAt)}</p>
          )}
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void toggle()}
        disabled={!state || busy}
        className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50 ${
          on ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
        }`}
      >
        <Power size={16} />
        {busy ? "Saving..." : on ? "Turn maintenance OFF" : "Turn maintenance ON"}
      </button>
    </div>
  );
}
