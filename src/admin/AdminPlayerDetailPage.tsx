import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Swal from "sweetalert2";
import { AdminPageHeader } from "./AdminPageHeader";
import { StatTile } from "./StatTile";
import { adminApi, AdminUser, BalanceAdjustmentEntry, SpinEntry, ForcedOutcomeEntry } from "./adminApi";
import { formatBalance, formatFullDateTime, formatRelativeTime } from "./format";
import { Coins, Wifi, WifiOff } from "lucide-react";

const swalStyle = {
  background: "#ffffff",
  color: "#1e293b",
  confirmButtonColor: "#6366f1",
  cancelButtonColor: "#000",
};

/** What a history row was, including rows saved before types were recorded. */
function historyLabel(b: BalanceAdjustmentEntry): string {
  switch (b.type) {
    case "admin_add":
      return `Added by ${b.createdByUsername ?? "admin"}`;
    case "admin_remove":
      return `Removed by ${b.createdByUsername ?? "admin"}`;
    case "starting_balance":
      return "Starting balance";
    case "demo_credits":
      return "Demo credits";
    default:
      return b.createdBy === b.userId ? "Demo credits" : "Set by admin (old)";
  }
}

export function AdminPlayerDetailPage() {
  const { id } = useParams();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BalanceAdjustmentEntry[]>([]);
  const [spins, setSpins] = useState<SpinEntry[]>([]);
  const [pending, setPending] = useState<ForcedOutcomeEntry[]>([]);
  const [action, setAction] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    adminApi.getUser(id).then((data) => {
      setUser(data.user);
      setBalanceHistory(data.balanceHistory);
      setSpins(data.spins);
      setPending(data.pendingForcedOutcomes);
    });
  };

  useEffect(load, [id]);

  if (!user) return <div className="text-slate-500">Loading...</div>;

  const amountValue = Number(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const previewBalance = user.balance + (action === "add" ? amountValue : -amountValue);

  const saveAdjustment = async () => {
    if (!id || !amountValid) return;
    const confirm = await Swal.fire({
      title: `${action === "add" ? "Add" : "Remove"} ${formatBalance(amountValue)} ${action === "add" ? "to" : "from"} ${user.username}?`,
      text: `Balance goes from ${formatBalance(user.balance)} to ${formatBalance(previewBalance)}.`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: action === "add" ? "Add" : "Remove",
      ...swalStyle,
    });
    if (!confirm.isConfirmed) return;

    setSaving(true);
    setError(null);
    try {
      setUser(await adminApi.adjustBalance(id, action, amountValue));
      setAmount("");
      load();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Could not change the balance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <AdminPageHeader title={user.username} description={user.fullName ?? undefined} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Balance" value={formatBalance(user.balance)} icon={Coins} accent="amber" />
        <StatTile
          label="Status"
          value={user.online ? "Online" : "Offline"}
          icon={user.online ? Wifi : WifiOff}
          accent={user.online ? "emerald" : "indigo"}
        />
        <StatTile label="Pending forced outcomes" value={String(pending.length)} icon={Coins} accent="indigo" />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add or remove balance</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {(["add", "remove"] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  action === a ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {a === "add" ? "Add" : "Remove"}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="Amount"
            aria-label="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-32 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          />
          <button
            onClick={saveAdjustment}
            disabled={saving || !amountValid}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : action === "add" ? "Add balance" : "Remove balance"}
          </button>
        </div>
        {amountValid && (
          <p className={`mt-2 text-xs ${previewBalance < 0 ? "text-rose-600" : "text-slate-500"}`}>
            {previewBalance < 0
              ? `The player only has ${formatBalance(user.balance)}.`
              : `New balance will be ${formatBalance(previewBalance)}.`}
          </p>
        )}
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-800">Balance history</h2>
            <Link
              to={`/admin/balance-report?player=${encodeURIComponent(user.username)}`}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              Full report
            </Link>
          </div>
          <div className="divide-y divide-slate-200">
            {balanceHistory.map((b) => (
              <div key={b._id} className="px-4 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className={b.delta >= 0 ? "text-emerald-600" : "text-rose-600"}>
                    {b.delta >= 0 ? "+" : ""}
                    {formatBalance(b.delta)}
                  </span>
                  <span className="text-slate-500">{formatBalance(b.newBalance)} after</span>
                  <span className="text-xs text-slate-500">{formatFullDateTime(b.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{historyLabel(b)}</div>
              </div>
            ))}
            {balanceHistory.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No balance changes yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800">Recent spins</h2>
          <div className="divide-y divide-slate-200">
            {spins.map((s) => (
              <div key={s._id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-slate-500">bet {formatBalance(s.betAmount)}</span>
                <span className={s.winAmount > 0 ? "text-emerald-600" : "text-slate-500"}>
                  {s.winAmount > 0 ? `+${formatBalance(s.winAmount)}` : "-"}
                </span>
                {s.tier && <span className="text-xs text-amber-600">{s.tier}</span>}
                {s.forced && <span className="text-xs text-indigo-600">forced</span>}
                <span className="text-xs text-slate-500">{formatRelativeTime(s.createdAt)}</span>
              </div>
            ))}
            {spins.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No spins yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
