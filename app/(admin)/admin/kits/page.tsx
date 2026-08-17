import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";
import { listKits, type KitSummary } from "@/server/kits";
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
import type { KitStatus, KitType } from "@/generated/prisma/enums";
import { FiltrosDeKits } from "./filtros";

/** Lê sessão e banco a cada acesso: inventário nunca pode vir de cache. */
export const dynamic = "force-dynamic";

const TAMANHO_DA_PAGINA = 20;

const TIPOS: KitType[] = ["MALETA", "CARRINHO"];
const STATUS: KitStatus[] = [
  "DISPONIVEL",
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
];

const TIPO_LABEL: Record<KitType, string> = {
  MALETA: "Maleta",
  CARRINHO: "Carrinho",
};

/**
 * Cor é reforço, nunca o único sinal: o rótulo em português vai sempre junto
 * dentro do `Badge`.
 */
const TOM_DO_STATUS: Record<KitStatus, BadgeTone> = {
  DISPONIVEL: "success",
  MANUTENCAO: "warning",
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

/** Situação da composição: quantos notebooks o kit tem contra a capacidade. */
function composicao(kit: KitSummary): { tom: BadgeTone; texto: string } {
  if (kit.capacidadeExcedida) {
    return {
      tom: "danger",
      texto: `${kit.notebookCount} de ${kit.capacity} — acima da capacidade`,
    };
  }
  if (kit.notebookCount < kit.capacity) {
    return {
      tom: "warning",
      texto: `${kit.notebookCount} de ${kit.capacity} — faltam ${kit.capacity - kit.notebookCount}`,
    };
  }
  return { tom: "success", texto: `${kit.notebookCount} de ${kit.capacity}` };
}

/** Situação do kit de carregadores que acompanha a maleta/carrinho. */
function carregadores(kit: KitSummary): { tom: BadgeTone; texto: string } {
  const carregador = kit.chargerKit;
  if (!carregador) return { tom: "muted", texto: "Sem kit de carregadores" };

  if (carregador.status === "MANUTENCAO") {
    return { tom: "warning", texto: "Carregadores em manutenção" };
  }
  if (carregador.status === "INDISPONIVEL") {
    return { tom: "danger", texto: "Carregadores indisponíveis" };
  }
  if (carregador.status === "DESATIVADO") {
    return { tom: "muted", texto: "Carregadores desativados" };
  }
  if (carregador.faltando > 0) {
    return {
      tom: "warning",
      texto: `Faltam ${carregador.faltando} de ${carregador.totalQuantity}`,
    };
  }
  return {
    tom: "success",
    texto: `Completo (${carregador.availableQuantity}/${carregador.totalQuantity})`,
  };
}

export default async function KitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  // O layout de /admin já barrou quem não é da supervisão; aqui o que
  // interessa é o `actor`, que o serviço usa para decidir o recorte dos dados.
  const actor = await requireSupervisor();

  const tipo = TIPOS.find((t) => t === texto(sp.tipo));
  const status = STATUS.find((s) => s === texto(sp.status));
  const local = texto(sp.local);
  const busca = texto(sp.busca);
  const incluirDesativados = texto(sp.desativados) === "1";
  const pagina = Math.max(1, Number(texto(sp.pagina) ?? "1") || 1);

  const resultado = await listKits(
    {
      type: tipo,
      status: status ? [status] : undefined,
      location: local,
      search: busca,
      includeInactive: incluirDesativados,
      page: pagina,
      pageSize: TAMANHO_DA_PAGINA,
    },
    actor,
  );

  const temFiltro = Boolean(tipo || status || local || busca || incluirDesativados);
  const ultimaPagina = Math.max(
    1,
    Math.ceil(resultado.total / resultado.pageSize),
  );

  const divergentes = resultado.items.filter(
    (kit) => kit.notebookCount !== kit.capacity,
  ).length;
  const carregadoresIncompletos = resultado.items.filter(
    (kit) => kit.chargerKit !== null && !kit.chargerKit.completo,
  ).length;

  /** Mantém os filtros ativos ao trocar de página. */
  function hrefDaPagina(destino: number): string {
    const params = new URLSearchParams();
    if (tipo) params.set("tipo", tipo);
    if (status) params.set("status", status);
    if (local) params.set("local", local);
    if (busca) params.set("busca", busca);
    if (incluirDesativados) params.set("desativados", "1");
    if (destino > 1) params.set("pagina", String(destino));
    const query = params.toString();
    return query ? `/admin/kits?${query}` : "/admin/kits";
  }

  return (
    <>
      <PageHeader
        title="Kits: maletas e carrinhos"
        description="Inventário dos conjuntos que os professores reservam. Cada kit tem capacidade planejada, notebooks vinculados e um kit de carregadores."
        action={
          <>
            <Link href="/admin/kits/novo" className={BOTAO_PRIMARIO}>
              <span aria-hidden="true">＋</span> Cadastrar kit
            </Link>
            <Link href="/admin/carregadores" className={BOTAO_SECUNDARIO}>
              Ver carregadores
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Kits encontrados"
          value={resultado.total}
          hint={temFiltro ? "com os filtros aplicados" : "no inventário ativo"}
        />
        <Stat
          label="Composição divergente"
          value={divergentes}
          tone={divergentes > 0 ? "warning" : "success"}
          hint="nesta página: nº de notebooks diferente da capacidade"
        />
        <Stat
          label="Carregadores incompletos"
          value={carregadoresIncompletos}
          tone={carregadoresIncompletos > 0 ? "warning" : "success"}
          hint="nesta página: faltam peças no kit de carregadores"
        />
      </div>

      <div className="mt-4">
        <FiltrosDeKits
          tipo={tipo ?? ""}
          status={status ?? ""}
          local={local ?? ""}
          busca={busca ?? ""}
          incluirDesativados={incluirDesativados}
        />
      </div>

      <div className="mt-4">
        {resultado.items.length === 0 ? (
          <EmptyState
            title={
              temFiltro
                ? "Nenhum kit corresponde aos filtros"
                : "Nenhum kit cadastrado ainda"
            }
            description={
              temFiltro
                ? "Ajuste ou limpe os filtros acima. Kits desativados só aparecem quando você marca “incluir desativados”."
                : "Cadastre a primeira maleta ou carrinho para que os professores possam reservá-la. Depois vincule os notebooks e o kit de carregadores."
            }
            // Com filtro aplicado, o caminho de saída é limpar o recorte — e
            // não cadastrar um kit, que provavelmente já existe e só está
            // escondido pelos filtros.
            action={
              temFiltro ? (
                <Link href="/admin/kits" className={BOTAO_PRIMARIO}>
                  Limpar filtros
                </Link>
              ) : (
                <Link href="/admin/kits/novo" className={BOTAO_PRIMARIO}>
                  Cadastrar kit
                </Link>
              )
            }
          />
        ) : (
          <>
            {/* Celular: cartões empilhados. A tabela tem 8 colunas e ficaria
                ilegível espremida em 360px. */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {resultado.items.map((kit) => {
                const comp = composicao(kit);
                const carr = carregadores(kit);
                return (
                  <li key={kit.id}>
                    <Card>
                      <CardBody className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">
                              {kit.name}
                            </p>
                            <p className="text-sm text-slate-600">
                              {TIPO_LABEL[kit.type]} · código {kit.code}
                            </p>
                          </div>
                          <Badge tone={TOM_DO_STATUS[kit.status]}>
                            {kit.statusLabel}
                          </Badge>
                        </div>

                        {/* Uma coluna por padrão: os selos não quebram linha e
                            textos como “acima da capacidade” esticariam a
                            coluna, empurrando a página inteira para o lado em
                            telas de 360px. */}
                        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                          <div className="min-w-0">
                            <dt className="text-xs text-slate-500">Notebooks</dt>
                            <dd className="mt-0.5">
                              <Badge tone={comp.tom}>{comp.texto}</Badge>
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-xs text-slate-500">
                              Carregadores
                            </dt>
                            <dd className="mt-0.5">
                              <Badge tone={carr.tom}>{carr.texto}</Badge>
                            </dd>
                          </div>
                          <div className="min-w-0 sm:col-span-2">
                            <dt className="text-xs text-slate-500">
                              Localização
                            </dt>
                            <dd className="text-slate-800">
                              {kit.location ?? "Não informada"}
                            </dd>
                          </div>
                        </dl>

                        <Link
                          href={`/admin/kits/${kit.id}`}
                          className={BOTAO_SECUNDARIO}
                        >
                          Abrir kit
                        </Link>
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>

            <Card className="hidden lg:block">
              <CardHeader
                title="Kits cadastrados"
                description={`${resultado.total} kit(s) — página ${resultado.page} de ${ultimaPagina}`}
              />
              <TableWrapper>
                <caption className="sr-only">
                  Lista de maletas e carrinhos com capacidade, notebooks
                  vinculados, situação dos carregadores e status.
                </caption>
                <thead>
                  <tr>
                    <Th>Código</Th>
                    <Th>Nome</Th>
                    <Th>Tipo</Th>
                    <Th>Capacidade</Th>
                    <Th>Notebooks</Th>
                    <Th>Carregadores</Th>
                    <Th>Localização</Th>
                    <Th>Status</Th>
                    <Th>
                      <span className="sr-only">Ações</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.items.map((kit) => {
                    const comp = composicao(kit);
                    const carr = carregadores(kit);
                    return (
                      <tr key={kit.id} className="hover:bg-slate-50">
                        <Td className="font-mono text-xs text-slate-700">
                          {kit.code}
                        </Td>
                        <Td className="font-medium text-slate-900">
                          {kit.name}
                        </Td>
                        <Td>{TIPO_LABEL[kit.type]}</Td>
                        <Td className="tabular-nums">{kit.capacity}</Td>
                        <Td>
                          <Badge tone={comp.tom}>{comp.texto}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={carr.tom}>{carr.texto}</Badge>
                        </Td>
                        <Td>{kit.location ?? "—"}</Td>
                        <Td>
                          <Badge tone={TOM_DO_STATUS[kit.status]}>
                            {kit.statusLabel}
                          </Badge>
                        </Td>
                        <Td>
                          <Link
                            href={`/admin/kits/${kit.id}`}
                            className="inline-flex min-h-11 items-center font-medium text-sky-800 underline underline-offset-2 hover:text-sky-900"
                          >
                            Abrir
                            <span className="sr-only"> o kit {kit.name}</span>
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrapper>
            </Card>

            {ultimaPagina > 1 && (
              <nav
                aria-label="Paginação dos kits"
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
