"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { formatEuros } from "@/lib/format";

interface PropertyOption {
  id: string;
  reference: string;
}

interface Invoice {
  id: string;
  supplierName: string;
  amountCents: number;
  invoiceDate: string | null;
  invoiceNumber: string | null;
  propertyId: string | null;
  propertyReference: string | null;
  fileName: string;
  filePath: string;
  paid: boolean;
  notes: string | null;
  createdAt: string;
}

interface MatchLine {
  id: string;
  date: string;
  description: string | null;
  type: string;
  amountCents: number;
}

interface MatchBankRecord {
  id: string;
  description: string | null;
  date: string;
  amountCents: number;
  reconciliationStatus: string;
  lines: MatchLine[];
}

interface MatchResponse {
  matches: MatchBankRecord[];
}

function Money({ cents }: { cents: number }) {
  return <span>{formatEuros(cents / 100)}</span>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function BankRecordCard({ record }: { record: MatchBankRecord }) {
  return (
    <div className="rounded-[8px] border border-black/10 bg-white p-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="font-semibold text-[#1d1d1f]">{record.description ?? "Paiement bancaire"}</span>
        <span className="text-[#6e6e73]">{formatDate(record.date)}</span>
        <span className="font-medium text-[#1d1d1f]">
          <Money cents={Math.abs(record.amountCents)} />
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            record.reconciliationStatus === "paired" || record.reconciliationStatus === "matched"
              ? "bg-emerald-50 text-emerald-600"
              : "bg-amber-50 text-amber-600"
          }`}
        >
          {record.reconciliationStatus}
        </span>
      </div>
      {record.lines.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-4">
          {record.lines.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-[11px] text-[#6e6e73]">
              <span>{formatDate(l.date)}</span>
              <span>{l.type}</span>
              <span className="font-medium text-[#1d1d1f]">
                <Money cents={Math.abs(l.amountCents)} />
              </span>
              {l.description && <span>— {l.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SupplierInvoicesTable({ properties }: { properties: PropertyOption[] }) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [editingAmountId, setEditingAmountId] = useState<string | null>(null);
  const [editingAmountValue, setEditingAmountValue] = useState("");
  const [savingAmount, setSavingAmount] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [amount, setAmount] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [hideShowPaid, setHideShowPaid] = useState(false);
  const [search, setSearch] = useState("");

  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResponse | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/invoices");
      const data = await res.json();
      if (data.error) setError(data.error);
      else setInvoices(data.invoices);
    } catch {
      setError("Impossible de charger les factures.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function onFileChange(f: File | null) {
    setFile(f);
    setOcrError(null);
  }

  async function runOcr() {
    if (!file) return;
    setOcrLoading(true);
    setOcrError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/finance/invoices/ocr", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        setOcrError(data.error);
        return;
      }
      if (data.supplierName) setSupplierName(data.supplierName);
      if (data.amountCents != null) setAmount((data.amountCents / 100).toFixed(2));
      if (data.invoiceDate) setInvoiceDate(data.invoiceDate);
      if (data.invoiceNumber) setInvoiceNumber(data.invoiceNumber);
    } catch {
      setOcrError("Impossible d'analyser le fichier.");
    } finally {
      setOcrLoading(false);
    }
  }

  function resetForm() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSupplierName("");
    setAmount("");
    setInvoiceDate("");
    setInvoiceNumber("");
    setPropertyId("");
    setNotes("");
  }

  async function save() {
    const amountValue = Number.parseFloat(amount.replace(",", "."));
    if (!file || !supplierName.trim() || !Number.isFinite(amountValue) || amountValue < 0) {
      setSaveError("Fichier, fournisseur et montant valide requis.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("supplierName", supplierName.trim());
      form.append("amountCents", String(Math.round(amountValue * 100)));
      if (invoiceDate) form.append("invoiceDate", invoiceDate);
      if (invoiceNumber) form.append("invoiceNumber", invoiceNumber);
      if (propertyId) form.append("propertyId", propertyId);
      if (notes) form.append("notes", notes);
      const res = await fetch("/api/finance/invoices", { method: "POST", body: form });
      const data = await res.json();
      if (data.error) {
        setSaveError(data.error);
        return;
      }
      resetForm();
      await load();
    } catch {
      setSaveError("Impossible d'enregistrer la facture.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePaid(id: string, paid: boolean) {
    setTogglingId(id);
    const previous = invoices;
    setInvoices((prev) => (prev ? prev.map((inv) => (inv.id === id ? { ...inv, paid } : inv)) : prev));
    try {
      const res = await fetch(`/api/finance/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setInvoices(previous);
      }
    } catch {
      setError("Impossible de mettre à jour le statut.");
      setInvoices(previous);
    } finally {
      setTogglingId(null);
    }
  }

  function startEditAmount(inv: Invoice) {
    setEditingAmountId(inv.id);
    setEditingAmountValue((inv.amountCents / 100).toFixed(2).replace(".", ","));
  }

  async function saveEditedAmount(id: string) {
    const amountValue = Number.parseFloat(editingAmountValue.replace(",", "."));
    if (!Number.isFinite(amountValue) || amountValue < 0) {
      setEditingAmountId(null);
      return;
    }
    const amountCents = Math.round(amountValue * 100);
    const previous = invoices;
    setEditingAmountId(null);
    setSavingAmount(true);
    setInvoices((prev) => (prev ? prev.map((inv) => (inv.id === id ? { ...inv, amountCents } : inv)) : prev));
    try {
      const res = await fetch(`/api/finance/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setInvoices(previous);
      }
    } catch {
      setError("Impossible de mettre à jour le montant.");
      setInvoices(previous);
    } finally {
      setSavingAmount(false);
    }
  }

  async function deleteInvoice(id: string) {
    const previous = invoices;
    setInvoices((prev) => (prev ? prev.filter((inv) => inv.id !== id) : prev));
    try {
      const res = await fetch(`/api/finance/invoices/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setInvoices(previous);
      }
    } catch {
      setError("Impossible de supprimer cette facture.");
      setInvoices(previous);
    }
  }

  async function openFile(filePath: string) {
    try {
      const params = new URLSearchParams({ path: filePath });
      const res = await fetch(`/api/finance/invoices/file?${params.toString()}`);
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank", "noopener,noreferrer");
      else setError(data.error ?? "Impossible d'ouvrir le fichier.");
    } catch {
      setError("Impossible d'ouvrir le fichier.");
    }
  }

  async function toggleMatch(id: string) {
    if (expandedMatchId === id) {
      setExpandedMatchId(null);
      return;
    }
    setExpandedMatchId(id);
    setMatchResult(null);
    setMatchError(null);
    setMatchLoading(true);
    try {
      const res = await fetch(`/api/finance/invoices/${id}/match`);
      const data = await res.json();
      if (data.error) setMatchError(data.error);
      else setMatchResult(data);
    } catch {
      setMatchError("Impossible de chercher les écritures VRPlatform.");
    } finally {
      setMatchLoading(false);
    }
  }

  const visibleInvoices = invoices
    ?.filter((inv) => !hideShowPaid || !inv.paid)
    .filter((inv) => {
      const needle = search.trim().toLowerCase();
      if (needle === "") return true;
      return [inv.supplierName, inv.invoiceNumber, inv.propertyReference].some((v) => v?.toLowerCase().includes(needle));
    });

  const totalDueCents = visibleInvoices?.filter((inv) => !inv.paid).reduce((sum, inv) => sum + inv.amountCents, 0) ?? 0;

  return (
    <div className="space-y-5">
      <div className="rounded-[12px] border border-black/10 bg-white p-4 space-y-3">
        <span className="field-label">Nouvelle facture</span>

        <div>
          <span className="text-[12px] text-[#6e6e73]">Fichier (PDF, photo)</span>
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
              if (dropped) onFileChange(dropped);
            }}
            className={`mt-0.5 flex cursor-pointer items-center justify-center rounded-[10px] border-2 border-dashed px-4 py-5 text-center text-[13px] transition ${
              isDraggingOver ? "border-[#0071e3] bg-[#0071e3]/5 text-[#0071e3]" : "border-black/15 text-[#6e6e73] hover:border-black/25"
            }`}
          >
            {file ? (
              <span className="text-[#1d1d1f]">📄 {file.name}</span>
            ) : (
              <span>Glisse une facture ici, ou clique pour en choisir une</span>
            )}
          </div>
          <input
            id="invoice-file"
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </div>

        {file && (
          <button
            type="button"
            onClick={runOcr}
            disabled={ocrLoading}
            className="btn-secondary btn-sm"
            title="Lit le fichier et pré-remplit le formulaire ci-dessous"
          >
            {ocrLoading ? "Analyse…" : "🔍 Analyser (OCR)"}
          </button>
        )}
        {ocrError && <p className="text-[12px] text-red-600">{ocrError}</p>}

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-supplier">
              Fournisseur
            </label>
            <input
              id="invoice-supplier"
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="mt-0.5 block w-48 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-amount">
              Montant (€)
            </label>
            <input
              id="invoice-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="mt-0.5 block w-28 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-date">
              Date
            </label>
            <input
              id="invoice-date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="mt-0.5 block rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-number">
              N° facture
            </label>
            <input
              id="invoice-number"
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="mt-0.5 block w-32 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-property">
              Bien (optionnel)
            </label>
            <select
              id="invoice-property"
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="mt-0.5 block rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            >
              <option value="">—</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.reference}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12px] text-[#6e6e73]" htmlFor="invoice-notes">
              Notes
            </label>
            <input
              id="invoice-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-0.5 block w-40 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
            />
          </div>
          <button type="button" onClick={save} disabled={saving} className="btn-secondary btn-sm">
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
        {saveError && <p className="text-[12px] text-red-600">{saveError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[13px] text-[#1d1d1f]">
          <input
            type="checkbox"
            checked={hideShowPaid}
            onChange={(e) => setHideShowPaid(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
          />
          Masquer les factures payées
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Recherche (fournisseur, n° facture, bien)…"
          className="w-64 rounded-[8px] border border-black/10 bg-white px-2.5 py-1.5 text-[13px] text-[#1d1d1f] focus:border-[#0071e3] focus:outline-none focus:ring-[3px] focus:ring-[#0071e3]/15"
        />
        <button type="button" onClick={load} disabled={loading} className="btn-secondary btn-sm">
          {loading ? "Chargement…" : "Actualiser"}
        </button>
      </div>

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {visibleInvoices && visibleInvoices.length === 0 && !loading && (
        <p className="text-[13px] text-[#6e6e73]">Aucune facture.</p>
      )}

      {visibleInvoices && visibleInvoices.length > 0 && (
        <div className="space-y-2">
          <span className="rounded-full bg-red-50 px-3 py-1.5 text-[13px] font-semibold text-red-600">
            {formatEuros(totalDueCents / 100)} dû (factures non payées)
          </span>
          <div className="overflow-hidden rounded-[14px] border border-black/[0.06]">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-black/[0.08] bg-black/[0.015]">
                    <th className="py-1.5 pl-3 pr-2 text-left text-[11px] font-medium text-[#86868b]">Fournisseur</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">Bien</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Date</th>
                    <th className="py-1.5 px-2 text-left text-[11px] font-medium text-[#86868b]">N° facture</th>
                    <th className="py-1.5 px-2 text-right text-[11px] font-medium text-[#86868b]">Montant</th>
                    <th className="py-1.5 px-2 text-center text-[11px] font-medium text-[#86868b]">Fichier</th>
                    <th className="py-1.5 pl-2 pr-3 text-right text-[11px] font-medium text-[#86868b]">Payée</th>
                    <th className="py-1.5 px-2 text-center text-[11px] font-medium text-[#86868b]">VRPlatform</th>
                    <th className="py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInvoices.map((inv, rowIndex) => (
                    <Fragment key={inv.id}>
                    <tr
                      className={`border-b border-black/[0.04] transition-colors last:border-b-0 hover:bg-[#dceafb] ${
                        rowIndex % 2 === 0 ? "bg-white" : "bg-[#f0f6fd]"
                      }`}
                    >
                      <td className="py-1.5 pl-3 pr-2 font-medium text-[#1d1d1f]">{inv.supplierName}</td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{inv.propertyReference ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[#1d1d1f]">{formatDate(inv.invoiceDate)}</td>
                      <td className="py-1.5 px-2 text-[#6e6e73]">{inv.invoiceNumber ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums font-semibold text-[#1d1d1f]">
                        {editingAmountId === inv.id ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            value={editingAmountValue}
                            onChange={(e) => setEditingAmountValue(e.target.value)}
                            onBlur={() => saveEditedAmount(inv.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditedAmount(inv.id);
                              else if (e.key === "Escape") setEditingAmountId(null);
                            }}
                            disabled={savingAmount}
                            className="w-24 rounded-[6px] border border-[#0071e3]/40 px-1.5 py-0.5 text-right text-[12px] focus:outline-none focus:ring-[2px] focus:ring-[#0071e3]/20"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEditAmount(inv)}
                            title="Modifier le montant"
                            className="hover:text-[#0071e3]"
                          >
                            <Money cents={inv.amountCents} />
                          </button>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => openFile(inv.filePath)}
                          className="text-[#0071e3] hover:underline"
                          title={inv.fileName}
                        >
                          📄
                        </button>
                      </td>
                      <td className="py-1.5 pl-2 pr-3 text-right">
                        <input
                          type="checkbox"
                          checked={inv.paid}
                          disabled={togglingId === inv.id}
                          onChange={(e) => togglePaid(inv.id, e.target.checked)}
                          className="h-4 w-4 rounded border-black/20 text-[#0071e3] focus:ring-[#0071e3]/40"
                        />
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleMatch(inv.id)}
                          title="Chercher les écritures correspondantes dans VRPlatform"
                          className={`text-[13px] ${expandedMatchId === inv.id ? "text-[#0071e3]" : "text-[#86868b] hover:text-[#0071e3]"}`}
                        >
                          🔗
                        </button>
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => deleteInvoice(inv.id)}
                          title="Supprimer cette facture"
                          className="text-[#c7c7cc] transition hover:text-red-600"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    {expandedMatchId === inv.id && (
                      <tr className="border-b border-black/[0.04] bg-[#f5f5f7]">
                        <td colSpan={9} className="px-3 py-2.5">
                          <div className="mb-1.5 flex items-center justify-end">
                            <button
                              type="button"
                              onClick={() => setExpandedMatchId(null)}
                              title="Fermer"
                              className="text-[12px] text-[#86868b] hover:text-[#1d1d1f]"
                            >
                              ✕ Fermer
                            </button>
                          </div>
                          {matchLoading && <p className="text-[12px] text-[#6e6e73]">Recherche dans VRPlatform…</p>}
                          {matchError && <p className="text-[12px] text-red-600">{matchError}</p>}
                          {matchResult && !matchLoading && matchResult.matches.length === 0 && (
                            <p className="text-[12px] text-[#6e6e73]">
                              Aucune transaction VRPlatform de <Money cents={inv.amountCents} /> trouvée.
                            </p>
                          )}
                          {matchResult && !matchLoading && matchResult.matches.length > 0 && (
                            <div className="space-y-3">
                              {matchResult.matches.map((record) => (
                                <BankRecordCard key={record.id} record={record} />
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
