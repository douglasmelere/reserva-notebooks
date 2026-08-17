import Link from "next/link";
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrapper,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui/primitives";
import { requireSupervisor } from "@/lib/auth";
import { formatDateBR } from "@/lib/datetime";
import { listUsers, type UserSummary } from "@/server/users";
import type { Role } from "@/generated/prisma/enums";
import { FiltrosUsuarios } from "./filtros";

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuários" };

const TAMANHO_PAGINA = 20;

const ROTULO_PERFIL: Record<Role, string> = {
  PROFESSOR: "Professor(a)",
  SUPERVISOR: "Supervisão",
};

/** Supervisão em azul (informativo); professor em cinza neutro. */
const TOM_PERFIL: Record<Role, BadgeTone> = {
  PROFESSOR: "neutral",
  SUPERVISOR: "info",
};

/**
 * Listagem administrativa de contas.
 *
 * Server Component: chama `listUsers()` direto. Os filtros vivem na URL, então
 * a supervisão pode guardar nos favoritos ou compartilhar "todos os supervisores
 * ativos" sem depender de estado em memória.
 */
export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSupervisor();
  const sp = await searchParams;

  const busca = primeiro(sp.busca)?.trim() ?? "";
  const perfil = comoPerfil(primeiro(sp.perfil));
  // Valor desconhecido na URL é descartado, e não propagado para os links de
  // paginação: um filtro que não filtra nada só confundiria quem copiar o link.
  const bruto = primeiro(sp.situacao);
  const situacao =
    bruto === "ativos" || bruto === "inativos" ? bruto : undefined;
  const ativo = situacao === "ativos" ? true : situacao === "inativos" ? false : undefined;
  const pagina = Math.max(1, Number(primeiro(sp.pagina) ?? "1") || 1);

  const { items, total, page, pageSize } = await listUsers(
    {
      search: busca || undefined,
      role: perfil,
      active: ativo,
      page: pagina,
      pageSize: TAMANHO_PAGINA,
    },
    actor,
  );

  const totalPaginas = Math.max(1, Math.ceil(total / pageSize));
  const temFiltro = Boolean(busca) || perfil !== undefined || ativo !== undefined;

  const paginaHref = (destino: number) =>
    `/admin/usuarios${montarQuery({ busca, perfil, situacao, pagina: destino })}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuários"
        description="Contas de professores e da supervisão. Contas nunca são apagadas — são desativadas, para preservar o histórico de reservas e ocorrências."
        action={
          <Link
            href="/admin/usuarios/novo"
            className="inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Cadastrar usuário
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Filtrar"
          description="Busque por nome, usuário, e-mail ou departamento."
        />
        <CardBody>
          <FiltrosUsuarios
            busca={busca}
            perfil={perfil ?? ""}
            situacao={situacao ?? ""}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${total} conta(s) encontrada(s)`}
          description={
            totalPaginas > 1
              ? `Página ${page} de ${totalPaginas}.`
              : "Contas ativas aparecem primeiro, em ordem alfabética."
          }
        />
        <CardBody>
          {/* Aplicar um filtro é navegação do lado do cliente: a lista troca
              sem recarregar a página e, sem esta região, quem usa leitor de
              tela não recebe aviso nenhum de que o resultado mudou. */}
          <p role="status" aria-live="polite" className="sr-only">
            {total === 0
              ? "Nenhuma conta encontrada com os filtros atuais."
              : `${total} conta(s) encontrada(s). Página ${page} de ${totalPaginas}.`}
          </p>

          {items.length === 0 ? (
            <EmptyState
              title={
                temFiltro
                  ? "Nenhuma conta corresponde a esses filtros"
                  : "Nenhuma conta cadastrada além da sua"
              }
              description={
                temFiltro
                  ? "Tente um trecho menor do nome, limpe o filtro de perfil ou inclua as contas desativadas."
                  : "Cadastre os professores que vão reservar equipamento. Cada conta nasce com senha provisória, trocada pelo docente no primeiro acesso."
              }
              action={
                temFiltro ? (
                  <Link
                    href="/admin/usuarios"
                    className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Limpar filtros
                  </Link>
                ) : (
                  <Link
                    href="/admin/usuarios/novo"
                    className="inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800"
                  >
                    Cadastrar usuário
                  </Link>
                )
              }
            />
          ) : (
            <>
              {/* Celular: cartões empilhados. A tabela tem seis colunas e
                  espremê-las tornaria a leitura impraticável no telefone. */}
              <ul className="flex flex-col gap-3 md:hidden">
                {items.map((usuario) => (
                  <li key={usuario.id}>
                    <CartaoUsuario usuario={usuario} />
                  </li>
                ))}
              </ul>

              <div className="hidden md:block">
                <TableWrapper>
                  <caption className="sr-only">
                    Contas cadastradas, com perfil de acesso, situação e último
                    acesso.
                  </caption>
                  <thead>
                    <tr>
                      <Th>Nome</Th>
                      <Th>Usuário</Th>
                      <Th>Contato</Th>
                      <Th>Perfil</Th>
                      <Th>Situação</Th>
                      <Th>Último acesso</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((usuario) => (
                      <tr key={usuario.id}>
                        <Td>
                          <Link
                            href={`/admin/usuarios/${usuario.id}`}
                            className="font-medium text-sky-800 underline underline-offset-2"
                          >
                            {usuario.fullName}
                          </Link>
                          {usuario.department && (
                            <span className="block text-xs text-slate-500">
                              {usuario.department}
                            </span>
                          )}
                        </Td>
                        <Td>{usuario.username}</Td>
                        <Td>{usuario.email ?? "—"}</Td>
                        <Td>
                          <Badge tone={TOM_PERFIL[usuario.role]}>
                            {ROTULO_PERFIL[usuario.role]}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={usuario.active ? "success" : "muted"}>
                              {usuario.active ? "Ativa" : "Desativada"}
                            </Badge>
                            {usuario.mustChangePassword && (
                              <Badge tone="warning">Senha provisória</Badge>
                            )}
                          </div>
                        </Td>
                        <Td>
                          {usuario.lastLoginAt
                            ? formatDateBR(usuario.lastLoginAt)
                            : "Nunca entrou"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              </div>

              {totalPaginas > 1 && (
                <nav
                  aria-label="Paginação da lista de usuários"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <p className="text-sm text-slate-600">
                    Página {page} de {totalPaginas}
                  </p>
                  <div className="flex gap-2">
                    <LinkPagina
                      href={paginaHref(page - 1)}
                      desabilitado={page <= 1}
                    >
                      Anterior
                    </LinkPagina>
                    <LinkPagina
                      href={paginaHref(page + 1)}
                      desabilitado={page >= totalPaginas}
                    >
                      Próxima
                    </LinkPagina>
                  </div>
                </nav>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CartaoUsuario({ usuario }: { usuario: UserSummary }) {
  return (
    <Link
      href={`/admin/usuarios/${usuario.id}`}
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate-900">{usuario.fullName}</span>
        <Badge tone={TOM_PERFIL[usuario.role]}>
          {ROTULO_PERFIL[usuario.role]}
        </Badge>
      </div>
      <p className="text-sm text-slate-600">
        {usuario.username}
        {usuario.email ? ` · ${usuario.email}` : ""}
      </p>
      {usuario.department && (
        <p className="text-sm text-slate-600">{usuario.department}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={usuario.active ? "success" : "muted"}>
          {usuario.active ? "Ativa" : "Desativada"}
        </Badge>
        {usuario.mustChangePassword && (
          <Badge tone="warning">Senha provisória</Badge>
        )}
        <span className="text-xs text-slate-500">
          {usuario.lastLoginAt
            ? `Último acesso em ${formatDateBR(usuario.lastLoginAt)}`
            : "Nunca entrou"}
        </span>
      </div>
    </Link>
  );
}

function LinkPagina({
  href,
  desabilitado,
  children,
}: {
  href: string;
  desabilitado: boolean;
  children: ReactNode;
}) {
  if (desabilitado) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex min-h-11 cursor-not-allowed items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-400"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
    >
      {children}
    </Link>
  );
}

/** `searchParams` pode repetir a mesma chave; a primeira ocorrência basta. */
function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function comoPerfil(valor: string | undefined): Role | undefined {
  return valor === "PROFESSOR" || valor === "SUPERVISOR" ? valor : undefined;
}

function montarQuery(params: {
  busca: string;
  perfil: Role | undefined;
  situacao: string | undefined;
  pagina: number;
}): string {
  const search = new URLSearchParams();
  if (params.busca) search.set("busca", params.busca);
  if (params.perfil) search.set("perfil", params.perfil);
  if (params.situacao) search.set("situacao", params.situacao);
  if (params.pagina > 1) search.set("pagina", String(params.pagina));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
