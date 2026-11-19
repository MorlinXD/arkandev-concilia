/**
 * Dirección de reenvío de cada negocio.
 * Cloudflare Email Routing solo permite reglas "catch-all" en el dominio raíz, así que en el subdominio
 * usamos UNA dirección (p. ej. pagos@in.dominio.com) con subdirecciones: pagos+<alias>@in.dominio.com.
 */
export const INBOUND_DOMAIN = process.env.NEXT_PUBLIC_INBOUND_DOMAIN ?? "in.arkandevstudio.com";
export const INBOUND_PREFIX = process.env.NEXT_PUBLIC_INBOUND_PREFIX ?? "pagos";

/**
 * Modo de recepción:
 * - "mailbox" (por defecto): un solo buzón para todos (NEXT_PUBLIC_INBOUND_ADDRESS, p. ej. pagos@arkandevstudio.com).
 *   El negocio se identifica por el correo registrado en Bancos.
 * - "worker": Cloudflare Email Worker con subdirecciones pagos+<alias>@in.dominio.com.
 */
export const INBOUND_MODE = (process.env.NEXT_PUBLIC_INBOUND_MODE ?? "mailbox") as "mailbox" | "worker";
export const INBOUND_ADDRESS = process.env.NEXT_PUBLIC_INBOUND_ADDRESS ?? "pagos@arkandevstudio.com";

export const inboundAddressFor = (alias: string) =>
  INBOUND_MODE === "worker" ? `${INBOUND_PREFIX}+${alias}@${INBOUND_DOMAIN}` : INBOUND_ADDRESS;

/** "pagos+abc123@in.x.com" → "abc123". También acepta el formato antiguo "abc123@in.x.com". */
export function aliasFromRecipient(recipient: string): string {
  const local = recipient.trim().toLowerCase().replace(/^<|>$/g, "").split("@")[0] ?? "";
  const plus = local.indexOf("+");
  return plus >= 0 ? local.slice(plus + 1) : local;
}
