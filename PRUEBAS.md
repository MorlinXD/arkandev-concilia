# Pruebas · Módulo 1

## 1. Pruebas automáticas

Antes de correrlas: MySQL encendido (`docker compose up -d`) y tablas creadas (`npm run db:push`).

| Comando | Qué prueba | ¿Necesita la app corriendo? |
|---|---|---|
| `npm test` | Lector de correos + conciliación + correo→venta (89 pruebas) | No |
| `npm run test:e2e` | API de punta a punta (25 pruebas) | Sí: `npm run dev` en otra terminal |
| `npm run test:all` | Todas | Sí |

> Las pruebas crean usuarios y negocios de prueba en tu base. Para no ensuciar tu base de desarrollo,
> crea una base `concilia_test`, agrega `TEST_DATABASE_URL=mysql://concilia:concilia@127.0.0.1:3306/concilia_test`
> al `.env` y corre `npx drizzle-kit push` apuntando a ella.
> Para el e2e, la app también tendría que usar esa base.

### Qué cubren

**Conciliación (`tests/reconcile.test.ts`)**
- Código + monto → aprobada (sin importar mayúsculas)
- Una venta con el mismo monto pero sin código → por revisar
- Varias ventas con el mismo monto y sin código → huérfana (no adivina)
- Varias ventas con el mismo monto: el código elige la correcta
- Código correcto con monto distinto → no aprueba
- Venta expirada → no aprueba
- Una venta no se aprueba dos veces
- No cruza ventas de otro negocio
- Alias desconocido → rechazado
- Mismo correo dos veces → duplicado
- Dos transferencias simultáneas → solo una aprueba
- Códigos `V-0000` únicos por negocio

**API (`tests/api.e2e.test.ts`)**
- Registro: contraseña corta, correo repetido, login incorrecto
- Redirecciones: sin sesión → `/login`; sin negocio → `/onboarding`
- Onboarding: no permite un segundo negocio; valida el nombre
- Ventas: redondeo, montos inválidos (0, negativo, texto, exceso), acceso sin sesión
- `/api/ingest`: sin clave, clave incorrecta, datos inválidos, flujo completo, duplicado
- Revisión manual: aprobar, descartar, acción inválida
- Aislamiento: otro negocio no ve tus datos ni puede aprobar tus ventas

## 2. Pruebas manuales de la interfaz

Marca cada una al probarla en http://localhost:3000.

### Registro e inicio de sesión
- [ ] Crear una cuenta nueva → lleva a "Registra tu negocio"
- [ ] Con una contraseña de menos de 8 caracteres, el formulario no deja enviar
- [ ] Con un correo ya registrado, aparece un mensaje de error
- [ ] Cerrar sesión (icono arriba a la derecha) → vuelve a `/login`
- [ ] Iniciar sesión otra vez → entra directo al panel
- [ ] Con la sesión abierta, entrar a `/login` → redirige al panel

### Negocio
- [ ] Registrar el negocio → abre el panel con el nombre arriba a la derecha
- [ ] La tarjeta "Correo de reenvío" muestra una dirección única

### Ventas
- [ ] Crear una venta de 25.50 → aparece el código grande y el botón de copiar funciona
- [ ] La venta aparece en la lista como "Esperando pago"
- [ ] El contador "Esperando pago" sube

### Conciliación (simulador)
- [ ] Simular 25.50 con el concepto `pago V-XXXX` → en 3 s o menos: aviso verde, sonido y estado "Aprobada"
- [ ] Los contadores "Aprobadas hoy" y "Cobrado hoy" se actualizan
- [ ] La transferencia aparece en la tabla como "Conciliada"
- [ ] Venta de 10 + simular 10 sin código → "Por revisar", con los botones Aprobar y Descartar
- [ ] Pulsar **Aprobar** → pasa a Aprobada
- [ ] Repetir y pulsar **Descartar** → la venta vuelve a "Esperando pago" y la transferencia queda "Sin venta"
- [ ] Simular un monto sin venta (99) → "Sin venta" en la tabla de transferencias

### Tiempo real y varias pestañas
- [ ] Abrir el panel en dos pestañas; simular en una → la otra se actualiza sola
- [ ] Apagar la app (Ctrl+C en `npm run dev`) → el indicador cambia a "Sin conexión"; al encenderla vuelve a "En línea"

### Aislamiento (con dos navegadores o una ventana de incógnito)
- [ ] Crear una segunda cuenta con otro negocio → no ve ventas ni transferencias del primero

### Diseño
- [ ] Se ve bien en el celular (F12 → icono de dispositivo móvil)
- [ ] Sin errores rojos en la consola del navegador (salvo `favicon.ico`)

## 3. Módulo 2: correos bancarios (manual)

Con `npm run dev` corriendo, el alias copiado del panel y una venta creada:

- [ ] `npm run db:migrate` → "Base de datos al día"
- [ ] Crea una venta de **25.50** y anota su código. Edita `tests/fixtures/pichincha.eml`, cambia `V-1001` por tu código y envíalo:
      `npm run email:send -- tests/fixtures/pichincha.eml TU_ALIAS` → la venta se aprueba y aparece en "Correos recibidos" como **Leído**
- [ ] `debito.eml` → "Ignorado · Dinero saliente"
- [ ] `publicidad.eml` → "Ignorado · No contiene un monto"
- [ ] `pacifico-sin-dkim.eml` (con una venta de 18 y su código) → queda **Por revisar**, no se aprueba sola
- [ ] `gmail-confirmacion.eml` → aparece el aviso amarillo "Confirmar reenvío" en la tarjeta del correo
- [ ] Enviar el mismo `.eml` dos veces seguidas sin cambiar el Message-ID → el script lo cambia solo; para probar duplicados usa `curl` con el mismo archivo
- [ ] **Con un correo real** de tu banco (descargado como .eml) → revisa que monto, ordenante y concepto salgan bien

## 4. Multibanco (manual)

- [ ] `npm run db:migrate` → "✓ aplicada 003_bancos.sql"
- [ ] En el menú superior, **Bancos** → aparece la guía "Cómo conectar un banco" con tu dirección de reenvío y el botón para copiarla
- [ ] Agregar **Banco Pichincha** con alias y últimos 4 → aparece la tarjeta con `*@pichincha.com`, estado "Activa" y "Aún no llega ningún correo"
- [ ] Intentar agregar la misma cuenta otra vez → "Esa cuenta ya está registrada"
- [ ] Elegir **Otro banco o cooperativa** sin remitente → no deja guardar; con nombre y correo → se crea
- [ ] Enviar `pichincha.eml` (con un código de venta real) → la venta se aprueba y la tarjeta de Pichincha muestra "1 transferencias · última hace un momento"
- [ ] Con solo Pichincha registrado, enviar `guayaquil.eml` (venta de 1250 con su código) → queda **Por revisar**, no se aprueba sola
- [ ] Registrar la cooperativa `Cooperativa Mushuc Runa` con remitente `avisos@mushucruna.fin.ec`, crear una venta de 75 y enviar `cooperativa.eml` con su código → **Aprobada**
- [ ] **Pausar** una cuenta → la tarjeta se atenúa; **editar remitentes** (lápiz) → se guardan en minúsculas; **eliminar** → pide confirmar "¿Eliminar? Sí / No"
- [ ] Ver en el celular (F12 → modo móvil) que las tarjetas se acomodan bien

### Correo de recepción por cuenta
- [ ] `npm run db:migrate` → "✓ aplicada 004_correo_recepcion.sql"
- [ ] Agregar Pichincha con "Correo donde te llegan los avisos" = `negocio@gmail.com` → la tarjeta muestra *Banco Pichincha → negocio@gmail.com → tu-alias@in…*
- [ ] Enviar `pichincha.eml` con el código de una venta de 25.50 → **Aprobada** (el .eml va dirigido a `negocio@gmail.com`)
- [ ] Editar el correo de recepción (lápiz) a `otro@correo.com`, crear otra venta de 25.50 y enviar de nuevo → **Por revisar**, y en "Correos recibidos" aparece "Llegó a un correo distinto al registrado"
- [ ] Escribir un correo inválido al editar → muestra "Correo inválido"

## 5. Modo buzón (cómo se probará en producción)

> Ahora `email:send` acepta: `npm run email:send -- <archivo.eml> [V-1234] [tu@correo.com] [--sin-firma]`

- [ ] En **Bancos**, tu cuenta de Pichincha tiene como correo de avisos `jeanmorales102002@gmail.com`
- [ ] En el **Panel**, la tarjeta *Correo de reenvío* muestra `pagos@arkandevstudio.com` y "Avisos reconocidos desde: jeanmorales102002@gmail.com"
- [ ] Venta de 25.50 → `npm run email:send -- tests/fixtures/pichincha.eml V-XXXX jeanmorales102002@gmail.com` → **Aprobada**
- [ ] Lo mismo con `--sin-firma` (otra venta de 25.50) → **Por revisar** · "No se pudo verificar la firma DKIM del banco"
- [ ] Con un correo NO registrado (`otro@correo.com`) → **Ignorado** · "Ningún negocio tiene registrado este correo"
- [ ] Sin registrar ningún correo en Bancos → el Panel muestra el aviso amarillo para registrarlo
