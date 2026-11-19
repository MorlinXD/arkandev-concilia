"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Logo } from "@/components/Logo";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } =
      mode === "in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
    setLoading(false);
    if (error) return setError(error.message ?? "No se pudo continuar");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between border-r border-line p-12 lg:flex">
        <Logo size="lg" />
        <div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            Cada transferencia,<br />
            <span className="text-brand-soft">verificada en segundos.</span>
          </h1>
          <p className="mt-4 max-w-md text-muted">
            Concilia lee las notificaciones de tu banco, las cruza con tus ventas y las aprueba sola.
            Sin capturas, sin revisar la app del banco.
          </p>
        </div>
        <p className="text-xs text-muted">© {new Date().getFullYear()} Arkandev Studio</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="card w-full max-w-sm p-8">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-xl font-semibold">{mode === "in" ? "Inicia sesión" : "Crea tu cuenta"}</h2>
          <p className="mb-6 mt-1 text-sm text-muted">
            {mode === "in" ? "Bienvenido de vuelta." : "Prueba gratis 14 días."}
          </p>
          <label className="label">Correo</label>
          <input className="input mb-4" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@negocio.com" />
          <label className="label">Contraseña</label>
          <input className="input mb-6" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {error && <p className="mb-4 rounded-lg bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "in" ? "Entrar" : "Crear cuenta"}
          </button>
          <button type="button" onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-4 w-full text-center text-sm text-muted hover:text-white">
            {mode === "in" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
          </button>
        </form>
      </section>
    </main>
  );
}
