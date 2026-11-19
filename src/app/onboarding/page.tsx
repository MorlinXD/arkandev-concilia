"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Store, Loader2 } from "lucide-react";

export default function Onboarding() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/tenant", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    setLoading(false);
    if (!res.ok) return setError((await res.json()).error ?? "Error");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-md p-8">
        <Logo />
        <div className="mt-8 mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand/15 text-brand-soft"><Store className="h-5 w-5" /></div>
          <div>
            <h2 className="text-lg font-semibold">Registra tu negocio</h2>
            <p className="text-sm text-muted">Paso 1 de 2 · Luego conectaremos tu banco.</p>
          </div>
        </div>
        <label className="label">Nombre del negocio</label>
        <input className="input mb-6" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Coldbliss Quevedo" />
        {error && <p className="mb-4 text-sm text-bad">{error}</p>}
        <button className="btn w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />} Continuar
        </button>
      </form>
    </main>
  );
}
