-- Correo del negocio donde el banco envía los avisos (por cuenta)
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS notify_email varchar(255) NULL AFTER last_digits;
