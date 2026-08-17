"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";
import { isActive, navSectionsFor, type NavSection } from "./nav-config";
import type { Role } from "@/generated/prisma/enums";

/**
 * Moldura das telas autenticadas.
 *
 * No desktop a navegação fica fixa em uma coluna lateral; no celular vira um
 * painel que abre a partir do cabeçalho. A mesma lista alimenta os dois, então
 * não existe risco de o menu do celular ficar defasado.
 */

export type ShellUser = {
  fullName: string;
  username: string;
  role: Role;
};

export function AppShell({
  user,
  institutionName,
  children,
}: {
  user: ShellUser;
  institutionName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const sections = navSectionsFor(user.role);

  // Navegar fecha o menu do celular. Sem isso, o painel continuaria aberto
  // sobre a tela nova depois de tocar em um link.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>

      {/*
        O cabeçalho fica acima do painel (z-40) e do fundo escurecido (z-30):
        o botão que abre o menu é o MESMO que o fecha, e com z-index igual ao
        do fundo ele ficava coberto — no celular dava para abrir o menu e não
        dava para fechá-lo pelo ✕.
      */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            className="-ml-1 rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
          >
            <span aria-hidden="true" className="text-lg">
              {menuOpen ? "✕" : "☰"}
            </span>
            <span className="sr-only">
              {menuOpen ? "Fechar menu" : "Abrir menu"}
            </span>
          </button>

          <Link href="/inicio" className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-900">
              Reserva de Notebooks
            </span>
            <span className="block truncate text-xs text-slate-500">
              {institutionName}
            </span>
          </Link>

          <UserMenu user={user} />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        <SidebarNav
          sections={sections}
          pathname={pathname}
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
        />

        <main id="conteudo" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarNav({
  sections,
  pathname,
  open,
  onClose,
}: {
  sections: NavSection[];
  pathname: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <nav
        id="menu-principal"
        aria-label="Navegação principal"
        className={cn(
          "z-40 w-64 shrink-0 border-r border-slate-200 bg-white",
          // Celular: painel deslizante. Desktop: coluna sempre visível.
          "fixed inset-y-0 left-0 overflow-y-auto pt-16 transition-transform lg:static lg:translate-x-0 lg:pt-0",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:sticky lg:top-[57px] lg:h-[calc(100dvh-57px)]",
        )}
      >
        <div className="flex flex-col gap-6 px-3 py-4">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {section.title}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                          active
                            ? "bg-sky-50 font-semibold text-sky-800"
                            : "text-slate-700 hover:bg-slate-100",
                        )}
                      >
                        <span aria-hidden="true" className="text-base">
                          {item.icon}
                        </span>
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    try {
      await api.post("/api/auth/logout");
    } finally {
      // Navegação completa (e não client-side) para descartar todo o estado
      // em memória da sessão que acabou de ser encerrada.
      window.location.href = "/entrar";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden text-right sm:block">
        <p className="max-w-40 truncate text-sm font-medium text-slate-800">
          {user.fullName}
        </p>
        <p className="text-xs text-slate-500">
          {user.role === "SUPERVISOR" ? "Supervisão" : "Professor(a)"}
        </p>
      </div>
      <button
        type="button"
        onClick={sair}
        disabled={saindo}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {saindo ? "Saindo..." : "Sair"}
      </button>
    </div>
  );
}
