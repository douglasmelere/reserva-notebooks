import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

/**
 * Área da supervisão.
 *
 * Um professor que digite `/admin` na barra de endereços é mandado de volta ao
 * início — e, se tentar chamar a API administrativa direto, recebe 403 do
 * `requireSupervisor()` de cada rota. As duas checagens são independentes de
 * propósito.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  if (user.role !== "SUPERVISOR") redirect("/inicio");

  const settings = await getSettings();

  return (
    <AppShell
      user={{
        fullName: user.fullName,
        username: user.username,
        role: user.role,
      }}
      institutionName={settings.institutionName}
    >
      {children}
    </AppShell>
  );
}
