import { z } from "zod";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { naoEncontrado } from "@/lib/errors";
import { handle, json, readQuery } from "@/lib/http";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * Histórico de alterações do notebook.
 *
 * Lido da trilha de auditoria — não há tabela de histórico própria. Restrito à
 * supervisão: o histórico expõe quem alterou o quê, o IP e o agente de quem
 * alterou, além de observações internas, que não fazem parte do que o
 * professor precisa para reservar.
 */
export const GET = handle(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    await requireSupervisor();
    const { id } = await context.params;

    // Confirma a existência antes de devolver lista vazia: um id errado deve
    // dar 404, não a falsa impressão de "notebook sem histórico".
    const notebook = await prisma.notebook.findUnique({
      where: { id },
      select: { id: true, assetTag: true },
    });
    if (!notebook) throw naoEncontrado("Notebook não encontrado.");

    const { limit } = readQuery(request, historyQuerySchema);
    const registros = await entityHistory("Notebook", id, limit);

    return json({
      notebook,
      total: registros.length,
      // Campo a campo, como nas demais rotas de histórico: devolver a linha
      // crua do banco faria qualquer coluna futura da auditoria vazar sozinha
      // na resposta, sem ninguém decidir por isso.
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
  "notebooks.historico",
);
