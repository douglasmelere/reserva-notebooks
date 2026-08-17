import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { updateNotebookSchema } from "@/lib/validation";
import {
  deactivateNotebook,
  getNotebook,
  updateNotebook,
} from "@/server/notebooks";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Detalhe do notebook, com kit, ocorrências recentes e reservas que o ocupam. */
export const GET = handle(async (_request: Request, context: RouteContext) => {
  const user = await requireUser();
  const { id } = await context.params;
  return json({ notebook: await getNotebook(id, user) });
}, "notebooks.detalhe");

/**
 * Altera o notebook.
 *
 * O mesmo endpoint cobre edição de cadastro, mudança de status e transferência
 * de kit: são a mesma escrita, e separá-los em rotas diferentes só faria a
 * interface precisar decidir qual chamar. A auditoria diferencia os casos pela
 * mensagem e pelo antes/depois.
 *
 * Enviar `status` de saída de circulação (manutenção, perdido, indisponível,
 * desativado) NÃO cancela reservas: a resposta traz `reservasFuturasAtivas` e
 * `aviso` para a supervisão decidir o que fazer.
 */
export const PATCH = handle(async (request: Request, context: RouteContext) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const { id } = await context.params;
  const patch = await readJson(request, updateNotebookSchema);

  const result = await updateNotebook(id, patch, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json(result);
}, "notebooks.atualizar");

/**
 * Desativa o notebook (exclusão lógica).
 *
 * Não existe exclusão física: o equipamento aparece em reservas e ocorrências
 * antigas. Devolve 200 com o resultado — e não 204 — porque a resposta pode
 * trazer um aviso que a supervisão precisa ler.
 */
export const DELETE = handle(async (_request: Request, context: RouteContext) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const { id } = await context.params;
  const result = await deactivateNotebook(id, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json(result);
}, "notebooks.desativar");
