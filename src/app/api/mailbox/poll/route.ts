import { json } from "@/lib/context";
import { hasIngestSecret } from "@/lib/secret";
import { pollMailboxOnce } from "@/lib/mailbox";

/**
 * Revisión puntual del buzón. Útil como respaldo con un Cron Job de Hostinger
 * (cada 1–5 min) por si la escucha permanente se detiene:
 *   curl -X POST -H "x-ingest-secret: …" https://concilia.arkandevstudio.com/api/mailbox/poll
 */
export async function POST(req: Request) {
  if (!hasIngestSecret(req)) return json({ error: "unauthorized" }, 401);
  return json(await pollMailboxOnce());
}
