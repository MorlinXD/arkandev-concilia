import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";

/** Lo que el panel consulta cada pocos segundos. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const tenantId = ctx.tenant.id;

  const [sales, transfers, emails, mailboxes] = await Promise.all([
    db.select().from(schema.sales).where(eq(schema.sales.tenantId, tenantId)).orderBy(desc(schema.sales.createdAt)).limit(50),
    db.select().from(schema.transfers).where(eq(schema.transfers.tenantId, tenantId)).orderBy(desc(schema.transfers.receivedAt)).limit(50),
    db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.tenantId, tenantId)).orderBy(desc(schema.inboundEmails.createdAt)).limit(15),
    db.select({ email: schema.bankAccounts.notifyEmail }).from(schema.bankAccounts).where(and(
      eq(schema.bankAccounts.tenantId, tenantId), eq(schema.bankAccounts.active, true), isNotNull(schema.bankAccounts.notifyEmail),
    )),
  ]);
  return json({ sales, transfers, emails, forwardingConfirmation: ctx.tenant.forwardingConfirmation, alias: ctx.tenant.inboundAlias, mailboxes: [...new Set(mailboxes.map((m) => m.email))] });
}
