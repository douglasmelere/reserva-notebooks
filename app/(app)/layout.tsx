import { TriangleAlert } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

/**
 * Área autenticada (professores e supervisores).
 *
 * A verificação acontece aqui, no servidor, antes de qualquer página do grupo
 * renderizar. Esconder links no menu é conveniência; o que impede o acesso é
 * este `redirect` — e, para os dados, a checagem em cada rota da API.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");

  // Senha redefinida pela supervisão: o usuário precisa trocá-la antes de
  // usar o sistema. A própria tela de perfil é a exceção, senão ele ficaria
  // preso sem ter onde trocar.
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
      {user.mustChangePassword && <TrocaDeSenhaPendente />}
      {children}
    </AppShell>
  );
}

function TrocaDeSenhaPendente() {
  return (
    <div
      role="alert"
      className="mb-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <p>
        Sua senha foi redefinida pela supervisão.{" "}
        <a href="/perfil" className="font-semibold underline">
          Defina uma nova senha
        </a>{" "}
        antes de continuar.
      </p>
    </div>
  );
}
