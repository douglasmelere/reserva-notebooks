import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import { createNotebookSchema } from "@/lib/validation";
import {
  createNotebook,
  listNotebooks,
  listNotebooksQuerySchema,
} from "@/server/notebooks";

/** Lê cookie de sessão e banco a cada requisição: nada de cache estático. */
export const dynamic = "force-dynamic";

/**
 * Lista o inventário de notebooks.
 *
 * Aberta a qualquer usuário autenticado — o professor precisa enxergar os
 * equipamentos para montar a reserva. O recorte por perfil (professor não vê
 * desativados) é aplicado dentro de `listNotebooks`, não aqui, para valer
 * também quando outro código chamar o serviço.
 */
export const GET = handle(async (request: Request) => {
  const user = await requireUser();
  const filtros = readQuery(request, listNotebooksQuerySchema);
  return json(await listNotebooks(filtros, user));
}, "notebooks.listar");

/** Cadastra um notebook. Restrito à supervisão. */
export const POST = handle(async (request: Request) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const body = await readJson(request, createNotebookSchema);
  const notebook = await createNotebook(body, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json({ notebook }, { status: 201 });
}, "notebooks.criar");
