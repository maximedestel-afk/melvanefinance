"use client";

import { Fragment, useEffect, useRef, useState } from "react";

interface VrRow {
  date: string;
  amount: string;
  description: string;
  /** Identifiant WISE de la transaction ("TransferWise ID"), utilisé comme
   * Bill ID par défaut (auto-généré) de la ligne de dépense. */
  wiseId: string;
  /** Transaction marquée pour générer en plus une ligne de dépense
   * VRPlatform (ex: "Card transaction ... issued by Supabase SINGAPORE"). */
  isExpense: boolean;
  expenseBillId: string;
  expenseBank: string;
  expenseDescription: string;
  expenseListing: string;
  expenseContact: string;
  expenseAccount: string;
  billToOwner: "TRUE" | "FALSE";
}

/** Même en-tête que le Convertisseur CSV — format d'import "Expenses" de
 * VRPlatform. */
const EXPENSE_COLUMNS = [
  "Issue Date",
  "Payment Date",
  "Description",
  "Status",
  "Bank/CC account",
  "Contact",
  "Bill ID",
  "Currency",
  "Listing",
  "Reservation",
  "Line Description",
  "Expense account",
  "Bill to Owner",
  "Applied amount",
  "Markup",
  "Markup Tax",
] as const;

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
const WISE_ID_HEADER = "TransferWise ID";

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

  const [expenseAccounts, setExpenseAccounts] = useState<string[]>([]);
  const [contacts, setContacts] = useState<string[]>([]);

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
    (async () => {
      try {
        const res = await fetch("/api/finance/expense-accounts");
        const data = await res.json();
        if (!data.error) setExpenseAccounts(data.accounts);
      } catch {
        // Ignoré — le champ "Expense account" reste un texte libre si la liste VRPlatform ne charge pas.
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/finance/contacts");
        const data = await res.json();
        if (!data.error) setContacts(data.contacts);
      } catch {
        // Ignoré — le champ "Contact" reste un texte libre si la liste VRPlatform ne charge pas.
      }
    })();
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
        const wiseIdIdx = header.indexOf(WISE_ID_HEADER);
        if (dateIdx === -1 || amountIdx === -1 || descriptionIdx === -1) {
          setParseError(
            `Colonnes attendues introuvables (Date/Amount/Description) — colonnes trouvées : ${header.join(", ")}`
          );
          setRows(null);
          return;
        }
        const dataRows = parsed.slice(1);
        setRows(
          dataRows.map((r) => {
            const description = (r[descriptionIdx] ?? "").trim();
            const wiseId = wiseIdIdx !== -1 ? (r[wiseIdIdx] ?? "").trim() : "";
            return {
              date: convertWiseDate(r[dateIdx] ?? ""),
              amount: (r[amountIdx] ?? "").trim(),
              description,
              wiseId,
              isExpense: false,
              expenseBillId: wiseId,
              expenseBank: "WISE",
              expenseDescription: description,
              expenseListing: "",
              expenseContact: "",
              expenseAccount: "",
              billToOwner: "FALSE" as const,
            };
          })
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

  function toggleExpense(index: number) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, isExpense: !r.isExpense } : r)) : prev));
  }

  function updateExpenseField(
    index: number,
    field: "expenseBillId" | "expenseBank" | "expenseDescription" | "expenseListing" | "expenseContact" | "expenseAccount" | "billToOwner",
    value: string
  ) {
    setRows((prev) => (prev ? prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)) : prev));
  }

  const expenseRows = rows?.filter((r) => r.isExpense && r.expenseAccount.trim() !== "") ?? [];

  function downloadExpensesCsv() {
    if (expenseRows.length === 0) return;
    const lines = [
      EXPENSE_COLUMNS.join(","),
      ...expenseRows.map((r) =>
        [
          r.date,
          r.date,
          r.expenseDescription,
          "Paid",
          r.expenseBank,
          r.expenseContact,
          r.expenseBillId,
          "EUR",
          r.expenseListing,
          "",
          r.expenseDescription,
          r.expenseAccount,
          r.billToOwner,
          r.amount,
          "",
          "",
        ]
          .map(escapeCsvField)
          .join(",")
      ),
    ];
    const csvContent = lines.join("\r\n");
    const blob = new Blob(["﻿" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = file ? file.name.replace(/\.[^.]+$/, "") : "releve";
    a.download = `${base}_depenses.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
              {expenseRows.length > 0 && (
                <button type="button" onClick={downloadExpensesCsv} className="btn-secondary btn-sm">
                  Exporter les dépenses ({expenseRows.length}) (CSV)
                </button>
              )}
              <button type="button" onClick={resetForm} className="text-[12px] font-medium text-[#0071e3] hover:underline">
                Effacer
              </button>
            </div>
            <p className="text-[11px] text-[#86868b]">
              Pour certaines transactions (ex: abonnements logiciels), clique « + Dépense » pour générer en plus une
              ligne au format d&apos;import « Expenses » de VRPlatform.
            </p>
            <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
              <div className="max-h-96 overflow-y-auto overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                      <th className="py-1.5 pl-3 pr-1"></th>
                      <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Date</th>
                      <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Amount</th>
                      <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Description</th>
                      <th className="py-1.5 pl-2 pr-3 text-left text-[11px] font-medium text-[#86868b]">Dépense</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <Fragment key={i}>
                      <tr
                        className={`border-b border-black/[0.04] last:border-b-0 ${
                          r.isExpense ? "bg-amber-50/60" : i % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                        }`}
                      >
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
                        <td className="py-1 px-2 text-[#1d1d1f]">{r.description}</td>
                        <td className="py-1 pl-2 pr-3">
                          <button
                            type="button"
                            onClick={() => toggleExpense(i)}
                            className={`text-[12px] font-medium ${r.isExpense ? "text-[#c7c7cc] hover:text-red-600" : "text-[#0071e3] hover:underline"}`}
                          >
                            {r.isExpense ? "✕ Annuler" : "+ Dépense"}
                          </button>
                        </td>
                      </tr>
                      {r.isExpense && (
                        <tr className="border-b border-black/[0.04] bg-amber-50/30">
                          <td colSpan={5} className="px-3 py-2">
                            <div className="flex flex-wrap items-end gap-2">
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Bill ID</label>
                                <input
                                  type="text"
                                  value={r.expenseBillId}
                                  onChange={(e) => updateExpenseField(i, "expenseBillId", e.target.value)}
                                  className="mt-0.5 block w-32 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Bank/CC account</label>
                                <input
                                  type="text"
                                  value={r.expenseBank}
                                  onChange={(e) => updateExpenseField(i, "expenseBank", e.target.value)}
                                  className="mt-0.5 block w-28 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Description (= Line Description)</label>
                                <input
                                  type="text"
                                  value={r.expenseDescription}
                                  onChange={(e) => updateExpenseField(i, "expenseDescription", e.target.value)}
                                  className="mt-0.5 block w-64 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Listing</label>
                                <input
                                  type="text"
                                  value={r.expenseListing}
                                  onChange={(e) => updateExpenseField(i, "expenseListing", e.target.value)}
                                  className="mt-0.5 block w-28 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Contact</label>
                                <input
                                  type="text"
                                  list="bank-statement-contacts"
                                  value={r.expenseContact}
                                  onChange={(e) => updateExpenseField(i, "expenseContact", e.target.value)}
                                  className="mt-0.5 block w-40 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="text-[10.5px] text-[#86868b]">Expense account</label>
                                <input
                                  type="text"
                                  list="bank-statement-expense-accounts"
                                  value={r.expenseAccount}
                                  onChange={(e) => updateExpenseField(i, "expenseAccount", e.target.value)}
                                  className="mt-0.5 block w-40 rounded-[6px] border border-black/10 bg-white px-1.5 py-1 text-[12px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none"
                                />
                              </div>
                              <label className="flex items-center gap-1.5 pb-1.5 text-[12px] text-[#1d1d1f]">
                                <input
                                  type="checkbox"
                                  checked={r.billToOwner === "TRUE"}
                                  onChange={(e) => updateExpenseField(i, "billToOwner", e.target.checked ? "TRUE" : "FALSE")}
                                  className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                                />
                                Bill to Owner
                              </label>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <datalist id="bank-statement-expense-accounts">
              {expenseAccounts.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <datalist id="bank-statement-contacts">
              {contacts.map((identifier) => (
                <option key={identifier} value={identifier} />
              ))}
            </datalist>
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
