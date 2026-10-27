"use client";

import { useMemo, useState } from "react";
import { formatEuros, MONTH_LABELS_SHORT } from "@/lib/format";

type SortKey = "name" | "date" | "flat" | "price" | "label" | "prestataire" | "billToOwner";

interface CommSharingRow {
  id: string;
  name: string;
  date: string | null;
  flat: string | null;
  price: number | null;
  label: string | null;
  prestataire: string | null;
  billId: string | null;
  billToOwner: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function SortHeader({
  label,
  k,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = sortKey === k;
  return (
    <th className={`py-1.5 px-2 first:pl-3 last:pr-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium transition ${
          align === "right" ? "flex-row-reverse" : ""
        } ${isActive ? "text-[#1d1d1f]" : "text-[#86868b] hover:text-[#1d1d1f]"}`}
      >
        {label}
        {isActive && <span aria-hidden>{direction === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

export function CommSharingTable() {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - 1 + i);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [rows, setRows] = useState<CommSharingRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      const res = await fetch(`/api/finance/comm-sharing?${params.toString()}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setRows(null);
      } else {
        setRows(data.rows);
      }
    } catch {
      setError("Impossible de charger le tableau Monday.com.");
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  }

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const needle = search.trim().toLowerCase();
    return needle === ""
      ? rows
      : rows.filter((r) =>
          [r.name, r.flat, r.label, r.prestataire].some((v) => v?.toLowerCase().includes(needle))
        );
  }, [rows, search]);

  const sortedRows = useMemo(() => {
    if (!filteredRows) return null;
    return [...filteredRows].sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name, "fr");
          break;
        case "date":
          cmp = (a.date ?? "").localeCompare(b.date ?? "");
          break;
        case "flat":
          cmp = (a.flat ?? "").localeCompare(b.flat ?? "", "fr");
          break;
        case "price":
          cmp = (a.price ?? 0) - (b.price ?? 0);
          break;
        case "label":
          cmp = (a.label ?? "").localeCompare(b.label ?? "", "fr");
          break;
        case "prestataire":
          cmp = (a.prestataire ?? "").localeCompare(b.prestataire ?? "", "fr");
          break;
        case "billToOwner":
          cmp = (a.billToOwner ?? "").localeCompare(b.billToOwner ?? "");
          break;
      }
      return direction === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortKey, direction]);

  const total = sortedRows?.reduce((sum, r) => sum + (r.price ?? 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#6e6e73]">
        Tableau « Comm Sharing » Monday.com (facturation Sweep It) du mois sélectionné — lecture seule, en direct.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="comm-sharing-year">
            Année
          </label>
          <select
            id="comm-sharing-year"
            value={year}
            onChange={(e) => setYear(Number.parseInt(e.target.value, 10))}
            className="mt-1 h-9 rounded-[10px] border border-black/10 bg-white px-3 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="field-label">Mois</span>
          <div className="mt-1 flex flex-wrap gap-1 max-w-[320px]">
            {MONTH_LABELS_SHORT.map((label, i) => {
              const m = i + 1;
              const active = month === m;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setMonth(m)}
                  className={`rounded-[8px] border px-2.5 py-1.5 text-[13px] font-medium transition ${
                    active
                      ? "border-[#0071e3] bg-[#0071e3] text-white"
                      : "border-black/10 bg-white text-[#1d1d1f] hover:bg-black/[0.04]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="field-label invisible">Charger</span>
          <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm mt-1 h-9">
            {loading ? "Chargement…" : rows ? "Actualiser" : "Charger"}
          </button>
        </div>
      </div>

      {rows && (
        <div>
          <label className="field-label" htmlFor="comm-sharing-search">
            Recherche (bien, prestataire, label)
          </label>
          <input
            id="comm-sharing-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ex: 8MOR, Housekeeping, sweepit…"
            className="mt-1 w-72 rounded-[10px] border border-black/10 bg-white px-3 py-2 text-[14px] text-[#1d1d1f] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
          />
        </div>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {sortedRows && sortedRows.length === 0 && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Aucune ligne pour ce mois (ou ce filtre).</p>
      )}

      {sortedRows && sortedRows.length > 0 && !loading && !error && (
        <div className="space-y-2">
          <span className="rounded-full bg-[#0071e3]/10 px-3 py-1.5 text-[13px] font-semibold text-[#0071e3]">
            {sortedRows.length} ligne{sortedRows.length !== 1 ? "s" : ""} · {formatEuros(total)}
          </span>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <SortHeader label="Name" k="name" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Date" k="date" sortKey={sortKey} direction={direction} onSort={handleSort} align="right" />
                    <SortHeader label="Flat" k="flat" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Label" k="label" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Prestataire" k="prestataire" sortKey={sortKey} direction={direction} onSort={handleSort} />
                    <SortHeader label="Price" k="price" sortKey={sortKey} direction={direction} onSort={handleSort} align="right" />
                    <SortHeader
                      label="Bill to Owner"
                      k="billToOwner"
                      sortKey={sortKey}
                      direction={direction}
                      onSort={handleSort}
                      align="right"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, rowIndex) => (
                    <tr
                      key={row.id}
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">{row.name}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{formatDate(row.date)}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">{row.flat ?? "—"}</td>
                      <td className="py-1.5 px-2 text-[#1d1d1f]">{row.label ?? "—"}</td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{row.prestataire ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">
                        {row.price != null ? formatEuros(row.price) : "—"}
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right text-[#1d1d1f]">{row.billToOwner ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/[0.08] bg-black/[0.015] font-semibold text-[#1d1d1f]">
                    <td className="py-1.5 pl-3 pr-2" colSpan={5}>
                      Total ({sortedRows.length} ligne{sortedRows.length !== 1 ? "s" : ""})
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{formatEuros(total)}</td>
                    <td className="py-1.5 pl-2 pr-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!rows && !loading && !error && (
        <p className="text-[13px] text-[#6e6e73]">Choisis une année et un mois, puis charge les données.</p>
      )}
    </div>
  );
}
