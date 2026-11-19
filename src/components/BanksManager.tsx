"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Landmark, Plus, Loader2, Trash2, Pencil, Check, X, Copy, ShieldCheck, Mail, BellRing, Forward, ListChecks, ArrowRight, BookOpen,
} from "lucide-react";
import { AppHeader } from "./AppHeader";
import { ForwardingGuide, type GuideTarget } from "./ForwardingGuide";

type RegistryBank = { id: string; name: string; domains: string[] };
type Account = {
  id: string; bankId: string; bankName: string; alias: string | null; lastDigits: string | null; notifyEmail: string | null;
  senderEmails: string | null; active: boolean; transfers: number; lastTransferAt: string | null;
};

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
};

export function BanksManager({ tenantName, email, inboundAddress }: { tenantName: string; email: string; inboundAddress: string }) {
  const [registry, setRegistry] = useState<RegistryBank[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [guide, setGuide] = useState<GuideTarget | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/banks", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setRegistry(data.registry);
    setAccounts(data.accounts);
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-6">
      <AppHeader tenantName={tenantName} email={email} active="/bancos" />

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Bancos</h1>
        <p className="mt-1 text-sm text-muted">Registra las cuentas donde recibes transferencias y desde qué correos te avisa cada banco.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <AddAccount registry={registry} onCreated={load} />
          <SetupSteps
            inboundAddress={inboundAddress}
            onOpenGuide={() => setGuide({ bankName: "tu banco", senders: [], mailbox: null, inboundAddress })}
          />
        </div>

        <section className="space-y-4 lg:col-span-2">
          {accounts.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-brand/25 bg-brand/5 px-4 py-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft" />
              <p className="text-muted">
                <b className="text-white">Modo seguro activo:</b> los correos de bancos que no estén en esta lista nunca se aprueban solos; quedan por revisar.
              </p>
            </div>
          )}

          {loaded && accounts.length === 0 && (
            <div className="card flex flex-col items-center px-6 py-14 text-center">
              <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand/15 text-brand-soft"><Landmark className="h-6 w-6" /></div>
              <h3 className="font-semibold">Aún no registras bancos</h3>
              <p className="mt-1 max-w-sm text-sm text-muted">
                Agrega cada cuenta donde recibes transferencias. Así Concilia sabe qué correos esperar y rechaza los de bancos ajenos.
              </p>
            </div>
          )}

          {accounts.map((a) => (
            <AccountCard
              key={a.id} account={a} inboundAddress={inboundAddress}
              defaults={registry.find((r) => r.id === a.bankId)?.domains ?? []} onChange={load}
              onOpenGuide={setGuide}
            />
          ))}
        </section>
      </div>

      {guide && <ForwardingGuide target={guide} onClose={() => setGuide(null)} />}
    </div>
  );
}

/* ── Agregar cuenta ───────────────────────────────────────── */

function AddAccount({ registry, onCreated }: { registry: RegistryBank[]; onCreated: () => void }) {
  const [bankId, setBankId] = useState("");
  const [bankName, setBankName] = useState("");
  const [alias, setAlias] = useState("");
  const [lastDigits, setLastDigits] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [senders, setSenders] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isCustom = bankId === "custom";
  const selected = registry.find((r) => r.id === bankId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/banks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankId, bankName: isCustom ? bankName : null, alias, lastDigits, notifyEmail, senderEmails: senders }),
    });
    setLoading(false);
    if (!res.ok) return setError((await res.json()).error ?? "Error");
    setBankId(""); setBankName(""); setAlias(""); setLastDigits(""); setNotifyEmail(""); setSenders("");
    onCreated();
  }

  return (
    <section className="card p-5">
      <h3 className="mb-4 flex items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-brand-soft" />Agregar cuenta</h3>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Banco</label>
          <select className="input" required value={bankId} onChange={(e) => setBankId(e.target.value)}>
            <option value="" disabled>Selecciona tu banco…</option>
            {registry.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="custom">Otro banco o cooperativa…</option>
          </select>
        </div>

        {isCustom && (
          <div>
            <label className="label">Nombre del banco</label>
            <input className="input" required value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Ej. Cooperativa Mushuc Runa" />
          </div>
        )}

        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-3">
            <label className="label">Alias</label>
            <input className="input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Ahorros principal" />
          </div>
          <div className="col-span-2">
            <label className="label">Últimos 4</label>
            <input
              className="input font-mono" inputMode="numeric" maxLength={4} value={lastDigits}
              onChange={(e) => setLastDigits(e.target.value.replace(/\D/g, ""))} placeholder="1234"
            />
          </div>
        </div>

        <div>
          <label className="label">Correo donde te llegan los avisos</label>
          <input
            className="input" type="email" required value={notifyEmail}
            onChange={(e) => setNotifyEmail(e.target.value)} placeholder="ventas@tunegocio.com"
          />
          <p className="mt-1.5 text-xs text-muted">El correo de tu negocio que tienes registrado en este banco. Desde ahí reenviarás los avisos.</p>
        </div>

        <div>
          <label className="label">Correo del remitente {isCustom ? "" : "(opcional)"}</label>
          <textarea
            className="input min-h-[72px] resize-y font-mono text-xs" required={isCustom} value={senders}
            onChange={(e) => setSenders(e.target.value)}
            placeholder={isCustom ? "notificaciones@micooperativa.fin.ec" : "Solo si tu banco usa otra dirección"}
          />
          {selected && (
            <p className="mt-1.5 text-xs text-muted">
              Ya reconocemos: <span className="font-mono text-brand-soft">{selected.domains.join(", ")}</span>.
              Si tu correo de aviso viene de otra dirección, escríbela aquí.
            </p>
          )}
          {isCustom && <p className="mt-1.5 text-xs text-muted">La dirección exacta desde la que te llegan los avisos de transferencias recibidas.</p>}
        </div>

        {error && <p className="rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
        <button className="btn w-full" disabled={loading || !bankId}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}Agregar cuenta
        </button>
      </form>
    </section>
  );
}

/* ── Tarjeta de cuenta ────────────────────────────────────── */

function AccountCard({ account: a, defaults, inboundAddress, onChange, onOpenGuide }: {
  account: Account; defaults: string[]; inboundAddress: string; onChange: () => void; onOpenGuide: (t: GuideTarget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingMailbox, setEditingMailbox] = useState(false);
  const [mailbox, setMailbox] = useState(a.notifyEmail ?? "");
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [senders, setSenders] = useState(a.senderEmails ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function patch(body: object) {
    setBusy(true);
    const res = await fetch(`/api/banks/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    onChange();
    return res.ok;
  }
  async function remove() {
    setBusy(true);
    await fetch(`/api/banks/${a.id}`, { method: "DELETE" });
    onChange();
  }

  const custom = (a.senderEmails ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const openGuide = () => onOpenGuide({ bankName: a.bankName, senders: [...custom, ...defaults], mailbox: a.notifyEmail, inboundAddress });

  return (
    <article className={`card p-5 transition ${a.active ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 font-semibold text-brand-soft">
            {a.bankName.replace(/^(Banco|Cooperativa)\s+(de(l)?\s+)?/i, "").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold">{a.bankName}</div>
            <div className="text-sm text-muted">
              {a.alias || "Cuenta"}{a.lastDigits && <span className="ml-1.5 font-mono">•••• {a.lastDigits}</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => patch({ active: !a.active })} disabled={busy}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${a.active ? "bg-ok/15 text-ok hover:bg-ok/25" : "bg-white/5 text-muted hover:text-white"}`}
            title={a.active ? "Pausar: dejará de considerarse banco registrado" : "Activar"}
          >
            {a.active ? "Activa" : "Pausada"}
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-muted">¿Eliminar?</span>
              <button onClick={remove} disabled={busy} className="rounded-lg bg-bad/15 px-2 py-1 text-bad hover:bg-bad/25">Sí</button>
              <button onClick={() => setConfirmDelete(false)} className="rounded-lg bg-white/5 px-2 py-1 text-muted hover:text-white">No</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="btn-ghost !px-2.5 !py-1.5" title="Eliminar"><Trash2 className="h-4 w-4" /></button>
          )}
        </div>
      </div>

      {/* Ruta del aviso: banco → correo del negocio → Concilia */}
      <div className="mt-4 rounded-xl border border-line bg-ink/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="label !mb-0">Ruta de los avisos</div>
          <button onClick={openGuide} className="flex items-center gap-1.5 rounded-lg bg-brand/15 px-2.5 py-1 text-xs font-medium text-brand-soft transition hover:bg-brand/25">
            <BookOpen className="h-3.5 w-3.5" />Ver tutorial
          </button>
        </div>
        {editingMailbox ? (
          <div className="space-y-2">
            <input className="input" type="email" value={mailbox} onChange={(e) => setMailbox(e.target.value)} placeholder="ventas@tunegocio.com" />
            {mailboxError && <p className="text-xs text-bad">{mailboxError}</p>}
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setMailboxError(null);
                  if (await patch({ notifyEmail: mailbox })) setEditingMailbox(false);
                  else setMailboxError("Correo inválido");
                }}
                className="btn !px-3 !py-1.5 text-xs"
              ><Check className="h-3.5 w-3.5" />Guardar</button>
              <button onClick={() => { setMailbox(a.notifyEmail ?? ""); setEditingMailbox(false); }} className="btn-ghost !px-3 !py-1.5 text-xs"><X className="h-3.5 w-3.5" />Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-md bg-white/5 px-2 py-1">{a.bankName}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted" />
            {a.notifyEmail
              ? <span className="rounded-md bg-white/5 px-2 py-1 font-mono">{a.notifyEmail}</span>
              : <span className="rounded-md bg-warn/10 px-2 py-1 text-warn">¿A qué correo llegan?</span>}
            <button onClick={() => setEditingMailbox(true)} className="text-muted hover:text-white" title="Editar correo"><Pencil className="h-3.5 w-3.5" /></button>
            <ArrowRight className="h-3.5 w-3.5 text-muted" />
            <span className="rounded-md bg-brand/15 px-2 py-1 font-mono text-brand-soft">{inboundAddress}</span>
          </div>
        )}
        {!editingMailbox && a.notifyEmail && (
          <p className="mt-2 text-xs text-muted">
            En <b className="text-white">{a.notifyEmail}</b>, crea un filtro que reenvíe los avisos de este banco a tu dirección de Concilia.
            Si un aviso llega por otro correo, no se aprobará solo.
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <div>
          <div className="label !flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />Remitentes aceptados</div>
          {editing ? (
            <div className="space-y-2">
              <textarea className="input min-h-[64px] font-mono text-xs" value={senders} onChange={(e) => setSenders(e.target.value)}
                placeholder="avisos@banco.com, otrobanco.com" />
              <div className="flex gap-2">
                <button onClick={async () => { await patch({ senderEmails: senders }); setEditing(false); }} className="btn !px-3 !py-1.5 text-xs"><Check className="h-3.5 w-3.5" />Guardar</button>
                <button onClick={() => { setSenders(a.senderEmails ?? ""); setEditing(false); }} className="btn-ghost !px-3 !py-1.5 text-xs"><X className="h-3.5 w-3.5" />Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {defaults.map((d) => <Chip key={d} text={`*@${d}`} muted />)}
              {custom.map((d) => <Chip key={d} text={d.includes("@") ? d : `*@${d}`} />)}
              {defaults.length === 0 && custom.length === 0 && <span className="text-xs text-bad">Sin remitentes: agrega uno</span>}
              <button onClick={() => setEditing(true)} className="ml-1 text-muted hover:text-white" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>

        <div>
          <div className="label">Actividad</div>
          {a.transfers > 0 && a.lastTransferAt ? (
            <p className="text-sm"><b>{a.transfers}</b> transferencias · última <span className="text-muted">{ago(a.lastTransferAt)}</span></p>
          ) : (
            <p className="text-sm text-warn">Aún no llega ningún correo de este banco. Verifica el reenvío.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function Chip({ text, muted }: { text: string; muted?: boolean }) {
  return <span className={`rounded-md px-2 py-0.5 font-mono text-xs ${muted ? "bg-white/5 text-muted" : "bg-brand/15 text-brand-soft"}`}>{text}</span>;
}

/* ── Guía de configuración ────────────────────────────────── */

function SetupSteps({ inboundAddress, onOpenGuide }: { inboundAddress: string; onOpenGuide: () => void }) {
  const [copied, setCopied] = useState(false);
  const steps = [
    { icon: BellRing, title: "Activa los avisos por correo", text: "En la app o banca web de tu banco, activa las alertas por correo de transferencias recibidas (créditos)." },
    { icon: Forward, title: "Reenvía esos avisos a Concilia", text: "En tu correo, crea un filtro que reenvíe automáticamente los avisos del banco a tu dirección:" },
    { icon: ListChecks, title: "Registra la cuenta aquí", text: "Agrega cada banco donde recibes transferencias. Verás su actividad en cuanto llegue el primer aviso." },
  ];
  return (
    <section className="card p-5">
      <h3 className="mb-4 font-semibold">Cómo conectar un banco</h3>
      <ol className="space-y-4">
        {steps.map(({ icon: Icon, title, text }, i) => (
          <li key={title} className="flex gap-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-soft"><Icon className="h-4 w-4" /></div>
            <div className="min-w-0 text-sm">
              <div className="font-medium">{i + 1}. {title}</div>
              <p className="mt-0.5 text-muted">{text}</p>
              {i === 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-ink/60 px-2.5 py-1.5 text-xs text-brand-soft">{inboundAddress}</code>
                  <button
                    onClick={() => { navigator.clipboard.writeText(inboundAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                    className="btn-ghost !px-2 !py-1"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <button onClick={onOpenGuide} className="btn-ghost mt-5 w-full"><BookOpen className="h-4 w-4" />Ver tutorial paso a paso</button>
    </section>
  );
}
