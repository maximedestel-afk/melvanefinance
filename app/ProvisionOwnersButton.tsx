"use client";

import { useState } from "react";

export function ProvisionOwnersButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function provision() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/provision-owners", { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
      } else {
        const errorNote = data.errors.length > 0 ? ` (${data.errors.length} erreur(s))` : "";
        setMessage(`${data.created} compte(s) créé(s), ${data.skipped} déjà existant(s)${errorNote}.`);
      }
    } catch {
      setMessage("Impossible de provisionner les comptes propriétaires.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={provision} disabled={loading} className="btn-secondary btn-sm">
        {loading ? "Provisionnement…" : "Créer les comptes propriétaires"}
      </button>
      {message && <span className="text-[12px] text-[#6e6e73]">{message}</span>}
    </div>
  );
}
