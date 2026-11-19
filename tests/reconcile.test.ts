/**
 * Pruebas del motor de conciliación (src/lib/reconcile.ts) contra MySQL real.
 * Requiere: MySQL corriendo + `npm run db:push`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ingestTransfer, newSaleCode } from "@/lib/reconcile";
import { hash, makeSale, makeTenant } from "./helpers";

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
});
async function tenant() {
  const t = await makeTenant();
  created.push(t.id);
  return t;
}
const saleStatus = async (id: string) =>
  (await db.select().from(schema.sales).where(eq(schema.sales.id, id)))[0].status;

describe("Conciliación: coincidencias", () => {
  it("aprueba cuando coinciden código (en el concepto) y monto", async () => {
    const t = await tenant();
    const s = await makeSale(t.id, 25.5, { code: "V-1111" });
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 25.5, memo: "pago V-1111", rawHash: hash() });
    expect(r).toMatchObject({ result: "approved", saleCode: "V-1111" });
    expect(await saleStatus(s.id)).toBe("approved");
  });

  it("el código no distingue mayúsculas/minúsculas en el concepto", async () => {
    const t = await tenant();
    await makeSale(t.id, 12, { code: "V-2222" });
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 12, memo: "Pago v-2222 gracias", rawHash: hash() });
    expect(r.result).toBe("approved");
  });

  it("acepta el alias del negocio en mayúsculas", async () => {
    const t = await tenant();
    await makeSale(t.id, 7, { code: "V-2323" });
    const r = await ingestTransfer({ alias: t.inboundAlias.toUpperCase(), bank: "X", amount: 7, memo: "V-2323", rawHash: hash() });
    expect(r.result).toBe("approved");
  });

  it("manda a revisión si hay UNA venta con el monto pero sin código", async () => {
    const t = await tenant();
    const s = await makeSale(t.id, 10);
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 10, memo: "sin codigo", rawHash: hash() });
    expect(r.result).toBe("review");
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("deja huérfana si hay VARIAS ventas con el mismo monto y sin código (ambigua)", async () => {
    const t = await tenant();
    const a = await makeSale(t.id, 15);
    const b = await makeSale(t.id, 15);
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 15, memo: "", rawHash: hash() });
    expect(r.result).toBe("unmatched");
    expect(await saleStatus(a.id)).toBe("pending");
    expect(await saleStatus(b.id)).toBe("pending");
  });

  it("con varias ventas del mismo monto, el código elige la correcta", async () => {
    const t = await tenant();
    const a = await makeSale(t.id, 15, { code: "V-3001" });
    const b = await makeSale(t.id, 15, { code: "V-3002" });
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 15, memo: "V-3002", rawHash: hash() });
    expect(r).toMatchObject({ result: "approved", saleCode: "V-3002" });
    expect(await saleStatus(a.id)).toBe("pending");
    expect(await saleStatus(b.id)).toBe("approved");
  });

  it("deja huérfana una transferencia sin ninguna venta", async () => {
    const t = await tenant();
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 99, rawHash: hash() });
    expect(r.result).toBe("unmatched");
  });
});

describe("Conciliación: casos que NO deben aprobar", () => {
  it("código correcto pero monto distinto → no aprueba", async () => {
    const t = await tenant();
    const s = await makeSale(t.id, 50, { code: "V-4001" });
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 49.99, memo: "V-4001", rawHash: hash() });
    expect(r.result).toBe("unmatched");
    expect(await saleStatus(s.id)).toBe("pending");
  });

  it("venta expirada → no aprueba", async () => {
    const t = await tenant();
    const s = await makeSale(t.id, 20, { code: "V-4002", expiresInMs: -60_000 });
    const r = await ingestTransfer({ alias: t.inboundAlias, bank: "Pichincha", amount: 20, memo: "V-4002", rawHash: hash() });
    expect(r.result).toBe("unmatched");
    expect(await saleStatus(s.id)).toBe("pending");
  });

  it("venta ya aprobada no se aprueba dos veces", async () => {
    const t = await tenant();
    await makeSale(t.id, 30, { code: "V-4003" });
    const first = await ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 30, memo: "V-4003", rawHash: hash() });
    const second = await ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 30, memo: "V-4003", rawHash: hash() });
    expect(first.result).toBe("approved");
    expect(second.result).toBe("unmatched");
  });

  it("no cruza ventas de OTRO negocio (aislamiento)", async () => {
    const a = await tenant();
    const b = await tenant();
    const s = await makeSale(a.id, 40, { code: "V-4004" });
    const r = await ingestTransfer({ alias: b.inboundAlias, bank: "P", amount: 40, memo: "V-4004", rawHash: hash() });
    expect(r.result).toBe("unmatched");
    expect(await saleStatus(s.id)).toBe("pending");
  });

  it("alias desconocido → unknown_tenant y no guarda nada", async () => {
    const r = await ingestTransfer({ alias: "no-existe-xyz", bank: "P", amount: 1, rawHash: hash() });
    expect(r.result).toBe("unknown_tenant");
  });
});

describe("Deduplicación y concurrencia", () => {
  it("el mismo correo (rawHash) dos veces → la segunda es duplicate", async () => {
    const t = await tenant();
    const h = hash();
    const a = await ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 5, rawHash: h });
    const b = await ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 5, rawHash: h });
    expect(a.result).toBe("unmatched");
    expect(b.result).toBe("duplicate");
    const rows = await db.select().from(schema.transfers).where(eq(schema.transfers.tenantId, t.id));
    expect(rows).toHaveLength(1);
  });

  it("dos transferencias simultáneas para la misma venta → solo una la aprueba", async () => {
    const t = await tenant();
    await makeSale(t.id, 60, { code: "V-5001" });
    const results = await Promise.all([
      ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 60, memo: "V-5001", rawHash: hash() }),
      ingestTransfer({ alias: t.inboundAlias, bank: "P", amount: 60, memo: "V-5001", rawHash: hash() }),
    ]);
    expect(results.filter((r) => r.result === "approved")).toHaveLength(1);
  });
});

describe("Códigos de venta", () => {
  it("genera formato V-0000", async () => {
    const t = await tenant();
    expect(await newSaleCode(t.id)).toMatch(/^V-\d{4}$/);
  });

  it("no repite un código existente en el mismo negocio", async () => {
    const t = await tenant();
    const codes = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const c = await newSaleCode(t.id);
      expect(codes.has(c)).toBe(false);
      codes.add(c);
      await makeSale(t.id, 1, { code: c });
    }
  });
});
