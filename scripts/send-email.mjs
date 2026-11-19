// Simula la llegada de un correo a la app local (como lo haría el buzón o el Email Worker).
//
// Uso:  npm run email:send -- <archivo.eml> [V-1234] [tu@correo.com] [alias] [--sin-firma]
//   V-1234         reemplaza el código de venta del correo (no hace falta editar el .eml)
//   tu@correo.com  reemplaza el destinatario (To:) por tu correo registrado en Bancos
//   alias          (opcional) simula la dirección pagos+alias@ del modo Cloudflare
//   --sin-firma    envía el .eml de prueba sin firma DKIM (para ver que queda "por revisar")
//
// Los .eml de prueba se firman con una clave de DESARROLLO (la app solo la acepta fuera de producción).
// Un .eml REAL descargado de Gmail ya trae la firma del banco: se envía intacto.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth";
import "dotenv/config";

const args = process.argv.slice(2);
const file = args.find((a) => /\.eml$/i.test(a));
if (!file) {
  console.error("Uso: npm run email:send -- <archivo.eml> [V-1234] [tu@correo.com] [alias] [--sin-firma]");
  process.exit(1);
}
const code = args.find((a) => /^V-\d{4}$/i.test(a))?.toUpperCase();
const to = args.find((a) => a.includes("@") && !a.endsWith(".eml"));
const alias = args.find((a) => a !== file && a !== code && a !== to && !a.startsWith("--") && !/^V-\d{4}$/i.test(a));
const unsigned = args.includes("--sin-firma");

let eml = readFileSync(file, "utf8");
const alreadySigned = /^DKIM-Signature:/im.test(eml);

if (alreadySigned) {
  if (code || to) console.warn("⚠️  Este correo ya trae la firma real del banco: no se modifica (cambiarlo rompería la firma).");
} else {
  // Message-ID único para poder repetir la prueba sin que se marque como duplicado
  eml = eml.replace(/^Message-ID:.*$/im, `Message-ID: <${Date.now()}@test>`);
  if (code) eml = eml.replace(/V[\s\-_.]?\d{4}(?!\d)/g, code);
  if (to) eml = eml.replace(/^To:.*$/im, `To: ${to}`);

  if (!unsigned) {
    if (!existsSync(".dev-dkim/private.pem")) {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      mkdirSync(".dev-dkim", { recursive: true });
      writeFileSync(".dev-dkim/private.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
      writeFileSync(".dev-dkim/public.txt", publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    }
    const fromDomain = /^From:.*@([a-z0-9.\-]+)/im.exec(eml)?.[1];
    if (fromDomain) {
      const res = await dkimSign(eml, {
        headerList: "From:To:Cc:Subject:Date:Message-ID",
        signatureData: [{ signingDomain: fromDomain, selector: "concilia-dev", privateKey: readFileSync(".dev-dkim/private.pem") }],
      });
      eml = res.signatures + eml;
    }
  }
}

const headers = { "content-type": "message/rfc822", "x-ingest-secret": process.env.INGEST_SECRET ?? "" };
if (alias) {
  const domain = process.env.NEXT_PUBLIC_INBOUND_DOMAIN ?? "in.arkandevstudio.com";
  const prefix = process.env.NEXT_PUBLIC_INBOUND_PREFIX ?? "pagos";
  headers["x-inbound-to"] = `${prefix}+${alias}@${domain}`;
}

const res = await fetch((process.env.APP_URL ?? "http://localhost:3000") + "/api/inbound", { method: "POST", headers, body: eml });
console.log(res.status, JSON.stringify(await res.json(), null, 2));
