import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "./auth";
import { db, schema } from "@/db";

/** Sesión + negocio del usuario. TODA consulta de datos debe filtrar por ctx.tenant.id. */
export async function getContext() {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const [row] = await db
    .select({ tenant: schema.tenants, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(eq(schema.memberships.userId, s.user.id))
    .limit(1);
  return { user: s.user, tenant: row?.tenant ?? null, role: row?.role ?? null };
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });
