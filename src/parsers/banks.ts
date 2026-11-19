/**
 * Registro de bancos y cooperativas de Ecuador.
 *
 * `domains`: dominios desde los que el banco envía sus notificaciones. Se usan para
 * identificar el banco y para verificar la firma DKIM del correo.
 *
 * ⚠️ Los dominios son la mejor estimación inicial. Confírmalos con un correo real de cada
 * banco: en el panel, "Correos recibidos" muestra el remitente exacto de cada correo que
 * no se pudo leer. Agregar o corregir un banco es solo editar esta lista.
 */
export type Bank = {
  id: string;
  name: string;
  domains: string[];
  /** Direcciones exactas de remitente (configuradas por el negocio). */
  senders?: string[];
  /** Correos del negocio donde este banco envía los avisos. Vacío = no se verifica. */
  mailboxes?: string[];
};

export const BANKS: Bank[] = [
  { id: "pichincha",    name: "Banco Pichincha",          domains: ["pichincha.com", "bancopichincha.com"] },
  { id: "guayaquil",    name: "Banco Guayaquil",          domains: ["bancoguayaquil.com", "bggroup.com.ec"] },
  { id: "produbanco",   name: "Produbanco",               domains: ["produbanco.com", "produbanco.com.ec", "grupopromerica.com"] },
  { id: "pacifico",     name: "Banco del Pacífico",       domains: ["bancodelpacifico.com", "pacifico.fin.ec"] },
  { id: "bolivariano",  name: "Banco Bolivariano",        domains: ["bolivariano.com"] },
  { id: "internacional",name: "Banco Internacional",      domains: ["bancointernacional.com.ec"] },
  { id: "austro",       name: "Banco del Austro",         domains: ["bancodelaustro.com"] },
  { id: "bgr",          name: "Banco General Rumiñahui",  domains: ["bgr.com.ec"] },
  { id: "machala",      name: "Banco de Machala",         domains: ["bancomachala.com"] },
  { id: "loja",         name: "Banco de Loja",            domains: ["bancodeloja.fin.ec"] },
  { id: "solidario",    name: "Banco Solidario",          domains: ["banco-solidario.com", "solidario.fin.ec"] },
  { id: "diners",       name: "Banco Diners Club",        domains: ["dinersclub.com.ec", "bancodiners.com.ec"] },
  { id: "bancodesarrollo", name: "Banco D-Miro / Desarrollo", domains: ["bancodesarrollo.fin.ec", "d-miro.org"] },
  { id: "jep",          name: "Cooperativa JEP",          domains: ["coopjep.fin.ec"] },
  { id: "jardin",       name: "Cooperativa Jardín Azuayo", domains: ["jardinazuayo.fin.ec"] },
  { id: "policia",      name: "Cooperativa Policía Nacional", domains: ["cpn.fin.ec"] },
  { id: "29octubre",    name: "Cooperativa 29 de Octubre", domains: ["29deoctubre.fin.ec"] },
  { id: "deuna",        name: "Deuna",                    domains: ["deuna.app", "deuna.ec"] },
];

export const bankById = (id: string) => BANKS.find((b) => b.id === id) ?? null;

const domainMatches = (domain: string, d: string) => domain === d || domain.endsWith("." + d);

/**
 * Devuelve el banco del remitente. Primero busca en los bancos que configuró el negocio
 * (`extra`: direcciones exactas o dominios), luego en el registro general.
 */
export function bankFromAddress(address: string | undefined | null, extra: Bank[] = []): Bank | null {
  const email = (address ?? "").toLowerCase().replace(/[<>]/g, "").trim();
  const domain = email.split("@")[1]?.trim();
  if (!domain) return null;
  const match = (b: Bank) => b.senders?.includes(email) || b.domains.some((d) => domainMatches(domain, d));
  return extra.find(match) ?? BANKS.find(match) ?? null;
}

/** Normaliza "a@x.com, banco.com ; B@Y.COM" → ["a@x.com", "banco.com", "b@y.com"] (sin duplicados ni basura). */
export function parseSenderList(raw: string | null | undefined): string[] {
  const items = (raw ?? "").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^@/, "").trim()).filter(Boolean);
  const valid = items.filter((s) => /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(s) || /^[a-z0-9.\-]+\.[a-z]{2,}$/.test(s));
  return [...new Set(valid)];
}

/** Convierte las cuentas configuradas por un negocio en bancos reconocibles por el lector. */
export function banksFromAccounts(
  accounts: { id: string; bankId: string; bankName: string; senderEmails: string | null; active: boolean; notifyEmail?: string | null }[],
): Bank[] {
  // Varias cuentas del mismo banco (p. ej. dos cuentas Pichincha) se combinan en un solo banco reconocible
  const merged = new Map<string, Bank>();
  for (const bank of accounts.filter((a) => a.active).map((a) => {
    const entries = parseSenderList(a.senderEmails);
    const senders = entries.filter((e) => e.includes("@"));
    const domains = entries.filter((e) => !e.includes("@"));
    const base = bankById(a.bankId);
    return {
      id: base?.id ?? `custom:${a.id}`,
      name: base?.name ?? a.bankName,
      // Una dirección exacta también habilita la verificación DKIM de su dominio
      domains: [...new Set([...(base?.domains ?? []), ...domains, ...senders.map((e) => e.split("@")[1])])],
      senders,
      mailboxes: a.notifyEmail ? [a.notifyEmail.toLowerCase().trim()] : [],
    } as Bank;
  })) {
    const prev = merged.get(bank.id);
    if (!prev) { merged.set(bank.id, bank); continue; }
    prev.domains = [...new Set([...prev.domains, ...bank.domains])];
    prev.senders = [...new Set([...(prev.senders ?? []), ...(bank.senders ?? [])])];
    // Si alguna cuenta de ese banco no indica correo, no se puede exigir uno
    prev.mailboxes = prev.mailboxes?.length && bank.mailboxes?.length ? [...new Set([...prev.mailboxes, ...bank.mailboxes])] : [];
  }
  return [...merged.values()];
}
