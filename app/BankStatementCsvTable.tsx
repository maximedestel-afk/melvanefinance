"use client";

import { useEffect, useRef, useState } from "react";

interface VrRow {
  date: string;
  amount: string;
  description: string;
}

interface Conversion {
  id: string;
  wiseFilePath: string;
  wiseFileName: string;
  vrFilePath: string;
  vrFileName: string;
  rowCount: number;
  createdAt: string;
}

/** En-têtes attendus dans l'export "Balance statement" CSV de WISE —
 * seules Date/Amount/Description sont réutilisées, le reste (Currency,
 * Payment Reference, Running Balance, infos carte/change...) est ignoré. */
const DATE_HEADER = "Date";
const AMOUNT_HEADER = "Amount";
const DESCRIPTION_HEADER = "Description";

/** Parseur CSV tolérant aux champs entre guillemets (virgules/retours à la
 * ligne échappés) — un export WISE contient des descriptions avec des
 * virgules ("Received money from X with reference Y"). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < normalized.length) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** "04-11-2026" (format WISE, JJ-MM-AAAA) → "2026-11-04" — laisse la valeur
 * telle quelle si elle n'a pas ce format (reste visible dans l'aperçu au
 * lieu de planter la conversion). */
function convertWiseDate(raw: string): string {
  const trimmed = raw.trim();
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return trimmed;
}

function formatDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function BankStatementCsvTable() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<VrRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [conversions, setConversions] = useState<Conversion[] | null>(null);
  const [loadingConversions, setLoadingConversions] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadConversions() {
    setLoadingConversions(true);
    setListError(null);
    try {
      const res = await fetch("/api/finance/bank-statements");
      const data = await res.json();
      if (data.error) setListError(data.error);
      else setConversions(data.conversions);
    } catch {
      setListError("Impossible de charger l'historique des relevés.");
    } finally {
      setLoadingConversions(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversions();
  }, []);

  function handleFile(selected: File) {
    setFile(selected);
    setParseError(null);
    setSaveError(null);
    selected
      .text()
      .then((text) => {
        const parsed = parseCsv(text);
        if (parsed.length < 2) {
          setParseError("Fichier vide ou illisible.");
          setRows(null);
          return;
        }
        const header = parsed[0].map((h) => h.trim());
        const dateIdx = header.indexOf(DATE_HEADER);
        const amountIdx = header.indexOf(AMOUNT_HEADER);
        const descriptionIdx = header.indexOf(DESCRIPTION_HEADER);
        if (dateIdx === -1 || amountIdx === -1 || descriptionIdx === -1) {
          setParseError(
            `Colonnes attendues introuvables (Date/Amount/Description) — colonnes trouvées : ${header.join(", ")}`
          );
          setRows(null);
          return;
        }
        const dataRows = parsed.slice(1);
        setRows(
          dataRows.map((r) => ({
            date: convertWiseDate(r[dateIdx] ?? ""),
            amount: (r[amountIdx] ?? "").trim(),
            description: (r[descriptionIdx] ?? "").trim(),
          }))
        );
      })
      .catch(() => {
        setParseError("Impossible de lire ce fichier — vérifie qu'il s'agit bien d'un CSV.");
        setRows(null);
      });
  }

  function vrCsvContent(): string {
    if (!rows) return "";
    const lines = [
      ["Date", "Amount", "Description"].join(","),
      ...rows.map((r) => [r.date, r.amount, r.description].map(escapeCsvField).join(",")),
    ];
    return lines.join("\r\n");
  }

  function downloadVrCsv() {
    if (!rows || rows.length === 0) return;
    const blob = new Blob(["﻿" + vrCsvContent()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = file ? file.name.replace(/\.[^.]+$/, "") : "releve";
    a.download = `${base}_vr.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (!file || !rows || rows.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const vrBlob = new Blob(["﻿" + vrCsvContent()], { type: "text/csv;charset=utf-8;" });
      const base = file.name.replace(/\.[^.]+$/, "");
      const vrFile = new File([vrBlob], `${base}_vr.csv`, { type: "text/csv" });

      const form = new FormData();
      form.append("wiseFile", file);
      form.append("vrFile", vrFile);
      form.append("rowCount", String(rows.length));

      const res = await fetch("/api/finance/bank-statements", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        setSaveError(data.error);
        return;
      }
      resetForm();
      await loadConversions();
    } catch {
      setSaveError("Impossible d'enregistrer ce relevé.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setFile(null);
    setRows(null);
    setParseError(null);
    setSaveError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeRow(index: number) {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  }

  async function openFile(path: string) {
    setOpeningPath(path);
    try {
      const params = new URLSearchParams({ path });
      const res = await fetch(`/api/finance/bank-statements/file?${params.toString()}`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      else setListError(data.error ?? "Impossible d'ouvrir le fichier.");
    } catch {
      setListError("Impossible d'ouvrir le fichier.");
    } finally {
      setOpeningPath(null);
    }
  }

  async function deleteConversion(id: string) {
    const previous = conversions;
    setDeletingId(id);
    setConversions((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
    try {
      const res = await fetch(`/api/finance/bank-statements/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        setListError(data.error);
        setConversions(previous);
      }
    } catch {
      setListError("Impossible de supprimer ce relevé.");
      setConversions(previous);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[12px] border border-black/10 bg-white p-4 space-y-3">
        <span className="field-label">Convertir un relevé WISE</span>
        <p className="text-[12px] text-[#86868b]">
          Dépose un export CSV WISE (colonnes Date/Amount/Description, entre autres) — il est converti en un CSV à 3
          colonnes (Date au format AAAA-MM-JJ, Amount, Description) prêt à importer dans VRPlatform. Les deux fichiers
          (WISE original et VR converti) sont ensuite enregistrés ensemble.
        </p>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) handleFile(dropped);
          }}
          className={`flex cursor-pointer items-center justify-center rounded-[10px] border-2 border-dashed px-4 py-5 text-center text-[13px] transition ${
            isDraggingOver ? "border-[#0071e3] bg-[#0071e3]/5 text-[#0071e3]" : "border-black/15 text-[#6e6e73] hover:border-black/25"
          }`}
        >
          {file ? <span className="text-[#1d1d1f]">📄 {file.name}</span> : <span>Glisse un CSV WISE ici, ou clique pour en choisir un</span>}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) handleFile(selected);
          }}
          className="hidden"
        />

        {parseError && <p className="text-[13px] text-red-600">{parseError}</p>}
        {saveError && <p className="text-[13px] text-red-600">{saveError}</p>}

        {rows && rows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-[#6e6e73]">{rows.length} ligne{rows.length !== 1 ? "s" : ""}</span>
              <button type="button" onClick={downloadVrCsv} className="btn-secondary btn-sm">
                Télécharger le CSV
              </button>
              <button type="button" onClick={save} disabled={saving} className="btn-secondary btn-sm">
                {saving ? "Enregistrement…" : "Enregistrer (WISE + VR)"}
              </button>
              <button type="button" onClick={resetForm} className="text-[12px] font-medium text-[#0071e3] hover:underline">
                Effacer
              </button>
            </div>
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="max-h-72 overflow-y-auto overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-1.5 pl-3 pr-1"></th>
                      <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                      <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Amount</th>
                      <th className="py-1.5 pl-2 pr-3 text-left text-[11px] font-medium text-[#86868b]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-b border-black/[0.04] last:border-b-0 ${i % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"}`}>
                        <td className="py-1 pl-3 pr-1">
                          <button
                            type="button"
                            onClick={() => removeRow(i)}
                            title="Retirer cette ligne"
                            className="text-[#c7c7cc] transition hover:text-red-600"
                          >
                            ✕
                          </button>
                        </td>
                        <td className="py-1 px-2 tabular-nums text-[#1d1d1f]">{r.date}</td>
                        <td className="py-1 px-2 text-right tabular-nums text-[#1d1d1f]">{r.amount}</td>
                        <td className="py-1 pl-2 pr-3 text-[#1d1d1f]">{r.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="field-label">Relevés enregistrés</span>
          <button type="button" onClick={loadConversions} disabled={loadingConversions} className="btn-secondary btn-sm">
            {loadingConversions ? "Chargement…" : "Actualiser"}
          </button>
        </div>
        {listError && <p className="text-[13px] text-red-600">{listError}</p>}
        {conversions && conversions.length === 0 && !loadingConversions && (
          <p className="text-[13px] text-[#6e6e73]">Aucun relevé enregistré.</p>
        )}
        {conversions && conversions.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Fichier WISE</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Fichier VR</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Lignes</th>
                    <th className="py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {conversions.map((c, i) => (
                    <tr key={c.id} className={`border-b border-black/[0.04] last:border-b-0 ${i % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"}`}>
                      <td className="py-1.5 pl-3 pr-2 text-[#1d1d1f]">{formatDate(c.createdAt)}</td>
                      <td className="py-1.5 px-2">
                        <button
                          type="button"
                          onClick={() => openFile(c.wiseFilePath)}
                          disabled={openingPath === c.wiseFilePath}
                          className="text-[#0071e3] hover:underline"
                        >
                          📄 {c.wiseFileName}
                        </button>
                      </td>
                      <td className="py-1.5 px-2">
                        <button
                          type="button"
                          onClick={() => openFile(c.vrFilePath)}
                          disabled={openingPath === c.vrFilePath}
                          className="text-[#0071e3] hover:underline"
                        >
                          📄 {c.vrFileName}
                        </button>
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{c.rowCount}</td>
                      <td className="py-1.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => deleteConversion(c.id)}
                          disabled={deletingId === c.id}
                          title="Supprimer ce relevé"
                          className="text-[#c7c7cc] transition hover:text-red-600"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
