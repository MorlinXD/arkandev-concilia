import { z } from "zod";
import { and, desc, eq, isNull, max, count } from "drizzle-orm";
import { db, schema } from "@/db";
import { getContext, json } from "@/lib/context";
import { BANKS, bankById, parseSenderList } from "@/parsers/banks";

/** Registro de bancos disponibles + cuentas del negocio con su actividad. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const tenantId = ctx.tenant.id;

  const [accounts, activity] = await Promise.all([
    db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.tenantId, tenantId)).orderBy(desc(schema.bankAccounts.createdAt)),
    db.select({ bank: schema.transfers.bank, total: count(), last: max(schema.transfers.receivedAt) })
      .from(schema.transfers).where(eq(schema.transfers.tenantId, tenantId)).groupBy(schema.transfers.bank),
  ]);
  const byName = new Map(activity.map((a) => [a.bank, a]));

  return json({
    registry: BANKS.map(({ id, name, domains }) => ({ id, name, domains })),
    accounts: accounts.map((a) => ({
      ...a,
      transfers: byName.get(a.bankName)?.total ?? 0,
      lastTransferAt: byName.get(a.bankName)?.last ?? null,
    })),
  });
}

const AccountBody = z.object({
  bankId: z.string().trim().min(1).max(40),
  bankName: z.string().trim().max(80).optional().nullable(),
  alias: z.string().trim().max(80).optional().nullable(),
  lastDigits: z.string().trim().regex(/^\d{0,4}$/, "Últimos 4 dígitos").optional().nullable(),
  notifyEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo de recepción inválido")]).optional().nullable(),
  senderEmails: z.string().trim().max(500).optional().nullable(),
});

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx?.tenant) return json({ error: "No autorizado" }, 401);
  const parsed = AccountBody.safeParse(await req.json());
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos" }, 400);
  const b = parsed.data;

  const base = b.bankId === "custom" ? null : bankById(b.bankId);
  if (b.bankId !== "custom" && !base) return json({ error: "Banco desconocido" }, 400);
  const senders = parseSenderList(b.senderEmails);
  if (!base && (!b.bankName || senders.length === 0)) {
    return json({ error: "Para otro banco indica su nombre y el correo desde el que envía las notificaciones" }, 400);
  }

  const bankName = base?.name ?? b.bankName!;
  const [dup] = await db.select({ id: schema.bankAccounts.id }).from(schema.bankAccounts).where(and(
    eq(schema.bankAccounts.tenantId, ctx.tenant.id),
    eq(schema.bankAccounts.bankId, b.bankId),
    eq(schema.bankAccounts.bankName, bankName),
    b.lastDigits ? eq(schema.bankAccounts.lastDigits, b.lastDigits) : isNull(schema.bankAccounts.lastDigits),
  )).limit(1);
  if (dup) return json({ error: "Esa cuenta ya está registrada" }, 409);

  const id = crypto.randomUUID();
  await db.insert(schema.bankAccounts).values({
    id, tenantId: ctx.tenant.id, bankId: b.bankId, bankName,
    alias: b.alias || null, lastDigits: b.lastDigits || null, notifyEmail: b.notifyEmail || null, senderEmails: senders.join(", ") || null,
  });
  return json({ id });
}
