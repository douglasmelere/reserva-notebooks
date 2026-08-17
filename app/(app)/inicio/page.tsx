import { CalendarPlus, CalendarSearch } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  formatIntervalBR,
  todayLocal,
  toLocalTimeString,
} from "@/lib/datetime";
import { getAvailability } from "@/server/availability";
import {
  BLOCKING_STATUSES,
  RESERVATION_STATUS_LABEL,
} from "@/server/reservation-policy";
import { listReservations } from "@/server/reservations";
import type { ReservationWithRelations } from "@/server/reservations";
import type { ReservationStatus } from "@/generated/prisma/enums";
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

export const dynamic = "force-dynamic";

/**
 * Tela inicial do professor.
 *
 * Server Component: chama os serviços direto, sem passar por HTTP. Ela responde
 * a três perguntas na ordem em que elas aparecem no dia de trabalho — "tem algo
 * pendente comigo?", "o que eu tenho marcado?" e "dá para pegar equipamento
 * agora?".
 */

const STATUS_TONE: Record<ReservationStatus, BadgeTone> = {
  SOLICITADA: "warning",
  CONFIRMADA: "info",
  RETIRADA: "info",
  EM_USO: "info",
  DEVOLVIDA: "success",
  ENCERRADA: "success",
  CANCELADA: "danger",
  NAO_COMPARECEU: "danger",
};

/**
 * Janela curta a partir de agora.
 *
 * "Livre agora" é uma pergunta sobre este instante, não sobre o dia inteiro: um
 * kit reservado das 8h às 9h está livre às 10h, e mostrá-lo como ocupado o dia
 * todo faria o professor desistir de uma reserva possível. Perto da meia-noite
 * a janela cruzaria o dia e o serviço recusaria o intervalo — nesse caso
 * voltamos para a consulta de dia inteiro.
 */
function janelaAgora(
  agora: Date,
): { startTime: string; endTime: string } | null {
  const partes = toLocalTimeString(agora).split(":");
  const inicio = Number(partes[0] ?? 0) * 60 + Number(partes[1] ?? 0);
  const fim = inicio + 30;
  if (!Number.isFinite(inicio) || fim >= 24 * 60) return null;

  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  return {
    startTime: `${doisDigitos(Math.floor(inicio / 60))}:${doisDigitos(inicio % 60)}`,
    endTime: `${doisDigitos(Math.floor(fim / 60))}:${doisDigitos(fim % 60)}`,
  };
}

/** Descrição curta dos equipamentos de uma reserva. */
function recursosDaReserva(reserva: ReservationWithRelations): string[] {
  return reserva.items.map((item) =>
    item.kit
      ? `${item.kit.name} (${item.kit.code})`
      : item.notebook
        ? `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
        : "Equipamento removido do cadastro",
  );
}

export default async function InicioPage() {
  const user = await requireUser();
  const agora = new Date();
  const hoje = todayLocal();
  const janela = janelaAgora(agora);

  const [reservas, disponibilidade] = await Promise.all([
    listReservations(
      { userId: user.id, status: BLOCKING_STATUSES, pageSize: 100 },
      user,
    ),
    getAvailability({
      date: hoje,
      startTime: janela?.startTime ?? null,
      endTime: janela?.endTime ?? null,
    }),
  ]);

  // O serviço devolve da mais recente para a mais antiga; aqui a leitura
  // natural é cronológica, do que vem primeiro para o que vem depois.
  const ativas = [...reservas.items].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  );
  const pendentesDeEncerramento = ativas.filter(
    (r) => r.endsAt.getTime() <= agora.getTime(),
  );
  const proximas = ativas.filter((r) => r.endsAt.getTime() > agora.getTime());

  const primeiroNome = user.fullName.trim().split(/\s+/)[0] ?? user.fullName;

  return (
    <>
      <PageHeader
        title={`Olá, ${primeiroNome}`}
        description="Este é o resumo das suas reservas e do que está livre agora."
      />

      {pendentesDeEncerramento.length > 0 && (
        <Alert
          tone="warning"
          title={
            pendentesDeEncerramento.length === 1
              ? "Você tem uma reserva que já terminou e ainda não foi encerrada"
              : `Você tem ${pendentesDeEncerramento.length} reservas que já terminaram e ainda não foram encerradas`
          }
          className="mb-4"
        >
          <p>
            Enquanto a reserva não é encerrada, o equipamento continua bloqueado
            para os outros professores. Encerre informando se ocorreu tudo bem
            ou registrando o problema encontrado.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {pendentesDeEncerramento.map((reserva) => (
              <li
                key={reserva.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{reserva.code}</span>
                  {" — "}
                  {formatIntervalBR(
                    reserva.startsAt,
                    reserva.endsAt,
                    reserva.allDay,
                  )}
                </span>
                {/* O código já aparece ao lado; repeti-lo no botão só alonga o
                    alvo em 360px. Fica no `sr-only` para que cada link da
                    lista continue tendo um nome próprio. */}
                <Link
                  href={`/minhas-reservas/${reserva.id}`}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-amber-700 px-4 text-sm font-medium text-white hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                >
                  Encerrar
                  <span className="sr-only"> a reserva {reserva.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {/* Atalhos grandes: são as duas ações que trazem o professor ao sistema. */}
      <nav aria-label="Ações principais" className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/reservar"
          className="flex min-h-24 items-center gap-4 rounded-xl bg-senai-700 px-5 py-4 text-white transition-colors hover:bg-senai-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-senai-700"
        >
          {/*
            Sem classe de cor: o ícone herda o `text-white` do cartão pelo
            `currentColor`. Fixar a cor da marca aqui o deixaria azul sobre
            azul — invisível.
          */}
          <CalendarPlus aria-hidden="true" className="size-7 shrink-0" />
          <span>
            <span className="block text-lg font-semibold">Fazer reserva</span>
            <span className="block text-sm text-senai-100">
              Escolha a data, o horário e o equipamento
            </span>
          </span>
        </Link>

        <Link
          href="/disponibilidade"
          className="flex min-h-24 items-center gap-4 rounded-xl border border-slate-300 bg-white px-5 py-4 text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
        >
          <CalendarSearch
            aria-hidden="true"
            className="size-7 shrink-0 text-senai-700"
          />
          <span>
            <span className="block text-lg font-semibold">
              Ver disponibilidade
            </span>
            <span className="block text-sm text-slate-600">
              Consulte por dia, semana ou mês
            </span>
          </span>
        </Link>
      </nav>

      <section aria-labelledby="resumo-do-dia" className="mt-6">
        <h2
          id="resumo-do-dia"
          className="text-base font-semibold text-slate-900"
        >
          Situação agora
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          {disponibilidade.periodo.formatado}
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Kits livres"
            value={disponibilidade.resumo.kitsDisponiveis}
            tone="success"
            hint="Maletas e carrinhos sem reserva neste período"
          />
          <Stat
            label="Kits reservados"
            value={disponibilidade.resumo.kitsReservados}
            tone="info"
            hint="Já com um professor neste período"
          />
          <Stat
            label="Notebooks livres"
            value={disponibilidade.resumo.notebooksDisponiveis}
            tone="success"
            hint="Inclui os que estão dentro de kits livres"
          />
          <Stat
            label="Fora de operação"
            value={
              disponibilidade.resumo.kitsIndisponiveis +
              disponibilidade.resumo.notebooksIndisponiveis
            }
            tone="warning"
            hint="Em manutenção ou indisponíveis"
          />
        </div>
      </section>

      <section aria-labelledby="proximas-reservas" className="mt-6">
        <Card>
          <CardHeader
            title={<span id="proximas-reservas">Suas próximas reservas</span>}
            description="Reservas ativas, da mais próxima para a mais distante."
            action={
              proximas.length > 0 ? (
                <Link
                  href="/minhas-reservas"
                  className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Ver todas
                </Link>
              ) : undefined
            }
          />
          <CardBody>
            {proximas.length === 0 ? (
              <EmptyState
                title="Você ainda não tem reservas ativas"
                description="Escolha a data e o horário da sua aula, veja quais maletas, carrinhos e notebooks estão livres e faça a sua primeira reserva. Leva menos de um minuto."
                action={
                  // Link com aparência de botão: um <button> dentro de um <a>
                  // seria aninhamento inválido e confunde o leitor de tela.
                  <Link
                    href="/reservar"
                    className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-senai-700 px-6 text-base font-medium text-white hover:bg-senai-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-senai-700"
                  >
                    <CalendarPlus aria-hidden="true" className="size-4" />
                    Fazer minha primeira reserva
                  </Link>
                }
              />
            ) : (
              // Cartões empilhados em vez de tabela: são seis informações por
              // reserva, e no celular isso viraria uma tabela ilegível.
              <>
                <ul className="flex flex-col gap-3">
                  {proximas.slice(0, 6).map((reserva) => (
                    <li key={reserva.id}>
                      <Link
                        href={`/minhas-reservas/${reserva.id}`}
                        className="block rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-senai-700"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-slate-900">
                            {formatIntervalBR(
                              reserva.startsAt,
                              reserva.endsAt,
                              reserva.allDay,
                            )}
                          </p>
                          <Badge tone={STATUS_TONE[reserva.status]}>
                            {RESERVATION_STATUS_LABEL[reserva.status]}
                          </Badge>
                        </div>

                        <p className="mt-1 text-sm text-slate-700">
                          {recursosDaReserva(reserva).join(" · ")}
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          Código {reserva.code}
                          {reserva.room ? ` · Sala ${reserva.room}` : ""}
                          {reserva.className
                            ? ` · Turma ${reserva.className}`
                            : ""}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>

                {/* Sem esta linha, a lista cortada em seis passa a impressão de
                  que o professor não tem mais nada marcado. */}
                {proximas.length > 6 && (
                  <p className="mt-3 text-sm text-slate-600">
                    Mostrando as 6 primeiras de {proximas.length} reservas
                    ativas.{" "}
                    <Link
                      href="/minhas-reservas"
                      className="font-medium text-senai-700 underline"
                    >
                      Ver todas as suas reservas
                    </Link>
                    .
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </section>
    </>
  );
}
