import { requireUser } from "@/lib/auth";
import { entityHistory } from "@/lib/audit";
import { handle, json } from "@/lib/http";
import { assertCanSeeIncident } from "@/server/incidents";

export const dynamic = "force-dynamic";

/**
 * Histórico de alterações da ocorrência.
 *
 * A trilha vem da mesma tabela de auditoria usada pela supervisão — não há uma
 * tabela de histórico por entidade. A permissão é a mesma de ver a ocorrência:
 * `assertCanSeeIncident` responde 404 para quem não pode enxergá-la, e só
 * depois disso consultamos o histórico.
 */
export const GET = handle(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireUser();
    const { id } = await params;

    await assertCanSeeIncident(id, actor);
    const registros = await entityHistory("Incident", id);
    const isSupervisor = actor.role === "SUPERVISOR";

    return json({
      historico: registros.map((registro) => ({
        id: registro.id,
        action: registro.action,
        summary: registro.summary,
        before: registro.before,
        after: registro.after,
        createdAt: registro.createdAt.toISOString(),
        actor: registro.actor
          ? {
              id: registro.actor.id,
              fullName: registro.actor.fullName,
              username: registro.actor.username,
            }
          : null,
        // IP e user agent são dado de segurança, não de operação: só a
        // supervisão precisa deles para investigar um acesso.
        ...(isSupervisor
          ? { ip: registro.ip, userAgent: registro.userAgent }
          : {}),
      })),
    });
  },
  "ocorrencias.historico",
);
