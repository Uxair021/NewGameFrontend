import { useEffect, useState } from "react";
// import { useAuth } from "../context/AuthContext";
import {
  // claimDemoCreditsRequest,
  getSpinHistoryRequest,
  getBalanceHistoryRequest,
  SpinHistoryEntry,
  BalanceHistoryEntry,
} from "../api/userApi";

export function UserPanelPage() {
  // const { user, setBalance } = useAuth();
  const [spins, setSpins] = useState<SpinHistoryEntry[]>([]);
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistoryEntry[]>([]);
  // const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    getSpinHistoryRequest().then(setSpins).catch(() => setSpins([]));
    getBalanceHistoryRequest().then(setBalanceHistory).catch(() => setBalanceHistory([]));
  }, []);

  // const claim = async () => {
  //   setClaiming(true);
  //   try {
  //     const balance = await claimDemoCreditsRequest();
  //     setBalance(balance);
  //     getBalanceHistoryRequest().then(setBalanceHistory);
  //   } finally {
  //     setClaiming(false);
  //   }
  // };

  return (
    <div className="min-h-[calc(100vh-56px)] bg-slate-950 px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold text-white">My Account</h1>

        {/* <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <div className="text-sm text-slate-400">{user?.username}</div>
            {user?.email && <div className="text-sm text-slate-500">{user.email}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase text-slate-500">Balance</div>
            <div className="text-2xl font-bold text-amber-400">${(user?.balance ?? 0).toFixed(2)}</div>
          </div>
        </div>

        <button
          onClick={claim}
          disabled={claiming}
          className="mt-3 rounded-lg bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:brightness-110 disabled:opacity-50"
        >
          {claiming ? "Claiming..." : "Claim 100 demo credits"}
        </button> */}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-lg font-semibold text-white">Recent spins</h2>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Bet</th>
                    <th className="px-3 py-2">Win</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {spins.map((h) => (
                    <tr key={h._id} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-slate-300">${h.betAmount.toFixed(2)}</td>
                      <td className={`px-3 py-2 ${h.winAmount > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                        ${h.winAmount.toFixed(2)}
                        {h.tier && <span className="ml-1 text-xs text-amber-400">{h.tier}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{new Date(h.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {spins.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                        No spins yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold text-white">Balance history</h2>
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Change</th>
                    <th className="px-3 py-2">New balance</th>
                    <th className="px-3 py-2">When</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceHistory.map((b) => (
                    <tr key={b._id} className="border-t border-slate-800">
                      <td className={`px-3 py-2 ${b.delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {b.delta >= 0 ? "+" : ""}
                        ${b.delta.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-slate-300">${b.newBalance.toFixed(2)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{new Date(b.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {balanceHistory.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                        No balance changes yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
