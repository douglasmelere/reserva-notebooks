import { z } from "zod";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { handle, json, readQuery } from "@/lib/http";
import { adminGetUser } from "@/server/users";

export const dynamic = "force-dynamic";

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/**
 * Histórico administrativo da conta.
 *
 * Vem da trilha de auditoria filtrada por `entity = "User"`, então mostra
 * criação, alterações de cadastro, mudanças de perfil/situação e redefinições
 * de senha — mas não os logins, que ficam sob a entidade "Session" para não
 * afogar a tela em eventos rotineiros.
 */
export const GET = handle(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireSupervisor();
    const { id } = await params;

    // Confirma a existência (e devolve 404 claro) antes de buscar o histórico.
    const usuario = await adminGetUser(id, actor);
    const { limit } = readQuery(request, historyQuerySchema);

    return json({ usuario, items: await entityHistory("User", id, limit) });
  },
  "admin.usuarios.historico",
);
