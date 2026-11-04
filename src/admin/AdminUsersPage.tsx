import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Swal from "sweetalert2";
import { UserPlus, Copy, Check } from "lucide-react";
import { AdminPageHeader } from "./AdminPageHeader";
import { adminApi, AdminUser } from "./adminApi";
import { formatBalance } from "./format";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title="Copy password"
      className="text-slate-500 hover:text-slate-800"
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
    </button>
  );
}

const swalStyle = {
  background: "#ffffff",
  color: "#1e293b",
  confirmButtonColor: "#6366f1",
  cancelButtonColor: "#e2e8f0",
};

type StatusFilter = "active" | "deleted" | "all";

/** Shows a copyable username/password pair. Passwords are bcrypt-hashed server-side and can
 * never be retrieved again after this — this dialog (creation or reset) is the only moment
 * the plaintext value exists, so it's built to be copied and shared immediately. */
async function fireCredentialsDialog(title: string, username: string, password: string): Promise<void> {
  await Swal.fire({
    title,
    html: `
      <div class="space-y-2 text-left">
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
          <div><div class="text-xs text-slate-500">Username</div><div class="font-mono text-base text-slate-800" id="cred-username">${username}</div></div>
          <button id="copy-username" class="rounded-md bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400">Copy</button>
        </div>
        <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
          <div><div class="text-xs text-slate-500">Password</div><div class="font-mono text-base text-slate-800" id="cred-password">${password}</div></div>
          <button id="copy-password" class="rounded-md bg-indigo-500 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-400">Copy</button>
        </div>
        <button id="copy-both" class="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Copy both</button>
        <p class="mt-2 text-xs text-slate-500">This password won't be shown again — copy or share it now.</p>
      </div>
    `,
    icon: "success",
    ...swalStyle,
    didOpen: () => {
      const copy = (text: string, btn: HTMLElement) => {
        navigator.clipboard.writeText(text).then(() => {
          const original = btn.textContent;
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = original;
          }, 1200);
        });
      };
      document.getElementById("copy-username")?.addEventListener("click", (e) => copy(username, e.currentTarget as HTMLElement));
      document.getElementById("copy-password")?.addEventListener("click", (e) => copy(password, e.currentTarget as HTMLElement));
      document
        .getElementById("copy-both")
        ?.addEventListener("click", (e) => copy(`${username} / ${password}`, e.currentTarget as HTMLElement));
    },
  });
}

export function AdminUsersPage() {
  const [status, setStatus] = useState<StatusFilter>("active");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", email: "", startingBalance: "100" });
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    adminApi
      .listUsers(status)
      .then(setUsers)
      .finally(() => setLoading(false));
  };

  useEffect(load, [status]);

  const submitCreate = async () => {
    setCreating(true);
    try {
      const { credentials } = await adminApi.createUser({
        fullName: form.fullName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        startingBalance: Number(form.startingBalance) || 0,
      });
      setShowCreate(false);
      setForm({ fullName: "", phone: "", email: "", startingBalance: "100" });
      load();
      await fireCredentialsDialog("Player created", credentials.username, credentials.password);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      const message =
        status === 409
          ? "That email or phone number is already used by another player."
          : (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Could not create player.";
      await Swal.fire({ title: "Couldn't create player", text: message, icon: "error", ...swalStyle });
    } finally {
      setCreating(false);
    }
  };

  const resetPassword = async (user: AdminUser) => {
    const confirm = await Swal.fire({
      title: `Reset password for ${user.username}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Reset",
      ...swalStyle,
    });
    if (!confirm.isConfirmed) return;
    const credentials = await adminApi.resetPassword(user._id);
    await fireCredentialsDialog("Password reset", credentials.username, credentials.password);
  };

  const toggleDisabled = async (user: AdminUser) => {
    await adminApi.disableUser(user._id, !user.disabled);
    load();
  };

  const softDelete = async (user: AdminUser) => {
    const confirm = await Swal.fire({
      title: `Delete ${user.username}?`,
      text: "This can be undone by an admin action, but the account will be logged out immediately.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      ...swalStyle,
    });
    if (!confirm.isConfirmed) return;
    await adminApi.deleteUser(user._id);
    load();
  };

  const purge = async (user: AdminUser) => {
    const confirm = await Swal.fire({
      title: `Permanently purge ${user.username}?`,
      text: "This removes their account and spin history and cannot be undone. Their balance records stay in the Balance Report.",
      icon: "error",
      showCancelButton: true,
      confirmButtonText: "Purge",
      ...swalStyle,
    });
    if (!confirm.isConfirmed) return;
    await adminApi.purgeUser(user._id);
    load();
  };

  return (
    <div>
      <AdminPageHeader
        title="Players"
        description="Generate accounts, manage balances, and moderate players."
        actions={
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-500"
          >
            <UserPlus size={16} />
            Generate player
          </button>
        }
      />

      {showCreate && (
        <div className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
          <input
            placeholder="Full name (optional)"
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
          />
          <input
            placeholder="Phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
          />
          <input
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
          />
          <input
            type="number"
            placeholder="Starting balance"
            value={form.startingBalance}
            onChange={(e) => setForm({ ...form, startingBalance: e.target.value })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400"
          />
          <button
            onClick={submitCreate}
            disabled={creating}
            className="rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-50 sm:col-span-4"
          >
            {creating ? "Creating..." : "Create player"}
          </button>
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit">
        {(["active", "deleted", "all"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
              status === s ? "bg-indigo-500 text-white" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-sky-700 text-left text-xs font-semibold uppercase tracking-wide text-white">
            <tr>
              <th className="px-3 py-2">Username</th>
              <th className="px-3 py-2">Password</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Balance</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {users.map((u) => (
              <tr key={u._id} className="border-t border-slate-200 even:bg-slate-50 hover:bg-sky-50">
                <td className="px-3 py-2">
                  <Link to={`/admin/users/${u._id}`} className="text-indigo-600 hover:underline">
                    {u.username}
                  </Link>
                  {u.online && <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </td>
                <td className="px-3 py-2">
                  {u.password ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-slate-700">{u.password}</span>
                      <CopyButton text={u.password} />
                    </span>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-700">{u.fullName ?? "-"}</td>
                <td className="px-3 py-2 text-slate-500">{u.email ?? "-"}</td>
                <td className="px-3 py-2 text-amber-600">{formatBalance(u.balance)}</td>
                <td className="px-3 py-2">
                  {u.deletedAt ? (
                    <span className="rounded bg-rose-500 px-2 py-0.5 text-xs font-medium text-white">deleted</span>
                  ) : u.disabled ? (
                    <span className="rounded bg-slate-400 px-2 py-0.5 text-xs font-medium text-white">disabled</span>
                  ) : (
                    <span className="rounded bg-sky-500 px-2 py-0.5 text-xs font-medium text-white">active</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    {!u.deletedAt && (
                      <>
                        <button
                          onClick={() => resetPassword(u)}
                          className="rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-400"
                        >
                          Reset Password
                        </button>
                        <button
                          onClick={() => toggleDisabled(u)}
                          className="rounded-md bg-sky-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-400"
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                        <button
                          onClick={() => softDelete(u)}
                          className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-400"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {u.deletedAt && (
                      <button
                        onClick={() => purge(u)}
                        className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-400"
                      >
                        Purge
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  No players found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
