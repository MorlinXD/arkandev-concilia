"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "./AppHeader";
import { inboundAddressFor, INBOUND_MODE } from "@/lib/inbound-address";
import {
  CheckCircle2, Clock, AlertTriangle, Plus, Copy, Check, Mail, Zap, Inbox, Banknote, Loader2, Wifi,
} from "lucide-react";

type Tenant = { name: string; inboundAlias: string };
type Sale = {
  id: string; code: string; amount: string; description: string | null; customerName: string | null;
  status: "pending" | "approved" | "review" | "expired" | "cancelled"; createdAt: string; approvedAt: string | null;
};
type Transfer = {
  id: string; bank: string; amount: string; senderName: string | null; memo: string | null;
  status: "unmatched" | "matched" | "review"; receivedAt: string; saleId: string | null;
};

type InboundEmail = {
  id: string; fromAddress: string | null; subject: string | null; createdAt: string;
  status: "processed" | "ignored" | "failed" | "forwarding_confirmation"; detail: string | null;
};

const money = (n: number | string) => new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(Number(n));
const time = (s: string) => new Date(s).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });

const SALE_BADGE: Record<Sale["status"], { text: string; cls: string }> = {
  pending: { text: "Esperando pago", cls: "bg-white/5 text-muted" },
  approved: { text: "Aprobada", cls: "bg-ok/15 text-ok" },
  review: { text: "Por revisar", cls: "bg-warn/15 text-warn" },
  expired: { text: "Expirada", cls: "bg-white/5 text-muted/60" },
  cancelled: { text: "Cancelada", cls: "bg-bad/10 text-bad" },
};
const TRANSFER_BADGE: Record<Transfer["status"], { text: string; cls: string }> = {
  matched: { text: "Conciliada", cls: "bg-ok/15 text-ok" },
  review: { text: "Por revisar", cls: "bg-warn/15 text-warn" },
  unmatched: { text: "Sin venta", cls: "bg-bad/10 text-bad" },
};

const POLL_MS = 3000;

export function Dashboard({ tenant, email, isDev }: { tenant: Tenant; email: string; isDev: boolean }) {
  const router = useRouter();
  const [sales, setSales] = useState<Sale[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [emails, setEmails] = useState<InboundEmail[]>([]);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [mailboxes, setMailboxes] = useState<string[] | null>(null);
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const approvedSeen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feed", { cache: "no-store" });
      if (res.status === 401) return router.push("/login");
      const data = (await res.json()) as {
        sales: Sale[]; transfers: Transfer[]; emails: InboundEmail[]; forwardingConfirmation: string | null; mailboxes: string[];
      };
      // Detecta aprobaciones nuevas desde la última consulta → aviso + sonido
      const approved = data.sales.filter((s) => s.status === "approved");
      if (approvedSeen.current) {
        const fresh = approved.filter((s) => !approvedSeen.current!.has(s.id));
        if (fresh.length) { setToast(`Venta ${fresh[0].code} aprobada · ${money(fresh[0].amount)}`); beep(); }
      }
      approvedSeen.current = new Set(approved.map((s) => s.id));
      setSales(data.sales);
      setTransfers(data.transfers);
      setEmails(data.emails);
      setConfirmation(data.forwardingConfirmation);
      setMailboxes(data.mailboxes);
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const today = new Date().toDateString();
  const stats = {
    pending: sales.filter((s) => s.status === "pending").length,
    review: sales.filter((s) => s.status === "review").length,
    approvedToday: sales.filter((s) => s.status === "approved" && s.approvedAt && new Date(s.approvedAt).toDateString() === today),
  };

  async function resolve(id: string, action: "approve" | "reject") {
    await fetch(`/api/sales/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    load();
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <AppHeader tenantName={tenant.name} email={email} active="/dashboard">
        <span className={`hidden items-center gap-1.5 rounded-full px-3 py-1 text-xs sm:inline-flex ${live ? "bg-ok/10 text-ok" : "bg-white/5 text-muted"}`}>
          <Wifi className="h-3.5 w-3.5" /> {live ? "En línea" : "Sin conexión"}
        </span>
      </AppHeader>

      {/* Stats */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Clock className="h-4 w-4" />} label="Esperando pago" value={String(stats.pending)} />
        <Stat icon={<AlertTriangle className="h-4 w-4" />} label="Por revisar" value={String(stats.review)} tone="warn" />
        <Stat icon={<CheckCircle2 className="h-4 w-4" />} label="Aprobadas hoy" value={String(stats.approvedToday.length)} tone="ok" />
        <Stat icon={<Banknote className="h-4 w-4" />} label="Cobrado hoy" value={money(stats.approvedToday.reduce((a, s) => a + Number(s.amount), 0))} tone="brand" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Columna izquierda */}
        <div className="space-y-6">
          <NewSale onCreated={load} />
          <InboundCard alias={tenant.inboundAlias} confirmation={confirmation} mailboxes={mailboxes} />
          {isDev && <Simulator onDone={load} />}
        </div>

        {/* Ventas */}
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold">Ventas</h3>
            <span className="text-xs text-muted">{sales.length} recientes</span>
          </div>
          <div className="divide-y divide-line">
            {sales.length === 0 && <Empty text="Crea tu primera venta para empezar a conciliar." />}
            {sales.map((s) => (
              <div key={s.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-20 font-mono text-sm font-semibold text-brand-soft">{s.code}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.description || "Venta"}</div>
                  <div className="text-xs text-muted">{s.customerName || "—"} · {time(s.createdAt)}</div>
                </div>
                <div className="text-right font-medium tabular-nums">{money(s.amount)}</div>
                <Badge {...SALE_BADGE[s.status]} />
                {s.status === "review" && (
                  <div className="flex gap-1.5">
                    <button onClick={() => resolve(s.id, "approve")} className="rounded-lg bg-ok/15 px-2.5 py-1 text-xs text-ok hover:bg-ok/25">Aprobar</button>
                    <button onClick={() => resolve(s.id, "reject")} className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-muted hover:text-white">Descartar</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Transferencias */}
        <section className="card lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold">Transferencias recibidas</h3>
            <span className="text-xs text-muted">Detectadas desde los correos del banco</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-5 py-3 font-medium">Hora</th>
                  <th className="px-5 py-3 font-medium">Banco</th>
                  <th className="px-5 py-3 font-medium">Remitente</th>
                  <th className="px-5 py-3 font-medium">Concepto</th>
                  <th className="px-5 py-3 text-right font-medium">Monto</th>
                  <th className="px-5 py-3 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-3 text-muted">{time(t.receivedAt)}</td>
                    <td className="px-5 py-3">{t.bank}</td>
                    <td className="px-5 py-3">{t.senderName || "—"}</td>
                    <td className="max-w-xs truncate px-5 py-3 text-muted">{t.memo || "—"}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{money(t.amount)}</td>
                    <td className="px-5 py-3"><Badge {...TRANSFER_BADGE[t.status]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transfers.length === 0 && <Empty text="Aún no llegan transferencias." />}
          </div>
        </section>
      </div>

      <EmailLog emails={emails} />

      {toast && (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 rounded-2xl border border-ok/30 bg-panel px-5 py-4 shadow-2xl shadow-ok/10">
          <CheckCircle2 className="h-5 w-5 text-ok" />
          <span className="text-sm font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}

/* ── Piezas ─────────────────────────────────────────────── */

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: "ok" | "warn" | "brand" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "brand" ? "text-brand-soft" : "text-muted";
  return (
    <div className="card p-5">
      <div className={`mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${color}`}>{icon}{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{text}</span>;
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{text}</p>;
}

function NewSale({ onCreated }: { onCreated: () => void }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [customer, setCustomer] = useState("");
  const [created, setCreated] = useState<{ code: string; amount: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/sales", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, description: description || null, customerName: customer || null }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) return alert(data.error ?? "Error");
    setCreated(data as { code: string; amount: string });
    setAmount(""); setDescription(""); setCustomer("");
    onCreated();
  }

  return (
    <section className="card p-5">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-brand-soft" />Nueva venta</h3>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Monto (USD)</label>
          <input className="input text-lg font-semibold" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción (opcional)" />
        <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Cliente (opcional)" />
        <button className="btn w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}Generar código</button>
      </form>
      {created && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand/10 p-4">
          <p className="text-xs text-muted">Pide al cliente que transfiera <b className="text-white">{money(created.amount)}</b> con este código en el concepto:</p>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-2xl font-bold tracking-wider text-brand-soft">{created.code}</span>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(created.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="btn-ghost !px-3 !py-1.5"
            >
              {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function InboundCard({ alias, confirmation, mailboxes }: { alias: string; confirmation: string | null; mailboxes: string[] | null }) {
  const address = inboundAddressFor(alias);
  const [copied, setCopied] = useState(false);
  const link = confirmation?.match(/https:\/\/\S+/)?.[0];
  return (
    <section className="card p-5">
      <h3 className="mb-2 flex items-center gap-2 font-semibold"><Mail className="h-4 w-4 text-brand-soft" />Correo de reenvío</h3>
      <p className="mb-3 text-xs text-muted">
        Reenvía aquí los avisos de tu banco.{INBOUND_MODE === "mailbox" && " Te reconocemos por el correo que registraste en Bancos."}
      </p>
      <div className="flex items-center gap-2">
        <code className="block min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-3 py-2 text-xs text-brand-soft">{address}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          className="btn-ghost !px-2.5 !py-1.5"
        >
          {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      {INBOUND_MODE === "mailbox" && mailboxes !== null && (
        mailboxes.length === 0 ? (
          <a href="/bancos" className="mt-3 block rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs text-warn hover:bg-warn/15">
            Registra en <b>Bancos</b> el correo donde te llegan los avisos; sin él no podemos saber que son tuyos →
          </a>
        ) : (
          <p className="mt-3 text-xs text-muted">Avisos reconocidos desde: <span className="text-white">{mailboxes.join(", ")}</span></p>
        )
      )}
      {confirmation && (
        <div className="mt-3 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs">
          <p className="mb-1 font-medium text-warn">Tu correo pide confirmar el reenvío</p>
          {link
            ? <a href={link} target="_blank" rel="noreferrer" className="break-all text-brand-soft underline">Confirmar reenvío →</a>
            : null}
          <p className="mt-1 break-all text-muted">{confirmation.replace(link ?? "", "").replace(/^\s*·\s*/, "")}</p>
        </div>
      )}
    </section>
  );
}

const EMAIL_BADGE: Record<InboundEmail["status"], { text: string; cls: string }> = {
  processed: { text: "Leído", cls: "bg-ok/15 text-ok" },
  ignored: { text: "Ignorado", cls: "bg-white/5 text-muted" },
  failed: { text: "Error", cls: "bg-bad/10 text-bad" },
  forwarding_confirmation: { text: "Confirmación", cls: "bg-warn/15 text-warn" },
};

const DETAIL_TEXT: Record<string, string> = {
  approved: "Venta aprobada", review: "Enviada a revisión", unmatched: "Sin venta asociada", duplicate: "Correo repetido",
  outgoing: "Dinero saliente (no aplica)", no_amount: "No contiene un monto", unknown_tenant: "Negocio no encontrado",
};
const humanize = (detail: string | null) =>
  (detail ?? "").split(" · ").map((p) => DETAIL_TEXT[p.split(":")[0]] ?? p).join(" · ");

function EmailLog({ emails }: { emails: InboundEmail[] }) {
  return (
    <section className="card mt-6">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="flex items-center gap-2 font-semibold"><Inbox className="h-4 w-4 text-brand-soft" />Correos recibidos</h3>
        <span className="text-xs text-muted">Todo lo que llega a tu correo de reenvío</span>
      </div>
      <div className="divide-y divide-line">
        {emails.length === 0 && <Empty text="Aún no llega ningún correo. Configura el reenvío desde tu banco." />}
        {emails.map((e) => (
          <div key={e.id} className="flex items-center gap-4 px-5 py-3 text-sm">
            <div className="w-14 text-muted">{time(e.createdAt)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate">{e.subject || "(sin asunto)"}</div>
              <div className="truncate text-xs text-muted">{e.fromAddress} · {humanize(e.detail)}</div>
            </div>
            <Badge {...EMAIL_BADGE[e.status]} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Simulator({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/dev/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, memo, sender: "María Pérez" }),
    });
    const data = await res.json();
    setLoading(false);
    const labels: Record<string, string> = {
      approved: `✅ Aprobada (${data.saleCode})`, review: `⚠️ Por revisar (${data.saleCode})`,
      unmatched: "❌ Sin venta asociada", duplicate: "Duplicada", unknown_tenant: "Negocio no encontrado",
    };
    setResult(labels[data.result] ?? data.error ?? "Error");
    onDone();
  }

  return (
    <section className="card border-dashed p-5">
      <h3 className="mb-1 flex items-center gap-2 font-semibold"><Zap className="h-4 w-4 text-warn" />Simulador de banco</h3>
      <p className="mb-4 text-xs text-muted">Solo en desarrollo. Simula que llegó un correo de transferencia.</p>
      <form onSubmit={send} className="space-y-3">
        <input className="input" type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Monto" />
        <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Concepto (ej. pago V-1234)" />
        <button className="btn-ghost w-full" disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />}Enviar transferencia</button>
      </form>
      {result && <p className="mt-3 text-sm">{result}</p>}
    </section>
  );
}

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.08;
    o.start(); o.stop(ctx.currentTime + 0.15);
  } catch { /* sin audio */ }
}
