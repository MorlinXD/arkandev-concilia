-- Módulo 3a: cuentas bancarias por negocio (soporte multibanco)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NOT NULL,
  bank_id varchar(40) NOT NULL,
  bank_name varchar(80) NOT NULL,
  alias varchar(80) NULL,
  last_digits varchar(4) NULL,
  sender_emails varchar(500) NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY bank_accounts_tenant (tenant_id),
  CONSTRAINT bank_accounts_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
