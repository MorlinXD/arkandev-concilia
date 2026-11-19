/** Next.js ejecuta register() una vez al arrancar el servidor. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.MAILBOX_LISTENER === "off") return;
    const { startMailboxListener, mailboxConfig } = await import("./lib/mailbox");
    if (mailboxConfig()) startMailboxListener();
  }
}
