import type { Role } from "@/generated/prisma/enums";

/**
 * Estrutura de navegação.
 *
 * Fica em um módulo próprio porque é consumida em três lugares — barra lateral,
 * menu do celular e trilha de navegação — e duplicá-la garantiria que uma delas
 * ficasse desatualizada.
 *
 * A lista aqui só decide o que APARECE. Quem decide o que pode ser ACESSADO é o
 * servidor, em cada layout e em cada rota: esconder o link não é controle de
 * acesso.
 */

export type NavItem = {
  href: string;
  label: string;
  /** Emoji usado como ícone; decorativo, sempre acompanhado de texto. */
  icon: string;
  /** Casa também as subrotas (ex.: /admin/kits/novo). */
  matchPrefix?: boolean;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};

export const TEACHER_NAV: NavSection = {
  title: "Minha área",
  items: [
    { href: "/inicio", label: "Início", icon: "🏠" },
    { href: "/reservar", label: "Fazer reserva", icon: "➕" },
    { href: "/disponibilidade", label: "Disponibilidade", icon: "📅" },
    { href: "/minhas-reservas", label: "Minhas reservas", icon: "📋", matchPrefix: true },
    { href: "/ocorrencias", label: "Meus problemas", icon: "🛠️", matchPrefix: true },
    { href: "/perfil", label: "Meu perfil", icon: "👤" },
  ],
};

export const ADMIN_NAV: NavSection = {
  title: "Supervisão",
  items: [
    { href: "/admin", label: "Painel", icon: "📊" },
    { href: "/admin/usuarios", label: "Usuários", icon: "👥", matchPrefix: true },
    { href: "/admin/kits", label: "Kits e carrinhos", icon: "🧰", matchPrefix: true },
    { href: "/admin/notebooks", label: "Notebooks", icon: "💻", matchPrefix: true },
    { href: "/admin/carregadores", label: "Carregadores", icon: "🔌", matchPrefix: true },
    { href: "/admin/reservas", label: "Todas as reservas", icon: "🗂️", matchPrefix: true },
    { href: "/admin/ocorrencias", label: "Ocorrências", icon: "⚠️", matchPrefix: true },
    { href: "/admin/relatorios", label: "Relatórios", icon: "📈", matchPrefix: true },
    { href: "/admin/configuracoes", label: "Configurações", icon: "⚙️" },
  ],
};

export function navSectionsFor(role: Role): NavSection[] {
  return role === "SUPERVISOR" ? [TEACHER_NAV, ADMIN_NAV] : [TEACHER_NAV];
}

/** Um item está ativo para o caminho atual? */
export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === pathname) return true;
  if (!item.matchPrefix) return false;
  return pathname.startsWith(`${item.href}/`);
}
