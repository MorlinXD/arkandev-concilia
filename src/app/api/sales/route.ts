import { z } from "zod";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";
import { newSaleCode } from "@/lib/reconcile";

const Body = z.object({
  amount: z.coerce.number().positive().max(1_000_000),
  description: z.string().trim().max(255).optional().nullable(),
  customerName: z.string().trim().max(160).optional().nullable(),
});

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const body = Body.safeParse(await req.json());
  if (!body.success) return json({ error: "Datos inválidos" }, 400);

  const code = await newSaleCode(ctx.tenant.id);
  const amount = body.data.amount.toFixed(2);
  await db.insert(schema.sales).values({
    tenantId: ctx.tenant.id, code, amount,
    description: body.data.description || null, customerName: body.data.customerName || null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), createdBy: ctx.user.id,
  });
  return json({ code, amount });
}
