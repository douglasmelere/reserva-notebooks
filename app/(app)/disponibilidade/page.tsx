import Link from "next/link";
import { addDays, formatDateBR, todayLocal } from "@/lib/datetime";
import { getAvailability, getOccupancyByDay } from "@/server/availability";
import type { DayOccupancy } from "@/server/availability";
import type { KitType } from "@/generated/prisma/enums";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from "@/components/ui/primitives";
import { Filtros, type VisaoDisponibilidade } from "./filtros";
import { RecursoCard } from "./recurso-card";

export const dynamic = "force-dynamic";

/**
 * Consulta de disponibilidade.
 *
 * Server Component: lê o estado da tela da própria URL e chama os serviços
 * direto. Isso mantém a página compartilhável por link e evita um ir-e-voltar
 * de HTTP só para desenhar a primeira tela.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DIAS_SEMANA = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];
const DIAS_SEMANA_CURTO = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function primeiro(valor: string | string[] | undefined): string | undefined {
  const bruto = Array.isArray(valor) ? valor[0] : valor;
  const texto = bruto?.trim();
  return texto ? texto : undefined;
}

/**
 * Parâmetro vindo da URL é entrada do usuário: qualquer coisa pode chegar
 * aqui. Em vez de derrubar a tela, valores inválidos caem no padrão.
 */
function dataValida(valor: string | undefined, padrao: string): string {
  if (!valor || !DATE_RE.test(valor)) return padrao;
  try {
    // Reaproveita a validação de calendário do módulo de datas: "2026-02-31"
    // passa pela expressão regular, mas não existe.
    addDays(valor, 0);
    return valor;
  } catch {
    return padrao;
  }
}

function horaValida(valor: string | undefined): string | undefined {
  return valor && TIME_RE.test(valor) ? valor : undefined;
}

/**
 * Meio-dia UTC ao converter um dia civil para `Date`.
 *
 * "2026-08-17T00:00:00Z" exibido no fuso da instituição (UTC-3) cairia em
 * 16/08 — o meio-dia é seguro em qualquer fuso do país.
 */
function meioDiaDe(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00Z`);
}

/** 0 = segunda ... 6 = domingo (a semana escolar começa na segunda). */
function indiceDiaSemana(dateStr: string): number {
  return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function partesDaData(dateStr: string): { ano: number; mes: number } {
  const partes = dateStr.split("-");
  return { ano: Number(partes[0]), mes: Number(partes[1]) };
}

function primeiroDiaDoMes(dateStr: string): string {
  const { ano, mes } = partesDaData(dateStr);
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

function ultimoDiaDoMes(dateStr: string): string {
  const { ano, mes } = partesDaData(dateStr);
  // Dia 0 do mês seguinte é o último dia do mês atual.
  const dias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dias).padStart(2, "0")}`;
}

function listarDias(de: string, ate: string): string[] {
  const dias: string[] = [];
  let atual = de;
  // Datas ISO comparam corretamente como texto; o teto evita laço infinito
  // caso algum parâmetro estranho escape da validação.
  for (let i = 0; i < 400 && atual <= ate; i += 1) {
    dias.push(atual);
    atual = addDays(atual, 1);
  }
  return dias;
}

export default async function DisponibilidadePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const hoje = todayLocal();

  const date = dataValida(primeiro(sp.date), hoje);
  const startTime = horaValida(primeiro(sp.startTime));
  const endTime = horaValida(primeiro(sp.endTime));
  const kitTypeBruto = primeiro(sp.kitType);
  const kitType: KitType | undefined =
    kitTypeBruto === "MALETA" || kitTypeBruto === "CARRINHO"
      ? kitTypeBruto
      : undefined;
  const location = primeiro(sp.location);
  const search = primeiro(sp.search);
  const minCapacityBruto = Number(primeiro(sp.minCapacity));
  const minCapacity =
    Number.isInteger(minCapacityBruto) && minCapacityBruto > 0
      ? minCapacityBruto
      : undefined;

  const viewBruto = primeiro(sp.view);
  const view: VisaoDisponibilidade =
    viewBruto === "semana" || viewBruto === "mes" ? viewBruto : "dia";

  // Horário só pela metade é ignorado: o serviço exige as duas pontas, e
  // recusar a consulta por isso deixaria a tela vazia sem explicação.
  const intervaloCompleto = Boolean(startTime && endTime);

  const disponibilidade = await getAvailability({
    date,
    startTime: intervaloCompleto ? startTime : null,
    endTime: intervaloCompleto ? endTime : null,
    kitType,
    location,
    minCapacity,
    search,
    // Notebook dentro de kit já aparece representado pelo próprio kit; listá-lo
    // de novo dobraria a lista sem acrescentar informação.
    onlyStandaloneNotebooks: true,
  });

  const inicioDoPeriodo =
    view === "semana"
      ? addDays(date, -indiceDiaSemana(date))
      : view === "mes"
        ? primeiroDiaDoMes(date)
        : date;
  const fimDoPeriodo =
    view === "semana"
      ? addDays(inicioDoPeriodo, 6)
      : view === "mes"
        ? ultimoDiaDoMes(date)
        : date;

  const ocupacaoPorDia =
    view === "dia"
      ? []
      : await getOccupancyByDay(inicioDoPeriodo, fimDoPeriodo);

  const ocupacaoIndexada = new Map<string, DayOccupancy>(
    ocupacaoPorDia.map((dia) => [dia.date, dia]),
  );

  const dataAnterior =
    view === "dia"
      ? addDays(date, -1)
      : view === "semana"
        ? addDays(date, -7)
        : primeiroDiaDoMes(addDays(primeiroDiaDoMes(date), -1));
  const dataSeguinte =
    view === "dia"
      ? addDays(date, 1)
      : view === "semana"
        ? addDays(date, 7)
        : addDays(ultimoDiaDoMes(date), 1);

  /** Preserva os filtros ao trocar de dia, de período ou de visão. */
  function comFiltros(patch: Record<string, string | undefined>): string {
    const base: Record<string, string | undefined> = {
      date,
      startTime,
      endTime,
      kitType,
      location,
      minCapacity: minCapacity ? String(minCapacity) : undefined,
      search,
      view,
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(base)) {
      if (valor) params.set(chave, valor);
    }
    const query = params.toString();
    return query ? `/disponibilidade?${query}` : "/disponibilidade";
  }

  const tituloDoPeriodo =
    view === "dia"
      ? `${DIAS_SEMANA[indiceDiaSemana(date)]}, ${formatDateBR(meioDiaDe(date))}`
      : view === "semana"
        ? `Semana de ${formatDateBR(meioDiaDe(inicioDoPeriodo))} a ${formatDateBR(meioDiaDe(fimDoPeriodo))}`
        : new Intl.DateTimeFormat("pt-BR", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(meioDiaDe(inicioDoPeriodo));

  return (
    <>
      <PageHeader
        title="Disponibilidade"
        description="Veja o que está livre antes de reservar. O endereço desta página guarda os filtros — dá para salvar ou compartilhar o link."
      />

      <Filtros
        valores={{
          date,
          startTime: startTime ?? "",
          endTime: endTime ?? "",
          kitType: kitType ?? "",
          location: location ?? "",
          minCapacity: minCapacity ? String(minCapacity) : "",
          search: search ?? "",
          view,
        }}
      />

      <nav
        aria-label="Navegação entre períodos"
        className="mb-4 flex flex-wrap items-center justify-between gap-2"
      >
        <Link
          href={comFiltros({ date: dataAnterior })}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <span aria-hidden="true">←</span>
          <span className="ml-2">Anterior</span>
        </Link>

        <h2 className="text-center text-sm font-semibold text-slate-900 sm:text-base">
          {tituloDoPeriodo}
        </h2>

        <Link
          href={comFiltros({ date: dataSeguinte })}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <span className="mr-2">Próximo</span>
          <span aria-hidden="true">→</span>
        </Link>
      </nav>

      {view === "dia" ? (
        <VisaoDia
          disponibilidade={disponibilidade}
          date={date}
          hoje={hoje}
        />
      ) : (
        <>
          {/* Resumo do dia escolhido no filtro: a grade responde "que dias estão
              cheios?", e esta faixa responde "e o dia que eu escolhi?". */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold text-slate-900">
                {formatDateBR(meioDiaDe(date))}
                {date === hoje ? " (hoje)" : ""}
              </span>
              {" — "}
              {disponibilidade.resumo.kitsDisponiveis} kit(s) livre(s) e{" "}
              {disponibilidade.resumo.notebooksDisponiveis} notebook(s) avulso(s)
              livre(s) em {disponibilidade.periodo.formatado}.
            </p>
            <Link
              href={comFiltros({ view: "dia" })}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Abrir a visão de dia
            </Link>
          </div>

          <VisaoCalendario
            dias={listarDias(inicioDoPeriodo, fimDoPeriodo)}
            ocupacao={ocupacaoIndexada}
            date={date}
            hoje={hoje}
            alinharColunas={view === "mes"}
            linkDoDia={(dia) => comFiltros({ date: dia, view: "dia" })}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Visão de dia
// ---------------------------------------------------------------------------

function VisaoDia({
  disponibilidade,
  date,
  hoje,
}: {
  disponibilidade: Awaited<ReturnType<typeof getAvailability>>;
  date: string;
  hoje: string;
}) {
  const { kits, notebooks, resumo, periodo } = disponibilidade;

  return (
    <>
      <section aria-labelledby="resumo-periodo">
        <h2 id="resumo-periodo" className="sr-only">
          Resumo do período consultado
        </h2>
        <p className="mb-3 text-sm text-slate-600">
          Período consultado: {periodo.formatado}
          {date === hoje ? " (hoje)" : ""}
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Kits livres"
            value={resumo.kitsDisponiveis}
            tone="success"
          />
          <Stat
            label="Kits reservados"
            value={resumo.kitsReservados}
            tone="info"
          />
          <Stat
            label="Notebooks avulsos livres"
            value={resumo.notebooksDisponiveis}
            tone="success"
          />
          <Stat
            label="Fora de operação"
            value={resumo.kitsIndisponiveis + resumo.notebooksIndisponiveis}
            tone="warning"
            hint="Em manutenção ou indisponíveis"
          />
        </div>
      </section>

      <Legenda />

      <section aria-labelledby="lista-kits" className="mt-6">
        <Card>
          <CardHeader
            title={<span id="lista-kits">Maletas e carrinhos</span>}
            description={`${kits.length} equipamento(s) encontrado(s) com os filtros atuais.`}
          />
          <CardBody>
            {kits.length === 0 ? (
              <EmptyState
                title="Nenhuma maleta ou carrinho com esses filtros"
                description="Tente limpar a localização, a capacidade mínima ou o texto da busca. Se o equipamento existe mas não aparece, ele pode estar desativado no cadastro — nesse caso, fale com a supervisão."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {kits.map((kit) => (
                  <li key={kit.id}>
                    <RecursoCard recurso={kit} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="lista-notebooks" className="mt-6">
        <Card>
          <CardHeader
            title={<span id="lista-notebooks">Notebooks avulsos</span>}
            description="Notebooks que não pertencem a nenhuma maleta ou carrinho."
          />
          <CardBody>
            {notebooks.length === 0 ? (
              <EmptyState
                title="Nenhum notebook avulso com esses filtros"
                description="Os notebooks que ficam dentro de maletas e carrinhos aparecem junto com o kit, na lista acima. Ajuste os filtros ou consulte outra data."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {notebooks.map((notebook) => (
                  <li key={notebook.id}>
                    <RecursoCard recurso={notebook} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </section>
    </>
  );
}

/** Explica as quatro situações — cor sozinha não informa nada. */
function Legenda() {
  const itens = [
    { cor: "bg-emerald-500", rotulo: "Disponível", texto: "livre no período" },
    { cor: "bg-sky-500", rotulo: "Reservado", texto: "já com um professor" },
    { cor: "bg-amber-500", rotulo: "Em manutenção", texto: "em conserto" },
    { cor: "bg-red-500", rotulo: "Indisponível", texto: "fora de uso" },
  ];

  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
      {itens.map((item) => (
        <li key={item.rotulo} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block size-3 rounded-full ${item.cor}`}
          />
          <span>
            <strong className="font-semibold text-slate-800">
              {item.rotulo}
            </strong>{" "}
            — {item.texto}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Visões de semana e mês
// ---------------------------------------------------------------------------

function VisaoCalendario({
  dias,
  ocupacao,
  date,
  hoje,
  alinharColunas,
  linkDoDia,
}: {
  dias: string[];
  ocupacao: Map<string, DayOccupancy>;
  date: string;
  hoje: string;
  /** No mês, as células começam na coluna do dia da semana correspondente. */
  alinharColunas: boolean;
  linkDoDia: (dia: string) => string;
}) {
  const primeiroDia = dias[0];
  const vazios =
    alinharColunas && primeiroDia ? indiceDiaSemana(primeiroDia) : 0;

  return (
    <Card>
      <CardHeader
        title="Ocupação por dia"
        description="Toque em um dia para ver, item por item, o que está livre nele."
      />
      <CardBody>
        {dias.length === 0 ? (
          <EmptyState
            title="Nenhum dia para exibir"
            description="Escolha outra data no filtro acima para montar o calendário."
          />
        ) : (
          <>
            {/* Cabeçalho de dias só faz sentido na grade de sete colunas; no
                celular a lista é vertical e cada cartão traz o próprio dia. */}
            <div
              aria-hidden="true"
              className="hidden grid-cols-7 gap-2 pb-2 sm:grid"
            >
              {DIAS_SEMANA_CURTO.map((dia) => (
                <div
                  key={dia}
                  className="text-center text-xs font-semibold tracking-wide text-slate-500 uppercase"
                >
                  {dia}
                </div>
              ))}
            </div>

            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-7">
              {Array.from({ length: vazios }).map((_, indice) => (
                <li
                  key={`vazio-${indice}`}
                  aria-hidden="true"
                  className="hidden sm:block"
                />
              ))}

              {dias.map((dia) => {
                const info = ocupacao.get(dia);
                const reservas = info?.totalReservas ?? 0;
                const ehHoje = dia === hoje;
                const selecionado = dia === date;

                return (
                  <li key={dia}>
                    <Link
                      href={linkDoDia(dia)}
                      aria-current={selecionado ? "date" : undefined}
                      className={[
                        "flex min-h-20 flex-col justify-between rounded-lg border p-2 transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700",
                        selecionado
                          ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
                          : "border-slate-200 bg-white hover:bg-slate-50",
                      ].join(" ")}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-900">
                          {formatDateBR(meioDiaDe(dia)).slice(0, 5)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {DIAS_SEMANA_CURTO[indiceDiaSemana(dia)]}
                          {ehHoje ? " · hoje" : ""}
                        </span>
                      </span>

                      <span className="mt-2 block">
                        {reservas === 0 ? (
                          <Badge tone="success">Sem reservas</Badge>
                        ) : (
                          <Badge tone="info">
                            {reservas} reserva{reservas > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </span>

                      {info && (
                        <span className="mt-1 block text-xs text-slate-600">
                          {info.kitsOcupados} kit(s) ·{" "}
                          {info.notebooksOcupados} notebook(s)
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}
