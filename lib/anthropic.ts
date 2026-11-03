// Extraction OCR des factures fournisseur via l'API Claude (vision) —
// utilisé par l'onglet Factures pour pré-remplir le formulaire depuis un
// PDF/image uploadé, au lieu d'une saisie entièrement manuelle.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-5-5";

export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface ExtractedInvoiceFields {
  supplierName: string | null;
  amountCents: number | null;
  invoiceDate: string | null;
  invoiceNumber: string | null;
}

const EXTRACTION_PROMPT = `Tu analyses une facture fournisseur (PDF ou photo). Réponds UNIQUEMENT avec un objet JSON, sans texte autour, avec exactement ces clés :
{
  "supplierName": string ou null — le nom de l'entreprise qui ÉMET la facture (le fournisseur, pas le destinataire),
  "amountCents": number ou null — le montant TOTAL TTC de la facture, en CENTIMES (ex: 125,50€ → 12550),
  "invoiceDate": string ou null — la date d'émission de la facture au format YYYY-MM-DD,
  "invoiceNumber": string ou null — le numéro/référence de la facture
}
Si une information est illisible ou absente, mets null pour ce champ plutôt que de deviner.`;

/** Appelle Claude avec le fichier (PDF ou image) en pièce jointe et demande
 * une extraction structurée des champs clés de la facture. Lève une erreur
 * si l'API échoue ou si la réponse n'est pas du JSON exploitable — à
 * l'appelant de dégrader proprement (formulaire resté vide/manuel). */
export async function extractInvoiceFields(base64Data: string, mimeType: string): Promise<ExtractedInvoiceFields> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY n'est pas configuré.");

  const isPdf = mimeType === "application/pdf";
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: mimeType, data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: base64Data } };

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [contentBlock, { type: "text", text: EXTRACTION_PROMPT }],
        },
      ],
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(`Anthropic a répondu ${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""}`);
  }

  const json = (await response.json()) as { content: { type: string; text?: string }[] };
  const text = json.content.find((c) => c.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Réponse Claude non reconnue (pas de JSON).");

  const parsed = JSON.parse(match[0]) as Record<string, unknown>;
  return {
    supplierName: typeof parsed.supplierName === "string" ? parsed.supplierName : null,
    amountCents: typeof parsed.amountCents === "number" ? Math.round(parsed.amountCents) : null,
    invoiceDate: typeof parsed.invoiceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoiceDate) ? parsed.invoiceDate : null,
    invoiceNumber: typeof parsed.invoiceNumber === "string" ? parsed.invoiceNumber : null,
  };
}
