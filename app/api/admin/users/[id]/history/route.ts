import { z } from "zod";
import { entityHistory, sanitizeForAudit } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { handle, json, readQuery } from "@/lib/http";
import { adminGetUser } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * As mensagens são escritas aqui porque as padrão do Zod sairiam em inglês
 * ("Too big: expected number to be <=200") e chegariam à tela da supervisão.
 */
const historyQuerySchema = z.object({
  limit: z.coerce
    .number({ error: "Informe quantos registros do histórico deseja ver." })
    .int("A quantidade de registros deve ser um número inteiro.")
    .min(1, "Traga ao menos 1 registro do histórico.")
    .max(200, "Traga no máximo 200 registros do histórico por consulta.")
    .default(100),
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

    const registros = await entityHistory("User", id, limit);

    return json({
      usuario,
      total: registros.length,
      // Campo a campo, como nas demais rotas de histórico: devolver a linha
      // crua do banco faria qualquer coluna futura da auditoria vazar sozinha
      // na resposta, sem ninguém decidir por isso.
      items: registros.map((registro) => ({
        id: registro.id,
        action: registro.action,
        summary: registro.summary,
        // Limpos de novo na leitura: `sanitizeForAudit` já roda na gravação,
        // mas um registro antigo pode ter sido gravado antes de alguma chave
        // entrar na lista de redação — e esta é justamente a entidade cujo
        // antes/depois poderia carregar hash de senha.
        before: sanitizeForAudit(registro.before) ?? null,
        after: sanitizeForAudit(registro.after) ?? null,
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
  "admin.usuarios.historico",
);
