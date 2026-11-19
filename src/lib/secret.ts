import { timingSafeEqual } from "node:crypto";

/** Compara la cabecera x-ingest-secret con INGEST_SECRET en tiempo constante. */
export function hasIngestSecret(req: Request) {
  const given = Buffer.from(req.headers.get("x-ingest-secret") ?? "");
  const expected = Buffer.from(process.env.INGEST_SECRET ?? "");
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}
