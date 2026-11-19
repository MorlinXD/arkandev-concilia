/**
 * Concilia · Email Worker (Cloudflare Email Routing)
 * Recibe cada correo enviado a *@in.tudominio.com y lo reenvía CRUDO a la app en Hostinger.
 * Si la app no responde tras 3 intentos, lo reenvía a un buzón de respaldo para no perderlo.
 */
export interface Env {
  APP_URL: string;            // ej. https://concilia.arkandevstudio.com
  INGEST_SECRET: string;      // wrangler secret put INGEST_SECRET
  FALLBACK_FORWARD?: string;  // buzón verificado en Email Routing, ej. respaldo@arkandevstudio.com
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const raw = await new Response(message.raw).text();

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${env.APP_URL}/api/inbound`, {
          method: "POST",
          headers: {
            "content-type": "message/rfc822",
            "x-ingest-secret": env.INGEST_SECRET,
            "x-inbound-to": message.to,
          },
          body: raw,
        });
        if (res.ok) return;
        if (res.status >= 400 && res.status < 500) {
          console.error(`Rechazado por la app (${res.status}): ${await res.text()}`);
          break; // error del cliente: reintentar no sirve
        }
      } catch (e) {
        console.error(`Intento ${attempt} falló`, e);
      }
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }

    if (env.FALLBACK_FORWARD) await message.forward(env.FALLBACK_FORWARD);
  },
};
