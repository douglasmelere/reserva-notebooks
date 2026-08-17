import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";
import { listChargerKits } from "@/server/chargers";
import { listKits } from "@/server/kits";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  type BadgeTone,
} from "@/components/ui/primitives";
import type { ChargerKitStatus } from "@/generated/prisma/enums";
import {
  AcoesDoKitDeCarregadores,
  NovoKitDeCarregadores,
  type KitVinculavel,
} from "./form";

export const dynamic = "force-dynamic";

const TAMANHO_DA_PAGINA = 24;

const TOM_DO_STATUS: Record<ChargerKitStatus, BadgeTone> = {
  COMPLETO: "success",
  INCOMPLETO: "warning",
  MANUTENCAO: "warning",
  INDISPONIVEL: "danger",
  DESATIVADO: "muted",
};

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

function texto(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const limpo = bruto?.trim();
  return limpo ? limpo : undefined;
}

export default async function CarregadoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requireSupervisor();

  const incluirDesativados = texto(sp.desativados) === "1";
  const pagina = Math.max(1, Number(texto(sp.pagina) ?? "1") || 1);

  const [resultado, kits] = await Promise.all([
    listChargerKits(
      {
        includeInactive: incluirDesativados,
        page: pagina,
        pageSize: TAMANHO_DA_PAGINA,
      },
      actor,
    ),
    listKits({ pageSize: 100, includeInactive: true }, actor),
  ]);

  // Kits desativados só entram no seletor quando já têm um kit de carregadores
  // vinculado — do contrário seriam destinos inúteis.
  const kitsVinculaveis: KitVinculavel[] = kits.items
    .filter((kit) => kit.status !== "DESATIVADO" || kit.chargerKit !== null)
    .map((kit) => ({
      id: kit.id,
      code: kit.code,
      name: kit.name,
      chargerKitCode: kit.chargerKit?.code ?? null,
    }));

  const ultimaPagina = Math.max(
    1,
    Math.ceil(resultado.total / resultado.pageSize),
  );

  const incompletos = resultado.items.filter(
    (item) => item.status === "INCOMPLETO",
  ).length;
  const pecasFaltando = resultado.items.reduce(
    (soma, item) => soma + item.faltando,
    0,
  );

  function hrefDaPagina(destino: number): string {
    const params = new URLSearchParams();
    if (incluirDesativados) params.set("desativados", "1");
    if (destino > 1) params.set("pagina", String(destino));
    const query = params.toString();
    return query ? `/admin/carregadores?${query}` : "/admin/carregadores";
  }

  return (
    <>
      <PageHeader
        title="Kits de carregadores"
        description="Cada maleta ou carrinho leva um kit de carregadores. É o item que mais some — daí o par “quantos deveriam existir” e “quantos estão lá”."
        action={
          <Link
            href={
              incluirDesativados
                ? "/admin/carregadores"
                : "/admin/carregadores?desativados=1"
            }
            className={BOTAO_SECUNDARIO}
          >
            {incluirDesativados ? "Ocultar desativados" : "Mostrar desativados"}
          </Link>
        }
      />

      <Alert tone="info" title="Como o status é definido">
        <p>
          <strong>Completo</strong> e <strong>Incompleto</strong> são calculados
          pelo sistema: se a quantidade disponível alcança a total, o kit é
          completo; se não, é incompleto. O cálculo é refeito a cada gravação, e
          por isso não existe opção para digitá-los.
        </p>
        <p className="mt-1">
          A supervisão define manualmente apenas{" "}
          <strong>Em manutenção</strong> e <strong>Indisponível</strong>. Esses
          dois permanecem mesmo que as quantidades mudem — corrigir a contagem
          de um kit em manutenção não pode devolvê-lo ao uso sem alguém decidir.
        </p>
      </Alert>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Kits de carregadores"
          value={resultado.total}
          hint={incluirDesativados ? "incluindo desativados" : "em operação"}
        />
        <Stat
          label="Incompletos"
          value={incompletos}
          tone={incompletos > 0 ? "warning" : "success"}
          hint="nesta página"
        />
        <Stat
          label="Carregadores faltando"
          value={pecasFaltando}
          tone={pecasFaltando > 0 ? "warning" : "success"}
          hint="nesta página: soma do que falta em cada kit"
        />
      </div>

      <div className="mt-4">
        <NovoKitDeCarregadores kits={kitsVinculaveis} />
      </div>

      <div className="mt-4">
        {resultado.items.length === 0 ? (
          <EmptyState
            title="Nenhum kit de carregadores cadastrado"
            description="Cadastre um kit informando quantos carregadores ele deveria ter e quantos estão presentes; depois vincule-o à maleta ou carrinho correspondente."
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {resultado.items.map((carregador) => (
              <li key={carregador.id}>
                <Card className="h-full">
                  <CardHeader
                    title={carregador.code}
                    description={
                      carregador.kit
                        ? `Vinculado a ${carregador.kit.name} (${carregador.kit.code})`
                        : "Sem maleta/carrinho vinculado"
                    }
                    action={
                      <Badge tone={TOM_DO_STATUS[carregador.status]}>
                        {carregador.statusLabel}
                      </Badge>
                    }
                  />
                  <CardBody className="flex flex-col gap-4">
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">Total</dt>
                        <dd className="text-lg font-semibold text-slate-900 tabular-nums">
                          {carregador.totalQuantity}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Disponíveis</dt>
                        <dd className="text-lg font-semibold text-slate-900 tabular-nums">
                          {carregador.availableQuantity}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Faltam</dt>
                        <dd
                          className={
                            carregador.faltando > 0
                              ? "text-lg font-semibold text-amber-700 tabular-nums"
                              : "text-lg font-semibold text-emerald-700 tabular-nums"
                          }
                        >
                          {carregador.faltando}
                        </dd>
                      </div>
                    </dl>

                    {carregador.statusManual && (
                      <p className="text-xs text-slate-600">
                        Status definido manualmente pela supervisão: ele
                        permanece até alguém escolher “automático”.
                      </p>
                    )}

                    {carregador.missingParts && (
                      <div className="text-sm">
                        <p className="text-xs text-slate-500">
                          Peças faltantes
                        </p>
                        <p className="text-slate-800">
                          {carregador.missingParts}
                        </p>
                      </div>
                    )}

                    {carregador.notes && (
                      <div className="text-sm">
                        <p className="text-xs text-slate-500">Observações</p>
                        <p className="whitespace-pre-line text-slate-800">
                          {carregador.notes}
                        </p>
                      </div>
                    )}

                    {carregador.kit && (
                      // Link de ação isolado: precisa da mesma altura de toque
                      // (44px) dos demais botões da tela.
                      <Link
                        href={`/admin/kits/${carregador.kit.id}`}
                        className="inline-flex min-h-11 items-center text-sm font-medium text-sky-800 underline underline-offset-2"
                      >
                        Abrir {carregador.kit.name}
                        <span className="sr-only">
                          , a maleta/carrinho vinculada a {carregador.code}
                        </span>
                      </Link>
                    )}

                    <AcoesDoKitDeCarregadores
                      carregador={{
                        id: carregador.id,
                        code: carregador.code,
                        kitId: carregador.kit?.id ?? null,
                        totalQuantity: carregador.totalQuantity,
                        availableQuantity: carregador.availableQuantity,
                        missingParts: carregador.missingParts,
                        notes: carregador.notes,
                        status: carregador.status,
                      }}
                      kits={kitsVinculaveis}
                    />
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}

        {ultimaPagina > 1 && (
          <nav
            aria-label="Paginação dos kits de carregadores"
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
      </div>
    </>
  );
}
