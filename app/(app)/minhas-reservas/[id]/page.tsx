import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  formatDateTimeBR,
  formatIntervalBR,
  institutionTimeZone,
} from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import { getKit, type KitDetail } from "@/server/kits";
import { RESERVATION_STATUS_LABEL, isClosed } from "@/server/reservation-policy";
import { getReservation } from "@/server/reservations";
import { NOTEBOOK_STATUS_LABEL } from "@/server/resources";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  type BadgeTone,
} from "@/components/ui/primitives";
import type { KitType, ReservationStatus } from "@/generated/prisma/enums";
import type { ReactNode } from "react";
import { AcoesDaReserva, HistoricoDaReserva, type AlvoDeOcorrencia } from "./acoes";

export const dynamic = "force-dynamic";

/** Mesmo mapa da listagem: cor acompanha o texto, nunca o substitui. */
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

export default async function DetalheDaReservaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const settings = await getSettings();

  // O serviço responde "não encontrada" também para a reserva de outro docente;
  // aqui isso vira a página 404 padrão, sem confirmar que o registro existe.
  // Qualquer outra falha (banco fora do ar, por exemplo) continua subindo, para
  // não virar um 404 que esconde um problema real de infraestrutura.
  const reserva = await getReservation(id, user).catch((falha: unknown) => {
    if (isAppError(falha) && falha.code === "NAO_ENCONTRADO") return null;
    throw falha;
  });
  if (!reserva) notFound();

  const timeZone = institutionTimeZone();

  // O item da reserva guarda só o vínculo com o kit; o kit de carregadores e os
  // notebooks que vêm dentro dele estão no detalhe do kit.
  const kitsDaReserva = reserva.items
    .map((item) => item.kit)
    .filter((kit): kit is NonNullable<typeof kit> => kit !== null);

  // Um kit desativado depois da reserva responde como inexistente para o
  // professor. Nesse caso o detalhe não vem, mas o kit continua aparecendo com
  // o que o próprio item da reserva guarda — some da tela seria pior.
  const detalhesDeKits = await Promise.all(
    kitsDaReserva.map((kit) => getKit(kit.id, user).catch(() => null)),
  );
  const detalhePorKit = new Map<string, KitDetail>();
  for (const detalhe of detalhesDeKits) {
    if (detalhe) detalhePorKit.set(detalhe.id, detalhe);
  }

  const notebooksAvulsos = reserva.items
    .map((item) => item.notebook)
    .filter((notebook): notebook is NonNullable<typeof notebook> =>
      notebook !== null,
    );

  // --- O que ainda é possível fazer ---------------------------------------
  const supervisiona = user.role === "SUPERVISOR";
  const encerrada = isClosed(reserva.status);
  const agora = Date.now();
  const jaComecou = reserva.startsAt.getTime() <= agora;
  const horasParaComecar = (reserva.startsAt.getTime() - agora) / 3_600_000;

  let motivoNaoCancelar: string | null = null;
  if (encerrada) {
    motivoNaoCancelar = `Esta reserva está "${RESERVATION_STATUS_LABEL[reserva.status]}" e não pode mais ser cancelada.`;
  } else if (!supervisiona && jaComecou && !settings.allowCancelAfterStart) {
    motivoNaoCancelar =
      "A reserva já começou, então o cancelamento pelo sistema não está mais liberado. Procure a supervisão para registrar a devolução.";
  } else if (
    !supervisiona &&
    settings.cancellationDeadlineHours > 0 &&
    horasParaComecar < settings.cancellationDeadlineHours
  ) {
    motivoNaoCancelar = `O cancelamento precisa ser feito com pelo menos ${settings.cancellationDeadlineHours} hora(s) de antecedência. Procure a supervisão.`;
  }

  const podeCancelar = motivoNaoCancelar === null;
  // Uma reserva apenas solicitada ainda não virou retirada, então não há o que
  // devolver — a saída dela é o cancelamento.
  const podeEncerrar = !encerrada && reserva.status !== "SOLICITADA";

  const alvos = montarAlvos(
    kitsDaReserva,
    [...detalhePorKit.values()],
    notebooksAvulsos,
  );

  return (
    <>
      <Link
        href="/minhas-reservas"
        className="mb-3 inline-flex min-h-11 items-center text-sm font-medium text-senai-800 underline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span aria-hidden="true">←</span>&nbsp;Voltar para minhas reservas
      </Link>

      <PageHeader
        title={`Reserva ${reserva.code}`}
        description={formatIntervalBR(
          reserva.startsAt,
          reserva.endsAt,
          reserva.allDay,
        )}
        action={
          <Badge tone={TOM_POR_SITUACAO[reserva.status]}>
            {RESERVATION_STATUS_LABEL[reserva.status]}
          </Badge>
        }
      />

      {reserva.status === "CANCELADA" && (
        <Alert tone="danger" title="Reserva cancelada" className="mb-4">
          {reserva.cancelledAt
            ? `Cancelada em ${formatDateTimeBR(reserva.cancelledAt, timeZone)}.`
            : "Esta reserva foi cancelada."}
          {reserva.cancelReason ? ` Motivo: ${reserva.cancelReason}` : ""} Os
          equipamentos já voltaram para a agenda. Se ainda precisar deles, faça
          uma nova reserva.
        </Alert>
      )}

      {/* O selo diz "Não comparecimento", mas sozinho ele não explica o que
          aconteceu nem o que o professor faz agora. */}
      {reserva.status === "NAO_COMPARECEU" && (
        <Alert
          tone="danger"
          title="Registrada como não comparecimento"
          className="mb-4"
        >
          A supervisão marcou que os equipamentos não foram retirados no período
          reservado, e eles voltaram para a agenda. Se houve um engano, procure a
          supervisão; para usar os equipamentos, faça uma nova reserva.
        </Alert>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader title="Dados da reserva" />
          <CardBody>
            <dl>
              <Linha rotulo="Código" valor={reserva.code} />
              <Linha
                rotulo="Período"
                valor={formatIntervalBR(
                  reserva.startsAt,
                  reserva.endsAt,
                  reserva.allDay,
                )}
              />
              <Linha
                rotulo="Situação"
                valor={
                  <Badge tone={TOM_POR_SITUACAO[reserva.status]}>
                    {RESERVATION_STATUS_LABEL[reserva.status]}
                  </Badge>
                }
              />
              <Linha rotulo="Sala" valor={reserva.room || "Não informada"} />
              <Linha
                rotulo="Finalidade"
                valor={reserva.purpose || "Não informada"}
              />
              <Linha rotulo="Turma" valor={reserva.className || "Não informada"} />
              <Linha
                rotulo="Disciplina"
                valor={reserva.subject || "Não informada"}
              />
              {reserva.requestedNotebooks !== null && (
                <Linha
                  rotulo="Notebooks necessários"
                  valor={String(reserva.requestedNotebooks)}
                />
              )}
              <Linha
                rotulo="Suas observações"
                valor={reserva.teacherNotes || "Nenhuma"}
              />
              {reserva.supervisorNotes && (
                <Linha
                  rotulo="Recado da supervisão"
                  valor={reserva.supervisorNotes}
                />
              )}
              <Linha
                rotulo="Criada em"
                valor={formatDateTimeBR(reserva.createdAt, timeZone)}
              />
              {reserva.pickedUpAt && (
                <Linha
                  rotulo="Retirada em"
                  valor={formatDateTimeBR(reserva.pickedUpAt, timeZone)}
                />
              )}
              {reserva.returnedAt && (
                <Linha
                  rotulo="Devolvida em"
                  valor={formatDateTimeBR(reserva.returnedAt, timeZone)}
                />
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Equipamentos desta reserva"
            description="Confira o que você precisa retirar e devolver."
          />
          <CardBody className="space-y-4">
            {kitsDaReserva.length === 0 && notebooksAvulsos.length === 0 && (
              <p className="text-sm text-slate-600">
                Nenhum equipamento vinculado. Procure a supervisão.
              </p>
            )}

            {kitsDaReserva.map((kit) => (
              <BlocoDoKit
                key={kit.id}
                basico={kit}
                detalhe={detalhePorKit.get(kit.id) ?? null}
              />
            ))}

            {notebooksAvulsos.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-slate-800">
                  Notebooks avulsos ({notebooksAvulsos.length})
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {notebooksAvulsos.map((notebook) => (
                    <li
                      key={notebook.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm"
                    >
                      <span className="min-w-0 font-medium break-words text-slate-900">
                        Notebook {notebook.assetTag}
                        {notebook.nickname ? ` — ${notebook.nickname}` : ""}
                      </span>
                      <Badge
                        tone={
                          notebook.status === "DISPONIVEL" ? "success" : "info"
                        }
                      >
                        {NOTEBOOK_STATUS_LABEL[notebook.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </CardBody>
        </Card>

        <AcoesDaReserva
          reservationId={reserva.id}
          codigo={reserva.code}
          podeCancelar={podeCancelar}
          motivoNaoCancelar={motivoNaoCancelar}
          podeEncerrar={podeEncerrar}
          alvos={alvos}
        />

        <HistoricoDaReserva reservationId={reserva.id} timeZone={timeZone} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Blocos de apresentação
// ---------------------------------------------------------------------------

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-3 sm:gap-3">
      <dt className="text-sm font-medium text-slate-500">{rotulo}</dt>
      <dd className="text-sm break-words text-slate-900 sm:col-span-2">
        {valor}
      </dd>
    </div>
  );
}

/** Dados do kit que o próprio item da reserva já carrega. */
type KitBasico = {
  id: string;
  code: string;
  name: string;
  type: KitType;
  capacity: number;
};

function BlocoDoKit({
  basico,
  detalhe,
}: {
  basico: KitBasico;
  detalhe: KitDetail | null;
}) {
  const carregadores = detalhe?.chargerKit ?? null;

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 text-sm font-semibold break-words text-slate-900">
          {basico.name} ({basico.code})
        </h3>
        <Badge tone="neutral">
          {basico.type === "CARRINHO" ? "Carrinho" : "Maleta"}
        </Badge>
      </div>

      <p className="mt-1 text-sm break-words text-slate-600">
        Capacidade para {basico.capacity} notebook(s)
        {detalhe ? ` · ${detalhe.notebookCount} vinculado(s)` : ""}
        {detalhe?.location ? ` · ${detalhe.location}` : ""}
      </p>

      {!detalhe && (
        <p className="mt-2 text-sm text-amber-800">
          Este kit saiu do inventário ativo, então a lista de notebooks e o kit
          de carregadores não estão disponíveis aqui. Procure a supervisão.
        </p>
      )}

      {/* O kit de carregadores é o item que mais volta incompleto — por isso
          aparece com número, e não só como "ok / não ok". */}
      {detalhe && (
        <div className="mt-2">
          {carregadores ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={carregadores.completo ? "success" : "warning"}>
                Carregadores: {carregadores.statusLabel}
              </Badge>
              <span className="text-sm text-slate-600">
                {carregadores.code} · {carregadores.availableQuantity} de{" "}
                {carregadores.totalQuantity} disponível(is)
                {carregadores.faltando > 0
                  ? ` · faltam ${carregadores.faltando}`
                  : ""}
              </span>
            </div>
          ) : (
            <Badge tone="warning">Sem kit de carregadores cadastrado</Badge>
          )}
        </div>
      )}

      {detalhe && detalhe.notebooks.length > 0 && (
        <details className="mt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-senai-800">
            Notebooks que vêm neste kit ({detalhe.notebooks.length})
          </summary>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {detalhe.notebooks.map((notebook) => (
              <li
                key={notebook.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-2.5 py-2 text-sm"
              >
                <span className="min-w-0 break-words text-slate-900">
                  {notebook.assetTag}
                  {notebook.nickname ? ` — ${notebook.nickname}` : ""}
                </span>
                <Badge
                  tone={notebook.status === "DISPONIVEL" ? "success" : "info"}
                >
                  {notebook.statusLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Opções de "o que teve problema" na devolução.
 *
 * A API só aceita ocorrência em item que pertence à reserva, então a lista é
 * montada a partir dela — evita o professor escolher um equipamento que nunca
 * teve em mãos e receber um erro depois de escrever a descrição.
 */
function montarAlvos(
  kitsDaReserva: KitBasico[],
  detalhes: KitDetail[],
  notebooksAvulsos: { id: string; assetTag: string; nickname: string | null }[],
): AlvoDeOcorrencia[] {
  const alvos: AlvoDeOcorrencia[] = [
    {
      valor: "RESERVATION",
      rotulo: "A reserva em geral (atraso, devolução incompleta)",
    },
  ];
  const vistos = new Set<string>(["RESERVATION"]);

  const adicionar = (valor: string, rotulo: string) => {
    if (vistos.has(valor)) return;
    vistos.add(valor);
    alvos.push({ valor, rotulo });
  };

  for (const kit of kitsDaReserva) {
    adicionar(`KIT:${kit.id}`, `${kit.name} (${kit.code})`);
  }

  for (const kit of detalhes) {
    if (kit.chargerKit) {
      adicionar(
        `CHARGER_KIT:${kit.chargerKit.id}`,
        `Kit de carregadores ${kit.chargerKit.code} (de ${kit.name})`,
      );
    }
    for (const notebook of kit.notebooks) {
      adicionar(
        `NOTEBOOK:${notebook.id}`,
        `Notebook ${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""} (de ${kit.name})`,
      );
    }
  }

  for (const notebook of notebooksAvulsos) {
    adicionar(
      `NOTEBOOK:${notebook.id}`,
      `Notebook ${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""}`,
    );
  }

  return alvos;
}
