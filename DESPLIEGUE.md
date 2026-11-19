# Despliegue de Concilia · by Arkandev (todo en Hostinger)

Sin Cloudflare y sin tocar el DNS: el dominio ya usa el correo de Hostinger.

```
Banco ─▶ correo del negocio ─(filtro de reenvío)─▶ pagos@arkandevstudio.com   (buzón de Hostinger)
                                                          │  IMAP IDLE: aviso inmediato
                                                          ▼
                              Hostinger: concilia.arkandevstudio.com (Next.js) ──▶ MySQL de Hostinger
```

**Cómo sabe de qué negocio es cada aviso:** por el *correo donde llegan los avisos* que el negocio registra en **Bancos**.
**Cómo sabe que el aviso es auténtico:** verifica la **firma DKIM del banco** (Gmail y Outlook la conservan al reenviar).
Solo se aprueba solo si el banco firmó el aviso **y** lo dirigió al correo registrado.

**Tiempo estimado:** 30–60 minutos.

---

## 1. Crear el buzón de recepción

hPanel → **Correos** → `arkandevstudio.com` → **Crear cuenta de correo**:

- Correo: `pagos@arkandevstudio.com`
- Contraseña fuerte (la usará la app). Anótala.
- En la configuración del buzón (o *Clientes de correo / Configuración manual*), anota el **servidor IMAP** y el **puerto**
  (normalmente `imap.hostinger.com`, puerto `993`, SSL).

> Usa este buzón **solo** para Concilia: la app marca como leídos los correos y los mueve a la carpeta `Procesados`.

## 2. Base de datos

hPanel → **Bases de datos → Gestión → Crear nueva base de datos MySQL**:

- Nombre: `concilia` (Hostinger antepone un prefijo, p. ej. `u123456789_concilia`).
- Usuario: `concilia` (máximo 14 caracteres; **no** uses un correo).
- Contraseña fuerte. Anota nombre, usuario, contraseña y host (normalmente `localhost`).

## 3. Variables de producción

Copia `.env.production.example` como `.env.production` y complétalo:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | `mysql://USUARIO:CONTRASEÑA@localhost:3306/BASE` (con los prefijos de Hostinger) |
| `BETTER_AUTH_SECRET` | Genera uno: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `BETTER_AUTH_URL` | `https://concilia.arkandevstudio.com` (exacta, sin `/` final) |
| `INGEST_SECRET` | Genera otro igual |
| `NEXT_PUBLIC_INBOUND_ADDRESS` | `pagos@arkandevstudio.com` |
| `IMAP_HOST` / `IMAP_PORT` | Los del paso 1 (`imap.hostinger.com` / `993`) |
| `IMAP_USER` / `IMAP_PASSWORD` | `pagos@arkandevstudio.com` y su contraseña |

## 4. Publicar la app

1. hPanel → **Websites → Add website → Node.js web app**.
2. Código: sube **`arkandev-concilia-hostinger.zip`** (o conecta un repositorio privado de GitHub).
3. Dominio: **subdominio** `concilia.arkandevstudio.com` (Hostinger lo crea en su propio DNS).
4. Compilación (Hostinger detecta Next.js):
   - Node **20 o 22** · Build: `npm run build` · Start: `npm start`
   - `npm start` **aplica las migraciones de la base de datos** y **se conecta al buzón** automáticamente.
5. **Environment variables → Import from .env file** → elige `.env.production` → revisa → **Confirm**.
6. **Deploy**.
7. Revisa **Logs** de la Web App. Deberías ver:
   ```
   ✓ aplicada 001_base.sql … 004_correo_recepcion.sql
   [buzón] conectado a pagos@arkandevstudio.com
   ```
8. ✅ Abre `https://concilia.arkandevstudio.com/login`, crea tu cuenta y tu negocio.

## 5. Respaldo con Cron (recomendado)

Si Hostinger reinicia la app, la conexión al buzón se reabre sola. Como red de seguridad adicional:

hPanel → **Avanzado → Cron Jobs** → cada **5 minutos**:
```
curl -s -X POST -H "x-ingest-secret: TU_INGEST_SECRET" https://concilia.arkandevstudio.com/api/mailbox/poll
```
(Procesa cualquier correo que haya quedado sin leer.)

## 6. Configurar tu negocio

1. **Bancos** → agrega tu banco con **Correo donde te llegan los avisos** = el correo donde el banco te notifica
   (p. ej. `jeanmorales102002@gmail.com`). **Sin este dato no podemos reconocer tus avisos.**
2. Botón **Ver tutorial** de la tarjeta:
   - Gmail → Configuración → **Reenvío y correo POP/IMAP** → **Añadir una dirección de reenvío** → `pagos@arkandevstudio.com`.
   - El código de confirmación de Gmail aparecerá en el **Panel** (tarjeta *Correo de reenvío*). Confírmalo.
   - Crea el **filtro** con el remitente del banco → *Reenviarlo a* `pagos@arkandevstudio.com`.

## 7. Prueba de punta a punta

1. En el **Panel**, crea una venta de **$1.00** y anota el código (p. ej. `V-4821`).
2. Haz una transferencia real de $1.00 a tu cuenta con `V-4821` en el concepto.
3. Cuando llegue el aviso del banco, Gmail lo reenvía a `pagos@` y la venta debe aprobarse sola en segundos. 🎉
4. Si queda *Por revisar*, mira **Correos recibidos** en el Panel: el detalle dice por qué
   (sin firma DKIM, correo no registrado, banco no registrado…).

---

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| En Logs no aparece `[buzón] conectado` | Faltan o están mal las variables `IMAP_*` | Revisa host, puerto, usuario (correo completo) y contraseña |
| `[buzón] error de conexión` repetido | Contraseña incorrecta o IMAP bloqueado | Prueba entrar al webmail con esa contraseña; reintenta cada pocos minutos solo |
| El aviso queda *Por revisar* con "No se pudo verificar la firma DKIM" | El banco no firma sus correos o el reenvío la alteró | Usa reenvío **automático** (filtro), no "Reenviar" manual. Si el banco no firma, siempre quedará en revisión |
| "Ningún negocio tiene registrado este correo" | El correo del negocio no está en Bancos | Regístralo en **Bancos → Correo donde te llegan los avisos** |
| "Invalid origin" al iniciar sesión | `BETTER_AUTH_URL` no coincide | Debe ser exactamente `https://concilia.arkandevstudio.com` |
| Error de base de datos al arrancar | `DATABASE_URL` mal escrita | Revisa usuario, contraseña (caracteres especiales codificados), host y nombre con prefijo |

---

## Anexo: alternativa con Cloudflare (opcional, no necesaria)

El proyecto incluye `worker/` (Cloudflare Email Worker) para recibir en `pagos+<alias>@in.tudominio.com`.
Requiere que el DNS del dominio esté en Cloudflare. Para usarla: `NEXT_PUBLIC_INBOUND_MODE=worker`,
subdominio `in` con *subaddressing* en Email Routing, regla `pagos@in.tudominio.com` → Worker, y
`npx wrangler secret put INGEST_SECRET` + `npm run deploy` dentro de `worker/`.
