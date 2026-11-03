import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { extractInvoiceFields, isAnthropicConfigured } from "@/lib/anthropic";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

/** Extrait fournisseur/montant/date/n° facture depuis un fichier uploadé
 * (PDF ou image), sans rien enregistrer — juste pour pré-remplir le
 * formulaire de l'onglet Factures. */
export async function POST(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: "La reconnaissance optique n'est pas configurée (ANTHROPIC_API_KEY manquant)." }, { status: 500 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Fichier requis." }, { status: 400 });
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Format non supporté (PDF, PNG, JPEG ou WEBP attendu)." }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");
    const fields = await extractInvoiceFields(base64Data, file.type);
    return NextResponse.json(fields);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur de reconnaissance optique inconnue." },
      { status: 502 }
    );
  }
}
