import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { BanksManager } from "@/components/BanksManager";
import { inboundAddressFor } from "@/lib/inbound-address";

export default async function BancosPage() {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  if (!ctx.tenant) redirect("/onboarding");
  return (
    <BanksManager
      tenantName={ctx.tenant.name}
      email={ctx.user.email}
      inboundAddress={inboundAddressFor(ctx.tenant.inboundAlias)}
    />
  );
}
