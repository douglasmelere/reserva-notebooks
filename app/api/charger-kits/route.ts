import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import { createChargerKitSchema } from "@/lib/validation";
import {
  chargerKitListQuerySchema,
  createChargerKit,
  listChargerKits,
} from "@/server/chargers";

export const dynamic = "force-dynamic";

/**
 * Lista kits de carregadores.
 *
 * Visível para qualquer usuário autenticado: saber que a maleta está com dois
 * carregadores faltando é informação de que o professor precisa antes de levar
 * a turma para a sala. Registros desativados ficam restritos à supervisão.
 */
export const GET = handle(async (request: Request) => {
  const actor = await requireUser();
  const filtros = readQuery(request, chargerKitListQuerySchema);
  return json(await listChargerKits(filtros, actor));
}, "kits-carregadores.listar");

export const POST = handle(async (request: Request) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const body = await readJson(request, createChargerKitSchema);
  const chargerKit = await createChargerKit(body, actor, {
    ip: await getClientIp(),
    userAgent: await getUserAgent(),
  });

  return json({ chargerKit }, { status: 201 });
}, "kits-carregadores.criar");
