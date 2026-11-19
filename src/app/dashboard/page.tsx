import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { Dashboard } from "@/components/Dashboard";

export default async function DashboardPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.tenant) redirect("/onboarding");
  return (
    <Dashboard
      tenant={{ name: ctx.tenant.name, inboundAlias: ctx.tenant.inboundAlias }}
      email={ctx.user.email}
      isDev={process.env.NODE_ENV !== "production"}
    />
  );
}
