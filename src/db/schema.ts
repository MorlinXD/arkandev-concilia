import {
  mysqlTable, varchar, text, timestamp, boolean, decimal, mysqlEnum, uniqueIndex, index, primaryKey,
} from "drizzle-orm/mysql-core";

const id = () => varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at").notNull().defaultNow();

/* ── Better Auth (login) ───────────────────────────────── */
export const user = mysqlTable("user", {
  id: varchar("id", { length: 36 }).primaryKey(),
  name: text("name").notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = mysqlTable("session", {
  id: varchar("id", { length: 36 }).primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = mysqlTable("account", {
  id: varchar("id", { length: 36 }).primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = mysqlTable("verification", {
  id: varchar("id", { length: 36 }).primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ── Negocio ───────────────────────────────────────────── */
export const tenants = mysqlTable("tenants", {
  id: id(),
  name: varchar("name", { length: 160 }).notNull(),
  // alias de reenvío: <alias>@in.tudominio.com
  inboundAlias: varchar("inbound_alias", { length: 32 }).notNull().unique(),
  plan: varchar("plan", { length: 20 }).notNull().default("trial"),
  // Último enlace/código de confirmación de reenvío (Gmail/Outlook) recibido
  forwardingConfirmation: varchar("forwarding_confirmation", { length: 600 }),
  createdAt: createdAt(),
});

export const memberships = mysqlTable("memberships", {
  tenantId: varchar("tenant_id", { length: 36 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
  role: mysqlEnum("role", ["owner", "cashier", "accountant"]).notNull().default("owner"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]);

export const sales = mysqlTable("sales", {
  id: id(),
  tenantId: varchar("tenant_id", { length: 36 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 12 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  description: varchar("description", { length: 255 }),
  customerName: varchar("customer_name", { length: 160 }),
  status: mysqlEnum("status", ["pending", "approved", "review", "expired", "cancelled"]).notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  approvedAt: timestamp("approved_at"),
  createdBy: varchar("created_by", { length: 36 }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("sales_tenant_code").on(t.tenantId, t.code),
  index("sales_tenant_status_amount").on(t.tenantId, t.status, t.amount),
]);

export const transfers = mysqlTable("transfers", {
  id: id(),
  tenantId: varchar("tenant_id", { length: 36 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bank: varchar("bank", { length: 60 }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  reference: varchar("reference", { length: 80 }),
  senderName: varchar("sender_name", { length: 160 }),
  memo: varchar("memo", { length: 255 }),
  receivedAt: timestamp("received_at").notNull(),
  rawHash: varchar("raw_hash", { length: 64 }).notNull(), // deduplicación: un correo = una transferencia
  status: mysqlEnum("status", ["unmatched", "matched", "review"]).notNull().default("unmatched"),
  saleId: varchar("sale_id", { length: 36 }).references(() => sales.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("transfers_tenant_hash").on(t.tenantId, t.rawHash),
  index("transfers_tenant_received").on(t.tenantId, t.receivedAt),
]);

/* ── Bitácora de correos recibidos (diagnóstico y para agregar bancos nuevos) ── */
export const inboundEmails = mysqlTable("inbound_emails", {
  id: id(),
  tenantId: varchar("tenant_id", { length: 36 }).references(() => tenants.id, { onDelete: "cascade" }),
  recipient: varchar("recipient", { length: 255 }).notNull(),
  fromAddress: varchar("from_address", { length: 255 }),
  subject: varchar("subject", { length: 255 }),
  status: mysqlEnum("status", ["processed", "ignored", "failed", "forwarding_confirmation"]).notNull(),
  detail: varchar("detail", { length: 500 }),
  transferId: varchar("transfer_id", { length: 36 }),
  createdAt: createdAt(),
}, (t) => [index("inbound_tenant_created").on(t.tenantId, t.createdAt)]);

/* ── Cuentas bancarias del negocio (multibanco) ─────────── */
export const bankAccounts = mysqlTable("bank_accounts", {
  id: id(),
  tenantId: varchar("tenant_id", { length: 36 }).notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bankId: varchar("bank_id", { length: 40 }).notNull(),        // id del registro (src/parsers/banks.ts) o "custom"
  bankName: varchar("bank_name", { length: 80 }).notNull(),
  alias: varchar("alias", { length: 80 }),                      // ej. "Cuenta corriente principal"
  lastDigits: varchar("last_digits", { length: 4 }),
  // Correo DEL NEGOCIO donde este banco envía los avisos (desde ahí se reenvían a Concilia)
  notifyEmail: varchar("notify_email", { length: 255 }),
  // Remitentes de las notificaciones, separados por coma: direcciones exactas o dominios
  senderEmails: varchar("sender_emails", { length: 500 }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("bank_accounts_tenant").on(t.tenantId)]);
