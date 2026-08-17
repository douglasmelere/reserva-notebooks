import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { formatIntervalBR } from "@/lib/datetime";
import { dateSchema, reservationStatusSchema } from "@/lib/validation";
import {
  BLOCKING_STATUSES,
  RESERVATION_STATUS_LABEL,
  isClosed,
} from "@/server/reservation-policy";
import {
  listReservations,
  type ReservationWithRelations,
} from "@/server/reservations";
import {
  Badge,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  type BadgeTone,
} from "@/components/ui/primitives";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { FiltrosDeReservas, PaginacaoDeReservas } from "./lista";

export const dynamic = "force-dynamic";

const POR_PAGINA = 20;

const CLASSE_LINK_BOTAO =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * Tom do selo por situação.
 *
 * Repetido também na tela de detalhe, e não extraído para um módulo comum, para
 * não criar um arquivo compartilhado dentro de `app/` — o custo de manter dois
 * mapas de oito linhas é menor que o de um módulo solto entre rotas.
 */
const TOM_POR_SITUACAO: Record<ReservationStatus, BadgeTone> = {
  SOLICITADA: "warning",
  CONFIRMADA: "info",
  RETIRADA: "info",
  EM_USO: "info",
  DEVOLVIDA: "success",
  ENCERRADA: "success",
  CANCELADA: "danger",
  NAO_COMPARECEU: "danger",
};

function primeiroValor(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

/** Rótulos dos equipamentos de uma reserva, como o professor os reconhece. */
function equipamentosDaReserva(reserva: ReservationWithRelations): string[] {
  return reserva.items.map((item) =>
    item.kit
      ? `${item.kit.name} (${item.kit.code})`
      : item.notebook
        ? `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
        : "Equipamento",
  );
}

export default async function MinhasReservasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await requireUser();

  const situacao = primeiroValor(sp.status);
  const de = primeiroValor(sp.de);
  const ate = primeiroValor(sp.ate);

  const paginaInformada = Number.parseInt(primeiroValor(sp.pagina), 10);
  const pagina =
    Number.isFinite(paginaInformada) && paginaInformada > 0
      ? paginaInformada
      : 1;

  // "ativas" é um atalho para os status que ainda ocupam equipamento; os demais
  // valores são validados contra o enum, então uma URL adulterada vira "sem
  // filtro" em vez de erro de banco.
  const statusValidado = reservationStatusSchema.safeParse(situacao);
  const status: ReservationStatus[] | undefined =
    situacao === "ativas"
      ? BLOCKING_STATUSES
      : statusValidado.success
        ? [statusValidado.data]
        : undefined;

  const from = dateSchema.safeParse(de).success ? de : undefined;
  const to = dateSchema.safeParse(ate).success ? ate : undefined;

  const resultado = await listReservations(
    {
      // Sem isso, um supervisor veria as reservas de toda a escola nesta tela:
      // o serviço só força o escopo para quem é professor.
      userId: user.id,
      status,
      from,
      to,
      page: pagina,
      pageSize: POR_PAGINA,
    },
    user,
  );

  const agora = Date.now();
  const emAndamento = (reserva: ReservationWithRelations) =>
    !isClosed(reserva.status) && reserva.endsAt.getTime() >= agora;

  // Nas próximas, a mais perto de acontecer vem primeiro — é a que o professor
  // precisa conferir. Nas anteriores vale a ordem do serviço (mais recentes).
  const proximas = resultado.items
    .filter(emAndamento)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const anteriores = resultado.items.filter((r) => !emAndamento(r));

  const totalPaginas = Math.max(
    1,
    Math.ceil(resultado.total / resultado.pageSize),
  );
  const temFiltro = Boolean(situacao || from || to);

  return (
    <>
      <PageHeader
        title="Minhas reservas"
        description="Acompanhe o que você reservou, cancele o que não vai usar e registre a devolução."
        action={
          <Link
            href="/reservar"
            className={cn(
              CLASSE_LINK_BOTAO,
              "bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700",
            )}
          >
            Fazer uma reserva
          </Link>
        }
      />

      <FiltrosDeReservas situacao={situacao} de={de} ate={ate} />

      <p aria-live="polite" className="mb-4 text-sm text-slate-600">
        {resultado.total === 0
          ? "Nenhuma reserva encontrada."
          : `${resultado.total} reserva(s) encontrada(s).`}
      </p>

      {resultado.items.length === 0 ? (
        <EmptyState
          title={
            temFiltro
              ? "Nenhuma reserva com esses filtros"
              : "Você ainda não tem reservas"
          }
          description={
            temFiltro
              ? "Tente ampliar o período ou escolher outra situação. Se você acabou de reservar, confira se a data do filtro cobre o dia da aula."
              : "Reserve uma maleta, um carrinho ou notebooks avulsos para a sua próxima aula. Leva menos de um minuto e você recebe um código para apresentar na retirada."
          }
          action={
            <Link
              href="/reservar"
              className={cn(
                CLASSE_LINK_BOTAO,
                "bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700",
              )}
            >
              Fazer uma reserva
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          <SecaoDeReservas
            titulo="Próximas"
            descricao="Reservas que ainda vão acontecer ou estão em andamento."
            vazio="Nenhuma reserva em andamento neste recorte."
            reservas={proximas}
          />
          <SecaoDeReservas
            titulo="Anteriores"
            descricao="Reservas já encerradas, devolvidas ou canceladas."
            vazio="Nenhuma reserva anterior neste recorte."
            reservas={anteriores}
          />
        </div>
      )}

      <PaginacaoDeReservas pagina={resultado.page} totalPaginas={totalPaginas} />
    </>
  );
}

function SecaoDeReservas({
  titulo,
  descricao,
  vazio,
  reservas,
}: {
  titulo: string;
  descricao: string;
  vazio: string;
  reservas: ReservationWithRelations[];
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
      <p className="mt-0.5 mb-3 text-sm text-slate-600">{descricao}</p>

      {reservas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-600">
          {vazio}
        </p>
      ) : (
        // Cartões empilhados em qualquer largura: a reserva tem seis campos
        // relevantes e uma tabela com isso fica ilegível no celular.
        <ul className="space-y-3">
          {reservas.map((reserva) => (
            <li key={reserva.id}>
              <CartaoDeReserva reserva={reserva} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CartaoDeReserva({ reserva }: { reserva: ReservationWithRelations }) {
  const equipamentos = equipamentosDaReserva(reserva);

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-wide text-slate-500">
              {reserva.code}
            </p>
            <p className="mt-0.5 text-base font-semibold text-slate-900">
              {formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay)}
            </p>
          </div>
          <Badge tone={TOM_POR_SITUACAO[reserva.status]}>
            {RESERVATION_STATUS_LABEL[reserva.status]}
          </Badge>
        </div>

        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Equipamentos
            </dt>
            <dd className="mt-0.5 text-sm text-slate-800">
              <ul className="space-y-0.5">
                {equipamentos.map((rotulo, indice) => (
                  <li key={`${reserva.id}-${indice}`}>{rotulo}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Sala
            </dt>
            <dd className="mt-0.5 text-sm text-slate-800">
              {reserva.room || "Não informada"}
            </dd>

            {(reserva.className || reserva.subject) && (
              <>
                <dt className="mt-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Turma e disciplina
                </dt>
                <dd className="mt-0.5 text-sm text-slate-800">
                  {[reserva.className, reserva.subject]
                    .filter(Boolean)
                    .join(" · ")}
                </dd>
              </>
            )}
          </div>
        </dl>

        <div className="mt-4">
          <Link
            href={`/minhas-reservas/${reserva.id}`}
            className={cn(
              CLASSE_LINK_BOTAO,
              "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-500",
            )}
          >
            Ver detalhes da reserva {reserva.code}
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
