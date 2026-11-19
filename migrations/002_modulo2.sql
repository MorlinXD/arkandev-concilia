-- Módulo 2: lectura de correos bancarios
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS forwarding_confirmation varchar(600) NULL AFTER plan;

CREATE TABLE IF NOT EXISTS inbound_emails (
  id varchar(36) NOT NULL PRIMARY KEY,
  tenant_id varchar(36) NULL,
  recipient varchar(255) NOT NULL,
  from_address varchar(255) NULL,
  subject varchar(255) NULL,
  status enum('processed','ignored','failed','forwarding_confirmation') NOT NULL,
  detail varchar(500) NULL,
  transfer_id varchar(36) NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY inbound_tenant_created (tenant_id, created_at),
  CONSTRAINT inbound_emails_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
