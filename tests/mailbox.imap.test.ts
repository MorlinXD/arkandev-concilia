/**
 * Integración con un servidor IMAP REAL (opcional). Se ejecuta solo si defines IMAP_TEST_HOST, p. ej.:
 *   IMAP_TEST_HOST=127.0.0.1 IMAP_TEST_PORT=1143 IMAP_TEST_USER=pagos IMAP_TEST_PASS=…
 * Comprueba: procesa lo pendiente al conectar, procesa al instante lo nuevo (IDLE) y mueve a "Procesados".
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { db, schema } from "@/db";
import { fixture } from "./dkim-helper";
import { makeSale, makeTenant } from "./helpers";

const { IMAP_TEST_HOST, IMAP_TEST_PORT, IMAP_TEST_USER, IMAP_TEST_PASS } = process.env;
const enabled = !!(IMAP_TEST_HOST && IMAP_TEST_USER && IMAP_TEST_PASS);

/** Entrega un correo a INBOX a través del propio servidor (como lo hace el servidor de correo al recibirlo). */
async function deliver(raw: string) {
  const c = new ImapFlow({ host: IMAP_TEST_HOST!, port: Number(IMAP_TEST_PORT), secure: false, auth: { user: IMAP_TEST_USER!, pass: IMAP_TEST_PASS! }, logger: false });
  await c.connect();
  await c.append("INBOX", raw, []);
  await c.logout();
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await wait(250); }
  return false;
}

describe.skipIf(!enabled)("Buzón IMAP real", () => {
  const created: string[] = [];
  afterAll(async () => { for (const id of created) await db.delete(schema.tenants).where(eq(schema.tenants.id, id)); });

  it("procesa lo pendiente al conectar y lo nuevo al instante (IDLE)", async () => {
    process.env.IMAP_HOST = IMAP_TEST_HOST; process.env.IMAP_PORT = IMAP_TEST_PORT ?? "143";
    process.env.IMAP_USER = IMAP_TEST_USER; process.env.IMAP_PASSWORD = IMAP_TEST_PASS;

    const mailbox = `imap${crypto.randomUUID().slice(0, 6)}@gmail.com`;
    const t = await makeTenant(); created.push(t.id);
    await db.insert(schema.bankAccounts).values({ id: crypto.randomUUID(), tenantId: t.id, bankId: "pichincha", bankName: "Banco Pichincha", notifyEmail: mailbox });
    const before = await makeSale(t.id, 25.5, { code: "V-7001" });
    const after = await makeSale(t.id, 40, { code: "V-7002" });
    const status = async (id: string) => (await db.select().from(schema.sales).where(eq(schema.sales.id, id)))[0].status;

    // 1) Correo que ya estaba esperando ANTES de conectar
    await deliver(await fixture("pichincha", (r) => r.replace("To: negocio@gmail.com", `To: ${mailbox}`)
      .replace("V-1001", "V-7001").replace(/^Message-ID:.*$/im, `Message-ID: <${crypto.randomUUID()}@t>`)));

    const { startMailboxListener } = await import("@/lib/mailbox");
    startMailboxListener();
    expect(await until(async () => (await status(before.id)) === "approved")).toBe(true);

    // 2) Correo que llega DESPUÉS, con la conexión abierta: IDLE debe avisar al instante
    const t0 = Date.now();
    await deliver(await fixture("produbanco", (r) => r.replace(/^To:.*$/im, `To: ${mailbox}`)
      .replace("V 1003", "V-7002").replace(/^Message-ID:.*$/im, `Message-ID: <${crypto.randomUUID()}@t>`)));
    // produbanco no está registrado por el negocio → queda en revisión (modo seguro), pero se PROCESA
    expect(await until(async () => (await status(after.id)) !== "pending")).toBe(true);
    const seconds = (Date.now() - t0) / 1000;
    console.log(`IDLE: procesado en ${seconds.toFixed(1)} s`);
    expect(seconds).toBeLessThan(10);

    // 3) Los procesados salen de INBOX y quedan en "Procesados"
    const imap = new ImapFlow({ host: IMAP_TEST_HOST!, port: Number(IMAP_TEST_PORT), secure: false, auth: { user: IMAP_TEST_USER!, pass: IMAP_TEST_PASS! }, logger: false });
    await imap.connect();
    const inbox = await imap.status("INBOX", { unseen: true });
    const done = await imap.status("Procesados", { messages: true });
    await imap.logout();
    expect(inbox && inbox.unseen).toBe(0);
    expect(done && done.messages).toBeGreaterThanOrEqual(2);
  }, 40000);
});
