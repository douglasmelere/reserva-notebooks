import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json, readJson } from "@/lib/http";
import { updateIncidentSchema } from "@/lib/validation";
import { getIncident, updateIncident } from "@/server/incidents";

export const dynamic = "force-dynamic";

/**
 * Em um PATCH, "campo ausente" e "campo enviado vazio" significam coisas
 * diferentes: o primeiro não altera nada, o segundo limpa o valor. O esquema
 * compartilhado normaliza texto opcional para `null`, o que apagaria a solução
 * já registrada a cada atualização de status. Aqui a solução volta a ser
 * `undefined` quando não vem no corpo.
 */
const patchIncidentSchema = updateIncidentSchema.extend({
  resolution: z.string().trim().max(2000, "Solução muito longa").nullable().optional(),
});

export const GET = handle(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireUser();
    const { id } = await params;
    return json({ ocorrencia: await getIncident(id, actor) });
  },
  "ocorrencias.detalhe",
);

export const PATCH = handle(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireUser();
    await assertSameOrigin();

    const { id } = await params;
    const patch = await readJson(request, patchIncidentSchema);

    if (Object.keys(patch).length === 0) {
      throw dadosInvalidos("Informe ao menos um campo para alterar.");
    }

    const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);
    const resultado = await updateIncident(id, patch, actor, { ip, userAgent });

    return json(resultado);
  },
  "ocorrencias.atualizar",
);
