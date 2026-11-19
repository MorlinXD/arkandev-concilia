import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";

/** Resolución manual de una venta en revisión: aprobar o descartar. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const { id } = await params;
  const body = z.object({ action: z.enum(["approve", "reject"]) }).safeParse(await req.json());
  if (!body.success) return json({ error: "Acción inválida" }, 400);

  const tenantId = ctx.tenant.id;
  await db.transaction(async (tx) => {
    const [sale] = await tx.select().from(schema.sales)
      .where(and(eq(schema.sales.id, id), eq(schema.sales.tenantId, tenantId))).for("update");
    if (!sale || sale.status !== "review") return;
    const forSale = and(eq(schema.transfers.saleId, sale.id), eq(schema.transfers.tenantId, tenantId));
    if (body.data.action === "approve") {
      await tx.update(schema.sales).set({ status: "approved", approvedAt: new Date() }).where(eq(schema.sales.id, sale.id));
      await tx.update(schema.transfers).set({ status: "matched" }).where(forSale);
    } else {
      await tx.update(schema.sales).set({ status: "pending" }).where(eq(schema.sales.id, sale.id));
      await tx.update(schema.transfers).set({ status: "unmatched", saleId: null }).where(forSale);
    }
  });
  return json({ ok: true });
}
