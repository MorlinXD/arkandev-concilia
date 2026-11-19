import { json } from "@/lib/context";
import { hasIngestSecret } from "@/lib/secret";
import { processInboundEmail } from "@/lib/inbound";

/**
 * Recibe un correo CRUDO (MIME). Lo usan el Email Worker de Cloudflare (con x-inbound-to = pagos+alias@…)
 * y las pruebas locales. En modo buzón x-inbound-to es opcional: el negocio se identifica por el correo registrado.
 */
export async function POST(req: Request) {
  if (!hasIngestSecret(req)) return json({ error: "unauthorized" }, 401);
  const to = req.headers.get("x-inbound-to");
  const raw = await req.text();
  if (!raw || raw.length > 5_000_000) return json({ error: "invalid body" }, 400);
  const outcome = await processInboundEmail(raw, to);
  return json(outcome);
}
