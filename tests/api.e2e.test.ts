/**
 * Pruebas de punta a punta de la API. Necesitan la app corriendo:
 *   terminal 1: npm run dev
 *   terminal 2: npm run test:e2e
 * Usa APP_URL (por defecto http://localhost:3000) e INGEST_SECRET del .env.
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.INGEST_SECRET ?? "";
const uniq = () => Math.random().toString(36).slice(2, 10);

class Client {
  cookie = "";
  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers: Record<string, string> = { Origin: BASE, ...(init.headers as Record<string, string>) };
    if (this.cookie) headers.Cookie = this.cookie;
    if (init.json !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, {
      ...init, headers, redirect: "manual",
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) this.cookie = set.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, body, location: res.headers.get("location") };
  }
  signUp(email: string, password = "Prueba1234") {
    return this.req("/api/auth/sign-up/email", { method: "POST", json: { email, password, name: "Test" } });
  }
}

const ingest = (payload: object, secret = SECRET) =>
  fetch(BASE + "/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": secret },
    body: JSON.stringify(payload),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

let owner: Client;
let alias = "";

beforeAll(async () => {
  const ok = await fetch(BASE).then(() => true).catch(() => false);
  if (!ok) throw new Error(`La app no responde en ${BASE}. Corre "npm run dev" en otra terminal.`);
  owner = new Client();
  const r = await owner.signUp(`owner-${uniq()}@test.com`);
  expect(r.status).toBe(200);
  const t = await owner.req("/api/tenant", { method: "POST", json: { name: "Negocio E2E" } });
  expect(t.status).toBe(200);
  alias = (await owner.req("/api/feed")).body.alias ?? "";
  expect(alias).not.toBe("");
});

describe("Autenticación", () => {
  it("rechaza contraseñas de menos de 8 caracteres", async () => {
    const r = await new Client().signUp(`short-${uniq()}@test.com`, "123");
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it("rechaza registrar el mismo correo dos veces", async () => {
    const email = `dup-${uniq()}@test.com`;
    expect((await new Client().signUp(email)).status).toBe(200);
    expect((await new Client().signUp(email)).status).toBeGreaterThanOrEqual(400);
  });

  it("rechaza login con contraseña incorrecta", async () => {
    const email = `pw-${uniq()}@test.com`;
    await new Client().signUp(email);
    const r = await new Client().req("/api/auth/sign-in/email", { method: "POST", json: { email, password: "Incorrecta99" } });
    expect(r.status).toBe(401);
  });

  it("sin sesión, /dashboard redirige a /login", async () => {
    const r = await new Client().req("/dashboard");
    expect(r.status).toBe(307);
    expect(r.location).toContain("/login");
  });

  it("usuario sin negocio es enviado a /onboarding", async () => {
    const c = new Client();
    await c.signUp(`nobiz-${uniq()}@test.com`);
    const r = await c.req("/dashboard");
    expect(r.status).toBe(307);
    expect(r.location).toContain("/onboarding");
  });
});

describe("Negocio (onboarding)", () => {
  it("no permite registrar un segundo negocio", async () => {
    const r = await owner.req("/api/tenant", { method: "POST", json: { name: "Otro" } });
    expect(r.status).toBe(400);
  });

  it("valida el nombre (mínimo 2 caracteres)", async () => {
    const c = new Client();
    await c.signUp(`name-${uniq()}@test.com`);
    expect((await c.req("/api/tenant", { method: "POST", json: { name: "a" } })).status).toBe(400);
  });

  it("sin sesión no puede crear negocio", async () => {
    expect((await new Client().req("/api/tenant", { method: "POST", json: { name: "X" } })).status).toBe(401);
  });
});

describe("Ventas", () => {
  it("crea una venta y devuelve código V-0000 con monto redondeado", async () => {
    const r = await owner.req("/api/sales", { method: "POST", json: { amount: 19.999, description: "Prueba" } });
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^V-\d{4}$/);
    expect(r.body.amount).toBe("20.00");
  });

  it.each([0, -5, "abc", 2_000_000])("rechaza monto inválido: %s", async (amount) => {
    const r = await owner.req("/api/sales", { method: "POST", json: { amount } });
    expect(r.status).toBe(400);
  });

  it("sin sesión no puede crear ventas", async () => {
    expect((await new Client().req("/api/sales", { method: "POST", json: { amount: 5 } })).status).toBe(401);
  });
});

describe("Ingesta (/api/ingest)", () => {
  it("rechaza sin clave secreta", async () => {
    expect((await ingest({}, "")).status).toBe(401);
  });

  it("rechaza con clave incorrecta", async () => {
    expect((await ingest({}, "clave-mala")).status).toBe(401);
  });

  it("rechaza payload inválido (400)", async () => {
    expect((await ingest({ alias, bank: "P", amount: -1, rawHash: "x" })).status).toBe(400);
  });

  it("flujo completo: venta → transferencia con código → aprobada y visible en el feed", async () => {
    const sale = await owner.req("/api/sales", { method: "POST", json: { amount: 33.3 } });
    const r = await ingest({ alias, bank: "Banco Guayaquil", amount: 33.3, memo: `pago ${sale.body.code}`, rawHash: uniq() + uniq() });
    expect(r.body).toMatchObject({ result: "approved", saleCode: sale.body.code });
    const feed = await owner.req("/api/feed");
    expect(feed.body.sales.find((s: any) => s.code === sale.body.code).status).toBe("approved");
    expect(feed.body.transfers.some((t: any) => t.amount === "33.30" && t.status === "matched")).toBe(true);
  });

  it("el mismo correo reenviado dos veces se ignora", async () => {
    const payload = { alias, bank: "P", amount: 1.11, rawHash: "dup-" + uniq() };
    expect((await ingest(payload)).body.result).toBe("unmatched");
    expect((await ingest(payload)).body.result).toBe("duplicate");
  });
});

describe("Revisión manual", () => {
  async function saleInReview(amount: number) {
    const sale = await owner.req("/api/sales", { method: "POST", json: { amount } });
    const r = await ingest({ alias, bank: "P", amount, memo: "sin codigo", rawHash: uniq() + uniq() });
    expect(r.body.result).toBe("review");
    const feed = await owner.req("/api/feed");
    return feed.body.sales.find((s: any) => s.code === sale.body.code);
  }

  it("aprobar una venta en revisión → aprobada y transferencia conciliada", async () => {
    const s = await saleInReview(71.71);
    await owner.req(`/api/sales/${s.id}`, { method: "PATCH", json: { action: "approve" } });
    const feed = await owner.req("/api/feed");
    expect(feed.body.sales.find((x: any) => x.id === s.id).status).toBe("approved");
    expect(feed.body.transfers.find((t: any) => t.saleId === s.id).status).toBe("matched");
  });

  it("descartar → venta vuelve a pendiente y transferencia queda sin venta", async () => {
    const s = await saleInReview(72.72);
    await owner.req(`/api/sales/${s.id}`, { method: "PATCH", json: { action: "reject" } });
    const feed = await owner.req("/api/feed");
    expect(feed.body.sales.find((x: any) => x.id === s.id).status).toBe("pending");
    expect(feed.body.transfers.find((t: any) => t.amount === "72.72").status).toBe("unmatched");
  });

  it("acción inválida → 400", async () => {
    const r = await owner.req(`/api/sales/cualquiera`, { method: "PATCH", json: { action: "borrar" } });
    expect(r.status).toBe(400);
  });
});

describe("Aislamiento entre negocios", () => {
  it("otro negocio no ve las ventas ni transferencias del primero", async () => {
    const other = new Client();
    await other.signUp(`other-${uniq()}@test.com`);
    await other.req("/api/tenant", { method: "POST", json: { name: "Negocio ajeno" } });
    const mine = await owner.req("/api/feed");
    const theirs = await other.req("/api/feed");
    expect(mine.body.sales.length).toBeGreaterThan(0);
    expect(theirs.body.sales).toHaveLength(0);
    expect(theirs.body.transfers).toHaveLength(0);
  });

  it("otro negocio no puede aprobar una venta ajena", async () => {
    const sale = await owner.req("/api/sales", { method: "POST", json: { amount: 81.81 } });
    await ingest({ alias, bank: "P", amount: 81.81, memo: "x", rawHash: uniq() + uniq() });
    const target = (await owner.req("/api/feed")).body.sales.find((s: any) => s.code === sale.body.code);
    expect(target.status).toBe("review");

    const other = new Client();
    await other.signUp(`attacker-${uniq()}@test.com`);
    await other.req("/api/tenant", { method: "POST", json: { name: "Atacante" } });
    await other.req(`/api/sales/${target.id}`, { method: "PATCH", json: { action: "approve" } });

    const after = (await owner.req("/api/feed")).body.sales.find((s: any) => s.id === target.id);
    expect(after.status).toBe("review");
  });

  it("sin sesión el feed responde 401", async () => {
    expect((await new Client().req("/api/feed")).status).toBe(401);
  });
});

describe("Bancos (multibanco)", () => {
  it("lista el registro de bancos de Ecuador", async () => {
    const r = await owner.req("/api/banks");
    expect(r.status).toBe(200);
    expect(r.body.registry.length).toBeGreaterThanOrEqual(15);
    expect(r.body.registry.some((b: any) => b.id === "pichincha")).toBe(true);
  });

  it("agrega una cuenta del registro y la muestra con actividad 0", async () => {
    const r = await owner.req("/api/banks", { method: "POST", json: { bankId: "produbanco", alias: "Ahorros", lastDigits: "4321" } });
    expect(r.status).toBe(200);
    const list = await owner.req("/api/banks");
    const acc = list.body.accounts.find((a: any) => a.id === r.body.id);
    expect(acc).toMatchObject({ bankName: "Produbanco", lastDigits: "4321", active: true, transfers: 0 });
  });

  it("no permite la misma cuenta dos veces", async () => {
    await owner.req("/api/banks", { method: "POST", json: { bankId: "austro", lastDigits: "1111" } });
    const r = await owner.req("/api/banks", { method: "POST", json: { bankId: "austro", lastDigits: "1111" } });
    expect(r.status).toBe(409);
  });

  it("otro banco/cooperativa exige nombre y remitente", async () => {
    expect((await owner.req("/api/banks", { method: "POST", json: { bankId: "custom", bankName: "Coop X" } })).status).toBe(400);
    const ok = await owner.req("/api/banks", { method: "POST", json: { bankId: "custom", bankName: "Coop X", senderEmails: "Avisos@CoopX.fin.ec" } });
    expect(ok.status).toBe(200);
    const acc = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === ok.body.id);
    expect(acc.senderEmails).toBe("avisos@coopx.fin.ec");
  });

  it.each([["banco-inexistente", "Banco desconocido"], ["pichincha", null]])("valida banco y dígitos: %s", async (bankId, msg) => {
    const r = await owner.req("/api/banks", { method: "POST", json: { bankId, lastDigits: "12a" } });
    expect(r.status).toBe(400);
    if (msg) expect(JSON.stringify(r.body)).toBeTruthy();
  });

  it("pausar, editar remitentes y eliminar", async () => {
    const { body } = await owner.req("/api/banks", { method: "POST", json: { bankId: "bolivariano", lastDigits: "2222" } });
    expect((await owner.req(`/api/banks/${body.id}`, { method: "PATCH", json: { active: false, senderEmails: "x@bolivariano.com" } })).status).toBe(200);
    let acc = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === body.id);
    expect(acc).toMatchObject({ active: false, senderEmails: "x@bolivariano.com" });
    expect((await owner.req(`/api/banks/${body.id}`, { method: "DELETE" })).status).toBe(200);
    acc = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === body.id);
    expect(acc).toBeUndefined();
  });

  it("otro negocio no ve, no edita ni elimina mis cuentas", async () => {
    const { body } = await owner.req("/api/banks", { method: "POST", json: { bankId: "machala", lastDigits: "3333" } });
    const other = new Client();
    await other.signUp(`banks-${uniq()}@test.com`);
    await other.req("/api/tenant", { method: "POST", json: { name: "Ajeno" } });
    expect((await other.req("/api/banks")).body.accounts).toHaveLength(0);
    expect((await other.req(`/api/banks/${body.id}`, { method: "PATCH", json: { active: false } })).status).toBe(404);
    expect((await other.req(`/api/banks/${body.id}`, { method: "DELETE" })).status).toBe(404);
    const mine = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === body.id);
    expect(mine.active).toBe(true);
  });

  it("sin sesión → 401", async () => {
    expect((await new Client().req("/api/banks")).status).toBe(401);
  });
});

describe("Bancos: correo de recepción", () => {
  it("guarda el correo en minúsculas y permite editarlo", async () => {
    const { body } = await owner.req("/api/banks", { method: "POST", json: { bankId: "loja", lastDigits: "5555", notifyEmail: "Ventas@MiNegocio.com" } });
    let acc = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === body.id);
    expect(acc.notifyEmail).toBe("ventas@minegocio.com");
    await owner.req(`/api/banks/${body.id}`, { method: "PATCH", json: { notifyEmail: "caja@minegocio.com" } });
    acc = (await owner.req("/api/banks")).body.accounts.find((a: any) => a.id === body.id);
    expect(acc.notifyEmail).toBe("caja@minegocio.com");
  });

  it("rechaza un correo de recepción inválido", async () => {
    const r = await owner.req("/api/banks", { method: "POST", json: { bankId: "loja", lastDigits: "6666", notifyEmail: "no-es-correo" } });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("Correo de recepción");
  });
});
