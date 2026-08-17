import { entityHistory } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { getReservation } from "@/server/reservations";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Histórico de alterações da reserva.
 *
 * Vem da trilha de auditoria (`audit_logs`), fonte única do histórico de todas
 * as entidades — não há tabela de histórico paralela para manter em sincronia.
 */
export const GET = handle(async (_request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  const { id } = await params;

  // O próprio serviço aplica o escopo: professor que pede o histórico de uma
  // reserva alheia recebe 404, igual ao detalhe.
  await getReservation(id, user);

  const logs = await entityHistory("Reservation", id);
  const isSupervisor = user.role === "SUPERVISOR";

  return json({
    items: logs.map((log) => ({
      id: log.id,
      action: log.action,
      summary: log.summary,
      before: log.before,
      after: log.after,
      createdAt: log.createdAt,
      actor: log.actor
        ? {
            id: log.actor.id,
            fullName: log.actor.fullName,
            username: log.actor.username,
          }
        : null,
      // IP e navegador são dado de investigação, não de leitura do docente:
      // no histórico da própria reserva apareceriam os acessos da supervisão.
      ...(isSupervisor ? { ip: log.ip, userAgent: log.userAgent } : {}),
    })),
  });
}, "reservas.historico");
