import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";
import { listKits } from "@/server/kits";
import { listNotebooks } from "@/server/notebooks";
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
import type { NotebookStatus } from "@/generated/prisma/enums";
import { FiltrosDeNotebooks } from "./filtros";

export const dynamic = "force-dynamic";

const TAMANHO_DA_PAGINA = 20;

const STATUS: NotebookStatus[] = [
  "DISPONIVEL",
  "RESERVADO",
  "EM_USO",
  "MANUTENCAO",
  "PERDIDO",
  "INDISPONIVEL",
  "DESATIVADO",
];

const TOM_DO_STATUS: Record<NotebookStatus, BadgeTone> = {
  DISPONIVEL: "success",
  RESERVADO: "info",
  EM_USO: "info",
  MANUTENCAO: "warning",
  PERDIDO: "danger",
  INDISPONIVEL: "danger",
  DESATIVADO: "muted",
};

const BOTAO_PRIMARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700";
const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function texto(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const limpo = bruto?.trim();
  return limpo ? limpo : undefined;
}

export default async function NotebooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requireSupervisor();

  const status = STATUS.find((s) => s === texto(sp.status));
  const kitId = texto(sp.kit);
  const avulsos = texto(sp.avulsos) === "1";
  const busca = texto(sp.busca);
  const pagina = Math.max(1, Number(texto(sp.pagina) ?? "1") || 1);

  // Os kits alimentam o filtro e precisam incluir os desativados: um notebook
  // pode continuar vinculado a um kit fora de operação, e esconder o kit do
  // seletor deixaria esses equipamentos sem como filtrar.
  const [resultado, kits] = await Promise.all([
    listNotebooks(
      {
        status: status ? [status] : undefined,
        kitId: avulsos ? undefined : kitId,
        avulsos,
        search: busca,
        page: pagina,
        pageSize: TAMANHO_DA_PAGINA,
      },
      actor,
    ),
    listKits({ pageSize: 100, includeInactive: true }, actor),
  ]);

  const temFiltro = Boolean(status || kitId || avulsos || busca);
  const ultimaPagina = Math.max(
    1,
    Math.ceil(resultado.total / resultado.pageSize),
  );

  const semKit = resultado.items.filter((n) => n.kit === null).length;
  const foraDeCirculacao = resultado.items.filter((n) =>
    ["MANUTENCAO", "PERDIDO", "INDISPONIVEL"].includes(n.status),
  ).length;

  function hrefDaPagina(destino: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (kitId && !avulsos) params.set("kit", kitId);
    if (avulsos) params.set("avulsos", "1");
    if (busca) params.set("busca", busca);
    if (destino > 1) params.set("pagina", String(destino));
    const query = params.toString();
    return query ? `/admin/notebooks?${query}` : "/admin/notebooks";
  }

  return (
    <>
      <PageHeader
        title="Notebooks"
        description="Todos os equipamentos do inventário, dentro de kits ou avulsos."
        action={
          <>
            <Link href="/admin/notebooks/novo" className={BOTAO_PRIMARIO}>
              <span aria-hidden="true">＋</span> Cadastrar notebook
            </Link>
            <Link href="/admin/notebooks/lote" className={BOTAO_SECUNDARIO}>
              Cadastrar em lote
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Equipamentos encontrados"
          value={resultado.total}
          hint={temFiltro ? "com os filtros aplicados" : "no inventário"}
        />
        <Stat
          label="Avulsos"
          value={semKit}
          hint="nesta página: sem kit vinculado"
        />
        <Stat
          label="Fora de circulação"
          value={foraDeCirculacao}
          tone={foraDeCirculacao > 0 ? "warning" : "success"}
          hint="nesta página: manutenção, perdido ou indisponível"
        />
      </div>

      <div className="mt-4">
        <FiltrosDeNotebooks
          status={status ?? ""}
          kitId={avulsos ? "" : (kitId ?? "")}
          avulsos={avulsos}
          busca={busca ?? ""}
          kits={kits.items.map((kit) => ({
            id: kit.id,
            code: kit.code,
            name: kit.name,
          }))}
        />
      </div>

      <div className="mt-4">
        {resultado.items.length === 0 ? (
          <EmptyState
            title={
              temFiltro
                ? "Nenhum notebook corresponde aos filtros"
                : "Nenhum notebook cadastrado ainda"
            }
            description={
              temFiltro
                ? "Ajuste o status, o kit ou a busca. A busca procura por patrimônio, número de série e apelido."
                : "Cadastre os equipamentos um a um ou use o cadastro em lote, que gera patrimônios sequenciais a partir de um prefixo."
            }
            // Com filtro aplicado, o caminho de saída é limpar o recorte — e
            // não cadastrar equipamento, que provavelmente já existe e só está
            // escondido pelos filtros.
            action={
              temFiltro ? (
                <Link href="/admin/notebooks" className={BOTAO_PRIMARIO}>
                  Limpar filtros
                </Link>
              ) : (
                <Link href="/admin/notebooks/lote" className={BOTAO_PRIMARIO}>
                  Cadastrar em lote
                </Link>
              )
            }
          />
        ) : (
          <>
            {/* Celular: cartões. São 8 colunas — a tabela só aparece no
                desktop, e mesmo lá dentro de um contêiner que rola sozinho. */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {resultado.items.map((notebook) => (
                <li key={notebook.id}>
                  <Card>
                    <CardBody className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono font-semibold text-slate-900">
                            {notebook.assetTag}
                          </p>
                          <p className="text-sm text-slate-600">
                            {notebook.nickname ??
                              ([notebook.brand, notebook.model]
                                .filter(Boolean)
                                .join(" ") ||
                                "Sem apelido")}
                          </p>
                        </div>
                        <Badge tone={TOM_DO_STATUS[notebook.status]}>
                          {notebook.statusLabel}
                        </Badge>
                      </div>

                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        {/* Nome de kit e número de série são textos livres e
                            podem vir sem espaços; sem `min-w-0` + quebra, um
                            valor longo estica a coluna e a página passa a rolar
                            na horizontal no celular. */}
                        <div className="min-w-0">
                          <dt className="text-xs text-slate-500">Kit</dt>
                          <dd className="break-words text-slate-800">
                            {notebook.kit ? notebook.kit.name : "Avulso"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-slate-500">Série</dt>
                          <dd className="break-words text-slate-800">
                            {notebook.serialNumber ?? "—"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-slate-500">
                            Ocorrências
                          </dt>
                          <dd className="text-slate-800 tabular-nums">
                            {notebook.totalOcorrencias}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-xs text-slate-500">Reservas</dt>
                          <dd className="text-slate-800 tabular-nums">
                            {notebook.totalReservas}
                          </dd>
                        </div>
                      </dl>

                      <Link
                        href={`/admin/notebooks/${notebook.id}`}
                        className={BOTAO_SECUNDARIO}
                      >
                        Abrir equipamento
                      </Link>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>

            <Card className="hidden lg:block">
              <CardHeader
                title="Equipamentos"
                description={`${resultado.total} notebook(s) — página ${resultado.page} de ${ultimaPagina}`}
              />
              <TableWrapper>
                <caption className="sr-only">
                  Lista de notebooks com apelido, marca, série, kit, status e
                  número de ocorrências.
                </caption>
                <thead>
                  <tr>
                    <Th>Patrimônio</Th>
                    <Th>Apelido</Th>
                    <Th>Marca / modelo</Th>
                    <Th>Série</Th>
                    <Th>Kit</Th>
                    <Th>Status</Th>
                    <Th>Ocorrências</Th>
                    <Th>
                      <span className="sr-only">Ações</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.items.map((notebook) => (
                    <tr key={notebook.id} className="hover:bg-slate-50">
                      <Td className="font-mono text-xs text-slate-700">
                        {notebook.assetTag}
                      </Td>
                      <Td className="font-medium text-slate-900">
                        {notebook.nickname ?? "—"}
                      </Td>
                      <Td>
                        {[notebook.brand, notebook.model]
                          .filter(Boolean)
                          .join(" ") || "—"}
                      </Td>
                      <Td className="font-mono text-xs">
                        {notebook.serialNumber ?? "—"}
                      </Td>
                      <Td>
                        {notebook.kit ? (
                          <Link
                            href={`/admin/kits/${notebook.kit.id}`}
                            className="text-sky-800 underline underline-offset-2"
                          >
                            {notebook.kit.name}
                          </Link>
                        ) : (
                          <Badge tone="neutral">Avulso</Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={TOM_DO_STATUS[notebook.status]}>
                          {notebook.statusLabel}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">
                        {notebook.totalOcorrencias}
                      </Td>
                      <Td>
                        <Link
                          href={`/admin/notebooks/${notebook.id}`}
                          className="inline-flex min-h-11 items-center font-medium text-sky-800 underline underline-offset-2 hover:text-sky-900"
                        >
                          Abrir
                          <span className="sr-only">
                            {" "}
                            o notebook {notebook.assetTag}
                          </span>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            </Card>

            {ultimaPagina > 1 && (
              <nav
                aria-label="Paginação dos notebooks"
                className="mt-4 flex flex-wrap items-center justify-between gap-3"
              >
                <p className="text-sm text-slate-600">
                  Página {resultado.page} de {ultimaPagina}
                </p>
                <div className="flex gap-2">
                  {resultado.page > 1 && (
                    <Link
                      href={hrefDaPagina(resultado.page - 1)}
                      className={BOTAO_SECUNDARIO}
                    >
                      ← Anterior
                    </Link>
                  )}
                  {resultado.page < ultimaPagina && (
                    <Link
                      href={hrefDaPagina(resultado.page + 1)}
                      className={BOTAO_SECUNDARIO}
                    >
                      Próxima →
                    </Link>
                  )}
                </div>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  );
}
