import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/queries";
import { isVrPlatformConfigured, updateVendorExpenseLineAccount } from "@/lib/vrplatform";

export const dynamic = "force-dynamic";

/** Change le compte de dépense d'une ligne précise d'une facture vendor —
 * body { transactionId, lineId, accountId }. Onglet Supplier. */
export async function PATCH(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "Réservé aux administrateurs." }, { status: 403 });

  if (!isVrPlatformConfigured()) {
    return NextResponse.json({ error: "VRPlatform n'est pas configuré sur ce déploiement." }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const transactionId = body?.transactionId;
  const lineId = body?.lineId;
  const accountId = body?.accountId;
  if (typeof transactionId !== "string" || typeof lineId !== "string" || typeof accountId !== "string") {
    return NextResponse.json(
      { error: "Paramètres 'transactionId', 'lineId' et 'accountId' requis." },
      { status: 400 }
    );
  }

  try {
    await updateVendorExpenseLineAccount(transactionId, lineId, accountId);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur VRPlatform inconnue." },
      { status: 502 }
    );
  }
}
