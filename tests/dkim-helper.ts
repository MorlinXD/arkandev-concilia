/**
 * Firma DKIM de prueba: genera una clave RSA y un "DNS" falso que publica la clave pública
 * en s1._domainkey.<dominio> para CUALQUIER dominio firmado aquí.
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { dkimSign } from "mailauth";
import { setDkimResolver } from "@/lib/dkim";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_B64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

setDkimResolver(async (name: string, rr: string) => {
  if (rr === "TXT" && name.startsWith("s1._domainkey.")) return [[`v=DKIM1; k=rsa; p=${PUBLIC_B64}`]];
  const e = new Error(`queryTxt ENOTFOUND ${name}`) as Error & { code: string };
  e.code = "ENOTFOUND";
  throw e;
});

/** Firma un correo crudo como si lo enviara `domain` (cubre From, To, Cc, Subject, Date, Message-ID). */
export async function sign(raw: string, domain: string): Promise<string> {
  const res = await dkimSign(raw, {
    headerList: "From:To:Cc:Subject:Date:Message-ID",
    signatureData: [{ signingDomain: domain, selector: "s1", privateKey: PRIVATE }],
  });
  if (res.errors.length) throw new Error(JSON.stringify(res.errors));
  return res.signatures + raw;
}

/** Dominio con el que el BANCO firma cada fixture. Los que no están aquí llegan sin firma válida. */
export const SIGNED_BY: Record<string, string> = {
  pichincha: "pichincha.com",
  guayaquil: "bancoguayaquil.com",
  produbanco: "produbanco.com",
  deuna: "deuna.app",
  debito: "pichincha.com",
  publicidad: "pichincha.com",
  cooperativa: "mushucruna.fin.ec",
};

/** Lee un fixture, aplica cambios (antes de firmar) y lo firma si corresponde. */
export async function fixture(name: string, edit: (raw: string) => string = (r) => r): Promise<string> {
  const raw = edit(readFileSync(`tests/fixtures/${name}.eml`, "utf8"));
  return SIGNED_BY[name] ? sign(raw, SIGNED_BY[name]) : raw;
}
