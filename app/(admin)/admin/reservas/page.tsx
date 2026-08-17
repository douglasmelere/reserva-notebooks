import Link from "next/link";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { requireSupervisor } from "@/lib/auth";
import { addDays, formatIntervalBR, todayLocal } from "@/lib/datetime";
import type { SessionUser } from "@/lib/session";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Stat,
  TableWrapper,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui/primitives";
import { getOccupancyByDay } from "@/server/availability";
import { listKits } from "@/server/kits";
import { listNotebooks } from "@/server/notebooks";
import { RESERVATION_STATUS_LABEL } from "@/server/reservation-policy";
import { listReservations } from "@/server/reservations";
import { listUsers } from "@/server/users";
import { Calendario } from "./calendario";
import { Filtros } from "./filtros";

export const dynamic = "force-dynamic";

/**
 * Todas as reservas da instituição.
 *
 * A leitura acontece aqui, no servidor, chamando os serviços direto: filtrar
 * uma agenda inteira por HTTP a partir do navegador só acrescentaria latência.
 * Os componentes de cliente cuidam apenas do que é interação — filtros e
 * navegação do calendário — e o estado deles vive na URL, para que qualquer
 * recorte da agenda possa ser copiado, compartilhado e recarregado.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Cor nunca é o único sinal: o rótulo em texto acompanha todo selo. */
const STATUS_TONE: Record<ReservationStatus, BadgeTone> = {
  SOLICITADA: "warning",
  CONFIRMADA: "info",
  RETIRADA: "info",
  EM_USO: "info",
  DEVOLVIDA: "success",
  ENCERRADA: "muted",
  CANCELADA: "danger",
  NAO_COMPARECEU: "danger",
};

const STATUS_VALIDOS = Object.keys(RESERVATION_STATUS_LABEL) as ReservationStatus[];

const PAGINA_TAMANHO = 20;

const botaoPrimario =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700";
const botaoSecundario =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function texto(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

function listaDeTextos(valor: string | string[] | undefined): string[] {
  if (Array.isArray(valor)) return valor.filter((item) => item !== "");
  return valor ? [valor] : [];
}

function ehData(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

function ehStatus(valor: string): valor is ReservationStatus {
  return (STATUS_VALIDOS as string[]).includes(valor);
}

/** Nome do recurso como o professor o reconhece na prateleira. */
function rotuloDoItem(item: {
  kit: { code: string; name: string } | null;
  notebook: { assetTag: string; nickname: string | null } | null;
}): string {
  if (item.kit) return `${item.kit.name} (${item.kit.code})`;
  if (item.notebook) {
    return `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`;
  }
  return "Recurso removido";
}

export default async function TodasAsReservasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const supervisor = await requireSupervisor();
  const sp = await searchParams;

  const view = texto(sp.view) === "calendario" ? "calendario" : "lista";
  const from = ehData(texto(sp.from)) ? texto(sp.from) : "";
  const to = ehData(texto(sp.to)) ? texto(sp.to) : "";
  const status = listaDeTextos(sp.status).filter(ehStatus);
  const userId = texto(sp.userId);
  const kitId = texto(sp.kitId);
  const notebookId = texto(sp.notebookId);
  const search = texto(sp.search);
  const paginaSolicitada = Number.parseInt(texto(sp.page), 10);
  const page = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;

  const hoje = todayLocal();
  const mesInformado = texto(sp.mes);
  const mes = /^\d{4}-\d{2}$/.test(mesInformado) ? mesInformado : hoje.slice(0, 7);

  // Listas de apoio dos filtros. O teto de 100 é o da própria API; quando o
  // inventário é maior, a busca por texto continua alcançando o que faltar.
  const [professores, kits, notebooks] = await Promise.all([
    listUsers({ pageSize: 100 }, supervisor),
    listKits({ pageSize: 100, includeInactive: true }, supervisor),
    listNotebooks({ pageSize: 100 }, supervisor),
  ]);

  const filtrosAtivos =
    Boolean(from || to || userId || kitId || notebookId || search) || status.length > 0;

  // A exportação é um link comum para a API: o navegador baixa o arquivo
  // sozinho, sem JavaScript montando blob — o que também funciona quando o
  // usuário abre em uma nova aba ou salva o link.
  const paramsCsv = new URLSearchParams({ tipo: "historico", formato: "csv" });
  if (from) paramsCsv.set("from", from);
  if (to) paramsCsv.set("to", to);
  if (userId) paramsCsv.set("userId", userId);
  if (kitId) paramsCsv.set("kitId", kitId);
  if (notebookId) paramsCsv.set("notebookId", notebookId);
  if (search) paramsCsv.set("search", search);
  for (const s of status) paramsCsv.append("status", s);

  // Base de navegação: tudo que não seja a visão nem a paginação, para que
  // trocar de aba ou clicar num dia do calendário preserve os filtros.
  const paramsBase = new URLSearchParams();
  if (from) paramsBase.set("from", from);
  if (to) paramsBase.set("to", to);
  if (userId) paramsBase.set("userId", userId);
  if (kitId) paramsBase.set("kitId", kitId);
  if (notebookId) paramsBase.set("notebookId", notebookId);
  if (search) paramsBase.set("search", search);
  for (const s of status) paramsBase.append("status", s);

  const hrefComVisao = (proximaVisao: "lista" | "calendario"): string => {
    const params = new URLSearchParams(paramsBase);
    params.set("view", proximaVisao);
    if (proximaVisao === "calendario") params.set("mes", mes);
    return `/admin/reservas?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Todas as reservas"
        description="Agenda completa da instituição: acompanhe, ajuste e registre a movimentação dos equipamentos."
        action={
          <>
            <a
              className={botaoSecundario}
              href={`/api/admin/reports?${paramsCsv.toString()}`}
            >
              <span aria-hidden="true">⬇</span>
              Exportar CSV
            </a>
            <Link className={botaoPrimario} href="/admin/reservas/nova">
              <span aria-hidden="true">➕</span>
              Nova reserva
            </Link>
          </>
        }
      />

      <p className="-mt-3 text-xs text-slate-500">
        O arquivo CSV segue os filtros aplicados abaixo.{" "}
        {from || to
          ? "O período exportado é o mesmo do filtro."
          : "Sem período informado, o arquivo traz os últimos 30 dias."}
      </p>

      <nav aria-label="Modo de visualização">
        <ul className="flex gap-2">
          {(
            [
              { chave: "lista", rotulo: "Lista", icone: "📋" },
              { chave: "calendario", rotulo: "Calendário", icone: "📅" },
            ] as const
          ).map((opcao) => {
            const ativo = view === opcao.chave;
            return (
              <li key={opcao.chave}>
                <Link
                  href={hrefComVisao(opcao.chave)}
                  aria-current={ativo ? "page" : undefined}
                  className={
                    ativo
                      ? "inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-50 px-4 text-sm font-semibold text-sky-800 ring-1 ring-sky-200 ring-inset"
                      : "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100"
                  }
                >
                  <span aria-hidden="true">{opcao.icone}</span>
                  {opcao.rotulo}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Filtros
        view={view}
        mes={mes}
        valores={{ from, to, status, userId, kitId, notebookId, search }}
        professores={professores.items.map((usuario) => ({
          id: usuario.id,
          nome: usuario.active
            ? usuario.fullName
            : `${usuario.fullName} (conta desativada)`,
        }))}
        kits={kits.items.map((kit) => ({
          id: kit.id,
          nome: `${kit.name} (${kit.code})`,
        }))}
        notebooks={notebooks.items.map((notebook) => ({
          id: notebook.id,
          nome: `${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""}`,
        }))}
        avisoNotebooks={
          notebooks.total > notebooks.items.length
            ? `Mostrando ${notebooks.items.length} de ${notebooks.total} notebooks. Use a busca por código para chegar aos demais.`
            : null
        }
      />

      {view === "calendario" ? (
        <VisaoCalendario
          mes={mes}
          hoje={hoje}
          baseQuery={paramsBase.toString()}
          filtrosAtivos={filtrosAtivos}
        />
      ) : (
        <VisaoLista
          filtros={{ from, to, status, userId, kitId, notebookId, search, page }}
          baseQuery={paramsBase.toString()}
          filtrosAtivos={filtrosAtivos}
          actor={supervisor}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visão de lista
// ---------------------------------------------------------------------------

async function VisaoLista({
  filtros,
  baseQuery,
  filtrosAtivos,
  actor,
}: {
  filtros: {
    from: string;
    to: string;
    status: ReservationStatus[];
    userId: string;
    kitId: string;
    notebookId: string;
    search: string;
    page: number;
  };
  baseQuery: string;
  filtrosAtivos: boolean;
  /** Componente de servidor: o usuário da sessão passa direto, sem serializar. */
  actor: SessionUser;
}) {
  const resultado = await listReservations(
    {
      from: filtros.from || undefined,
      to: filtros.to || undefined,
      status: filtros.status.length > 0 ? filtros.status : undefined,
      userId: filtros.userId || undefined,
      kitId: filtros.kitId || undefined,
      notebookId: filtros.notebookId || undefined,
      search: filtros.search || undefined,
      page: filtros.page,
      pageSize: PAGINA_TAMANHO,
    },
    actor,
  );

  const totalPaginas = Math.max(1, Math.ceil(resultado.total / resultado.pageSize));

  if (resultado.items.length === 0) {
    return (
      <EmptyState
        title={
          filtrosAtivos
            ? "Nenhuma reserva encontrada com esses filtros"
            : "Ainda não há reservas registradas"
        }
        description={
          filtrosAtivos
            ? "Tente ampliar o período, remover o filtro de situação ou limpar a busca. Os filtros ficam na barra acima."
            : "Assim que um professor reservar um kit ou notebook, a reserva aparece aqui. Você também pode criar uma reserva em nome de um professor."
        }
        action={
          <Link className={botaoPrimario} href="/admin/reservas/nova">
            Criar reserva para um professor
          </Link>
        }
      />
    );
  }

  const linhas = resultado.items.map((reserva) => ({
    id: reserva.id,
    code: reserva.code,
    status: reserva.status,
    statusLabel: RESERVATION_STATUS_LABEL[reserva.status],
    periodo: formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay),
    professor: reserva.user.fullName,
    departamento: reserva.user.department,
    recursos: reserva.items.map(rotuloDoItem),
    sala: reserva.room,
    turma: reserva.className,
    finalidade: reserva.purpose,
  }));

  return (
    <section aria-label="Reservas encontradas" className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Reservas encontradas" value={resultado.total} />
        <Stat
          label="Página"
          value={`${resultado.page} de ${totalPaginas}`}
          tone="muted"
        />
        <Stat label="Nesta página" value={resultado.items.length} tone="muted" />
      </div>

      {/* Celular: cartões empilhados. A tabela tem colunas demais para caber
          numa tela estreita sem virar uma leitura em zigue-zague. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {linhas.map((linha) => (
          <li key={linha.id}>
            <Card>
              <CardBody className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/reservas/${linha.id}`}
                    className="text-sm font-semibold text-sky-800 underline underline-offset-2"
                  >
                    {linha.code}
                  </Link>
                  <Badge tone={STATUS_TONE[linha.status]}>{linha.statusLabel}</Badge>
                </div>
                <p className="text-sm text-slate-900">{linha.periodo}</p>
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">Professor: </span>
                  {linha.professor}
                </p>
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">Recursos: </span>
                  {linha.recursos.length > 0 ? linha.recursos.join(", ") : "—"}
                </p>
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">Sala/Turma: </span>
                  {[linha.sala, linha.turma].filter(Boolean).join(" · ") || "—"}
                </p>
                <Link
                  href={`/admin/reservas/${linha.id}`}
                  className={`${botaoSecundario} mt-1 w-full`}
                >
                  Abrir e gerenciar
                </Link>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="hidden md:block">
        <TableWrapper>
          <caption className="sr-only">
            Reservas encontradas, da mais recente para a mais antiga
          </caption>
          <thead>
            <tr>
              <Th>Código</Th>
              <Th>Período</Th>
              <Th>Professor</Th>
              <Th>Recursos</Th>
              <Th>Sala / Turma</Th>
              <Th>Situação</Th>
              <Th>
                <span className="sr-only">Ações</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr key={linha.id} className="hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{linha.code}</Td>
                <Td>{linha.periodo}</Td>
                <Td>
                  <span className="block">{linha.professor}</span>
                  {linha.departamento && (
                    <span className="block text-xs text-slate-500">
                      {linha.departamento}
                    </span>
                  )}
                </Td>
                <Td>{linha.recursos.length > 0 ? linha.recursos.join(", ") : "—"}</Td>
                <Td>{[linha.sala, linha.turma].filter(Boolean).join(" · ") || "—"}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[linha.status]}>{linha.statusLabel}</Badge>
                </Td>
                <Td>
                  <Link
                    href={`/admin/reservas/${linha.id}`}
                    className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-sky-800 underline underline-offset-2 hover:bg-sky-50"
                  >
                    Gerenciar
                    <span className="sr-only"> a reserva {linha.code}</span>
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrapper>
      </Card>

      {totalPaginas > 1 && (
        <nav
          aria-label="Paginação das reservas"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-slate-600">
            Página {resultado.page} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            {resultado.page > 1 && (
              <Link
                className={botaoSecundario}
                href={`/admin/reservas?${baseQuery}${baseQuery ? "&" : ""}view=lista&page=${resultado.page - 1}`}
              >
                ← Anterior
              </Link>
            )}
            {resultado.page < totalPaginas && (
              <Link
                className={botaoSecundario}
                href={`/admin/reservas?${baseQuery}${baseQuery ? "&" : ""}view=lista&page=${resultado.page + 1}`}
              >
                Próxima →
              </Link>
            )}
          </div>
        </nav>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Visão de calendário
// ---------------------------------------------------------------------------

async function VisaoCalendario({
  mes,
  hoje,
  baseQuery,
  filtrosAtivos,
}: {
  mes: string;
  hoje: string;
  baseQuery: string;
  filtrosAtivos: boolean;
}) {
  const ano = Number(mes.slice(0, 4));
  const mesNumero = Number(mes.slice(5, 7));

  const primeiroDia = `${mes}-01`;
  // Aritmética em UTC puro: a grade é de dias civis, não de instantes, então
  // não há fuso envolvido em descobrir em que coluna cada dia cai.
  const diaDaSemanaInicial = new Date(Date.UTC(ano, mesNumero - 1, 1)).getUTCDay();
  const diasNoMes = new Date(Date.UTC(ano, mesNumero, 0)).getUTCDate();

  const inicioGrade = addDays(primeiroDia, -diaDaSemanaInicial);
  const totalCelulas = Math.ceil((diaDaSemanaInicial + diasNoMes) / 7) * 7;
  const fimGrade = addDays(inicioGrade, totalCelulas - 1);

  // Uma única consulta agregada cobre a grade inteira, inclusive as sobras dos
  // meses vizinhos que aparecem na primeira e na última semana.
  const ocupacao = await getOccupancyByDay(inicioGrade, fimGrade);

  return (
    <Calendario
      mes={mes}
      hoje={hoje}
      inicioGrade={inicioGrade}
      totalCelulas={totalCelulas}
      diasNoMes={diasNoMes}
      ocupacao={ocupacao}
      baseQuery={baseQuery}
      filtrosAtivos={filtrosAtivos}
    />
  );
}
