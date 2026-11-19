import { ImapFlow } from "imapflow";
import { processInboundEmail } from "./inbound";

/**
 * Lector del buzón de recepción (p. ej. pagos@arkandevstudio.com en el correo de Hostinger).
 *
 * - Se queda conectado con IMAP IDLE: el servidor avisa al instante cuando llega un correo.
 * - Al conectar (y cada minuto, por si IDLE se corta) procesa todos los NO LEÍDOS.
 * - Cada correo procesado se marca como leído y se mueve a la carpeta "Procesados".
 * - Si la conexión se cae, reintenta con espera creciente.
 */

type Config = { host: string; port: number; user: string; pass: string };

export function mailboxConfig(): Config | null {
  const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return null;
  return { host: IMAP_HOST, port: Number(IMAP_PORT || 993), user: IMAP_USER, pass: IMAP_PASSWORD };
}

const PROCESSED_FOLDER = "Procesados";
const log = (...a: unknown[]) => console.log("[buzón]", ...a);

function client(cfg: Config) {
  return new ImapFlow({
    host: cfg.host, port: cfg.port, secure: cfg.port === 993,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Por defecto imapflow espera 15 s sin actividad antes de entrar en IDLE: en ese lapso
    // los avisos nuevos esperarían. Lo activamos casi de inmediato tras cada pasada.
    autoIdleDelay: 500,
  } as ConstructorParameters<typeof ImapFlow>[0]);
}

let draining = false;

/** Procesa todos los correos no leídos de INBOX. Devuelve cuántos procesó. */
export async function drainInbox(imap: ImapFlow): Promise<number> {
  if (draining) return 0;
  draining = true;
  let count = 0;
  const lock = await imap.getMailboxLock("INBOX");
  try {
    const uids = (await imap.search({ seen: false }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await imap.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      try {
        const outcome = await processInboundEmail(msg.source.toString("utf8"), null);
        log(`uid ${uid} →`, outcome.status, "detail" in outcome ? outcome.detail : "");
      } catch (e) {
        // Error inesperado: se deja NO leído para reintentar en la próxima pasada
        log(`uid ${uid} falló, se reintentará`, e);
        continue;
      }
      await imap.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      await imap.messageMove(String(uid), PROCESSED_FOLDER, { uid: true }).catch(() => undefined);
      count++;
    }
  } finally {
    lock.release();
    draining = false;
  }
  return count;
}

/** Conexión puntual: procesa lo pendiente y cierra (para un cron o una llamada manual). */
export async function pollMailboxOnce(): Promise<{ processed: number } | { error: string }> {
  const cfg = mailboxConfig();
  if (!cfg) return { error: "Buzón no configurado (IMAP_HOST, IMAP_USER, IMAP_PASSWORD)" };
  const imap = client(cfg);
  try {
    await imap.connect();
    await imap.mailboxCreate(PROCESSED_FOLDER).catch(() => undefined);
    const processed = await drainInbox(imap);
    await imap.logout();
    return { processed };
  } catch (e) {
    await imap.logout().catch(() => undefined);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const g = globalThis as unknown as { __mailboxListener?: boolean };

/** Escucha permanente con IMAP IDLE + reconexión. Se llama una vez al arrancar el servidor. */
export function startMailboxListener() {
  const cfg = mailboxConfig();
  if (!cfg || g.__mailboxListener) return;
  g.__mailboxListener = true;
  let backoff = 2000;

  const run = async () => {
    const imap = client(cfg);
    let sweep: ReturnType<typeof setInterval> | undefined;
    try {
      await imap.connect();
      backoff = 2000;
      log(`conectado a ${cfg.user}`);
      await imap.mailboxCreate(PROCESSED_FOLDER).catch(() => undefined);
      await imap.mailboxOpen("INBOX");
      imap.on("exists", () => { drainInbox(imap).catch((e) => log("error al procesar", e)); });
      await drainInbox(imap);
      // Red de seguridad: si IDLE deja de avisar, revisamos cada minuto
      sweep = setInterval(() => { drainInbox(imap).catch(() => undefined); }, 60_000);
      await new Promise<void>((resolve) => { imap.on("close", () => resolve()); imap.on("error", () => resolve()); });
    } catch (e) {
      log("error de conexión:", e instanceof Error ? e.message : e);
    } finally {
      if (sweep) clearInterval(sweep);
      await imap.logout().catch(() => undefined);
    }
    log(`reconectando en ${Math.round(backoff / 1000)} s`);
    setTimeout(run, backoff);
    backoff = Math.min(backoff * 2, 5 * 60_000);
  };

  run();
}
