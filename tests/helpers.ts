import { db, schema } from "@/db";

/** Crea un negocio aislado para cada prueba (alias único). */
export async function makeTenant(name = "Negocio de prueba") {
  const id = crypto.randomUUID();
  const inboundAlias = "t" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(schema.tenants).values({ id, name, inboundAlias });
  return { id, inboundAlias };
}

export async function makeSale(tenantId: string, amount: number, opts: { code?: string; expiresInMs?: number } = {}) {
  const id = crypto.randomUUID();
  const code = opts.code ?? "V-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  await db.insert(schema.sales).values({
    id, tenantId, code, amount: amount.toFixed(2),
    expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 86_400_000)),
  });
  return { id, code };
}

export const hash = () => crypto.randomUUID().replace(/-/g, "");
