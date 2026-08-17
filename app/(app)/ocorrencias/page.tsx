import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  type BadgeTone,
} from "@/components/ui/primitives";
import { listIncidents } from "@/server/incidents";
import type { IncidentSeverity, IncidentStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export const metadata = { title: "Meus problemas" };

const POR_PAGINA = 20;

/**
 * Cor nunca é o único sinal: o selo sempre carrega o rótulo em texto. O mapa
 * existe só para reforçar visualmente a leitura de quem enxerga cor.
 */
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

const BOTAO_PRIMARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700";

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

export default async function MinhasOcorrenciasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // O layout de `(app)` já barrou quem não está autenticado; aqui `requireUser`
  // serve para obter o ator tipado que os serviços exigem.
  const user = await requireUser();
  const sp = await searchParams;

  const pagina = Math.max(1, Number(primeiro(sp.pagina)) || 1);

  // Para o professor, o recorte natural do serviço já é o certo: o que ele
  // registrou mais o que a supervisão abriu em uma reserva dele. O supervisor,
  // que também enxerga esta tela pelo menu "Meus problemas", precisa do filtro
  // explícito — sem ele veria a fila inteira da instituição aqui.
  const { items, total } = await listIncidents(
    {
      reportedById: user.role === "SUPERVISOR" ? user.id : undefined,
      page: pagina,
      pageSize: POR_PAGINA,
    },
    user,
  );

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <PageHeader
        title="Meus problemas"
        description="Ocorrências que você registrou nos equipamentos e o que a supervisão já respondeu."
        action={
          <Link href="/ocorrencias/nova" className={BOTAO_PRIMARIO}>
            <span aria-hidden="true">🛠️</span>
            Registrar problema
          </Link>
        }
      />

      {total === 0 ? (
        <EmptyState
          title="Você ainda não registrou nenhum problema"
          description="Notebook que não liga, carregador faltando na maleta, tela trincada: registre aqui para a supervisão tomar providência e para o equipamento não chegar quebrado na próxima aula."
          action={
            <Link href="/ocorrencias/nova" className={BOTAO_PRIMARIO}>
              Registrar problema
            </Link>
          }
        />
      ) : items.length === 0 ? (
        // `?pagina=` vem da URL e pode apontar para além da última página. Sem
        // este caso, a tela dizia "você ainda não registrou nenhum problema"
        // para quem tem registros — e sem nenhum caminho de volta.
        <EmptyState
          title="Esta página não tem ocorrências"
          description={`Sua lista vai até a página ${totalPaginas}. Volte para o começo para ver seus registros.`}
          action={
            <Link href="/ocorrencias" className={BOTAO_SECUNDARIO}>
              Ir para a primeira página
            </Link>
          }
        />
      ) : (
        <>
          <h2 className="sr-only">Lista de ocorrências</h2>
          <ul className="flex flex-col gap-3">
            {items.map((ocorrencia) => (
              <li key={ocorrencia.id}>
                <Card>
                  <CardBody className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={TOM_STATUS[ocorrencia.status]}>
                        {ocorrencia.statusLabel}
                      </Badge>
                      <Badge tone={TOM_SEVERIDADE[ocorrencia.severity]}>
                        Severidade: {ocorrencia.severityLabel}
                      </Badge>
                      {ocorrencia.recursoBloqueado && (
                        <Badge tone="danger">Equipamento bloqueado</Badge>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words text-slate-900">
                        {ocorrencia.code} · {ocorrencia.alvoLabel}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">
                        {ocorrencia.categoryLabel} · aberta em{" "}
                        {formatDateTimeBR(new Date(ocorrencia.createdAt))}
                      </p>
                      {/* Duas linhas bastam para reconhecer a ocorrência na lista;
                          o texto completo fica no detalhe. `break-words` porque
                          o relato é texto livre: um número de série colado sem
                          espaços empurraria o cartão além da tela do celular. */}
                      <p className="mt-2 line-clamp-2 text-sm break-words text-slate-700">
                        {ocorrencia.description}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/ocorrencias/${ocorrencia.id}`}
                        className={BOTAO_SECUNDARIO}
                      >
                        Ver detalhes
                        <span className="sr-only">
                          {" "}
                          da ocorrência {ocorrencia.code}
                        </span>
                      </Link>
                      {ocorrencia.attachments.length > 0 && (
                        <span className="text-xs text-slate-500">
                          {ocorrencia.attachments.length === 1
                            ? "1 foto anexada"
                            : `${ocorrencia.attachments.length} fotos anexadas`}
                        </span>
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>

          {totalPaginas > 1 && (
            <nav
              aria-label="Paginação das ocorrências"
              className="mt-4 flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-sm text-slate-600">
                Página {pagina} de {totalPaginas} · {total}{" "}
                {total === 1 ? "ocorrência" : "ocorrências"}
              </p>
              <div className="flex gap-2">
                {pagina > 1 && (
                  <Link
                    href={`/ocorrencias?pagina=${pagina - 1}`}
                    className={BOTAO_SECUNDARIO}
                  >
                    Anterior
                  </Link>
                )}
                {pagina < totalPaginas && (
                  <Link
                    href={`/ocorrencias?pagina=${pagina + 1}`}
                    className={BOTAO_SECUNDARIO}
                  >
                    Próxima
                  </Link>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </>
  );
}

/** `searchParams` pode repetir a chave; para estes filtros o primeiro valor basta. */
function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
