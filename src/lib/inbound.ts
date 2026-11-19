import PostalMime from "postal-mime";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { forwardingConfirmation, parseBankEmail, type EmailInput } from "@/parsers";
import { bankFromAddress, banksFromAccounts, type Bank } from "@/parsers/banks";
import { ingestTransfer, type ReconcileResult } from "./reconcile";
import { aliasFromRecipient } from "./inbound-address";
import { verifyDkim, type DkimResult } from "./dkim";

export type InboundOutcome =
  | { status: "processed"; parse: ReturnType<typeof parseBankEmail>; result: ReconcileResult; tenantVia: TenantVia }
  | { status: "forwarding_confirmation"; info: string }
  | { status: "ignored" | "failed"; detail: string };

type Tenant = typeof schema.tenants.$inferSelect;
type TenantVia = "alias" | "signed_recipient" | "recipient";

const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const addresses = (list?: { address?: string }[]) =>
  (list ?? []).map((a) => a.address?.toLowerCase()).filter((a): a is string => !!a);

/** Si el correo fue reenviado a mano ("Fwd:"), busca el remitente original dentro del cuerpo. */
function originalSenderInBody(text: string, tenantBanks: Bank[]): string | null {
  for (const m of text.matchAll(/^(?:>?\s*)(?:De|From)\s*:\s*.*?<?([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})>?/gim)) {
    if (bankFromAddress(m[1], tenantBanks)) return m[1];
  }
  return null;
}

/** Cabeceras que agregan Gmail/Outlook al reenviar (NO firmadas: solo sirven como pista, nunca como garantía). */
function forwardingHeaderAddresses(mail: Awaited<ReturnType<typeof PostalMime.parse>>): string[] {
  const out: string[] = [];
  for (const h of mail.headers ?? []) {
    if (/^(x-forwarded-for|delivered-to|x-original-to)$/i.test(h.key)) {
      for (const m of h.value.matchAll(EMAIL_RE)) out.push(m[0].toLowerCase());
    }
  }
  return out;
}

/**
 * ¿De qué negocio es este correo?
 * 1) Por la dirección de reenvío pagos+<alias>@ (si el correo llegó así).
 * 2) Por el "correo donde llegan los avisos" registrado en Bancos: primero los destinatarios
 *    FIRMADOS por el banco, luego los no firmados (estos nunca permiten aprobar solo).
 */
async function resolveTenant(
  recipient: string | null, candidates: { email: string; signed: boolean }[],
): Promise<{ tenant: Tenant; via: TenantVia } | { error: "unknown" | "ambiguous"; detail: string }> {
  if (recipient) {
    const alias = aliasFromRecipient(recipient);
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.inboundAlias, alias)).limit(1);
    if (t) return { tenant: t, via: "alias" };
  }
  for (const c of candidates) {
    const rows = await db.selectDistinct({ tenantId: schema.bankAccounts.tenantId }).from(schema.bankAccounts)
      .where(and(eq(schema.bankAccounts.notifyEmail, c.email), eq(schema.bankAccounts.active, true)));
    if (rows.length > 1) return { error: "ambiguous", detail: `${c.email} está registrado en varios negocios` };
    if (rows.length === 1) {
      const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, rows[0].tenantId)).limit(1);
      if (t) return { tenant: t, via: c.signed ? "signed_recipient" : "recipient" };
    }
  }
  return { error: "unknown", detail: "Ningún negocio tiene registrado este correo en Bancos" };
}

/**
 * Procesa un correo crudo (MIME).
 * @param recipient dirección a la que llegó (Email Worker: pagos+alias@…). En modo buzón puede ser null.
 */
export async function processInboundEmail(raw: string, recipient: string | null = null): Promise<InboundOutcome> {
  const mail = await PostalMime.parse(raw);
  const dkim: DkimResult = await verifyDkim(raw);
  let from = mail.from?.address ?? "";
  const email: EmailInput = {
    from,
    subject: mail.subject ?? "",
    text: mail.text ?? null,
    html: mail.html ?? null,
    headers: (mail.headers ?? []).map((h) => ({ key: h.key, value: h.value })),
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    dkim,
  };

  // Candidatos para identificar al negocio, de más a menos confiable
  const signedTo = new Set(
    dkim.passDomains.flatMap((d) => {
      const keys = dkim.signedHeaders[d] ?? [];
      return [...(keys.includes("to") ? email.to ?? [] : []), ...(keys.includes("cc") ? email.cc ?? [] : [])];
    }),
  );
  const confirmation = forwardingConfirmation(email);
  const bodyEmails = confirmation ? [...`${email.text ?? ""} ${email.subject}`.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase()) : [];
  const seen = new Set<string>();
  const candidates = [
    ...[...signedTo].map((e) => ({ email: e, signed: true })),
    ...[...(email.to ?? []), ...(email.cc ?? []), ...forwardingHeaderAddresses(mail), ...bodyEmails].map((e) => ({ email: e, signed: false })),
  ].filter((c) => !seen.has(c.email) && seen.add(c.email));

  const resolved = await resolveTenant(recipient, candidates);
  const tenant = "tenant" in resolved ? resolved.tenant : null;
  const via: TenantVia = "via" in resolved ? resolved.via : "recipient";

  const log = (status: "processed" | "ignored" | "failed" | "forwarding_confirmation", detail: string | null, transferId?: string) =>
    db.insert(schema.inboundEmails).values({
      tenantId: tenant?.id ?? null, recipient: (recipient ?? email.to?.[0] ?? "(buzón)").slice(0, 255),
      fromAddress: from.slice(0, 255) || null, subject: email.subject.slice(0, 255) || null,
      status, detail: detail?.slice(0, 500) ?? null, transferId: transferId ?? null,
    });

  if (!tenant) {
    await log("ignored", "error" in resolved ? resolved.detail : "Negocio no identificado");
    return { status: "ignored", detail: "error" in resolved ? `${resolved.error}_tenant` : "unknown_tenant" };
  }

  if (confirmation) {
    await db.update(schema.tenants).set({ forwardingConfirmation: confirmation.slice(0, 600) }).where(eq(schema.tenants.id, tenant.id));
    await log("forwarding_confirmation", confirmation);
    return { status: "forwarding_confirmation", info: confirmation };
  }

  const accounts = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.tenantId, tenant.id));
  const tenantBanks = banksFromAccounts(accounts);

  // Reenvío manual ("Fwd:"): el remitente es el propio negocio y la firma del banco ya no existe.
  if (!bankFromAddress(from, tenantBanks)) {
    const original = originalSenderInBody(email.text ?? "", tenantBanks);
    if (original) { from = original; email.from = original; email.headers = []; email.dkim = undefined; }
  }

  const parse = parseBankEmail(email, { tenantBanks });
  if (!parse.ok) {
    await log("ignored", `${parse.reason}${parse.detail ? `: ${parse.detail}` : ""}`);
    return { status: "ignored", detail: parse.reason };
  }

  // Si el negocio se identificó con una cabecera NO firmada, nunca se aprueba solo
  const trusted = parse.trusted && via !== "recipient";
  if (parse.trusted && !trusted) parse.warnings.push("Negocio identificado por una cabecera no firmada");

  const rawHash = createHash("sha256").update(mail.messageId || raw).digest("hex");
  try {
    const result = await ingestTransfer({
      alias: tenant.inboundAlias, bank: parse.bank, amount: parse.amount, memo: parse.memo || null,
      sender: parse.sender, reference: parse.reference,
      receivedAt: mail.date ? new Date(mail.date) : undefined,
      rawHash, trusted,
    });
    const detail = [result.result, ...parse.warnings].join(" · ");
    await log("processed", detail, "transferId" in result ? result.transferId : undefined);
    return { status: "processed", parse: { ...parse, trusted }, result, tenantVia: via };
  } catch (e) {
    await log("failed", e instanceof Error ? e.message : String(e));
    return { status: "failed", detail: "error" };
  }
}

