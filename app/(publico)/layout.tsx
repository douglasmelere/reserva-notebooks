import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Moldura das telas de entrada (login e cadastro).
 *
 * Não usa o AppShell de propósito: sem sessão não há menu, e mostrar uma
 * navegação que leva a telas protegidas só produziria redirecionamentos.
 *
 * Quem já está autenticado é mandado para o início — voltar ao login com
 * sessão aberta é sempre engano de navegação (botão "voltar", link antigo
 * salvo nos favoritos) e nunca uma intenção real de trocar de conta.
 */
export default async function PublicoLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/inicio");

  // O nome da instituição é configurável pela supervisão: exibi-lo já na tela
  // de entrada confirma ao professor que ele está no sistema da escola dele.
  const settings = await getSettings();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-slate-50 px-4 py-10">
      <header className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-xl bg-sky-700 text-2xl shadow-xs"
        >
          💻
        </span>
        <div>
          <p className="text-lg font-bold tracking-tight text-slate-900">
            Reserva de Notebooks
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {settings.institutionName}
          </p>
        </div>
      </header>

      <main className="w-full max-w-md">{children}</main>

      <footer className="w-full max-w-md text-center text-xs text-slate-500">
        <p>
          Sistema de uso interno para reserva de notebooks, maletas e carrinhos.
          Em caso de dúvida ou problema de acesso, procure a supervisão.
        </p>
      </footer>
    </div>
  );
}
