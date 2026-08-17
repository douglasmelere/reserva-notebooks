import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  TableWrapper,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui/primitives";
import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  INCIDENT_TARGET_LABEL,
  listIncidents,
  type IncidentDTO,
} from "@/server/incidents";
import type { IncidentSeverity, IncidentStatus } from "@/generated/prisma/enums";
import { FiltrosOcorrencias } from "./filtros";

export const dynamic = "force-dynamic";

export const metadata = { title: "Ocorrências" };

const POR_PAGINA = 50;

const TOM_STATUS: Record<IncidentStatus, BadgeTone> = {
  ABERTA: "warning",
  EM_ANALISE: "info",
  EM_MANUTENCAO: "warning",
  RESOLVIDA: "success",
  DESCARTADA: "muted",
  RECORRENTE: "danger",
};

const TOM_SEVERIDADE: Record<IncidentSeverity, BadgeTone> = {
  BAIXA: "muted",
  MEDIA: "warning",
  ALTA: "danger",
  CRITICA: "danger",
};

/** Peso da triagem: o que dói mais aparece primeiro. */
const PESO_SEVERIDADE: Record<IncidentSeverity, number> = {
  CRITICA: 4,
  ALTA: 3,
  MEDIA: 2,
  BAIXA: 1,
};

const SEVERIDADES: IncidentSeverity[] = ["CRITICA", "ALTA", "MEDIA", "BAIXA"];

export default async function AdminOcorrenciasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSupervisor();
  const sp = await searchParams;

  const filtros = {
    status: comoChave(primeiro(sp.status), INCIDENT_STATUS_LABEL),
    severidade: comoChave(primeiro(sp.severidade), INCIDENT_SEVERITY_LABEL),
    categoria: comoChave(primeiro(sp.categoria), INCIDENT_CATEGORY_LABEL),
    alvo: comoChave(primeiro(sp.alvo), INCIDENT_TARGET_LABEL),
    de: comoData(primeiro(sp.de)),
    ate: comoData(primeiro(sp.ate)),
    busca: primeiro(sp.busca)?.trim() || undefined,
  };
  const pagina = Math.max(1, Number(primeiro(sp.pagina)) || 1);

  const filtrosComuns = {
    status: filtros.status ? [filtros.status] : undefined,
    category: filtros.categoria ? [filtros.categoria] : undefined,
    targetType: filtros.alvo,
    from: filtros.de,
    to: filtros.ate,
    busca: filtros.busca,
  };

  // Os contadores ignoram o filtro de severidade de propósito: eles servem para
  // decidir por onde começar a triagem, e zerariam três dos quatro cartões se
  // respeitassem a severidade já selecionada.
  const [resultado, ...contagens] = await Promise.all([
    listIncidents(
      {
        ...filtrosComuns,
        severity: filtros.severidade ? [filtros.severidade] : undefined,
        page: pagina,
        pageSize: POR_PAGINA,
      },
      user,
    ),
    ...SEVERIDADES.map((severidade) =>
      listIncidents(
        { ...filtrosComuns, severity: [severidade], page: 1, pageSize: 1 },
        user,
      ),
    ),
  ]);

  const totalPorSeveridade = new Map<IncidentSeverity, number>(
    SEVERIDADES.map((severidade, indice) => [
      severidade,
      contagens[indice]?.total ?? 0,
    ]),
  );

  // A ordenação de triagem é aplicada sobre a página trazida: o serviço entrega
  // as mais recentes primeiro, e aqui as críticas e antigas sobem.
  const itens = [...resultado.items].sort(
    (a, b) =>
      PESO_SEVERIDADE[b.severity] - PESO_SEVERIDADE[a.severity] ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  const totalPaginas = Math.max(1, Math.ceil(resultado.total / POR_PAGINA));

  /** Mantém os filtros atuais ao trocar de página ou de severidade. */
  const comFiltros = (mudanca: Record<string, string | undefined>): string => {
    const params = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      status: filtros.status,
      severidade: filtros.severidade,
      categoria: filtros.categoria,
      alvo: filtros.alvo,
      de: filtros.de,
      ate: filtros.ate,
      busca: filtros.busca,
      ...mudanca,
    };
    for (const [chave, valor] of Object.entries(base)) {
      if (valor) params.set(chave, valor);
    }
    const qs = params.toString();
    return `/admin/ocorrencias${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Ocorrências"
        description="Fila de problemas relatados pelos docentes e pela própria supervisão."
      />

      <h2 className="sr-only">Resumo por severidade</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SEVERIDADES.map((severidade) => {
          const ativo = filtros.severidade === severidade;
          return (
            <Link
              key={severidade}
              // Clicar de novo na severidade já ativa remove o filtro.
              href={comFiltros({
                severidade: ativo ? undefined : severidade,
                pagina: undefined,
              })}
              aria-current={ativo ? "true" : undefined}
              // O anel reforça o cartão ativo para quem enxerga; quem não
              // enxerga tem o `aria-current` e a dica escrita dentro do cartão.
              className={`block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                ativo ? "ring-2 ring-sky-700 ring-offset-2" : ""
              }`}
            >
              <Stat
                label={`Severidade ${INCIDENT_SEVERITY_LABEL[severidade]}`}
                value={totalPorSeveridade.get(severidade) ?? 0}
                tone={TOM_SEVERIDADE[severidade]}
                hint={ativo ? "Filtro ativo — clique para remover" : "Clique para filtrar"}
              />
            </Link>
          );
        })}
      </div>

      <div className="mt-4">
        <FiltrosOcorrencias
          valores={{
            status: filtros.status ?? "",
            severidade: filtros.severidade ?? "",
            categoria: filtros.categoria ?? "",
            alvo: filtros.alvo ?? "",
            de: filtros.de ?? "",
            ate: filtros.ate ?? "",
            busca: filtros.busca ?? "",
          }}
          statusOpcoes={opcoes(INCIDENT_STATUS_LABEL)}
          severidadeOpcoes={opcoes(INCIDENT_SEVERITY_LABEL)}
          categoriaOpcoes={opcoes(INCIDENT_CATEGORY_LABEL)}
          alvoOpcoes={opcoes(INCIDENT_TARGET_LABEL)}
        />
      </div>

      {/* Filtrar troca a lista sem sair da tela: sem esta região o leitor de
          tela não teria como saber que o resultado mudou. */}
      <p role="status" className="sr-only">
        {resultado.total === 1
          ? "1 ocorrência encontrada com os filtros atuais."
          : `${resultado.total} ocorrências encontradas com os filtros atuais.`}
      </p>

      <Card className="mt-4">
        <CardHeader
          title={
            resultado.total === 1
              ? "1 ocorrência encontrada"
              : `${resultado.total} ocorrências encontradas`
          }
          description="Ordenadas por gravidade e, dentro da mesma gravidade, da mais antiga para a mais recente. A ordenação vale para a página exibida."
        />
        <CardBody>
          {itens.length === 0 ? (
            // `?pagina=` é escrita na URL e pode passar da última página: aí a
            // fila tem resultado, mas esta página não — e mandar "amplie o
            // período" seria conselho errado.
            resultado.total > 0 ? (
              <EmptyState
                title="Esta página não tem ocorrências"
                description={`O recorte atual vai até a página ${totalPaginas}. Volte para a primeira página para ver a fila.`}
                action={
                  <Link href={comFiltros({ pagina: undefined })} className={BOTAO_SECUNDARIO}>
                    Ir para a primeira página
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="Nenhuma ocorrência com esses filtros"
                description="Amplie o período, limpe a busca ou tire o filtro de situação. Se a fila está mesmo vazia, não há nada pendente de análise no recorte escolhido."
              />
            )
          ) : (
            <>
              {/* Celular: cartão por ocorrência. A tabela tem colunas demais
                  para caber em 360px sem virar sopa de letras. */}
              <ul className="flex flex-col gap-3 md:hidden">
                {itens.map((ocorrencia) => (
                  <li key={ocorrencia.id}>
                    <CartaoOcorrencia ocorrencia={ocorrencia} />
                  </li>
                ))}
              </ul>

              <div className="hidden md:block">
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>Ocorrência</Th>
                      <Th>Categoria</Th>
                      <Th>Severidade</Th>
                      <Th>Situação</Th>
                      <Th>Responsável</Th>
                      <Th>Aberta em</Th>
                      <Th>
                        <span className="sr-only">Ações</span>
                      </Th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((ocorrencia) => (
                      <tr key={ocorrencia.id}>
                        <Td>
                          <span className="font-medium text-slate-900">
                            {ocorrencia.code}
                          </span>
                          <span className="block text-xs text-slate-600">
                            {ocorrencia.alvoLabel}
                          </span>
                          {ocorrencia.recursoBloqueado && (
                            <Badge tone="danger" className="mt-1">
                              Bloqueado
                            </Badge>
                          )}
                        </Td>
                        <Td>{ocorrencia.categoryLabel}</Td>
                        <Td>
                          <Badge tone={TOM_SEVERIDADE[ocorrencia.severity]}>
                            {ocorrencia.severityLabel}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge tone={TOM_STATUS[ocorrencia.status]}>
                            {ocorrencia.statusLabel}
                          </Badge>
                        </Td>
                        <Td>
                          {ocorrencia.assignedTo?.fullName ?? (
                            <span className="text-slate-500">Sem responsável</span>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {formatDateTimeBR(new Date(ocorrencia.createdAt))}
                        </Td>
                        <Td>
                          <Link
                            href={`/admin/ocorrencias/${ocorrencia.id}`}
                            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-sky-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                          >
                            Abrir
                            <span className="sr-only"> a ocorrência {ocorrencia.code}</span>
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {totalPaginas > 1 && (
        <nav
          aria-label="Paginação das ocorrências"
          className="mt-4 flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-slate-600">
            Página {pagina} de {totalPaginas}
          </p>
          <div className="flex gap-2">
            {pagina > 1 && (
              <Link
                href={comFiltros({ pagina: String(pagina - 1) })}
                className={BOTAO_SECUNDARIO}
              >
                Anterior
              </Link>
            )}
            {pagina < totalPaginas && (
              <Link
                href={comFiltros({ pagina: String(pagina + 1) })}
                className={BOTAO_SECUNDARIO}
              >
                Próxima
              </Link>
            )}
          </div>
        </nav>
      )}
    </>
  );
}

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function CartaoOcorrencia({ ocorrencia }: { ocorrencia: IncidentDTO }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone={TOM_SEVERIDADE[ocorrencia.severity]}>
          Severidade: {ocorrencia.severityLabel}
        </Badge>
        <Badge tone={TOM_STATUS[ocorrencia.status]}>{ocorrencia.statusLabel}</Badge>
        {ocorrencia.recursoBloqueado && <Badge tone="danger">Bloqueado</Badge>}
      </div>
      <p className="mt-2 text-sm font-semibold break-words text-slate-900">
        {ocorrencia.code} · {ocorrencia.alvoLabel}
      </p>
      <p className="text-sm text-slate-600">
        {ocorrencia.categoryLabel} · {formatDateTimeBR(new Date(ocorrencia.createdAt))}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Relatada por {ocorrencia.reportedBy.fullName} ·{" "}
        {ocorrencia.assignedTo
          ? `responsável: ${ocorrencia.assignedTo.fullName}`
          : "sem responsável"}
      </p>
      <Link
        href={`/admin/ocorrencias/${ocorrencia.id}`}
        className="mt-2 inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-sky-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
      >
        Abrir ocorrência
        <span className="sr-only"> {ocorrencia.code}</span>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leitura dos filtros da URL
// ---------------------------------------------------------------------------

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Aceita da URL apenas valores que existem no vocabulário do domínio.
 *
 * A query string é escrita pelo usuário; um enum inventado chegaria ao Prisma e
 * derrubaria a consulta.
 */
function comoChave<T extends string>(
  valor: string | undefined,
  mapa: Record<T, string>,
): T | undefined {
  return valor && Object.hasOwn(mapa, valor) ? (valor as T) : undefined;
}

/** Só datas reais passam: `2026-02-31` derrubaria a conversão de fuso. */
function comoData(valor: string | undefined): string | undefined {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return undefined;
  const data = new Date(`${valor}T00:00:00Z`);
  return Number.isNaN(data.getTime()) || data.toISOString().slice(0, 10) !== valor
    ? undefined
    : valor;
}

function opcoes<T extends string>(
  mapa: Record<T, string>,
): { value: string; label: string }[] {
  return (Object.keys(mapa) as T[]).map((chave) => ({
    value: chave,
    label: mapa[chave],
  }));
}
