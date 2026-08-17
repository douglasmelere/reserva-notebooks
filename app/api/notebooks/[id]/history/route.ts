import { z } from "zod";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
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
 * supervisão: o histórico expõe quem alterou o quê e observações internas, que
 * não fazem parte do que o professor precisa para reservar.
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
    const eventos = await entityHistory("Notebook", id, limit);

    return json({ notebook, eventos, total: eventos.length });
  },
  "notebooks.historico",
);
