import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { Globe, Power, X, RefreshCw } from "lucide-react";
import { adminApi, type GeoBlockState } from "./adminApi";
import { formatRelativeTime } from "./format";

const swalStyle = {
  background: "#ffffff",
  color: "#1e293b",
  confirmButtonColor: "#6366f1",
  cancelButtonColor: "#e2e8f0",
};

/** ISO 3166-1 alpha-2 codes — names come from the browser (Intl.DisplayNames). */
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " "
  );

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * Admin dashboard (Overview), right under Maintenance mode: blocks the website for visitors from
 * selected countries (Pakistan by default). ON / OFF with one button; countries and an IP allow-list
 * can be changed any time. Admins are never blocked. The visitor's country comes from the server's
 * MaxMind country database — its status is shown here too.
 */
export function GeoBlockCard() {
  const [state, setState] = useState<GeoBlockState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [allowText, setAllowText] = useState("");

  useEffect(() => {
    adminApi
      .getGeoBlock()
      .then((s) => {
        setState(s);
        setAllowText(s.allowIps.join("\n"));
      })
      .catch(() => setError("Couldn't load the country block settings"));
  }, []);

  const save = async (update: Parameters<typeof adminApi.setGeoBlock>[0], failMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await adminApi.setGeoBlock(update);
      setState(next);
      setAllowText(next.allowIps.join("\n"));
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? failMsg);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async () => {
    if (!state) return;
    const turningOn = !state.enabled;
    const list = state.countries.map(countryName).join(", ") || "no countries";
    const confirm = await Swal.fire({
      title: turningOn ? "Block the website in these countries?" : "Turn the country block off?",
      text: turningOn
        ? `Visitors from ${list} will see "Not available in your region" and can't use the website. Admins are never blocked.`
        : `Visitors from ${list} will be able to use the website again.`,
      icon: turningOn ? "warning" : "question",
      showCancelButton: true,
      confirmButtonText: turningOn ? "Turn country block ON" : "Turn country block OFF",
      ...swalStyle,
      confirmButtonColor: turningOn ? "#dc2626" : "#16a34a",
    });
    if (!confirm.isConfirmed) return;
    await save({ enabled: turningOn }, "Couldn't change the country block — please try again.");
  };

  const addCountry = (code: string) => {
    if (!state || state.countries.includes(code)) return;
    setSearch("");
    void save({ countries: [...state.countries, code] }, "Couldn't add the country.");
  };
  const removeCountry = (code: string) => {
    if (!state) return;
    void save({ countries: state.countries.filter((c) => c !== code) }, "Couldn't remove the country.");
  };

  const saveAllowList = () => {
    const ips = allowText
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    void save({ allowIps: ips }, "Couldn't save the allow-list.");
  };

  const updateDatabase = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await adminApi.updateGeoDatabase());
    } catch {
      setError("Couldn't update the country database.");
    } finally {
      setBusy(false);
    }
  };

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !state) return [];
    return COUNTRY_CODES.filter((c) => !state.countries.includes(c))
      .filter((c) => c.toLowerCase() === q || countryName(c).toLowerCase().includes(q))
      .slice(0, 8);
  }, [search, state]);

  const on = !!state?.enabled;
  const db = state?.database;
  const youBlocked = !!state?.you.country && state.countries.includes(state.you.country);

  return (
    <div className={`mb-6 rounded-xl border p-4 ${on ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              on ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-600"
            }`}
          >
            <Globe size={20} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Country block</h2>
              {state && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                    on ? "bg-red-600 text-white" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {on ? "ON — blocking" : "OFF"}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {on
                ? "Visitors from the countries below see “Not available in your region” and can't use the site."
                : "Block the website for visitors from the countries below. Admins are never blocked."}
            </p>
            {state?.updatedAt && (
              <p className="mt-1 text-xs text-slate-400">
                Last changed {formatRelativeTime(state.updatedAt)}
                {state.updatedBy ? ` by ${state.updatedBy}` : ""}
              </p>
            )}
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
          {busy ? "Saving..." : on ? "Turn country block OFF" : "Turn country block ON"}
        </button>
      </div>

      {state && (
        <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 lg:grid-cols-2">
          {/* ---------- countries ---------- */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Blocked countries</div>
            <div className="mb-2 flex flex-wrap gap-2">
              {state.countries.length === 0 && <span className="text-sm text-slate-400">No countries selected</span>}
              {state.countries.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-white">
                  {countryName(c)} ({c})
                  <button
                    type="button"
                    onClick={() => removeCountry(c)}
                    disabled={busy}
                    aria-label={`Remove ${countryName(c)}`}
                    className="rounded-full p-0.5 hover:bg-white/20"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Add a country — type a name, e.g. Pakistan"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              {matches.length > 0 && (
                <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matches.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => addCountry(c)}
                      className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
                    >
                      {countryName(c)} <span className="text-slate-400">({c})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ---------- allow-list ---------- */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Always allowed IPs (office / team)
            </div>
            <textarea
              value={allowText}
              onChange={(e) => setAllowText(e.target.value)}
              rows={3}
              placeholder="One IP address per line"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-400"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveAllowList}
                disabled={busy}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Save allow-list
              </button>
              {state.you.ip && !state.allowIps.includes(state.you.ip) && (
                <button
                  type="button"
                  onClick={() => setAllowText((t) => (t.trim() ? `${t.trim()}\n${state.you.ip}` : state.you.ip))}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add my IP
                </button>
              )}
            </div>
          </div>

          {/* ---------- info ---------- */}
          <div className="space-y-1 text-xs text-slate-500 lg:col-span-2">
            <div>
              Your connection: <span className="font-mono text-slate-700">{state.you.ip || "unknown"}</span>
              {" — "}
              {state.you.country ? `${countryName(state.you.country)} (${state.you.country})` : "country unknown"}
              {youBlocked && (
                <span className="ml-1 font-semibold text-amber-700">
                  — your country is on the list (you're an admin, so you stay in; players on this connection would be blocked)
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span>
                Country database:{" "}
                {db?.loaded ? (
                  <span className="text-emerald-700">loaded{db.buildDate ? ` (built ${db.buildDate.slice(0, 10)})` : ""}</span>
                ) : (
                  <span className="font-semibold text-red-600">not installed — the block can't detect countries yet</span>
                )}
                {db?.error && db.loaded && <span className="text-amber-700"> — last update failed: {db.error}</span>}
              </span>
              {db?.autoUpdate && (
                <button
                  type="button"
                  onClick={() => void updateDatabase()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Update now
                </button>
              )}
            </div>
            {!db?.autoUpdate && (
              <div className="text-amber-700">
                Set MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY on the server so the country database downloads and updates itself.
              </div>
            )}
            {state.forcedOff && (
              <div className="font-semibold text-red-600">
                GEOBLOCK_FORCE_OFF is set on the server — the block stays off whatever this switch says.
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
