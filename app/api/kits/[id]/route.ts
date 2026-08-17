import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import {
  deactivateKit,
  getKit,
  kitPatchSchema,
  setKitStatus,
  updateKit,
} from "@/server/kits";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const deactivateQuerySchema = z.object({
  /** Motivo da desativação, gravado no resumo da auditoria. */
  reason: z.string().trim().max(300).optional(),
});

export const GET = handle(
  async (_request: Request, { params }: RouteContext) => {
    const actor = await requireUser();
    const { id } = await params;
    return json({ kit: await getKit(id, actor) });
  },
  "kits.detalhar",
);

export const PATCH = handle(
  async (request: Request, { params }: RouteContext) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    // `kitPatchSchema` (e não `updateKitSchema`) porque só ele trata "status
    // ausente" como "não mexer no status" — ver o comentário do esquema.
    const patch = await readJson(request, kitPatchSchema);
    const context = {
      ip: await getClientIp(),
      userAgent: await getUserAgent(),
    };

    // Alternar o status é a ação mais frequente da supervisão e chega como um
    // corpo com um campo só. Roteá-la para `setKitStatus` faz o histórico
    // registrar "kit.status" com os rótulos em português, em vez de um
    // genérico "Alterado: status" no meio das edições de cadastro.
    const informados = Object.keys(patch).filter(
      (campo) => patch[campo as keyof typeof patch] !== undefined,
    );
    const somenteStatus =
      informados.length === 1 && informados[0] === "status";

    const kit =
      somenteStatus && patch.status !== undefined
        ? await setKitStatus(id, patch.status, actor, context)
        : await updateKit(id, patch, actor, context);

    return json({ kit });
  },
  "kits.atualizar",
);

/**
 * Desativação lógica.
 *
 * `DELETE` aqui **não** apaga o registro: o kit aparece em reservas
 * encerradas, ocorrências e auditoria, e sumir com ele deixaria esse histórico
 * órfão. O verbo é mantido porque é o que a interface espera do botão
 * "excluir"; o efeito é `status = DESATIVADO`.
 */
export const DELETE = handle(
  async (request: Request, { params }: RouteContext) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    const { reason } = readQuery(request, deactivateQuerySchema);

    const kit = await deactivateKit(
      id,
      actor,
      { ip: await getClientIp(), userAgent: await getUserAgent() },
      reason ?? null,
    );

    return json({
      kit,
      mensagem: `Kit "${kit.name}" desativado. O histórico foi preservado e ele pode ser reativado a qualquer momento.`,
    });
  },
  "kits.desativar",
);
