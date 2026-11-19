import { dkimVerify } from "mailauth";
import { existsSync, readFileSync } from "node:fs";
import { promises as dns } from "node:dns";

/**
 * Verificación DKIM CRIPTOGRÁFICA hecha por nosotros (no confiamos en cabeceras Authentication-Results,
 * que cualquiera puede escribir al enviar un correo a nuestro buzón).
 *
 * Gmail/Outlook conservan la firma DKIM original del banco al reenviar automáticamente,
 * así que podemos comprobar que el aviso fue emitido por el banco y no fue alterado.
 */

export type DkimResult = {
  /** Dominios cuya firma es válida, en minúsculas. */
  passDomains: string[];
  /** Cabeceras cubiertas por la firma de cada dominio válido (en minúsculas). */
  signedHeaders: Record<string, string[]>;
};

type Resolver = (name: string, rr: string) => Promise<unknown>;
let customResolver: Resolver | undefined;

/** Solo para pruebas: DNS falso con las claves públicas de prueba. */
export function setDkimResolver(r: Resolver | undefined) {
  customResolver = r;
}

/**
 * SOLO DESARROLLO: `npm run email:send` firma los .eml de prueba con una clave local
 * (selector "concilia-dev"). Fuera de producción, aceptamos esa clave para poder probar en tu PC.
 * En producción (NODE_ENV=production) esta rama no existe.
 */
const DEV_KEY_FILE = ".dev-dkim/public.txt";
function devResolver(): Resolver | undefined {
  if (process.env.NODE_ENV === "production" || !existsSync(DEV_KEY_FILE)) return undefined;
  const pub = readFileSync(DEV_KEY_FILE, "utf8").trim();
  return async (name, rr) => {
    if (rr === "TXT" && name.startsWith("concilia-dev._domainkey.")) return [[`v=DKIM1; k=rsa; p=${pub}`]];
    return dns.resolve(name, rr as "TXT");
  };
}

export async function verifyDkim(raw: string | Buffer): Promise<DkimResult> {
  const out: DkimResult = { passDomains: [], signedHeaders: {} };
  let res;
  try {
    const resolver = customResolver ?? devResolver();
    res = await dkimVerify(raw, resolver ? { resolver: resolver as never } : {});
  } catch {
    return out; // DNS caído o correo ilegible: se trata como no verificado
  }
  for (const r of res.results ?? []) {
    if (r.status?.result !== "pass" || !r.signingDomain) continue;
    // Una firma con l= (longitud limitada) permite añadir texto al final sin romperla: no la aceptamos
    if (r.canonBodyLengthLimited) continue;
    const domain = r.signingDomain.toLowerCase();
    const keys = String(r.signingHeaders?.keys ?? "")
      .split(":").map((k) => k.trim().toLowerCase()).filter(Boolean);
    out.passDomains.push(domain);
    out.signedHeaders[domain] = [...new Set([...(out.signedHeaders[domain] ?? []), ...keys])];
  }
  out.passDomains = [...new Set(out.passDomains)];
  return out;
}
