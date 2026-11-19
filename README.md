# Concilia · by Arkandev

Verificación automática de transferencias bancarias para negocios (SaaS).
Arquitectura **costo cero**: todo corre en Hostinger (Next.js + MySQL). Cloudflare se usa solo para recibir los correos del banco (gratis).

```
Banco ──correo──▶ correo del negocio ──reenvío──▶ Cloudflare Email Worker
                                                    │ POST /api/ingest (x-ingest-secret)
                                                    ▼
                         Hostinger: Next.js (panel + API) ──▶ MySQL
```

## Módulo 1 — Entorno local ✅

- Login y registro (Better Auth, correo y contraseña)
- Alta de negocio; varios negocios en la misma base, aislados por `tenant_id`
- Ventas con código único `V-1234`, válidas 24 h
- Conciliación en una transacción: exacta → **aprobada**, mismo monto sin código → **por revisar**, sin venta → **huérfana**, correo repetido → **ignorado**
- `/api/ingest` protegido con clave compartida (lo usará el Email Worker)
- Panel que se actualiza cada 3 s, con aviso y sonido al aprobar
- Simulador de banco (solo en `npm run dev`)

### Requisitos
- Node.js 20 o superior
- MySQL 8: con `docker compose up -d`, XAMPP, Laragon o un MySQL instalado

### Arranque
```bash
npm install
docker compose up -d      # o usa tu MySQL y ajusta DATABASE_URL
cp .env.example .env      # cambia BETTER_AUTH_SECRET e INGEST_SECRET
npm run db:push           # crea las tablas base
npm run db:migrate        # aplica migraciones adicionales (módulo 2 en adelante)
npm run dev               # http://localhost:3000
```

### Prueba
1. Regístrate en `/login` y registra tu negocio.
2. **Nueva venta** de 25.50 → te da un código, por ejemplo `V-4821`.
3. **Simulador**: 25.50 con el concepto `pago V-4821` → se aprueba sola, con aviso.
4. Mismo monto sin código → **Por revisar** (Aprobar / Descartar). Monto sin venta → **Sin venta**.

Probar la entrada real del Worker:
```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" -H "x-ingest-secret: TU_INGEST_SECRET" \
  -d '{"alias":"ALIAS_DEL_PANEL","bank":"Banco Pichincha","amount":25.5,"memo":"pago V-4821","rawHash":"correo-0001"}'
```

### Comandos
| Comando | Qué hace |
|---|---|
| `npm run db:push` | Sincroniza el esquema con MySQL |
| `npm run db:studio` | Explorador visual de la base |

### Estructura
```
src/db/schema.ts          tablas (Better Auth + negocio)
src/lib/reconcile.ts      motor de conciliación
src/lib/context.ts        sesión + negocio (toda consulta filtra por tenant)
src/app/api/              auth, tenant, sales, feed, ingest, dev/simulate
src/components/           Dashboard, Logo
```

> **Seguridad sin RLS:** MySQL no aísla negocios por sí solo. Toda consulta nueva debe filtrar por `ctx.tenant.id` (ver `getContext()`).

## Módulo 2 — Lectura de correos bancarios ✅

```
Correo del banco ─▶ Cloudflare Email Worker ─▶ POST /api/inbound (correo crudo)
                                                │
                    src/lib/inbound.ts ─────────┤ identifica el negocio por el alias
                    src/parsers/ ───────────────┤ banco, monto, concepto, ordenante, referencia
                                                │ verificación DKIM + dirección (entra/sale)
                    src/lib/reconcile.ts ───────┘ aprueba / revisión / sin venta
```

**Bancos incluidos** (`src/parsers/banks.ts`): Pichincha, Guayaquil, Produbanco, Pacífico, Bolivariano,
Internacional, Austro, BGR, Machala, Loja, Solidario, Diners, D-Miro, JEP, Jardín Azuayo,
CPN, 29 de Octubre y Deuna.

**Cómo lee:** no usa plantillas fijas por banco. Busca etiquetas comunes (*Monto / Valor / Importe*,
*Concepto / Descripción / Motivo*, *Ordenante / Remitente*, *Comprobante / Referencia*), en texto o en tablas HTML,
entiende `1.234,56` y `1,234.56`, y encuentra el código de venta aunque el banco lo escriba `V1234` o `V 1234`.

**Reglas de seguridad:**
| Situación | Resultado |
|---|---|
| Banco conocido + firma DKIM válida + dinero entrante + código y monto | ✅ Aprobada sola |
| Falta cualquiera de esas garantías (sin DKIM, reenvío manual "Fwd:", remitente desconocido) | ⚠️ Como máximo, **por revisar** |
| Dinero que SALE (débito, compra, transferencia enviada) | Ignorado |
| Correo sin monto (publicidad) | Ignorado |
| Confirmación de reenvío de Gmail/Outlook | Se muestra en el panel con el enlace para confirmar |

Todo correo queda en **"Correos recibidos"** del panel, con el motivo si se ignoró.

### Probar con correos en local
```bash
npm run db:migrate                                              # crea las tablas nuevas
npm run dev
npm run email:send -- tests/fixtures/pichincha.eml TU_ALIAS     # el alias está en el panel
```
Los `.eml` de `tests/fixtures/` son **sintéticos**. Para probar con uno real: en Gmail, abre la notificación
→ ⋮ → *Descargar mensaje*, y envíalo igual. El código de venta del concepto debe existir en tu panel.

### Agregar o afinar un banco
1. Si el remitente no se reconoce, en "Correos recibidos" verás su dirección exacta → agrega el dominio en `src/parsers/banks.ts`.
2. Si no encuentra el monto o el concepto → agrega la etiqueta que usa ese banco en `LABELS` (`src/parsers/extract.ts`).
3. Guarda el correo anonimizado en `tests/fixtures/` y agrega una prueba en `tests/parsers.test.ts`.

### Desplegar el Worker (cuando publiquemos)
```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put INGEST_SECRET     # el mismo valor que en el .env de la app
npm run deploy
```
Luego sigue `DESPLIEGUE.md`: subdominio `in` con *subaddressing* y una regla `pagos@in.tudominio.com` → Worker. Cada negocio recibe en `pagos+<alias>@in.tudominio.com`.

## Módulo 3a — Multibanco ✅

Página **Bancos** (`/bancos`): cada negocio registra sus cuentas (banco, alias, últimos 4 dígitos) y,
si hace falta, las direcciones exactas desde las que su banco envía los avisos.

- **Bancos del registro**: ya se reconocen por dominio; el remitente extra es opcional.
- **Otro banco o cooperativa**: se registra con su nombre y su correo de avisos. Así se soporta cualquier entidad sin tocar código.
- **Modo seguro**: si el negocio registró al menos un banco, los correos de bancos que no estén en su lista nunca se aprueban solos.
- Cada cuenta muestra su **actividad** (transferencias y último aviso) para comprobar que el reenvío funciona.
- Se puede **pausar**, editar los remitentes o eliminar cada cuenta.
- **Correo de recepción por cuenta**: el correo del negocio donde ese banco envía los avisos (p. ej. Pichincha → `ventas@negocio.com`,
  Guayaquil → `dueno@gmail.com`). Cada tarjeta muestra la ruta *Banco → correo del negocio → Concilia*. Si un aviso llega por un
  correo distinto al registrado (se revisa `To`, `Delivered-To` y `X-Forwarded-For`), no se aprueba solo.

```bash
npm run db:migrate   # crea bank_accounts y agrega notify_email
```

## Recepción por buzón (producción, solo Hostinger) ✅

- Un único buzón, `pagos@arkandevstudio.com`, en el correo de Hostinger. La app se queda conectada por **IMAP IDLE**
  (`src/lib/mailbox.ts`, arranca solo con `npm start` vía `src/instrumentation.ts`) y procesa cada aviso en ~1 s.
- **Negocio:** se identifica por el *correo donde llegan los avisos* registrado en Bancos.
- **Autenticidad:** verificación **DKIM criptográfica propia** (`src/lib/dkim.ts`, librería `mailauth`). Las cabeceras
  `Authentication-Results` ya no se usan (cualquiera puede escribirlas).
- **Anti-suplantación:** solo cuentan los destinatarios que el banco **firmó**; reenviar tu propio aviso real fingiendo ser
  otro negocio no aprueba nada (hay una prueba para ese ataque).
- Respaldo: `POST /api/mailbox/poll` (con `x-ingest-secret`) para un Cron Job.

Probar en local sin buzón real:
```bash
npm run email:send -- tests/fixtures/pichincha.eml V-1234 tu@correo.com
```
(`V-1234` = código de tu venta; `tu@correo.com` = el correo que registraste en Bancos. Los .eml de prueba se firman con
una clave de desarrollo que la app solo acepta fuera de producción. Un .eml real de Gmail se envía intacto con su firma real.)

## Pruebas
| Comando | Qué prueba |
|---|---|
| `npm test` | Lector, DKIM, multibanco, modo buzón, ataques, conciliación (105 pruebas, sin servidor) |
| `npm run test:e2e` | API completa (36 pruebas; requiere `npm run dev`) |
| `tests/mailbox.imap.test.ts` | Buzón IMAP real (opcional: define `IMAP_TEST_HOST`, `IMAP_TEST_USER`, `IMAP_TEST_PASS`) |

## Próximos módulos
3. Onboarding guiado del reenvío + cuentas bancarias
4. Usuarios y roles, API pública y webhooks
5. Despliegue en Hostinger (Web app Node.js + MySQL)
