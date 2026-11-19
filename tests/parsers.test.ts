/**
 * Pruebas del lector de correos bancarios. No necesitan base de datos.
 * Los .eml de tests/fixtures son SINTÉTICOS (estilos típicos). Agrega correos reales
 * anonimizados ahí y una prueba por cada uno para afinar cada banco.
 */
import { describe, expect, it } from "vitest";
import PostalMime from "postal-mime";
import { parseAmount, findSaleCodes, direction, htmlToText } from "@/parsers/extract";
import { bankFromAddress, banksFromAccounts, parseSenderList } from "@/parsers/banks";
import { parseBankEmail, forwardingConfirmation, type EmailInput } from "@/parsers";
import { aliasFromRecipient, inboundAddressFor, INBOUND_MODE } from "@/lib/inbound-address";
import { verifyDkim } from "@/lib/dkim";
import { fixture, sign } from "./dkim-helper";

/** Carga un fixture (firmado con DKIM de prueba si corresponde) y lo prepara como lo hace la app. */
async function load(name: string, edit?: (raw: string) => string): Promise<EmailInput> {
  const raw = await fixture(name, edit);
  const m = await PostalMime.parse(raw);
  return {
    from: m.from?.address ?? "", subject: m.subject ?? "", text: m.text ?? null, html: m.html ?? null,
    headers: (m.headers ?? []).map((h) => ({ key: h.key, value: h.value })),
    to: (m.to ?? []).map((a) => a.address!.toLowerCase()),
    cc: (m.cc ?? []).map((a) => a.address!.toLowerCase()),
    dkim: await verifyDkim(raw),
  };
}

describe("parseAmount: formatos de monto", () => {
  it.each([
    ["25.50", 25.5], ["25,50", 25.5], ["$ 1,234.56", 1234.56], ["1.234,56", 1234.56],
    ["1.250,00", 1250], ["1,500", 1500], ["1.500", 1500], ["40", 40], ["USD 0,99", 0.99], ["12.5", 12.5],
  ])("%s → %s", (raw, expected) => expect(parseAmount(raw)).toBe(expected));

  it.each(["abc", "", "0", "0,00"])("inválido: %s", (raw) => expect(parseAmount(raw)).toBeNull());
});

describe("findSaleCodes: tolera cómo el banco escribe el concepto", () => {
  it.each([
    ["Pago V-1234", ["V-1234"]], ["pago v1234", ["V-1234"]], ["V 1234", ["V-1234"]], ["V_1234 y V.5678", ["V-1234", "V-5678"]],
  ])("%s", (text, codes) => expect(findSaleCodes(text)).toEqual(codes));

  it.each(["AV1234", "V12345", "cuenta 2201234"])("no confunde: %s", (text) => expect(findSaleCodes(text)).toEqual([]));
});

describe("direction: dinero que entra vs. que sale", () => {
  it.each(["Recibiste una transferencia", "Se ha acreditado a tu cuenta", "Juan te envió $5", "Transferencia recibida"])(
    "entra: %s", (t) => expect(direction(t)).toBe("credit"));
  it.each(["Realizaste una transferencia", "Se ha debitado de tu cuenta", "Compra aprobada", "Transferencia enviada"])(
    "sale: %s", (t) => expect(direction(t)).toBe("debit"));
  it("sin pistas → unknown", () => expect(direction("Notificación de movimiento")).toBe("unknown"));
});

describe("bankFromAddress", () => {
  it("reconoce dominio y subdominio", () => {
    expect(bankFromAddress("a@pichincha.com")?.id).toBe("pichincha");
    expect(bankFromAddress("a@mail.bancoguayaquil.com")?.id).toBe("guayaquil");
  });
  it("no acepta dominios parecidos", () => {
    expect(bankFromAddress("a@pichincha.com.evil.io")).toBeNull();
    expect(bankFromAddress("a@falsopichincha.com")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("convierte tablas en líneas y entidades", () => {
    expect(htmlToText("<tr><td>N&uacute;mero</td><td>&#36;5</td></tr>")).toBe("Número\n$5");
  });
});

describe("Correos completos", () => {
  it("Pichincha (HTML, tabla, coma decimal) → confiable", async () => {
    const r = parseBankEmail(await load("pichincha"));
    expect(r).toMatchObject({ ok: true, bankId: "pichincha", amount: 25.5, sender: "MARIA PEREZ", reference: "123456789", trusted: true });
    if (r.ok) expect(r.memo).toContain("V-1001");
  });

  it("Banco Guayaquil (texto, miles con punto, DKIM vía ARC de Gmail) → confiable", async () => {
    const r = parseBankEmail(await load("guayaquil"));
    expect(r).toMatchObject({ ok: true, bankId: "guayaquil", amount: 1250, sender: "COMERCIAL LOPEZ S.A.", trusted: true });
    if (r.ok) expect(r.memo).toContain("V-1002");
  });

  it("Produbanco (código en 'Referencia del pago' con espacio)", async () => {
    const r = parseBankEmail(await load("produbanco"));
    expect(r).toMatchObject({ ok: true, amount: 40, sender: "Juan Torres", trusted: true });
    if (r.ok) expect(r.memo).toContain("V-1003");
  });

  it("Deuna (monto dentro de la frase)", async () => {
    const r = parseBankEmail(await load("deuna"));
    expect(r).toMatchObject({ ok: true, bankId: "deuna", amount: 12.75, trusted: true });
    if (r.ok) expect(r.memo).toContain("V-1004");
  });

  it("sin firma DKIM → se lee, pero NO es confiable", async () => {
    const r = parseBankEmail(await load("pacifico-sin-dkim"));
    expect(r).toMatchObject({ ok: true, bankId: "pacifico", amount: 18, dkim: false, trusted: false });
  });

  it("DKIM 'pass' puesto por un servidor no confiable → NO es confiable", async () => {
    const r = parseBankEmail(await load("falso-pichincha"));
    expect(r).toMatchObject({ ok: true, dkim: false, trusted: false });
  });

  it("débito (dinero que sale) → se ignora", async () => {
    expect(parseBankEmail(await load("debito"))).toMatchObject({ ok: false, reason: "outgoing" });
  });

  it("publicidad del banco (sin monto) → se ignora", async () => {
    expect(parseBankEmail(await load("publicidad"))).toMatchObject({ ok: false, reason: "no_amount" });
  });

  it("confirmación de reenvío de Gmail → extrae enlace y código", async () => {
    const info = forwardingConfirmation(await load("gmail-confirmacion"));
    expect(info).toContain("https://mail-settings.google.com/");
    expect(info).toContain("123456789");
  });

  it("un correo bancario normal NO es confirmación de reenvío", async () => {
    expect(forwardingConfirmation(await load("pichincha"))).toBeNull();
  });
});

describe("Multibanco: bancos configurados por el negocio", () => {
  const custom = banksFromAccounts([
    { id: "a1", bankId: "custom", bankName: "Cooperativa Mushuc Runa", senderEmails: "avisos@mushucruna.fin.ec", active: true },
    { id: "a2", bankId: "pichincha", bankName: "Banco Pichincha", senderEmails: "alertas@pichincha-notifica.com", active: true },
    { id: "a3", bankId: "guayaquil", bankName: "Banco Guayaquil", senderEmails: null, active: false },
  ]);

  it("parseSenderList limpia, normaliza y descarta basura", () => {
    expect(parseSenderList(" A@X.com, banco.com ;@otro.ec  basura  a@x.com")).toEqual(["a@x.com", "banco.com", "otro.ec"]);
  });

  it("banksFromAccounts: ignora cuentas pausadas y combina dominios del registro", () => {
    expect(custom.map((b) => b.id)).toEqual(["custom:a1", "pichincha"]);
    expect(custom[1].domains).toEqual(expect.arrayContaining(["pichincha.com", "pichincha-notifica.com"]));
  });

  it("reconoce un banco que no está en el registro por la dirección configurada", () => {
    expect(bankFromAddress("avisos@mushucruna.fin.ec", custom)?.name).toBe("Cooperativa Mushuc Runa");
  });

  it("reconoce un remitente extra configurado para un banco del registro", () => {
    expect(bankFromAddress("alertas@pichincha-notifica.com", custom)?.id).toBe("pichincha");
  });

  it("correo de un banco conocido pero NO registrado por el negocio → no confiable", async () => {
    const r = parseBankEmail(await load("guayaquil"), { tenantBanks: custom });
    expect(r).toMatchObject({ ok: true, bankId: "guayaquil", trusted: false });
    if (r.ok) expect(r.warnings.join(" ")).toContain("no está registrado");
  });

  it("correo de un banco registrado → sigue siendo confiable", async () => {
    const r = parseBankEmail(await load("pichincha"), { tenantBanks: custom });
    expect(r).toMatchObject({ ok: true, bankId: "pichincha", trusted: true });
  });

  it("sin bancos registrados → comportamiento abierto (se acepta cualquier banco del registro)", async () => {
    expect(parseBankEmail(await load("guayaquil"), { tenantBanks: [] })).toMatchObject({ trusted: true });
  });
});

describe("Correo del negocio donde llegan los avisos", () => {
  const withMailbox = (mailbox: string | null) => banksFromAccounts([
    { id: "p1", bankId: "pichincha", bankName: "Banco Pichincha", senderEmails: null, active: true, notifyEmail: mailbox },
  ]);

  it("llegó al correo registrado → confiable", async () => {
    const email = await load("pichincha"); // el banco lo dirigió (y firmó) a negocio@gmail.com
    expect(parseBankEmail(email, { tenantBanks: withMailbox("negocio@gmail.com") })).toMatchObject({ trusted: true });
  });

  it("llegó a OTRO correo → no confiable, con aviso", async () => {
    const email = await load("pichincha", (raw) => raw.replace("To: negocio@gmail.com", "To: otra-persona@gmail.com"));
    const r = parseBankEmail(email, { tenantBanks: withMailbox("negocio@gmail.com") });
    expect(r).toMatchObject({ ok: true, trusted: false });
    if (r.ok) expect(r.warnings.join(" ")).toContain("no está dirigido al correo registrado");
  });

  it("sin correo registrado en la cuenta → no se exige", async () => {
    const email = await load("pichincha", (raw) => raw.replace("To: negocio@gmail.com", "To: cualquiera@x.com"));
    expect(parseBankEmail(email, { tenantBanks: withMailbox(null) })).toMatchObject({ trusted: true });
  });

  it("dos cuentas del mismo banco con correos distintos → acepta ambos", () => {
    const [b] = banksFromAccounts([
      { id: "p1", bankId: "pichincha", bankName: "Banco Pichincha", senderEmails: null, active: true, notifyEmail: "ventas@n.com" },
      { id: "p2", bankId: "pichincha", bankName: "Banco Pichincha", senderEmails: null, active: true, notifyEmail: "dueno@gmail.com" },
    ]);
    expect(b.mailboxes).toEqual(["ventas@n.com", "dueno@gmail.com"]);
  });
});

describe("Dirección de reenvío con subdirección (pagos+alias@)", () => {
  it.each([
    ["pagos+a07e53e71f@in.arkandevstudio.com", "a07e53e71f"],
    ["PAGOS+A07E53E71F@IN.ARKANDEVSTUDIO.COM", "a07e53e71f"],
    ["<pagos+abc@in.x.com>", "abc"],
    ["a07e53e71f@in.arkandevstudio.com", "a07e53e71f"],
  ])("%s → %s", (to, alias) => expect(aliasFromRecipient(to)).toBe(alias));

  it("en modo buzón todos usan la misma dirección; en modo worker, pagos+alias@", () => {
    if (INBOUND_MODE === "worker") expect(inboundAddressFor("abc")).toMatch(/^pagos\+abc@/);
    else expect(inboundAddressFor("abc")).toBe(inboundAddressFor("xyz"));
  });
});

describe("Verificación DKIM criptográfica", () => {
  it("firma válida del banco → dkim true", async () => {
    expect(parseBankEmail(await load("pichincha"))).toMatchObject({ dkim: true });
  });

  it("monto alterado después de firmar → la firma se rompe → no confiable", async () => {
    const signed = await fixture("pichincha");
    const tampered = signed.replace("$25,50", "$95,50");
    const dk = await verifyDkim(tampered);
    expect(dk.passDomains).toEqual([]);
  });

  it("firmado por OTRO dominio (no el del banco) → no confiable", async () => {
    const raw = await sign((await import("node:fs")).readFileSync("tests/fixtures/pichincha.eml", "utf8"), "atacante.com");
    const m = await PostalMime.parse(raw);
    const email: EmailInput = {
      from: m.from!.address!, subject: m.subject!, text: m.text, html: m.html, headers: [], to: ["negocio@gmail.com"],
      dkim: await verifyDkim(raw),
    };
    expect(parseBankEmail(email)).toMatchObject({ ok: true, dkim: false, trusted: false });
  });

  it("cabeceras Authentication-Results falsas ya NO cuentan", async () => {
    expect(parseBankEmail(await load("falso-pichincha"))).toMatchObject({ dkim: false, trusted: false });
  });

  it("las cabeceras que agrega Gmail al reenviar no rompen la firma", async () => {
    const signed = await fixture("pichincha");
    const forwarded = "X-Forwarded-For: negocio@gmail.com pagos@arkandevstudio.com\r\nDelivered-To: pagos@arkandevstudio.com\r\n" + signed;
    expect((await verifyDkim(forwarded)).passDomains).toEqual(["pichincha.com"]);
  });
});
