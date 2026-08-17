import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { updateProfileSchema } from "@/lib/validation";
import { getProfile, somenteCamposEnviados, updateProfile } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * O corpo é lido cru antes de validar para sabermos quais campos o cliente
 * realmente enviou. Os esquemas compartilhados normalizam texto opcional
 * ausente para `null`, e sem essa distinção um PATCH só com o nome apagaria
 * e-mail, telefone e departamento.
 */
const corpoBrutoSchema = z.record(z.string(), z.unknown());

export const GET = handle(async () => {
  const user = await requireUser();
  return json({ usuario: await getProfile(user.id) });
}, "me.perfil");

export const PATCH = handle(async (request: Request) => {
  const user = await requireUser();
  await assertSameOrigin();

  const bruto = await readJson(request, corpoBrutoSchema);
  // `parse` lança `ZodError`, que o `handle` converte em 422 com erros por campo.
  const patch = somenteCamposEnviados(updateProfileSchema.parse(bruto), bruto);

  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);
  const usuario = await updateProfile(user.id, patch, { ip, userAgent });

  return json({ usuario });
}, "me.atualizar-perfil");
