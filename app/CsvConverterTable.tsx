"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** SheetJS (xlsx) chargé depuis son propre CDN plutôt qu'en dépendance npm :
 * le paquet npm "xlsx" accuse 2 vulnérabilités connues (prototype pollution,
 * ReDoS) sans version corrigée publiée sur le registre npm — SheetJS
 * recommande lui-même cdn.sheetjs.com comme seule source à jour. Version
 * figée (pas de tag "latest") pour ne pas charger du code non revu. */
const SHEETJS_SCRIPT_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

interface SheetJsStatic {
  read(data: ArrayBuffer, opts: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(sheet: unknown, opts: { header: 1; defval: string; raw: false; dateNF: string }): string[][] };
}

let sheetJsLoadPromise: Promise<SheetJsStatic> | null = null;

/** Charge SheetJS une seule fois (mise en cache de la promesse) et renvoie
 * l'objet global XLSX une fois le script prêt. */
function loadSheetJs(): Promise<SheetJsStatic> {
  if (sheetJsLoadPromise) return sheetJsLoadPromise;
  sheetJsLoadPromise = new Promise((resolve, reject) => {
    const existing = (window as unknown as { XLSX?: SheetJsStatic }).XLSX;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = SHEETJS_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const xlsx = (window as unknown as { XLSX?: SheetJsStatic }).XLSX;
      if (xlsx) resolve(xlsx);
      else reject(new Error("XLSX non disponible après chargement du script."));
    };
    script.onerror = () => reject(new Error("Impossible de charger la librairie Excel (cdn.sheetjs.com injoignable)."));
    document.head.appendChild(script);
  });
  return sheetJsLoadPromise;
}

/** Colonnes attendues dans l'export "Comm Sharing" (Monday.com) de Sweep It —
 * Name/Date/Flat/Price/Label/Prestataire/Bill ID/Bill to Owner sont les
 * seules réutilisées, le reste (Subitems, People, Creation log, Resa Ref,
 * Melvane OK, Text) est ignoré : pas d'équivalent côté VRPlatform. */
const SOURCE_HEADERS = ["Name", "Date", "Flat", "Price", "Label", "Prestataire", "Bill ID", "Bill to Owner"] as const;

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
  // Retire un éventuel BOM UTF-8 en tête de fichier (fréquent sur les CSV
  // exportés depuis Excel) — sinon il reste collé au premier en-tête
  // ("﻿Name" ≠ "Name") et casse le mapping de toute la première colonne.
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
const BANK_ACCOUNT_OPTIONS = ["Non-Trust Account", "WISE"] as const;

/** Inverse le signe d'un montant texte ("50" ↔ "-50") — laisse la valeur
 * telle quelle si elle n'est pas un nombre valide. */
function negateAmountString(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return trimmed;
  const n = Number.parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(n)) return value;
  return String(-n);
}

/** Construit les lignes cible à partir des lignes source : Issue/Payment
 * Date ← Date (YYYY-MM-DD), Description/Line Description ← Name, Listing ←
 * Flat, Bill ID ← Bill ID, Applied amount ← Price, Expense account ← Label,
 * Contact ← Prestataire, Bill to Owner passthrough. Reservation/Markup/
 * Markup Tax restent vides (aucune correspondance côté source). */

/** Une vue Monday.com exportée en Excel inclut souvent 1-2 lignes de titre
 * avant la vraie ligne d'en-têtes (ex: "Oct 26" puis "Comm Sharing") — on ne
 * peut donc pas supposer que la ligne 1 est l'en-tête. Cherche, parmi les 10
 * premières lignes, celle qui contient le plus de colonnes attendues. */
function findHeaderRowIndex(parsed: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  const scanLimit = Math.min(parsed.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const cells = new Set(parsed[i].map((c) => c.trim()));
    const score = SOURCE_HEADERS.filter((h) => cells.has(h)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function buildTargetRows(sourceRows: string[][], headerIndex: Map<string, number>): TargetRow[] {
  const get = (row: string[], header: string) => {
    const idx = headerIndex.get(header);
    return idx != null ? (row[idx] ?? "") : "";
  };
  return sourceRows.map((row) => ({
    issueDate: normalizeDate(get(row, "Date")),
    paymentDate: normalizeDate(get(row, "Date")),
    description: get(row, "Name").trim(),
    status: DEFAULT_STATUS,
    bankCcAccount: DEFAULT_BANK_ACCOUNT,
    contact: get(row, "Prestataire").trim(),
    billId: get(row, "Bill ID").trim(),
    currency: DEFAULT_CURRENCY,
    listing: get(row, "Flat").trim(),
    reservation: "",
    lineDescription: get(row, "Name").trim(),
    expenseAccount: get(row, "Label").trim(),
    billToOwner: get(row, "Bill to Owner").trim() || "FALSE",
    appliedAmount: get(row, "Price").trim(),
    markup: "",
    markupTax: "",
  }));
}

export function CsvConverterTable() {
  const [rows, setRows] = useState<TargetRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<string[]>([]);
  const [bulkExpenseAccount, setBulkExpenseAccount] = useState("");
  const [bulkBankAccount, setBulkBankAccount] = useState<string>(DEFAULT_BANK_ACCOUNT);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkBillId, setBulkBillId] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function applyParsedRows(parsed: string[][]) {
    if (parsed.length < 1) {
      setParseError("Fichier vide ou illisible.");
      setRows(null);
      return;
    }
    const headerRowIndex = findHeaderRowIndex(parsed);
    const header = parsed[headerRowIndex].map((h) => h.trim());
    const headerIndex = new Map(header.map((h, i) => [h, i]));
    const missing = SOURCE_HEADERS.filter((h) => !headerIndex.has(h));
    setMissingHeaders(missing);
    const nameIdx = headerIndex.get("Name");
    // Écarte les lignes sans "Name" (ex: ligne de total/récap en fin de
    // tableau Monday.com) — toute ligne réelle a un Name renseigné.
    const dataRows = parsed
      .slice(headerRowIndex + 1)
      .filter((row) => nameIdx == null || (row[nameIdx] ?? "").trim() !== "");
    setRows(buildTargetRows(dataRows, headerIndex));
  }

  async function handleFile(file: File) {
    setParseError(null);
    setFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name);
    try {
      if (isExcel) {
        setLoadingLibrary(true);
        let xlsx: SheetJsStatic;
        try {
          xlsx = await loadSheetJs();
        } finally {
          setLoadingLibrary(false);
        }
        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const parsed = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
        applyParsedRows(parsed.map((row) => row.map((cell) => String(cell ?? ""))));
      } else {
        const text = await file.text();
        applyParsedRows(parseCsv(text));
      }
    } catch (err) {
      setParseError(
        err instanceof Error && isExcel
          ? err.message
          : "Impossible de lire ce fichier — vérifie qu'il s'agit bien d'un CSV ou d'un fichier Excel (.xlsx)."
      );
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

  function applyBulkBankAccount() {
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, bankCcAccount: bulkBankAccount })) : prev));
  }

  function invertAllAmountSigns() {
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, appliedAmount: negateAmountString(r.appliedAmount) })) : prev));
  }

  function clearAllListings() {
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, listing: "" })) : prev));
  }

  function applyBulkDate() {
    if (!bulkDate) return;
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, issueDate: bulkDate, paymentDate: bulkDate })) : prev));
  }

  function applyBulkBillId() {
    if (!bulkBillId) return;
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, billId: bulkBillId })) : prev));
  }

  function clearFile() {
    setRows(null);
    setFileName(null);
    setParseError(null);
    setMissingHeaders([]);
    setBulkExpenseAccount("");
    setBulkBankAccount(DEFAULT_BANK_ACCOUNT);
    setBulkDate("");
    setBulkBillId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
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
        Convertit un export &laquo;&nbsp;Comm Sharing&nbsp;&raquo; (Monday.com, CSV ou Excel .xlsx/.xls, colonnes
        Name/Date/Flat/Price/Prestataire/Bill to Owner) vers le format d&apos;import &laquo;&nbsp;Expenses&nbsp;&raquo; de
        VRPlatform. Vérifie et corrige l&apos;aperçu (notamment Expense account) avant de télécharger.
      </p>

      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block text-[13px] text-[#1d1d1f] file:mr-3 file:rounded-[8px] file:border-0 file:bg-[#0071e3] file:px-3 file:py-2 file:text-[13px] file:font-medium file:text-white hover:file:bg-[#0071e3]/90"
        />
        {(fileName || rows) && (
          <button type="button" onClick={clearFile} className="btn-secondary btn-sm">
            Effacer le fichier
          </button>
        )}
      </div>

      {loadingLibrary && <p className="text-[13px] text-[#6e6e73]">Chargement de la librairie Excel…</p>}
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

            <label className="field-label ml-4" htmlFor="bulk-bank-account">
              Compte bancaire pour toutes les lignes
            </label>
            <select
              id="bulk-bank-account"
              value={bulkBankAccount}
              onChange={(e) => setBulkBankAccount(e.target.value)}
              className="rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            >
              {BANK_ACCOUNT_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button type="button" onClick={applyBulkBankAccount} className="btn-secondary btn-sm">
              Appliquer
            </button>

            <button
              type="button"
              onClick={invertAllAmountSigns}
              title="Multiplie le montant de toutes les lignes par -1"
              className="btn-secondary btn-sm"
            >
              Inverser le signe (toutes les lignes)
            </button>

            <button
              type="button"
              onClick={clearAllListings}
              title="Vide la colonne Listing sur toutes les lignes"
              className="btn-secondary btn-sm"
            >
              Effacer le Listing (toutes les lignes)
            </button>

            <label className="field-label ml-4" htmlFor="bulk-date">
              Date (Issue + Payment) pour toutes les lignes
            </label>
            <input
              id="bulk-date"
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              className="rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
            <button type="button" onClick={applyBulkDate} className="btn-secondary btn-sm">
              Appliquer
            </button>

            <label className="field-label ml-4" htmlFor="bulk-bill-id">
              Bill ID pour toutes les lignes
            </label>
            <input
              id="bulk-bill-id"
              type="text"
              value={bulkBillId}
              onChange={(e) => setBulkBillId(e.target.value)}
              className="w-32 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
            <button type="button" onClick={applyBulkBillId} className="btn-secondary btn-sm">
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
                            <input
                              type="text"
                              list="expense-account-options"
                              value={row.expenseAccount}
                              onChange={(e) => updateCell(rowIndex, col, e.target.value)}
                              title="Pré-rempli depuis la colonne Label du fichier source — ajuste si besoin (suggestions = comptes VRPlatform réels)."
                              className="w-40 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                            />
                          </td>
                        ) : col === "bankCcAccount" ? (
                          <td key={col} className="py-1 px-1">
                            <select
                              value={row.bankCcAccount}
                              onChange={(e) => updateCell(rowIndex, col, e.target.value)}
                              className="w-32 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                            >
                              {BANK_ACCOUNT_OPTIONS.map((name) => (
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
          <datalist id="expense-account-options">
            {expenseAccounts.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      )}

      {!rows && !parseError && (
        <p className="text-[13px] text-[#6e6e73]">
          Choisis un fichier CSV ou Excel exporté depuis le board &laquo;&nbsp;Comm Sharing&nbsp;&raquo;.
        </p>
      )}
    </div>
  );
}
