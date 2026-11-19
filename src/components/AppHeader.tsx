"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, LayoutDashboard, Landmark } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Logo } from "./Logo";

const NAV = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/bancos", label: "Bancos", icon: Landmark },
];

export function AppHeader({
  tenantName, email, active, children,
}: { tenantName: string; email: string; active: "/dashboard" | "/bancos"; children?: React.ReactNode }) {
  const router = useRouter();
  async function logout() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-8">
        <Logo />
        <nav className="flex gap-1 rounded-xl border border-line bg-panel/60 p-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                active === href ? "bg-brand text-white" : "text-muted hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4" />{label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {children}
        <div className="hidden text-right text-sm sm:block">
          <div className="font-medium">{tenantName}</div>
          <div className="text-xs text-muted">{email}</div>
        </div>
        <button onClick={logout} className="btn-ghost !px-3" title="Salir"><LogOut className="h-4 w-4" /></button>
      </div>
    </header>
  );
}
