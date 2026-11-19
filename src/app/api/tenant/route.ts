import { z } from "zod";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";

/** Alta de negocio: crea el tenant y hace al usuario su dueño. */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return json({ error: "No autenticado" }, 401);
  if (ctx.tenant) return json({ error: "Ya tienes un negocio registrado" }, 400);

  const body = z.object({ name: z.string().trim().min(2).max(160) }).safeParse(await req.json());
  if (!body.success) return json({ error: "Nombre inválido" }, 400);

  const tenantId = crypto.randomUUID();
  const alias = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  await db.transaction(async (tx) => {
    await tx.insert(schema.tenants).values({ id: tenantId, name: body.data.name, inboundAlias: alias });
    await tx.insert(schema.memberships).values({ tenantId, userId: ctx.user.id, role: "owner" });
  });
  return json({ id: tenantId });
}
