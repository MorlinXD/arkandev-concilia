import { bankFromAddress, type Bank } from "./banks";
import type { DkimResult } from "@/lib/dkim";
import { direction, findAmount, findLabeled, findSaleCodes, htmlToText } from "./extract";

export type EmailInput = {
  from: string;                       // dirección del remitente original
  subject: string;
  text?: string | null;
  html?: string | null;
  headers: { key: string; value: string }[];
  /** Direcciones de las cabeceras To y Cc del correo original del banco. */
  to?: string[];
  cc?: string[];
  /** Resultado de la verificación DKIM criptográfica (src/lib/dkim.ts). Sin esto, nada es confiable. */
  dkim?: DkimResult;
};

export type ParsedTransfer = {
  ok: true;
  bank: string;
  bankId: string | null;
  amount: number;
  memo: string;                       // concepto + códigos encontrados en todo el correo
  sender: string | null;
  reference: string | null;
  direction: "credit" | "unknown";
  dkim: boolean;
  /** true solo si: banco conocido + firma DKIM válida + dinero entrante. Si es false, nunca se aprueba solo. */
  trusted: boolean;
  warnings: string[];
};

export type ParseFailure = { ok: false; reason: "outgoing" | "no_amount" | "not_bank"; detail?: string };

/** ¿Hay una firma DKIM válida de un dominio del banco? Devuelve ese dominio. */
export function dkimDomainFor(dkim: DkimResult | undefined, bank: Bank | null): string | null {
  if (!bank || !dkim) return null;
  return dkim.passDomains.find((d) => bank.domains.some((bd) => d === bd || d.endsWith("." + bd))) ?? null;
}

/** Destinatarios que el banco firmó (To/Cc cubiertos por su firma DKIM): no se pueden falsificar. */
export function signedRecipients(email: EmailInput, dkimDomain: string | null): string[] {
  if (!dkimDomain || !email.dkim) return [];
  const keys = email.dkim.signedHeaders[dkimDomain] ?? [];
  return [
    ...(keys.includes("to") ? email.to ?? [] : []),
    ...(keys.includes("cc") ? email.cc ?? [] : []),
  ].map((a) => a.toLowerCase());
}

export type ParseOptions = {
  /** Bancos configurados por el negocio (sección "Bancos" del panel). */
  tenantBanks?: Bank[];
};

export function parseBankEmail(email: EmailInput, opts: ParseOptions = {}): ParsedTransfer | ParseFailure {
  const tenantBanks = opts.tenantBanks ?? [];
  const bank = bankFromAddress(email.from, tenantBanks);
  // Si el negocio registró bancos, un correo de otro banco no es confiable (¿cuenta ajena? ¿suplantación?)
  const registered = tenantBanks.length === 0 || (!!bank && tenantBanks.some((b) => b.id === bank.id));
  const body = email.text?.trim() ? email.text : htmlToText(email.html ?? "");
  const full = `${email.subject}\n${body}`;
  const lines = full.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const warnings: string[] = [];

  const dir = direction(full);
  if (dir === "debit") return { ok: false, reason: "outgoing", detail: "El correo describe dinero que SALE de la cuenta" };

  const amount = findAmount(lines, full);
  if (!amount) return { ok: false, reason: "no_amount", detail: "No se encontró un monto" };

  const memoLabel = findLabeled(lines, "memo");
  const codes = findSaleCodes(full);
  const memo = [memoLabel, ...codes.filter((c) => !memoLabel?.toUpperCase().includes(c))].filter(Boolean).join(" · ");

  const dkimDomain = dkimDomainFor(email.dkim, bank);
  const dkim = !!dkimDomain;
  if (!bank) warnings.push("Remitente no reconocido como banco");
  if (bank && !dkim) warnings.push("No se pudo verificar la firma DKIM del banco");
  if (dir === "unknown") warnings.push("No se pudo confirmar que sea dinero entrante");
  if (bank && !registered) warnings.push(`${bank.name} no está registrado en tus bancos`);

  // ¿El banco dirigió este aviso al correo del negocio registrado? Solo cuentan destinatarios FIRMADOS:
  // así nadie puede reenviar su propio aviso real fingiendo que era para otro negocio.
  const expected = tenantBanks.find((b) => b.id === bank?.id)?.mailboxes ?? [];
  const signed = signedRecipients(email, dkimDomain);
  const mailboxOk = expected.length === 0 || expected.some((m) => signed.includes(m));
  // Sin firma no se puede saber a quién lo dirigió el banco; ese caso ya tiene su propio aviso (DKIM)
  if (!mailboxOk && dkimDomain) warnings.push(`El aviso no está dirigido al correo registrado (${expected.join(", ")})`);

  return {
    ok: true,
    bank: bank?.name ?? `Desconocido (${email.from.split("@")[1] ?? "?"})`,
    bankId: bank?.id ?? null,
    amount,
    memo,
    sender: findLabeled(lines, "sender"),
    reference: findLabeled(lines, "reference"),
    direction: dir,
    dkim,
    trusted: !!bank && dkim && dir === "credit" && registered && mailboxOk,
    warnings,
  };
}

/** Correo de confirmación de reenvío de Gmail/Outlook: hay que mostrarle el enlace al negocio. */
export function forwardingConfirmation(email: EmailInput): string | null {
  const from = email.from.toLowerCase();
  const isGmail = from.includes("forwarding-noreply@google.com");
  const isOutlook = /outlook|microsoft/.test(from) && /reenv|forward/i.test(email.subject);
  if (!isGmail && !isOutlook) return null;
  const body = email.text ?? htmlToText(email.html ?? "");
  const link = /(https:\/\/(?:mail(?:-settings)?\.google\.com|[a-z0-9.-]*(?:outlook|live|microsoft)\.com)\/[^\s<>"')]+)/i.exec(body)?.[1];
  const code = /(?:c[oó]digo de confirmaci[oó]n|confirmation code)[^\d]*(\d{6,12})/i.exec(body)?.[1];
  return [link, code ? `Código: ${code}` : null].filter(Boolean).join(" · ") || email.subject;
}
