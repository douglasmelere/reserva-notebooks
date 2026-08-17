import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import { createKitSchema } from "@/lib/validation";
import { createKit, kitListQuerySchema, listKits } from "@/server/kits";

/** Lê cookie de sessão e banco a cada chamada: nada aqui pode ser pré-render. */
export const dynamic = "force-dynamic";

/**
 * Lista maletas e carrinhos.
 *
 * Aberta a qualquer usuário autenticado porque o professor precisa consultar o
 * inventário para montar a reserva; o recorte do que ele enxerga (kits
 * desativados ficam de fora) é aplicado dentro de `listKits`.
 */
export const GET = handle(async (request: Request) => {
  const actor = await requireUser();
  const filtros = readQuery(request, kitListQuerySchema);
  return json(await listKits(filtros, actor));
}, "kits.listar");

export const POST = handle(async (request: Request) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const body = await readJson(request, createKitSchema);
  const kit = await createKit(body, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json({ kit }, { status: 201 });
}, "kits.criar");
