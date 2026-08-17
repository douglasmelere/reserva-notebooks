import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type {
  KitStatus,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import {
  formatDateTimeBR,
  formatIntervalBR,
  toLocalDateString,
  toLocalTimeString,
} from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  type BadgeTone,
} from "@/components/ui/primitives";
import { listKits } from "@/server/kits";
import { listNotebooks } from "@/server/notebooks";
import {
  RESERVATION_STATUS_LABEL,
  canTransition,
} from "@/server/reservation-policy";
import { getReservation } from "@/server/reservations";
import { KIT_STATUS_LABEL, notebookIsReservable } from "@/server/resources";
import { Gestao } from "./gestao";

export const dynamic = "force-dynamic";

/**
 * Detalhe e gestão de uma reserva.
 *
 * Tudo que é leitura (reserva, equipamentos disponíveis, histórico) é resolvido
 * no servidor; o componente de cliente recebe apenas o estado inicial e as
 * transições que a API aceita a partir do status atual. Assim a tela nunca
 * oferece um botão que o servidor recusaria — e, se ainda assim recusar, a
 * mensagem dele é exibida sem tradução.
 */

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

const tomDoKit = (status: KitStatus): BadgeTone =>
  status === "DISPONIVEL"
    ? "success"
    : status === "MANUTENCAO"
      ? "warning"
      : status === "DESATIVADO"
        ? "muted"
        : "danger";

const tomDoNotebook = (status: NotebookStatus): BadgeTone =>
  status === "DISPONIVEL"
    ? "success"
    : status === "RESERVADO" || status === "EM_USO"
      ? "info"
      : status === "MANUTENCAO"
        ? "warning"
        : status === "DESATIVADO"
          ? "muted"
          : "danger";

/** Transições que a tela oferece, na ordem do fluxo de atendimento. */
const FLUXO: ReservationStatus[] = [
  "CONFIRMADA",
  "RETIRADA",
  "EM_USO",
  "DEVOLVIDA",
  "ENCERRADA",
  "NAO_COMPARECEU",
  "CANCELADA",
];

const ACAO_AUDITORIA: Record<string, string> = {
  "reserva.criar": "Reserva criada",
  "reserva.atualizar": "Reserva atualizada",
  "reserva.cancelar": "Reserva cancelada",
  "reserva.encerrar": "Reserva encerrada",
  "reserva.contato_whatsapp": "Contato por WhatsApp gerado",
};

const ROTULO_AUDITORIA: Record<string, string> = {
  status: "Situação",
  startsAt: "Início",
  endsAt: "Fim",
  allDay: "Dia inteiro",
  room: "Sala",
  purpose: "Finalidade",
  className: "Turma",
  subject: "Disciplina",
  recursos: "Equipamentos",
  code: "Código",
  motivo: "Motivo",
  semProblemas: "Sem problemas",
};

function ehStatus(valor: string): valor is ReservationStatus {
  return valor in RESERVATION_STATUS_LABEL;
}

function formataValorDeAuditoria(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return String(valor);
  if (Array.isArray(valor)) {
    return valor.map((item) => formataValorDeAuditoria(item)).join(", ") || "—";
  }
  if (typeof valor === "string") {
    if (ehStatus(valor)) return RESERVATION_STATUS_LABEL[valor];
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(valor)) {
      return formatDateTimeBR(new Date(valor));
    }
    return valor;
  }
  return JSON.stringify(valor);
}

function paresDoJson(valor: unknown): [string, string][] {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return [];
  return Object.entries(valor as Record<string, unknown>).map(([chave, item]) => [
    ROTULO_AUDITORIA[chave] ?? chave,
    formataValorDeAuditoria(item),
  ]);
}

export default async function DetalheDaReservaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supervisor = await requireSupervisor();
  const { id } = await params;

  const reserva = await getReservation(id, supervisor).catch((erro: unknown) => {
    // Reserva inexistente vira a página 404 do site; qualquer outra falha
    // continua subindo para o error boundary, que é onde ela deve aparecer.
    if (isAppError(erro) && erro.code === "NAO_ENCONTRADO") notFound();
    throw erro;
  });

  const [historico, kits, notebooks] = await Promise.all([
    entityHistory("Reservation", reserva.id),
    listKits({ pageSize: 100 }, supervisor),
    listNotebooks({ pageSize: 100 }, supervisor),
  ]);

  const transicoesPermitidas = FLUXO.filter(
    (destino) => destino !== reserva.status && canTransition(reserva.status, destino),
  );

  const kitIds = reserva.items
    .map((item) => item.kitId)
    .filter((valor): valor is string => valor !== null);
  const notebookIds = reserva.items
    .map((item) => item.notebookId)
    .filter((valor): valor is string => valor !== null);

  const marcos: { rotulo: string; valor: string }[] = [
    { rotulo: "Criada em", valor: formatDateTimeBR(reserva.createdAt) },
    {
      rotulo: "Retirada em",
      valor: reserva.pickedUpAt ? formatDateTimeBR(reserva.pickedUpAt) : "—",
    },
    {
      rotulo: "Devolvida em",
      valor: reserva.returnedAt ? formatDateTimeBR(reserva.returnedAt) : "—",
    },
    {
      rotulo: "Encerrada em",
      valor: reserva.closedAt ? formatDateTimeBR(reserva.closedAt) : "—",
    },
    {
      rotulo: "Cancelada em",
      valor: reserva.cancelledAt ? formatDateTimeBR(reserva.cancelledAt) : "—",
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={`Reserva ${reserva.code}`}
        description={`${reserva.user.fullName} — ${formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay)}`}
        action={
          <Link
            href="/admin/reservas"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            ← Todas as reservas
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Situação"
            action={
              <Badge tone={STATUS_TONE[reserva.status]}>
                {RESERVATION_STATUS_LABEL[reserva.status]}
              </Badge>
            }
          />
          <CardBody className="flex flex-col gap-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Dado rotulo="Período">
                {formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay)}
              </Dado>
              <Dado rotulo="Professor responsável">
                {reserva.user.fullName}
                {reserva.user.department && (
                  <span className="block text-xs text-slate-500">
                    {reserva.user.department}
                  </span>
                )}
              </Dado>
              <Dado rotulo="Sala">{reserva.room ?? "—"}</Dado>
              <Dado rotulo="Turma">{reserva.className ?? "—"}</Dado>
              <Dado rotulo="Disciplina">{reserva.subject ?? "—"}</Dado>
              <Dado rotulo="Finalidade">{reserva.purpose ?? "—"}</Dado>
              <Dado rotulo="Notebooks solicitados">
                {reserva.requestedNotebooks ?? "—"}
              </Dado>
              <Dado rotulo="Criada por">
                {reserva.createdBy?.fullName ?? "—"}
              </Dado>
            </dl>

            {reserva.cancelReason && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                <span className="font-semibold">Motivo do cancelamento: </span>
                {reserva.cancelReason}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Linha do tempo" />
          <CardBody>
            <dl className="flex flex-col gap-3">
              {marcos.map((marco) => (
                <div key={marco.rotulo}>
                  <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                    {marco.rotulo}
                  </dt>
                  <dd className="text-sm text-slate-900">{marco.valor}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Equipamentos reservados"
          description={`${reserva.items.length} item(ns) nesta reserva.`}
        />
        <CardBody>
          {reserva.items.length === 0 ? (
            <EmptyState
              title="Nenhum equipamento vinculado"
              description="Os itens desta reserva foram removidos do inventário. Edite a reserva abaixo para vincular um kit ou notebook, ou cancele-a."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {reserva.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {item.kit
                      ? `${item.kit.name} (${item.kit.code})`
                      : item.notebook
                        ? `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
                        : "Recurso removido"}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {item.kit && (
                      <Badge tone={tomDoKit(item.kit.status)}>
                        {item.kit.type === "MALETA" ? "Maleta" : "Carrinho"} ·{" "}
                        {KIT_STATUS_LABEL[item.kit.status]}
                      </Badge>
                    )}
                    <Badge tone={item.blocking ? "info" : "muted"}>
                      {item.blocking ? "Ocupando o equipamento" : "Equipamento liberado"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {(reserva.teacherNotes || reserva.supervisorNotes) && (
        <Card>
          <CardHeader title="Observações" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Dado rotulo="Do professor">{reserva.teacherNotes ?? "—"}</Dado>
            <Dado rotulo="Da supervisão">{reserva.supervisorNotes ?? "—"}</Dado>
          </CardBody>
        </Card>
      )}

      <Gestao
        reservaId={reserva.id}
        codigo={reserva.code}
        statusAtual={reserva.status}
        statusAtualLabel={RESERVATION_STATUS_LABEL[reserva.status]}
        transicoesPermitidas={transicoesPermitidas}
        valoresIniciais={{
          date: toLocalDateString(reserva.startsAt),
          diaInteiro: reserva.allDay,
          startTime: reserva.allDay ? "" : toLocalTimeString(reserva.startsAt),
          endTime: reserva.allDay ? "" : toLocalTimeString(reserva.endsAt),
          kitIds,
          notebookIds,
          purpose: reserva.purpose ?? "",
          className: reserva.className ?? "",
          subject: reserva.subject ?? "",
          room: reserva.room ?? "",
          requestedNotebooks:
            reserva.requestedNotebooks === null
              ? ""
              : String(reserva.requestedNotebooks),
          teacherNotes: reserva.teacherNotes ?? "",
          supervisorNotes: reserva.supervisorNotes ?? "",
        }}
        kits={kits.items.map((kit) => ({
          id: kit.id,
          nome: `${kit.name} (${kit.code})`,
          detalhe: `${kit.type === "MALETA" ? "Maleta" : "Carrinho"} · ${kit.notebookCount} notebook(s)`,
          statusLabel: kit.statusLabel,
          tom: tomDoKit(kit.status),
          // Um kit já vinculado continua selecionável mesmo fora de circulação:
          // do contrário a edição apagaria o item em silêncio ao salvar.
          reservavel: kit.reservavel || kitIds.includes(kit.id),
        }))}
        notebooks={notebooks.items.map((notebook) => ({
          id: notebook.id,
          nome: `${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""}`,
          detalhe: notebook.kit ? `Pertence ao kit ${notebook.kit.name}` : "Avulso",
          statusLabel: notebook.statusLabel,
          tom: tomDoNotebook(notebook.status),
          reservavel:
            notebookIsReservable(notebook.status) || notebookIds.includes(notebook.id),
        }))}
      />

      <Card>
        <CardHeader
          title="Histórico completo"
          description="Toda alteração registrada na auditoria, da mais recente para a mais antiga."
        />
        <CardBody>
          {historico.length === 0 ? (
            <EmptyState
              title="Sem registros de alteração"
              description="Assim que a reserva for confirmada, editada, cancelada ou encerrada, cada passo aparece aqui com autor e data."
            />
          ) : (
            <ol className="flex flex-col gap-3">
              {historico.map((registro) => {
                const antes = paresDoJson(registro.before);
                const depois = paresDoJson(registro.after);

                return (
                  <li
                    key={registro.id}
                    className="rounded-lg border border-slate-200 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {ACAO_AUDITORIA[registro.action] ?? registro.action}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTimeBR(registro.createdAt)}
                      </p>
                    </div>

                    <p className="mt-1 text-sm text-slate-700">
                      {registro.summary ?? "Sem descrição registrada."}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Por {registro.actor?.fullName ?? "sistema"}
                      {registro.ip ? ` · IP ${registro.ip}` : ""}
                    </p>

                    {(antes.length > 0 || depois.length > 0) && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {antes.length > 0 && (
                          <ValoresDaAuditoria titulo="Antes" pares={antes} />
                        )}
                        {depois.length > 0 && (
                          <ValoresDaAuditoria titulo="Depois" pares={depois} />
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Dado({
  rotulo,
  children,
}: {
  rotulo: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {rotulo}
      </dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function ValoresDaAuditoria({
  titulo,
  pares,
}: {
  titulo: string;
  pares: [string, string][];
}) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold text-slate-600">{titulo}</p>
      <dl className="mt-1 flex flex-col gap-0.5">
        {pares.map(([chave, valor]) => (
          <div key={chave} className="flex flex-wrap gap-1 text-xs">
            <dt className="text-slate-500">{chave}:</dt>
            <dd className="text-slate-800">{valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
