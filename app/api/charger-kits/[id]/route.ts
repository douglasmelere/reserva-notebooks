import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { updateChargerKitSchema } from "@/lib/validation";
import {
  deactivateChargerKit,
  getChargerKit,
  updateChargerKit,
} from "@/server/chargers";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = handle(
  async (_request: Request, { params }: RouteContext) => {
    const actor = await requireUser();
    const { id } = await params;
    return json({ chargerKit: await getChargerKit(id, actor) });
  },
  "kits-carregadores.detalhar",
);

/**
 * Atualiza quantidades, vínculo e observações.
 *
 * `COMPLETO`/`INCOMPLETO` enviados no corpo são tratados como "volte a derivar
 * das quantidades" — quem decide entre os dois é a comparação
 * disponível x total, feita em `resolveChargerStatus`.
 */
export const PATCH = handle(
  async (request: Request, { params }: RouteContext) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    const patch = await readJson(request, updateChargerKitSchema);

    const chargerKit = await updateChargerKit(id, patch, actor, {
      ip: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return json({ chargerKit });
  },
  "kits-carregadores.atualizar",
);

/**
 * Desativação lógica: o registro segue existindo para as ocorrências antigas,
 * mas sai do inventário ativo e libera a vaga 1-1 da maleta/carrinho.
 */
export const DELETE = handle(
  async (_request: Request, { params }: RouteContext) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    const chargerKit = await deactivateChargerKit(id, actor, {
      ip: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    return json({
      chargerKit,
      mensagem: `Kit de carregadores ${chargerKit.code} desativado e desvinculado. O histórico foi preservado.`,
    });
  },
  "kits-carregadores.desativar",
);
