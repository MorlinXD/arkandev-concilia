import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";
import { parseSenderList } from "@/parsers/banks";

const Patch = z.object({
  active: z.boolean().optional(),
  alias: z.string().trim().max(80).optional().nullable(),
  lastDigits: z.string().trim().regex(/^\d{0,4}$/).optional().nullable(),
  senderEmails: z.string().trim().max(500).optional().nullable(),
  notifyEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email()]).optional().nullable(),
});

const own = (id: string, tenantId: string) =>
  and(eq(schema.bankAccounts.id, id), eq(schema.bankAccounts.tenantId, tenantId));

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const { id } = await params;
  const p = Patch.safeParse(await req.json());
  if (!p.success) return json({ error: "Datos inválidos" }, 400);

  const set: Partial<typeof schema.bankAccounts.$inferInsert> = {};
  if (p.data.active !== undefined) set.active = p.data.active;
  if (p.data.alias !== undefined) set.alias = p.data.alias || null;
  if (p.data.lastDigits !== undefined) set.lastDigits = p.data.lastDigits || null;
  if (p.data.notifyEmail !== undefined) set.notifyEmail = p.data.notifyEmail || null;
  if (p.data.senderEmails !== undefined) set.senderEmails = parseSenderList(p.data.senderEmails).join(", ") || null;
  if (Object.keys(set).length === 0) return json({ ok: true });

  const [res] = await db.update(schema.bankAccounts).set(set).where(own(id, ctx.tenant.id));
  if (res.affectedRows === 0) return json({ error: "No encontrado" }, 404);
  return json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const { id } = await params;
  const [res] = await db.delete(schema.bankAccounts).where(own(id, ctx.tenant.id));
  if (res.affectedRows === 0) return json({ error: "No encontrado" }, 404);
  return json({ ok: true });
}
