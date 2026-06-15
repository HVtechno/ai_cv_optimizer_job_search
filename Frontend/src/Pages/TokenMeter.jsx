import { useState, useEffect, useCallback } from "react";
import api from "../components/api";

/**
 * TokenMeter — admin token-o-meter. Real-time OpenAI/Azure usage + cost.
 * Reads /usage/admin/* (admin-gated). Auto-refreshes every 15s so it feels live.
 * No chart library — uses a lightweight CSS bar chart to avoid new dependencies.
 */
export default function TokenMeter() {
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [byModel, setByModel] = useState([]);
  const [byFeature, setByFeature] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [s, d, m, f] = await Promise.all([
        api.get("/usage/admin/summary"),
        api.get(`/usage/admin/daily?days=${days}`),
        api.get("/usage/admin/by-model"),
        api.get("/usage/admin/by-feature"),
      ]);
      setSummary(s.data);
      setDaily(d.data?.daily || []);
      setByModel(m.data?.models || []);
      setByFeature(f.data?.features || []);
    } catch { /* surfaced by interceptor */ }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live-ish refresh
    return () => clearInterval(t);
  }, [load]);

  const fmt = (n) => (n ?? 0).toLocaleString();
  const usd = (n) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const usd4 = (n) => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

  const maxCost = Math.max(1, ...daily.map((d) => d.cost_usd || 0));

  const Stat = ({ label, value, sub }) => (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-[11px] text-gray-400 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );

  if (loading && !summary) {
    return <div className="h-full overflow-y-auto p-6 text-gray-400 text-sm">Loading usage…</div>;
  }

  const s = summary || {};
  return (
    <div className="h-full overflow-y-auto p-6 text-gray-200">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Token-o-meter</h1>
        <span className="text-[11px] text-gray-500">
          live · refreshes every 15s{s.as_of ? ` · as of ${new Date(s.as_of).toLocaleTimeString()}` : ""}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-5">
        Real-time OpenAI / Azure token usage and cost, metered from your own API calls.
      </p>

      {/* Headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat label="Cost today" value={usd(s.today?.cost_usd)} sub={`${fmt(s.today?.calls)} calls`} />
        <Stat label="Cost this month" value={usd(s.this_month?.cost_usd)} sub={`${fmt(s.this_month?.total_tokens)} tokens`} />
        <Stat label="Cost all-time" value={usd(s.all_time?.cost_usd)} sub={`${fmt(s.all_time?.calls)} calls`} />
        <Stat label="Tokens all-time" value={fmt(s.all_time?.total_tokens)}
          sub={`${fmt(s.all_time?.prompt_tokens)} in / ${fmt(s.all_time?.completion_tokens)} out`} />
      </div>

      {/* Input vs output today */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <Stat label="Input tokens today" value={fmt(s.today?.prompt_tokens)} />
        <Stat label="Output tokens today" value={fmt(s.today?.completion_tokens)} />
        <Stat label="Total tokens today" value={fmt(s.today?.total_tokens)} />
      </div>

      {/* Per-day chart */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Daily cost</h2>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="bg-gray-800 rounded px-2 py-1 text-xs outline-none">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        {daily.length === 0 && <p className="text-xs text-gray-500">No usage recorded yet.</p>}
        <div className="flex items-end gap-1 h-44">
          {daily.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center justify-end group relative">
              <div className="w-full rounded-t transition-all"
                style={{
                  height: `${Math.max(2, (d.cost_usd / maxCost) * 100)}%`,
                  background: "linear-gradient(180deg,#00e87a,#00c9ff)",
                }} />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-black text-[10px] px-2 py-1 rounded whitespace-nowrap z-10">
                {d.day}<br />{usd4(d.cost_usd)} · {fmt(d.total_tokens)} tok · {d.calls} calls
              </div>
            </div>
          ))}
        </div>
        {daily.length > 0 && (
          <div className="flex justify-between text-[10px] text-gray-600 mt-2">
            <span>{daily[0]?.day}</span>
            <span>{daily[daily.length - 1]?.day}</span>
          </div>
        )}
      </div>

      {/* By model + by feature */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">By model</h2>
          <table className="w-full text-xs">
            <thead className="text-gray-500 text-left">
              <tr><th className="py-1">Model</th><th className="py-1">Tokens</th><th className="py-1">Calls</th><th className="py-1">Cost</th></tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.model} className="border-t border-gray-800">
                  <td className="py-1.5 text-cyan-400">{m.model}</td>
                  <td className="py-1.5">{fmt(m.total_tokens)}</td>
                  <td className="py-1.5">{fmt(m.calls)}</td>
                  <td className="py-1.5 font-semibold">{usd4(m.cost_usd)}</td>
                </tr>
              ))}
              {byModel.length === 0 && <tr><td colSpan={4} className="py-2 text-gray-600">No data yet.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">By feature</h2>
          <table className="w-full text-xs">
            <thead className="text-gray-500 text-left">
              <tr><th className="py-1">Feature</th><th className="py-1">Tokens</th><th className="py-1">Calls</th><th className="py-1">Cost</th></tr>
            </thead>
            <tbody>
              {byFeature.map((f) => (
                <tr key={f.feature} className="border-t border-gray-800">
                  <td className="py-1.5 text-cyan-400">{f.feature}</td>
                  <td className="py-1.5">{fmt(f.total_tokens)}</td>
                  <td className="py-1.5">{fmt(f.calls)}</td>
                  <td className="py-1.5 font-semibold">{usd4(f.cost_usd)}</td>
                </tr>
              ))}
              {byFeature.length === 0 && <tr><td colSpan={4} className="py-2 text-gray-600">No data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Active price table (so admin sees the rates driving cost) */}
      {s.price_table && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mt-6">
          <h2 className="text-sm font-semibold text-white mb-1">Price table in effect</h2>
          <p className="text-[11px] text-gray-500 mb-3">
            Per 1M tokens. Override any rate via environment variables (e.g. for Azure rates) — no code change.
          </p>
          <table className="w-full text-xs">
            <thead className="text-gray-500 text-left">
              <tr><th className="py-1">Model</th><th className="py-1">Input / 1M</th><th className="py-1">Output / 1M</th></tr>
            </thead>
            <tbody>
              {Object.entries(s.price_table).map(([model, r]) => (
                <tr key={model} className="border-t border-gray-800">
                  <td className="py-1.5 text-gray-300">{model}</td>
                  <td className="py-1.5">${r.input}</td>
                  <td className="py-1.5">${r.output}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
