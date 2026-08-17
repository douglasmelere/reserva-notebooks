import { z } from "zod";
import { requireSupervisor } from "@/lib/auth";
import { entityHistory } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { naoEncontrado } from "@/lib/errors";
import { formatDateTimeBR } from "@/lib/datetime";
import { handle, json, readQuery } from "@/lib/http";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Histórico de alterações do kit.
 *
 * Não existe tabela de histórico por entidade: a trilha de auditoria já grava
 * ator, ação e o antes/depois de cada campo, então ela *é* o histórico. Isso
 * mantém uma fonte única e garante que nenhuma alteração fique registrada em
 * um lugar e ausente no outro.
 *
 * Restrito à supervisão: a trilha traz IP e agente do navegador de quem
 * alterou, que não são dados para circular entre os professores.
 */
export const GET = handle(
  async (request: Request, { params }: RouteContext) => {
    await requireSupervisor();

    const { id } = await params;
    const { limit } = readQuery(request, historyQuerySchema);

    const kit = await prisma.kit.findUnique({
      where: { id },
      select: { id: true, code: true, name: true },
    });
    if (!kit) throw naoEncontrado("Kit não encontrado.");

    const registros = await entityHistory("Kit", id, limit);

    return json({
      kit,
      total: registros.length,
      historico: registros.map((registro) => ({
        id: registro.id,
        action: registro.action,
        summary: registro.summary,
        before: registro.before,
        after: registro.after,
        createdAt: registro.createdAt.toISOString(),
        createdAtFormatado: formatDateTimeBR(registro.createdAt),
        // Ator ausente = conta removida depois do evento (`onDelete: SetNull`).
        actor: registro.actor
          ? {
              id: registro.actor.id,
              fullName: registro.actor.fullName,
              username: registro.actor.username,
            }
          : null,
        ip: registro.ip,
        userAgent: registro.userAgent,
      })),
    });
  },
  "kits.historico",
);
