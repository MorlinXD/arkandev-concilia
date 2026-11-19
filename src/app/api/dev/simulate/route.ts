import { getContext, json } from "@/lib/context";
import { ingestTransfer } from "@/lib/reconcile";

/** SOLO DESARROLLO: simula la llegada de un correo de transferencia. */
export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return json({ error: "not found" }, 404);
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const b = await req.json();
  const result = await ingestTransfer({
    alias: ctx.tenant.inboundAlias,
    bank: b.bank ?? "Banco Pichincha",
    amount: Number(b.amount),
    reference: String(Math.floor(Math.random() * 1e9)),
    sender: b.sender ?? "Cliente de prueba",
    memo: b.memo ?? "",
    rawHash: crypto.randomUUID().replace(/-/g, ""),
  });
  return json(result);
}
