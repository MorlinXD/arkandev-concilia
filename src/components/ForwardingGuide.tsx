"use client";
import { useEffect, useState } from "react";
import { X, Copy, Check, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

export type GuideTarget = {
  bankName: string;
  /** Dominios o direcciones desde los que escribe el banco */
  senders: string[];
  /** Correo del negocio donde llegan los avisos */
  mailbox: string | null;
  /** Dirección de Concilia a la que se reenvía */
  inboundAddress: string;
};

type Provider = "gmail" | "outlook" | "otro";

function guessProvider(mailbox: string | null): Provider {
  const d = mailbox?.split("@")[1]?.toLowerCase() ?? "";
  if (d === "gmail.com" || d === "googlemail.com") return "gmail";
  if (/(outlook|hotmail|live|msn)\./.test(d)) return "outlook";
  return mailbox ? "otro" : "gmail";
}

/** "@pichincha.com" o "a@b.com" → valor para el campo "De" de Gmail */
const gmailFrom = (senders: string[]) =>
  senders.length === 0 ? "" : senders.map((s) => (s.includes("@") ? s : `@${s}`)).join(" OR ");

export function ForwardingGuide({ target, onClose }: { target: GuideTarget; onClose: () => void }) {
  const [tab, setTab] = useState<Provider>(guessProvider(target.mailbox));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  const from = gmailFrom(target.senders);
  const firstSender = target.senders[0] ? (target.senders[0].includes("@") ? target.senders[0] : `@${target.senders[0]}`) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="card my-8 w-full max-w-2xl !bg-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 border-b border-line p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-brand-soft">Tutorial de reenvío</p>
            <h2 className="mt-1 text-lg font-semibold">Conecta {target.bankName} con Concilia</h2>
            <p className="mt-1 text-sm text-muted">
              Los avisos llegan a <b className="text-white">{target.mailbox ?? "tu correo"}</b> y se reenvían automáticamente a Concilia.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2.5 !py-1.5" aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>

        {/* Datos para copiar */}
        <div className="grid gap-3 border-b border-line p-5 sm:grid-cols-2">
          <CopyField label="Remitente del banco (campo «De»)" value={from || "Ábrelo desde la tarjeta de tu banco para verlo"} copyable={!!from} />
          <CopyField label="Reenviar a (tu dirección de Concilia)" value={target.inboundAddress} copyable />
        </div>

        {/* Pestañas */}
        <div className="flex gap-1 border-b border-line px-5 pt-4">
          {([["gmail", "Gmail"], ["outlook", "Outlook / Hotmail"], ["otro", "Otro correo"]] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
                tab === id ? "border-brand font-medium text-white" : "border-transparent text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-6 p-5">
          <Step n={0} title="Antes de empezar: activa los avisos en tu banco">
            En la app o banca web de {target.bankName}, entra a <i>Configuración → Notificaciones / Alertas</i> y activa el aviso
            por <b>correo</b> de <b>transferencias recibidas</b> (créditos a tu cuenta), dirigido a <Code>{target.mailbox ?? "tu correo"}</Code>.
            Revisa que ya te llegue al menos uno.
          </Step>

          {tab === "gmail" && <GmailSteps from={from} inbound={target.inboundAddress} />}
          {tab === "outlook" && <OutlookSteps sender={firstSender} inbound={target.inboundAddress} />}
          {tab === "otro" && <OtherSteps sender={firstSender} inbound={target.inboundAddress} />}

          <Step n={tab === "gmail" ? 3 : 2} title="Comprueba que funciona" icon={<CheckCircle2 className="h-4 w-4" />}>
            Crea en el <b>Panel</b> una venta de <b>$1.00</b> y pide una transferencia de prueba con el código en el concepto.
            En segundos la venta debe aprobarse y esta tarjeta mostrará <i>«1 transferencias · última hace un momento»</i>.
            Si no llega, revisa <b>Correos recibidos</b> en el Panel: ahí verás qué pasó con cada aviso.
          </Step>
        </div>

        <div className="flex justify-end border-t border-line p-4">
          <button onClick={onClose} className="btn">Entendido</button>
        </div>
      </div>
    </div>
  );
}

/* ── Gmail ─────────────────────────────────────────────── */

function GmailSteps({ from, inbound }: { from: string; inbound: string }) {
  return (
    <>
      <Step n={1} title="Autoriza tu dirección de Concilia (solo la primera vez)">
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>En Gmail, pulsa ⚙️ <b>Configuración</b> → <b>Ver toda la configuración</b>.</li>
          <li>Abre la pestaña <b>Reenvío y correo POP/IMAP</b> → <b>Añadir una dirección de reenvío</b>.</li>
          <li>Pega <Code>{inbound}</Code> → <b>Siguiente</b> → <b>Continuar</b> → <b>Aceptar</b>.</li>
          <li>
            Gmail envía un código de confirmación a Concilia. Ve al <b>Panel</b>: en la tarjeta <i>Correo de reenvío</i> aparecerá un
            aviso amarillo con el enlace <b>Confirmar reenvío</b> y el código. Ábrelo (o pega el código en Gmail).
          </li>
        </ol>
        <Note tone="warn">
          En esa misma pantalla deja marcado <b>«Inhabilitar el reenvío»</b>. No queremos reenviar todo tu correo, solo los avisos del
          banco; eso lo hace el filtro del siguiente paso.
        </Note>
      </Step>

      <Step n={2} title="Crea el filtro que reenvía solo los avisos del banco">
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>En la barra de búsqueda de Gmail, pulsa el icono de opciones (a la derecha) para abrir el buscador avanzado.</li>
          <li>En <b>De</b>, pega <Code>{from || "el remitente del banco"}</Code>.</li>
          <li>
            En <b>Asunto</b> (recomendado), escribe una palabra que solo tengan los avisos de transferencias <i>recibidas</i>,
            copiándola de un aviso real (p. ej. <Code>recibiste</Code>). Así no se reenvía publicidad ni avisos de compras.
          </li>
          <li>Pulsa <b>Buscar</b> y verifica que solo aparezcan avisos de transferencias recibidas.</li>
          <li>Vuelve a abrir las opciones y pulsa <b>Crear filtro</b>.</li>
          <li>Marca <b>Reenviarlo a:</b> y elige <Code>{inbound}</Code>.</li>
          <li><b>No</b> marques «Aplicar también a las conversaciones que coincidan», para no reenviar avisos antiguos.</li>
          <li>Pulsa <b>Crear filtro</b>. ✅</li>
        </ol>
        <Note>
          Si la opción <b>Reenviarlo a</b> no aparece o está gris, falta completar el paso 1 (confirmar la dirección).
        </Note>
      </Step>
    </>
  );
}

/* ── Outlook ───────────────────────────────────────────── */

function OutlookSteps({ sender, inbound }: { sender: string; inbound: string }) {
  return (
    <Step n={1} title="Crea una regla de reenvío en Outlook">
      <ol className="ml-4 list-decimal space-y-1.5">
        <li>En Outlook (web), pulsa ⚙️ <b>Configuración</b> → <b>Correo</b> → <b>Reglas</b> → <b>Agregar nueva regla</b>.</li>
        <li>Nombre: <Code>Concilia - avisos del banco</Code>.</li>
        <li>Condición: <b>De</b> → escribe <Code>{sender || "el correo del banco"}</Code>.</li>
        <li>Agrega otra condición (recomendado): <b>El asunto incluye</b> → una palabra de los avisos de transferencias <i>recibidas</i>.</li>
        <li>Acción: <b>Reenviar a</b> → <Code>{inbound}</Code>.</li>
        <li>Pulsa <b>Guardar</b>. ✅</li>
      </ol>
      <Note tone="warn">
        Si es un correo de empresa (Microsoft 365), el administrador puede tener bloqueado el reenvío a direcciones externas. En ese caso
        pídele que permita el reenvío a <Code>{inbound}</Code>.
      </Note>
    </Step>
  );
}

/* ── Otros proveedores ─────────────────────────────────── */

function OtherSteps({ sender, inbound }: { sender: string; inbound: string }) {
  return (
    <Step n={1} title="Crea un filtro o regla de reenvío">
      <p>Casi todos los correos tienen una opción de <b>Filtros</b>, <b>Reglas</b> o <b>Reenvíos</b>. Configúrala así:</p>
      <ul className="ml-4 mt-2 list-disc space-y-1.5">
        <li><b>Condición:</b> el remitente es o contiene <Code>{sender || "el correo del banco"}</Code>.</li>
        <li><b>Condición extra</b> (recomendado): el asunto contiene una palabra de los avisos de transferencias recibidas.</li>
        <li><b>Acción:</b> reenviar (o «redirigir») a <Code>{inbound}</Code>, conservando también la copia en tu bandeja.</li>
      </ul>
      <div className="mt-3 space-y-1.5 text-xs text-muted">
        <p><b className="text-white">Correo de Hostinger / Webmail (Roundcube):</b> Configuración → Filtros → Crear → «Desde contiene» el remitente → Acción «Redirigir mensaje a».</p>
        <p><b className="text-white">Yahoo:</b> Configuración → Más configuraciones → Filtros → Agregar filtro nuevo → reenviar a la dirección.</p>
        <p><b className="text-white">Zoho:</b> Configuración → Filtros → Nuevo filtro → «Remitente contiene» → Acción «Reenviar a».</p>
      </div>
      <Note>Si tu proveedor pide confirmar la dirección de reenvío, el aviso con el código aparecerá en el <b>Panel</b> de Concilia.</Note>
    </Step>
  );
}

/* ── Piezas ────────────────────────────────────────────── */

function Step({ n, title, icon, children }: { n: number; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex gap-4">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/15 text-sm font-semibold text-brand-soft">
        {icon ?? (n === 0 ? <Info className="h-4 w-4" /> : n)}
      </div>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
        <h3 className="mb-2 font-semibold text-white">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="break-all rounded bg-ink/70 px-1.5 py-0.5 font-mono text-xs text-brand-soft">{children}</code>;
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={`mt-3 flex gap-2 rounded-xl border p-3 text-xs ${tone === "warn" ? "border-warn/30 bg-warn/10" : "border-line bg-ink/40"}`}>
      {tone === "warn" ? <AlertTriangle className="h-4 w-4 shrink-0 text-warn" /> : <Info className="h-4 w-4 shrink-0 text-brand-soft" />}
      <div>{children}</div>
    </div>
  );
}

function CopyField({ label, value, copyable }: { label: string; value: string; copyable: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <div className="label">{label}</div>
      <div className="flex items-center gap-2">
        <code className={`min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-3 py-2 text-xs ${copyable ? "text-brand-soft" : "text-muted"}`} title={value}>{value}</code>
        {copyable && (
          <button
            onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="btn-ghost !px-2.5 !py-1.5" aria-label="Copiar"
          >
            {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
