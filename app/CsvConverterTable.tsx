"use client";

import { useEffect, useMemo, useState } from "react";

/** Colonnes attendues dans l'export "Comm Sharing" (Monday.com) de Sweep It —
 * Name/Date/Flat/Price/Prestataire/Bill to Owner sont les seules réutilisées,
 * le reste (Subitems, People, Creation log, Resa Ref, Label, Bill ID,
 * Melvane OK, Text) est ignoré : soit sans équivalent côté VRPlatform, soit
 * déjà couvert autrement (Bill ID source non réutilisé — régénéré ci-dessous
 * pour garantir l'unicité, voir buildTargetRows). */
const SOURCE_HEADERS = ["Name", "Date", "Flat", "Price", "Prestataire", "Bill to Owner"] as const;

/** En-tête exact attendu par l'import "Expenses" de VRPlatform — l'ordre et
 * les libellés doivent correspondre au CSV que VRPlatform sait importer. */
const TARGET_COLUMNS = [
  "issueDate",
  "paymentDate",
  "description",
  "status",
  "bankCcAccount",
  "contact",
  "billId",
  "currency",
  "listing",
  "reservation",
  "lineDescription",
  "expenseAccount",
  "billToOwner",
  "appliedAmount",
  "markup",
  "markupTax",
] as const;
type TargetColumn = (typeof TARGET_COLUMNS)[number];

const TARGET_LABELS: Record<TargetColumn, string> = {
  issueDate: "Issue Date",
  paymentDate: "Payment Date",
  description: "Description",
  status: "Status",
  bankCcAccount: "Bank/CC account",
  contact: "Contact",
  billId: "Bill ID",
  currency: "Currency",
  listing: "Listing",
  reservation: "Reservation",
  lineDescription: "Line Description",
  expenseAccount: "Expense account",
  billToOwner: "Bill to Owner",
  appliedAmount: "Applied amount",
  markup: "Markup",
  markupTax: "Markup Tax",
};

type TargetRow = Record<TargetColumn, string>;

/** Parseur CSV tolérant aux champs entre guillemets (virgules/retours à la
 * ligne échappés), nécessaire car un export Monday.com peut contenir des
 * virgules dans les noms/descriptions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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

/** "2026-10-05", "10/5/2026", "2026-10-05 14:29:00"... → "YYYY-MM-DD", ou la
 * valeur d'origine telle quelle si elle n'est pas reconnue comme une date
 * (reste éditable dans l'aperçu plutôt que de planter la conversion). */
function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return trimmed;
}

const DEFAULT_STATUS = "Paid";
const DEFAULT_BANK_ACCOUNT = "Non-Trust Account";
const DEFAULT_CURRENCY = "EUR";

/** Construit les lignes cible à partir des lignes source — voir le tableau
 * de correspondance expliqué à l'utilisateur : Issue/Payment Date ← Date,
 * Description/Line Description ← Name, Contact ← Prestataire, Listing ←
 * Flat, Bill to Owner passthrough, Applied amount ← Price. Bill ID n'est PAS
 * repris de la source (format non unique d'un export à l'autre) : il est
 * régénéré comme Listing + numéro de ligne de sortie, pour garantir
 * l'unicité dans le fichier généré. Reservation/Markup/Markup Tax restent
 * vides (aucune correspondance fiable côté source). */
function buildTargetRows(sourceRows: string[][], headerIndex: Map<string, number>): TargetRow[] {
  const get = (row: string[], header: string) => {
    const idx = headerIndex.get(header);
    return idx != null ? (row[idx] ?? "") : "";
  };
  return sourceRows.map((row, i) => {
    const flat = get(row, "Flat").trim();
    const outputRowNumber = i + 2; // ligne 1 = en-tête du CSV généré
    return {
      issueDate: normalizeDate(get(row, "Date")),
      paymentDate: normalizeDate(get(row, "Date")),
      description: get(row, "Name").trim(),
      status: DEFAULT_STATUS,
      bankCcAccount: DEFAULT_BANK_ACCOUNT,
      contact: get(row, "Prestataire").trim(),
      billId: `${flat}${outputRowNumber}`,
      currency: DEFAULT_CURRENCY,
      listing: flat,
      reservation: "",
      lineDescription: get(row, "Name").trim(),
      expenseAccount: "",
      billToOwner: get(row, "Bill to Owner").trim() || "FALSE",
      appliedAmount: get(row, "Price").trim(),
      markup: "",
      markupTax: "",
    };
  });
}

export function CsvConverterTable() {
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<string[]>([]);
  const [bulkExpenseAccount, setBulkExpenseAccount] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/finance/expense-accounts");
        const data = await res.json();
        if (!data.error) setExpenseAccounts(data.accounts);
      } catch {
        // Ignoré — le champ "Expense account" reste un texte libre si la
        // liste VRPlatform ne charge pas.
      }
    })();
  }, []);

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 1) {
        setParseError("Fichier vide ou illisible.");
        setRows(null);
        return;
      }
      const header = parsed[0].map((h) => h.trim());
      const headerIndex = new Map(header.map((h, i) => [h, i]));
      const missing = SOURCE_HEADERS.filter((h) => !headerIndex.has(h));
      setMissingHeaders(missing);
      const dataRows = parsed.slice(1);
      setRows(buildTargetRows(dataRows, headerIndex));
    } catch {
      setParseError("Impossible de lire ce fichier — vérifie qu'il s'agit bien d'un CSV.");
      setRows(null);
    }
  }

  function updateCell(rowIndex: number, col: TargetColumn, value: string) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[rowIndex] = { ...next[rowIndex], [col]: value };
      return next;
    });
  }

  function removeRow(rowIndex: number) {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== rowIndex) : prev));
  }

  function applyBulkExpenseAccount() {
    if (!bulkExpenseAccount) return;
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, expenseAccount: bulkExpenseAccount })) : prev));
  }

  const csvContent = useMemo(() => {
    if (!rows) return "";
    const lines = [
      TARGET_COLUMNS.map((c) => escapeCsvField(TARGET_LABELS[c])).join(","),
      ...rows.map((row) => TARGET_COLUMNS.map((c) => escapeCsvField(row[c])).join(",")),
    ];
    return lines.join("\r\n");
  }, [rows]);

  function downloadCsv() {
    if (!rows || rows.length === 0) return;
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = fileName ? fileName.replace(/\.[^.]+$/, "") : "export";
    a.download = `${base}_vrplatform.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#6e6e73]">
        Convertit un export CSV &laquo;&nbsp;Comm Sharing&nbsp;&raquo; (Monday.com, colonnes Name/Date/Flat/Price/Prestataire/Bill
        to Owner) vers le format d&apos;import &laquo;&nbsp;Expenses&nbsp;&raquo; de VRPlatform. Vérifie et corrige
        l&apos;aperçu (notamment Expense account) avant de télécharger.
      </p>

      <div>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block text-[13px] text-[#1d1d1f] file:mr-3 file:rounded-[8px] file:border-0 file:bg-[#0071e3] file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-white hover:file:bg-[#0071e3]/90"
        />
      </div>

      {parseError && <p className="text-[13px] text-red-600">{parseError}</p>}
      {missingHeaders.length > 0 && (
        <p className="text-[13px] text-amber-600">
          Colonnes manquantes dans le fichier source : {missingHeaders.join(", ")} — les champs correspondants sont vides,
          à compléter manuellement dans l&apos;aperçu.
        </p>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-black/10 bg-white p-3">
            <label className="field-label" htmlFor="bulk-expense-account">
              Appliquer un compte de dépense à toutes les lignes
            </label>
            <select
              id="bulk-expense-account"
              value={bulkExpenseAccount}
              onChange={(e) => setBulkExpenseAccount(e.target.value)}
              className="rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            >
              <option value="">— choisir —</option>
              {expenseAccounts.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" onClick={applyBulkExpenseAccount} className="btn-secondary btn-sm">
              Appliquer
            </button>
            <span className="ml-auto text-[13px] text-[#6e6e73]">{rows.length} ligne{rows.length !== 1 ? "s" : ""}</span>
            <button type="button" onClick={downloadCsv} className="btn-secondary btn-sm">
              Télécharger le CSV
            </button>
          </div>

          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]"></th>
                    {TARGET_COLUMNS.map((col) => (
                      <th key={col} className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b] whitespace-nowrap">
                        {TARGET_LABELS[col]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className={`border-b border-black/[0.04] last:border-b-0 ${rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"}`}
                    >
                      <td className="py-1 pl-3 pr-2">
                        <button
                          type="button"
                          onClick={() => removeRow(rowIndex)}
                          title="Retirer cette ligne"
                          className="text-[#c7c7cc] transition hover:text-red-600"
                        >
                          ✕
                        </button>
                      </td>
                      {TARGET_COLUMNS.map((col) =>
                        col === "expenseAccount" ? (
                          <td key={col} className="py-1 px-1">
                            <select
                              value={row.expenseAccount}
                              onChange={(e) => updateCell(rowIndex, col, e.target.value)}
                              className="w-40 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                            >
                              <option value="">—</option>
                              {expenseAccounts.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </td>
                        ) : (
                          <td key={col} className="py-1 px-1">
                            <input
                              type="text"
                              value={row[col]}
                              onChange={(e) => updateCell(rowIndex, col, e.target.value)}
                              className="w-28 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                            />
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!rows && !parseError && (
        <p className="text-[13px] text-[#6e6e73]">Choisis un fichier CSV exporté depuis le board &laquo;&nbsp;Comm Sharing&nbsp;&raquo;.</p>
      )}
    </div>
  );
}
