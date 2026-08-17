import { auditSafe } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { naoEncontrado, regraDeNegocio } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { buildWhatsappLink } from "@/lib/whatsapp";
import { isClosed } from "./reservation-policy";
import type { ReservationWithRelations } from "./reservations";

/**
 * Contato por WhatsApp entre colegas quando o equipamento desejado já está
 * reservado, e ponto único que decide como telefone/opt-in chegam ao cliente.
 *
 * O sistema não tem fila de espera nem "roubo" de reserva: se o recurso está
 * ocupado, a única saída institucional é conversar com quem está com ele. Este
 * módulo monta esse atalho de conversa sem transformar a API em uma lista de
 * telefones dos professores — por isso o número nunca aparece como campo, só
 * dentro do link `wa.me`, e apenas quando o docente autorizou.
 */

export type RequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Indisponibilidade não é erro: o professor precisa da orientação ("procure a
 * supervisão"), não de um 4xx que a interface trataria como falha.
 */
export type WhatsappContactResult =
  | { disponivel: false; motivo: string }
  | { disponivel: true; url: string; mensagem: string };

/** Rótulo dos equipamentos da reserva, usado no texto da mensagem. */
function resourceLabelFor(
  items: {
    kit: { name: string; code: string } | null;
    notebook: { assetTag: string; nickname: string | null } | null;
  }[],
): string {
  const labels = items
    .map((item) =>
      item.kit
        ? `${item.kit.name} (${item.kit.code})`
        : item.notebook
          ? `o notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
          : null,
    )
    .filter((label): label is string => label !== null);

  // Reserva sem item é impossível pela regra de criação, mas a mensagem não
  // pode quebrar caso um item tenha sido removido no meio do caminho.
  if (labels.length === 0) return "o equipamento reservado";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} e ${labels.at(-1)}`;
}

/**
 * Gera o link de contato com o dono de uma reserva.
 *
 * Gerar o link não altera reserva nenhuma e não contorna disponibilidade: quem
 * decide liberar o equipamento é o docente que está com ele, fora do sistema.
 */
export async function requestWhatsappContact(
  reservationId: string,
  requester: SessionUser,
  ctx: RequestContext = {},
): Promise<WhatsappContactResult> {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      code: true,
      userId: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      room: true,
      status: true,
      user: {
        select: { id: true, fullName: true, phone: true, whatsappOptIn: true },
      },
      items: {
        select: {
          kit: { select: { name: true, code: true } },
          notebook: { select: { assetTag: true, nickname: true } },
        },
      },
    },
  });
  if (!reservation) throw naoEncontrado("Reserva não encontrada.");

  if (reservation.userId === requester.id) {
    throw regraDeNegocio(
      "Esta reserva é sua. Se precisar liberar o equipamento para outra pessoa, cancele a reserva.",
    );
  }

  // Reserva encerrada/cancelada já devolveu o recurso: pedir o equipamento a
  // quem não está mais com ele só geraria confusão.
  if (isClosed(reservation.status)) {
    return {
      disponivel: false,
      motivo:
        "Esta reserva não está mais ativa e o equipamento já foi liberado. Consulte a disponibilidade novamente.",
    };
  }

  const settings = await getSettings();

  const link = buildWhatsappLink({
    settings,
    holder: reservation.user,
    requesterName: requester.fullName,
    resourceLabel: resourceLabelFor(reservation.items),
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    allDay: reservation.allDay,
    room: reservation.room,
  });

  if (!link.available) {
    return { disponivel: false, motivo: link.reason };
  }

  // Registrado antes de devolver o link e sem `catch`: o link contém o número
  // do docente, então nenhum contato pode ser entregue sem deixar rastro de
  // quem pediu, para quem e quando. O conteúdo da conversa não nos interessa.
  await prisma.whatsappContactLog.create({
    data: {
      requesterId: requester.id,
      targetUserId: reservation.user.id,
      reservationId: reservation.id,
    },
  });

  await auditSafe({
    actorId: requester.id,
    action: "reserva.contato_whatsapp",
    entity: "Reservation",
    entityId: reservation.id,
    summary: `Contato por WhatsApp solicitado com ${reservation.user.fullName} sobre a reserva ${reservation.code}`,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { disponivel: true, url: link.url, mensagem: link.message };
}

// ---------------------------------------------------------------------------
// Saída pública de uma reserva
// ---------------------------------------------------------------------------

export type ReservationForClient = Omit<ReservationWithRelations, "user"> & {
  user: Omit<ReservationWithRelations["user"], "phone"> & {
    /** Se dá para acionar o WhatsApp deste docente — o número fica no servidor. */
    whatsappDisponivel: boolean;
  };
};

/**
 * Remove o telefone do dono antes de a reserva sair pela API.
 *
 * A consulta do serviço traz o telefone porque ele é necessário para montar o
 * link do WhatsApp; a resposta HTTP não pode carregá-lo, senão listar reservas
 * viraria um jeito indireto de baixar a agenda telefônica da escola.
 */
export function serializeReservation(
  reservation: ReservationWithRelations,
): ReservationForClient {
  const { phone, ...user } = reservation.user;
  return {
    ...reservation,
    user: {
      ...user,
      whatsappDisponivel: user.whatsappOptIn && Boolean(phone),
    },
  };
}
