import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type IncomingTransfer = {
  alias: string;
  bank: string;
  amount: number;
  reference?: string | null;
  sender?: string | null;
  memo?: string | null;
  receivedAt?: Date;
  rawHash: string;
  /** false = el correo no pudo verificarse del todo: nunca se aprueba solo, como máximo queda en revisión. */
  trusted?: boolean;
};

export type ReconcileResult =
  | { result: "approved" | "review"; saleCode: string; transferId: string }
  | { result: "unmatched"; transferId: string }
  | { result: "duplicate" | "unknown_tenant" };

const isDuplicate = (e: unknown) =>
  typeof e === "object" && e !== null &&
  ((e as { code?: string }).code === "ER_DUP_ENTRY" || (e as { cause?: { code?: string } }).cause?.code === "ER_DUP_ENTRY");

/** Guarda la transferencia y la cruza con las ventas pendientes, en una transacción. */
export async function ingestTransfer(t: IncomingTransfer): Promise<ReconcileResult> {
  const [tenant] = await db.select({ id: schema.tenants.id }).from(schema.tenants)
    .where(eq(schema.tenants.inboundAlias, t.alias.toLowerCase())).limit(1);
  if (!tenant) return { result: "unknown_tenant" };

  const amount = t.amount.toFixed(2);
  // Códigos presentes en el concepto, tolerando formatos: V-1234, V1234, v 1234
  const memoCodes = new Set(
    [...(t.memo ?? "").matchAll(/(?<![A-Z0-9])V[\s\-_.]?(\d{4})(?!\d)/gi)].map((m) => `V-${m[1]}`),
  );
  const trusted = t.trusted ?? true;
  const transferId = crypto.randomUUID();

  try {
    return await db.transaction(async (tx) => {
      await tx.insert(schema.transfers).values({
        id: transferId, tenantId: tenant.id, bank: t.bank, amount,
        reference: t.reference ?? null, senderName: t.sender ?? null, memo: t.memo ?? null,
        receivedAt: t.receivedAt ?? new Date(), rawHash: t.rawHash,
      });

      // Ventas pendientes y vigentes con el mismo monto (bloqueadas para evitar dobles aprobaciones)
      const candidates = await tx.select().from(schema.sales).where(and(
        eq(schema.sales.tenantId, tenant.id),
        eq(schema.sales.status, "pending"),
        eq(schema.sales.amount, amount),
        gt(schema.sales.expiresAt, new Date()),
      )).orderBy(schema.sales.createdAt).for("update");

      // 1) Coincidencia exacta: código en el concepto + mismo monto
      const exact = candidates.find((s) => memoCodes.has(s.code));
      if (exact && !trusted) {
        await tx.update(schema.sales).set({ status: "review" }).where(eq(schema.sales.id, exact.id));
        await tx.update(schema.transfers).set({ status: "review", saleId: exact.id }).where(eq(schema.transfers.id, transferId));
        return { result: "review", saleCode: exact.code, transferId } as const;
      }
      if (exact) {
        await tx.update(schema.sales).set({ status: "approved", approvedAt: new Date() }).where(eq(schema.sales.id, exact.id));
        await tx.update(schema.transfers).set({ status: "matched", saleId: exact.id }).where(eq(schema.transfers.id, transferId));
        return { result: "approved", saleCode: exact.code, transferId } as const;
      }

      // 2) Coincidencia parcial: una sola venta pendiente con ese monto → revisión manual
      if (candidates.length === 1) {
        const s = candidates[0];
        await tx.update(schema.sales).set({ status: "review" }).where(eq(schema.sales.id, s.id));
        await tx.update(schema.transfers).set({ status: "review", saleId: s.id }).where(eq(schema.transfers.id, transferId));
        return { result: "review", saleCode: s.code, transferId } as const;
      }

      // 3) Sin coincidencia → transferencia huérfana
      return { result: "unmatched", transferId } as const;
    });
  } catch (e) {
    if (isDuplicate(e)) return { result: "duplicate" };
    throw e;
  }
}

/** Código corto V-1234, único por negocio. */
export async function newSaleCode(tenantId: string) {
  for (let i = 0; i < 20; i++) {
    const code = "V-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const [hit] = await db.select({ id: schema.sales.id }).from(schema.sales)
      .where(and(eq(schema.sales.tenantId, tenantId), eq(schema.sales.code, code))).limit(1);
    if (!hit) return code;
  }
  return "V-" + Date.now().toString().slice(-6);
}

export { sql };
