import { z } from "zod";
import { hasIngestSecret } from "@/lib/secret";
import { json } from "@/lib/context";
import { ingestTransfer } from "@/lib/reconcile";

/**
 * Entrada de transferencias. La llama el Email Worker de Cloudflare
 * con la cabecera `x-ingest-secret`. Nunca la llama el navegador.
 */
const Body = z.object({
  alias: z.string().min(1),
  bank: z.string().min(1),
  amount: z.coerce.number().positive(),
  reference: z.string().optional().nullable(),
  sender: z.string().optional().nullable(),
  memo: z.string().optional().nullable(),
  receivedAt: z.coerce.date().optional(),
  rawHash: z.string().min(8).max(64),
});

export async function POST(req: Request) {
  if (!hasIngestSecret(req)) return json({ error: "unauthorized" }, 401);
  const body = Body.safeParse(await req.json());
  if (!body.success) return json({ error: "invalid", issues: body.error.issues }, 400);
  return json(await ingestTransfer(body.data));
}
