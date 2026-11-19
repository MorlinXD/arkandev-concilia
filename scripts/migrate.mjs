// Aplica migrations/*.sql en orden y recuerda cuáles ya se aplicaron (tabla _migrations).
// Uso: npm run db:migrate
import { readdirSync, readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
await conn.query("CREATE TABLE IF NOT EXISTS _migrations (name varchar(255) PRIMARY KEY, applied_at timestamp DEFAULT CURRENT_TIMESTAMP)");
const [done] = await conn.query("SELECT name FROM _migrations");
const applied = new Set(done.map((r) => r.name));

for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  const sql = readFileSync(`migrations/${file}`, "utf8");
  const statements = sql
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
    .split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    // MySQL 8 no soporta "ADD COLUMN IF NOT EXISTS": se intenta y se ignora si ya existe.
    try { await conn.query(stmt.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN")); }
    catch (e) { if (!["ER_DUP_FIELDNAME", "ER_TABLE_EXISTS_ERROR", "ER_DUP_KEYNAME"].includes(e.code)) throw e; }
  }
  await conn.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
  console.log("✓ aplicada", file);
}
console.log("Base de datos al día.");
await conn.end();
