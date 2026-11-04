import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownCircle, ArrowUpCircle, Download, Scale } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import { StatTile } from "./StatTile";
import { adminApi, BalanceReportFilters, BalanceReportResponse, BalanceReportType } from "./adminApi";
import { formatBalance, formatCount, formatFullDateTime } from "./format";

const TYPE_OPTIONS: { value: BalanceReportType; label: string }[] = [
  { value: "admin", label: "All admin changes" },
  { value: "admin_add", label: "Added by admin" },
  { value: "admin_remove", label: "Removed by admin" },
  { value: "starting_balance", label: "Starting balances" },
  { value: "demo_credits", label: "Demo credits" },
  { value: "all", label: "Everything" },
];

const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800";

interface FilterForm {
  type: BalanceReportType;
  player: string;
  adminId: string;
  from: string;
  to: string;
}

/** The form's calendar days cover the admin's own whole local day, whatever the server's timezone. */
function toRequestFilters(form: FilterForm): BalanceReportFilters {
  return {
    type: form.type,
    player: form.player.trim() || undefined,
    adminId: form.adminId || undefined,
    from: form.from ? new Date(`${form.from}T00:00:00`).toISOString() : undefined,
    to: form.to ? new Date(`${form.to}T23:59:59.999`).toISOString() : undefined,
  };
}

async function errorMessage(err: unknown, fallback: string): Promise<string> {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  // The export asks for a file, so its error body arrives as a Blob too.
  if (data instanceof Blob) {
    try {
      return (JSON.parse(await data.text()) as { error?: string }).error ?? fallback;
    } catch {
      return fallback;
    }
  }
  return (data as { error?: string } | undefined)?.error ?? fallback;
}

export function AdminBalanceReportPage() {
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<FilterForm>({
    type: "admin",
    player: searchParams.get("player") ?? "",
    adminId: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState<BalanceReportFilters>(() => toRequestFilters(form));
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BalanceReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    adminApi
      .getBalanceReport(applied, page)
      .then((response) => {
        if (!current) return;
        setData(response);
        setError(null);
      })
      .catch(async (err) => {
        const message = await errorMessage(err, "Could not load the report.");
        if (current) setError(message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [applied, page]);

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setApplied(toRequestFilters(form));
  };

  const exportCsv = async () => {
    setExporting(true);
    setError(null);
    try {
      const url = URL.createObjectURL(await adminApi.exportBalanceReport(applied));
      const link = document.createElement("a");
      link.href = url;
      link.download = "balance-report.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(await errorMessage(err, "Could not export the report."));
    } finally {
      setExporting(false);
    }
  };

  const lastPage = data ? Math.max(Math.ceil(data.total / data.pageSize), 1) : 1;

  return (
    <div>
      <AdminPageHeader
        title="Balance Report"
        description="Every balance change: when, how much and who made it."
        actions={
          <button
            onClick={exportCsv}
            disabled={exporting || !data || data.total === 0}
            className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50"
          >
            <Download size={16} />
            {exporting ? "Exporting..." : "Download CSV"}
          </button>
        }
      />

      <form onSubmit={applyFilters} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-xs text-slate-500">
          <span className="mb-1 block">Type</span>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as BalanceReportType })}
            className={inputClass}
          >
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block">Player</span>
          <input
            type="text"
            placeholder="Username or name"
            value={form.player}
            onChange={(e) => setForm({ ...form, player: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block">Admin</span>
          <select value={form.adminId} onChange={(e) => setForm({ ...form, adminId: e.target.value })} className={inputClass}>
            <option value="">All admins</option>
            {data?.admins.map((a) => (
              <option key={a._id} value={a._id}>
                {a.username}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block">From</span>
          <input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} className={inputClass} />
        </label>
        <label className="text-xs text-slate-500">
          <span className="mb-1 block">To</span>
          <input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} className={inputClass} />
        </label>
        <button type="submit" className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">
          Apply
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Total added" value={formatBalance(data.totals.added)} icon={ArrowUpCircle} accent="emerald" />
            <StatTile label="Total removed" value={formatBalance(data.totals.removed)} icon={ArrowDownCircle} accent="rose" />
            <StatTile label="Net" value={formatBalance(data.totals.net)} icon={Scale} accent="indigo" />
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Before</th>
                  <th className="px-3 py-2 text-right">After</th>
                  <th className="px-3 py-2">Changed by</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r._id} className="border-t border-slate-200">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{formatFullDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      {r.playerExists ? (
                        <Link to={`/admin/users/${r.userId}`} className="font-medium text-indigo-600 hover:text-indigo-500">
                          {r.username}
                        </Link>
                      ) : (
                        <span className="text-slate-500">{r.username} (purged)</span>
                      )}
                      {r.fullName && <div className="text-xs text-slate-500">{r.fullName}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.typeLabel}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${r.delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {r.delta >= 0 ? "+" : "-"}
                      {formatBalance(Math.abs(r.delta))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">{formatBalance(r.previousBalance)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">{formatBalance(r.newBalance)}</td>
                    <td className="px-3 py-2 text-slate-600">{r.changedBy}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                      No balance changes match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>
              {formatCount(data.total)} {data.total === 1 ? "record" : "records"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={loading || page <= 1}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
              >
                Previous
              </button>
              <span>
                Page {page} of {lastPage}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={loading || page >= lastPage}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-slate-700 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {!data && loading && <div className="text-slate-500">Loading...</div>}
    </div>
  );
}
