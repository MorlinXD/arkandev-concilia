/**
 * Correo crudo → lector → conciliación → base de datos (sin servidor web). Requiere MySQL.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { processInboundEmail } from "@/lib/inbound";
import { makeSale, makeTenant } from "./helpers";
import { fixture } from "./dkim-helper";

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await db.delete(schema.tenants).where(eq(schema.tenants.id, id));
});

/** Lee un .eml, le pone un Message-ID único (para no chocar con otras pruebas) y lo firma con DKIM si corresponde. */
const raw = (name: string, edit: (r: string) => string = (r) => r) =>
  fixture(name, (r) => edit(r).replace(/^Message-ID:.*$/im, `Message-ID: <${crypto.randomUUID()}@t>`));

async function setup(amount: number, code: string) {
  const t = await makeTenant();
  created.push(t.id);
  const s = await makeSale(t.id, amount, { code });
  return { t, s, to: `${t.inboundAlias}@in.test.com` };
}
const saleStatus = async (id: string) => (await db.select().from(schema.sales).where(eq(schema.sales.id, id)))[0].status;
const logFor = async (tenantId: string) => db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.tenantId, tenantId));

describe("Correo bancario → venta", () => {
  it.each([
    ["pichincha", 25.5, "V-1001"],
    ["guayaquil", 1250, "V-1002"],
    ["produbanco", 40, "V-1003"],
    ["deuna", 12.75, "V-1004"],
  ])("%s confiable + código + monto → APROBADA", async (fixture, amount, code) => {
    const { s, to } = await setup(amount, code);
    const r = await processInboundEmail(await raw(fixture), to);
    expect(r).toMatchObject({ status: "processed", result: { result: "approved", saleCode: code } });
    expect(await saleStatus(s.id)).toBe("approved");
  });

  it("sin DKIM: aunque coincidan código y monto → solo POR REVISAR", async () => {
    const { s, to } = await setup(18, "V-1005");
    const r = await processInboundEmail(await raw("pacifico-sin-dkim"), to);
    expect(r).toMatchObject({ status: "processed", result: { result: "review" } });
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("correo falsificado → nunca se aprueba solo", async () => {
    const { s, to } = await setup(500, "V-1006");
    await processInboundEmail(await raw("falso-pichincha"), to);
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("reenvío manual (Fwd:) → detecta el banco pero queda POR REVISAR", async () => {
    const { s, to } = await setup(9.99, "V-1007");
    const r = await processInboundEmail(await raw("reenvio-manual"), to);
    expect(r).toMatchObject({ status: "processed", result: { result: "review" } });
    if (r.status === "processed" && r.parse.ok) expect(r.parse.bankId).toBe("pichincha");
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("el mismo correo llega dos veces → la segunda es duplicada", async () => {
    const { to } = await setup(25.5, "V-1001");
    const email = await raw("pichincha");
    await processInboundEmail(email, to);
    const r = await processInboundEmail(email, to);
    expect(r).toMatchObject({ status: "processed", result: { result: "duplicate" } });
  });
});

describe("Correos que se ignoran (y quedan en la bitácora)", () => {
  it("débito → ignorado, no crea transferencia", async () => {
    const { t, to } = await setup(30, "V-2001");
    expect(await processInboundEmail(await raw("debito"), to)).toMatchObject({ status: "ignored", detail: "outgoing" });
    expect(await db.select().from(schema.transfers).where(eq(schema.transfers.tenantId, t.id))).toHaveLength(0);
    expect((await logFor(t.id))[0].status).toBe("ignored");
  });

  it("publicidad → ignorada", async () => {
    const { to } = await setup(1, "V-2002");
    expect(await processInboundEmail(await raw("publicidad"), to)).toMatchObject({ status: "ignored", detail: "no_amount" });
  });

  it("alias desconocido → ignorado", async () => {
    expect(await processInboundEmail(await raw("pichincha"), "noexiste@in.test.com")).toMatchObject({ status: "ignored" });
  });

  it("confirmación de Gmail → se guarda en el negocio para mostrarla en el panel", async () => {
    const { t, to } = await setup(1, "V-2003");
    const r = await processInboundEmail(await raw("gmail-confirmacion"), to);
    expect(r.status).toBe("forwarding_confirmation");
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t.id));
    expect(row.forwardingConfirmation).toContain("mail-settings.google.com");
  });
});

describe("Multibanco en el flujo completo", () => {
  async function addAccount(tenantId: string, bankId: string, bankName: string, senderEmails: string | null) {
    await db.insert(schema.bankAccounts).values({ id: crypto.randomUUID(), tenantId, bankId, bankName, senderEmails });
  }

  it("cooperativa fuera del registro, configurada por el negocio → APROBADA", async () => {
    const { t, s, to } = await setup(75, "V-3010");
    await addAccount(t.id, "custom", "Cooperativa Mushuc Runa", "avisos@mushucruna.fin.ec");
    const r = await processInboundEmail(await raw("cooperativa"), to);
    expect(r).toMatchObject({ status: "processed", result: { result: "approved" } });
    if (r.status === "processed" && r.parse.ok) expect(r.parse.bank).toBe("Cooperativa Mushuc Runa");
    expect(await saleStatus(s.id)).toBe("approved");
  });

  it("la misma cooperativa SIN configurar → solo por revisar (remitente desconocido)", async () => {
    const { s, to } = await setup(75, "V-3010");
    await processInboundEmail(await raw("cooperativa"), to);
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("negocio con solo Pichincha registrado recibe un correo de Guayaquil → por revisar", async () => {
    const { t, s, to } = await setup(1250, "V-1002");
    await addAccount(t.id, "pichincha", "Banco Pichincha", null);
    await processInboundEmail(await raw("guayaquil"), to);
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("negocio con Guayaquil registrado → aprobada", async () => {
    const { t, s, to } = await setup(1250, "V-1002");
    await addAccount(t.id, "guayaquil", "Banco Guayaquil", null);
    await processInboundEmail(await raw("guayaquil"), to);
    expect(await saleStatus(s.id)).toBe("approved");
  });
});

describe("Correo de recepción por cuenta (flujo completo)", () => {
  async function account(tenantId: string, notifyEmail: string) {
    await db.insert(schema.bankAccounts).values({
      id: crypto.randomUUID(), tenantId, bankId: "pichincha", bankName: "Banco Pichincha", notifyEmail,
    });
  }

  it("el aviso pasó por el correo registrado (To: negocio@gmail.com) → APROBADA", async () => {
    const { t, s, to } = await setup(25.5, "V-1001");
    await account(t.id, "negocio@gmail.com");
    await processInboundEmail(await raw("pichincha"), to);
    expect(await saleStatus(s.id)).toBe("approved");
  });

  it("el negocio registró otro correo → POR REVISAR", async () => {
    const { t, s, to } = await setup(25.5, "V-1001");
    await account(t.id, "ventas@otronegocio.com");
    await processInboundEmail(await raw("pichincha"), to);
    expect(await saleStatus(s.id)).toBe("review");
  });

  it("una cabecera X-Forwarded-For NO basta: el banco debe haber dirigido el aviso a ese correo", async () => {
    const { t, s, to } = await setup(25.5, "V-1001");
    await account(t.id, "caja@minegocio.com");
    const eml = await raw("pichincha", (r) => r.replace("To: negocio@gmail.com", "To: otra@persona.com"));
    await processInboundEmail("X-Forwarded-For: caja@minegocio.com pagos@x.com\r\n" + eml, to);
    expect(await saleStatus(s.id)).toBe("review");
  });
});

describe("Formato de producción pagos+alias@", () => {
  it("un correo a pagos+<alias>@in.dominio.com llega al negocio correcto", async () => {
    const t = await makeTenant();
    created.push(t.id);
    const s = await makeSale(t.id, 25.5, { code: "V-1001" });
    const r = await processInboundEmail(await raw("pichincha"), `pagos+${t.inboundAlias}@in.arkandevstudio.com`);
    expect(r).toMatchObject({ status: "processed", result: { result: "approved" } });
    expect(await saleStatus(s.id)).toBe("approved");
  });
});

describe("Modo buzón (pagos@…): el negocio se identifica por el correo registrado", () => {
  async function tenantWith(notifyEmail: string, amount: number, code: string) {
    const t = await makeTenant();
    created.push(t.id);
    await db.insert(schema.bankAccounts).values({
      id: crypto.randomUUID(), tenantId: t.id, bankId: "pichincha", bankName: "Banco Pichincha", notifyEmail,
    });
    const s = await makeSale(t.id, amount, { code });
    return { t, s };
  }
  const forwardedBy = (eml: string, mailbox: string) =>
    `X-Forwarded-For: ${mailbox} pagos@arkandevstudio.com\r\nDelivered-To: pagos@arkandevstudio.com\r\n` + eml;

  it("aviso firmado dirigido al correo registrado → negocio correcto y APROBADA", async () => {
    const mailbox = `n${crypto.randomUUID().slice(0, 8)}@gmail.com`;
    const { s } = await tenantWith(mailbox, 25.5, "V-1001");
    const eml = await raw("pichincha", (r) => r.replace("To: negocio@gmail.com", `To: ${mailbox}`));
    const r = await processInboundEmail(forwardedBy(eml, mailbox), null);
    expect(r).toMatchObject({ status: "processed", tenantVia: "signed_recipient", result: { result: "approved" } });
    expect(await saleStatus(s.id)).toBe("approved");
  });

  it("correo que ningún negocio registró → ignorado", async () => {
    const eml = await raw("pichincha", (r) => r.replace("To: negocio@gmail.com", "To: nadie-registrado@x.com"));
    expect(await processInboundEmail(eml, null)).toMatchObject({ status: "ignored", detail: "unknown_tenant" });
  });

  it("el mismo correo registrado en dos negocios → ambiguo, no se procesa", async () => {
    const mailbox = `d${crypto.randomUUID().slice(0, 8)}@gmail.com`;
    await tenantWith(mailbox, 1, "V-0001");
    await tenantWith(mailbox, 1, "V-0002");
    const eml = await raw("pichincha", (r) => r.replace("To: negocio@gmail.com", `To: ${mailbox}`));
    expect(await processInboundEmail(eml, null)).toMatchObject({ status: "ignored", detail: "ambiguous_tenant" });
  });

  it("ATAQUE: alguien reenvía SU propio aviso real fingiendo ser el negocio → NO se aprueba", async () => {
    const victim = `v${crypto.randomUUID().slice(0, 8)}@gmail.com`;
    const { s } = await tenantWith(victim, 25.5, "V-1001");
    // Aviso auténtico (firmado por el banco) pero dirigido al atacante: el dinero llegó a SU cuenta
    const eml = await raw("pichincha", (r) => r.replace("To: negocio@gmail.com", "To: atacante@gmail.com"));
    const r = await processInboundEmail(forwardedBy(eml, victim), null);
    expect(r).toMatchObject({ status: "processed", tenantVia: "recipient" });
    expect(await saleStatus(s.id)).not.toBe("approved");
  });

  it("confirmación de reenvío de Gmail → se asigna al negocio del correo que la solicitó", async () => {
    const mailbox = `c${crypto.randomUUID().slice(0, 8)}@gmail.com`;
    const { t } = await tenantWith(mailbox, 1, "V-0003");
    const eml = await raw("gmail-confirmacion", (r) => r.replace(/negocio@gmail\.com/g, mailbox));
    expect((await processInboundEmail(eml, null)).status).toBe("forwarding_confirmation");
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, t.id));
    expect(row.forwardingConfirmation).toContain("mail-settings.google.com");
  });
});
